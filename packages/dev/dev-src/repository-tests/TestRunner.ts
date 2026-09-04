import * as Shared from '@shared'
import { ContentionRetry } from './ContentionRetry'
import { type MachineLane, MachineLanes } from './MachineLanes'
import { RunArtifacts } from './RunArtifacts'
import { buildSummary } from './RunSummary'
import { RunTimings } from './RunTimings'
import { TestAdvisory } from './TestAdvisory'
import { type TestFile, TestLedger, type TestLedgerStore, type TestObservation } from './TestLedger'
import { type NativeTestReport, TestReport } from './TestReport'
import { TestResultSummary } from './TestResultSummary'
import { type ChangedSelection, TestSelection } from './TestSelection'
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
  retryGreenTestCount?: number
  retryStamp?: string
}

type DiscoverOptions = {
  changedReference?: string
  files?: readonly TestFile[]
  includePerformance?: boolean
  includeTaoApps?: boolean
  reportRoot?: string
}

const LANE = 'dev-test'
/** How much of a failing suite's output a quiet run repeats; the whole of it is in the log file. */
const QUIET_FAILURE_OUTPUT_LINES = 40
const BUN_SUITE_ARGS = new Map<string, readonly string[]>([
  ['compiler', ['--concurrent']],
  ['dev', ['--concurrent']],
  ['ide-extension', ['--concurrent']],
  // runtime-toolchain tests spawn full tsc typechecks; under parallel suite load these exceed
  // bun's 5s default per-test timeout, which kills the tsc child and fails the test on its
  // empty output.
  ['runtime-toolchain', ['--timeout=60000']],
  ['validator', ['--concurrent']],
])
/** SuiteScheduling weights one suite for the shared work graph. */
type SuiteScheduling = {
  /** Higher-priority suites start earlier. Default 0. */
  priority?: number
  // A suite occupies `cost` of the cpuCount worker slots while it runs, so CPU-hungry suites
  // (multi-process runners, or single-process compile phases that must not be starved) hold
  // back cheap suites instead of running under full contention. Default 1.
  cost?: number
}
/**
 * The runtime-jest reservation, and the worker count the Jest child is held to. Jest sizes itself
 * to the whole machine by default, so without the flag this suite spawns `cpuCount - 1` workers
 * inside a three-slot reservation and every other suite in the lane runs against a machine that is
 * already full. The two numbers are one number for that reason.
 */
const RUNTIME_JEST_COST = 3
const SUITE_SCHEDULING = new Map<string, SuiteScheduling>([
  // tao-apps dominates the wall time of a full run; its validate+compile phase is one
  // single-threaded process, so it gets the earliest start and a wide slot reservation.
  // tao-apps fans out into compiler worker processes plus a Jest run of its own.
  //
  // The three widest reservations fit together inside the budget an outer graph hands this runner
  // (`_test`'s `cost`, which is `cpuCount - 6`), not just inside a whole machine. A reservation
  // that alone fills that budget makes the widest suite exclusive and the rest of the run queues
  // behind it: measured on 18 CPUs, `--jobs 12` against the old 12/4/3 weights took 41.6s where
  // `--jobs 18` took 22.6s; at 8/3/2 the same `--jobs 12` run takes 21.5s and `--jobs 18` 22.9s.
  ['tao-apps', { priority: 5, cost: 8 }],
  ['runtime-jest', { priority: 4, cost: RUNTIME_JEST_COST }],
  // runtime-toolchain spawns tsc typecheck children per test.
  ['runtime-toolchain', { priority: 3, cost: 2 }],
  ['source-actions', { priority: 3 }],
  ['tao-cli', { priority: 2 }],
])

