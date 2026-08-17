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

  /** PressTextStep formats selector-targeted press steps. */
  PressTextStep(f) {
    f.oneSpaceAfter('press')
    f.oneSpaceBetweenProperties('selector', 'text')
  },

  /** InputTextStep formats selector-targeted text input steps. */
  InputTextStep(f) {
    f.oneSpaceAfter('input')
    f.oneSpaceBetweenProperties('selector', 'target')
    f.oneSpaceBetweenProperties('target', 'value')
  },

  /** ExpectTextStep formats v0 selector-targeted expectations. */
  ExpectTextStep(f) {
    f.oneSpaceAfter('expect', 'missing')
    f.oneSpaceBetweenProperties('selector', 'text')
  },
} satisfies Partial<FormatHandlers>
