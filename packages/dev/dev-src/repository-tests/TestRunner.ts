import * as Shared from '@shared'
import { ContentionRetry } from './ContentionRetry'
import { GateCatalog } from './GateCatalog'
import { type MachineLane, MachineLanes } from './MachineLanes'
import { PackageGraph } from './PackageGraph'
import { RunArtifacts } from './RunArtifacts'
import { buildSummary } from './RunSummary'
import { RunTimings, type TimingsStore } from './RunTimings'
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
  repositoryRoot?: string
}

export type TestRunRequest =
  | { kind: 'changed'; reference?: string }
  | { kind: 'file'; path: string }
  | { kind: 'full' }
  | { kind: 'name'; pattern: string }
  | { kind: 'retry' }

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

/** SuiteSelection is what one run asks of the suite registry. */
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
  /** Why the source sits out a run of this kind; absent, or undefined for the kind, means it serves it. */
  sitsOut?: (kind: TestRunRequest['kind']) => string | undefined
}

/** SuiteSelectionResult is what the registry produced for one run: suites, and what it left out and why. */
type SuiteSelectionResult = {
  /** Suites this run will schedule, each able to build a process for any subset of its files. */
  selected: SelectedSuite[]
  /** Sources that could not serve this run's kind, with the reason the summary repeats. */
  skipped: readonly { name: string; reason: string }[]
}

