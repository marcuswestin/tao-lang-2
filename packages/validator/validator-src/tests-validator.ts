import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import type { ValidationContext } from './validation'

/** testValidationMessages declares structural diagnostics for Tao test declarations. */
export const testValidationMessages = {
  testPlacement: 'Test declarations are only allowed at file level.',
  testBlock: (name: string) => `Only check declarations are allowed in test '${name}'.`,
  checkPlacement: 'Check declarations are only allowed inside test blocks.',
  checkBlock: (name: string) => `Only run and expect text statements are allowed in check '${name}'.`,
  runPlacement: 'Run steps are only allowed inside check blocks.',
  expectationPlacement: 'Expectations are only allowed inside check blocks.',
  missingCheck: (name: string) => `Test '${name}' must declare at least one check.`,
  missingRun: (name: string) => `Check '${name}' must start exactly one app with run.`,
  duplicateRun: (name: string) => `Check '${name}' must not declare more than one run step.`,
  expectationBeforeRun: 'Expectations must come after the run step.',
  runTarget: (name: string) => `Run target '${name}' must be an app.`,
} as const

/** validateTests validates v0 Tao test declarations. */
export function validateTests(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const test of ASTUtils.streamAllContents(file).filter(AST.isTestDeclaration)) {
    validateTest(test, ctx)
  }
  for (const check of ASTUtils.streamAllContents(file).filter(AST.isCheckDeclaration)) {
    validateCheck(check, ctx)
  }
  for (const run of ASTUtils.streamAllContents(file).filter(AST.isRunStep)) {
    if (!AST.isCheckDeclaration(blockOwner(run))) {
      ctx.error(testValidationMessages.runPlacement, run)
    }
  }
  for (const expectation of ASTUtils.streamAllContents(file).filter(AST.isExpectTextStep)) {
    if (!AST.isCheckDeclaration(blockOwner(expectation))) {
      ctx.error(testValidationMessages.expectationPlacement, expectation)
    }
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
  for (const step of check.block.statements) {
    if (AST.isRunStep(step)) {
      hasRun = true
      continue
    }
    if (!hasRun && AST.isExpectTextStep(step)) {
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

function blockOwner(node: AST.Node): AST.Node | undefined {
  const parent = node.$container
  return AST.isBlock(parent) ? parent.$container : undefined
}
