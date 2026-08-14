import * as Shared from '@shared'
import { OutputText } from '../OutputText'
import { TestResultSummary } from './TestResultSummary'

/** SuiteStatus declares the lifecycle state of one test suite process. */
export type SuiteStatus = 'failed' | 'passed' | 'pending' | 'running'

/** TestSuite declares one executable test suite. */
type TestSuite = {
  name: string
  command: string
  args: string[]
  cwd?: string
}

/** SuiteState tracks one test suite's process output and status. */
export type SuiteState = TestSuite & {
  elapsedMs: number
  exitCode?: number | null
  fullOutput: string
  lines: string[]
  logPath?: string
  startedAt?: number
  status: SuiteStatus
}

type SuiteCommandResult = Shared.CLI.CommandCloseResult & {
  error?: Error
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
}

const OUTPUT_LINE_LIMIT = 6
const BUN_SUITE_ARGS = new Map<string, readonly string[]>([
  ['compiler', ['--concurrent']],
  ['dev', ['--concurrent']],
  ['ide-extension', ['--concurrent']],
  ['validator', ['--concurrent']],
])
const SUITE_PRIORITIES = new Map<string, number>([
  ['runtime-jest', 4],
  ['tao-apps', 4],
  ['source-actions', 3],
  ['tao-cli', 2],
])

async function discoverTestSuites(pattern = ''): Promise<TestSuite[]> {
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

  suites.push(...runtimeJestSuites(pattern))
  suites.push(...taoAppsSuites(pattern))
  return suites
}

function createSuiteState(suite: TestSuite): SuiteState {
  return {
    ...suite,
    elapsedMs: 0,
    fullOutput: '',
    lines: [],
    status: 'pending',
  }
}

async function runSuiteProcesses(
  states: SuiteState[],
  options: RunSuiteProcessesOptions,
): Promise<void> {
  const queue = [...states].sort((left, right) => suitePriority(right) - suitePriority(left))
  let nextSuite = 0
  const workerCount = Math.min(maxSuiteJobs(options.jobs), queue.length)

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextSuite < queue.length) {
      const state = queue[nextSuite++]!
      await runSuite(state, options)
    }
  }))
}

async function runSuitesInterleaved(pattern = '', options: TestRunOptions = {}): Promise<number> {
  const startedAt = Date.now()
  const suites = await discoverTestSuites(pattern)
  if (suites.length === 0) {
    Shared.HCI.writeLine('No test suites found.')
    return 0
  }

  const states = suites.map(createSuiteState)
  const outputState: InterleavedOutputState = { pending: new Map() }
  Shared.HCI.writeLine(`Running ${states.length} test suites...`)
  await runSuiteProcesses(states, {
    jobs: options.jobs,
    onChange: () => {},
    onComplete: state => {
      flushInterleavedOutput(outputState, state)
      Shared.HCI.logProcessInfo(state.name, `${state.status} in ${OutputText.formatElapsed(state.elapsedMs)}`)
    },
    onOutput: (state, output) => writeInterleavedOutput(outputState, state, output),
    onStart: state => Shared.HCI.logProcessInfo(state.name, 'started'),
  })

  for (const state of states) {
    flushInterleavedOutput(outputState, state)
  }
  await writeSuiteLogs(states)
  TestResultSummary.printResultSummary(states, Date.now() - startedAt)
  return TestResultSummary.suiteExitCode(states)
}

async function writeSuiteLogs(states: readonly SuiteState[]): Promise<void> {
  const logRoot = Shared.Repo.resolvePath(
    `.artifacts/logs/dev-test/${new Date().toISOString().replaceAll(/[:.]/g, '-')}`,
  )
  await Shared.FS.mkdir(logRoot)
  await Promise.all(states.map(async state => {
    state.logPath = Shared.FS.resolvePath(`${state.name}.log`, logRoot)
    await Shared.FS.writeText(state.logPath, state.fullOutput)
  }))
}

function packageSuites(packageName: string, testFiles: string[], pattern: string): TestSuite[] {
  return [bunSuite(packageName, testFiles, pattern)]
}

function bunSuite(name: string, testFiles: string[], pattern: string): TestSuite {
  const args = [
    'test',
    ...testFiles.map(path => Shared.FS.relativePath(Shared.Repo.resolvePath(), path)),
    '--reporter=dot',
    ...(BUN_SUITE_ARGS.get(name) ?? []),
    ...(pattern ? [`--test-name-pattern=${pattern}`] : []),
  ]
  return { name, command: 'bun', args, cwd: Shared.Repo.resolvePath() }
}

