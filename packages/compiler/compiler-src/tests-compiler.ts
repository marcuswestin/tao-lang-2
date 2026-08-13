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

/** TaoTestInputValueExpectation declares one selector-targeted native input value assertion. */
export type TaoTestInputValueExpectation = {
  kind: 'expectInputValue'
  selector: string
  target: string
  value: string
  source: TaoTestSourceLocation
}

export type TaoTestGroupedExpectation =
  | { kind: 'match'; missing: boolean; selector: 'label' | 'placeholder' | 'text'; target: string }
  | { kind: 'inputValue'; value: string }

/** TaoTestExpectationGroupStep preserves grouped assertions and an optional tag scope in test IR. */
export type TaoTestExpectationGroupStep = {
  kind: 'expectGroup'
  scopeTag?: string
  expectations: TaoTestGroupedExpectation[]
  source: TaoTestSourceLocation
}

/** TaoTestPressStep declares one v0 selector-targeted press action. */
export type TaoTestPressStep = {
  kind: 'press'
  selector: string
  text: string
  source: TaoTestSourceLocation
}

/** TaoTestEnterStep declares text entry into one selected input. */
export type TaoTestEnterStep = {
  kind: 'enter'
  selector: string
  target: string
  value: string
  source: TaoTestSourceLocation
}

/** TaoTestSubmitStep declares submission of one selected input. */
export type TaoTestSubmitStep = {
  kind: 'submit'
  selector: string
  target: string
  source: TaoTestSourceLocation
}

/** TaoTestDataStatusStep declares a deterministic provider state transition. */
export type TaoTestDataStatusStep = {
  kind: 'dataStatus'
  status: 'error' | 'loading' | 'ready'
  message: string
  source: TaoTestSourceLocation
}

/** TaoTestBackStep dispatches the active stack's platform-equivalent back operation. */
export type TaoTestBackStep = {
  kind: 'back'
  source: TaoTestSourceLocation
}

/** TaoTestSelectStep scopes nested operations to one 1-based tagged loop row. */
export type TaoTestSelectStep = {
  kind: 'select'
  tag: string
  index: number
  steps: TaoTestStep[]
  source: TaoTestSourceLocation
}

/** TaoTestStep declares one ordered v0 Tao test operation after the run step. */
export type TaoTestStep =
  | TaoTestBackStep
  | TaoTestDataStatusStep
  | TaoTestEnterStep
  | TaoTestExpectation
  | TaoTestExpectationGroupStep
  | TaoTestInputValueExpectation
  | TaoTestPressStep
  | TaoTestSelectStep
  | TaoTestSubmitStep

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

function compileInputValueExpectation(expectation: AST.ExpectInputValueStep): TaoTestInputValueExpectation {
  return {
    kind: 'expectInputValue',
    selector: expectation.selector,
    target: expectation.target,
    value: expectation.value,
    source: sourceLocation(expectation),
  }
}

function compileStep(step: Exclude<AST.CheckStep, AST.RunStep>): TaoTestStep {
  return Switch.type(step, {
    BackTestStep: compileBackTestStep,
    DataStatusStep: compileDataStatusStep,
    EnterTextStep: compileEnterTextStep,
    ExpectInputValueStep: compileInputValueExpectation,
    TagInputValueExpectation: expectation => ({
      kind: 'expectInputValue',
      selector: 'tag',
      target: tagName(expectation.tag),
      value: expectation.value,
      source: sourceLocation(expectation),
    }),
    ExpectTextStep: compileExpectation,
    ExpectGroupStep: step => compileExpectationGroup(step, undefined),
    ExpectScopeStep: step => compileExpectationGroup(step, tagName(step.tag)),
    PressTextStep: compilePressTextStep,
    TagPressStep: step => ({
      kind: 'press',
      selector: 'tag',
      text: tagName(step.tag),
      source: sourceLocation(step),
    }),
    SelectStep: compileSelectStep,
    SubmitInputStep: compileSubmitInputStep,
    TagSubmitStep: step => ({
      kind: 'submit',
      selector: 'tag',
      target: tagName(step.tag),
      source: sourceLocation(step),
    }),
    TagEnterStep: step => ({
      kind: 'enter',
      selector: 'tag',
      target: tagName(step.tag),
      value: step.value,
      source: sourceLocation(step),
    }),
  })
}

function compileBackTestStep(step: AST.BackTestStep): TaoTestBackStep {
  return { kind: 'back', source: sourceLocation(step) }
}

function compileDataStatusStep(step: AST.DataStatusStep): TaoTestDataStatusStep {
  return {
    kind: 'dataStatus',
    status: step.status || 'error',
    message: step.message || '',
    source: sourceLocation(step),
  }
}

function compileExpectationGroup(
  step: AST.ExpectGroupStep | AST.ExpectScopeStep,
  scopeTag: string | undefined,
): TaoTestExpectationGroupStep {
  return {
    kind: 'expectGroup',
    ...(scopeTag ? { scopeTag } : {}),
    expectations: step.block.expectations.map(expectation =>
      expectation.selector
        ? {
          kind: 'match' as const,
          missing: expectation.missing,
          selector: expectation.selector,
          target: expectation.value,
        }
        : { kind: 'inputValue' as const, value: expectation.value }
    ),
    source: sourceLocation(step),
  }
}

function compileSelectStep(step: AST.SelectStep): TaoTestSelectStep {
  return {
    kind: 'select',
    tag: tagName(step.tag),
    index: step.index,
    steps: step.block.statements.filter(AST.isCheckStep).filter(isRunnableTestStep).map(compileStep),
    source: sourceLocation(step),
  }
}

function tagName(tag: string): string {
  return tag.slice(1)
}

function compileEnterTextStep(enter: AST.EnterTextStep): TaoTestEnterStep {
  return {
    kind: 'enter',
    selector: enter.selector,
    target: enter.target,
    value: enter.value,
    source: sourceLocation(enter),
  }
}

function compilePressTextStep(press: AST.PressTextStep): TaoTestPressStep {
  return {
    kind: 'press',
    selector: press.selector,
    text: press.text,
    source: sourceLocation(press),
  }
}

function compileSubmitInputStep(submit: AST.SubmitInputStep): TaoTestSubmitStep {
  return {
    kind: 'submit',
    selector: submit.selector,
    target: submit.target,
    source: sourceLocation(submit),
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
