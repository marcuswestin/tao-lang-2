import type { FormatHandlers } from '../formatting'

export default {
  /** AliasDeclaration preserves its parsed binding keyword while normalizing spacing. */
  AliasDeclaration(f) {
    f.oneSpaceAfter('package', 'project', 'publish', 'let', 'alias')
    f.oneSpaceAround('=')
  },
} satisfies Partial<FormatHandlers>
