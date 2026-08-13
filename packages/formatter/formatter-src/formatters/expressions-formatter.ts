import { AST } from '@parser'
import type { FormatHandlers } from '../formatting'

export default {
  /** ArgumentList formats comma-separated invocation arguments. */
  ArgumentList(f) {
    f.commaSpacedList()
  },

  /** Argument formats an optional owner-slot label and one value. */
  Argument(f) {
    f.oneSpaceAfter(':')
  },

  /** ConfigurationConstructor formats a declaration-linked constructor and its value or block. */
  ConfigurationConstructor(f) {
    f.noSpaceBefore('.')
    f.noSpaceAfter('.')
    f.oneSpaceBeforeProperty('block', 'value')
  },

  /** ValueReference formats an optional immutable `with` patch. */
  ValueReference(f) {
    f.oneSpaceAround('with')
    f.oneSpaceBeforeProperty('patchBlock')
  },

  /** ConfigurationBlock places each named slot on its own indented line. */
  ConfigurationBlock(f) {
    f.indentedBraceBlock(f.node.entries)
    f.lineSeparatedList(f.node.entries)
    f.commaLineList()
  },

  /** ConfigurationEntry formats keyed, labeled, named, and bare constructor entries. */
  ConfigurationEntry(f) {
    f.noSpaceBefore(':')
    f.oneSpaceAfter(':')
    f.oneSpaceBeforeProperty('value')
    f.oneSpaceBeforeProperty('block')
  },

  /** PropertyConfigurationPatch formats `with { ... }` as one merge-copy property value. */
  PropertyConfigurationPatch(f) {
    f.oneSpaceAfter('with')
    f.oneSpaceBeforeProperty('block')
  },

  /** ConfigurationReference is one linked configured/app value name. */
  ConfigurationReference() {},

  /** ConfigurationKeyValue is one `@key` configuration scalar. */
  ConfigurationKeyValue() {},

  /** TypedConstructor formats juxtaposed `<Type> <Value>` value creation. */
  TypedConstructor(f) {
    f.oneSpaceBetweenProperties('type', 'value')
  },

  /** FunctionDeclaration formats a pure expression-bodied function. */
  FunctionDeclaration(f) {
    f.oneSpaceAfter('file', 'package', 'workspace', 'public', 'function', 'returns')
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

  /** CaseTestExpression formats a postfix built-in or declared case predicate. */
  CaseTestExpression(f) {
    f.oneSpaceAround('is')
  },

  /** UnaryExpression keeps numeric negation tight and boolean negation readable. */
  UnaryExpression(f) {
    f.noSpaceAfter('-')
    f.oneSpaceAfter('not')
  },

  /** WhenExpression puts each branch and its required fallback on an indented line. */
  WhenExpression(f) {
    f.oneSpaceAfter('when')
    f.oneSpaceBefore('{')
    f.indentedBraceBlock([...f.node.branches, f.node.otherwise])
    f.lineSeparatedList([...f.node.branches, f.node.otherwise])
  },

  /** WhenBranch spaces a value branch around its arrow. */
  WhenBranch(f) {
    f.oneSpaceAround('->')
  },

  /** WhenOtherwise spaces the required fallback around its arrow. */
  WhenOtherwise(f) {
    f.oneSpaceAround('->')
  },

  /** CasePayload is a single scoped identifier. */
  CasePayload() {},

  /** InterpolatedString preserves text while canonicalizing expression brace spacing. */
  InterpolatedString() {},

  /** InterpolatedStringText preserves source escapes and literal whitespace. */
  InterpolatedStringText() {},

  /** StringInterpolation places one space inside both expression braces. */
  StringInterpolation(f) {
    f.oneSpaceBeforeProperty('expression')
    f.oneSpaceBefore('}')
  },

  /** ListLiteral formats list elements. */
  ListLiteral(f) {
    if (listLiteralNeedsBlock(f.node)) {
      f.indentedBracketBlock(f.node.elements)
      f.lineSeparatedList(f.node.elements)
      f.commaLineList()
      return
    }
    f.commaSpacedList()
  },

  /** ItemLiteral formats item constructor values. */
  ItemLiteral(f) {
    f.indentedBraceBlock(f.node.properties)
    f.lineSeparatedList(f.node.properties)
    f.commaLineList()
  },

  /** ItemProperty formats an optional owner-field label. */
  ItemProperty(f) {
    f.oneSpaceAfter(':')
  },

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
} satisfies Partial<FormatHandlers>

function listLiteralNeedsBlock(list: AST.ListLiteral): boolean {
  return list.elements.some(element =>
    AST.isListLiteral(element)
    || AST.isItemLiteral(element)
    || (AST.isTypedConstructor(element) && AST.isItemLiteral(element.value))
  )
}
