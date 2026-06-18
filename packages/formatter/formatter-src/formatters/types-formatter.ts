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

  /** TypeProperty formats `Name` and `Name is Type` item fields. */
  TypeProperty(f) {
    f.oneSpaceAround('is')
  },

  /** Type references have no interior spacing. */
  PrimitiveTypeReference() {},

  /** Named type references have no interior spacing. */
  NamedTypeReference() {},
} satisfies Partial<FormatHandlers>
