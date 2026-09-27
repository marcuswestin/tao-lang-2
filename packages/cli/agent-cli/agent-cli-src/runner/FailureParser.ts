/**
 * The fallback failure parser runs when a command's output names no usable `summary.json` failures.
 * Verification owns the rich classification
 * (`RunSummary.classifyFailure`); this stays tiny and reads two shapes only — a Bun `(fail)` line
 * paired with the nearest `error:` line above it, and a bare `tsc` diagnostic.
 */

/** AgentFailure is one failure this front door can name, from either a lane's summary or the
 * fallback parser below — the two are printed through the same block. */
export type AgentFailure = {
  error?: string
  file?: string
  gate: string
  test?: string
}

const FAIL_LINE = /^\(fail\)\s+(.+?)(?:\s*\[[\d.]+\s*m?s\])?\s*$/
const ERROR_LINE = /^error:\s*(.+)$/
const PATH_LINE = /^([^\s].*\.(?:ts|tsx|tao)):\s*$/
const TSC_LINE = /^(.+?\.tsx?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/
/** How far above a `(fail)` line to look for the `error:` and file lines that explain it, so a
 * search never wanders into the test before it. */
const MAX_LOOKBACK = 20

/** parseFailuresFromOutput reads a command's captured output for the failures its own summary
 * artifact did not report. */
export function parseFailuresFromOutput(output: string, gate: string): AgentFailure[] {
  const lines = output.split('\n')
  const failures: AgentFailure[] = []
  for (const [index, line] of lines.entries()) {
    const failMatch = FAIL_LINE.exec(line)
    if (failMatch !== null) {
      failures.push({ gate, test: failMatch[1], ...precedingContext(lines, index) })
      continue
    }
    const tscMatch = TSC_LINE.exec(line)
    if (tscMatch !== null) {
      failures.push({
        error: `${tscMatch[4]}: ${tscMatch[5]}`,
        file: `${tscMatch[1]}:${tscMatch[2]}:${tscMatch[3]}`,
        gate,
      })
    }
  }
  return failures
}

function precedingContext(lines: readonly string[], failIndex: number): { error?: string; file?: string } {
  let error: string | undefined
  let file: string | undefined
  const earliest = Math.max(0, failIndex - MAX_LOOKBACK)
  for (let index = failIndex - 1; index >= earliest && (error === undefined || file === undefined); index -= 1) {
    const line = lines[index] ?? ''
    error ??= ERROR_LINE.exec(line)?.[1]
    file ??= PATH_LINE.exec(line)?.[1]
  }
  return { error, file }
}
