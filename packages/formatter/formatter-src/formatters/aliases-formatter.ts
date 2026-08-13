import type { FormatHandlers } from '../formatting'

export default {
  /** AliasDeclaration normalizes canonical immutable `let` bindings. */
  AliasDeclaration(f) {
    f.oneSpaceAfter('file', 'package', 'workspace', 'public', 'let')
    f.oneSpaceAround('=')
  },
} satisfies Partial<FormatHandlers>
