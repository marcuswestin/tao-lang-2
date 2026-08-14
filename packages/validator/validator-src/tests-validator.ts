import { AST } from '@parser'
import { Switch } from '@shared'
import type { ValidationContext } from './validation'

const supportedSelectors = ['text', 'label', 'id', 'placeholder'] as const
const supportedInputSelectors = ['label', 'id', 'placeholder'] as const

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
} as const

/** validateTests validates v0 Tao test declarations. */
export function validateTests(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const test of AST.streamAllContents(file).filter(AST.isTestDeclaration)) {
    validateTest(test, ctx)
  }
  for (const check of AST.streamAllContents(file).filter(AST.isCheckDeclaration)) {
    validateCheck(check, ctx)
  }
  for (const run of AST.streamAllContents(file).filter(AST.isRunStep)) {
    if (statementNeedsStepPlacementDiagnostic(run)) {
      ctx.error(testValidationMessages.runPlacement, run)
    }
  }
  for (const press of AST.streamAllContents(file).filter(AST.isPressTextStep)) {
    if (statementNeedsStepPlacementDiagnostic(press)) {
      ctx.error(testValidationMessages.pressPlacement, press)
    }
    validateSelector(press, ctx)
  }
  for (const enter of AST.streamAllContents(file).filter(AST.isEnterTextStep)) {
    if (statementNeedsStepPlacementDiagnostic(enter)) {
      ctx.error(testValidationMessages.enterPlacement, enter)
    }
    validateSelector(enter, ctx)
  }
  for (const expectation of AST.streamAllContents(file).filter(AST.isExpectInputValueStep)) {
    if (statementNeedsStepPlacementDiagnostic(expectation)) {
      ctx.error(testValidationMessages.inputExpectationPlacement, expectation)
    }
    validateInputSelector(expectation, ctx)
  }
  for (const submit of AST.streamAllContents(file).filter(AST.isSubmitInputStep)) {
    if (statementNeedsStepPlacementDiagnostic(submit)) {
      ctx.error(testValidationMessages.submitPlacement, submit)
    }
    validateSelector(submit, ctx)
  }
  for (const back of AST.streamAllContents(file).filter(AST.isBackTestStep)) {
    if (statementNeedsStepPlacementDiagnostic(back)) {
      ctx.error(testValidationMessages.backPlacement, back)
    }
  }
  for (const status of AST.streamAllContents(file).filter(AST.isDataStatusStep)) {
    if (statementNeedsStepPlacementDiagnostic(status)) {
      ctx.error(testValidationMessages.dataStatusPlacement, status)
    }
  }
  for (const expectation of AST.streamAllContents(file).filter(AST.isExpectTextStep)) {
    if (statementNeedsStepPlacementDiagnostic(expectation)) {
      ctx.error(testValidationMessages.expectationPlacement, expectation)
    }
    validateSelector(expectation, ctx)
  }
}

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
      ExpectInputValueStep: checkStepOrder,
      ExpectTextStep: checkStepOrder,
      PressTextStep: checkStepOrder,
      RunStep: () => {
        hasRun = true
      },
      SubmitInputStep: checkStepOrder,
      BackTestStep: checkStepOrder,
    })
  }

  function checkStepOrder(
    step:
      | AST.DataStatusStep
      | AST.EnterTextStep
      | AST.ExpectInputValueStep
      | AST.ExpectTextStep
      | AST.PressTextStep
      | AST.SubmitInputStep
      | AST.BackTestStep,
  ): void {
    if (!hasRun) {
      ctx.error(testValidationMessages.expectationBeforeRun, step)
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

function blockOwner(node: AST.Node): AST.Node | undefined {
  const parent = node.$container
  return AST.isBlock(parent) ? parent.$container : undefined
}

function statementNeedsStepPlacementDiagnostic(statement: AST.CheckStep): boolean {
  const owner = blockOwner(statement)
  return !AST.isCheckDeclaration(owner) && !AST.isTestDeclaration(owner)
}
