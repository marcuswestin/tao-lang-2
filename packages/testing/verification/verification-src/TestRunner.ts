import * as Shared from '@shared'
import { ContentionRetry } from './ContentionRetry'
import { FlakeTolerance } from './FlakeTolerance'
import { GateCatalog } from './GateCatalog'
import { type MachineLane, MachineLanes } from './MachineLanes'
import { PackageGraph } from './PackageGraph'
import { RunArtifacts } from './RunArtifacts'
import { buildSummary, formatVerdict, gateExitCode, toleranceWarnings } from './RunSummary'
import { RunTimings, type TimingsStore } from './RunTimings'
import { TaoAppSharedRun } from './TaoAppSharedRun'
import { TestAdvisory } from './TestAdvisory'
import { type TestFile, TestLedger, type TestLedgerStore, type TestObservation } from './TestLedger'
import { type SelectedSuite, TestNodes, type TestNodeState, type TestProcess } from './TestNodes'
import { type NativeTestReport, TestReport } from './TestReport'
import { TestResultSummary } from './TestResultSummary'
import { type ChangedPlan, type ChangedSelection, type SuiteInventory, TestSelection } from './TestSelection'
import type { ShardPlan } from './TestShards'
import { WorkGraph, type WorkState } from './WorkGraph'
import { type OutputMode, WorkReporter } from './WorkReporter'
import { WorkSchedule } from './WorkSchedule'

/** SuiteStatus declares the lifecycle state of one test suite process. */
export type SuiteStatus = WorkState['status']

/** SuiteState tracks one test node's process output, status, and the observations it produced. */
export type SuiteState = TestNodeState & {
  testObservations?: readonly TestObservation[]
}

/** TestRunOptions configures one dev test runner invocation. */
export type TestRunOptions = {
  jobs?: number
  outputMode?: OutputMode
  /** Override the machine-wide registry, principally to isolate concurrent tests. */
  registryRoot?: string
  repositoryRoot?: string
}

/**
 * TestRunRequest is one run of the test lane, in two independent parts: the scope that chooses which
 * suites run, and an optional test-name pattern filtered over whatever that scope chose. They
 * compose rather than exclude each other, which is what `just test "<name>"` means — the suites this
 * branch's diff reaches, filtered to the tests matching that name. A pattern therefore only ever
 * narrows a run; it never widens one back out to every suite.
 */
export type TestRunRequest =
  & { pattern?: string }
  & (
    | { kind: 'changed'; reference?: string }
    | { kind: 'file'; path: string }
    | { kind: 'full' }
    | { kind: 'retry' }
  )

type PreparedRun = {
  changed?: ChangedSelection
  files?: readonly TestFile[]
  kind: TestRunRequest['kind']
  pattern: string
  /** The suites a changed-files run chose and why; absent for every other kind. */
  plan?: ChangedPlan
  retryGreenTestCount?: number
  retryStamp?: string
}

/**
 * SuiteSelection is what one run asks of the suite registry: the scope that chose the suites, and
 * the test-name filter applied inside them. The two are separate fields because they are separate
 * questions — a changed-scope run can carry a pattern, and every source filters by name inside
 * whatever scope chose it.
 */
export type SuiteSelection = {
  kind: TestRunRequest['kind']
  /** Test-name pattern; empty selects every test. */
  pattern: string
  /**
   * Files by suite when the run names them exactly — a retry ledger, a `test-file` path, or the
   * app roots a changed plan chose. A suite absent here runs everything it owns.
   */
  files?: ReadonlyMap<string, readonly string[]>
  /** Suites to run; absent means every source that serves the run's kind. */
  suites?: ReadonlySet<string>
}

/** SuiteBuildContext is what a run hands every source that builds a process. */
type SuiteBuildContext = {
  /** Where native runner reports go; absent, the runner prints a summary instead. */
  reportRoot?: string
}

/**
 * SuiteProcessContext is what one node asks of its source: the node's own name, so its report file
 * is its own and two shards cannot overwrite each other's results, and the width the graph granted
 * it, so a runner that would otherwise size itself to the machine is held to the reservation.
 */
type SuiteProcessContext = SuiteBuildContext & {
  nodeName: string
  slots: number
}

/**
 * SuiteSource is one registry entry: a suite, the files it owns in this checkout, the process that
 * runs a selection of them, and how the graph weighs it. Every way a run chooses suites — the
 * complete run, a name pattern, an exact file, the changed-files plan, the retry ledger — is a
 * filter over this registry, so nothing outside it knows which suites exist.
 */
type SuiteSource = {
  name: string
  /** Repository-relative files the source owns; `Apps` stands for every Tao behavior test. */
  files: readonly string[]
  /** The package whose `<name>-tests` directory the source runs, when it is one. */
  package?: string
  /** Turns any subset of this source's files, or of its `shardUnits`, into the process that runs them. */
  build: (files: readonly string[], selection: SuiteSelection, context: SuiteProcessContext) => TestProcess
  /**
   * What one process of this source can be asked to run, when that is not its files. Sharding splits
   * these; the retry ledger and the suite inventory keep `files`. A run that names files exactly —
   * a retry, an exact path, a changed plan's app roots — ignores these and uses what it was given.
   */
  shardUnits?: readonly string[]
  /** Relative cost per unit, for units the ledger cannot time because it keys the suite as one. */
  unitCostMs?: ReadonlyMap<string, number>
}

/** SuiteSelectionResult is what the registry produced for one run: suites, and what it left out and why. */
type SuiteSelectionResult = {
  /** Suites this run will schedule, each able to build a process for any subset of its files. */
  selected: SelectedSuite[]
}

const LANE = 'dev-test'
/** How much of a failing suite's output a quiet run repeats; the whole of it is in the log file. */
const QUIET_FAILURE_OUTPUT_LINES = 40
const PERFORMANCE_CHECKS = 'performance-checks'
const PERFORMANCE_CHECK_FILE = 'packages/cli/dev-cli/performance-checks/language-performance.test.ts'
const RUNTIME_JEST = 'runtime-jest'
const RUNTIME_JEST_TESTS = 'packages/apps/expo-host/expo-host-tests'
const TAO_APPS = 'tao-apps'

