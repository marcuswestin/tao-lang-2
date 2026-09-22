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
  /**
   * The direct child's own CPU time (user+system), when its runner captured one. Absent for every
   * node until something upstream of `record` starts measuring it — see `NodeSample.cpuMs`.
   */
  lastCpuMs?: number
  /** How many sibling nodes in the lane overlapped this node's last run, itself included. */
  lastConcurrency?: number
  /** Wall-clock milliseconds the node's last run measured, whatever `emaMs` was built from. */
  lastWallMs?: number
  /**
   * Which measurement `emaMs` and `lastMs` are built from. Optional because every `durations.json`
   * written before CPU time was measured has entries without it, and the store is read back at
   * version 1 rather than migrated — a required field here would be a type that lies about every
   * machine's existing file. Absent means `wall`, which is what those entries are.
   */
  source?: 'cpu' | 'wall'
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

/**
 * NodeSample is one run's raw measurement of one node, before `record` decides which of its
 * numbers to trust.
 */
export type NodeSample = {
  /**
   * Milliseconds of CPU time (`resourceUsage().cpuTime.user + .system`) the node's direct child
   * process consumed, when the runner captured it. Contention-invariant: a CPU-bound child reports
   * the same number whether it ran alone or beside three other lanes, which wall time cannot.
   */
  cpuMs?: number
  /** How many sibling nodes in the lane overlapped this node's execution window, itself included. */
  concurrency?: number
  /** Wall-clock milliseconds the node took. Always present; every node can at least be timed. */
  wallMs: number
}

/** RecordRunOptions describes one finished run's measurements. */
export type RecordRunOptions = RunTimingsOptions & {
  /** Under machine contention, keep only CPU samples that pass the plausibility check. */
  cpuOnly?: boolean
  /** What each node that actually ran measured, by node name. */
  durations: ReadonlyMap<string, NodeSample>
  lane: string
  stamp: string
}

const DURATIONS_PATH = '.artifacts/timings/durations.json'
const HISTORY_PATH = '.artifacts/timings/history.jsonl'
const LOCK_PATH = '.artifacts/timings/transaction-lock'
/** Long enough for a sibling lane's merge, short enough never to hold a finished run open. */
const LOCK_WAIT_MS = 2_000
/**
 * Below this share of a node's own wall time, its CPU sample is not trusted as the node's duration
 * and `record` falls back to wall time instead.
 *
 * `resourceUsage()` does count a subprocess's CPU time when the direct child waits on it — a shell
 * wrapper around the real worker, which most gates are, reports close to the descendant's own total.
 * What it does not count is CPU spent by something the direct child never waited on: a detached or
 * backgrounded process it fires and forgets, or a native runtime and a handful of `tao-cli` tests that
 * launch a nested `tao` process and do almost none of the work themselves in the waited-on sense, so
 * their direct child reports a small `cpuMs` against a much larger `wallMs`. Ordinary machine
 * contention thins the same ratio, because cpu time holds steady while wall time stretches to fit
 * around the other lanes — but contention on an 18-core checkout rarely starves a genuinely CPU-bound
 * process this far: a process still doing its own work keeps collecting CPU time in every scheduling
 * slice it gets, however few. A process that mostly blocks on unwaited-for work collects almost none,
 * at any load. 203ms of measured user+system CPU against 211ms of wall for an uncontended CPU-bound
 * child is a ratio near 1; a suite whose real work happens outside what the direct child waits on
 * reads far below this floor whether the machine is busy or not, which is the signal this threshold is
 * tuned to catch rather than to tell contention apart from it.
 */
const CPU_PLAUSIBILITY_MIN_RATIO = 0.2
/**
 * Weight of the newest sample, for a wall-time-sourced estimate. High enough that a suite which just
 * grew is reflected within a couple of runs, low enough that one contended run does not rewrite the
 * estimate — wall time is exactly the number contention corrupts, so a single bad sample still needs
 * damping against the average that came before it.
 */
const EMA_WEIGHT_WALL = 0.3
/**
 * Weight of the newest sample, for a CPU-sourced estimate. A CPU sample does not carry the failure
 * mode `EMA_WEIGHT_WALL` was damping against — a contended run's `cpuMs` is not corrupted by the
 * contention, so protecting the average against "one contended run" is protecting it against nothing.
 * What is left to smooth is ordinary sample noise (cache state, JIT warmup, GC timing), which needs
 * far less damping, so a CPU-sourced estimate converges faster on a suite that grew or shrank.
 */
const EMA_WEIGHT_CPU = 0.5

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
  const durations = options.cpuOnly === true
    ? new Map([...options.durations].filter(([, sample]) => chosenMs(sample).source === 'cpu'))
    : options.durations
  if (durations.size === 0) {
    return
  }
  const lease = await acquireLease(options)
  try {
    const store = await load(options)
    const lastRunAt = new Date().toISOString()
    for (const [name, sample] of durations) {
      const previous = store.nodes[name]
      const chosen = chosenMs(sample)
      const weight = chosen.source === 'cpu' ? EMA_WEIGHT_CPU : EMA_WEIGHT_WALL
      store.nodes[name] = {
        emaMs: previous === undefined || !Number.isFinite(previous.emaMs)
          ? Math.round(chosen.valueMs)
          : Math.round(weight * chosen.valueMs + (1 - weight) * previous.emaMs),
        lastConcurrency: sample.concurrency,
        lastCpuMs: sample.cpuMs,
        lastMs: Math.round(chosen.valueMs),
        lastRunAt,
        lastWallMs: Math.round(sample.wallMs),
        samples: (previous?.samples ?? 0) + 1,
        source: chosen.source,
      }
    }
    await writeStore(store, options)
    await appendHistory({ ...options, durations })
  } finally {
    await lease?.release()
  }
}

/**
 * chosenMs decides which of one sample's numbers is this node's duration: `cpuMs` when it was
 * captured and its ratio to `wallMs` clears `CPU_PLAUSIBILITY_MIN_RATIO`, wall time otherwise. See
 * that constant for why a low ratio is never trusted rather than diagnosed further.
 */
function chosenMs(sample: NodeSample): { source: 'cpu' | 'wall'; valueMs: number } {
  if (
    sample.cpuMs !== undefined
    && Number.isFinite(sample.cpuMs)
    && sample.wallMs > 0
    && sample.cpuMs / sample.wallMs >= CPU_PLAUSIBILITY_MIN_RATIO
  ) {
    return { source: 'cpu', valueMs: sample.cpuMs }
  }
  return { source: 'wall', valueMs: sample.wallMs }
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
    nodes: Object.fromEntries([...options.durations].map(([name, sample]) => [name, {
      concurrency: sample.concurrency,
      cpuMs: sample.cpuMs === undefined ? undefined : Math.round(sample.cpuMs),
      wallMs: Math.round(sample.wallMs),
    }])),
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
