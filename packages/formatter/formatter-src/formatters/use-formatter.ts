import type { FormatHandlers } from '../formatting'

export default {
  /** UseStatement formats `use Name, Name from path` spacing. */
  UseStatement(f) {
    f.oneSpaceAfter('use')
    f.oneSpaceAround('from')
    f.commaSpacedList()
  },
} satisfies Partial<FormatHandlers>
