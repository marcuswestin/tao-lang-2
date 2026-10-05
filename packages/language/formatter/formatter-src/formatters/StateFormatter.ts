import type { FormatHandlers } from '../formatting'

export const StateFormatter = {
  /** SetStatement formats state mutation operators. */
  SetStatement(f) {
    f.oneSpaceAfter('set')
    f.noSpaceBefore('.')
    f.noSpaceAfter('.')
    f.oneSpaceAround('=', '+=', '-=', '*=', '/=')
  },

  /** ToggleStatement keeps a writable field path compact. */
  ToggleStatement(f) {
    f.oneSpaceAfter('toggle')
    f.noSpaceBefore('.')
    f.noSpaceAfter('.')
  },

  /** StateDeclaration formats state declaration spacing. */
  StateDeclaration(f) {
    f.oneSpaceAfter('state')
    f.oneSpaceBeforeProperty('value')
    f.oneSpaceAround('is')
    f.oneSpaceAround('=')
    f.oneSpaceBefore('(')
  },
} satisfies Partial<FormatHandlers>
