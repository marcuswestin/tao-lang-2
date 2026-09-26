import { ASTUtils, Units } from '@ast-utils'
import { AST, type ParseResult } from '@parser'
import { Assert, type DiagnosticRange, Diagnostics, Switch } from '@shared'
import type { ValidationResult } from '@validator'
import type { CompilerContext } from './compiler'
import { foreignActionTestStubKey } from './foreign-action-test-stubs'

type TaoTestPlanInput = ParseResult | ValidationResult

/** TaoTestSourceLocation declares where a compiled test-plan item came from. */
type TaoTestSourceLocation = {
  filePath: string
  range?: DiagnosticRange
}

/** TaoTestRun declares the app launch step for a v0 check. */
type TaoTestRun = {
  appName: string
  appSourcePath: string
  source: TaoTestSourceLocation
}

type TaoTestActionFailureStub = {
  actionKey: string
  caseName: string
}

/** TaoTestExpectation declares one v0 selector-targeted assertion. */
type TaoTestExpectation = {
  kind: 'expect'
  missing: boolean
  selector: string
  text: string
  source: TaoTestSourceLocation
}

/** TaoTestCheckboxStateExpectation declares one tag-only accessible checkbox assertion. */
type TaoTestCheckboxStateExpectation = {
  checked: boolean
  kind: 'expectCheckboxState'
  source: TaoTestSourceLocation
  tag: string
}

/** TaoTestInputValueExpectation declares one selector-targeted native input value assertion. */
type TaoTestInputValueExpectation = {
  kind: 'expectInputValue'
  selector: string
  target: string
  value: string
  source: TaoTestSourceLocation
}

type TaoTestGroupedExpectation =
  | { kind: 'match'; missing: boolean; selector: 'label' | 'placeholder' | 'text'; target: string }
  | { kind: 'inputValue'; value: string }

/** TaoTestExpectationGroupStep preserves grouped assertions and an optional tag scope in test IR. */
type TaoTestExpectationGroupStep = {
  kind: 'expectGroup'
  scopeTag?: string
  expectations: TaoTestGroupedExpectation[]
  source: TaoTestSourceLocation
}

/** TaoTestPressStep declares one v0 selector-targeted press action. */
type TaoTestPressStep = {
  kind: 'press'
  selector: string
  text: string
  source: TaoTestSourceLocation
}

/** TaoTestPressPhaseStep delivers one half of a press without synthesizing the other half. */
type TaoTestPressPhaseStep = {
  selector: string
  target: string
  source: TaoTestSourceLocation
} & ({ kind: 'pressDown' } | { kind: 'pressUp' })

/** TaoTestHoverStep moves the pointer over one selector target. */
type TaoTestHoverStep = {
  kind: 'hover'
  selector: string
  target: string
  source: TaoTestSourceLocation
}

/** TaoTestFocusStep gives focus to one stable tagged element. */
type TaoTestFocusStep = {
  kind: 'focus'
  tag: string
  source: TaoTestSourceLocation
}

/** TaoTestPressKeyStep dispatches one normalized keyboard chord. */
type TaoTestPressKeyStep = {
  key: string
  kind: 'pressKey'
  source: TaoTestSourceLocation
}

/** TaoTestNarrowStep enters text into the active command-search field. */
type TaoTestNarrowStep = {
  kind: 'narrow'
  source: TaoTestSourceLocation
  text: string
}

/** TaoTestTargetExpectation asserts the active command target label. */
type TaoTestTargetExpectation = {
  kind: 'expectTarget'
  label: string
  source: TaoTestSourceLocation
}

/** TaoTestFocusRegionExpectation asserts the active focus-region label. */
type TaoTestFocusRegionExpectation = {
  kind: 'expectFocusRegion'
  label: string
  source: TaoTestSourceLocation
}

/** TaoTestVerbsExpectation asserts the visible command verb labels in order. */
type TaoTestVerbsExpectation = {
  kind: 'expectVerbs'
  labels: string[]
  source: TaoTestSourceLocation
}

