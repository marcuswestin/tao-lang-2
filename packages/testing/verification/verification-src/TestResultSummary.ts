import { OutputText } from '@cli-kit'
import * as Shared from '@shared'
import { type ContentionReport, MachineLanes } from './MachineLanes'
import { describesTimeout } from './RunSummary'
import type { SuiteState } from './TestRunner'

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

type ResultSummaryOptions = {
  /** What the machine was carrying while the run happened, when the lane sampled it. */
  contention?: ContentionReport
  includeFailureOutput?: boolean
  failureOutputLineLimit?: number
}

const FAILURE_OUTPUT_LINE_LIMIT = 100

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

  printContentionNote(states, options.contention)

  if (failed.length === 0) {
    // Plain, not green: the lane's verdict line is the one coloured statement of the outcome, and a
    // second green line above it both competes with it and writes escape codes into piped output.
    Shared.HCI.writeLine('test suites ok')
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

/**
 * printContentionNote says what the machine was doing, so a slow or timed-out suite is read as the
 * host it ran on rather than as the code it ran over. Silent on a machine this run had to itself:
 * a note nobody needs is a note nobody reads.
 */
function printContentionNote(states: readonly SuiteState[], contention: ContentionReport | undefined): void {
  if (contention === undefined || !contention.contended) {
    return
  }
  const writeLine = states.some(state => state.status === 'failed') ? Shared.HCI.writeErrorLine : Shared.HCI.writeLine
  writeLine(`\nMachine contention: ${MachineLanes.describeContention(contention)}.`)

  const retried = states.filter(state => state.retried === true)
  for (const state of retried) {
    writeLine(`- ${state.name}: ${state.reason ?? 'run again on its own after a contended timeout'}`)
  }
  const timedOut = states.filter(state =>
    state.status === 'failed' && state.retried !== true && describesTimeout(state.fullOutput)
  )
  for (const state of timedOut) {
    if (state.reason?.includes('failure is unconfirmed') === true) {
      writeLine(`- ${state.name}: ${state.reason}.`)
      continue
    }
    writeLine(
      `- ${state.name} ran out of time under that load. Confirm it alone with: ./agent test`
        + ` (or bun test <file>) once the machine is quiet.`,
    )
  }
}

/**
 * printSuiteSummaries reports one line per suite, not per node. A suite's shards run as separate
 * processes, so its duration is its longest shard — the wall time it actually occupied — and the
 * work its shards did together is stated beside it, because that difference is what sharding bought.
 */
function printSuiteSummaries(states: readonly SuiteState[], stderr: boolean): void {
  const writeLine = stderr ? Shared.HCI.writeErrorLine : Shared.HCI.writeLine
  writeLine('\nTest suite summary:')
  const bySuite = new Map<string, SuiteState[]>()
  for (const state of states) {
    bySuite.set(state.suite, [...bySuite.get(state.suite) ?? [], state])
  }
  const lines = [...bySuite].map(([suite, shards]) => {
    const totals = shards.map(suiteTestSummary)
    const sum = (read: (summary: SuiteTestSummary) => number | undefined) =>
      totals.every(summary => read(summary) === undefined)
        ? undefined
        : totals.reduce((count, summary) => count + (read(summary) ?? 0), 0)
    const wallMs = Math.max(0, ...shards.map(state => state.elapsedMs))
    const workMs = shards.reduce((total, state) => total + state.elapsedMs, 0)
    const status = shards.some(state => state.status === 'failed')
      ? 'failed'
      : shards.every(state => state.status === 'skipped')
      ? 'skipped'
      : shards.find(state => state.status !== 'passed')?.status ?? 'passed'
    return {
      line: [
        `- ${suite}: ${status}`,
        `tests ${formatCount(sum(summary => summary.total))}`,
        `pass ${formatCount(sum(summary => summary.passed))}`,
        `fail ${formatCount(sum(summary => summary.failed))}`,
        `expect ${formatCount(sum(summary => summary.expectCalls))}`,
        `duration ${OutputText.formatElapsed(wallMs)}`,
        ...(shards.length > 1
          ? [`${shards.length} shards over ${OutputText.formatElapsed(workMs)}`]
          : []),
      ].join('; '),
      wallMs,
    }
  })
  for (const { line } of lines.toSorted((left, right) => right.wallMs - left.wallMs)) {
    writeLine(line)
  }
}

function printTotalSummary(states: readonly SuiteState[], elapsedMs: number, stderr: boolean): void {
  const writeLine = stderr ? Shared.HCI.writeErrorLine : Shared.HCI.writeLine
  const summary = totalTestSummary(states)
  const suiteElapsedMs = states.reduce((sum, state) => sum + state.elapsedMs, 0)
  writeLine(
    [
      'Total:',
      `${new Set(states.map(state => state.suite)).size} suites in ${states.length} processes`,
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
  if (state.testObservations !== undefined) {
    return {
      failed: state.testObservations.filter(test => test.outcome === 'failed').length,
      passed: state.testObservations.filter(test => test.outcome === 'passed').length,
      total: state.testObservations.length,
    }
  }
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

/** TestResultSummary owns test result parsing, aggregation, and reporting. */
export const TestResultSummary = {
  FAILURE_OUTPUT_LINE_LIMIT,
  displayPath,
  failedSuites,
  printResultSummary,
  suiteExitCode,
} as const