/**
 * suiteRegistry lists every suite this checkout can run, in discovery order: one Bun suite per
 * package with a `<name>-tests` directory, the language performance checks, the runtime Jest
 * suite, and the Tao behavior tests. A source with nothing to run is not listed.
 */
async function suiteRegistry(repositoryRoot = Shared.Repo.getRoot()): Promise<SuiteSource[]> {
  const [byPackage, jestFiles, taoAppUnits] = await Promise.all([
    packageTestFilesByPackage(repositoryRoot),
    runtimeJestTestFiles(repositoryRoot),
    taoAppShardUnits(repositoryRoot),
  ])
  const sources: SuiteSource[] = [
    ...[...byPackage].map(([name, files]): SuiteSource => ({
      build: (selected, selection, context) => bunSuite(name, selected, selection.pattern, context, repositoryRoot),
      files,
      name,
      package: name,
    })),
    {
      build: (selected, selection, context) =>
        bunSuite(PERFORMANCE_CHECKS, selected, selection.pattern, context, repositoryRoot),
      files: [PERFORMANCE_CHECK_FILE],
      name: PERFORMANCE_CHECKS,
    },
    {
      build: (selected, selection, context) => runtimeJestSuite(selected, selection.pattern, context, repositoryRoot),
      files: jestFiles,
      name: RUNTIME_JEST,
    },
    {
      build: (roots, selection) => taoAppsSuite(roots, selection.pattern, repositoryRoot),
      files: [TestSelection.ALL_APPS],
      name: TAO_APPS,
      // `./tao test` takes app roots, so the roots are what its shards can be split across. The
      // ledger still keys the suite as the one synthetic `Apps` unit whose identity it can hash.
      shardUnits: [...taoAppUnits.keys()],
      unitCostMs: taoAppUnits,
    },
  ]
  return sources.filter(source => source.files.length > 0)
}

/** selectSuites is the one filter over the registry: which sources run, over which files. */
function selectSuites(
  registry: readonly SuiteSource[],
  selection: SuiteSelection,
  context: SuiteBuildContext = {},
): SuiteSelectionResult {
  const result: SuiteSelectionResult = { selected: [] }
  for (const source of registry) {
    if (selection.suites !== undefined && !selection.suites.has(source.name)) {
      continue
    }
    const files = selection.files?.get(source.name) ?? source.files
    if (files.length > 0) {
      const shardUnits = source.shardUnits === undefined || selection.files?.has(source.name) === true
        ? undefined
        : source.shardUnits
      result.selected.push({
        buildProcess: (nodeName, nodeUnits, slots) =>
          source.build(nodeUnits, selection, { ...context, nodeName, slots }),
        files,
        name: source.name,
        ...(shardUnits === undefined ? {} : { shardUnits }),
        ...(shardUnits === undefined || source.unitCostMs === undefined ? {} : { unitCostMs: source.unitCostMs }),
      })
    }
  }
  return result
}

/** discoverTestSuites answers one selection from this checkout's registry. */
async function discoverTestSuites(
  selection: Partial<SuiteSelection> = {},
  context: SuiteBuildContext = {},
  repositoryRoot = Shared.Repo.getRoot(),
): Promise<SuiteSelectionResult> {
  return selectSuites(
    await suiteRegistry(repositoryRoot),
    { kind: 'full', ...selection, pattern: selection.pattern ?? '' },
    context,
  )
}

/** suiteInventory names every suite a complete run would execute, in discovery order. */
async function suiteInventory(repositoryRoot = Shared.Repo.getRoot()): Promise<SuiteInventory> {
  const registry = await suiteRegistry(repositoryRoot)
  const listed = (name: string) => registry.some(source => source.name === name)
  return {
    hasPerformanceChecks: listed(PERFORMANCE_CHECKS),
    hasRuntimeJest: listed(RUNTIME_JEST),
    hasTaoApps: listed(TAO_APPS),
    packageSuites: registry.flatMap(source => source.package === undefined ? [] : [source.package]),
  }
}

/**
 * selectionFor states a prepared run as a registry selection: a changed plan names its suites and
 * the app roots it chose, a retry or exact-file run names its files and thereby its suites.
 */
function selectionFor(prepared: PreparedRun): SuiteSelection {
  const files = prepared.files === undefined ? undefined : filesBySuite(prepared.files)
  const appRoots = prepared.plan?.taoAppPaths
  return {
    files: appRoots === undefined ? files : new Map([...files ?? [], [TAO_APPS, appRoots]]),
    kind: prepared.kind,
    pattern: prepared.pattern,
    suites: prepared.plan !== undefined
      ? new Set(prepared.plan.selected.keys())
      : files === undefined
      ? undefined
      : new Set(files.keys()),
  }
}

function filesBySuite(files: readonly TestFile[]): Map<string, readonly string[]> {
  const result = new Map<string, string[]>()
  for (const file of files) {
    result.set(file.suite, [...result.get(file.suite) ?? [], file.file])
  }
  return result
}

/**
 * testNodesFor turns one prepared run into the nodes that will run it. It is the seam the gate lanes
 * use too: `_test` and `_test-changed` in a lane's list expand through here, so the suites a
 * verification run schedules and the suites `./dev test` schedules are the same nodes built the same
 * way, rather than two selections that can drift.
 */
async function testNodesFor(options: {
  ledger?: TestLedgerStore
  prepared: PreparedRun
  proved?: ReadonlySet<string>
  reportRoot?: string
  repositoryRoot: string
  timings?: TimingsStore
}): Promise<{ plans: readonly ShardPlan[]; states: SuiteState[]; warnings: readonly string[] }> {
  const { selected } = selectSuites(
    await suiteRegistry(options.repositoryRoot),
    selectionFor(options.prepared),
    { reportRoot: options.reportRoot },
  )
  const [ledger, timings] = await Promise.all([
    options.ledger === undefined ? TestLedger.load(options.repositoryRoot) : Promise.resolve(options.ledger),
    options.timings === undefined
      ? RunTimings.load({ repositoryRoot: options.repositoryRoot })
      : Promise.resolve(options.timings),
  ])
  const plan = TestNodes.build({ ledger, proved: options.proved, selected, timings })
  return { plans: plan.plans, states: plan.states as SuiteState[], warnings: plan.warnings }
}

