import { AST } from '@parser'
import type { FormatHandlers } from '../formatting'

export default {
  /** ArgumentList formats comma-separated invocation arguments. */
  ArgumentList(f) {
    f.commaSpacedList()
  },

  /** Argument is a single expression; its spacing is owned by ArgumentList commas. */
  Argument() {},

  /** TypeCastExpression formats `<value> as <Type>`. */
  TypeCastExpression(f) {
    f.oneSpaceAround('as')
  },

  /** TypedConstructor has no whitespace around the constructor dot. */
  TypedConstructor() {},

  /** Constructor type references have no interior spacing. */
  ConstructorTypeReference() {},

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
