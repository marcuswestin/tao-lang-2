import { AST } from '@parser'
import type { FormatHandlers } from '../formatting'

export default {
  /** PrimitiveDeclaration formats the pinned intrinsic shape declaration. */
  PrimitiveDeclaration(f) {
    f.oneSpaceAfter('primitive')
    f.oneSpaceAround('is')
    f.oneSpaceAround('with')
  },

  /** TypeDeclaration formats `type Name is ...` declarations. */
  TypeDeclaration(f) {
    f.visibilityOnOwnLine()
    f.oneSpaceAfter('type')
    f.oneSpaceAround('is')
  },

  /** CaseSetTypeExpression formats `one of A, B, C`. */
  CaseSetTypeExpression(f) {
    f.oneSpaceAfter('one', 'of')
    f.commaSpacedList()
  },

  /** CaseSetCase preserves its declaration name or text literal. */
  CaseSetCase() {},

  /** YesNoTypeExpression formats `yes / Alias no`. */
  YesNoTypeExpression(f) {
    f.oneSpaceAround('/')
    f.oneSpaceBefore('no')
  },

  /** ItemTypeExpression formats item type property blocks. */
  ItemTypeExpression(f) {
    const entries = [...f.node.properties, ...f.node.keys, ...f.node.implementations]
      .toSorted((left, right) => (left.$cstNode?.offset ?? 0) - (right.$cstNode?.offset ?? 0))
    f.indentedBraceBlock(entries)
    f.commaLineList()
    f.separateIndentedLines(
      entries,
      (_previous, next) => AST.isConfigurationImplementation(next) ? 2 : 1,
    )
  },

  /** UnionTypeExpression keeps closed-union members readable. */
  UnionTypeExpression(f) {
    f.oneSpaceAround('|')
  },

  /** DerivedTypeExpression spaces immutable slot derivation around `with`. */
  DerivedTypeExpression(f) {
    f.oneSpaceAround('with')
  },

  /** TypeProperty formats `Name Type`, shorthand `Type`, and optional `is value` fills. */
  TypeProperty(f) {
    f.oneSpaceAfter('optional')
    f.oneSpaceBetweenProperties('name', 'type')
    f.oneSpaceAround('is')
  },

  /** ParameterTypeDeclaration formats scoped parameter type declarations. */
  ParameterTypeDeclaration(f) {
    f.oneSpaceAround('is')
  },

  /** Type references have no interior spacing. */
  PrimitiveTypeReference() {},

  /** ListTypeReference preserves the required `list of T` spacing. */
  ListTypeReference(f) {
    f.oneSpaceAround('of')
  },

  /** Action callback type references keep their positional signature compact. */
  ActionTypeReference(f) {
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
    f.commaSpacedList()
  },

  /** Constructor primitive type references have no interior spacing. */
  ConstructablePrimitiveTypeReference() {},

  /** Named type references have no interior spacing. */
  NamedTypeReference() {},
} satisfies Partial<FormatHandlers>