/** runTests discovers, runs, reports, and records one `./dev test` invocation: every suite, optionally name-filtered. */
async function runTests(pattern = '', options: TestRunOptions = {}): Promise<number> {
  return runTestRequest({ kind: 'full', pattern }, options)
}

/** runChangedTests runs the suites the diff reaches, optionally filtered to the tests matching a name. */
async function runChangedTests(reference?: string, pattern = '', options: TestRunOptions = {}): Promise<number> {
  return runTestRequest({ kind: 'changed', pattern, reference }, options)
}

async function runTestFile(path: string, options: TestRunOptions = {}): Promise<number> {
  return runTestRequest({ kind: 'file', path }, options)
}

async function runRetryTests(options: TestRunOptions = {}): Promise<number> {
  return runTestRequest({ kind: 'retry' }, options)
}

async function printFlakes(limit = 20, repositoryRoot = Shared.Repo.getRoot()): Promise<number> {
  const flakes = await TestLedger.flakes(repositoryRoot, limit)
  if (flakes.length === 0) {
    Shared.HCI.writeSuccess('No unchanged-file outcome reversals recorded.')
    return 0
  }
  Shared.HCI.writeLine('Suspected flaky tests:')
  for (const flake of flakes) {
    Shared.HCI.writeLine(`- ${flake.id}: ${flake.reversals} reversal${flake.reversals === 1 ? '' : 's'}`)
  }
  Shared.HCI.writeLine('Confirm a Bun test with: bun test <file> --rerun-each=3')
  return 0
}

async function printSlowest(limit = 20, repositoryRoot = Shared.Repo.getRoot()): Promise<number> {
  // Requested oversized and filtered here, rather than trusting the ledger's own `durationMs`
  // absence to have kept every `--concurrent` record out: `observationsFor` stops feeding the ledger
  // new per-case numbers for those suites, but a record it wrote before this change keeps its old
  // one — nothing overwrites a duration with "no new data" (see the comment there). This is the one
  // place a reader could still see a stale, meaningless-from-the-start number, so it filters by
  // suite rather than by the field the ledger could not retroactively clear.
  const records = (await TestLedger.slowest(repositoryRoot, Number.MAX_SAFE_INTEGER))
    .filter(record => !isConcurrentSuite(record.suite))
    .slice(0, Number.isInteger(limit) && limit > 0 ? limit : 20)
  if (records.length === 0) {
    Shared.HCI.writeLine('No per-test timings recorded yet; run ./agent test first.')
    return 0
  }
  Shared.HCI.writeLine('Slowest tests:')
  for (const record of records) {
    Shared.HCI.writeLine(`- ${record.durationMs?.toFixed(1)}ms ${record.id}`)
  }
  return 0
}

async function runTestRequest(request: TestRunRequest, options: TestRunOptions = {}): Promise<number> {
  const startedAt = Date.now()
  const repositoryRoot = options.repositoryRoot ?? Shared.Repo.getRoot()
  const prepared = await prepareRun(request, repositoryRoot)
  if (prepared.kind === 'retry' && prepared.files?.length === 0) {
    const stamp = prepared.retryStamp ?? 'the latest full run'
    printRetryHonesty(prepared)
    Shared.HCI.writeSuccess(`Nothing to retry — every test is green as of ${stamp}.`)
    await printAdvisory(prepared, await TestLedger.load(repositoryRoot))
    return 0
  }
  const location = RunArtifacts.locate({ lane: LANE, repositoryRoot })
  // `./dev test` is always a top-level lane now: a verification run schedules the same suite nodes
  // in its own graph rather than starting this command inside itself, so there is no nested runner
  // left to hand a divided budget to.
  const machineLane = await MachineLanes.acquire({
    lane: LANE,
    registryRoot: options.registryRoot,
    repositoryRoot: location.repositoryRoot,
    requestedJobs: options.jobs,
  })
  try {
    return await runSuites({ location, machineLane, mode: options.outputMode, prepared, startedAt })
  } finally {
    await machineLane.release()
  }
}

type RunSuitesOptions = {
  location: ReturnType<typeof RunArtifacts.locate>
  machineLane: MachineLane
  mode?: OutputMode
  prepared: PreparedRun
  startedAt: number
}

