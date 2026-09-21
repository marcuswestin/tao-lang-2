import type { FormatHandlers } from '../formatting'

export const StateFormatter = {
  /** SetStatement formats state mutation operators. */
  SetStatement(f) {
    f.oneSpaceAfter('set')
    f.oneSpaceAround('=', '+=', '-=', '*=', '/=')
  },

  /** StateDeclaration formats state declaration spacing. */
  StateDeclaration(f) {
    f.oneSpaceAfter('state')
    f.oneSpaceAround('is')
    f.oneSpaceAround('=')
    f.oneSpaceBefore('(')
  },
} satisfies Partial<FormatHandlers>
