import type { FormatHandlers } from '../formatting'

export default {
  NavigationTarget() {},
  PresentationMode(f) {
    f.oneSpaceAfter('as')
  },
  ContextualPresentStatement(f) {
    f.oneSpaceAfter('present', 'as', 'in')
    f.oneSpaceBefore('as', 'in')
    f.oneSpaceBeforeProperty('mode')
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