async function runSuites(options: RunSuitesOptions): Promise<number> {
  const { location, machineLane, prepared } = options
  const reportRoot = Shared.FS.resolvePath('test-results', location.logRoot)
  await Shared.FS.mkdir(reportRoot)
  const { plans, states } = await testNodesFor({
    prepared,
    reportRoot,
    repositoryRoot: location.repositoryRoot,
  })
  printSelection(prepared, states, plans)
  if (states.length === 0) {
    if (prepared.kind === 'changed') {
      Shared.HCI.writeSuccess('No suite observes the changed paths; nothing to run.')
      await printAdvisory(prepared, await TestLedger.load(location.repositoryRoot))
      return 0
    }
    Shared.HCI.writeLine('No test suites found.')
    return 1
  }

  const mode = options.mode ?? WorkReporter.resolveMode()
  const graphStates = TaoAppSharedRun.attach(states, location.logRoot, location.repositoryRoot)
  await RunArtifacts.assignLogPaths(graphStates, location)
  const timings = await RunTimings.load({ repositoryRoot: location.repositoryRoot })
  const expectedMs = (name: string) => RunTimings.expectedMs(timings, name)
  const reporter = WorkReporter.create({ lane: LANE, logRoot: location.logRoot, mode })
  const liveArtifacts = RunArtifacts.liveWriter(location, event => reporter.handle(event))

  const result = await WorkGraph.run(graphStates, {
    expectedMs,
    jobs: machineLane.ceiling,
    onEvent: event => liveArtifacts.handle(event),
    slotBroker: machineLane,
  })
  await liveArtifacts.finish()
  await reporter.finish()
  if (!result.interrupted) {
    await ContentionRetry.confirmContendedFailures({
      contention: machineLane.report(),
      location,
      machineLane,
      states: graphStates,
    })
  }

  const observations = await observationsFor(states, location.repositoryRoot)
  const zeroMatch = noTestsMatched(prepared.pattern, observations, states)
  if (zeroMatch) {
    const state = states[0]!
    state.status = 'failed'
    state.exitCode = 1
    state.reason = `no tests matched name pattern: ${prepared.pattern}`
    state.fullOutput += `\nNo tests matched name pattern: ${prepared.pattern}\n`
  }
  // The same demotion the verification lanes apply, on the same evidence: a node whose every
  // failing test the ledger has already watched flip without its file changing stops failing this
  // run. `just test` and `just verify` schedule the same suite nodes, so a flake that does not fail
  // one must not fail the other — otherwise which command you happened to type decides the verdict.
  //
  // Judged against the history as it stood before this run, which is where the gate lane judges it
  // too. Recording first would count this run's own failure toward the consecutive-failure limit
  // and withdraw a tolerance one run earlier here than there, which is the disagreement this exists
  // to remove. An interrupted run tolerates nothing: it did not finish, so its failures weigh
  // nothing. The states stay `failed`, exactly as in the gate lanes — the summary is the one place a
  // verdict is decided, which is why the exit code below is taken from it.
  const tolerance = result.interrupted
    ? FlakeTolerance.empty()
    : FlakeTolerance.apply(states, await TestLedger.tolerated(location.repositoryRoot))
  const toleratedFlakes = tolerance.demoted.map(flake => ({
    evidence: flake.evidence,
    file: flake.file,
    id: flake.id,
    node: flake.node,
  }))
  const ledger = result.interrupted
    ? await TestLedger.load(location.repositoryRoot)
    : await TestLedger.recordRun({
      fullRun: completeRun(prepared),
      observations,
      partialFiles: partialTaoAppRun(prepared) ? ['Apps'] : undefined,
      repositoryRoot: location.repositoryRoot,
      startedAt: options.startedAt,
    })

  const elapsedMs = Date.now() - options.startedAt
  const contention = machineLane.report()
  const summary = buildSummary({
    contention,
    elapsedMs,
    expectedMs,
    interrupted: result.interrupted,
    lane: LANE,
    logRoot: location.logRoot,
    schedule: WorkSchedule.report(result),
    states: graphStates,
    suiteOf: name => states.find(state => state.name === name)?.suite,
    toleratedFlakes,
  })
  const summaryPath = await RunArtifacts.finishRun({
    cpuOnly: contention.contended,
    location,
    extraDurations: TestNodes.suiteDurations(states),
    recordTimings: completeRun(prepared),
    states: graphStates,
    summary,
  })
  TestResultSummary.printResultSummary(states, elapsedMs, {
    contention,
    // A dashboard scrolled the failure away; a quiet run never showed it. Both need it repeated,
    // and an agent reading a pipe needs it short enough to act on.
    includeFailureOutput: mode !== 'lines',
    failureOutputLineLimit: mode === 'quiet' ? QUIET_FAILURE_OUTPUT_LINES : undefined,
  })
  if (prepared.kind === 'retry') {
    printRetryHonesty(prepared)
  }
  await printAdvisory(prepared, ledger)
  // A demoted failure is still a failure; it just is not this branch's. The names and the recorded
  // history that bought the pass belong on the terminal, not only in `summary.json` — a gate lane
  // gets them free from `formatGateSummary`, and this lane prints no such rollup. Only these
  // warnings: the rest of `summary.warnings` is contention, which the result summary above has
  // already reported in its own words.
  for (const warning of toleranceWarnings(toleratedFlakes)) {
    Shared.HCI.writeLine(`! ${warning}`)
  }
  Shared.HCI.writeLine(`Summary: ${Shared.FS.displayPath(summaryPath)}`)
  Shared.HCI.writeLine(formatVerdict(summary, { color: WorkReporter.colorizes(mode) }))
  // The summary is the one place a verdict is decided. Reading the exit code off the node states
  // instead would re-fail every node the tolerance above demoted, which deliberately leaves them
  // `failed` so that nothing records them green.
  return gateExitCode(summary)
}

/**
 * completeRun says whether this run observed every test there is, which is what the retry ledger and
 * the timings store may stand on. A pattern disqualifies a full-scope run from both: it scheduled
 * every suite but skipped most of the tests inside them, so it can neither say a test is green nor
 * say what a suite costs.
 */
function completeRun(prepared: PreparedRun): boolean {
  return prepared.kind === 'full' && prepared.pattern.length === 0
}

function partialTaoAppRun(prepared: PreparedRun): boolean {
  const roots = prepared.plan?.taoAppPaths
  return roots !== undefined && !(roots.length === 1 && roots[0] === TestSelection.ALL_APPS)
}

async function prepareRun(request: TestRunRequest, repositoryRoot: string): Promise<PreparedRun> {
  // The pattern rides along every scope: it filters the tests inside whatever suites the scope chose.
  const pattern = request.pattern ?? ''
  if (request.kind === 'full') {
    return { kind: 'full', pattern }
  }
  if (request.kind === 'file') {
    return { files: await testFilesAt(request.path, repositoryRoot), kind: 'file', pattern }
  }

  if (request.kind === 'changed') {
    const changed = await TestSelection.changedSelection(request.reference, repositoryRoot)
    const [graph, inventory] = await Promise.all([PackageGraph.load(repositoryRoot), suiteInventory(repositoryRoot)])
    const plan = TestSelection.planChangedSuites(changed.changedPaths, graph, inventory)
    return { changed, kind: 'changed', pattern, plan: await withExistingAppRoots(plan, repositoryRoot) }
  }
  const changed = await TestSelection.changedSelection(undefined, repositoryRoot)
  const retry = await TestLedger.selectRetryFiles(await allTestFiles(repositoryRoot), repositoryRoot)
  return {
    changed,
    files: retry.files,
    kind: 'retry',
    pattern,
    retryGreenTestCount: retry.greenTestCount,
    retryStamp: retry.lastFullRunStartedAt,
  }
}

/**
 * withExistingAppRoots drops app roots the diff names but the tree no longer has, such as a deleted
 * app, so `./tao test` is not asked for a path that does not exist.
 */
async function withExistingAppRoots(plan: ChangedPlan, repositoryRoot: string): Promise<ChangedPlan> {
  if (plan.taoAppPaths === undefined) {
    return plan
  }
  const existing: string[] = []
  for (const root of plan.taoAppPaths) {
    const absolute = Shared.FS.resolvePath(root, repositoryRoot)
    if (await Shared.FS.isDirectory(absolute) || await Shared.FS.isFile(absolute)) {
      existing.push(root)
    }
  }
  if (existing.length === plan.taoAppPaths.length) {
    return plan
  }
  if (existing.length > 0) {
    return { ...plan, taoAppPaths: existing }
  }
  const selected = new Map(plan.selected)
  selected.delete(TAO_APPS)
  return { ...plan, selected, skipped: [...plan.skipped, TAO_APPS], taoAppPaths: undefined }
}

