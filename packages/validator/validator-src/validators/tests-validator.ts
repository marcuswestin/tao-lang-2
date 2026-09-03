import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import { type NodeValidationCheck, type NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

const supportedSelectors = ['text', 'label', 'placeholder'] as const
const supportedInputSelectors = ['label', 'placeholder'] as const

/** testValidationMessages declares structural diagnostics for Tao test declarations. */
export const testValidationMessages = {
  unnamedTest: 'A test declares a sentence, the declarations it exercises, or both.',
  advanceDuration: '`advance` takes a literal duration, so a check reads as a fixed amount of time.',
  advanceNegative: '`advance` cannot move the clock backwards.',
  testPlacement: 'Test declarations are only allowed at file level or inside another test.',
  testBlock: (name: string) => `Only nested tests are allowed in test '${name}'.`,
  checkBlock: (name: string) =>
    `Only run, press, enter, submit, back, and expect statements are allowed in test '${name}'.`,
  runPlacement: 'Run steps are only allowed inside test blocks.',
  pressPlacement: 'Press steps are only allowed inside test blocks.',
  hoverPlacement: 'Hover steps are only allowed inside test blocks.',
  focusPlacement: 'Focus steps are only allowed inside test blocks.',
  enterPlacement: 'Enter steps are only allowed inside test blocks.',
  inputExpectationPlacement: 'Input expectations are only allowed inside test blocks.',
  submitPlacement: 'Submit steps are only allowed inside test blocks.',
  expectationPlacement: 'Expectations are only allowed inside test blocks.',
  backPlacement: 'Back steps are only allowed inside test blocks.',
  relaunchPlacement: 'Relaunch steps are only allowed inside test blocks.',
  advancePlacement: 'Advance steps are only allowed inside test blocks.',
  selector: (selector: string) =>
    `Unsupported test selector '${selector}'. Supported selectors: ${supportedSelectors.join(', ')}.`,
  inputSelector: (selector: string) =>
    `Unsupported input test selector '${selector}'. Supported selectors: ${supportedInputSelectors.join(', ')}.`,
  missingRun: (name: string) => `Test '${name}' must start exactly one app with run.`,
  duplicateRun: (name: string) => `Test '${name}' must not declare more than one run step.`,
  expectationBeforeRun: 'Test steps must come after the run step.',
  runTarget: (name: string) => `Run target '${name}' must be an app.`,
  selectIndex: 'Tagged loop row selection uses a 1-based index greater than zero.',
  selectBlock: 'A select block may contain test steps but cannot start another app.',
  scenarioSelectBlock: 'A scenario select block may contain only replayable interaction steps.',
  relaunchInSelect: 'A select block cannot relaunch the app; a relaunch replaces every row the selection resolves.',
  navigationValueType: (actual: string) => `Navigation and toolbar test values expect text, got ${actual}.`,
  navigationValueLiteral: 'Navigation and toolbar test values must be text literals.',
  navigationVocabulary: (expected: string) => `Expected '${expected}' in this navigation test step.`,
} as const

const validateRunPlacement = validateStepPlacement(testValidationMessages.runPlacement)
const validatePressPlacement = validateStepPlacement(testValidationMessages.pressPlacement)
const validateHoverPlacement = validateStepPlacement(testValidationMessages.hoverPlacement)
const validateFocusPlacement = validateStepPlacement(testValidationMessages.focusPlacement)
const validateEnterPlacement = validateStepPlacement(testValidationMessages.enterPlacement)
const validateInputExpectationPlacement = validateStepPlacement(testValidationMessages.inputExpectationPlacement)
const validateSubmitPlacement = validateStepPlacement(testValidationMessages.submitPlacement)
const validateExpectationPlacement = validateStepPlacement(testValidationMessages.expectationPlacement)
const validateBackPlacement = validateStepPlacement(testValidationMessages.backPlacement)
const validateRelaunchPlacement = validateStepPlacement(testValidationMessages.relaunchPlacement)
const validateAdvancePlacement = validateStepPlacement(testValidationMessages.advancePlacement)

/** testValidationChecks validates v0 Tao test declarations and steps. */
export const testValidationChecks = {
  [AST.TestDeclaration.$type]: validateTest,
  [AST.RunStep.$type]: validateRunPlacement,
  [AST.PressTextStep.$type]: [validatePressPlacement, validateSelector],
  [AST.TagPressStep.$type]: validatePressPlacement,
  [AST.PressPhaseStep.$type]: [validatePressPlacement, validatePointerSelector],
  [AST.HoverStep.$type]: [validateHoverPlacement, validatePointerSelector],
  [AST.FocusStep.$type]: validateFocusPlacement,
  [AST.PressToolbarCommandStep.$type]: [validatePressPlacement, validateNavigationVocabulary, validateNavigationValue],
  [AST.EnterTextStep.$type]: [validateEnterPlacement, validateSelector],
  [AST.TagEnterStep.$type]: validateEnterPlacement,
  [AST.ExpectInputValueStep.$type]: [validateInputExpectationPlacement, validateInputSelector],
  [AST.TagInputValueExpectation.$type]: validateInputExpectationPlacement,
  [AST.ExpectGroupStep.$type]: validateExpectationPlacement,
  [AST.ExpectScopeStep.$type]: validateExpectationPlacement,
  [AST.SubmitInputStep.$type]: [validateSubmitPlacement, validateSelector],
  [AST.TagSubmitStep.$type]: validateSubmitPlacement,
  [AST.SelectStep.$type]: validateSelect,
  [AST.BackTestStep.$type]: validateBackPlacement,
  [AST.RelaunchStep.$type]: validateRelaunchPlacement,
  [AST.AdvanceStep.$type]: [validateAdvancePlacement, validateAdvanceDuration],
  [AST.ExpectCheckboxStateStep.$type]: validateExpectationPlacement,
  [AST.ExpectTextStep.$type]: [validateExpectationPlacement, validateSelector],
  [AST.ExpectNavigationTitleStep.$type]: [
    validateExpectationPlacement,
    validateNavigationVocabulary,
    validateNavigationValue,
  ],
  [AST.ExpectToolbarCommandStep.$type]: [
    validateExpectationPlacement,
    validateNavigationVocabulary,
    validateNavigationValue,
  ],
} satisfies NodeValidationChecks

/**
 * The clock a check holds moves by a stated amount, so `advance` folds its duration at compile time
 * rather than evaluating a runtime value that a journey could not read back.
 */
function validateAdvanceDuration(step: AST.AdvanceStep, ctx: ValidationContext): void {
  const nanoseconds = ASTUtils.literalDurationOf(step.duration)
  if (nanoseconds === undefined) {
    ctx.error(testValidationMessages.advanceDuration, step)
    return
  }
  if (nanoseconds < 0) {
    ctx.error(testValidationMessages.advanceNegative, step)
  }
}

// A test is either a group of nested tests or a leaf journey of steps, never a mix.
function validateTest(test: AST.TestDeclaration, ctx: ValidationContext): void {
  if (AST.testDisplayName(test) === '') {
    ctx.error(testValidationMessages.unnamedTest, test)
  }
  const owner = test.$container
  if (!AST.isTaoFile(owner) && !AST.isTestDeclaration(blockOwner(test))) {
    ctx.error(testValidationMessages.testPlacement, test)
  }
  const nested = test.block.statements.filter(AST.isTestDeclaration)
  if (nested.length > 0) {
    for (const statement of test.block.statements) {
      if (!AST.isTestDeclaration(statement)) {
        ctx.error(testValidationMessages.testBlock(AST.testDisplayName(test)), statement)
      }
    }
    return
  }
  validateLeafTest(test, ctx)
}

function validateLeafTest(check: AST.TestDeclaration, ctx: ValidationContext): void {
  for (const statement of check.block.statements) {
    if (!AST.isCheckStep(statement)) {
      ctx.error(testValidationMessages.checkBlock(AST.testDisplayName(check)), statement)
    }
  }
  const runSteps = check.block.statements.filter(AST.isRunStep)
  if (runSteps.length === 0) {
    ctx.error(testValidationMessages.missingRun(AST.testDisplayName(check)), check)
    return
  }
  for (const run of runSteps) {
    validateRun(run, ctx)
  }
  for (const run of runSteps.slice(1)) {
    ctx.error(testValidationMessages.duplicateRun(AST.testDisplayName(check)), run)
  }

  let hasRun = false
  for (const step of check.block.statements.filter(AST.isCheckStep)) {
    Switch.type(step, {
      EnterTextStep: checkStepOrder,
      TagEnterStep: checkStepOrder,
      ExpectInputValueStep: checkStepOrder,
      TagInputValueExpectation: checkStepOrder,
      ExpectCheckboxStateStep: checkStepOrder,
      ExpectTextStep: checkStepOrder,
      ExpectNavigationTitleStep: checkStepOrder,
      ExpectToolbarCommandStep: checkStepOrder,
      ExpectGroupStep: checkStepOrder,
      ExpectScopeStep: checkStepOrder,
      PressTextStep: checkStepOrder,
      TagPressStep: checkStepOrder,
      PressPhaseStep: checkStepOrder,
      HoverStep: checkStepOrder,
      FocusStep: checkStepOrder,
      PressToolbarCommandStep: checkStepOrder,
      RunStep: () => {
        hasRun = true
      },
      AdvanceStep: checkStepOrder,
      SubmitInputStep: checkStepOrder,
      TagSubmitStep: checkStepOrder,
      SelectStep: checkStepOrder,
      BackTestStep: checkStepOrder,
      RelaunchStep: checkStepOrder,
    })
  }

  function checkStepOrder(
    step:
      | AST.EnterTextStep
      | AST.TagEnterStep
      | AST.ExpectInputValueStep
      | AST.TagInputValueExpectation
      | AST.ExpectCheckboxStateStep
      | AST.ExpectTextStep
      | AST.ExpectNavigationTitleStep
      | AST.ExpectToolbarCommandStep
      | AST.ExpectGroupStep
      | AST.ExpectScopeStep
      | AST.PressTextStep
      | AST.TagPressStep
      | AST.PressPhaseStep
      | AST.HoverStep
      | AST.FocusStep
      | AST.PressToolbarCommandStep
      | AST.SubmitInputStep
      | AST.TagSubmitStep
      | AST.SelectStep
      | AST.BackTestStep
      | AST.RelaunchStep
      | AST.AdvanceStep,
  ): void {
    if (!hasRun) {
      ctx.error(testValidationMessages.expectationBeforeRun, step)
    }
  }
}

function validateNavigationValue(
  step: AST.ExpectNavigationTitleStep | AST.ExpectToolbarCommandStep | AST.PressToolbarCommandStep,
  ctx: ValidationContext,
): void {
  if (!AST.isStringLiteral(step.value)) {
    const actual = Type.ofExpression(step.value)
    if (actual.kind === 'primitive' && actual.primitive === 'text') {
      ctx.error(testValidationMessages.navigationValueLiteral, step.value)
      return
    }
  }
  const actual = Type.ofExpression(step.value)
  const expected: ASTUtils.TaoType = { kind: 'primitive', primitive: 'text' }
  if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
    ctx.error(testValidationMessages.navigationValueType(Type.displayName(actual)), step.value)
  }
}

