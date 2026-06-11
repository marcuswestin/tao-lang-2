import type { FormatHandlers } from './formatting'

export default {
  /** Block formats `{ }` bodies with one indented statement per line. */
  Block(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.statements)
  },

  /** ParameterList formats comma-separated parameter declarations. */
  ParameterList(f) {
    f.commaSpacedList()
  },

  /** ParameterDeclaration formats `Name type` spacing. */
  ParameterDeclaration(f) {
    f.oneSpaceBeforeProperty('type')
  },
} satisfies FormatHandlers