/**
 * isConcurrentSuite reports whether a suite's tests run under Bun's `--concurrent`, which is also
 * where a per-case duration stops meaning what it says: `TestRunner.deadlineFor` documents that Bun
 * then reports every test's duration as the time from the file's shared start to its own completion,
 * not the test's own work. `observationsFor` reads this to decide which suites' per-case numbers are
 * worth recording at all, so the distinction is made once, by name, rather than inferred later from
 * whatever pattern the corrupted numbers happen to leave in the ledger.
 */
function isConcurrentSuite(suite: string): boolean {
  return (GateCatalog.suiteTuning(suite).args ?? []).includes('--concurrent')
}

async function observationsFor(states: readonly SuiteState[], repositoryRoot: string): Promise<TestObservation[]> {
  const observations: TestObservation[] = []
  for (const state of states) {
    state.testObservations = state.suite === TAO_APPS
      ? [{
        durationMs: state.elapsedMs,
        file: 'Apps',
        // A partial app run is recorded under its own name, so it can never stand in for the
        // complete inventory the retry ledger keys on.
        name: taoAppsObservationName(state.selectedTestFiles ?? []),
        outcome: taoAppsOutcome(state),
        suite: state.suite,
      }]
      : state.testReport === undefined
      ? undefined
      : await TestReport.read(state.testReport, repositoryRoot)
    // A concurrent suite's own per-case numbers are not its tests' durations (see
    // `isConcurrentSuite`), so they are dropped at the one place every source — the ledger, the
    // shard packer, `report-test-stats` — reads from. A suite whose tests run one at a time keeps
    // its numbers exactly as the reporter wrote them: the distinction is explicit here rather than
    // left for a reader to notice in a "6202.7, 6202.6, 6202.5…" pattern.
    if (state.testObservations !== undefined && isConcurrentSuite(state.suite)) {
      state.testObservations = state.testObservations.map(observation => ({ ...observation, durationMs: undefined }))
    }
    if (state.testReport !== undefined && state.testObservations === undefined && state.status === 'passed') {
      state.status = 'failed'
      state.exitCode = 1
      state.reason = `test result report unavailable: ${Shared.FS.displayPath(state.testReport.path)}`
      state.failure = { kind: 'process-error', message: state.reason }
      state.fullOutput += `${
        state.fullOutput.endsWith('\n') || state.fullOutput.length === 0 ? '' : '\n'
      }${state.reason}\n`
    }
    if ((state.testObservations?.length ?? 0) === 0 && state.status === 'failed') {
      state.testObservations = (state.selectedTestFiles ?? []).map(file => ({
        durationMs: state.elapsedMs,
        file,
        name: FlakeTolerance.PROCESS_STAND_IN_NAME,
        outcome: 'failed',
        suite: state.suite,
      }))
    }
    observations.push(...state.testObservations ?? [])
  }
  return observations
}

function printSelection(
  prepared: PreparedRun,
  states: readonly SuiteState[],
  plans: readonly ShardPlan[],
): void {
  // A scope that narrowed the suites says which ones and why; a pattern says what it filtered them
  // to. A run carrying both prints both lines, because either one alone overstates what ran.
  const narrowedScope = prepared.kind === 'changed' || prepared.kind === 'file' || prepared.kind === 'retry'
  if (!narrowedScope && prepared.pattern.length === 0) {
    return
  }
  Shared.HCI.writeLine('\nTest selection:')
  if (prepared.pattern.length > 0) {
    Shared.HCI.writeLine(`- filtered to tests matching "${prepared.pattern}"`)
  }
  if (!narrowedScope) {
    return
  }
  if (prepared.kind === 'changed') {
    const paths = prepared.changed?.changedPaths ?? []
    Shared.HCI.writeLine(
      `- ${paths.length} changed path${paths.length === 1 ? '' : 's'} since ${
        prepared.changed?.reference.slice(0, 12)
      }`,
    )
  }
  for (const suite of [...new Set(states.map(state => state.suite))]) {
    const details = prepared.kind === 'changed'
      ? prepared.plan?.selected.get(suite) ?? 'selected'
      : prepared.kind === 'file'
      ? 'exact requested file'
      : 'contains an unsettled or unrecorded test'
    const files = states.filter(state => state.suite === suite).flatMap(state => state.selectedTestFiles ?? [])
    const roots = suite === TAO_APPS && prepared.kind === 'changed' ? ` (${files.join(', ')})` : ''
    Shared.HCI.writeLine(`- selected ${suite}: ${details}${roots}`)
  }
  for (const line of TestNodes.describePlans(plans)) {
    Shared.HCI.writeLine(line)
  }
  const skipped = prepared.plan?.skipped ?? []
  if (skipped.length > 0) {
    Shared.HCI.writeLine(
      `- skipped ${skipped.length} suite${skipped.length === 1 ? '' : 's'} nothing changed reaches: ${
        skipped.join(', ')
      }`,
    )
  }
}

/**
 * taoAppsOutcome reads the one suite that reports nothing per test. The stand-in observation it
 * gets is the whole of what the union-of-observations guard below sees from the Tao behavior
 * suite, so recording it `passed` on a zero exit alone told that guard a test had run whenever the
 * suite was scheduled — and `tao test` is handed `--pass-with-no-tests` precisely so that it exits
 * zero on an empty `--name` selection. The guard could then never fire, and a typo in
 * `just test "<name>"` ran nothing anywhere and reported green.
 *
 * A run that says it matched no journey is `skipped`, which is what every other suite's reporter
 * says about the same situation.
 */
function taoAppsOutcome(state: SuiteState): TestObservation['outcome'] {
  if (state.status === 'failed') {
    return 'failed'
  }
  if (state.status !== 'passed' || Shared.TaoTestProtocol.ranNoJourneys(state.fullOutput)) {
    return 'skipped'
  }
  return 'passed'
}

