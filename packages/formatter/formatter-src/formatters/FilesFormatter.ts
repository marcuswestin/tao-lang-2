import { AST } from '@parser'
import type { FormatHandlers } from '../formatting'

export const FilesFormatter = {
  /**
   * TaoFile formats top-level statements one blank line apart. Within use and let groups,
   * neighbors stay adjacent but keep an existing blank line, capped at one. A declaration that
   * states its visibility never joins such a group.
   */
  TaoFile(f) {
    f.separateLines(f.node.statements, (previous, next) => isGroupedPair(previous, next) ? { min: 1, max: 2 } : 2)
  },
} satisfies Partial<FormatHandlers>

function isGroupedPair(previous: AST.Statement, next: AST.Statement): boolean {
  // A visibility modifier sits on its own line above its declaration, so running it directly under
  // the previous declaration reads as if it belonged to that one. Such a declaration always starts
  // a new group, whatever it would otherwise pair with.
  if (hasVisibilityModifier(next)) {
    return false
  }
  return (AST.isUseStatement(previous) && AST.isUseStatement(next))
    || (AST.isAliasDeclaration(previous) && AST.isAliasDeclaration(next))
}

function hasVisibilityModifier(statement: AST.Statement): boolean {
  return 'visibility' in statement && statement.visibility !== undefined
}