/** TaoTestEnterStep declares text entry into one selected input. */
type TaoTestEnterStep = {
  kind: 'enter'
  selector: string
  target: string
  value: string
  source: TaoTestSourceLocation
}

/** TaoTestSubmitStep declares submission of one selected input. */
type TaoTestSubmitStep = {
  kind: 'submit'
  selector: string
  target: string
  source: TaoTestSourceLocation
}

/** TaoTestBackStep dispatches the active stack's platform-equivalent back operation. */
type TaoTestBackStep = {
  kind: 'back'
  source: TaoTestSourceLocation
}

/**
 * TaoTestRelaunchStep replaces the mounted app with a new instance on the same device: device-local
 * persisted state, stored data, and the held clock outlive it, and the new instance restores where
 * the person was; every ephemeral view state does not. `fresh` opts that one launch out of
 * restoring, so it opens on the app's initial screen.
 */
type TaoTestRelaunchStep = {
  fresh: boolean
  kind: 'relaunch'
  source: TaoTestSourceLocation
}

/** TaoTestAdvanceStep moves the held clock forward by a duration in milliseconds. */
type TaoTestAdvanceStep = {
  kind: 'advance'
  milliseconds: number
  source: TaoTestSourceLocation
}

type TaoTestNavigationTitleExpectation = {
  kind: 'expectNavigationTitle'
  source: TaoTestSourceLocation
  title: string
}

type TaoTestToolbarCommandExpectation = {
  enabled: boolean
  kind: 'expectToolbarCommand'
  label: string
  source: TaoTestSourceLocation
}

type TaoTestToolbarCommandPress = {
  kind: 'pressToolbarCommand'
  label: string
  source: TaoTestSourceLocation
}

/** TaoTestSelectStep scopes nested operations to one 1-based tagged loop row. */
type TaoTestSelectStep = {
  kind: 'select'
  tag: string
  index: number
  steps: TaoTestStep[]
  source: TaoTestSourceLocation
}

/** TaoTestStep declares one ordered v0 Tao test operation after the run step. */
type TaoTestStep =
  | TaoTestAdvanceStep
  | TaoTestBackStep
  | TaoTestEnterStep
  | TaoTestExpectation
  | TaoTestCheckboxStateExpectation
  | TaoTestExpectationGroupStep
  | TaoTestNavigationTitleExpectation
  | TaoTestInputValueExpectation
  | TaoTestPressStep
  | TaoTestPressPhaseStep
  | TaoTestHoverStep
  | TaoTestFocusStep
  | TaoTestPressKeyStep
  | TaoTestNarrowStep
  | TaoTestTargetExpectation
  | TaoTestFocusRegionExpectation
  | TaoTestVerbsExpectation
  | TaoTestToolbarCommandExpectation
  | TaoTestToolbarCommandPress
  | TaoTestRelaunchStep
  | TaoTestSelectStep
  | TaoTestSubmitStep
  | { kind: 'network'; mode: 'offline' | 'online'; source: TaoTestSourceLocation }
  | { kind: 'waitForSync'; source: TaoTestSourceLocation }
  | {
    kind: 'datasourceFailure'
    operation: 'create' | 'delete' | 'update'
    entity: string
    message: string
    source: TaoTestSourceLocation
  }

/** TaoTestDevice declares the viewport preset an `on <device>` clause pins for a check. */
type TaoTestDevice = {
  device: 'laptop' | 'phone' | 'tablet'
  height: number
  width: number
}

/**
 * TaoTestFixtureValue mirrors the Studio preview fixture value shape (`TaoStudioFixtureValue` in
 * `@runtime/TR`) field for field, so a compiled test fixture plan can be handed straight to the same
 * runtime seeding seam a Studio scenario's fixture already uses.
 */
type TaoTestFixtureValue =
  | boolean
  | number
  | string
  | { kind: 'now' }
  | { handle: string; kind: 'fixture-reference' }

/** TaoTestFixtureCreate declares one row a `with <fixture>` clause creates before a check launches. */
type TaoTestFixtureCreate = {
  account?: string
  entity: string
  fields: Readonly<Record<string, TaoTestFixtureValue>>
  name: string
}

