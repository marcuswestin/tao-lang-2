import { FS, Platform, Repo } from '@shared'
import { type NodeSample, RunTimings } from './RunTimings'
import { type WorkEvent, WorkGraph, type WorkState } from './WorkGraph'

/**
 * Every lane leaves the same trail: `.artifacts/logs/<lane>/<stamp>/` with one `<node>.log` per
 * node and a `summary.json` beside them, and a `latest` symlink next to the stamps so an agent can
 * name the newest run without listing a directory. One module owns writing all of it, so `dev test`
 * and `dev gates` cannot drift apart on where a reader should look.
 */

/** RunLocation is where one run's artifacts live. */
export type RunLocation = {
  lane: string
  /** `.artifacts/logs/<lane>`, the directory `latest` lives in. */
  laneRoot: string
  /** `.artifacts/logs/<lane>/<stamp>`, this run's own directory. */
  logRoot: string
  repositoryRoot: string
  stamp: string
}

/** FinishRunOptions describes the completed run whose artifacts are being written. */
export type FinishRunOptions = {
  location: RunLocation
  /**
   * False for a run that shared the machine, whose durations measure the contention rather than
   * the work. Ordering has a cold-start fallback; an estimate poisoned by a neighbouring worktree
   * has none, and it mis-orders every later run in this checkout.
   */
  recordTimings?: boolean
  states: readonly WorkState[]
  /**
   * Samples to record beside the nodes' own, for a name the run did not schedule directly. A
   * sharded suite is the case: its shards are the nodes, and the suite still has to measure itself
   * or its shard count can never change again.
   */
  extraDurations?: ReadonlyMap<string, NodeSample>
  /** The lane's own rollup, written as `summary.json`. */
  summary: unknown
}

/** LiveRunWriter publishes a completed node's log before its reporter announces the path. */
export type LiveRunWriter = {
  finish: () => Promise<void>
  handle: (event: WorkEvent) => void
}

const SUMMARY_FILE = 'summary.json'
const LATEST_LINK = 'latest'

/** runStamp returns the filesystem-safe timestamp a run's directory is named after. */
function runStamp(now = new Date()): string {
  const timestamp = now.toISOString().replaceAll(/[:.]/g, '-')
  return `${timestamp}-${Platform.runtimeProcess.pid}-${Platform.randomUUID().slice(0, 8)}`
}

/** locate resolves where one lane's run writes, creating nothing yet. */
function locate(options: { lane: string; logRoot?: string; repositoryRoot?: string; stamp?: string }): RunLocation {
  const repositoryRoot = options.repositoryRoot ?? Repo.getRoot()
  const stamp = options.stamp ?? runStamp()
  const logRoot = options.logRoot === undefined
    ? FS.resolvePath(`.artifacts/logs/${options.lane}/${stamp}`, repositoryRoot)
    : FS.resolvePath(options.logRoot, repositoryRoot)
  return { lane: options.lane, laneRoot: FS.dirname(logRoot), logRoot, repositoryRoot, stamp }
}

/**
 * assignLogPaths names every node's log before the run starts, so a reporter can print where a
 * node's output will be without waiting for the file to exist.
 */
async function assignLogPaths(states: readonly WorkState[], location: RunLocation): Promise<void> {
  await FS.mkdir(location.logRoot)
  for (const state of states) {
    state.logPath = FS.resolvePath(`${WorkGraph.nodeLabel(state.node)}.log`, location.logRoot)
  }
}

/**
 * liveWriter forwards progress immediately, except completion: that event is forwarded only after
 * the node's log exists. A quiet reporter can therefore print a path another process can open at
 * that moment, even while the rest of the lane is still running.
 */
function liveWriter(location: RunLocation, forward: (event: WorkEvent) => void): LiveRunWriter {
  const writes: Promise<void>[] = []
  return {
    finish: async () => await Promise.all(writes).then(() => {}),
    handle: event => {
      if (event.kind !== 'complete') {
        forward(event)
        return
      }
      writes.push(writeCompletedLog(event.state, location).then(() => forward(event)))
    },
  }
}

async function writeCompletedLog(state: WorkState, location: RunLocation): Promise<void> {
  await FS.mkdir(location.logRoot)
  if (state.logPath !== undefined) {
    await FS.writeText(state.logPath, state.fullOutput)
  }
}

