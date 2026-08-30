import type { FormatHandlers } from '../formatting'

export default {
  ProjectDeclaration() {},

  ProjectBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.statements)
  },

  ProjectId(f) {
    f.oneSpaceAfter('id')
  },

  ProjectName(f) {
    f.oneSpaceAfter('name')
  },

  ProjectRemote(f) {
    f.oneSpaceAfter('remote')
  },

  ProjectLicense(f) {
    f.oneSpaceAfter('license')
  },

  ProjectRequires(f) {
    f.oneSpaceAfter('requires')
  },
} satisfies Partial<FormatHandlers>