function runtimeJestSuites(pattern: string): TestSuite[] {
  return [runtimeJestSuite('runtime-jest', [], pattern)]
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

function runtimeJestSuite(name: string, testFiles: string[], pattern: string): TestSuite {
  const nodePath = Shared.Repo.resolvePath('.devenv/profile/bin/node')
  const args = [
    'node_modules/jest/bin/jest.js',
    ...testFiles,
    ...(pattern ? [`--testNamePattern=${pattern}`] : []),
    '--silent',
  ]
  return { name, command: nodePath, args, cwd: Shared.Repo.resolvePath('packages/runtime') }
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

function maxSuiteJobs(requestedJobs: number | undefined): number {
  if (requestedJobs !== undefined) {
    return requestedJobs
  }
  const envJobs = Number(Shared.Platform.runtimeProcess.env['TAO_DEV_TEST_JOBS'] ?? '')
  if (Number.isInteger(envJobs) && envJobs > 0) {
    return envJobs
  }
  return Shared.Platform.cpuCount()
}

function suitePriority(state: SuiteState): number {
  return SUITE_PRIORITIES.get(state.name) ?? 0
}

async function runSuite(state: SuiteState, options: RunSuiteProcessesOptions): Promise<void> {
  state.status = 'running'
  state.startedAt = Date.now()
  options.onStart?.(state)
  options.onChange()

  let command: Shared.CLI.StartedCommand | undefined
  try {
    command = Shared.CLI.start(state.command, {
      args: state.args,
      cwd: state.cwd,
      onOutput: (_stream, chunk) => {
        const output = String(chunk)
        appendOutput(state, output)
        options.onOutput?.(state, output)
        options.onChange()
      },
      stdio: 'pipe',
    })

    const result = await waitForSuiteCommand(command)
    state.elapsedMs = elapsedMs(state)
    state.exitCode = result.error === undefined ? result.exitCode : null
    state.status = result.error === undefined && result.exitCode === 0 ? 'passed' : 'failed'
    if (result.error !== undefined) {
      appendOutput(state, errorMessage(result.error))
    }
  } catch (error) {
    state.elapsedMs = elapsedMs(state)
    state.exitCode = null
    state.status = 'failed'
    appendOutput(state, errorMessage(error))
  } finally {
    command?.dispose()
  }
  options.onComplete?.(state)
  options.onChange()
}

async function waitForSuiteCommand(command: Shared.CLI.StartedCommand): Promise<SuiteCommandResult> {
  return await new Promise(resolve => {
    let settled = false
    const finish = (result: SuiteCommandResult) => {
      if (settled) {
        return
      }
      settled = true
      resolve(result)
    }
    command.onceError(error => {
      finish({ error, exitCode: null, signal: null })
    })
    command.waitForClose().then(result => {
      finish({ ...result, error: command.error })
      return result
    })
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function appendOutput(state: SuiteState, output: string): void {
  state.fullOutput += output
  state.lines = OutputText.sanitize(state.fullOutput)
    .split('\n')
    .filter(line => line.length > 0)
    .slice(-OUTPUT_LINE_LIMIT)
}

function elapsedMs(state: SuiteState): number {
  return state.startedAt === undefined ? 0 : Date.now() - state.startedAt
}

type InterleavedOutputState = {
  pending: Map<string, string>
}

function writeInterleavedOutput(outputState: InterleavedOutputState, state: SuiteState, output: string): void {
  const buffer = { pending: outputState.pending.get(state.name) ?? '' }
  OutputText.appendCompleteLines(buffer, output, line => {
    if (line.length > 0) {
      Shared.HCI.logProcessOutput(state.name, line)
    }
  })
  outputState.pending.set(state.name, buffer.pending)
}

function flushInterleavedOutput(outputState: InterleavedOutputState, state: SuiteState): void {
  const buffer = { pending: outputState.pending.get(state.name) ?? '' }
  if (buffer.pending.length === 0) {
    return
  }
  OutputText.flushPendingLine(buffer, line => Shared.HCI.logProcessOutput(state.name, line))
  outputState.pending.delete(state.name)
}

/** TestRunner owns package test discovery, sharding, process execution, and logs. */
export const TestRunner = {
  OUTPUT_LINE_LIMIT,
  FAILURE_OUTPUT_LINE_LIMIT: TestResultSummary.FAILURE_OUTPUT_LINE_LIMIT,
  createSuiteState,
  discoverTestSuites,
  displayPath: TestResultSummary.displayPath,
  failedSuites: TestResultSummary.failedSuites,
  printResultSummary: TestResultSummary.printResultSummary,
  runSuiteProcesses,
  runSuitesInterleaved,
  suiteExitCode: TestResultSummary.suiteExitCode,
  writeSuiteLogs,
}