/** TaoTestFixture declares the rows a check's effective fixture creates. */
type TaoTestFixture = {
  accounts: readonly { name: string; fields: Readonly<Record<string, TaoTestFixtureValue>> }[]
  signedIn?: string
  creates: readonly TaoTestFixtureCreate[]
  name: string
}

/** TaoTestCheck declares one runnable v0 Tao check. */
type TaoTestCheck = {
  name: string
  source: TaoTestSourceLocation
  run: TaoTestRun
  steps: TaoTestStep[]
  actionFailureStubs?: TaoTestActionFailureStub[]
  device?: TaoTestDevice
  fixture?: TaoTestFixture
}

/** TaoTestSuite declares one Tao test suite. */
type TaoTestSuite = {
  name: string
  source: TaoTestSourceLocation
  checks: TaoTestCheck[]
}

/** TaoTestPlan declares compiled v0 Tao tests for a test entry file. */
export type TaoTestPlan = {
  /** Version makes this serialized, host-neutral test-plan contract safely extensible. */
  version: 1
  sourcePath: string
  suites: TaoTestSuite[]
}

/** compileTestPlan compiles parsed v0 Tao test declarations into structured test-plan IR. */
export function compileTestPlan(input: TaoTestPlanInput, _context: CompilerContext): TaoTestPlan {
  const errors = Diagnostics.errorMessages(input.diagnostics)
  Assert(errors.length === 0, `Cannot compile Tao tests with validation errors: ${errors.join('; ')}`, { errors })
  return {
    version: 1,
    sourcePath: input.entry.path,
    suites: input.entry.ast.statements.filter(AST.isTestDeclaration).map(compileSuite),
  }
}

function compileSuite(suite: AST.TestDeclaration): TaoTestSuite {
  const checks = leafTests(suite).map(compileCheck)
  // A suite's checks are the leaf tests nested in it and nothing else, so a file-level test written
  // as a leaf journey compiles to a suite of none. The validator rejects that shape; asserting it
  // here keeps the one failure mode a test run cannot report — a file that runs nothing and passes —
  // from surviving a compile that was told validation had already happened.
  Assert(checks.length > 0, 'validated test suite declares at least one check', { suiteName: suite.name })
  return {
    name: AST.testDisplayName(suite),
    source: sourceLocation(suite),
    checks,
  }
}

/** leafTests returns a test's leaf descendants in document order, at whatever depth they nest. */
function leafTests(test: AST.TestDeclaration): AST.TestDeclaration[] {
  const nested = test.block.statements.filter(AST.isTestDeclaration)
  return nested.length === 0 ? [test] : nested.flatMap(leafTests)
}

function compileCheck(check: AST.TestDeclaration): TaoTestCheck {
  const run = check.block.statements.find(AST.isRunStep)
  Assert.defined(run, 'validated check has one run step', { checkName: check.name })
  const steps = check.block.statements.filter(AST.isCheckStep).filter(isRunnableTestStep).map(compileStep)
  // A nested test inherits its nearest ancestor's `on`/`with` unless it repeats the clause itself
  // (Decisions §16), so the effective clause may belong to an ancestor rather than this check.
  const device = AST.effectiveTestClause(check, AST.isTestDeviceClause)
  const fixture = AST.effectiveTestClause(check, AST.isTestFixtureClause)?.fixture.ref
  return {
    name: AST.testDisplayName(check),
    source: sourceLocation(check),
    run: compileRun(run),
    steps,
    actionFailureStubs: check.block.statements.filter(AST.isActionFailureStubStep).map(stub => {
      const action = stub.action.ref
      Assert.defined(action, 'validated action stub references an action')
      return { actionKey: foreignActionTestStubKey(action), caseName: stub.case }
    }),
    ...(device === undefined ? {} : { device: compileDevice(device) }),
    ...(fixture === undefined ? {} : { fixture: compileFixture(fixture) }),
  }
}

