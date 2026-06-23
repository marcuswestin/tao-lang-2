import type { FormatHandlers } from '../formatting'

export default {
  /** TestDeclaration formats a v0 Tao test suite. */
  TestDeclaration(f) {
    f.oneSpaceAfter('test')
  },

  /** CheckDeclaration formats a runnable v0 check. */
  CheckDeclaration(f) {
    f.oneSpaceAfter('check')
  },

  /** RunStep formats `run AppName`. */
  RunStep(f) {
    f.oneSpaceAfter('run')
  },

  /** ExpectTextStep formats v0 text expectations. */
  ExpectTextStep(f) {
    f.oneSpaceAfter('expect', 'missing', 'text')
  },
} satisfies Partial<FormatHandlers>
