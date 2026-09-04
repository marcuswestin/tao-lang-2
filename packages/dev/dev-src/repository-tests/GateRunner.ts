import { Repo, Time } from '@shared'
import { ContentionRetry } from './ContentionRetry'
import { GateCatalog } from './GateCatalog'
import { type ContentionReport, type MachineLane, MachineLanes } from './MachineLanes'
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
  /** Injected CPU total for deterministic coordination tests. */
  machineCpuCount?: number
  now?: () => number
  /** How the run reports itself while it runs. Omitted, it reports nothing but the artifacts. */
  outputMode?: OutputMode
  /** Injected by tests; defaults to the machine-wide lane registry. */
  registryRoot?: string
  repositoryRoot?: string
  /** Omit gates whose catalog metadata declares a host capability the managed sandbox denies. */
  skipUnsandboxed?: boolean
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
  const runnableGates = options.skipUnsandboxed === true
    ? options.gates.filter(name => GateCatalog.metadata(name).requiresUnsandboxed !== true)
    : [...options.gates]
  const unsandboxedSkips = options.skipUnsandboxed === true
    ? options.gates
      .filter(name => GateCatalog.metadata(name).requiresUnsandboxed === true)
      .map(name => `${name}=requires unsandboxed host capabilities; run just full-verify outside the sandbox`)
    : []
  const declaredSkips = [...options.skipped ?? [], ...unsandboxedSkips]
    .map(skippedResult)
    .filter(result => !runnableGates.includes(result.name))
    .filter((result, index, results) => results.findIndex(candidate => candidate.name === result.name) === index)

  const states = runnableGates.map(name => WorkGraph.createState(GateCatalog.node(name, location.repositoryRoot)))
  await RunArtifacts.assignLogPaths(states, location)
  const timings = await RunTimings.load({ repositoryRoot: location.repositoryRoot })
  const expectedMs = (name: string) => RunTimings.expectedMs(timings, name)
  const reporter = createReporter(options, location.logRoot)
  // Every worktree on this machine reserves against the same CPUs. Registration establishes this
  // lane's ceiling; the broker recomputes its fair share at every node admission.
  const machineLane = await MachineLanes.acquire({
    lane: location.lane,
    cpuCount: options.machineCpuCount,
    registryRoot: options.registryRoot,
    repositoryRoot: location.repositoryRoot,
    requestedJobs: options.jobs,
  })

  const runNode = options.runGate === undefined ? undefined : injectedRunner(options.runGate)
  const { contention, result } = await runUnderLane(async () => {
    const runResult = await WorkGraph.run(states, {
      expectedMs,
      jobs: machineLane.ceiling,
      onEvent: event => reporter.handle(event),
      runNode,
      slotBroker: machineLane,
    })
    await reporter.finish()
    if (!runResult.interrupted) {
      // A contended timeout is a claim about this machine, and one isolated re-run is what settles it.
      await ContentionRetry.confirmContendedFailures({
        contention: machineLane.report(),
        location,
        machineLane,
        runNode,
        states,
      })
    }
    return runResult
  }, machineLane)

  const summary = buildSummary({
    contention,
    declaredSkips,
    elapsedMs: now() - startedAt,
    expectedMs,
    interrupted: result.interrupted,
    lane: location.lane,
    logRoot: location.logRoot,
    order: runnableGates,
    states,
  })
  await RunArtifacts.finishRun({ location, recordTimings: !contention.contended, states, summary })
  if (options.jsonPath !== undefined) {
    await RunArtifacts.writeSummaryCopy(options.jsonPath, location.repositoryRoot, summary)
  }
  return summary
}

/** runUnderLane runs one lane's work and releases its machine registration however that ends. */
async function runUnderLane<T>(
  work: () => Promise<T>,
  machineLane: MachineLane,
): Promise<{ contention: ContentionReport; result: T }> {
  try {
    // The report is read after the work, not beside it: its whole value is what the machine did
    // while the lane ran.
    const result = await work()
    return { contention: machineLane.report(), result }
  } finally {
    await machineLane.release()
  }
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