/** finishRun writes the node logs, the summary, the `latest` link, and this run's timings. */
async function finishRun(options: FinishRunOptions): Promise<string> {
  await FS.mkdir(options.location.logRoot)
  await Promise.all(options.states.map(async state => {
    await writeCompletedLog(state, options.location)
    const initialAttempt = state.attempts?.[0]
    if (initialAttempt !== undefined) {
      const initialPath = FS.resolvePath(
        `${WorkGraph.nodeLabel(state.node)}.initial.log`,
        options.location.logRoot,
      )
      await FS.writeText(initialPath, initialAttempt.fullOutput)
    }
  }))
  const summaryPath = FS.resolvePath(SUMMARY_FILE, options.location.logRoot)
  await FS.writeJson(summaryPath, options.summary)
  await refreshLatest(options.location)
  if (options.recordTimings !== false) {
    await RunTimings.record({
      durations: new Map([...measuredDurations(options.states), ...options.extraDurations ?? []]),
      lane: options.location.lane,
      repositoryRoot: options.location.repositoryRoot,
      stamp: options.location.stamp,
    })
  }
  return summaryPath
}

/**
 * writeSummaryCopy writes an extra copy of the summary at a caller-named stable path. `verify` has
 * always published one at a path with no timestamp in it, and its readers still expect it there.
 */
async function writeSummaryCopy(jsonPath: string, repositoryRoot: string, summary: unknown): Promise<string> {
  const path = FS.resolvePath(jsonPath, repositoryRoot)
  await FS.writeJson(path, summary)
  return path
}

/**
 * refreshLatest repoints `<lane>/latest` at this run, atomically.
 *
 * Removing the link and recreating it leaves a window with no `latest` at all, and two lanes of one
 * checkout finishing together make the loser's create fail outright. An agent reading `latest` in
 * that window sees nothing rather than the previous run. Creating the new link under a unique name
 * beside it and renaming it over the old one has no such window: a reader sees the old run or the
 * new one, never neither. A host that refuses links loses the shortcut, not the run.
 */
async function refreshLatest(location: RunLocation): Promise<void> {
  try {
    await FS.replaceSymlink(FS.basename(location.logRoot), FS.resolvePath(LATEST_LINK, location.laneRoot))
  } catch {
    // A read-only or link-hostile artifact root loses the shortcut, not the run.
  }
}

/** measuredDurations learns only from successful work; failures and interruptions are not estimates. */
function measuredDurations(states: readonly WorkState[]): Map<string, NodeSample> {
  return new Map(
    states
      .filter(state => state.status === 'passed')
      .map(state => [state.name, {
        concurrency: laneConcurrency(state, states),
        cpuMs: directCpuMs(state),
        wallMs: state.elapsedMs,
      }]),
  )
}

/**
 * directCpuMs reads a node's own captured CPU time, when its runner measured one. `WorkGraph`'s
 * process runner spawns through `Bun.spawn` and records `resourceUsage()`'s user+system time onto
 * `WorkState.cpuMs` once a node exits; a node whose process never started, or whose runner is an
 * injected test double that never sets it, simply leaves the field absent.
 */
function directCpuMs(state: WorkState): number | undefined {
  return typeof state.cpuMs === 'number' && Number.isFinite(state.cpuMs) ? state.cpuMs : undefined
}

/**
 * laneConcurrency counts how many nodes — this one included — had overlapping execution windows,
 * from each node's own `startedAt` and `elapsedMs`. It is computed here rather than read off the
 * scheduler because every fact it needs is already on the states this module is handed, and it is
 * one purpose-built number rather than a general scheduling trace.
 */
function laneConcurrency(state: WorkState, states: readonly WorkState[]): number | undefined {
  if (state.startedAt === undefined) {
    return undefined
  }
  const start = state.startedAt
  const end = start + state.elapsedMs
  let overlapping = 0
  for (const other of states) {
    if (other.startedAt === undefined) {
      continue
    }
    if (other.startedAt < end && other.startedAt + other.elapsedMs > start) {
      overlapping += 1
    }
  }
  return overlapping
}

/** RunArtifacts owns the per-run log, summary, and timing artifacts every lane writes. */
export const RunArtifacts = {
  SUMMARY_FILE,
  assignLogPaths,
  finishRun,
  liveWriter,
  locate,
  writeSummaryCopy,
} as const
