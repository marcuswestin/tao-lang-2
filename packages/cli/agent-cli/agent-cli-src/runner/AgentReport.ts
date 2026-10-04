import { OutputText } from '@cli-kit'
import type { AgentFailure } from './FailureParser'
import { boundOutput, outputCategoryFor } from './OutputPolicy'

/**
 * The report every `./agent` command ends with: a start line before the child runs, then — once it
 * exits — a verdict, the failures a lane or the fallback parser named, the child's own output
 * bounded by its command's policy, and the log path again as the last line so it is never scrolled
 * past. Pure formatting, so it is tested without spawning anything.
 */

const MAX_FAILURE_LINES = 20

/** AgentRunOutcome is everything a finished run needs to report, independent of how it was spawned. */
export type AgentRunOutcome = {
  args: readonly string[]
  command: string
  durationMs: number
  exitCode: number
  failures: readonly AgentFailure[]
  logPath: string
  /** Set when writing the log itself failed (a denied `mkdir`, an EACCES write): the report explains
   * why instead of naming a path that was never written. The run's own verdict, failures, and output
   * are never affected — a log failure must never cost the run's real result. */
  logUnavailable?: string
  output: string
  /** Warnings from the selected command and its own structured summary, independent of the tail. */
  warnings?: readonly string[]
}

export type BuildReportOptions = {
  maxLines?: number
  verbose?: boolean
}

/** startLine is the one line a command prints before its child runs. */
export function startLine(command: string, logPath: string): string {
  return `${command}: running — log ${logPath}`
}

/** verdictLine states a run's outcome in one line: pass or fail, its exit code, and how long it took. */
function verdictLine(outcome: Pick<AgentRunOutcome, 'command' | 'durationMs' | 'exitCode'>): string {
  const status = outcome.exitCode === 0 ? 'passed' : 'failed'
  return `${outcome.command}: ${status} (exit ${outcome.exitCode}) in ${OutputText.formatElapsed(outcome.durationMs)}`
}

/** BoundedFailures is a failure list capped at `MAX_FAILURE_LINES`, shared by the text and JSON
 * reports so neither can cap at a different limit than the other. */
type BoundedFailures = {
  failures: readonly AgentFailure[]
  truncated: boolean
}

/** boundFailures caps a failure list at `MAX_FAILURE_LINES`, the one limit both report shapes honor. */
function boundFailures(failures: readonly AgentFailure[]): BoundedFailures {
  const shown = failures.slice(0, MAX_FAILURE_LINES)
  return { failures: shown, truncated: shown.length < failures.length }
}

/** failedBlock renders the `Failed:` block, bounded to `MAX_FAILURE_LINES` plus an elision line;
 * empty when nothing failed, so a passing run never prints an empty header. */
export function failedBlock(failures: readonly AgentFailure[]): string[] {
  if (failures.length === 0) {
    return []
  }
  const bounded = boundFailures(failures)
  const more = failures.length - bounded.failures.length
  return ['Failed:', ...bounded.failures.map(failureLine), ...(more > 0 ? [`… and ${more} more`] : [])]
}

function failureLine(failure: AgentFailure): string {
  const test = failure.test === undefined ? '' : ` — ${failure.test}`
  const error = dedupedFailureText(failure.error, failure.test)
  const file = dedupedFailureText(failure.file, failure.test)
  return `  - ${failure.gate}${test}${error === undefined ? '' : ` — ${error}`}${
    file === undefined ? '' : ` (${file})`
  }`
}

/** dedupedFailureText is `value`, or undefined when `test` already carries the same text — a repo-lint
 * or dead-exports issue's own detail would otherwise repeat once as `test` and again as `error`. */
function dedupedFailureText(value: string | undefined, test: string | undefined): string | undefined {
  return value === undefined || (test !== undefined && test.includes(value)) ? undefined : value
}

/** outcomeStatus is the pass/fail read of an outcome's exit code, shared by the text and JSON reports. */
function outcomeStatus(exitCode: number): 'failed' | 'passed' {
  return exitCode === 0 ? 'passed' : 'failed'
}

/**
 * buildReportText renders the closing report for the default (non-JSON) mode. `--verbose` already
 * streamed the child's output live, so the report omits reprinting it and closes with the verdict,
 * the failures, and the log path only.
 */
export function buildReportText(outcome: AgentRunOutcome, options: BuildReportOptions = {}): string {
  const failed = failedBlock(outcome.failures)
  const lines = [
    'REPORT:',
    verdictLine(outcome),
    ...(outcome.warnings ?? []).map(warning => `WARNING: ${warning}`),
    ...failed,
  ]
  if (options.verbose !== true) {
    const bounded = boundOutput(
      outcome.output,
      outputCategoryFor(outcome.command),
      outcomeStatus(outcome.exitCode),
      options.maxLines,
    )
    lines.push(...(failed.length > 0 ? stripChildFailedBlock(bounded.lines) : bounded.lines))
  }
  lines.push(outcome.logUnavailable === undefined ? outcome.logPath : `log unavailable: ${outcome.logUnavailable}`)
  return lines.join('\n')
}

/**
 * stripChildFailedBlock drops one contiguous `Failed:` block from a child's own tail — a line that
 * reads exactly `Failed:` through the run of `- ` / `  - ` lines right after it — so a failure this
 * report already named in its own `Failed:` block above is not read a second time below. A tail with
 * no such line is returned unchanged.
 */
function stripChildFailedBlock(lines: readonly string[]): string[] {
  const start = lines.indexOf('Failed:')
  if (start === -1) {
    return [...lines]
  }
  let end = start + 1
  while (end < lines.length && isFailedBlockEntry(lines[end]!)) {
    end += 1
  }
  return [...lines.slice(0, start), ...lines.slice(end)]
}

function isFailedBlockEntry(line: string): boolean {
  return line.startsWith('- ') || line.startsWith('  - ')
}

/** AgentJsonReport is the one object `--json` prints, and nothing else. `failuresTruncated` is true
 * only when `failures` was cut to `MAX_FAILURE_LINES`, the same cap the text report's `Failed:`
 * block honors — a JSON reader otherwise has no way to tell a complete list from a cut one. */
export type AgentJsonReport = {
  args: readonly string[]
  command: string
  durationMs: number
  exitCode: number
  failures: readonly AgentFailure[]
  failuresTruncated: boolean
  logPath: string
  logUnavailable?: string
  tail: readonly string[]
  warnings: readonly string[]
}

/** buildJsonReport renders the same outcome `--json` asked for instead of the printed report. */
export function buildJsonReport(outcome: AgentRunOutcome, options: BuildReportOptions = {}): AgentJsonReport {
  const bounded = boundOutput(
    outcome.output,
    outputCategoryFor(outcome.command),
    outcomeStatus(outcome.exitCode),
    options.maxLines,
  )
  const boundedFailures = boundFailures(outcome.failures)
  return {
    args: outcome.args,
    command: outcome.command,
    durationMs: outcome.durationMs,
    exitCode: outcome.exitCode,
    failures: boundedFailures.failures,
    failuresTruncated: boundedFailures.truncated,
    logPath: outcome.logPath,
    ...(outcome.logUnavailable === undefined ? {} : { logUnavailable: outcome.logUnavailable }),
    tail: boundedFailures.failures.length > 0 ? stripChildFailedBlock(bounded.lines) : bounded.lines,
    warnings: outcome.warnings ?? [],
  }
}
