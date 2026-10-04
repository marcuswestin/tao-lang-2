import { AST, Parser } from '@parser'
import type { StudioLensFacet } from './client/StudioLens'
import { StudioHighlight, type StudioLanguageHighlight } from './StudioHighlight'

export type StudioLensRange = { from: number; to: number }

/** How a node presents when its facet is off: keep its head and glyph its body, or vanish outright. */
export type StudioLensCollapse = 'head' | 'vanish'

/**
 * StudioLensNode is one lens-relevant syntax node: the facet it belongs to, where it sits, and how
 * it collapses. `body` is the payload a glyph stands in for; a head-collapsing node without one is
 * shown whole even when its facet is off, because its head is all there is.
 */
export type StudioLensNode = {
  body?: StudioLensRange
  children: StudioLensNode[]
  collapse: StudioLensCollapse
  facet: StudioLensFacet
  from: number
  kind: string
  to: number
}

/** StudioLensMap is the classification of one source text; `complete` is false when the parse recovered from errors. */
export type StudioLensMap = {
  complete: boolean
  nodes: StudioLensNode[]
}

/** StudioLanguageAnalysis is the highlight endpoint's full answer: colors and, when parsing succeeded, the lens map. */
export type StudioLanguageAnalysis = StudioLanguageHighlight & {
  lens?: StudioLensMap
}

type StudioLensDescription = Omit<StudioLensNode, 'children' | 'from' | 'to'>

/** StudioSyntaxLens classifies Tao source into facet-tagged ranges the editor can fold by meaning. */
export const StudioSyntaxLens = {
  classify,
  classifySource,
} as const

function classify(input: unknown): StudioLensMap {
  return classifySource(StudioHighlight.request(input).content)
}

function classifySource(content: string): StudioLensMap {
  const parsed = Parser.parseSyntax(content)
  const nodes = collect(parsed.ast)
  for (const comment of parsed.comments) {
    insert(nodes, {
      children: [],
      collapse: 'vanish',
      facet: 'comments',
      from: comment.from,
      kind: 'comment',
      to: comment.to,
    })
  }
  sortTree(nodes)
  return { complete: parsed.errors === 0, nodes }
}

function collect(node: AST.Node): StudioLensNode[] {
  const children = AST.streamContents(node).flatMap(collect)
  const range = AST.nodeRange(node)
  const description = range === undefined ? undefined : describe(node, range)
  if (range === undefined || description === undefined) {
    return children
  }
  return [{ ...description, children, from: range.from, to: range.to }]
}

function insert(nodes: StudioLensNode[], comment: StudioLensNode): void {
  const host = nodes.find(candidate => candidate.from <= comment.from && comment.to <= candidate.to)
  if (host === undefined) {
    nodes.push(comment)
  } else {
    insert(host.children, comment)
  }
}

function sortTree(nodes: StudioLensNode[]): void {
  nodes.sort((left, right) => left.from - right.from || right.to - left.to)
  for (const node of nodes) {
    sortTree(node.children)
  }
}

