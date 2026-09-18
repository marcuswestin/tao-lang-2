import { FS, Platform, Repo, Time } from '@shared'
import { MachineLanes, type MachineResourceLease } from './MachineLanes'

/**
 * How long each node actually takes, so ordering is derived from evidence instead of hand-tuned
 * constants. Every lane reads the store when it plans and writes it when it ends, and every run
 * also appends one line of history — the per-node timing record future cost questions need.
 *
 * A missing or corrupt store is a cold start, never an error: timings refine a run, they never
 * gate one.
 */

/** NodeTiming is what the store remembers about one node. */
export type NodeTiming = {
  /** Exponential moving average of the node's duration, in milliseconds. */
  emaMs: number
  lastMs: number
  /** ISO timestamp of the run this node last completed in. */
  lastRunAt: string
  samples: number
}

/** TimingsStore is the versioned per-node duration record. */
export type TimingsStore = {
  nodes: Record<string, NodeTiming>
  version: 1
}

/** RunTimingsOptions locates the store; every path is relative to the repository root. */
export type RunTimingsOptions = {
  repositoryRoot?: string
}

/** RecordRunOptions describes one finished run's durations. */
export type RecordRunOptions = RunTimingsOptions & {
  /** Milliseconds each node that actually ran took, by node name. */
  durations: ReadonlyMap<string, number>
  lane: string
  stamp: string
}

const DURATIONS_PATH = '.artifacts/timings/durations.json'
const HISTORY_PATH = '.artifacts/timings/history.jsonl'
const LOCK_PATH = '.artifacts/timings/transaction-lock'
/** Long enough for a sibling lane's merge, short enough never to hold a finished run open. */
const LOCK_WAIT_MS = 2_000
/**
 * Weight of the newest sample. High enough that a suite which just grew is reflected within a
 * couple of runs, low enough that one contended run does not rewrite the estimate.
 */
const EMA_WEIGHT = 0.3

function emptyStore(): TimingsStore {
  return { nodes: {}, version: 1 }
}

/** load reads the timings store, treating anything unreadable as a cold start. */
async function load(options: RunTimingsOptions = {}): Promise<TimingsStore> {
  try {
    const store = await FS.readJson<TimingsStore>(durationsPath(options))
    return store.nodes === undefined || typeof store.nodes !== 'object' ? emptyStore() : store
  } catch {
    return emptyStore()
  }
}

/** expectedMs returns the duration a node is expected to take, or undefined before its first run. */
function expectedMs(store: TimingsStore, name: string): number | undefined {
  const timing = store.nodes[name]
  return timing === undefined || !Number.isFinite(timing.emaMs) ? undefined : timing.emaMs
}

/**
 * record folds one run's durations into the store and appends the run to the history log.
 *
 * Two lanes in one checkout are a read-modify-write race two ways over. A truncating write lets a
 * concurrent reader see half a file, which `load` then reads as a cold checkout and which mis-orders
 * the next run; and an interleaved read-modify-write loses one lane's samples entirely. The two need
 * different answers, and conflating them was a mistake worth naming:
 *
 * - The **file** is always published by atomic rename, with no condition attached. A reader may see
 *   the old store or the new one, never a partial one.
 * - The **merge** is serialized by a per-checkout lease, on a short wait. If the lease cannot be had
 *   in that time the write still happens, unserialized: the worst case is then the lost update this
 *   store has always been able to suffer, which costs one estimate, where skipping the write costs
 *   every estimate from then on. A lane that stops recording stops learning, and a suite that stops
 *   being measured stops being re-sharded.
 */
async function record(options: RecordRunOptions): Promise<void> {
  if (options.durations.size === 0) {
    return
  }
  const lease = await acquireLease(options)
  try {
    const store = await load(options)
    const lastRunAt = new Date().toISOString()
    for (const [name, durationMs] of options.durations) {
      const previous = store.nodes[name]
      store.nodes[name] = {
        emaMs: previous === undefined || !Number.isFinite(previous.emaMs)
          ? Math.round(durationMs)
          : Math.round(EMA_WEIGHT * durationMs + (1 - EMA_WEIGHT) * previous.emaMs),
        lastMs: Math.round(durationMs),
        lastRunAt,
        samples: (previous?.samples ?? 0) + 1,
      }
    }
    await writeStore(store, options)
    await appendHistory(options)
  } finally {
    await lease?.release()
  }
}

/**
 * acquireLease serializes the store's read-modify-write between the lanes of one checkout, on a
 * deliberately short wait. Returning nothing means "write anyway, unserialized": the caller still
 * publishes atomically, so the cost of not waiting longer is at most a lost update.
 */
async function acquireLease(options: RunTimingsOptions): Promise<MachineResourceLease | undefined> {
  const registryRoot = FS.resolvePath(LOCK_PATH, options.repositoryRoot ?? Repo.getRoot())
  try {
    return await Time.pollUntil(
      () => MachineLanes.tryAcquireResource({ name: 'run-timings', registryRoot }),
      { intervalMs: 25, timeoutMs: LOCK_WAIT_MS },
    )
  } catch {
    return undefined
  }
}

/** writeStore publishes the store by atomic rename, so no reader ever sees a partial file. */
async function writeStore(store: TimingsStore, options: RunTimingsOptions): Promise<void> {
  const path = durationsPath(options)
  const temporaryPath = `${path}.${Platform.randomUUID()}.tmp`
  await FS.writeJson(temporaryPath, store)
  try {
    await FS.move(temporaryPath, path)
  } catch (error) {
    await FS.remove(temporaryPath).catch(() => {})
    throw error
  }
}

async function appendHistory(options: RecordRunOptions): Promise<void> {
  const entry = {
    lane: options.lane,
    nodes: Object.fromEntries([...options.durations].map(([name, ms]) => [name, Math.round(ms)])),
    stamp: options.stamp,
  }
  const historyFile = await FS.openAppend(historyPath(options))
  try {
    await historyFile.write(`${JSON.stringify(entry)}\n`)
  } finally {
    await historyFile.close()
  }
}

function durationsPath(options: RunTimingsOptions): string {
  return FS.resolvePath(DURATIONS_PATH, options.repositoryRoot ?? Repo.getRoot())
}

function historyPath(options: RunTimingsOptions): string {
  return FS.resolvePath(HISTORY_PATH, options.repositoryRoot ?? Repo.getRoot())
}

/** RunTimings owns the measured durations that order the work graph. */
export const RunTimings = {
  DURATIONS_PATH,
  HISTORY_PATH,
  expectedMs,
  load,
  record,
} as const
