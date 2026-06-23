import type { FormatHandlers } from '../formatting'

export const ActionsFormatter = {
  /** ActionBlock formats action bodies with one indented statement per line. */
  ActionBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.statements)
  },

  /** ActionDeclaration formats a named action header and body. */
  ActionDeclaration(f) {
    f.oneSpaceAfter('package', 'project', 'publish', 'action')
    f.oneSpaceBeforeProperty('parameterList')
  },

  /** ActionExpression formats inline action bodies. */
  ActionExpression() {},

  /** DoStatement formats action invocation spacing. */
  DoStatement(f) {
    f.oneSpaceAfter('do')
    f.oneSpaceBeforeProperty('argumentList')
  },
} satisfies Partial<FormatHandlers>
