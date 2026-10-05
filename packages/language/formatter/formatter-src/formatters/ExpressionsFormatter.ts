import { AST } from '@parser'
import type { FormatHandlers } from '../formatting'

export const ExpressionsFormatter = {
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
    // A leading role dot starts this expression; its parent owns the preceding argument gap.
    if (!f.node.relative) {
      f.noSpaceBefore('.')
    }
    f.noSpaceAfter('.')
    f.oneSpaceBeforeProperty('block', 'value')
  },

  /** PrimitiveConfigurationConstructor formats primitive construction/refinement blocks. */
  PrimitiveConfigurationConstructor(f) {
    f.oneSpaceAround('with')
    f.oneSpaceBeforeProperty('block')
  },

  /** InferredConfigurationConstructor formats a context-typed bare value block. */
  InferredConfigurationConstructor() {},

  /** RefinementExpression formats one immutable `with` refinement. */
  RefinementExpression(f) {
    f.oneSpaceAround('with')
    f.oneSpaceBeforeProperty('patchBlock')
  },

  CopyExpression(f) {
    f.oneSpaceAfter('copy')
    f.oneSpaceAround('as')
  },

  /** ConversionExpression casts the value produced by its full addition expression. */
  ConversionExpression(f) {
    f.oneSpaceAround('as')
  },

  /** ValueReference preserves a single value-namespace identifier. */
  ValueReference() {},

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
    // One rule owns the gap between `with` and its block; a second rule on the same gap stacked two
    // spaces whenever the source wrote `with{` with none.
    f.oneSpaceBeforeProperty('block')
  },

  /** ConfigurationReference is one linked configured/app value name. */
  ConfigurationReference() {},

  /** ViewBinding keeps a configured view's invocation arguments attached to its declaration name. */
  ViewBinding(f) {
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },

  /** ConfigurationKeyValue is one `@key` configuration scalar. */
  ConfigurationKeyValue() {},

  /** TypedConstructor formats juxtaposed `<Type> <Value>` value creation. */
  TypedConstructor(f) {
    f.oneSpaceBetweenProperties('type', 'value')
  },

  /** FunctionDeclaration formats a parenthesized pure function header and block body. */
  FunctionDeclaration(f) {
    f.visibilityOnOwnLine()
    f.oneSpaceAfter('function', 'returns')
    f.oneSpaceAfter('func')
    f.oneSpaceBefore('returns')
    f.oneSpaceAround('fails')
    f.oneSpaceAround('->')
    if (f.node.genericParameters.length > 0) {
      f.oneSpaceBefore('where')
      f.oneSpaceAfter('where')
      f.commaSpacedList()
    } else {
      f.noSpaceBefore('(')
    }
  },

  /** AssociatedFunctionDeclaration formats its optional bounded generic header. */
  AssociatedFunctionDeclaration(f) {
    f.oneSpaceAfter('static', 'func')
    f.noSpaceBefore('.')
    f.noSpaceAfter('.')
    f.oneSpaceAround('fails')
    f.oneSpaceAround('->')
    if (f.node.genericParameters.length > 0) {
      f.oneSpaceBefore('where')
      f.oneSpaceAfter('where')
      f.commaSpacedList()
    } else {
      f.noSpaceBefore('(')
    }
  },

  /** GenericTypeParameter formats its name and conjunctive bounds. */
  GenericTypeParameter(f) {
    f.oneSpaceAfter('type', 'is')
    f.oneSpaceAround('and')
  },

  /** FunctionBlock formats return-oriented function control flow. */
  FunctionBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.statements)
  },

  /** ReturnStatement separates the returned expression from its keyword. */
  ReturnStatement(f) {
    f.oneSpaceAfter('return')
  },

  /** IfFunctionStatement separates its condition from a nested early-return block. */
  IfFunctionStatement(f) {
    f.oneSpaceAfter('if')
  },

  /** FunctionCallExpression keeps call parentheses tight and arguments comma-spaced. */
  FunctionCallExpression(f) {
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },

  /** MethodCallExpression keeps postfix invocation parentheses attached to their callee. */
  MethodCallExpression(f) {
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },

  /** PhraseDeclaration formats an optional parameter list and a `=` before its body. */
  PhraseDeclaration(f) {
    f.visibilityOnOwnLine()
    f.oneSpaceAfter('phrase')
    f.noSpaceBefore('(')
    f.oneSpaceAround('=')
    if (f.node.forms.length > 0) {
      f.oneSpaceAround('/')
    }
  },

  /** PhraseForm spaces a plural category keyword before its interpolated string. */
  PhraseForm(f) {
    f.oneSpaceBeforeProperty('text')
  },

  /** BinaryExpression formats operators with one space on each side. */
  BinaryExpression(f) {
    f.oneSpaceAround('==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/', 'and', 'or')
  },

  /** CaseTestExpression formats a postfix built-in or declared case predicate. */
  CaseTestExpression(f) {
    f.oneSpaceAround('is')
    f.oneSpaceAfter('not')
  },

  /** UnaryExpression keeps numeric negation tight and boolean negation readable. */
  UnaryExpression(f) {
    f.noSpaceAfter('-')
    f.oneSpaceAfter('not')
  },

  /**
   * The block form puts each branch and its required fallback on an indented line; the compact form
   * is a value and stays on one, with its separator spaced like an operator.
   */
  WhenExpression(f) {
    f.oneSpaceAfter('when')
    if (f.node.otherwise?.barSyntax) {
      f.indentedLines([...f.node.branches, f.node.otherwise])
      return
    }
    if (f.node.positive) {
      f.oneSpaceBeforeProperty('positive')
      f.oneSpaceAround('/')
      f.oneSpaceBeforeProperty('negative')
      return
    }
    const branches = [...f.node.branches, ...(f.node.otherwise ? [f.node.otherwise] : [])]
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(branches)
    f.lineSeparatedList(branches)
  },

  /** WhenBranch spaces a value branch around its arrow. */
  WhenBranch(f) {
    f.oneSpaceAfter('|')
    f.oneSpaceAround('->')
  },

  /** WhenOtherwise spaces the required fallback around its arrow. */
  WhenOtherwise(f) {
    f.oneSpaceAfter('|')
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

  /** FromExpression keeps one space around `from`, matching a `use` line's provenance clause. */
  FromExpression(f) {
    f.oneSpaceAround('from')
  },

  /** MemberAccessExpression has no whitespace around member dots. */
  MemberAccessExpression(f) {
    f.noSpaceBefore('.')
    f.noSpaceAfter('.')
  },

  /** PostfixMemberAccess has no whitespace around its dot, so `220.ms` stays tight. */
  PostfixMemberAccess(f) {
    f.noSpaceBefore('.')
    f.noSpaceAfter('.')
  },

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
