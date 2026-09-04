// Studio agent chat: the facts an advisory answer is allowed to rest on.
//
// "What should I build next?" and "where can this app improve?" are judgment questions, but the judgment has
// to stand on something checkable. These functions derive that something from the semantic graph: a view no
// scenario covers, an action nothing invokes, a field nothing reads, a token nothing uses. Every fact carries
// the evidence that produced it, so an answer can cite it and a person can open the source and disagree.

import type { SemanticSnapshot, SnapshotNode } from '../agent-poc/SemanticSnapshot'

export type AgentChatFact = {
  /** A short machine-readable class, so the panel and the tests can group facts without parsing prose. */
  kind: string
  /** The declaration the fact is about, in the graph's own naming. */
  subject: string
  /** One sentence a person can read. */
  detail: string
  /** Where the claim comes from: a source location, or the relation that was counted. */
  evidence: string
  /**
   * How the relation behind this fact is derived. `compiler` means resolved cross-references; `poc-derived`
   * means a name-matching heuristic, and a fact resting on one is a strong hint rather than a proof. Every
   * fact here is a claim about absence, so the reader has to know which it is.
   */
  from: 'compiler' | 'poc-derived' | 'mixed'
}

export type AgentChatOutline = {
  path: string
  declarations: readonly { kind: string; name: string; line: number }[]
}

function lineOf(content: string, start: number | undefined): number {
  if (start === undefined) {
    return 1
  }
  return content.slice(0, start).split('\n').length
}

function nodesOfKind(snapshot: SemanticSnapshot, kind: SnapshotNode['kind']): SnapshotNode[] {
  return [...snapshot.nodes.values()].filter(node => node.kind === kind)
}

function where(node: SnapshotNode): string {
  return node.path === undefined ? `${node.kind} ${node.name}` : `${node.path}:${node.start ?? 0}`
}

/**
 * fileOutlines answers "how is this app structured, in terms of files" without reading a single file body.
 * The graph already knows which declaration sits in which file and where.
 */
export function fileOutlines(
  snapshot: SemanticSnapshot,
  files: readonly { path: string; content: string }[],
): AgentChatOutline[] {
  const byPath = new Map<string, { kind: string; name: string; line: number }[]>()
  const interesting = new Set<SnapshotNode['kind']>([
    'app',
    'view',
    'entity',
    'action',
    'query',
    'design',
    'scenario',
    'fixture',
  ])
  for (const node of snapshot.nodes.values()) {
    if (node.path === undefined || !interesting.has(node.kind)) {
      continue
    }
    const content = files.find(file => file.path === node.path)?.content ?? ''
    const entries = byPath.get(node.path) ?? []
    entries.push({ kind: node.kind, line: lineOf(content, node.start), name: node.name })
    byPath.set(node.path, entries)
  }
  return files
    .filter(file => byPath.has(file.path))
    .map(file => ({
      declarations: (byPath.get(file.path) ?? []).sort((a, b) => a.line - b.line),
      path: file.path,
    }))
}

/**
 * improvementFacts is the whole grounding for an advisory answer. It never says what to do; it says what is
 * true and unusual, and leaves the judgment to the model and the person reading it.
 */
