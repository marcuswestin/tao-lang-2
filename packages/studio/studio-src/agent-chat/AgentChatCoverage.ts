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

/** tagOf normalises a render's tag to the `#name` a test step writes, whichever form the graph stored. */
function tagOf(node: SnapshotNode | undefined): string | undefined {
  const tag = node?.detail?.['tag']
  return tag === undefined ? undefined : `#${String(tag).replace(/^#/, '')}`
}

export type TestCheck = { suite: string; name: string; literals: readonly string[] }

type CoveredText = {
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

/** stripped removes comments and string bodies so brace counting sees only structure. */
function stripped(line: string): string {
  const withoutStrings = line.replace(/"[^"]*"/g, '""')
  const comment = withoutStrings.indexOf('//')
  return comment < 0 ? withoutStrings : withoutStrings.slice(0, comment)
}

/** literalsIn returns the quoted strings and `#tag` selectors a step names. */
function literalsIn(line: string): string[] {
  const withoutComment = line.includes('//') ? line.slice(0, line.indexOf('//')) : line
  const found = [...withoutComment.matchAll(/"([^"]*)"/g)].map(match => match[1]!).filter(text => text.trim() !== '')
  // A check drives WordFlower's UI with `press #deleteWorkspace`, never with the label. Ignoring tags called
  // every text in those views untested.
  return [...found, ...[...withoutComment.matchAll(/#([A-Za-z_]\w*)/g)].map(match => `#${match[1]!}`)]
}

/**
 * parseChecks pulls each check and the literals inside it out of one test file.
 *
 * The nesting is counted over structure only: a `}` inside a string or a comment used to pop the suite and
 * silently drop every later check in the file, and WordFlower's real test files carry both.
 */
export function parseChecks(content: string): TestCheck[] {
  const checks: TestCheck[] = []
  const lines = content.split('\n')
  const stack: { name: string; depth: number }[] = []
  let depth = 0
  let current: { suite: string; name: string; literals: string[] } | undefined
  const close = () => {
    if (current !== undefined) {
      checks.push(current)
      current = undefined
    }
  }
  for (const line of lines) {
    const structure = stripped(line)
    const test = /^\s*test\s+"([^"]*)"\s*\{/.exec(line)
    if (test !== null) {
      // The outermost `test` is the suite; anything nested inside it is a check. A file whose only `test` is
      // flat has one check and no suite, and is read that way rather than yielding nothing.
      close()
      if (stack.length > 0) {
        current = { literals: [], name: test[1]!, suite: stack[0]!.name }
      }
      stack.push({ depth, name: test[1]! })
      // A one-line check carries its steps on the same line, after the brace.
      if (current !== undefined) {
        current.literals.push(...literalsIn(line.slice(test[0].length)))
      }
    } else if (current !== undefined) {
      current.literals.push(...literalsIn(line))
    }
    depth += (structure.split('{').length - 1) - (structure.split('}').length - 1)
    while (stack.length > 0 && depth <= stack[stack.length - 1]!.depth) {
      stack.pop()
      if (stack.length === 0) {
        close()
      }
    }
  }
  close()
  if (checks.length === 0) {
    // A flat file declares its checks at the top level, so each `test` is one.
    for (const [index, line] of lines.entries()) {
      const test = /^\s*test\s+"([^"]*)"\s*\{/.exec(line)
      if (test !== null) {
        // Past the header, so the check's own name is not counted as something it asserts.
        const body = lines.slice(index).join('\n').slice(test[0].length)
        const end = body.indexOf('\n}')
        checks.push({
          literals: literalsIn(end < 0 ? body : body.slice(0, end)),
          name: test[1]!,
          suite: test[1]!,
        })
      }
    }
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
  const tags = [...snapshot.nodes.values()]
    .filter(node => node.kind === 'render' && node.detail?.['owner'] === view.name)
    .map(node => tagOf(node))
    .filter((tag): tag is string => tag !== undefined)
  const shows = [...textsOf(snapshot, view), ...tags].map((text): CoveredText => {
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

  // An action is reached by pressing a control, and a check names that control by its `#tag` or its label.
  // The previous version computed one boolean for the whole view and stamped it on every action, which said
  // the opposite of what it claimed whenever any text in the view was asserted.
  const invoked = snapshot.edges.filter(edge => edge.from === view.id && edge.rel === 'invokes')
  const actions = invoked
    .map(edge => snapshot.nodes.get(edge.to)?.name ?? edge.to)
    .filter((name, index, all) => all.indexOf(name) === index)
    .map(name => {
      const bare = name.split('.').pop() ?? name
      // The render that invokes the action carries the tag or the label a check would name.
      const handles = snapshot.edges
        .filter(edge => edge.rel === 'invokes' && (snapshot.nodes.get(edge.to)?.name ?? edge.to) === name)
        .map(edge => snapshot.nodes.get(edge.from))
        .flatMap(node => [
          ...(tagOf(node) === undefined ? [] : [tagOf(node)!]),
          ...((node?.detail?.['texts'] ?? []) as { text: string }[]).map(entry => entry.text.replace(/^"|"$/g, '')),
        ])
      return {
        name,
        pressedByAnyCheck: checks.some(check =>
          check.literals.some(literal => handles.includes(literal) || literal === `#${bare}`)
        ),
      }
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