function compileDevice(device: AST.TestDeviceClause): TaoTestDevice {
  const defaults = device.device === 'phone'
    ? { height: 844, width: 390 }
    : device.device === 'tablet'
    ? { height: 1024, width: 768 }
    : { height: 900, width: 1440 }
  return {
    device: device.device,
    height: device.height ?? defaults.height,
    width: device.width ?? defaults.width,
  }
}

/**
 * compileFixture compiles a fixture's created rows into the same shape Studio's own fixture plan
 * uses, so the runtime seeding seam a scenario already seeds its store through also seeds a check's.
 * `through` bindings are not compiled: the same runtime seam declines to execute them yet, matching
 * Studio's own current limit, and a validated `with <fixture>` never reaches here with one.
 */
function compileFixture(fixture: AST.FixtureDeclaration): TaoTestFixture {
  const creates = fixture.block.entries.filter(entry =>
    AST.isFixtureCreateBinding(entry) || AST.isFixtureCreateStatement(entry)
  )
  const signedIn = fixture.block.entries.find(AST.isFixtureSignedInClause)?.account.$refText
  return {
    name: fixture.name,
    accounts: fixture.block.entries.filter(AST.isFixtureAccountDeclaration).map(account => ({
      name: account.name,
      fields: Object.fromEntries(account.block.fields.map(field => [field.name, compileFixtureValue(field.value)])),
    })),
    ...(signedIn ? { signedIn } : {}),
    creates: creates.map((binding, index) => {
      const name = AST.isFixtureCreateBinding(binding) ? binding.name : `_Created${index + 1}`
      Assert(binding.through === undefined, 'validated test fixture has no through binding', {
        binding: name,
        fixture: fixture.name,
      })
      const entity = binding.entity.ref
      Assert.defined(entity, 'validated fixture create binding references an entity', { binding: name })
      return {
        entity: entity.singularName,
        fields: Object.fromEntries(binding.block.fields.map(field => [field.name, compileFixtureValue(field.value)])),
        name,
        ...(binding.account?.$refText ?? signedIn ? { account: binding.account?.$refText ?? signedIn } : {}),
      }
    }),
  }
}

function compileFixtureValue(value: AST.FixtureValue): TaoTestFixtureValue {
  return Switch.type(value, {
    // The grammar's BooleanLiteralValue is the source word; convert it to the declared boolean.
    BooleanLiteral: value => value.value === 'true',
    FixtureValueReference: value => ({ handle: value.target.$refText, kind: 'fixture-reference' as const }),
    NowExpression: () => ({ kind: 'now' as const }),
    NumberLiteral: value => value.value,
    StringLiteral: value => value.value,
  })
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
    AdvanceStep: compileAdvanceStep,
    NetworkTestStep: step => ({ kind: 'network', mode: step.mode, source: sourceLocation(step) }),
    WaitForSyncStep: step => ({ kind: 'waitForSync', source: sourceLocation(step) }),
    DatasourceFailureStep: step => ({
      kind: 'datasourceFailure',
      operation: step.operation,
      entity: step.entity,
      message: step.message,
      source: sourceLocation(step),
    }),
    BackTestStep: compileBackTestStep,
    RelaunchStep: compileRelaunchStep,
    EnterTextStep: compileEnterTextStep,
    ExpectCheckboxStateStep: step => ({
      checked: step.state === 'checked',
      kind: 'expectCheckboxState',
      source: sourceLocation(step),
      tag: tagName(step.tag),
    }),
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
    ExpectNavigationTitleStep: step => ({
      kind: 'expectNavigationTitle',
      source: sourceLocation(step),
      title: literalText(step.value),
    }),
    ExpectScopeStep: step => compileExpectationGroup(step, tagName(step.tag)),
    ExpectToolbarCommandStep: step => ({
      enabled: step.state === 'enabled',
      kind: 'expectToolbarCommand',
      label: literalText(step.value),
      source: sourceLocation(step),
    }),
    PressTextStep: compilePressTextStep,
    PressWordStep: compilePressWordStep,
    InteractionWordStep: compileInteractionWordStep,
    PressToolbarCommandStep: step => ({
      kind: 'pressToolbarCommand',
      label: literalText(step.value),
      source: sourceLocation(step),
    }),
    TagPressStep: step => ({
      kind: 'press',
      selector: 'tag',
      text: tagName(step.tag),
      source: sourceLocation(step),
    }),
    SelectStep: compileSelectStep,
    ExpectInteractionStep: compileInteractionExpectation,
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

function compileInteractionExpectation(
  step: AST.ExpectInteractionStep,
): TaoTestTargetExpectation | TaoTestFocusRegionExpectation | TaoTestVerbsExpectation {
  if (step.subject === 'target') {
    return {
      kind: 'expectTarget',
      label: step.values[0] ?? '',
      source: sourceLocation(step),
    }
  }
  if (step.subject === 'focus') {
    return {
      kind: 'expectFocusRegion',
      label: step.values[0] ?? '',
      source: sourceLocation(step),
    }
  }
  return {
    kind: 'expectVerbs',
    labels: [...step.values],
    source: sourceLocation(step),
  }
}

function literalText(expression: AST.Expression): string {
  Assert.is(expression, AST.isStringLiteral, 'validated navigation chrome test step uses literal text')
  return expression.value
}

function compileBackTestStep(step: AST.BackTestStep): TaoTestBackStep {
  return { kind: 'back', source: sourceLocation(step) }
}

function compileRelaunchStep(step: AST.RelaunchStep): TaoTestRelaunchStep {
  return { fresh: step.fresh, kind: 'relaunch', source: sourceLocation(step) }
}

function compileAdvanceStep(step: AST.AdvanceStep): TaoTestAdvanceStep {
  const nanoseconds = ASTUtils.literalDurationOf(step.duration)
  Assert.defined(nanoseconds, 'validated advance step names a literal duration')
  return { kind: 'advance', milliseconds: Units.baseToMilliseconds(nanoseconds), source: sourceLocation(step) }
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
    selector: enter.selector ?? 'text',
    target: enter.target,
    value: enter.value,
    source: sourceLocation(enter),
  }
}

