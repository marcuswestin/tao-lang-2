import type { FormatHandlers } from '../formatting'

export default {
  /** AliasDeclaration formats `let Name = value` spacing, including the visibility modifier. */
  AliasDeclaration(f) {
    f.oneSpaceAfter('package', 'project', 'publish', 'let', 'alias')
    f.oneSpaceAround('=')
  },
} satisfies Partial<FormatHandlers>
