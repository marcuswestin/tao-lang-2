import type { FormatHandlers } from '../formatting'

export default {
  /** ArgumentList formats comma-separated invocation arguments. */
  ArgumentList(f) {
    f.commaSpacedList()
  },

  /** Argument is a single expression; its spacing is owned by ArgumentList commas. */
  Argument() {},

  /** StringLiteral is a single token with no interior formatting. */
  StringLiteral() {},

  /** NumberLiteral is a single token with no interior formatting. */
  NumberLiteral() {},

  /** ValueReference is a single identifier with no interior formatting. */
  ValueReference() {},
} satisfies Partial<FormatHandlers>
