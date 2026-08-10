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

  /** BinaryExpression separates its operator from both operands with one space. */
  BinaryExpression(f) {
    f.oneSpaceAround(f.node.operator)
  },

  /** UnaryOperation keeps `not` spaced from its operand and `-` tight against it. */
  UnaryOperation(f) {
    if (f.node.operator === 'not') {
      f.oneSpaceAfter('not')
      return
    }
    f.noSpaceAfter('-')
  },

  /** ParenthesizedExpression keeps its grouped expression tight inside the parentheses. */
  ParenthesizedExpression(f) {
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },

  /** WhenExpression puts each branch and the otherwise fallback on its own indented line. */
  WhenExpression(f) {
    f.indentedLines(f.node.branches)
    f.indentedLine('otherwise')
    f.oneSpaceAround('->')
  },

  /** WhenBranch spaces its condition and value around the branch arrow. */
  WhenBranch(f) {
    f.oneSpaceAround('->')
  },

  /** BooleanLiteral is a single token with no interior formatting. */
  BooleanLiteral() {},

  /** WhenRenderStatement puts each conditional branch and the otherwise fallback on its own line. */
  WhenRenderStatement(f) {
    f.indentedLines([...f.node.branches, f.node.otherwise])
  },

  // The branch body owns the space after `->`, so branches only set the arrow's left side.
  /** WhenRenderBranch spaces its condition against the branch arrow. */
  WhenRenderBranch(f) {
    f.oneSpaceBefore('->')
  },

  /** WhenRenderOtherwise spaces the fallback keyword against the branch arrow. */
  WhenRenderOtherwise(f) {
    f.oneSpaceBefore('->')
  },

  /** WhenActionStatement puts each conditional branch and the otherwise fallback on its own line. */
  WhenActionStatement(f) {
    f.indentedLines([...f.node.branches, f.node.otherwise])
  },

  /** WhenActionBranch spaces its condition against the branch arrow. */
  WhenActionBranch(f) {
    f.oneSpaceBefore('->')
  },

  /** ForRenderStatement spaces the loop header keywords. */
  ForRenderStatement(f) {
    f.oneSpaceAfter('for')
    f.oneSpaceAround('in')
  },

  /** LoopVariable is a single identifier with no interior formatting. */
  LoopVariable() {},

  /** WhenActionOtherwise spaces the fallback keyword against the branch arrow. */
  WhenActionOtherwise(f) {
    f.oneSpaceBefore('->')
  },

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
