/**
 * A wall-clock budget in a test is for a busy host, not for a slow condition: this repository runs
 * under host load averages of 20-85, where a short budget around real work (a process spawn, a file
 * read, a lock) fails for reasons that have nothing to do with the code under test — three such
 * budgets failed landings in one week while passing alone. This rule keeps that finding from coming
 * back: it flags a short `timeoutMs` literal, a `toBeLessThan`/`toBeLessThanOrEqual` speed assertion
 * on something that reads like elapsed wall time, and a `Promise.race` that arbitrates a real result
 * against a bare sleep, in the same test-file scope the sweep covered. `// budget-ok: <reason>` on the
 * line, or on a comment-only line directly above it, is the escape — for a budget the test is
 * genuinely about, or a fake clock that never spends real wall time — matching the repository's
 * `# hook-ok:` idiom. A trailing `// budget-ok:` on the line above answers only for that line's own
 * call; it is not read as standing for the line below, which would let one call's escape cover an
 * unrelated short budget it never named.
 */

const BUDGET_THRESHOLD_MS = 10_000

const TEST_DIRECTORY_PATTERN = /(?:^|\/)(?:[^/]+-tests|studio-smoke)\//
const TEST_FILE_PATTERN = /\.(?:test\.ts|host\.spec\.ts|jest-test\.tsx)$/

/**
 * This rule's own test holds fixture strings that are the violations it proves it catches, so scanning
 * it as ordinary test source would have it flag itself. Excluded rather than escaped: a `budget-ok`
 * comment there would just as well hide a fixture that stopped matching, which is the one thing this
 * exclusion must not do.
 */
const OWN_TEST_PATH = 'packages/testing/verification/verification-tests/test-budget-conventions.test.ts'

const BUDGET_OK_PATTERN = /\/\/\s*budget-ok:\s*\S/

const TIMEOUT_LITERAL_PATTERN = /\btimeoutMs\s*:\s*(\d[\d_]*)(?=\s*(?:[,)}]|$))/g
const SPEED_ASSERTION_PATTERN = /\.toBeLessThan(?:OrEqual)?\(\s*(\d[\d_]*)\s*\)/g
/**
 * A bare `Ms` also matches inside an unrelated identifier like `errorMsgs` or `logMsgCount`, so it is
 * spelled only in the word-boundary shapes a real `...Ms` operand actually ends in: followed by the
 * call's closing paren, a space before further text, or a `-` in a subtraction.
 */
