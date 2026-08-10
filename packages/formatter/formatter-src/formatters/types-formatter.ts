import type { FormatHandlers } from '../formatting'

export default {
  /** TypeDeclaration formats `type Name is ...` declarations. */
  TypeDeclaration(f) {
    f.oneSpaceAfter('package', 'project', 'publish', 'type')
    f.oneSpaceAround('is')
  },

  /** ItemTypeExpression formats item type property blocks. */
  ItemTypeExpression(f) {
    f.indentedBraceBlock(f.node.properties)
    f.lineSeparatedList(f.node.properties)
  },

  /** TypeProperty formats explicit `Name is Type` item fields and shorthand same-name fields. */
  TypeProperty(f) {
    f.oneSpaceAround('is')
  },

  /** ParameterTypeDeclaration formats scoped parameter type declarations and default values. */
  ParameterTypeDeclaration(f) {
    f.oneSpaceAround('is')
    f.oneSpaceAround('default')
  },

  /** Type references have no interior spacing. */
  PrimitiveTypeReference() {},

  /** Constructor primitive type references have no interior spacing. */
  ConstructablePrimitiveTypeReference() {},

  /** Named type references have no interior spacing. */
  NamedTypeReference() {},
} satisfies Partial<FormatHandlers>