const LANE = 'dev-test'
/** How much of a failing suite's output a quiet run repeats; the whole of it is in the log file. */
const QUIET_FAILURE_OUTPUT_LINES = 40
const PERFORMANCE_CHECKS = 'performance-checks'
const PERFORMANCE_CHECK_FILE = 'packages/dev/performance-checks/language-performance.test.ts'
const RUNTIME_JEST = 'runtime-jest'
const RUNTIME_JEST_TESTS = 'packages/runtime-toolchain/runtime-toolchain-tests'
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
      build: roots => taoAppsSuite(roots, repositoryRoot),
      files: [TestSelection.ALL_APPS],
      name: TAO_APPS,
      // `./tao test` takes app roots, so the roots are what its shards can be split across. The
      // ledger still keys the suite as the one synthetic `Apps` unit whose identity it can hash.
      shardUnits: [...taoAppUnits.keys()],
      unitCostMs: taoAppUnits,
      // Without this note a name-filtered run reads as full coverage.
      sitsOut: kind => kind === 'name' ? 'a test-name pattern cannot select Tao behavior tests' : undefined,
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
  const result: SuiteSelectionResult = { selected: [], skipped: [] }
  for (const source of registry) {
    if (selection.suites !== undefined && !selection.suites.has(source.name)) {
      continue
    }
    const reason = source.sitsOut?.(selection.kind)
    if (reason !== undefined) {
      result.skipped = [...result.skipped, { name: source.name, reason }]
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
  const pattern = selection.pattern ?? ''
  return selectSuites(
    await suiteRegistry(repositoryRoot),
    { kind: pattern.length > 0 ? 'name' : 'full', ...selection, pattern },
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
}): Promise<
  { plans: readonly ShardPlan[]; skipped: readonly { name: string; reason: string }[]; states: SuiteState[] }
> {
  const { selected, skipped } = selectSuites(
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
  return { plans: plan.plans, skipped, states: plan.states as SuiteState[] }
}

/** runTests discovers, runs, reports, and records one `./dev test` invocation. */
async function runTests(pattern = '', options: TestRunOptions = {}): Promise<number> {
  return runTestRequest(pattern.length === 0 ? { kind: 'full' } : { kind: 'name', pattern }, options)
}

async function runChangedTests(reference?: string, options: TestRunOptions = {}): Promise<number> {
  return runTestRequest({ kind: 'changed', reference }, options)
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
  const records = await TestLedger.slowest(repositoryRoot, limit)
  if (records.length === 0) {
    Shared.HCI.writeLine('No per-test timings recorded yet; run just test first.')
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
  const { plans, skipped, states } = await testNodesFor({
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
  await RunArtifacts.assignLogPaths(states, location)
  const timings = await RunTimings.load({ repositoryRoot: location.repositoryRoot })
  const expectedMs = (name: string) => RunTimings.expectedMs(timings, name)
  const reporter = WorkReporter.create({ lane: LANE, logRoot: location.logRoot, mode })
  const liveArtifacts = RunArtifacts.liveWriter(location, event => reporter.handle(event))

  const result = await WorkGraph.run(states, {
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
      states,
    })
  }

  const observations = await observationsFor(states, location.repositoryRoot)
  const zeroMatch = noTestsMatched(prepared.kind, observations, states)
  if (zeroMatch) {
    const state = states[0]!
    state.status = 'failed'
    state.exitCode = 1
    state.reason = `no tests matched name pattern: ${prepared.pattern}`
    state.fullOutput += `\nNo tests matched name pattern: ${prepared.pattern}\n`
  }
  const ledger = result.interrupted
    ? await TestLedger.load(location.repositoryRoot)
    : await TestLedger.recordRun({
      fullRun: prepared.kind === 'full',
      observations,
      partialFiles: partialTaoAppRun(prepared) ? ['Apps'] : undefined,
      repositoryRoot: location.repositoryRoot,
      startedAt: options.startedAt,
    })

  const elapsedMs = Date.now() - options.startedAt
  const contention = machineLane.report()
  const summaryPath = await RunArtifacts.finishRun({
    location,
    extraDurations: TestNodes.suiteDurations(states),
    recordTimings: prepared.kind === 'full' && !contention.contended,
    states,
    summary: buildSummary({
      contention,
      elapsedMs,
      expectedMs,
      interrupted: result.interrupted,
      lane: LANE,
      logRoot: location.logRoot,
      schedule: WorkSchedule.report(result),
      states,
      suiteOf: name => states.find(state => state.name === name)?.suite,
    }),
  })
  TestResultSummary.printResultSummary(states, elapsedMs, {
    contention,
    // A dashboard scrolled the failure away; a quiet run never showed it. Both need it repeated,
    // and an agent reading a pipe needs it short enough to act on.
    includeFailureOutput: mode !== 'lines',
    failureOutputLineLimit: mode === 'quiet' ? QUIET_FAILURE_OUTPUT_LINES : undefined,
    skippedSuites: skipped,
  })
  if (prepared.kind === 'retry') {
    printRetryHonesty(prepared)
  }
  await printAdvisory(prepared, ledger)
  Shared.HCI.writeLine(`Summary: ${Shared.FS.displayPath(summaryPath)}`)
  // The graph's result holds the same state objects the retry updated, so a suite that recovered on
  // an isolated retry is already no longer failed here.
  return WorkGraph.exitCodeFor(result)
}

function partialTaoAppRun(prepared: PreparedRun): boolean {
  const roots = prepared.plan?.taoAppPaths
  return roots !== undefined && !(roots.length === 1 && roots[0] === TestSelection.ALL_APPS)
}

async function prepareRun(request: TestRunRequest, repositoryRoot: string): Promise<PreparedRun> {
  if (request.kind === 'full') {
    return { kind: 'full', pattern: '' }
  }
  if (request.kind === 'name') {
    return { kind: 'name', pattern: request.pattern }
  }
  if (request.kind === 'file') {
    return { files: [await testFile(request.path, repositoryRoot)], kind: 'file', pattern: '' }
  }

  if (request.kind === 'changed') {
    const changed = await TestSelection.changedSelection(request.reference, repositoryRoot)
    const [graph, inventory] = await Promise.all([PackageGraph.load(repositoryRoot), suiteInventory(repositoryRoot)])
    const plan = TestSelection.planChangedSuites(changed.changedPaths, graph, inventory)
    return { changed, kind: 'changed', pattern: '', plan: await withExistingAppRoots(plan, repositoryRoot) }
  }
  const changed = await TestSelection.changedSelection(undefined, repositoryRoot)
  const retry = await TestLedger.selectRetryFiles(await allTestFiles(repositoryRoot), repositoryRoot)
  return {
    changed,
    files: retry.files,
    kind: 'retry',
    pattern: '',
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
        outcome: state.status === 'passed' ? 'passed' : state.status === 'failed' ? 'failed' : 'skipped',
        suite: state.suite,
      }]
      : state.testReport === undefined
      ? undefined
      : await TestReport.read(state.testReport, repositoryRoot)
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
        name: 'suite process',
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
  if (prepared.kind !== 'changed' && prepared.kind !== 'file' && prepared.kind !== 'retry') {
    return
  }
  Shared.HCI.writeLine('\nTest selection:')
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

function taoAppsObservationName(roots: readonly string[]): string {
  return roots.length === 0 || (roots.length === 1 && roots[0] === TestSelection.ALL_APPS)
    ? 'all Tao behavior tests'
    : `Tao behavior tests under ${roots.join(', ')}`
}

function printRetryHonesty(prepared: PreparedRun): void {
  const stamp = prepared.retryStamp ?? 'no recorded full run (cold checkout)'
  Shared.HCI.writeLine(
    `skipping ${prepared.retryGreenTestCount ?? 0} tests green as of ${stamp} — run 'just test' before merging.`,
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
 * process can be handed, against the number of journeys under each. Each directory stays whole:
 * `tao test` groups its files onto one compiler worker so they share a workspace, and splitting a
 * directory would build that workspace twice. The journey count is the shard balancer's only signal
 * here, because the ledger keys this whole suite as one synthetic `Apps` unit.
 */
async function taoAppShardUnits(repositoryRoot: string): Promise<Map<string, number>> {
  const appsRoot = Shared.FS.resolvePath('Apps', repositoryRoot)
  const journeys = new Map<string, number>()
  for (const path of await Shared.Repo.filesUnder(appsRoot, { extensions: ['.tao'] })) {
    if (path.endsWith('.test.tao')) {
      const directory = repositoryRelative(Shared.FS.dirname(path), repositoryRoot)
      journeys.set(directory, (journeys.get(directory) ?? 0) + 1)
    }
  }
  return new Map([...journeys].toSorted(([left], [right]) => left.localeCompare(right)))
}

async function runtimeJestTestFiles(repositoryRoot: string): Promise<string[]> {
  const runtimeRoot = Shared.FS.resolvePath(RUNTIME_JEST_TESTS, repositoryRoot)
  return (await Shared.Repo.filesUnder(runtimeRoot, { extensions: ['.ts', '.tsx'] }))
    .filter(path => /\.jest-test\.tsx?$/.test(path))
    .map(path => repositoryRelative(path, repositoryRoot))
    .sort()
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
    `Unsupported test file: ${file}. Use 'just test <name>' for package test names, './tao test' for Tao files, or `
      + "'just studio-smoke' for Studio smoke files.",
  )
}

function repositoryRelative(path: string, repositoryRoot = Shared.Repo.getRoot()): string {
  return Shared.FS.slashPath(Shared.FS.relativePath(repositoryRoot, path))
}

function noTestsMatched(
  kind: TestRunRequest['kind'],
  observations: readonly TestObservation[],
  states: readonly SuiteState[],
): boolean {
  return kind === 'name'
    && states.length > 0
    && states.every(state => state.testObservations !== undefined)
    && observations.every(observation => observation.outcome === 'skipped')
    && states.every(state => state.status === 'passed')
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
    ...(GateCatalog.suiteTuning(suite).args ?? []),
    ...(pattern ? ['--pass-with-no-tests', `--test-name-pattern=${pattern}`] : []),
  ]
  return { args, command: 'bun', cwd: repositoryRoot, files, testReport }
}

function taoAppsSuite(roots: readonly string[], repositoryRoot: string): TestProcess {
  return { args: ['test', ...roots], command: './tao', cwd: repositoryRoot, files: roots }
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
    cwd: Shared.FS.resolvePath('packages/runtime-toolchain', repositoryRoot),
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
  for (
    const testFile of (await Shared.Repo.filesUnder(packageRoot, { extensions: ['.ts'] })).filter(path =>
      TestSelection.packageTestSuite(repositoryRelative(path, repositoryRoot)) !== undefined
    )
  ) {
    const packageName = Shared.FS.relativePath(packageRoot, testFile).split('/')[0]
    if (packageName === undefined || packageName.length === 0) {
      continue
    }
    const packageTestFiles = testFilesByPackage.get(packageName) ?? []
    packageTestFiles.push(repositoryRelative(testFile, repositoryRoot))
    testFilesByPackage.set(packageName, packageTestFiles)
  }
  for (const testFiles of testFilesByPackage.values()) {
    testFiles.sort()
  }
  return testFilesByPackage
}

/** TestRunner owns the suite registry, its selection lanes, and the `./dev test` lane. */
export const TestRunner = {
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
  suiteInventory,
  testFile,
  testNodesFor,
} as const
