import * as Shared from '@shared'
import { OutputText } from '../cli/OutputText'
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
  includeFailureOutput?: boolean
  failureOutputLineLimit?: number
  taoAppsSkipped?: boolean
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

  if (options.taoAppsSkipped === true) {
    // A pattern selects tests by name and the Tao app suite has no name-level filter, so it is
    // dropped from discovery entirely. Without this line a filtered run reads as full coverage.
    Shared.HCI.writeLine('Note: the tao-apps suite was skipped; a test-name pattern cannot select Tao behavior tests.')
  }

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

/** TestResultSummary owns test result parsing, aggregation, and reporting. */
export const TestResultSummary = {
  FAILURE_OUTPUT_LINE_LIMIT,
  displayPath,
  failedSuites,
  printResultSummary,
  suiteExitCode,
} as const
