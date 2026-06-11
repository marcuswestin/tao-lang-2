import type { FormatHandlers } from './formatting'

export default {
  /** AliasDeclaration formats `alias Name = value` spacing, including the visibility modifier. */
  AliasDeclaration(f) {
    f.oneSpaceAfter('share', 'hide', 'alias')
    f.oneSpaceAround('=')
  },
} satisfies FormatHandlers
