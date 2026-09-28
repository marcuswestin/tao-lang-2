import type { FormatHandlers } from '../formatting'

export const ProjectFormatter = {
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

  ProjectVersion(f) {
    f.oneSpaceAfter('version')
  },

  ProjectDefaultApp(f) {
    f.oneSpaceAfter('app')
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
