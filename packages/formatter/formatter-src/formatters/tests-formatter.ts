import type { FormatHandlers } from '../formatting'

export default {
  /** TestDeclaration formats a v0 Tao test suite. */
  TestDeclaration(f) {
    f.oneSpaceAfter('test')
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

  TagPressStep(f) {
    f.oneSpaceAfter('press')
  },

  /** PressPhaseStep preserves the phase before the ordinary selector target. */
  PressPhaseStep(f) {
    f.oneSpaceAfter('press', 'down', 'up')
    f.oneSpaceBetweenProperties('selector', 'target')
  },

  HoverStep(f) {
    f.oneSpaceAfter('hover')
    f.oneSpaceBetweenProperties('selector', 'target')
  },

  FocusStep(f) {
    f.oneSpaceAfter('head')
  },

  PressKeyStep(f) {
    f.oneSpaceAfter('press')
    f.oneSpaceBetweenProperties('subject', 'value')
  },

  NarrowStep(f) {
    f.oneSpaceBetweenProperties('head', 'value')
  },

  PressToolbarCommandStep(f) {
    f.oneSpaceAfter('press', 'command')
    f.oneSpaceBefore('command')
  },

  /** EnterTextStep formats `enter "value" into <selector> "target"`. */
  EnterTextStep(f) {
    f.oneSpaceAfter('enter', 'into')
    f.oneSpaceBefore('into')
    f.oneSpaceBetweenProperties('selector', 'target')
  },

  TagEnterStep(f) {
    f.oneSpaceAfter('enter', 'into')
    f.oneSpaceBefore('into')
  },

  /** SubmitInputStep formats `submit <selector> "target"`. */
  SubmitInputStep(f) {
    f.oneSpaceAfter('submit')
    f.oneSpaceBetweenProperties('selector', 'target')
  },

  TagSubmitStep(f) {
    f.oneSpaceAfter('submit')
  },

  SelectStep(f) {
    f.oneSpaceAfter('select')
    f.noSpaceBefore('[')
    f.noSpaceAfter('[')
    f.noSpaceBefore(']')
  },

  /** ExpectTextStep formats v0 selector-targeted expectations. */
  ExpectTextStep(f) {
    f.oneSpaceAfter('expect', 'missing')
    f.oneSpaceBetweenProperties('selector', 'text')
  },

  ExpectNavigationTitleStep(f) {
    f.oneSpaceAfter('expect', 'navigation')
    f.oneSpaceBetweenProperties('subject', 'value')
  },

  ExpectToolbarCommandStep(f) {
    f.oneSpaceAfter('expect', 'command')
    f.oneSpaceBefore('command')
    f.oneSpaceBeforeProperty('state')
  },

  /** ExpectCheckboxStateStep formats tag-only checked-state assertions. */
  ExpectCheckboxStateStep(f) {
    f.oneSpaceAfter('expect', 'checkbox')
    f.oneSpaceBeforeProperty('state')
  },

  /** ExpectInputValueStep formats input value assertions. */
  ExpectInputValueStep(f) {
    f.oneSpaceAfter('expect', 'input', 'value')
    f.oneSpaceBetweenProperties('selector', 'target')
    f.oneSpaceBefore('value')
  },

  TagInputValueExpectation(f) {
    f.oneSpaceAfter('expect', 'input', 'value')
  },

  ExpectGroupStep(f) {
    f.oneSpaceAfter('expect')
  },

  ExpectScopeStep(f) {
    f.oneSpaceAfter('expect')
  },

  ExpectInteractionStep(f) {
    f.oneSpaceAfter('expect')
    if (f.node.detail) {
      f.oneSpaceBetweenProperties('subject', 'detail')
      f.oneSpaceBetweenProperties('detail', 'values')
    } else {
      f.oneSpaceBetweenProperties('subject', 'values')
    }
    f.commaSpacedList()
  },

  TestExpectationBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.expectations)
    f.lineSeparatedList(f.node.expectations)
  },

  TestExpectation(f) {
    f.oneSpaceAfter('missing', 'text', 'label', 'placeholder', 'input', 'value')
  },

  /** BackTestStep has no operands. */
  BackTestStep() {},

  /** RelaunchStep spaces its optional `fresh` modifier, and formats as bare `relaunch` without one. */
  RelaunchStep(f) {
    f.oneSpaceBeforeProperty('fresh')
  },

  /** AdvanceStep spaces its duration after the keyword. */
  AdvanceStep(f) {
    f.oneSpaceAfter('advance')
  },
} satisfies Partial<FormatHandlers>
