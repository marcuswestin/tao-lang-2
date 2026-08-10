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

  /** RunStep formats `run AppName with { data loading }`. */
  RunStep(f) {
    f.oneSpaceAfter('run')
    f.oneSpaceBefore('with')
    f.oneSpaceAfter('with')
    f.singleLineBraceBlock(f.node)
  },

  /** RunConfig formats one `data <state>` run configuration entry. */
  RunConfig(f) {
    f.oneSpaceAfter('data')
  },

  /** PressTextStep formats selector-targeted press steps. */
  PressTextStep(f) {
    f.oneSpaceAfter('press')
    f.oneSpaceBetweenProperties('selector', 'text')
  },

  /** ExpectTextStep formats selector-targeted expectations. */
  ExpectTextStep(f) {
    f.oneSpaceAfter('expect', 'missing')
    f.oneSpaceBetweenProperties('selector', 'text')
  },

  /** ExpectInputStep formats editable-control value expectations. */
  ExpectInputStep(f) {
    f.oneSpaceAfter('expect', 'input', 'value')
    f.oneSpaceBetweenProperties('selector', 'text')
    f.oneSpaceBefore('value')
  },

  /** WriteStep formats typing into the focused control. */
  WriteStep(f) {
    f.oneSpaceAfter('write')
  },

  /** SubmitStep is a single keyword with no interior formatting. */
  SubmitStep() {},

  /** BackStep is a single keyword with no interior formatting. */
  BackStep() {},
} satisfies Partial<FormatHandlers>
