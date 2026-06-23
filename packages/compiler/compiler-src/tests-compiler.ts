import { AST } from '@parser'
import { Assert, type DiagnosticRange, Diagnostics } from '@shared'
import type { ValidationResult } from '@validator'
import type { CompilerContext } from './compiler'

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

/** TaoTestExpectation declares one v0 rendered-text assertion. */
export type TaoTestExpectation = {
  kind: 'text' | 'missingText'
  text: string
  source: TaoTestSourceLocation
}

/** TaoTestCheck declares one runnable v0 Tao check. */
export type TaoTestCheck = {
  name: string
  source: TaoTestSourceLocation
  run: TaoTestRun
  expectations: TaoTestExpectation[]
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

/** compileTestPlan compiles validated v0 Tao test declarations into structured test-plan IR. */
export function compileTestPlan(validationResult: ValidationResult, _context: CompilerContext): TaoTestPlan {
  const errors = Diagnostics.errorMessages(validationResult.diagnostics)
  Assert(errors.length === 0, `Cannot compile Tao tests with validation errors: ${errors.join('; ')}`, { errors })
  return {
    sourcePath: validationResult.entry.path,
    suites: validationResult.entry.ast.statements.filter(AST.isTestDeclaration).map(compileSuite),
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
  return {
    name: check.name,
    source: sourceLocation(check),
    run: compileRun(run),
    expectations: check.block.statements.filter(AST.isExpectTextStep).map(compileExpectation),
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
    kind: expectation.missing ? 'missingText' : 'text',
    text: expectation.text,
    source: sourceLocation(expectation),
  }
}

function sourceLocation(node: AST.Node): TaoTestSourceLocation {
  return {
    filePath: AST.getDocument(node).uri.path,
    range: node.$cstNode?.range,
  }
}
