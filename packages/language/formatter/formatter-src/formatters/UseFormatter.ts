import type { FormatHandlers } from '../formatting'

export const UseFormatter = {
  /** UseStatement formats `use Name, Name from path` spacing. */
  UseStatement(f) {
    f.oneSpaceAfter('use')
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