function validateNavigationVocabulary(
  step: AST.ExpectNavigationTitleStep | AST.ExpectToolbarCommandStep | AST.PressToolbarCommandStep,
  ctx: ValidationContext,
): void {
  const actual = AST.isExpectNavigationTitleStep(step) ? step.subject : step.surface
  const expected = AST.isExpectNavigationTitleStep(step) ? 'title' : 'toolbar'
  if (actual !== expected) {
    ctx.error(testValidationMessages.navigationVocabulary(expected), step)
  }
}

function validateSelect(select: AST.SelectStep, ctx: ValidationContext): void {
  if (statementNeedsStepPlacementDiagnostic(select)) {
    ctx.error(testValidationMessages.expectationPlacement, select)
  }
  if (select.index < 1) {
    ctx.error(testValidationMessages.selectIndex, select)
  }
  for (const statement of select.block.statements) {
    if (AST.isRelaunchStep(statement)) {
      ctx.error(testValidationMessages.relaunchInSelect, statement)
      continue
    }
    if (!AST.isCheckStep(statement) || AST.isRunStep(statement)) {
      ctx.error(testValidationMessages.selectBlock, statement)
    }
    if (AST.findOwningScenario(select) && AST.isCheckStep(statement) && !AST.isScenarioStep(statement)) {
      ctx.error(testValidationMessages.scenarioSelectBlock, statement)
    }
  }
}

