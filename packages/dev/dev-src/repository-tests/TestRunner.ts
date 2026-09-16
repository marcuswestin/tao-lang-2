import * as Shared from '@shared'
import { ContentionRetry } from './ContentionRetry'
import { type MachineLane, MachineLanes } from './MachineLanes'
import { PackageGraph } from './PackageGraph'
import { RunArtifacts } from './RunArtifacts'
import { buildSummary } from './RunSummary'
import { RunTimings } from './RunTimings'
import { TestAdvisory } from './TestAdvisory'
import { type TestFile, TestLedger, type TestLedgerStore, type TestObservation } from './TestLedger'
import { type NativeTestReport, TestReport } from './TestReport'
import { TestResultSummary } from './TestResultSummary'
import { type ChangedPlan, type ChangedSelection, type SuiteInventory, TestSelection } from './TestSelection'
import { type WorkEvent, WorkGraph, type WorkNode, type WorkState } from './WorkGraph'
import { type OutputMode, WorkReporter } from './WorkReporter'

/** SuiteStatus declares the lifecycle state of one test suite process. */
export type SuiteStatus = WorkState['status']

/** TestSuite declares one executable test suite. */
export type TestSuite = {
  name: string
  command: string
  args: string[]
  /** Rebuild arguments from the worker slots the machine-wide broker actually admits. */
  argsForSlots?: (slots: number) => string[]
  cwd?: string
  /** Repository-relative test files this process may execute. */
  files?: readonly string[]
  scheduling?: SuiteScheduling
  testReport?: NativeTestReport
}

/** SuiteState tracks one test suite's process output and status. */
export type SuiteState = WorkState & {
  selectedTestFiles?: readonly string[]
  testObservations?: readonly TestObservation[]
  testReport?: NativeTestReport
}

