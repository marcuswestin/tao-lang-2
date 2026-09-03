// Studio agent chat: what a view shows, and which of it any test actually looks at.
//
// The semantic graph knows what a view renders. It does not know what the tests do, because a `.test.tao`
// sidecar imports the app rather than the other way round, so nothing reachable from the app entry ever
// reaches it. This reads the sidecars directly and matches them against the view's own literals.
//
// The match is textual and says so. A test asserts `expect text "No comments yet"`; a render declares
// `Text("No comments yet")`. Interpolated text cannot match whole, so its fixed fragments are compared
// instead, and every result carries how it was decided so nothing here is mistaken for a compiler fact.

import type { SemanticSnapshot, SnapshotNode } from '../agent-poc/SemanticSnapshot'

export type TestCheck = { suite: string; name: string; literals: readonly string[] }

export type CoveredText = {
  text: string
  /** Names of the checks that appear to exercise this text. */
  checks: readonly string[]
  /** How the match was decided, so a reader can judge it. */
  by: 'exact' | 'fragment' | 'none'
}

export type ViewCoverage = {
  view: string
  shows: readonly CoveredText[]
  /** Actions the view can invoke, and whether any check presses something that reaches them. */
  actions: readonly { name: string; pressedByAnyCheck: boolean }[]
  checks: readonly string[]
  note: string
}

/** parseChecks pulls each check and the quoted strings inside it out of one test file. */
export function parseChecks(content: string): TestCheck[] {
  const checks: TestCheck[] = []
  const lines = content.split('\n')
  const stack: { name: string; depth: number }[] = []
  let depth = 0
  let current: { suite: string; name: string; literals: string[] } | undefined
  for (const line of lines) {
    const test = /^\s*test\s+"([^"]*)"\s*\{/.exec(line)
    if (test !== null) {
      // The outer `test` is the suite; the inner ones are the checks a failure is named after.
      if (stack.length > 0) {
        if (current !== undefined) {
          checks.push(current)
        }
        current = { literals: [], name: test[1]!, suite: stack[0]!.name }
      }
      stack.push({ depth, name: test[1]! })
    } else if (current !== undefined) {
      for (const match of line.matchAll(/"([^"]*)"/g)) {
        const text = match[1]!
        if (text.trim() !== '') {
          current.literals.push(text)
        }
      }
    }
    depth += (line.split('{').length - 1) - (line.split('}').length - 1)
    while (stack.length > 0 && depth <= stack[stack.length - 1]!.depth) {
      stack.pop()
      if (stack.length === 0 && current !== undefined) {
        checks.push(current)
        current = undefined
      }
    }
  }
  if (current !== undefined) {
    checks.push(current)
  }
  return checks
}

/** fragments returns the fixed parts of an interpolated string: what a test could match on. */
function fragments(text: string): string[] {
  return text.split(/\{[^}]*\}/).map(part => part.trim()).filter(part => part.length >= 3)
}

function textsOf(snapshot: SemanticSnapshot, view: SnapshotNode): string[] {
  const texts: string[] = []
  for (const node of snapshot.nodes.values()) {
    if (node.kind !== 'render' || node.detail?.['owner'] !== view.name) {
      continue
    }
    for (const entry of (node.detail?.['texts'] ?? []) as { text: string }[]) {
      const unquoted = entry.text.replace(/^"|"$/g, '')
      if (unquoted.trim() !== '' && !texts.includes(unquoted)) {
        texts.push(unquoted)
      }
    }
  }
  return texts
}

export function viewCoverage(
  snapshot: SemanticSnapshot,
  view: SnapshotNode,
  checks: readonly TestCheck[],
): ViewCoverage {
  const shows = textsOf(snapshot, view).map((text): CoveredText => {
    const exact = checks.filter(check => check.literals.includes(text))
    if (exact.length > 0) {
      return { by: 'exact', checks: exact.map(check => check.name), text }
    }
    const parts = fragments(text)
    const partial = parts.length === 0
      ? []
      : checks.filter(check => parts.some(part => check.literals.some(literal => literal.includes(part))))
    return partial.length > 0
      ? { by: 'fragment', checks: partial.map(check => check.name), text }
      : { by: 'none', checks: [], text }
  })

  const actions = snapshot.edges
    .filter(edge => edge.from === view.id && edge.rel === 'invokes')
    .map(edge => snapshot.nodes.get(edge.to)?.name ?? edge.to)
    .filter((name, index, all) => all.indexOf(name) === index)
    .map(name => {
      // A check reaches an action by pressing a control whose label the view renders, so an action counts as
      // exercised only when some check presses text this view actually shows.
      const labels = shows.filter(entry => entry.by !== 'none').flatMap(entry => entry.checks)
      return { name, pressedByAnyCheck: labels.length > 0 }
    })

  const uncovered = shows.filter(entry => entry.by === 'none').length
  return {
    actions,
    checks: checks.map(check => check.name),
    note:
      `Matched by text, not by the compiler: a check that asserts a string this view renders is treated as exercising it. ${
        uncovered === 0
          ? 'Every text this view shows appears in some check.'
          : `${uncovered} of ${shows.length} texts this view shows appear in no check.`
      }`,
    shows,
    view: view.name,
  }
}
