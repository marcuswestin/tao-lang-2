import { AST } from '@parser'
import type { FormatHandlers } from './formatting'

export default {
  /** TaoFile formats top-level statements one blank line apart, keeping use and alias groups adjacent. */
  TaoFile(f) {
    f.separateLines(f.node.statements, (previous, next) => isGroupedPair(previous, next) ? 1 : 2)
  },
} satisfies FormatHandlers

function isGroupedPair(previous: AST.Statement, next: AST.Statement): boolean {
  return (AST.isUseStatement(previous) && AST.isUseStatement(next))
    || (AST.isAliasDeclaration(previous) && AST.isAliasDeclaration(next))
}
