import type { FormatHandlers } from '../formatting'

/** DesignFormatter formats the minimal flat-token and named-bundle declaration surface. */
export default {
  DesignDeclaration(f) {
    f.oneSpaceAfter('file', 'package', 'workspace', 'public', 'design')
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.members)
  },

  DesignToken(f) {
    f.oneSpaceBeforeProperty('value')
  },

  DesignBundle(f) {
    f.oneSpaceBeforeProperty('spec')
  },
} satisfies Partial<FormatHandlers>