function describe(node: AST.Node, range: StudioLensRange): StudioLensDescription | undefined {
  if (AST.isViewDeclaration(node)) {
    return head('structure', 'view', blockOr(node, 'foreign') ?? tail(AST.keywordRange(node, '='), range))
  }
  if (AST.isRenderStatement(node) || AST.isViewRender(node)) {
    return vanish('structure', 'render')
  }
  if (
    AST.isWhenRenderStatement(node) || AST.isIfRenderStatement(node) || AST.isGuardRenderStatement(node)
    || AST.isForStatement(node)
  ) {
    return vanish('structure', 'render-flow')
  }
  if (AST.isWhenRenderBranch(node) || AST.isWhenRenderOtherwise(node) || AST.isGuardRenderBranch(node)) {
    return vanish('structure', 'render-branch')
  }
  if (AST.isRenderSlotDeclaration(node) || AST.isRenderSlotUse(node) || AST.isCallerContentStatement(node)) {
    return vanish('structure', 'slot')
  }
  if (AST.isDeclarationSlotFill(node)) {
    return vanish('structure', 'slot-fill')
  }
  if (AST.isLayoutClause(node)) {
    return head('layout', 'layout', interior(range))
  }
  if (AST.isDesignDeclaration(node)) {
    return head('layout', 'design', AST.propertyRange(node, 'block'))
  }
  if (AST.isEventHandler(node) || AST.isLoopSelectHandler(node)) {
    return head('behavior', 'handler', tail(AST.keywordRange(node, '->') ?? AST.propertyRange(node, 'action'), range))
  }
  if (AST.isActionDeclaration(node)) {
    return head('behavior', 'action', blockOr(node, 'foreign'))
  }
  if (AST.isActionExpression(node)) {
    return head('behavior', 'action-value', range)
  }
  if (AST.isCommandDeclaration(node)) {
    return head('behavior', 'command', tail(AST.keywordRange(node, '='), range))
  }
  if (AST.isFunctionDeclaration(node)) {
    return head('behavior', 'function', AST.propertyRange(node, 'block'))
  }
  if (AST.isStateDeclaration(node)) {
    return vanish('data', 'state')
  }
  if (AST.isAliasDeclaration(node)) {
    return AST.isTaoFile(node.$container)
      ? head('data', 'binding', tail(AST.keywordRange(node, 'is') ?? AST.keywordRange(node, '='), range))
      : vanish('data', 'binding')
  }
  if (AST.isEntityQueryDeclaration(node)) {
    return head('data', 'query', AST.propertyRange(node, 'block'))
  }
  if (AST.isTypeDeclaration(node)) {
    return head('data', 'type', tail(AST.keywordRange(node, 'is') ?? AST.keywordRange(node, '='), range))
  }
  if (AST.isEntityDataDeclaration(node)) {
    return head('data', 'data', AST.propertyRange(node, 'block'))
  }
  if (AST.isPrimitiveDeclaration(node)) {
    return head('data', 'primitive', undefined)
  }
  if (AST.isUseStatement(node) || AST.isUsePackageStatement(node)) {
    return vanish('wiring', 'use')
  }
  if (AST.isAppDeclaration(node) || AST.isNavDeclaration(node) || AST.isDatasourceDeclaration(node)) {
    return head('wiring', 'configuration', AST.propertyRange(node, 'block') ?? tail(AST.keywordRange(node, '='), range))
  }
  if (AST.isInjection(node)) {
    return head(
      'wiring',
      'inject',
      tail(AST.propertyRange(node, 'argumentList') ?? AST.propertyRange(node, 'tsCodeBlock'), range),
    )
  }
  if (
    AST.isTestDeclaration(node) || AST.isFixtureDeclaration(node) || AST.isScenarioGroupDeclaration(node)
    || AST.isScenarioDeclaration(node)
  ) {
    return head('tests', 'test', AST.propertyRange(node, 'block'))
  }
  if (AST.isTagStatement(node)) {
    return vanish('tests', 'tag')
  }
  return undefined
}

function head(facet: StudioLensFacet, kind: string, body: StudioLensRange | undefined): StudioLensDescription {
  return body === undefined || body.to <= body.from
    ? { collapse: 'head', facet, kind }
    : { body, collapse: 'head', facet, kind }
}

function vanish(facet: StudioLensFacet, kind: string): StudioLensDescription {
  return { collapse: 'vanish', facet, kind }
}

/** blockOr prefers a declaration's own block and falls back to the named property that replaces it. */
function blockOr(node: AST.Node, property: string): StudioLensRange | undefined {
  return AST.propertyRange(node, 'block') ?? AST.propertyRange(node, property)
}

/** tail spans from the start of `start` to the end of the node, so the head before it survives. */
function tail(start: StudioLensRange | undefined, range: StudioLensRange): StudioLensRange | undefined {
  return start === undefined ? undefined : { from: start.from, to: range.to }
}

/** interior is what sits between a clause's single-character delimiters. */
function interior(range: StudioLensRange): StudioLensRange | undefined {
  return range.to - range.from > 2 ? { from: range.from + 1, to: range.to - 1 } : undefined
}
