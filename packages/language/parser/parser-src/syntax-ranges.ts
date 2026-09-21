import { Langium } from './langium-exports'
import type * as AST from './parserASTExport'

/** SyntaxRange declares a zero-based half-open source offset range. */
export type SyntaxRange = { from: number; to: number }

const commentTokenNames = new Set(['ML_COMMENT', 'SL_COMMENT'])

/** nodeRange returns the source range one AST node's concrete syntax covers, surrounding comments excluded. */
export function nodeRange(node: AST.Node): SyntaxRange | undefined {
  const cst = node.$cstNode
  return cst === undefined ? undefined : { from: cst.offset, to: cst.end }
}

/** keywordRange returns the range of one grammar keyword written directly by `node`'s own rule. */
export function keywordRange(node: AST.Node, keyword: string): SyntaxRange | undefined {
  const cst = Langium.GrammarUtils.findNodeForKeyword(node.$cstNode, keyword)
  return cst === undefined ? undefined : { from: cst.offset, to: cst.end }
}

/** propertyRange returns the range from the first to the last concrete node assigned to `property`. */
export function propertyRange(node: AST.Node, property: string): SyntaxRange | undefined {
  const nodes = Langium.GrammarUtils.findNodesForProperty(node.$cstNode, property)
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  return first === undefined || last === undefined ? undefined : { from: first.offset, to: last.end }
}

/** commentRanges returns every comment in the concrete syntax below `node`, in document order. */
export function commentRanges(node: AST.Node): SyntaxRange[] {
  const root = node.$cstNode
  if (root === undefined) {
    return []
  }
  const comments: SyntaxRange[] = []
  for (const cst of Langium.CstUtils.streamCst(root)) {
    if (Langium.isLeafCstNode(cst) && cst.hidden && commentTokenNames.has(cst.tokenType.name)) {
      comments.push({ from: cst.offset, to: cst.end })
    }
  }
  return comments
}
