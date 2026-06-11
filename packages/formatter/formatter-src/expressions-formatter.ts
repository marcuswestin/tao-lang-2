import type { FormatHandlers } from './formatting'

export default {
  /** ArgumentList formats comma-separated invocation arguments. */
  ArgumentList(f) {
    f.commaSpacedList()
  },
} satisfies FormatHandlers
