import { AST, type ParseResult } from '@parser'
import { Assert, type DiagnosticRange, Diagnostics, Switch } from '@shared'
import type { ValidationResult } from '@validator'
import type { CompilerContext } from './compiler'

type TaoTestPlanInput = ParseResult | ValidationResult

/** TaoTestSourceLocation declares where a compiled test-plan item came from. */
export type TaoTestSourceLocation = {
  filePath: string
  range?: DiagnosticRange
}

/** TaoTestRun declares the app launch step for a v0 check. */
export type TaoTestRun = {
  appName: string
  appSourcePath: string
  source: TaoTestSourceLocation
}

/** TaoTestExpectation declares one v0 selector-targeted assertion. */
export type TaoTestExpectation = {
  kind: 'expect'
  missing: boolean
  selector: string
  text: string
  source: TaoTestSourceLocation
}

/** TaoTestPressStep declares one v0 selector-targeted press action. */
export type TaoTestPressStep = {
  kind: 'press'
  selector: string
  text: string
  source: TaoTestSourceLocation
}

/** TaoTestInputStep declares one v0 selector-targeted text input action. */
export type TaoTestInputStep = {
  kind: 'input'
  selector: string
  source: TaoTestSourceLocation
  target: string
  value: string
}

/** TaoTestStep declares one ordered v0 Tao test operation after the run step. */
export type TaoTestStep = TaoTestExpectation | TaoTestPressStep | TaoTestInputStep

/** TaoTestCheck declares one runnable v0 Tao check. */
export type TaoTestCheck = {
  name: string
  source: TaoTestSourceLocation
  run: TaoTestRun
  steps: TaoTestStep[]
}

/** TaoTestSuite declares one Tao test suite. */
export type TaoTestSuite = {
  name: string
  source: TaoTestSourceLocation
  checks: TaoTestCheck[]
}

/** TaoTestPlan declares compiled v0 Tao tests for a test entry file. */
export type TaoTestPlan = {
  sourcePath: string
  suites: TaoTestSuite[]
}

/** compileTestPlan compiles parsed v0 Tao test declarations into structured test-plan IR. */
export function compileTestPlan(input: TaoTestPlanInput, _context: CompilerContext): TaoTestPlan {
  const errors = Diagnostics.errorMessages(input.diagnostics)
  Assert(errors.length === 0, `Cannot compile Tao tests with validation errors: ${errors.join('; ')}`, { errors })
  return {
    sourcePath: input.entry.path,
    suites: input.entry.ast.statements.filter(AST.isTestDeclaration).map(compileSuite),
  }
}

function compileSuite(suite: AST.TestDeclaration): TaoTestSuite {
  return {
    name: suite.name,
    source: sourceLocation(suite),
    checks: suite.block.statements.filter(AST.isCheckDeclaration).map(compileCheck),
  }
}

function compileCheck(check: AST.CheckDeclaration): TaoTestCheck {
  const run = check.block.statements.find(AST.isRunStep)
  Assert.defined(run, 'validated check has one run step', { checkName: check.name })
  const steps = check.block.statements.filter(AST.isCheckStep).filter(isRunnableTestStep).map(compileStep)
  return {
    name: check.name,
    source: sourceLocation(check),
    run: compileRun(run),
    steps,
  }
}

function compileRun(run: AST.RunStep): TaoTestRun {
  const app = run.app.ref
  Assert.defined(app, 'validated run step references an app', { appName: run.app.$refText })
  return {
    appName: app.name,
    appSourcePath: sourceLocation(app).filePath,
    source: sourceLocation(run),
  }
}

function compileExpectation(expectation: AST.ExpectTextStep): TaoTestExpectation {
  return {
    kind: 'expect',
    missing: expectation.missing,
    selector: expectation.selector,
    text: expectation.text,
    source: sourceLocation(expectation),
  }
}

function compileStep(step: Exclude<AST.CheckStep, AST.RunStep>): TaoTestStep {
  return Switch.type(step, {
    ExpectTextStep: compileExpectation,
    InputTextStep: compileInputTextStep,
    PressTextStep: compilePressTextStep,
  })
}

function compilePressTextStep(press: AST.PressTextStep): TaoTestPressStep {
  return {
    kind: 'press',
    selector: press.selector,
    text: press.text,
    source: sourceLocation(press),
  }
}

function compileInputTextStep(input: AST.InputTextStep): TaoTestInputStep {
  return {
    kind: 'input',
    selector: input.selector,
    source: sourceLocation(input),
    target: input.target,
    value: input.value,
  }
}

function isRunnableTestStep(step: AST.CheckStep): step is Exclude<AST.CheckStep, AST.RunStep> {
  return !AST.isRunStep(step)
}

function sourceLocation(node: AST.Node): TaoTestSourceLocation {
  return {
    filePath: AST.getDocument(node).uri.path,
    range: node.$cstNode?.range,
  }
}
