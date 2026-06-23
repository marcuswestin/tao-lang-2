import { AST } from '@parser'
import type { FormatHandlers } from '../formatting'

export default {
  /** ArgumentList formats comma-separated invocation arguments. */
  ArgumentList(f) {
    f.commaSpacedList()
  },

  /** Argument formats an optional invocation type label and one value. */
  Argument(f) {
    f.oneSpaceAfter(':')
  },

  /** TypedConstructor formats juxtaposed `<Type> <Value>` value creation. */
  TypedConstructor(f) {
    f.oneSpaceBetweenProperties('type', 'value')
  },

  /** ListLiteral formats list elements. */
  ListLiteral(f) {
    if (listLiteralNeedsBlock(f.node)) {
      f.indentedBracketBlock(f.node.elements)
      f.lineSeparatedList(f.node.elements)
      return
    }
    f.spaceSeparatedList(f.node.elements)
  },

  /** ItemLiteral formats item constructor values. */
  ItemLiteral(f) {
    f.indentedBraceBlock(f.node.properties)
    f.lineSeparatedList(f.node.properties)
  },

  /** ItemProperty is a single expression; spacing is owned by ItemLiteral. */
  ItemProperty() {},

  /** MemberAccessExpression has no whitespace around member dots. */
  MemberAccessExpression() {},

  /** StringLiteral is a single token with no interior formatting. */
  StringLiteral() {},

  /** NumberLiteral is a single token with no interior formatting. */
  NumberLiteral() {},

  /** ValueReference is a single identifier with no interior formatting. */
  ValueReference() {},
} satisfies Partial<FormatHandlers>

function listLiteralNeedsBlock(list: AST.ListLiteral): boolean {
  return list.elements.some(element =>
    AST.isListLiteral(element)
    || AST.isItemLiteral(element)
    || (AST.isTypedConstructor(element) && AST.isItemLiteral(element.value))
  )
}
