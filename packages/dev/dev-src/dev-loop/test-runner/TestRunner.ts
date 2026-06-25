import * as Shared from '@shared'
import { OutputText } from '../OutputText'

/** SuiteStatus declares the lifecycle state of one test suite process. */
export type SuiteStatus = 'failed' | 'passed' | 'pending' | 'running'

/** TestSuite declares one executable test suite. */
export type TestSuite = {
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

type SuiteTestSummary = {
  expectCalls?: number
  failed?: number
  passed?: number
  total?: number
}

type TotalTestSummary = {
  expectCalls: number
  failed: number
  missingExpectCalls: number
  missingFailed: number
  missingPassed: number
  missingTotal: number
  passed: number
  total: number
}

type SuiteCommandResult = Shared.CLI.CommandCloseResult & {
  error?: Error
}

export type RunSuiteProcessesOptions = {
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

export type ResultSummaryOptions = {
  includeFailureOutput?: boolean
  failureOutputLineLimit?: number
}

const OUTPUT_LINE_LIMIT = 6
const FAILURE_OUTPUT_LINE_LIMIT = 100
const BUN_SUITE_ARGS = new Map<string, readonly string[]>([
  ['compiler', ['--concurrent']],
  ['dev', ['--concurrent']],
  ['ide-extension', ['--concurrent']],
  ['source-actions', ['--timeout=15000']],
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
  printResultSummary(states, Date.now() - startedAt)
  return suiteExitCode(states)
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

function suiteExitCode(states: readonly SuiteState[]): number {
  return states.some(state => state.status === 'failed') ? 1 : 0
}

function failedSuites(states: readonly SuiteState[]): SuiteState[] {
  return states.filter(state => state.status === 'failed')
}

function printResultSummary(
  states: readonly SuiteState[],
  elapsedMs: number,
  options: ResultSummaryOptions = {},
): void {
  const failed = failedSuites(states)
  printSuiteSummaries(states, failed.length > 0)
  printTotalSummary(states, elapsedMs, failed.length > 0)

  if (failed.length === 0) {
    Shared.HCI.writeSuccess('test suites ok\n')
    return
  }

  Shared.HCI.writeErrorLine('\nFailed test suites:')
  for (const state of failed) {
    Shared.HCI.writeErrorLine(`${state.name}: exit ${state.exitCode ?? 'unknown'}`)
    if (options.includeFailureOutput === true) {
      printFailureOutput(state, options.failureOutputLineLimit ?? FAILURE_OUTPUT_LINE_LIMIT)
    }
    Shared.HCI.writeErrorLine(`log: ${displayPath(state.logPath ?? '')}`)
  }
}

function printSuiteSummaries(states: readonly SuiteState[], stderr: boolean): void {
  const writeLine = stderr ? Shared.HCI.writeErrorLine : Shared.HCI.writeLine
  writeLine('\nTest suite summary:')
  for (const state of [...states].sort((left, right) => right.elapsedMs - left.elapsedMs)) {
    const summary = suiteTestSummary(state)
    writeLine(
      [
        `- ${state.name}: ${state.status}`,
        `tests ${formatCount(summary.total)}`,
        `pass ${formatCount(summary.passed)}`,
        `fail ${formatCount(summary.failed)}`,
        `expect ${formatCount(summary.expectCalls)}`,
        `duration ${OutputText.formatElapsed(state.elapsedMs)}`,
      ].join('; '),
    )
  }
}

function printTotalSummary(states: readonly SuiteState[], elapsedMs: number, stderr: boolean): void {
  const writeLine = stderr ? Shared.HCI.writeErrorLine : Shared.HCI.writeLine
  const summary = totalTestSummary(states)
  const suiteElapsedMs = states.reduce((sum, state) => sum + state.elapsedMs, 0)
  writeLine(
    [
      'Total:',
      `${states.length} suites`,
      `tests ${formatAggregateCount(summary.total, summary.missingTotal)}`,
      `pass ${formatAggregateCount(summary.passed, summary.missingPassed)}`,
      `fail ${formatAggregateCount(summary.failed, summary.missingFailed)}`,
      `expect ${formatAggregateCount(summary.expectCalls, summary.missingExpectCalls)}`,
      `wall ${OutputText.formatElapsed(elapsedMs)}`,
      `suite sum ${OutputText.formatElapsed(suiteElapsedMs)}`,
    ].join(' '),
  )
}

function totalTestSummary(states: readonly SuiteState[]): TotalTestSummary {
  const total: TotalTestSummary = {
    expectCalls: 0,
    failed: 0,
    missingExpectCalls: 0,
    missingFailed: 0,
    missingPassed: 0,
    missingTotal: 0,
    passed: 0,
    total: 0,
  }
  for (const state of states) {
    const summary = suiteTestSummary(state)
    total.passed += summary.passed ?? 0
    total.failed += summary.failed ?? 0
    total.expectCalls += summary.expectCalls ?? 0
    total.total += summary.total ?? 0
    total.missingPassed += summary.passed === undefined ? 1 : 0
    total.missingFailed += summary.failed === undefined ? 1 : 0
    total.missingExpectCalls += summary.expectCalls === undefined ? 1 : 0
    total.missingTotal += summary.total === undefined ? 1 : 0
  }
  return total
}

function suiteTestSummary(state: SuiteState): SuiteTestSummary {
  const output = OutputText.sanitize(state.fullOutput)
  return parseBunTestSummary(output) ?? parseJestTestSummary(output) ?? {}
}

function parseBunTestSummary(output: string): SuiteTestSummary | undefined {
  const passed = numberFromLine(output, /(?:^|\n)\s*(\d+)\s+pass(?:\n|$)/)
  const failed = numberFromLine(output, /(?:^|\n)\s*(\d+)\s+fail(?:\n|$)/)
  const expectCalls = numberFromLine(output, /(?:^|\n)\s*(\d+)\s+expect\(\)\s+calls?(?:\n|$)/)
  const total = numberFromLine(output, /(?:^|\n)Ran\s+(\d+)\s+tests?\s+across\s+\d+\s+files?\./)
  if (passed === undefined && failed === undefined && expectCalls === undefined && total === undefined) {
    return undefined
  }
  return { expectCalls, failed, passed, total }
}

function parseJestTestSummary(output: string): SuiteTestSummary | undefined {
  const line = output.split('\n').find(outputLine => outputLine.trim().startsWith('Tests:'))
  if (line === undefined) {
    return undefined
  }
  const counts = countsByLabel(line)
  return {
    failed: counts.get('failed') ?? 0,
    passed: counts.get('passed') ?? 0,
    total: counts.get('total'),
  }
}

function countsByLabel(line: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const match of line.matchAll(/(\d+)\s+(failed|passed|skipped|todo|total)/g)) {
    const value = Number(match[1])
    const label = match[2]
    if (Number.isInteger(value) && label !== undefined) {
      counts.set(label, value)
    }
  }
  return counts
}

function numberFromLine(output: string, pattern: RegExp): number | undefined {
  const match = output.match(pattern)
  const value = Number(match?.[1])
  return Number.isInteger(value) ? value : undefined
}

function formatCount(value: number | undefined): string {
  return value === undefined ? 'n/a' : String(value)
}

function formatAggregateCount(value: number, missingSuites: number): string {
  if (missingSuites === 0) {
    return String(value)
  }
  return `${value}+n/a(${missingSuites})`
}

function printFailureOutput(state: SuiteState, lineLimit: number): void {
  const lines = OutputText.sanitize(state.fullOutput)
    .split('\n')
    .filter(line => line.length > 0)
  if (lines.length === 0) {
    return
  }

  const visibleLines = lines.slice(-lineLimit)
  const omittedCount = lines.length - visibleLines.length
  Shared.HCI.writeErrorLine('error output:')
  if (omittedCount > 0) {
    Shared.HCI.writeErrorLine(`... ${omittedCount} earlier output line${omittedCount === 1 ? '' : 's'} omitted ...`)
  }
  for (const line of visibleLines) {
    Shared.HCI.writeErrorLine(line)
  }
}

function displayPath(path: string): string {
  if (!path) {
    return '(none)'
  }
  const relative = Shared.FS.relativePath(Shared.Repo.resolvePath(), path)
  return relative.startsWith('..') ? path : relative
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
  FAILURE_OUTPUT_LINE_LIMIT,
  createSuiteState,
  discoverTestSuites,
  displayPath,
  failedSuites,
  printResultSummary,
  runSuiteProcesses,
  runSuitesInterleaved,
  suiteExitCode,
  writeSuiteLogs,
}
