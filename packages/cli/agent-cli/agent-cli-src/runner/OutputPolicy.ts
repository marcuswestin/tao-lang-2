import { OutputText } from '@cli-kit'

/**
 * The one place a command's output policy lives. `report` commands are the ones whose output IS
 * the answer — `help`, `board`, `doctor` — so they print generously; everything else is a `gate`,
 * whose own final summary line is what matters and whose chattiest output is a wall an agent never
 * asked to read. An unknown command defaults to `gate`, the narrower of the two.
 */

const REPORT_COMMANDS = new Set([
  'bench',
  'board',
  'capabilities',
  'delegation-report',
  'doctor',
  'help',
  'land-lock',
  'landed',
  'report-test-stats',
  'simplify-audit',
])

/** WRAP_WIDTH keeps one runaway advisory line from carrying the whole output budget by itself. */
const WRAP_WIDTH = 240

const REPORT_FULL_LINES = 200
const REPORT_HEAD_LINES = 120
const REPORT_TAIL_LINES = 60
const GATE_SUCCESS_LINES = 25
const GATE_FAILURE_LINES = 40

export type OutputCategory = 'gate' | 'report'

/** outputCategoryFor reports which output policy a command's output is bounded by. */
export function outputCategoryFor(command: string): OutputCategory {
  return REPORT_COMMANDS.has(command) ? 'report' : 'gate'
}

/** BoundedOutput is a command's captured output, normalized and bounded for printing. */
export type BoundedOutput = {
  /** Lines cut from the middle (a report) or the front (a gate) to stay inside the budget. */
  elided: number
  lines: string[]
}

/**
 * boundOutput turns a child's captured output into what an agent should actually read: ANSI
 * stripped, hard-wrapped at `WRAP_WIDTH`, then bounded by the command's policy. A `report` keeps
 * the head and the tail with an elision line between them, since the answer can be anywhere; a
 * `gate` keeps only the tail, where a lane's own closing summary lives.
 */
export function boundOutput(
  output: string,
  category: OutputCategory,
  status: 'failed' | 'passed',
  maxLines?: number,
): BoundedOutput {
  const wrapped = wrapLines(output)
  return category === 'report'
    ? boundReportOutput(wrapped, maxLines)
    : boundGateOutput(wrapped, status, maxLines)
}

function boundReportOutput(wrapped: readonly string[], maxLines: number | undefined): BoundedOutput {
  const budget = maxLines ?? REPORT_FULL_LINES
  if (wrapped.length <= budget) {
    return { elided: 0, lines: [...wrapped] }
  }
  const head = maxLines === undefined ? REPORT_HEAD_LINES : Math.ceil((budget * 2) / 3)
  const tail = maxLines === undefined ? REPORT_TAIL_LINES : budget - head
  const elided = wrapped.length - head - tail
  return {
    elided,
    lines: [...wrapped.slice(0, head), elisionLine(elided), ...wrapped.slice(wrapped.length - tail)],
  }
}

function boundGateOutput(
  wrapped: readonly string[],
  status: 'failed' | 'passed',
  maxLines: number | undefined,
): BoundedOutput {
  const budget = maxLines ?? (status === 'failed' ? GATE_FAILURE_LINES : GATE_SUCCESS_LINES)
  if (wrapped.length <= budget) {
    return { elided: 0, lines: [...wrapped] }
  }
  return { elided: wrapped.length - budget, lines: wrapped.slice(-budget) }
}

function elisionLine(count: number): string {
  return `… and ${count} more line${count === 1 ? '' : 's'} …`
}

function wrapLines(output: string): string[] {
  const stripped = OutputText.stripAnsi(output).replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  // A process's own output ends in a newline as a matter of convention, not as a blank line it
  // meant to print; splitting it verbatim would otherwise count one line that was never there. A
  // command that printed nothing at all — including nothing but that trailing newline — has no
  // lines to report, not one empty one.
  const trimmed = stripped.endsWith('\n') ? stripped.slice(0, -1) : stripped
  if (trimmed === '') {
    return []
  }
  return trimmed.split('\n').flatMap(line => OutputText.wrapLine(line, WRAP_WIDTH))
}
