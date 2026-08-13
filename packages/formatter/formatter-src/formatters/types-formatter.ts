import type { FormatHandlers } from '../formatting'

export default {
  /** TypeDeclaration formats `type Name is ...` declarations. */
  TypeDeclaration(f) {
    f.oneSpaceAfter('file', 'package', 'workspace', 'public', 'type')
    f.oneSpaceAround('is')
  },

  /** EnumDeclaration formats its declaration keyword and case block. */
  EnumDeclaration(f) {
    f.oneSpaceAfter('file', 'package', 'workspace', 'public', 'enum')
    f.oneSpaceBeforeProperty('block')
  },

  /** EnumDeclarationBlock places each case on its own indented line. */
  EnumDeclarationBlock(f) {
    f.indentedBraceBlock(f.node.cases)
    f.lineSeparatedList(f.node.cases)
  },

  /** EnumCase preserves its declaration name. */
  EnumCase() {},

  /** ItemTypeExpression formats item type property blocks. */
  ItemTypeExpression(f) {
    f.indentedBraceBlock(f.node.properties)
    f.lineSeparatedList(f.node.properties)
  },

  /** UnionTypeExpression keeps closed-union members readable. */
  UnionTypeExpression(f) {
    f.oneSpaceAround('|')
  },

  /** TypeProperty formats explicit `Name is Type` item fields and shorthand same-name fields. */
  TypeProperty(f) {
    f.oneSpaceAround('is')
  },

  /** ParameterTypeDeclaration formats scoped parameter type declarations. */
  ParameterTypeDeclaration(f) {
    f.oneSpaceAround('is')
  },

  /** Type references have no interior spacing. */
  PrimitiveTypeReference() {},

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