const SPEED_ASSERTION_KEYWORDS = ['Date.now()', 'performance.now()', 'elapsed', 'duration', 'Ms)', 'Ms ', 'Ms -']
const RACE_START_PATTERN = /Promise\.race\(\s*\[/
const RACE_SLEEP_PATTERN = /Time\.sleep\(|setTimeout\(/
/** How many lines a `Promise.race([...])` array is read across before giving up on finding its close. */
const RACE_SCAN_WINDOW = 20

const RULE_DETAIL = 'sets a wall-clock budget in a test below 10,000ms; a budget in a test is for a busy'
  + ' host, not for a slow condition. Raise it to 10_000 or more, wait on an observed condition instead of'
  + ' a sleep, or mark an intentional small budget `// budget-ok: <why>`.'

type SourceFile = { path: string; source: string }

/**
 * testBudgetConventionIssues flags a short wall-clock budget in a test file: an explicit `timeoutMs`
 * literal, a speed assertion on something that reads as elapsed wall time, or a `Promise.race` that
 * lets a bare sleep outrun real work. Scoped to the test-file shapes the sweep in
 * `.artifacts/test-budget-sweep.md` covered: `*-tests/**`, `studio-smoke/**`, `*.test.ts`,
 * `*.host.spec.ts`, `*.jest-test.tsx`.
 */
export function testBudgetConventionIssues(files: readonly SourceFile[]): string[] {
  return files
    .filter(file => isTestBudgetScopedPath(file.path))
    .flatMap(file => testBudgetFileIssues(file.path, file.source))
    .sort()
}

function isTestBudgetScopedPath(path: string): boolean {
  return path !== OWN_TEST_PATH && (TEST_DIRECTORY_PATTERN.test(path) || TEST_FILE_PATTERN.test(path))
}

function testBudgetFileIssues(path: string, source: string): string[] {
  const lines = source.split('\n')
  const issues: string[] = []

  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(TIMEOUT_LITERAL_PATTERN)) {
      if (literalMs(match[1]!) < BUDGET_THRESHOLD_MS && !hasBudgetOk(lines, index)) {
        issues.push(issueAt(path, index))
      }
    }
    for (const match of line.matchAll(SPEED_ASSERTION_PATTERN)) {
      const operand = line.slice(0, match.index ?? 0)
      if (
        literalMs(match[1]!) < BUDGET_THRESHOLD_MS
        && SPEED_ASSERTION_KEYWORDS.some(keyword => operand.includes(keyword))
        && !hasBudgetOk(lines, index)
      ) {
        issues.push(issueAt(path, index))
      }
    }
  }
  issues.push(...raceAgainstSleepIssues(path, lines))
  return issues
}

function literalMs(literal: string): number {
  return Number(literal.replaceAll('_', ''))
}

/**
 * A `// budget-ok:` on the flagged line itself always answers for it. One on the line above answers
 * for it only when that whole line is the comment — a trailing `// budget-ok:` on a line that also
 * holds real code is that code's own escape, not a blanket clearance for whatever sits below it.
 */
function hasBudgetOk(lines: readonly string[], index: number): boolean {
  if (BUDGET_OK_PATTERN.test(lines[index] ?? '')) {
    return true
  }
  const previous = lines[index - 1] ?? ''
  return isCommentOnlyLine(previous) && BUDGET_OK_PATTERN.test(previous)
}

/** isCommentOnlyLine is true when a line's only non-whitespace content is a `//` comment. */
function isCommentOnlyLine(line: string): boolean {
  return /^\s*\/\//.test(line)
}

function issueAt(path: string, lineIndex: number): string {
  return `${path}:${lineIndex + 1} ${RULE_DETAIL}`
}

/**
 * raceAgainstSleepIssues reads forward from `Promise.race([` looking for `Time.sleep(`/`setTimeout(`
 * before the array's own close, within a bounded window — a close-enough read rather than a full
 * bracket-depth parse, sized to the shape every real site in the sweep used.
 */
function raceAgainstSleepIssues(path: string, lines: readonly string[]): string[] {
  const issues: string[] = []
  for (const [index, line] of lines.entries()) {
    if (!RACE_START_PATTERN.test(line)) {
      continue
    }
    const end = Math.min(lines.length, index + RACE_SCAN_WINDOW)
    let span = line
    let closedAt = index
    for (let cursor = index + 1; cursor < end; cursor++) {
      span += `\n${lines[cursor]}`
      closedAt = cursor
      if (lines[cursor]!.includes('])')) {
        break
      }
    }
    if (RACE_SLEEP_PATTERN.test(span) && !escapedAcross(lines, index, closedAt)) {
      issues.push(issueAt(path, index))
    }
  }
  return issues
}

function escapedAcross(lines: readonly string[], start: number, end: number): boolean {
  // The line before the race, like the line before any flagged line, answers for the race only when
  // it is a comment-only line: a trailing `// budget-ok:` there belongs to whatever code sits on it.
  const previous = lines[start - 1] ?? ''
  if (isCommentOnlyLine(previous) && BUDGET_OK_PATTERN.test(previous)) {
    return true
  }
  for (let cursor = start; cursor <= end; cursor++) {
    if (BUDGET_OK_PATTERN.test(lines[cursor] ?? '')) {
      return true
    }
  }
  return false
}
