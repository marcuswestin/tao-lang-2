import type { FormatHandlers } from '../formatting'

export default {
  RestorationPolicy(f) {
    f.oneSpaceAfter('Restore')
    f.oneSpaceBeforeProperty('exclusions')
  },

  RestorationExclusionBlock(f) {
    f.oneSpaceAfter('{', 'Exclude')
    f.oneSpaceBefore('}')
    f.commaSpacedList()
  },
} satisfies Partial<FormatHandlers>
