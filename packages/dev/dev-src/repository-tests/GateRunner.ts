import { Repo, Time } from '@shared'
import { ContentionRetry } from './ContentionRetry'
import { GateCatalog } from './GateCatalog'
import { GreenTree, type GreenTreeMatch } from './GreenTree'
import { type ContentionReport, type MachineLane, MachineLanes } from './MachineLanes'
import { RunArtifacts } from './RunArtifacts'
import { buildSummary, type GateSummary, skippedResult } from './RunSummary'
import { RunTimings } from './RunTimings'
import { type WorkCommand, WorkGraph, type WorkOutcome, type WorkRunContext, type WorkState } from './WorkGraph'
import { type OutputMode, WorkReporter, type WorkReporterHandle } from './WorkReporter'

/**
 * `check` and `verify` run several gates at once. This turns a lane's gate names into work-graph
 * nodes, runs them through the one scheduler, and leaves the same trail every lane leaves: per-gate
 * logs, a versioned summary, and one rollup naming every gate, its status and cost, where its log
 * is, and the first failure worth acting on.
 *
 * The Justfile still decides which gates belong to which lane; this owns only how they run and how
 * the result is reported. `GateCatalog` supplies each name's scheduling shape and, where a gate is
 * not simply its recipe, its command, so a lane is one list of names and nothing here has to know
 * what any of them do.
 */

export type RunGatesOptions = {
  /** Gate recipe names, in the order the Justfile declared them. */
  gates: readonly string[]
  /**
   * Skip the run when this tree is already proved green. The first lane is the name this run
   * records its own green tree under; every lane listed is accepted as proof, so list only this
   * lane and lanes whose gate membership contains it. Absent, no record is read or written.
   */
  greenTree?: {
    /** Ignore every record and run; the run still records its own green tree. */
    fresh?: boolean
    /** Injected by tests; defaults to hashing the Git working tree. */
    hashTree?: (repositoryRoot: string) => Promise<string>
    lanes: readonly string[]
  }
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
  runGate?: (
    name: string,
    logPath: string,
    environment: Readonly<Record<string, string>>,
    /** The command the graph resolved for the gate after admission. */
    run: WorkCommand,
  ) => Promise<{ exitCode: number; output: string }>
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
  const hashTree = options.greenTree?.hashTree ?? GreenTree.hashTree
  if (options.greenTree !== undefined && options.greenTree.fresh !== true) {
    const match = await GreenTree.find(
      location.repositoryRoot,
      await hashTree(location.repositoryRoot),
      options.greenTree.lanes,
    )
    if (match !== undefined) {
      return greenTreeSummary(options, location.lane, match, now() - startedAt)
    }
  }
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
      env: machineLane.id === undefined ? undefined : { [MachineLanes.LANE_ID_ENV_KEY]: machineLane.id },
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
  if (options.greenTree !== undefined && summary.status === 'passed' && !result.interrupted) {
    // The tree is hashed after the run because the fix gates may have rewritten it; what was
    // proved green is the tree the run left behind, which is the one the next run would see.
    await GreenTree.record(location.repositoryRoot, options.greenTree.lanes[0] ?? location.lane, {
      at: new Date().toISOString(),
      logRoot: location.logRoot,
      treeHash: await hashTree(location.repositoryRoot),
    })
  }
  return summary
}

/** greenTreeSummary is the rollup of a run that did not happen because its tree was already proved. */
function greenTreeSummary(
  options: RunGatesOptions,
  lane: string,
  match: GreenTreeMatch,
  elapsedMs: number,
): GateSummary {
  const reason = `tree unchanged since the green ${match.lane} run at ${match.at}`
  return {
    elapsedMs,
    gates: options.gates.map(name => ({ elapsedMs: 0, name, reason, status: 'skipped' })),
    greenTree: match,
    lane,
    logRoot: match.logRoot,
    status: 'passed',
    version: 2,
    warnings: [],
  }
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
): (state: WorkState, context: WorkRunContext) => Promise<WorkOutcome> {
  return async (state, context) => {
    const result = await runGate(state.name, state.logPath ?? '', context.env, context.run)
    return { exitCode: result.exitCode, output: result.output }
  }
}

function createReporter(options: RunGatesOptions, logRoot: string): WorkReporterHandle {
  if (options.outputMode === undefined) {
    return { finish: async () => {}, handle: () => {} }
  }
  return WorkReporter.create({ lane: options.lane ?? DEFAULT_LANE, logRoot, mode: options.outputMode })
}
