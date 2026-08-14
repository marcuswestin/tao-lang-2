import { AST, Langium } from '@parser'
import type { FormatHandlers } from '../formatting'

export const ActionsFormatter = {
  /** ActionBlock formats action bodies with one indented statement per line. */
  ActionBlock(f) {
    f.oneSpaceBefore('{')
    const canUseSingleLineActionBody = AST.isActionExpression(f.node.$container)
      && f.node.statements.length === 1
      && !hasInteriorComments(f.node)
    if (canUseSingleLineActionBody) {
      f.singleLineBraceBlock(f.node.statements[0]!)
      return
    }
    f.indentedBraceBlock(f.node.statements)
  },

  /** ActionDeclaration formats a named action header and body. */
  ActionDeclaration(f) {
    f.oneSpaceAfter('file', 'package', 'workspace', 'public', 'action')
    f.oneSpaceBeforeProperty('parameterList')
  },

  /** ActionExpression formats inline action bodies. */
  ActionExpression() {},

  /** ToggleStatement formats boolean state inversion. */
  ToggleStatement(f) {
    f.oneSpaceAfter('toggle')
  },

  /** GuardActionStatement separates its subject from either single or grouped cases. */
  GuardActionStatement(f) {
    f.oneSpaceAfter('guard')
    f.oneSpaceBeforeProperty('caseBlock', 'single')
  },

  /** GuardActionCaseBlock puts each case on one indented line. */
  GuardActionCaseBlock(f) {
    f.indentedBraceBlock(f.node.branches)
    f.lineSeparatedList(f.node.branches)
  },

  /** GuardActionBranch formats its optional handler and error payload. */
  GuardActionBranch(f) {
    f.oneSpaceBefore('->')
    if (f.node.payload !== undefined) {
      f.oneSpaceAfter('->')
    }
  },

  /** IfActionStatement separates its boolean condition from its one-sided body. */
  IfActionStatement(f) {
    f.oneSpaceAfter('if')
  },

  /** DoStatement formats action invocation spacing. */
  DoStatement(f) {
    f.oneSpaceAfter('do')
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },

  /** AskStatement formats its local binding and dialogue invocation. */
  AskStatement(f) {
    f.oneSpaceAfter('let', 'ask')
    f.oneSpaceBefore('=')
    f.oneSpaceAfter('=')
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },

  /** RespondStatement separates an optional declared response case. */
  RespondStatement(f) {
    if (f.node.case) {
      f.oneSpaceAfter('respond')
    }
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