function taoAppsObservationName(roots: readonly string[]): string {
  return roots.length === 0 || (roots.length === 1 && roots[0] === TestSelection.ALL_APPS)
    ? 'all Tao behavior tests'
    : `Tao behavior tests under ${roots.join(', ')}`
}

function printRetryHonesty(prepared: PreparedRun): void {
  const stamp = prepared.retryStamp ?? 'no recorded full run (cold checkout)'
  Shared.HCI.writeLine(
    `skipping ${prepared.retryGreenTestCount ?? 0} tests green as of ${stamp} — run './agent test' before merging.`,
  )
}

async function printAdvisory(prepared: PreparedRun, ledger: TestLedgerStore): Promise<void> {
  if ((prepared.kind !== 'changed' && prepared.kind !== 'retry') || prepared.changed === undefined) {
    return
  }
  const advisory = TestAdvisory.line(prepared.changed, ledger)
  if (advisory !== undefined) {
    Shared.HCI.writeLine(advisory)
  }
}

/** allTestFiles is the registry as the retry ledger keys it: every file, under the suite that owns it. */
async function allTestFiles(repositoryRoot: string): Promise<TestFile[]> {
  const registry = await suiteRegistry(repositoryRoot)
  return registry
    .flatMap(source => source.files.map(file => ({ file, suite: source.name })))
    .sort((left, right) => `${left.suite}:${left.file}`.localeCompare(`${right.suite}:${right.file}`))
}

/**
 * taoAppShardUnits lists the directories holding Tao behavior tests, which is what one `./tao test`
 * process can be handed, against the relative cost of each. Each directory stays whole: `tao test`
 * groups its files onto one compiler worker so they share a workspace, and splitting a directory
 * would build that workspace twice. The ledger keys this whole suite as one synthetic `Apps` unit,
 * so it can say what the suite costs but nothing about how that cost divides, and the balancer needs
 * a proxy.
 *
 * The proxy is the size of the Tao source under each unit, because compiling it is what the time
 * goes on: the shard carrying WordFlower measured 51.3s while its Jest pass was the shortest of the
 * three at 6.6s. Counting journeys instead — one weight per `.test.tao` file — reads WordFlower's
 * 2,462 lines as lighter than Navigation's 819, which is how they ended up packed into the same
 * 51.3s shard beside four more apps while seven small apps finished together in 14.2s. Size is still
 * a proxy: it says nothing about how long the journeys themselves run, which is the smaller term.
 */
async function taoAppShardUnits(repositoryRoot: string): Promise<Map<string, number>> {
  const appsRoot = Shared.FS.resolvePath('Apps', repositoryRoot)
  const taoFiles = await Shared.Repo.filesUnder(appsRoot, { extensions: ['.tao'] })
  const units = new Set<string>()
  for (const path of taoFiles) {
    if (path.endsWith('.test.tao')) {
      units.add(repositoryRelative(Shared.FS.dirname(path), repositoryRoot))
    }
  }
  // An app's own sources sit beside and beneath its journeys — WordFlower's `@ui`, `@data` and
  // `@nav` are compiled with it — so a file counts toward the deepest unit that contains it. Sizes
  // are gathered before any of them are summed: accumulating inside the concurrent read would read
  // each unit's running total before its own `await` and lose every addition but the last.
  const sized = await Promise.all(taoFiles.map(async path => ({
    length: (await Shared.FS.readText(path)).length,
    owner: owningShardUnit(repositoryRelative(path, repositoryRoot), units),
  })))
  const costs = new Map<string, number>([...units].map(unit => [unit, 0]))
  for (const { length, owner } of sized) {
    if (owner !== undefined) {
      costs.set(owner, (costs.get(owner) ?? 0) + length)
    }
  }
  return new Map([...costs].toSorted(([left], [right]) => left.localeCompare(right)))
}

/** owningShardUnit attributes one file to the deepest shard-unit directory that contains it. */
function owningShardUnit(file: string, units: ReadonlySet<string>): string | undefined {
  let owner: string | undefined
  for (const unit of units) {
    const contained = file === unit || file.startsWith(`${unit}/`)
    if (contained && (owner === undefined || unit.length > owner.length)) {
      owner = unit
    }
  }
  return owner
}

async function runtimeJestTestFiles(repositoryRoot: string): Promise<string[]> {
  const runtimeRoot = Shared.FS.resolvePath(RUNTIME_JEST_TESTS, repositoryRoot)
  return (await Shared.Repo.filesUnder(runtimeRoot, { extensions: ['.ts', '.tsx'] }))
    .filter(path => /\.jest-test\.tsx?$/.test(path))
    .map(path => repositoryRelative(path, repositoryRoot))
    .sort()
}

/**
 * testFilesAt routes one path to the registry files it selects. A directory selects every test file
 * the registry owns beneath it, so `just test packages/ides/studio` and `just test <one file>` are the
 * same request at two widths; anything else routes to the one file that path names.
 */
async function testFilesAt(inputPath: string, repositoryRoot = Shared.Repo.getRoot()): Promise<TestFile[]> {
  const absolutePath = Shared.FS.resolvePath(inputPath, repositoryRoot)
  if (!Shared.FS.pathIsWithin(absolutePath, repositoryRoot) || !await Shared.FS.isDirectory(absolutePath)) {
    return [await testFile(inputPath, repositoryRoot)]
  }
  const prefix = `${repositoryRelative(absolutePath, repositoryRoot)}/`
  const files = (await suiteRegistry(repositoryRoot))
    .flatMap(source => source.files.filter(file => file.startsWith(prefix)).map(file => ({ file, suite: source.name })))
    .sort((left, right) => left.file.localeCompare(right.file))
  if (files.length === 0) {
    throw new Shared.Errors.UserInputError(`No package test files under this directory: ${inputPath}`)
  }
  return files
}

