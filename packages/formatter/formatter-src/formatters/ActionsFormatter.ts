import { AST, Langium } from '@parser'
import type { FormatHandlers } from '../formatting'

export const ActionsFormatter = {
  /** ActionBlock formats action bodies with one indented statement per line. */
  ActionBlock(f) {
    f.oneSpaceBefore('{')
    if (
      AST.isActionExpression(f.node.$container)
      && f.node.statements.length === 1
      && !hasInteriorComments(f.node)
    ) {
      f.singleLineBraceBlock(f.node.statements[0]!)
      return
    }
    f.indentedBraceBlock(f.node.statements)
  },

  /** ActionDeclaration formats a named action header and body. */
  ActionDeclaration(f) {
    f.oneSpaceAfter('package', 'project', 'publish', 'action')
    f.oneSpaceBeforeProperty('parameterList')
  },

  /** ActionExpression formats inline action bodies. */
  ActionExpression() {},

  /** ToggleStatement formats boolean state inversion. */
  ToggleStatement(f) {
    f.oneSpaceAfter('toggle')
  },

  /** WhenActionStatement puts each branch and its required fallback on an indented line. */
  WhenActionStatement(f) {
    f.indentedLines([...f.node.branches, f.node.otherwise])
  },

  /** WhenActionBranch spaces its condition against the branch arrow. */
  WhenActionBranch(f) {
    f.oneSpaceBefore('->')
  },

  /** WhenActionOtherwise spaces the fallback keyword against the branch arrow. */
  WhenActionOtherwise(f) {
    f.oneSpaceBefore('->')
  },

  /** DoStatement formats action invocation spacing. */
  DoStatement(f) {
    f.oneSpaceAfter('do')
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },
} satisfies Partial<FormatHandlers>

function hasInteriorComments(block: AST.ActionBlock): boolean {
  const cst = block.$cstNode
  if (cst === undefined) {
    return false
  }
  return Langium.CstUtils.flattenCst(cst.root).toArray().some(node =>
    node.hidden && node.offset >= cst.offset && node.end <= cst.end
  )
}
