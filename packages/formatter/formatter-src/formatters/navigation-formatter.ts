import type { FormatHandlers } from '../formatting'

export default {
  NavigationTarget() {},
  PresentationMode(f) {
    f.oneSpaceAfter('as')
    f.oneSpaceBeforeProperty('toast')
  },
  ToastPresentationOptions(f) {
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
    f.noSpaceBefore(':')
    f.oneSpaceAfter(':')
    f.commaSpacedList()
  },
  ContextualPresentStatement(f) {
    f.oneSpaceAfter('present', 'as', 'in')
    f.oneSpaceBefore('as', 'in')
    f.oneSpaceBeforeProperty('mode')
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },

  SelectionActivateStatement(f) {
    f.oneSpaceAfter('present')
  },

  DismissStatement() {},

  ReplaceStatement(f) {
    f.oneSpaceAfter('replace', 'in')
    f.oneSpaceBefore('in')
  },
} satisfies Partial<FormatHandlers>
