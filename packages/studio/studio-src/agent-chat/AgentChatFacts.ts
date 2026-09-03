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
): AgentChatFact[] {
  const facts: AgentChatFact[] = []
  const incoming = (id: string, rel: string) => snapshot.edges.filter(edge => edge.to === id && edge.rel === rel)
  const outgoing = (id: string, rel: string) => snapshot.edges.filter(edge => edge.from === id && edge.rel === rel)

  if (compile === undefined) {
    for (const problem of snapshot.diagnostics) {
      if (problem.severity !== 'error') {
        continue
      }
      facts.push({
        detail: `The project does not parse cleanly: ${problem.message}`,
        evidence: `${problem.source} diagnostic${problem.filePath === undefined ? '' : ` at ${problem.filePath}`}`,
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
        kind: 'compile-problem',
        subject: problem.filePath ?? snapshot.appName,
      })
    }
  }

  // A `covers` edge names a scenario's own subject, so counting it alone calls almost every view uncovered:
  // an app-level scenario exercises everything the app renders without naming any of it. Coverage is
  // therefore what a scenario's subject reaches through `renders`, and a view named directly is said so.
  const rendered = new Map<string, string[]>()
  for (const edge of snapshot.edges) {
    if (edge.rel === 'renders') {
      rendered.set(edge.from, [...(rendered.get(edge.from) ?? []), edge.to])
    }
  }
  const directlyCovered = new Set(snapshot.edges.filter(edge => edge.rel === 'covers').map(edge => edge.to))
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

  for (const view of nodesOfKind(snapshot, 'view')) {
    if (!reached.has(view.id)) {
      facts.push({
        detail:
          `No scenario reaches ${view.name}: none names it, and nothing a scenario does show renders it. Nothing in the preview grid puts it in a known state.`,
        evidence: where(view),
        kind: 'view-without-scenario',
        subject: view.name,
      })
    } else if (!directlyCovered.has(view.id)) {
      facts.push({
        detail:
          `${view.name} is only reached through another view's scenario, so it is never shown on its own in a known state.`,
        evidence: where(view),
        kind: 'view-covered-only-indirectly',
        subject: view.name,
      })
    }
  }

  for (const action of nodesOfKind(snapshot, 'action')) {
    if (incoming(action.id, 'invokes').length === 0) {
      facts.push({
        detail: `Nothing invokes ${action.name}; it is declared but unreachable from any render or action.`,
        evidence: where(action),
        kind: 'action-never-invoked',
        subject: action.name,
      })
    }
  }

  for (const field of nodesOfKind(snapshot, 'field')) {
    const reads = incoming(field.id, 'reads').length
    const writes = incoming(field.id, 'writes').length
    if (reads === 0 && writes > 0) {
      facts.push({
        detail: `${field.name} is written but never read, so nothing in the app shows or uses the value.`,
        evidence: where(field),
        kind: 'field-written-never-read',
        subject: field.name,
      })
    }
    if (reads === 0 && writes === 0) {
      facts.push({
        detail: `${field.name} is declared but neither read nor written anywhere in the app.`,
        evidence: where(field),
        kind: 'field-unused',
        subject: field.name,
      })
    }
  }

  // Every fact here is a claim about absence, and absence has two causes: the thing is genuinely unused, or
  // the graph cannot see that relation for this app at all. Reporting the second as the first is how an
  // advisory answer becomes confidently wrong, so a relation with no edges anywhere says nothing.
  const anyStyling = snapshot.edges.some(edge => edge.rel === 'styled-by')
  for (const bundle of anyStyling ? nodesOfKind(snapshot, 'bundle') : []) {
    if (incoming(bundle.id, 'styled-by').length === 0) {
      facts.push({
        detail: `The ${bundle.name} bundle is declared in the design but no render uses it.`,
        evidence: where(bundle),
        kind: 'bundle-unused',
        subject: bundle.name,
      })
    }
  }

  for (const entity of nodesOfKind(snapshot, 'entity')) {
    if (outgoing(entity.id, 'queries').length === 0 && incoming(entity.id, 'queries').length === 0) {
      facts.push({
        detail: `No query reads ${entity.name}; its rows can only be reached through a direct handle.`,
        evidence: where(entity),
        kind: 'entity-never-queried',
        subject: entity.name,
      })
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
