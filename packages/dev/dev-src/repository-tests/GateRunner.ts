import { Repo, Time } from '@shared'
import { GateCatalog } from './GateCatalog'
import { RunArtifacts } from './RunArtifacts'
import { buildSummary, type GateSummary, skippedResult } from './RunSummary'
import { RunTimings } from './RunTimings'
import { WorkGraph, type WorkOutcome, type WorkState } from './WorkGraph'
import { type OutputMode, WorkReporter, type WorkReporterHandle } from './WorkReporter'

/**
 * `check` and `verify` run several gates at once. This turns a lane's gate names into work-graph
 * nodes, runs them through the one scheduler, and leaves the same trail every lane leaves: per-gate
 * logs, a versioned summary, and one rollup naming every gate, its status and cost, where its log
 * is, and the first failure worth acting on.
 *
 * The Justfile still decides which gates belong to which lane; this owns only how they run and how
 * the result is reported. `GateCatalog` supplies each name's scheduling shape, so a lane is one
 * list of recipe names and nothing here has to know what any of them do.
 */

export type RunGatesOptions = {
  /** Gate recipe names, in the order the Justfile declared them. */
  gates: readonly string[]
  jobs?: number
  /** Path to write an extra stable copy of the JSON summary to, for the lane's known-path readers. */
  jsonPath?: string
  /** Artifact lane; names the log directory and appears in the summary. */
  lane?: string
  logRoot?: string
  now?: () => number
  /** How the run reports itself while it runs. Omitted, it reports nothing but the artifacts. */
  outputMode?: OutputMode
  repositoryRoot?: string
  /** Gates deliberately not run in this lane, as `name=reason`. */
  skipped?: readonly string[]
  /** Injected so tests observe orchestration without running the real recipes. */
  runGate?: (name: string, logPath: string) => Promise<{ exitCode: number; output: string }>
}

const DEFAULT_LANE = 'verify'

/** runGates executes every gate through the work graph and returns the rollup. */
export async function runGates(options: RunGatesOptions): Promise<GateSummary> {
  const location = RunArtifacts.locate({
    lane: options.lane ?? DEFAULT_LANE,
    logRoot: options.logRoot,
    repositoryRoot: options.repositoryRoot ?? Repo.getRoot(),
  })
  const now = options.now ?? Time.nowMs
  const startedAt = now()
  // A gate that is both run and declared skipped is run: the declaration is stale, and counting
  // it twice would make the totals disagree with the list above them.
  const declaredSkips = (options.skipped ?? [])
    .map(skippedResult)
    .filter(result => !options.gates.includes(result.name))

  const states = options.gates.map(name => WorkGraph.createState(GateCatalog.node(name, location.repositoryRoot)))
  await RunArtifacts.assignLogPaths(states, location)
  const timings = await RunTimings.load({ repositoryRoot: location.repositoryRoot })
  const expectedMs = (name: string) => RunTimings.expectedMs(timings, name)
  const reporter = createReporter(options, location.logRoot)

  const result = await WorkGraph.run(states, {
    expectedMs,
    jobs: options.jobs,
    onEvent: event => reporter.handle(event),
    runNode: options.runGate === undefined ? undefined : injectedRunner(options.runGate),
  })
  await reporter.finish()

  const summary = buildSummary({
    declaredSkips,
    elapsedMs: now() - startedAt,
    expectedMs,
    interrupted: result.interrupted,
    lane: location.lane,
    logRoot: location.logRoot,
    order: options.gates,
    states,
  })
  await RunArtifacts.finishRun({ location, states, summary })
  if (options.jsonPath !== undefined) {
    await RunArtifacts.writeSummaryCopy(options.jsonPath, location.repositoryRoot, summary)
  }
  return summary
}

function injectedRunner(
  runGate: NonNullable<RunGatesOptions['runGate']>,
): (state: WorkState) => Promise<WorkOutcome> {
  return async state => {
    const result = await runGate(state.name, state.logPath ?? '')
    return { exitCode: result.exitCode, output: result.output }
  }
}

function createReporter(options: RunGatesOptions, logRoot: string): WorkReporterHandle {
  if (options.outputMode === undefined) {
    return { finish: async () => {}, handle: () => {} }
  }
  return WorkReporter.create({ lane: options.lane ?? DEFAULT_LANE, logRoot, mode: options.outputMode })
}