function compilePressTextStep(press: AST.PressTextStep): TaoTestPressStep {
  return {
    kind: 'press',
    selector: press.selector ?? 'text',
    text: press.text,
    source: sourceLocation(press),
  }
}

function compilePressWordStep(step: AST.PressWordStep): TaoTestPressKeyStep | TaoTestPressPhaseStep {
  if (step.subject === 'key') {
    Assert.defined(step.target, 'validated key press names a value')
    return { key: step.target, kind: 'pressKey', source: sourceLocation(step) }
  }
  Assert(step.subject === 'down' || step.subject === 'up', 'validated press word step names key, down, or up')
  return {
    kind: step.subject === 'down' ? 'pressDown' : 'pressUp',
    ...pointerTarget(step),
    source: sourceLocation(step),
  }
}

function compileInteractionWordStep(
  step: AST.InteractionWordStep,
): TaoTestHoverStep | TaoTestFocusStep | TaoTestNarrowStep {
  if (step.head === 'hover') {
    return { kind: 'hover', ...pointerTarget(step), source: sourceLocation(step) }
  }
  if (step.head === 'focus') {
    Assert.defined(step.tag, 'validated focus step names a tag')
    return { kind: 'focus', source: sourceLocation(step), tag: tagName(step.tag) }
  }
  Assert(step.head === 'narrow', 'validated interaction word step names hover, focus, or narrow')
  Assert.defined(step.target, 'validated narrow step names text')
  return { kind: 'narrow', source: sourceLocation(step), text: step.target }
}

function pointerTarget(step: AST.PressWordStep | AST.InteractionWordStep): { selector: string; target: string } {
  if (step.tag !== undefined) {
    return { selector: 'tag', target: tagName(step.tag) }
  }
  Assert.defined(step.target, 'parsed pointer step has a text target or tag')
  return { selector: step.selector ?? 'text', target: step.target }
}

function compileSubmitInputStep(submit: AST.SubmitInputStep): TaoTestSubmitStep {
  return {
    kind: 'submit',
    selector: submit.selector ?? 'text',
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
