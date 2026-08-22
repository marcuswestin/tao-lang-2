import type { FormatHandlers } from '../formatting'

export default {
  /** AliasDeclaration normalizes canonical immutable `let` bindings. */
  AliasDeclaration(f) {
    f.visibilityOnOwnLine()
    f.oneSpaceAfter('let')
    f.oneSpaceAround('is')
    f.oneSpaceAround('=')
  },
} satisfies Partial<FormatHandlers>