/** testFile routes one exact path to the registry source that owns it. */
async function testFile(inputPath: string, repositoryRoot = Shared.Repo.getRoot()): Promise<TestFile> {
  const absolutePath = Shared.FS.resolvePath(inputPath, repositoryRoot)
  if (!Shared.FS.pathIsWithin(absolutePath, repositoryRoot) || !await Shared.FS.isFile(absolutePath)) {
    throw new Shared.Errors.UserInputError(`Test file does not exist in this repository: ${inputPath}`)
  }
  const file = repositoryRelative(absolutePath, repositoryRoot)
  const owner = (await suiteRegistry(repositoryRoot)).find(source => source.files.includes(file))
  if (owner !== undefined) {
    return { file, suite: owner.name }
  }
  throw new Shared.Errors.UserInputError(
    `Unsupported test file: ${file}. Use './agent test <name>' for package test names, './tao test' for Tao `
      + "files, or './agent studio-smoke' for Studio smoke files.",
  )
}

function repositoryRelative(path: string, repositoryRoot = Shared.Repo.getRoot()): string {
  return Shared.FS.slashPath(Shared.FS.relativePath(repositoryRoot, path))
}

/**
 * noTestsMatched asks whether a name-filtered run proved that nothing it scheduled matched, and its
 * scope is the whole run rather than any one suite. A filter that selects nothing anywhere is a
 * typo, and a run that reported it as a pass would be a green proving nothing — so the run fails.
 *
 * One suite matching nothing while another matched is the ordinary case, not a failure: a Bun test
 * name will never match a Jest test or a Tao journey, so making an empty suite fatal would turn
 * `just test "formats imports"` red for every suite that correctly found nothing. That is why the
 * per-suite runners are handed `--pass-with-no-tests` and `--passWithNoTests` — each suite passes
 * on its own empty result, and only the union of their observations decides this question.
 *
 * It keys on the pattern rather than on the scope, because every scope can now carry one.
 */
function noTestsMatched(
  pattern: string,
  observations: readonly TestObservation[],
  states: readonly SuiteState[],
): boolean {
  return pattern.length > 0
    && states.length > 0
    // Only per-test reporter metadata can tell "matched nothing" from "reported nothing". A suite
    // that produced no report is never read as an empty match, in either direction.
    && states.every(state => state.testObservations !== undefined)
    && states.every(state => state.status === 'passed')
    // The union across every suite: one observation that ran anywhere answers the question.
    && observations.every(observation => observation.outcome === 'skipped')
}

function bunSuite(
  suite: string,
  files: readonly string[],
  pattern: string,
  context: SuiteProcessContext,
  repositoryRoot: string,
): TestProcess {
  const testReport = context.reportRoot === undefined
    ? undefined
    : nativeReport(context.nodeName, suite, 'bun-junit', context.reportRoot)
  const tuningArgs = GateCatalog.suiteTuning(suite).args ?? []
  const args = [
    'test',
    // Bun reads a bare relative path as a filter, walks the whole repository to resolve it, and
    // leaves a file descriptor open per visited entry. Children spawned by a test then inherit an
    // exhausted descriptor table and their piped output never arrives. An absolute path is taken
    // literally, so the walk never happens.
    ...files.map(file => Shared.FS.resolvePath(file, repositoryRoot)),
    ...(testReport === undefined
      ? ['--reporter=dot']
      : ['--reporter=junit', `--reporter-outfile=${testReport.path}`]),
    ...tuningArgs,
    // Both spellings, because a table entry written as `['--timeout', '60000']` would otherwise get
    // a second `--timeout=` appended and Bun's argument precedence, not the table, would decide the
    // suite's hang guard.
    ...(tuningArgs.some(arg => arg === '--timeout' || arg.startsWith('--timeout='))
      ? []
      : [`--timeout=${deadlineFor(tuningArgs)}`]),
    ...(pattern ? ['--pass-with-no-tests', `--test-name-pattern=${pattern}`] : []),
  ]
  return { args, command: 'bun', cwd: repositoryRoot, files, testReport }
}

/**
 * deadlineFor chooses which question this suite's `--timeout` is answering.
 *
 * Under `--concurrent` Bun starts every test in the file at once and reports each one's duration as
 * the time from that shared start to its own completion — so a test's number is the process's work
 * up to that point, not the test's. One file of 30 validator tests measured a 1.8s minimum and a
 * 4.9s median for tests that take about 50ms each on their own, and the slowest reached 7.5s. A
 * per-test budget cannot bound that: it is applied per test to a quantity that describes the
 * process, so the last test to finish trips it first and the suite fails for being large rather
 * than for being slow. Stretching that budget by load does not help either, because the number it
 * is stretching was never about one test.
 *
 * So a concurrent suite gets the hang guard instead, which is the only per-test question still
 * worth asking there, and is what the one concurrent suite that had run long enough to hit this
 * already declared for itself by hand. The work budget keeps its regression-catching job in every
 * suite whose tests run one at a time, which is where a test's duration really is its own.
 */
function deadlineFor(tuningArgs: readonly string[]): number {
  return tuningArgs.includes('--concurrent')
    ? MAX_TEST_DEADLINE_MS
    : starvationAdjustedTimeoutMs(Shared.Platform.loadAverage(), Shared.Platform.cpuCount())
}

/**
 * starvationAdjustedTimeoutMs keeps the per-test bound denominated in work rather than in wall time.
 *
 * Bun's deadline is wall time, which is the work a test performed plus the time it spent off CPU
 * waiting for the rest of the machine. Holding it fixed therefore makes the pass/fail judgment a
 * function of how busy the machine is, which is not a property of the test: the Studio client bundle
 * measures 1.4s in isolation and was killed at Bun's five seconds with four lanes in flight. Raising
 * the bound to a flat two minutes, as the suites below do, buys that tolerance by giving up the
 * budget entirely — a test that genuinely regressed to eighty seconds would pass in silence.
 *
 * So the budget stays fixed and only the deadline stretches, by the run-queue depth this machine is
 * actually carrying. On a machine this run has to itself the result is the budget itself and nothing
 * more; the bound relaxes only while the load average says the slowdown is the machine's doing. A
 * suite that declares its own `--timeout` keeps it: those bounds are hang guards chosen for tests
 * that legitimately do tens of seconds of work, and scaling a hang guard is meaningless.
 *
 * The load is read once, when the node is admitted, and the deadline it produces stands for the
 * whole process. A lane that starts alone and is joined twenty seconds later by three more keeps
 * the bound it was given on a quiet machine, so this narrows the starvation window rather than
 * closing it. Bun takes one `--timeout` for the run and offers no way to revise it, so the
 * alternatives are a floor above the worst starvation ever observed — which gives the budget back —
 * or counting the lanes in the registry instead of reading the load, which is sampled at admission
 * just the same.
 */
