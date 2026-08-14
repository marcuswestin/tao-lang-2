import type { FormatHandlers } from '../formatting'

export default {
  NavigationTarget() {},
  ContextualPresentStatement(f) {
    f.oneSpaceAfter('present', 'in')
    f.oneSpaceBefore('in')
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },

  DismissStatement() {},

  ReplaceStatement(f) {
    f.oneSpaceAfter('replace', 'in')
    f.oneSpaceBefore('in')
  },
} satisfies Partial<FormatHandlers>
