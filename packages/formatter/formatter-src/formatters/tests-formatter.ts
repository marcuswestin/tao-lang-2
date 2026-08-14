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

  /** EnterTextStep formats `enter "value" into <selector> "target"`. */
  EnterTextStep(f) {
    f.oneSpaceAfter('enter', 'into')
    f.oneSpaceBefore('into')
    f.oneSpaceBetweenProperties('selector', 'target')
  },

  /** SubmitInputStep formats `submit <selector> "target"`. */
  SubmitInputStep(f) {
    f.oneSpaceAfter('submit')
    f.oneSpaceBetweenProperties('selector', 'target')
  },

  /** ExpectTextStep formats v0 selector-targeted expectations. */
  ExpectTextStep(f) {
    f.oneSpaceAfter('expect', 'missing')
    f.oneSpaceBetweenProperties('selector', 'text')
  },

  /** ExpectInputValueStep formats input value assertions. */
  ExpectInputValueStep(f) {
    f.oneSpaceAfter('expect', 'input', 'value')
    f.oneSpaceBetweenProperties('selector', 'target')
    f.oneSpaceBefore('value')
  },

  /** BackTestStep has no operands. */
  BackTestStep() {},
} satisfies Partial<FormatHandlers>
