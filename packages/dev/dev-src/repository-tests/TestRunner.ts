import * as Shared from '@shared'
import { ContentionRetry } from './ContentionRetry'
import { type MachineLane, MachineLanes } from './MachineLanes'
import { RunArtifacts } from './RunArtifacts'
import { buildSummary } from './RunSummary'
import { RunTimings } from './RunTimings'
import { TestResultSummary } from './TestResultSummary'
import { type WorkEvent, WorkGraph, type WorkNode, type WorkState } from './WorkGraph'
import { type OutputMode, WorkReporter } from './WorkReporter'

/** SuiteStatus declares the lifecycle state of one test suite process. */
export type SuiteStatus = WorkState['status']

/** TestSuite declares one executable test suite. */
type TestSuite = {
  name: string
  command: string
  args: string[]
  cwd?: string
}

/** SuiteState tracks one test suite's process output and status. */
export type SuiteState = WorkState

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

async function discoverTestSuites(pattern = '', jobs?: number): Promise<TestSuite[]> {
  const packageRoot = Shared.Repo.resolvePath('packages')
  const packageNames = await Shared.FS.listDir(packageRoot)
  const testFilesByPackage = await packageTestFilesByPackage(packageRoot)
  const suites: TestSuite[] = []

  for (const packageName of packageNames) {
    const packagePath = Shared.FS.resolvePath(packageName, packageRoot)
    if (!await Shared.FS.isDirectory(packagePath)) {
      continue
    }
    const testFiles = testFilesByPackage.get(packageName) ?? []
    if (testFiles.length === 0) {
      continue
    }
    suites.push(...packageSuites(packageName, testFiles, pattern))
  }

  suites.push(...performanceCheckSuites(pattern))
  suites.push(...runtimeJestSuites(pattern, jobs))
  suites.push(...taoAppsSuites(pattern))
  return suites
}

/** suiteNode turns one discovered suite into a work-graph node with its scheduling weights. */
function suiteNode(suite: TestSuite): WorkNode {
  const scheduling = SUITE_SCHEDULING.get(suite.name)
  return {
    cost: scheduling?.cost,
    name: suite.name,
    priority: scheduling?.priority,
    run: { args: suite.args, command: suite.command, cwd: suite.cwd },
  }
}

function createSuiteState(suite: TestSuite): SuiteState {
  return WorkGraph.createState(suiteNode(suite))
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
  })
}

/** runTests discovers, runs, reports, and records one `./dev test` invocation. */
async function runTests(pattern = '', options: TestRunOptions = {}): Promise<number> {
  const startedAt = Date.now()
  const location = RunArtifacts.locate({ lane: LANE })
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
    return await runSuites({ location, machineLane, mode: options.outputMode, pattern, startedAt })
  } finally {
    await machineLane.release()
  }
}

type RunSuitesOptions = {
  location: ReturnType<typeof RunArtifacts.locate>
  machineLane: MachineLane
  mode?: OutputMode
  pattern: string
  startedAt: number
}

async function runSuites(options: RunSuitesOptions): Promise<number> {
  const { location, machineLane, pattern } = options
  const suites = await discoverTestSuites(pattern, machineLane.capacity)
  if (suites.length === 0) {
    Shared.HCI.writeLine('No test suites found.')
    return 0
  }

  const mode = options.mode ?? WorkReporter.resolveMode()
  const states = suites.map(createSuiteState)
  await RunArtifacts.assignLogPaths(states, location)
  const timings = await RunTimings.load({ repositoryRoot: location.repositoryRoot })
  const expectedMs = (name: string) => RunTimings.expectedMs(timings, name)
  const reporter = WorkReporter.create({ lane: LANE, logRoot: location.logRoot, mode })

  const result = await WorkGraph.run(states, {
    expectedMs,
    jobs: machineLane.capacity,
    onEvent: event => reporter.handle(event),
  })
  await reporter.finish()
  if (!result.interrupted) {
    await ContentionRetry.confirmContendedFailures({ contention: machineLane.report(), location, states })
  }

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
    taoAppsSkipped: pattern.length > 0,
  })
  Shared.HCI.writeLine(`Summary: ${Shared.FS.displayPath(summaryPath)}`)
  // The graph's result holds the same state objects the retry updated, so a suite that recovered on
  // an isolated retry is already no longer failed here.
  return WorkGraph.exitCodeFor(result)
}

/** reservedJobs reads the width an outer work graph already reserved for this whole process. */
function reservedJobs(): number | undefined {
  const envJobs = Number(Shared.Platform.runtimeProcess.env[WorkGraph.BUDGET_ENV_KEYS.devTest] ?? '')
  return Number.isInteger(envJobs) && envJobs > 0 ? envJobs : undefined
}

function packageSuites(packageName: string, testFiles: string[], pattern: string): TestSuite[] {
  return [bunSuite(packageName, testFiles, pattern)]
}

function bunSuite(name: string, testFiles: string[], pattern: string): TestSuite {
  const args = [
    'test',
    // Bun reads a bare relative path as a filter, walks the whole repository to resolve it, and
    // leaves a file descriptor open per visited entry. Children spawned by a test then inherit an
    // exhausted descriptor table and their piped output never arrives. An absolute path is taken
    // literally, so the walk never happens.
    ...testFiles,
    '--reporter=dot',
    ...(BUN_SUITE_ARGS.get(name) ?? []),
    ...(pattern ? ['--pass-with-no-tests', `--test-name-pattern=${pattern}`] : []),
  ]
  return { name, command: 'bun', args, cwd: Shared.Repo.resolvePath() }
}

function performanceCheckSuites(pattern: string): TestSuite[] {
  return [bunSuite(
    'performance-checks',
    [Shared.Repo.resolvePath('packages/dev/performance-checks/language-performance.test.ts')],
    pattern,
  )]
}

function runtimeJestSuites(pattern: string, jobs?: number): TestSuite[] {
  return [runtimeJestSuite('runtime-jest', [], pattern, jobs)]
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
  }]
}

function runtimeJestSuite(name: string, testFiles: string[], pattern: string, jobs?: number): TestSuite {
  const nodePath = Shared.Repo.resolvePath('.devenv/profile/bin/node')
  const args = [
    'node_modules/jest/bin/jest.js',
    ...testFiles,
    '--no-watchman',
    `--maxWorkers=${runtimeJestWorkers(jobs)}`,
    ...(pattern ? [`--testNamePattern=${pattern}`] : []),
    '--silent',
  ]
  return { name, command: nodePath, args, cwd: Shared.Repo.resolvePath('packages/runtime-toolchain') }
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
  runSuiteProcesses,
  runTests,
}
