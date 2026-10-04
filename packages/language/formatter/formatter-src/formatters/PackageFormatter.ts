import type { FormatHandlers } from '../formatting'

export const PackageFormatter = {
  PackageDeclaration() {},

  PackageBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.statements)
  },

  PackageName(f) {
    f.oneSpaceAfter('name')
  },
  PackageVersion(f) {
    f.oneSpaceAfter('version')
  },
  PackageLicense(f) {
    f.oneSpaceAfter('license')
  },
  PackageIncludes(f) {
    f.oneSpaceAfter('includes')
  },
  PackageRequires(f) {
    f.oneSpaceAfter('requires', 'ts', 'from', 'version', 'as')
    f.oneSpaceBefore('from', 'version', 'as', '{')
  },
  ModuleBindings(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.bindings)
  },
  ModuleBinding(f) {
    f.oneSpaceBefore('as')
    f.oneSpaceAfter('as')
  },
} satisfies Partial<FormatHandlers>