async function discoverTestSuites(pattern = '', jobs?: number, options: DiscoverOptions = {}): Promise<TestSuite[]> {
  const packageRoot = Shared.Repo.resolvePath('packages')
  const packageNames = await Shared.FS.listDir(packageRoot)
  const testFilesByPackage = await packageTestFilesByPackage(packageRoot)
  const suites: TestSuite[] = []
  const selectedFiles = options.files === undefined ? undefined : filesBySuite(options.files)

  for (const packageName of packageNames) {
    const packagePath = Shared.FS.resolvePath(packageName, packageRoot)
    if (!await Shared.FS.isDirectory(packagePath)) {
      continue
    }
    const allTestFiles = testFilesByPackage.get(packageName) ?? []
    const testFiles = selectedFiles === undefined
      ? allTestFiles
      : allTestFiles.filter(path => selectedFiles.get(packageName)?.has(repositoryRelative(path)) === true)
    if (testFiles.length === 0) {
      continue
    }
    suites.push(...packageSuites(packageName, testFiles, pattern, options))
  }

  if (options.includePerformance !== false && selectedSuite(selectedFiles, 'performance-checks')) {
    suites.push(...performanceCheckSuites(pattern, options))
  }
  if (selectedSuite(selectedFiles, 'runtime-jest')) {
    const runtimeFiles = selectedFiles === undefined
      ? await runtimeJestTestFiles(Shared.Repo.resolvePath())
      : [...(selectedFiles.get('runtime-jest') ?? [])]
    suites.push(...runtimeJestSuites(
      pattern,
      jobs,
      runtimeFiles,
      options,
    ))
  }
  if (options.includeTaoApps !== false && selectedSuite(selectedFiles, 'tao-apps')) {
    suites.push(...taoAppsSuites(pattern))
  }
  return suites
}

function selectedSuite(selectedFiles: Map<string, Set<string>> | undefined, suite: string): boolean {
  return selectedFiles === undefined || (selectedFiles.get(suite)?.size ?? 0) > 0
}

