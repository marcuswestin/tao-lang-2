import { AST } from '@parser'
import type { FormatHandlers } from '../formatting'

export default {
  /** ArgumentList formats comma-separated invocation arguments. */
  ArgumentList(f) {
    f.commaSpacedList()
  },

  /** Argument formats an optional invocation name or type label and one value. */
  Argument(f) {
    if (f.node.parameterName) {
      f.noSpaceAfter('.')
      f.oneSpaceBeforeProperty('value')
    }
    f.oneSpaceAfter(':')
  },

  /** TypedConstructor formats juxtaposed `<Type> <Value>` value creation. */
  TypedConstructor(f) {
    f.oneSpaceBetweenProperties('type', 'value')
  },

  /** FunctionDeclaration formats a pure expression-bodied function. */
  FunctionDeclaration(f) {
    f.oneSpaceAfter('package', 'project', 'publish', 'function', 'returns')
    f.oneSpaceBefore('returns')
    f.oneSpaceBeforeProperty('parameterList')
    f.oneSpaceAround('=')
  },

  /** FunctionCallExpression keeps call parentheses tight and arguments comma-spaced. */
  FunctionCallExpression(f) {
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },

  /** BinaryExpression formats operators with one space on each side. */
  BinaryExpression(f) {
    f.oneSpaceAround('==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/', 'and', 'or')
  },

  /** UnaryExpression keeps numeric negation tight and boolean negation readable. */
  UnaryExpression(f) {
    f.noSpaceAfter('-')
    f.oneSpaceAfter('not')
  },

  /** WhenExpression puts each branch and its required fallback on an indented line. */
  WhenExpression(f) {
    f.indentedLines([...f.node.branches, f.node.otherwise])
  },

  /** WhenBranch spaces a value branch around its arrow. */
  WhenBranch(f) {
    f.oneSpaceAround('->')
  },

  /** WhenOtherwise spaces the required fallback around its arrow. */
  WhenOtherwise(f) {
    f.oneSpaceAround('->')
  },

  /** InterpolationExpression formats comma-separated interpolation parts. */
  InterpolationExpression(f) {
    f.oneSpaceAfter('interpolate')
    f.commaSpacedList()
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

  /** BooleanLiteral is a single token with no interior formatting. */
  BooleanLiteral() {},

  /** NoneLiteral is a single token with no interior formatting. */
  NoneLiteral() {},

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