function starvationAdjustedTimeoutMs(loadAverage: number, cpuCount: number): number {
  // The one-minute average lags the load it reports, so a run climbing toward saturation is always
  // read as quieter than the test is experiencing: the run that motivated this measured 2.3x by load
  // while the killed test itself ran 3.7x slower than in isolation.
  const observed = loadAverage / Math.max(1, cpuCount) * LOAD_AVERAGE_LAG_ALLOWANCE
  return Math.min(Math.round(TEST_BUDGET_MS * Math.max(observed, 1)), MAX_TEST_DEADLINE_MS)
}

/**
 * The per-test budget an uncontended machine keeps, set to clear `TestAsync.until`'s own 30s default
 * with margin. Below that floor a `until` wait that genuinely times out is killed by Bun's own
 * anonymous per-test timeout first, so the caller's description in `until`'s error — the property
 * `TestAsync.ts` documents — never reaches the report. The extra margin above Bun's 5s default costs
 * nothing on a test that passes and buys headroom on the genuinely slow ones, while the
 * regression-catching property survives because the budget is still fixed rather than waived.
 */
const TEST_BUDGET_MS = 45_000
/** How far the lagging load average is trusted to under-report the starvation a test is feeling. */
const LOAD_AVERAGE_LAG_ALLOWANCE = 2
/**
 * The ceiling, in milliseconds rather than in budgets: past this a deadline is no longer telling a
 * starved test apart from a hung one. Raised alongside the budget above, so that clearing `until`'s
 * default with a larger floor does not also shrink the room a starved suite gets before this stops
 * trusting the load reading — a hang still trips it at two minutes, same as it tripped at one before.
 * Absolute, so that raising the budget lengthens the deadline a loaded machine gets without also moving
 * the hang guard, which answers a different question.
 */
const MAX_TEST_DEADLINE_MS = 120_000

/**
 * A pattern matching no Tao journey is a user error to someone typing `tao test --name`, and the
 * normal case inside a run of twenty-two suites, where a name that selects plenty elsewhere selects
 * nothing here. `--pass-with-no-tests` is how the command is told which of the two it is in; without
 * it this suite had to sit every filtered run out, and a name-filtered lane silently lost its Tao
 * behavior coverage.
 */
function taoAppsSuite(roots: readonly string[], pattern: string, repositoryRoot: string): TestProcess {
  const args = ['test', ...roots, ...(pattern.length > 0 ? ['--name', pattern, '--pass-with-no-tests'] : [])]
  return { args, command: './tao', cwd: repositoryRoot, env: testTaoHome(repositoryRoot), files: roots }
}

/** Test lanes keep disposable Tao state inside the checkout, independent of the installed product home. */
function testTaoHome(repositoryRoot: string): Record<string, string> {
  return TaoAppSharedRun.testHomeEnv(repositoryRoot)
}

function runtimeJestSuite(
  files: readonly string[],
  pattern: string,
  context: SuiteProcessContext,
  repositoryRoot: string,
): TestProcess {
  const testReport = context.reportRoot === undefined
    ? undefined
    : nativeReport(context.nodeName, RUNTIME_JEST, 'jest-json', context.reportRoot)
  return {
    // Jest sizes itself to the whole machine by default, so without this flag one Jest child spawns
    // `cpuCount - 1` workers inside whatever the graph reserved and every other node in the lane
    // runs against a machine that is already full. A shard is granted one slot and runs one worker.
    args: [
      'node_modules/jest/bin/jest.js',
      ...files.map(file => Shared.FS.resolvePath(file, repositoryRoot)),
      '--no-watchman',
      `--maxWorkers=${Math.max(1, context.slots)}`,
      ...(pattern ? ['--passWithNoTests', `--testNamePattern=${pattern}`] : []),
      ...(testReport === undefined ? [] : ['--json', `--outputFile=${testReport.path}`]),
      '--silent',
    ],
    command: Shared.FS.resolvePath('.devenv/profile/bin/node', repositoryRoot),
    cwd: Shared.FS.resolvePath('packages/apps/expo-host', repositoryRoot),
    env: testTaoHome(repositoryRoot),
    files,
    testReport,
  }
}

/**
 * nativeReport names a report file after the node that writes it, not after its suite: two shards of
 * one suite run at once, and a shared path would have each overwrite the other's results.
 */
function nativeReport(
  nodeName: string,
  suite: string,
  format: NativeTestReport['format'],
  reportRoot: string,
): NativeTestReport {
  const extension = format === 'bun-junit' ? 'xml' : 'json'
  const file = nodeName.replaceAll(/[^\w.-]/g, '_')
  return { format, path: Shared.FS.resolvePath(`${file}.${extension}`, reportRoot), suite }
}

/** packageTestFilesByPackage lists each package's `<name>-tests/*.test.ts` files, repository-relative. */
async function packageTestFilesByPackage(repositoryRoot: string): Promise<Map<string, string[]>> {
  const packageRoot = Shared.FS.resolvePath('packages', repositoryRoot)
  const testFilesByPackage = new Map<string, string[]>()
  for (const testFile of await Shared.Repo.filesUnder(packageRoot, { extensions: ['.ts'] })) {
    const relativePath = repositoryRelative(testFile, repositoryRoot)
    const packageName = TestSelection.packageTestSuite(relativePath)
    if (packageName === undefined) {
      continue
    }
    const packageTestFiles = testFilesByPackage.get(packageName) ?? []
    packageTestFiles.push(relativePath)
    testFilesByPackage.set(packageName, packageTestFiles)
  }
  for (const testFiles of testFilesByPackage.values()) {
    testFiles.sort()
  }
  return testFilesByPackage
}

/** TestRunner owns the suite registry, its selection lanes, and the `./dev test` lane. */
export const TestRunner = {
  MAX_TEST_DEADLINE_MS,
  completeRun,
  discoverTestSuites,
  noTestsMatched,
  observationsFor,
  prepareRun,
  printFlakes,
  printSlowest,
  runChangedTests,
  runRetryTests,
  runTestFile,
  runTestRequest,
  runTests,
  starvationAdjustedTimeoutMs,
  suiteInventory,
  testFile,
  testNodesFor,
} as const
