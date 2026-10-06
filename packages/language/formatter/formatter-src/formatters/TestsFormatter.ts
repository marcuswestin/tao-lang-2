import type { FormatHandlers } from '../formatting'

export const TestsFormatter = {
  /** TestDeclaration formats a v0 Tao test suite. */
  TestDeclaration(f) {
    f.oneSpaceAfter('test')
  },

  /** TestDeviceClause formats `on phone`, matching `ScenarioDeviceClause`'s own spelling. */
  TestDeviceClause(f) {
    f.oneSpaceAfter('on')
    f.oneSpaceAround('x')
    f.oneSpaceBetweenProperties('device', 'width')
  },

  /** TestFixtureClause formats `with FixtureName`. */
  TestFixtureClause(f) {
    f.oneSpaceAfter('with')
  },

  /** RunStep formats `run AppName`. */
  RunStep(f) {
    f.oneSpaceAfter('run')
  },

  ActionFailureStubStep(f) {
    f.oneSpaceAfter('action', 'fails')
    f.oneSpaceBefore('fails')
  },

  /** PressTextStep formats selector-targeted press steps. */
  PressTextStep(f) {
    f.oneSpaceAfter('press')
    f.oneSpaceBetweenProperties('selector', 'text')
  },

  TagPressStep(f) {
    f.oneSpaceAfter('press')
  },

  /** PressWordStep preserves the ID-based verb before the ordinary selector target. */
  PressWordStep(f) {
    f.oneSpaceAfter('press')
    f.oneSpaceBeforeProperty('tag')
    f.oneSpaceBetweenProperties('subject', 'target')
    f.oneSpaceBetweenProperties('selector', 'target')
  },

  InteractionWordStep(f) {
    f.oneSpaceBeforeProperty('tag')
    f.oneSpaceBetweenProperties('selector', 'target')
    f.oneSpaceBetweenProperties('head', 'target')
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
    f.oneSpaceAfter('expect')
    f.oneSpaceBetweenProperties('missing', 'selector')
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
    f.oneSpaceBetweenProperties('missing', 'selector')
    f.oneSpaceAfter('text', 'label', 'placeholder', 'input', 'value')
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

  NetworkTestStep(f) {
    f.oneSpaceAfter('network')
  },

  WaitForSyncStep(f) {
    f.oneSpaceAfter('wait', 'for')
  },

  DatasourceFailureStep(f) {
    f.oneSpaceAfter('datasource', 'fails', 'after')
    f.oneSpaceBetweenProperties('operation', 'entity')
    f.oneSpaceBetweenProperties('entity', 'message')
  },
} satisfies Partial<FormatHandlers>
