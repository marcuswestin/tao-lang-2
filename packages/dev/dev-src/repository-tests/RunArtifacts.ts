import { FS, Repo } from '@shared'
import { RunTimings } from './RunTimings'
import { WorkGraph, type WorkState } from './WorkGraph'

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
  /** The lane's own rollup, written as `summary.json`. */
  summary: unknown
}

const SUMMARY_FILE = 'summary.json'
const LATEST_LINK = 'latest'

/** runStamp returns the filesystem-safe timestamp a run's directory is named after. */
function runStamp(now = new Date()): string {
  return now.toISOString().replaceAll(/[:.]/g, '-')
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

/** finishRun writes the node logs, the summary, the `latest` link, and this run's timings. */
async function finishRun(options: FinishRunOptions): Promise<string> {
  await FS.mkdir(options.location.logRoot)
  await Promise.all(options.states.map(async state => {
    if (state.logPath !== undefined) {
      await FS.writeText(state.logPath, state.fullOutput)
    }
  }))
  const summaryPath = FS.resolvePath(SUMMARY_FILE, options.location.logRoot)
  await FS.writeJson(summaryPath, options.summary)
  await refreshLatest(options.location)
  if (options.recordTimings !== false) {
    await RunTimings.record({
      durations: measuredDurations(options.states),
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

/** refreshLatest repoints `<lane>/latest` at this run; a host that refuses links is not a failure. */
async function refreshLatest(location: RunLocation): Promise<void> {
  try {
    await FS.replaceSymlink(FS.basename(location.logRoot), FS.resolvePath(LATEST_LINK, location.laneRoot))
  } catch {
    // A read-only or link-hostile artifact root loses the shortcut, not the run.
  }
}

/** measuredDurations reports how long each node that actually ran took. */
function measuredDurations(states: readonly WorkState[]): Map<string, number> {
  return new Map(
    states
      .filter(state => state.status === 'failed' || state.status === 'passed')
      .map(state => [state.name, state.elapsedMs]),
  )
}

/** RunArtifacts owns the per-run log, summary, and timing artifacts every lane writes. */
export const RunArtifacts = {
  SUMMARY_FILE,
  assignLogPaths,
  finishRun,
  locate,
  writeSummaryCopy,
} as const