function filesBySuite(files: readonly TestFile[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  for (const file of files) {
    const suiteFiles = result.get(file.suite) ?? new Set<string>()
    suiteFiles.add(file.file)
    result.set(file.suite, suiteFiles)
  }
  return result
}

/** suiteNode turns one discovered suite into a work-graph node with its scheduling weights. */
function suiteNode(suite: TestSuite): WorkNode {
  const scheduling = SUITE_SCHEDULING.get(suite.name)
  return {
    cost: scheduling?.cost,
    name: suite.name,
    priority: scheduling?.priority,
    run: { args: suite.args, command: suite.command, cwd: suite.cwd },
    runForSlots: suite.argsForSlots === undefined
      ? undefined
      : slots => ({ args: suite.argsForSlots!(slots), command: suite.command, cwd: suite.cwd }),
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
 * so ordering is the graph's priority-then-critical-path policy over `SUITE_SCHEDULING`'s seeds.
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
  const suites = await discoverTestSuites(prepared.pattern, machineLane.capacity, {
    changedReference: prepared.changed?.reference,
    files: prepared.files,
    includePerformance: prepared.kind !== 'changed'
      || TestSelection.selectsPerformanceChecks(prepared.changed?.changedPaths ?? []),
    includeTaoApps: prepared.kind !== 'changed'
      || TestSelection.selectsTaoApps(prepared.changed?.changedPaths ?? []),
    reportRoot,
  })
  printSelection(prepared, suites)
  if (suites.length === 0) {
    Shared.HCI.writeLine('No test suites found.')
    return prepared.kind === 'changed' ? 0 : 1
  }

  const mode = options.mode ?? WorkReporter.resolveMode()
  const states = suites.map(createSuiteState)
  await RunArtifacts.assignLogPaths(states, location)
  const timings = await RunTimings.load({ repositoryRoot: location.repositoryRoot })
  const expectedMs = (name: string) => RunTimings.expectedMs(timings, name)
  const reporter = WorkReporter.create({ lane: LANE, logRoot: location.logRoot, mode })

  const result = await WorkGraph.run(states, {
    expectedMs,
    jobs: machineLane.ceiling,
    onEvent: event => reporter.handle(event),
    slotBroker: machineLane,
  })
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
      repositoryRoot: location.repositoryRoot,
      startedAt: options.startedAt,
    })

  const elapsedMs = Date.now() - options.startedAt
  const contention = machineLane.report()
  const summaryPath = await RunArtifacts.finishRun({
    location,
    recordTimings: !contention.contended,
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
    taoAppsSkipped: prepared.kind === 'name',
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
    return { changed, kind: 'changed', pattern: '' }
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

async function observationsFor(states: readonly SuiteState[], repositoryRoot: string): Promise<TestObservation[]> {
  const observations: TestObservation[] = []
  for (const state of states) {
    state.testObservations = state.name === 'tao-apps'
      ? [{
        durationMs: state.elapsedMs,
        file: 'Apps',
        name: 'all Tao behavior tests',
        outcome: state.status === 'passed' ? 'passed' : 'failed',
        suite: state.name,
      }]
      : state.testReport === undefined
      ? undefined
      : await TestReport.read(state.testReport, repositoryRoot)
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
  for (const suite of suites) {
    const details = prepared.kind === 'changed'
      ? `runner change selection since ${prepared.changed?.reference}`
      : prepared.kind === 'file'
      ? 'exact requested file'
      : 'contains an unsettled or unrecorded test'
    Shared.HCI.writeLine(`- selected ${suite.name}: ${details}`)
  }
  if (prepared.kind === 'changed') {
    if (!TestSelection.selectsPerformanceChecks(prepared.changed?.changedPaths ?? [])) {
      Shared.HCI.writeLine('- skipped performance-checks: no performance or language-service path changed')
    }
    if (!TestSelection.selectsTaoApps(prepared.changed?.changedPaths ?? [])) {
      Shared.HCI.writeLine('- skipped tao-apps: no Apps/ or .tao file changed')
    }
  }
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

async function allTestFiles(repositoryRoot: string): Promise<TestFile[]> {
  const packageRoot = Shared.FS.resolvePath('packages', repositoryRoot)
  const byPackage = await packageTestFilesByPackage(packageRoot)
  const files: TestFile[] = []
  for (const [suite, paths] of byPackage) {
    files.push(...paths.map(path => ({ file: repositoryRelative(path, repositoryRoot), suite })))
  }
  files.push({ file: 'packages/dev/performance-checks/language-performance.test.ts', suite: 'performance-checks' })
  for (const file of await runtimeJestTestFiles(repositoryRoot)) {
    files.push({ file, suite: 'runtime-jest' })
  }
  files.push({ file: 'Apps', suite: 'tao-apps' })
  return files.sort((left, right) => `${left.suite}:${left.file}`.localeCompare(`${right.suite}:${right.file}`))
}

async function runtimeJestTestFiles(repositoryRoot: string): Promise<string[]> {
  const runtimeRoot = Shared.FS.resolvePath('packages/runtime-toolchain/runtime-toolchain-tests', repositoryRoot)
  return (await Shared.Repo.filesUnder(runtimeRoot, { extensions: ['.ts', '.tsx'] }))
    .filter(path => /\.jest-test\.tsx?$/.test(path))
    .map(path => repositoryRelative(path, repositoryRoot))
    .sort()
}

async function testFile(inputPath: string, repositoryRoot = Shared.Repo.getRoot()): Promise<TestFile> {
  const absolutePath = Shared.FS.resolvePath(inputPath, repositoryRoot)
  if (!Shared.FS.pathIsWithin(absolutePath, repositoryRoot) || !await Shared.FS.isFile(absolutePath)) {
    throw new Shared.Errors.UserInputError(`Test file does not exist in this repository: ${inputPath}`)
  }
  const file = repositoryRelative(absolutePath, repositoryRoot)
  if (/^packages\/runtime-toolchain\/runtime-toolchain-tests\/[^/]+\.jest-test\.tsx?$/.test(file)) {
    return { file, suite: 'runtime-jest' }
  }
  if (file === 'packages/dev/performance-checks/language-performance.test.ts') {
    return { file, suite: 'performance-checks' }
  }
  const match = file.match(/^packages\/([^/]+)\/\1-tests\/[^/]+\.test\.ts$/)
  if (match?.[1] !== undefined) {
    return { file, suite: match[1] }
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
    && observations.length > 0
    && observations.every(observation => observation.outcome === 'skipped')
    && states.every(state => state.status === 'passed')
}

/** reservedJobs reads the width an outer work graph already reserved for this whole process. */
function reservedJobs(): number | undefined {
  const envJobs = Number(Shared.Platform.runtimeProcess.env[WorkGraph.BUDGET_ENV_KEYS.devTest] ?? '')
  return Number.isInteger(envJobs) && envJobs > 0 ? envJobs : undefined
}

function packageSuites(
  packageName: string,
  testFiles: string[],
  pattern: string,
  options: DiscoverOptions,
): TestSuite[] {
  return [bunSuite(packageName, testFiles, pattern, options)]
}

function bunSuite(name: string, testFiles: string[], pattern: string, options: DiscoverOptions = {}): TestSuite {
  const testReport = options.reportRoot === undefined ? undefined : nativeReport(name, 'bun-junit', options.reportRoot)
  const args = [
    'test',
    // Bun reads a bare relative path as a filter, walks the whole repository to resolve it, and
    // leaves a file descriptor open per visited entry. Children spawned by a test then inherit an
    // exhausted descriptor table and their piped output never arrives. An absolute path is taken
    // literally, so the walk never happens.
    ...testFiles,
    ...(testReport === undefined
      ? ['--reporter=dot']
      : ['--reporter=junit', `--reporter-outfile=${testReport.path}`]),
    ...(BUN_SUITE_ARGS.get(name) ?? []),
    ...(options.changedReference === undefined ? [] : [`--changed=${options.changedReference}`]),
    ...(pattern || options.changedReference !== undefined ? ['--pass-with-no-tests'] : []),
    ...(pattern ? [`--test-name-pattern=${pattern}`] : []),
  ]
  return {
    name,
    command: 'bun',
    args,
    cwd: Shared.Repo.resolvePath(),
    files: testFiles.map(path => repositoryRelative(path)),
    testReport,
  }
}

function performanceCheckSuites(pattern: string, options: DiscoverOptions): TestSuite[] {
  return [bunSuite(
    'performance-checks',
    [Shared.Repo.resolvePath('packages/dev/performance-checks/language-performance.test.ts')],
    pattern,
    options,
  )]
}

function runtimeJestSuites(
  pattern: string,
  jobs: number | undefined,
  testFiles: string[],
  options: DiscoverOptions,
): TestSuite[] {
  return [runtimeJestSuite(
    'runtime-jest',
    testFiles.map(file => Shared.Repo.resolvePath(file)),
    pattern,
    jobs,
    options,
  )]
}

function taoAppsSuites(pattern: string): TestSuite[] {
  if (pattern.length > 0) {
    return []
  }
  return [{
    name: 'tao-apps',
    command: './tao',
    args: ['test', 'Apps'],
    cwd: Shared.Repo.resolvePath(),
    files: ['Apps'],
  }]
}

function runtimeJestSuite(
  name: string,
  testFiles: string[],
  pattern: string,
  jobs?: number,
  options: DiscoverOptions = {},
): TestSuite {
  const nodePath = Shared.Repo.resolvePath('.devenv/profile/bin/node')
  const testReport = options.reportRoot === undefined ? undefined : nativeReport(name, 'jest-json', options.reportRoot)
  const argsForSlots = (slots: number) => [
    'node_modules/jest/bin/jest.js',
    ...testFiles,
    '--no-watchman',
    `--maxWorkers=${runtimeJestWorkers(slots)}`,
    ...(options.changedReference === undefined ? [] : [`--changedSince=${options.changedReference}`]),
    ...(pattern || options.changedReference !== undefined ? ['--passWithNoTests'] : []),
    ...(pattern ? [`--testNamePattern=${pattern}`] : []),
    ...(testReport === undefined ? [] : ['--json', `--outputFile=${testReport.path}`]),
    '--silent',
  ]
  const args = argsForSlots(runtimeJestWorkers(jobs))
  return {
    name,
    command: nodePath,
    args,
    argsForSlots,
    cwd: Shared.Repo.resolvePath('packages/runtime-toolchain'),
    files: testFiles.map(path => repositoryRelative(path)),
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

async function packageTestFilesByPackage(packageRoot: string): Promise<Map<string, string[]>> {
  const testFilesByPackage = new Map<string, string[]>()
  for (
    const testFile of (await Shared.Repo.filesUnder(packageRoot, { extensions: ['.ts'] })).filter(path =>
      isPackageTestFile(packageRoot, path)
    )
  ) {
    const packageName = Shared.FS.relativePath(packageRoot, testFile).split('/')[0]
    if (packageName === undefined || packageName.length === 0) {
      continue
    }
    const packageTestFiles = testFilesByPackage.get(packageName) ?? []
    packageTestFiles.push(testFile)
    testFilesByPackage.set(packageName, packageTestFiles)
  }
  for (const testFiles of testFilesByPackage.values()) {
    testFiles.sort()
  }
  return testFilesByPackage
}

function isPackageTestFile(packageRoot: string, path: string): boolean {
  const relativePath = Shared.FS.relativePath(packageRoot, path)
  const [packageName, testsDirectory, fileName, ...rest] = relativePath.split('/')
  return packageName !== undefined
    && testsDirectory?.endsWith('-tests') === true
    && fileName?.endsWith('.test.ts') === true
    && rest.length === 0
}

/** TestRunner owns package test discovery, scheduling seeds, and the `./dev test` lane. */
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
  testFile,
} as const