export function improvementFacts(
  snapshot: SemanticSnapshot,
  /**
   * The project's real compile state. The snapshot's own diagnostics come from a parse with validation off,
   * so they see lexer, parser and linker errors only; a validator error would otherwise be reported as a
   * clean build.
   */
  compile?: { status: string; diagnostics: readonly { message: string; filePath?: string }[] },
  /**
   * The project's source. Several relations in this graph are narrower than the language: `reads` sees no
   * `order by` or `index`, and `invokes` misses handlers it does not walk. Where the source can settle a
   * claim the graph cannot, reading it is the difference between a fact and a confident falsehood.
   */
  files: readonly { path: string; content: string }[] = [],
): AgentChatFact[] {
  const facts: AgentChatFact[] = []
  const incoming = (id: string, rel: string) => snapshot.edges.filter(edge => edge.to === id && edge.rel === rel)
  const outgoing = (id: string, rel: string) => snapshot.edges.filter(edge => edge.from === id && edge.rel === rel)

  // Every fact below is a claim that something is absent, and absence has two causes: the thing is genuinely
  // unused, or this graph does not model that relation for this app. A relation with no edges anywhere cannot
  // tell the two apart, so it produces no facts at all rather than accusing every declaration of being dead.
  const source = files.map(file => file.content).join('\n')
  const mentions = (pattern: RegExp) => source !== '' && pattern.test(source)
  const edgesOf = (rel: string) => snapshot.edges.filter(edge => edge.rel === rel)
  const canDecide = (rel: string) => edgesOf(rel).length > 0
  const originOf = (rel: string): AgentChatFact['from'] => {
    const origins = new Set(edgesOf(rel).map(edge => edge.origin))
    return origins.size === 1 ? [...origins][0] as 'compiler' | 'poc-derived' : 'mixed'
  }
  const absence = (rel: string, node: SnapshotNode) =>
    `${where(node)} — no ${rel} edge reaches it, out of ${edgesOf(rel).length} in this project`
  const unmodelled = (rel: string, what: string) => {
    facts.push({
      detail:
        `This graph has no ${rel} relation for ${snapshot.appName} at all, so nothing here can say whether ${what}. Do not treat that as evidence either way.`,
      evidence: `0 ${rel} edges in the whole project`,
      from: 'compiler',
      kind: 'relation-not-modelled',
      subject: rel,
    })
  }

  if (compile === undefined) {
    for (const problem of snapshot.diagnostics) {
      if (problem.severity !== 'error') {
        continue
      }
      facts.push({
        detail: `The project does not parse cleanly: ${problem.message}`,
        evidence: `${problem.source} diagnostic${problem.filePath === undefined ? '' : ` at ${problem.filePath}`}`,
        from: 'compiler',
        kind: 'parse-problem',
        subject: problem.filePath ?? snapshot.appName,
      })
    }
  } else {
    for (const problem of compile.diagnostics) {
      facts.push({
        detail: `The project does not compile cleanly: ${problem.message}`,
        evidence: `Studio compile status ${compile.status}${
          problem.filePath === undefined ? '' : ` at ${problem.filePath}`
        }`,
        from: 'compiler',
        kind: 'compile-problem',
        subject: problem.filePath ?? snapshot.appName,
      })
    }
  }

  // Coverage: a `covers` edge names a scenario's own subject, which may be the app rather than a view. An
  // app-level scenario exercises everything the app renders without naming any of it, so coverage follows
  // `renders` from the subject. An app node has no outgoing `renders` edge, so when the only scenarios are
  // app-level the graph cannot decide coverage for any view -- and says that, instead of accusing all of them.
  const rendered = new Map<string, string[]>()
  for (const edge of snapshot.edges) {
    if (edge.rel === 'renders') {
      rendered.set(edge.from, [...(rendered.get(edge.from) ?? []), edge.to])
    }
  }
  const directlyCovered = new Set(edgesOf('covers').map(edge => edge.to))
  const reached = new Set<string>()
  const queue = [...directlyCovered]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (reached.has(id)) {
      continue
    }
    reached.add(id)
    queue.push(...(rendered.get(id) ?? []))
  }
  // A scenario whose subject is the app exercises whatever the app renders, but an app node has no outgoing
  // `renders` edge, so the walk stops there. While any such scenario exists, "no scenario reaches this view"
  // cannot be said about any view: the app-level ones may well reach it.
  const appScenarios = [...directlyCovered].filter(id => id.startsWith('app:'))
  const appReaches = appScenarios.some(id => (rendered.get(id) ?? []).length > 0)
  const undecidable = appScenarios.length > 0 && !appReaches
  if (!canDecide('covers')) {
    unmodelled('covers', 'any view is shown in a known state')
  } else if (undecidable) {
    facts.push({
      detail:
        `${appScenarios.length} of this app's scenarios name the app itself rather than a view, and this graph has no edge from an app to the views it shows. Which views those scenarios reach cannot be decided here, so no view can be called uncovered.`,
      evidence: `${edgesOf('covers').length} covers edges, ${appScenarios.length} onto app nodes with no renders edge`,
      from: 'compiler',
      kind: 'relation-not-modelled',
      subject: 'covers',
    })
  } else {
    for (const view of nodesOfKind(snapshot, 'view')) {
      if (!reached.has(view.id)) {
        facts.push({
          detail:
            `No scenario reaches ${view.name}: none names it, and nothing a scenario does show renders it. Nothing in the preview grid puts it in a known state.`,
          evidence: absence('covers', view),
          from: originOf('covers'),
          kind: 'view-without-scenario',
          subject: view.name,
        })
      } else if (!directlyCovered.has(view.id)) {
        facts.push({
          detail:
            `${view.name} is only reached through another view's scenario, so it is never shown on its own in a known state.`,
          evidence: `${where(view)} — reached through renders, not named by a scenario`,
          from: originOf('renders'),
          kind: 'view-covered-only-indirectly',
          subject: view.name,
        })
      }
    }
  }

  if (!canDecide('invokes')) {
    unmodelled('invokes', 'any action is reachable')
  } else {
    for (const action of nodesOfKind(snapshot, 'action')) {
      // The edge is only built for handlers this graph walks, and it misses some. `do Start(5.min)` in the
      // source settles it, and an action named anywhere in a `do` or a command is not a dead one.
      const bare = action.name.split('.').pop() ?? action.name
      const invokedInSource = mentions(new RegExp(`\\bdo\\s+${bare}\\b`))
        || mentions(new RegExp(`=\\s*${bare}\\s*\\(`))
      if (incoming(action.id, 'invokes').length === 0 && !invokedInSource) {
        facts.push({
          detail: `Nothing invokes ${action.name}; no render or action reaches it, and no \`do\` names it.`,
          evidence: absence('invokes', action),
          from: 'poc-derived',
          kind: 'action-never-invoked',
          subject: action.name,
        })
      }
    }
  }

  // A field is read in ways this graph does not model -- `order by`, `index`, relation traversal -- so
  // "never read" is only reported for a field nothing writes either, and even then as a weaker claim.
  if (canDecide('reads') && canDecide('writes')) {
    for (const field of nodesOfKind(snapshot, 'field')) {
      // A field used only to order or index a collection is read by the declaration itself, which produces
      // no `reads` edge. That is an ordinary way to use a field, not a dead one.
      const bare = field.name.split('.').pop() ?? field.name
      const usedByDeclaration = mentions(new RegExp(`\\b(?:order by|index)\\s+${bare}\\b`))
      if (
        incoming(field.id, 'reads').length === 0 && incoming(field.id, 'writes').length > 0 && !usedByDeclaration
      ) {
        facts.push({
          detail: `${field.name} is written but no render or action reads it, and nothing orders or indexes by it.`,
          evidence: absence('reads', field),
          from: 'poc-derived',
          kind: 'field-written-never-read',
          subject: field.name,
        })
      }
    }
  }

  // Bundles: `styled-by` is only emitted for a single-word layout entry that names a bundle of the app's
  // selected design. A design's component-default rules (`AppSurface`, `NavigationHost`) and its scheme rules
  // apply by element or scheme rather than by being named, so this relation cannot tell an unused bundle from
  // one it structurally cannot see. It therefore says nothing about bundles at all.
  if (canDecide('styled-by')) {
    facts.push({
      detail:
        'Which design bundles go unused cannot be decided here: a bundle is only linked when a layout entry names it, and component-default and scheme rules are never named that way.',
      evidence: `${edgesOf('styled-by').length} styled-by edges, all from named layout entries`,
      from: 'compiler',
      kind: 'relation-not-modelled',
      subject: 'styled-by',
    })
  }

  if (canDecide('queries')) {
    // A `queries` edge is only built by matching a query's name to a collection, so a query written over a
    // relation -- `query Thread from Story.Comments` -- produces none. Its source text still names the
    // entity, and reading that is the difference between a true fact and a confident falsehood.
    const querySources = nodesOfKind(snapshot, 'query').map(node => String(node.detail?.['source'] ?? ''))
    for (const entity of nodesOfKind(snapshot, 'entity')) {
      const singular = String(entity.detail?.['singular'] ?? '')
      const named = querySources.some(source =>
        new RegExp(`\\b${entity.name}\\b`).test(source)
        || (singular !== '' && new RegExp(`\\b${singular}\\b`).test(source))
      )
      if (!named && outgoing(entity.id, 'queries').length === 0 && incoming(entity.id, 'queries').length === 0) {
        facts.push({
          detail: `No query in this graph reads ${entity.name}, by name or through a relation.`,
          evidence: absence('queries', entity),
          from: 'poc-derived',
          kind: 'entity-never-queried',
          subject: entity.name,
        })
      }
    }
  }

  // Render concentration: one view carrying most of an app's rendering is worth naming, without calling it wrong.
  const renderCounts = new Map<string, number>()
  for (const render of nodesOfKind(snapshot, 'render')) {
    const owner = String(render.detail?.['owner'] ?? '')
    if (owner !== '') {
      renderCounts.set(owner, (renderCounts.get(owner) ?? 0) + 1)
    }
  }
  const totalRenders = [...renderCounts.values()].reduce((sum, count) => sum + count, 0)
  for (const [owner, count] of renderCounts) {
    if (totalRenders >= 8 && count / totalRenders > 0.5) {
      facts.push({
        detail: `${owner} holds ${count} of the app's ${totalRenders} render sites, over half of them.`,
        evidence: `counted renders edges owned by ${owner}`,
        from: originOf('renders'),
        kind: 'render-concentration',
        subject: owner,
      })
    }
  }

  return facts
}

/**
 * declarationSource returns one declaration's own text. The model never names a file path or an offset: it
 * names a declaration, and Tao resolves where that lives.
 */
export function declarationSource(
  files: readonly { path: string; content: string }[],
  node: SnapshotNode,
): { path: string; line: number; source: string } | undefined {
  if (node.path === undefined || node.start === undefined || node.end === undefined) {
    return undefined
  }
  const content = files.find(file => file.path === node.path)?.content
  if (content === undefined) {
    return undefined
  }
  return {
    line: lineOf(content, node.start),
    path: node.path,
    source: content.slice(node.start, node.end),
  }
}
