import { AST } from '@parser'
import { Switch } from '@shared'
import { type NodeValidationCheck, type NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

const supportedSelectors = ['text', 'label', 'placeholder'] as const
const supportedInputSelectors = ['label', 'placeholder'] as const

/** testValidationMessages declares structural diagnostics for Tao test declarations. */
export const testValidationMessages = {
  testPlacement: 'Test declarations are only allowed at file level.',
  testBlock: (name: string) => `Only check declarations are allowed in test '${name}'.`,
  checkPlacement: 'Check declarations are only allowed inside test blocks.',
  checkBlock: (name: string) =>
    `Only run, press, enter, submit, back, data, and expect statements are allowed in check '${name}'.`,
  runPlacement: 'Run steps are only allowed inside check blocks.',
  pressPlacement: 'Press steps are only allowed inside check blocks.',
  enterPlacement: 'Enter steps are only allowed inside check blocks.',
  inputExpectationPlacement: 'Input expectations are only allowed inside check blocks.',
  submitPlacement: 'Submit steps are only allowed inside check blocks.',
  dataStatusPlacement: 'Data status steps are only allowed inside check blocks.',
  expectationPlacement: 'Expectations are only allowed inside check blocks.',
  backPlacement: 'Back steps are only allowed inside check blocks.',
  selector: (selector: string) =>
    `Unsupported test selector '${selector}'. Supported selectors: ${supportedSelectors.join(', ')}.`,
  inputSelector: (selector: string) =>
    `Unsupported input test selector '${selector}'. Supported selectors: ${supportedInputSelectors.join(', ')}.`,
  missingCheck: (name: string) => `Test '${name}' must declare at least one check.`,
  missingRun: (name: string) => `Check '${name}' must start exactly one app with run.`,
  duplicateRun: (name: string) => `Check '${name}' must not declare more than one run step.`,
  expectationBeforeRun: 'Check steps must come after the run step.',
  runTarget: (name: string) => `Run target '${name}' must be an app.`,
  selectIndex: 'Tagged loop row selection uses a 1-based index greater than zero.',
  selectBlock: 'A select block may contain test steps but cannot start another app.',
} as const

const validateRunPlacement = validateStepPlacement(testValidationMessages.runPlacement)
const validatePressPlacement = validateStepPlacement(testValidationMessages.pressPlacement)
const validateEnterPlacement = validateStepPlacement(testValidationMessages.enterPlacement)
const validateInputExpectationPlacement = validateStepPlacement(testValidationMessages.inputExpectationPlacement)
const validateSubmitPlacement = validateStepPlacement(testValidationMessages.submitPlacement)
const validateDataStatusPlacement = validateStepPlacement(testValidationMessages.dataStatusPlacement)
const validateExpectationPlacement = validateStepPlacement(testValidationMessages.expectationPlacement)
const validateBackPlacement = validateStepPlacement(testValidationMessages.backPlacement)

/** testValidationChecks validates v0 Tao test declarations and steps. */
export const testValidationChecks = {
  [AST.TestDeclaration.$type]: validateTest,
  [AST.CheckDeclaration.$type]: validateCheck,
  [AST.RunStep.$type]: validateRunPlacement,
  [AST.PressTextStep.$type]: [validatePressPlacement, validateSelector],
  [AST.TagPressStep.$type]: validatePressPlacement,
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
  [AST.DataStatusStep.$type]: validateDataStatusPlacement,
  [AST.ExpectTextStep.$type]: [validateExpectationPlacement, validateSelector],
} satisfies NodeValidationChecks

function validateTest(test: AST.TestDeclaration, ctx: ValidationContext): void {
  if (!AST.isTaoFile(test.$container)) {
    ctx.error(testValidationMessages.testPlacement, test)
  }
  const checks = test.block.statements.filter(AST.isCheckDeclaration)
  if (checks.length === 0) {
    ctx.error(testValidationMessages.missingCheck(test.name), test)
  }
  for (const statement of test.block.statements) {
    if (!AST.isCheckDeclaration(statement)) {
      ctx.error(testValidationMessages.testBlock(test.name), statement)
    }
  }
}

function validateCheck(check: AST.CheckDeclaration, ctx: ValidationContext): void {
  if (!AST.isTestDeclaration(blockOwner(check))) {
    ctx.error(testValidationMessages.checkPlacement, check)
  }
  for (const statement of check.block.statements) {
    if (!AST.isCheckStep(statement)) {
      ctx.error(testValidationMessages.checkBlock(check.name), statement)
    }
  }
  const runSteps = check.block.statements.filter(AST.isRunStep)
  if (runSteps.length === 0) {
    ctx.error(testValidationMessages.missingRun(check.name), check)
    return
  }
  for (const run of runSteps) {
    validateRun(run, ctx)
  }
  for (const run of runSteps.slice(1)) {
    ctx.error(testValidationMessages.duplicateRun(check.name), run)
  }

  let hasRun = false
  for (const step of check.block.statements.filter(AST.isCheckStep)) {
    Switch.type(step, {
      DataStatusStep: checkStepOrder,
      EnterTextStep: checkStepOrder,
      TagEnterStep: checkStepOrder,
      ExpectInputValueStep: checkStepOrder,
      TagInputValueExpectation: checkStepOrder,
      ExpectTextStep: checkStepOrder,
      ExpectGroupStep: checkStepOrder,
      ExpectScopeStep: checkStepOrder,
      PressTextStep: checkStepOrder,
      TagPressStep: checkStepOrder,
      RunStep: () => {
        hasRun = true
      },
      SubmitInputStep: checkStepOrder,
      TagSubmitStep: checkStepOrder,
      SelectStep: checkStepOrder,
      BackTestStep: checkStepOrder,
    })
  }

  function checkStepOrder(
    step:
      | AST.DataStatusStep
      | AST.EnterTextStep
      | AST.TagEnterStep
      | AST.ExpectInputValueStep
      | AST.TagInputValueExpectation
      | AST.ExpectTextStep
      | AST.ExpectGroupStep
      | AST.ExpectScopeStep
      | AST.PressTextStep
      | AST.TagPressStep
      | AST.SubmitInputStep
      | AST.TagSubmitStep
      | AST.SelectStep
      | AST.BackTestStep,
  ): void {
    if (!hasRun) {
      ctx.error(testValidationMessages.expectationBeforeRun, step)
    }
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
    if (!AST.isCheckStep(statement) || AST.isRunStep(statement)) {
      ctx.error(testValidationMessages.selectBlock, statement)
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
  if (!supportedSelectors.includes(step.selector as (typeof supportedSelectors)[number])) {
    ctx.error(testValidationMessages.selector(step.selector), step)
  }
}

function validateInputSelector(step: AST.ExpectInputValueStep, ctx: ValidationContext): void {
  if (!supportedInputSelectors.includes(step.selector as (typeof supportedInputSelectors)[number])) {
    ctx.error(testValidationMessages.inputSelector(step.selector), step)
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
  return !AST.isCheckDeclaration(owner) && !AST.isTestDeclaration(owner) && !AST.isSelectStep(owner)
}