function validateRun(run: AST.RunStep, ctx: ValidationContext): void {
  if (run.app.error !== undefined) {
    return
  }
  if (!run.app.ref) {
    ctx.error(testValidationMessages.runTarget(run.app.$refText), run)
  }
}

function validateSelector(
  step: AST.EnterTextStep | AST.ExpectTextStep | AST.PressTextStep | AST.SubmitInputStep,
  ctx: ValidationContext,
): void {
  if (step.selector === undefined) {
    return
  }
  if (!supportedSelectors.includes(step.selector as (typeof supportedSelectors)[number])) {
    ctx.error(testValidationMessages.selector(step.selector), step)
  }
}

function validateInputSelector(step: AST.ExpectInputValueStep, ctx: ValidationContext): void {
  if (!supportedInputSelectors.includes(step.selector as (typeof supportedInputSelectors)[number])) {
    ctx.error(testValidationMessages.inputSelector(step.selector), step)
  }
}

function validatePointerSelector(step: AST.PressPhaseStep | AST.HoverStep, ctx: ValidationContext): void {
  if (
    step.selector !== undefined && !supportedSelectors.includes(step.selector as (typeof supportedSelectors)[number])
  ) {
    ctx.error(testValidationMessages.selector(step.selector), step)
  }
}

function validateStepPlacement(message: string): NodeValidationCheck<AST.CheckStep> {
  return (statement, ctx) => {
    if (statementNeedsStepPlacementDiagnostic(statement)) {
      ctx.error(message, statement)
    }
  }
}

function blockOwner(node: AST.Node): AST.Node | undefined {
  const parent = node.$container
  return AST.isBlock(parent) ? parent.$container : undefined
}

function statementNeedsStepPlacementDiagnostic(statement: AST.CheckStep): boolean {
  const owner = blockOwner(statement)
  if (AST.isScenarioBlock(statement.$container) && AST.isScenarioStep(statement)) {
    return false
  }
  return !AST.isTestDeclaration(owner) && !AST.isSelectStep(owner)
}