type RunSuiteProcessesOptions = {
  jobs?: number
  onChange: () => void
  onComplete?: (state: SuiteState) => void
  onOutput?: (state: SuiteState, output: string) => void
  onStart?: (state: SuiteState) => void
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

/** SuiteScheduling weights one suite for the shared work graph. */
export type SuiteScheduling = {
  /** Higher-priority suites start earlier. Default 0. */
  priority?: number
  // A suite occupies `cost` of the cpuCount worker slots while it runs, so CPU-hungry suites
  // (multi-process runners, or single-process compile phases that must not be starved) hold
  // back cheap suites instead of running under full contention. Default 1.
  cost?: number
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
  /** The lane's worker budget, which bounds any runner that would otherwise size itself to the machine. */
  jobs?: number
  /** Where native runner reports go; absent, the runner prints a summary instead. */
  reportRoot?: string
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
  /** Turns the files this run selected into the process that runs them. */
  build: (files: readonly string[], selection: SuiteSelection, context: SuiteBuildContext) => TestSuite
  scheduling?: SuiteScheduling
  /** Why the source sits out a run of this kind; absent, or undefined for the kind, means it serves it. */
  sitsOut?: (kind: TestRunRequest['kind']) => string | undefined
}

/** SuiteSelectionResult is what the registry produced for one run: processes, and what it left out and why. */
type SuiteSelectionResult = {
  /** Sources that could not serve this run's kind, with the reason the summary repeats. */
  skipped: readonly { name: string; reason: string }[]
  suites: TestSuite[]
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
 * The runtime-jest reservation, and the worker count the Jest child is held to. Jest sizes itself
 * to the whole machine by default, so without the flag this suite spawns `cpuCount - 1` workers
 * inside a three-slot reservation and every other suite in the lane runs against a machine that is
 * already full. The two numbers are one number for that reason.
 */
const RUNTIME_JEST_COST = 3

/** PackageTuning is what one package's Bun suite needs beyond the defaults every package gets. */
type PackageTuning = {
  args?: readonly string[]
  scheduling?: SuiteScheduling
}

/**
 * The three widest reservations in this registry fit together inside the budget an outer graph
 * hands this runner (`_test`'s `cost`, which is `cpuCount - 6`), not just inside a whole machine. A
 * reservation that alone fills that budget makes the widest suite exclusive and the rest of the run
 * queues behind it: measured on 18 CPUs, `--jobs 12` against the old 12/4/3 weights took 41.6s
 * where `--jobs 18` took 22.6s; at 8/3/2 the same `--jobs 12` run takes 21.5s and `--jobs 18` 22.9s.
 */
const PACKAGE_TUNING = new Map<string, PackageTuning>([
  ['compiler', { args: ['--concurrent'] }],
  // Developer tests deliberately run concurrently and many of them spawn child processes. During
  // full verification, a healthy child can wait behind the other CPU-heavy suites long enough to
  // exceed Bun's generic five-second test timeout even though it completes promptly in isolation.
  ['dev', { args: ['--concurrent', '--timeout=15000'] }],
  ['ide-extension', { args: ['--concurrent'] }],
  // runtime-toolchain tests spawn full tsc typechecks per test; under parallel suite load these
  // exceed Bun's 5s default per-test timeout, which kills the tsc child and fails the test on its
  // empty output.
  ['runtime-toolchain', { args: ['--timeout=60000'], scheduling: { priority: 3, cost: 2 } }],
  ['source-actions', { scheduling: { priority: 3 } }],
  ['tao-cli', { scheduling: { priority: 2 } }],
  ['validator', { args: ['--concurrent'] }],
])

/**
 * suiteRegistry lists every suite this checkout can run, in discovery order: one Bun suite per
 * package with a `<name>-tests` directory, the language performance checks, the runtime Jest
 * suite, and the Tao behavior tests. A source with nothing to run is not listed.
 */
async function suiteRegistry(repositoryRoot = Shared.Repo.getRoot()): Promise<SuiteSource[]> {
  const [byPackage, jestFiles] = await Promise.all([
    packageTestFilesByPackage(repositoryRoot),
    runtimeJestTestFiles(repositoryRoot),
  ])
  const sources: SuiteSource[] = [
    ...[...byPackage].map(([name, files]): SuiteSource => {
      const tuning = PACKAGE_TUNING.get(name)
      return {
        build: (selected, selection, context) =>
          bunSuite(name, selected, selection.pattern, context, repositoryRoot, tuning),
        files,
        name,
        package: name,
        scheduling: tuning?.scheduling,
      }
    }),
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
      scheduling: { priority: 4, cost: RUNTIME_JEST_COST },
    },
    {
      build: roots => taoAppsSuite(roots, repositoryRoot),
      files: [TestSelection.ALL_APPS],
      name: TAO_APPS,
      // tao-apps dominates the wall time of a full run; its validate+compile phase is one
      // single-threaded process, so it gets the earliest start and a wide slot reservation, and it
      // then fans out into compiler worker processes plus a Jest run of its own.
      scheduling: { priority: 5, cost: 8 },
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
  const result: SuiteSelectionResult = { skipped: [], suites: [] }
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
      result.suites.push({ scheduling: source.scheduling, ...source.build(files, selection, context) })
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

/** suiteNode turns one discovered suite into a work-graph node with its scheduling weights. */
function suiteNode(suite: TestSuite): WorkNode {
  const command = (args: readonly string[]) => ({ args, command: suite.command, cwd: suite.cwd })
  return {
    cost: suite.scheduling?.cost,
    name: suite.name,
    priority: suite.scheduling?.priority,
    run: suite.argsForSlots === undefined ? command(suite.args) : ({ slots }) => command(suite.argsForSlots!(slots)),
  }
}

function createSuiteState(suite: TestSuite): SuiteState {
  const state = WorkGraph.createState(suiteNode(suite)) as SuiteState
  state.selectedTestFiles = suite.files
  state.testReport = suite.testReport
  return state
}

/**
 * runSuiteProcesses schedules suites through the work graph. Suites are nodes with no dependencies,
 * so ordering is the graph's priority-then-critical-path policy over the registry's weights.
 */
async function runSuiteProcesses(states: SuiteState[], options: RunSuiteProcessesOptions): Promise<void> {
  await WorkGraph.run(states, {
    jobs: options.jobs,
    onEvent: event => reportToCallbacks(event, options),
  })
}

function reportToCallbacks(event: WorkEvent, options: RunSuiteProcessesOptions): void {
  Shared.Switch.kind<WorkEvent, void>(event, {
    complete: ({ state }) => {
      options.onComplete?.(state)
      options.onChange()
    },
    done: () => {},
    output: ({ output, state }) => {
      options.onOutput?.(state, output)
      options.onChange()
    },
    planned: () => {},
    start: ({ state }) => {
      options.onStart?.(state)
      options.onChange()
    },
    waiting: () => options.onChange(),
  })
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
  // A nested run is already inside the width its parent graph reserved, so it neither registers on
  // the machine nor divides it again; a top-level `./dev test` shares the machine with whatever
  // other worktrees are running.
  const machineLane = await MachineLanes.acquire({
    lane: LANE,
    repositoryRoot: location.repositoryRoot,
    requestedJobs: options.jobs,
    reservedJobs: reservedJobs(),
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
  const { skipped, suites } = selectSuites(
    await suiteRegistry(location.repositoryRoot),
    selectionFor(prepared),
    { jobs: machineLane.capacity, reportRoot },
  )
  printSelection(prepared, suites)
  if (suites.length === 0) {
    if (prepared.kind === 'changed') {
      Shared.HCI.writeSuccess('No suite observes the changed paths; nothing to run.')
      await printAdvisory(prepared, await TestLedger.load(location.repositoryRoot))
      return 0
    }
    Shared.HCI.writeLine('No test suites found.')
    return 1
  }

  const mode = options.mode ?? WorkReporter.resolveMode()
  const states = suites.map(createSuiteState)
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
    recordTimings: prepared.kind === 'full' && !contention.contended,
    states,
    summary: buildSummary({
      contention,
      elapsedMs,
      expectedMs,
      interrupted: result.interrupted,
      lane: LANE,
      logRoot: location.logRoot,
      states,
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
    state.testObservations = state.name === TAO_APPS
      ? [{
        durationMs: state.elapsedMs,
        file: 'Apps',
        // A partial app run is recorded under its own name, so it can never stand in for the
        // complete inventory the retry ledger keys on.
        name: taoAppsObservationName(state.selectedTestFiles ?? []),
        outcome: state.status === 'passed' ? 'passed' : state.status === 'failed' ? 'failed' : 'skipped',
        suite: state.name,
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
        suite: state.name,
      }))
    }
    observations.push(...state.testObservations ?? [])
  }
  return observations
}

function printSelection(prepared: PreparedRun, suites: readonly TestSuite[]): void {
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
  for (const suite of suites) {
    const details = prepared.kind === 'changed'
      ? prepared.plan?.selected.get(suite.name) ?? 'selected'
      : prepared.kind === 'file'
      ? 'exact requested file'
      : 'contains an unsettled or unrecorded test'
    const roots = suite.name === TAO_APPS && prepared.kind === 'changed' ? ` (${suite.files?.join(', ')})` : ''
    Shared.HCI.writeLine(`- selected ${suite.name}: ${details}${roots}`)
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

/** reservedJobs reads the width an outer work graph already reserved for this whole process. */
function reservedJobs(): number | undefined {
  const envJobs = Number(Shared.Platform.runtimeProcess.env[WorkGraph.BUDGET_ENV_KEYS.devTest] ?? '')
  return Number.isInteger(envJobs) && envJobs > 0 ? envJobs : undefined
}

function bunSuite(
  name: string,
  files: readonly string[],
  pattern: string,
  context: SuiteBuildContext,
  repositoryRoot: string,
  tuning: PackageTuning = {},
): TestSuite {
  const testReport = context.reportRoot === undefined ? undefined : nativeReport(name, 'bun-junit', context.reportRoot)
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
    ...(tuning.args ?? []),
    ...(pattern ? ['--pass-with-no-tests', `--test-name-pattern=${pattern}`] : []),
  ]
  return { name, command: 'bun', args, cwd: repositoryRoot, files, testReport }
}

function taoAppsSuite(roots: readonly string[], repositoryRoot: string): TestSuite {
  return { name: TAO_APPS, command: './tao', args: ['test', ...roots], cwd: repositoryRoot, files: roots }
}

function runtimeJestSuite(
  files: readonly string[],
  pattern: string,
  context: SuiteBuildContext,
  repositoryRoot: string,
): TestSuite {
  const testReport = context.reportRoot === undefined
    ? undefined
    : nativeReport(RUNTIME_JEST, 'jest-json', context.reportRoot)
  const argsForSlots = (slots: number) => [
    'node_modules/jest/bin/jest.js',
    ...files.map(file => Shared.FS.resolvePath(file, repositoryRoot)),
    '--no-watchman',
    `--maxWorkers=${runtimeJestWorkers(slots)}`,
    ...(pattern ? ['--passWithNoTests', `--testNamePattern=${pattern}`] : []),
    ...(testReport === undefined ? [] : ['--json', `--outputFile=${testReport.path}`]),
    '--silent',
  ]
  return {
    name: RUNTIME_JEST,
    command: Shared.FS.resolvePath('.devenv/profile/bin/node', repositoryRoot),
    args: argsForSlots(runtimeJestWorkers(context.jobs)),
    argsForSlots,
    cwd: Shared.FS.resolvePath('packages/runtime-toolchain', repositoryRoot),
    files,
    testReport,
  }
}

function nativeReport(name: string, format: NativeTestReport['format'], reportRoot: string): NativeTestReport {
  const extension = format === 'bun-junit' ? 'xml' : 'json'
  return { format, path: Shared.FS.resolvePath(`${name}.${extension}`, reportRoot), suite: name }
}

/**
 * runtimeJestWorkers holds the Jest child to the slots this suite actually reserved, and to the
 * whole lane's budget when that is narrower still — which it is whenever another worktree is
 * running a lane on the same machine.
 */
function runtimeJestWorkers(jobs: number | undefined): number {
  return Math.max(1, Math.min(RUNTIME_JEST_COST, jobs ?? RUNTIME_JEST_COST))
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

/** TestRunner owns the suite registry, its scheduling weights, and the `./dev test` lane. */
export const TestRunner = {
  createSuiteState,
  discoverTestSuites,
  noTestsMatched,
  printFlakes,
  printSlowest,
  runChangedTests,
  runRetryTests,
  runSuiteProcesses,
  runTestFile,
  runTestRequest,
  runTests,
  suiteInventory,
  testFile,
} as const
