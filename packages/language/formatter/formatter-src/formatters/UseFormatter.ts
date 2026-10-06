import type { FormatHandlers } from '../formatting'

export const UseFormatter = {
  /** NamedImport formats the optional local alias. */
  NamedImport(f) {
    f.oneSpaceAround('as')
  },

  /** UseStatement formats named imports and `use all from path`. */
  UseStatement(f) {
    f.oneSpaceAfter('use', 'all')
    f.oneSpaceAround('from')
    f.commaSpacedList()
  },

  /** UsePackageStatement formats `use package path as name` spacing. */
  UsePackageStatement(f) {
    f.oneSpaceAfter('use', 'package')
    f.oneSpaceAround('as')
  },

  /** PackageMemberReference keeps `ns.Member` tight around its dot. */
  PackageMemberReference(f) {
    f.noSpaceBefore('.')
    f.noSpaceAfter('.')
  },
} satisfies Partial<FormatHandlers>
