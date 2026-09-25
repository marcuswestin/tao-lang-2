import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { FS, Switch } from '@shared'
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
  emptySuite: (name: string) =>
    `Test '${name}' declares no checks, so it would run nothing. A file-level test is a suite of`
    + ` nested tests: move its steps into test "<what it proves>" { … } inside it.`,
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
  networkPlacement: 'Network steps are only allowed inside test blocks.',
  syncPlacement: 'Wait for sync steps are only allowed inside test blocks.',
  datasourceFailurePlacement: 'Datasource failure steps are only allowed inside test blocks.',
  unknownDatasourceFailureEntity: (name: string) => `Datasource failure names unknown data entity '${name}'.`,
  unboundDatasourceFailureEntity: (name: string, app: string) =>
    `Datasource failure names '${name}', which app '${app}' does not bind.`,
  narrowPlacement: 'Narrow steps are only allowed inside test blocks.',
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
  interactionVocabulary: (expected: string) => `Expected '${expected}' in this interaction test step.`,
  interactionExpectation:
    "Expected 'target <label>', 'focus region <label>', or 'verbs <label>, ...' in this interaction test step.",
  duplicateHeadClause: (name: string, clause: string) => `Test '${name}' declares '${clause}' more than once.`,
  deviceDimensions: 'Test device dimensions must be positive whole numbers.',
  fixtureAppBinding: (fixture: string, entity: string, app: string) =>
    `Fixture '${fixture}' creates '${entity}', which app '${app}' does not bind.`,
  actionStubPlacement: 'An action failure stub is allowed only directly in a test check.',
  actionStubBeforeRun: 'An action failure stub must appear before run.',
  actionStubForeign: (name: string) => `Action '${name}' must be foreign to use a test failure stub.`,
  actionStubCase: (name: string, caseName: string) => `Action '${name}' does not declare failure case '${caseName}'.`,
  actionStubDuplicate: (name: string) => `Action '${name}' has more than one failure stub in this check.`,
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
const validateNarrowPlacement = validateStepPlacement(testValidationMessages.narrowPlacement)
const validateNetworkPlacement = validateStepPlacement(testValidationMessages.networkPlacement)
const validateSyncPlacement = validateStepPlacement(testValidationMessages.syncPlacement)
const validateDatasourceFailurePlacement = validateStepPlacement(testValidationMessages.datasourceFailurePlacement)

/** testValidationChecks validates v0 Tao test declarations and steps. */
export const testValidationChecks = {
  [AST.TestDeclaration.$type]: validateTest,
  [AST.ActionFailureStubStep.$type]: validateActionFailureStub,
  [AST.RunStep.$type]: validateRunPlacement,
  [AST.PressTextStep.$type]: [validatePressPlacement, validateSelector],
  [AST.TagPressStep.$type]: validatePressPlacement,
  [AST.PressWordStep.$type]: [validatePressPlacement, validatePressWordStep],
  [AST.InteractionWordStep.$type]: validateInteractionWordStep,
  [AST.PressToolbarCommandStep.$type]: [validatePressPlacement, validateNavigationVocabulary, validateNavigationValue],
  [AST.EnterTextStep.$type]: [validateEnterPlacement, validateSelector],
  [AST.TagEnterStep.$type]: validateEnterPlacement,
  [AST.ExpectInputValueStep.$type]: [validateInputExpectationPlacement, validateInputSelector],
  [AST.TagInputValueExpectation.$type]: validateInputExpectationPlacement,
  [AST.ExpectGroupStep.$type]: validateExpectationPlacement,
  [AST.ExpectScopeStep.$type]: validateExpectationPlacement,
  [AST.ExpectInteractionStep.$type]: [validateExpectationPlacement, validateInteractionExpectation],
  [AST.SubmitInputStep.$type]: [validateSubmitPlacement, validateSelector],
  [AST.TagSubmitStep.$type]: validateSubmitPlacement,
  [AST.SelectStep.$type]: validateSelect,
  [AST.BackTestStep.$type]: validateBackPlacement,
  [AST.RelaunchStep.$type]: validateRelaunchPlacement,
  [AST.AdvanceStep.$type]: [validateAdvancePlacement, validateAdvanceDuration],
  [AST.NetworkTestStep.$type]: validateNetworkPlacement,
  [AST.WaitForSyncStep.$type]: validateSyncPlacement,
  [AST.DatasourceFailureStep.$type]: [validateDatasourceFailurePlacement, validateDatasourceFailureTarget],
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
    ctx.error(step, testValidationMessages.advanceDuration)
    return
  }
  if (nanoseconds < 0) {
    ctx.error(step, testValidationMessages.advanceNegative)
  }
}

/** Faults name a real entity in the running app's store, even from a sidecar that cannot import it. */
function validateDatasourceFailureTarget(step: AST.DatasourceFailureStep, ctx: ValidationContext): void {
  const check = AST.findOwningTest(step)
  const app = check?.block.statements.find(AST.isRunStep)?.app.ref
  if (!app) {
    return
  }
  const appPath = AST.getDocument(app).uri.path
  const projectRoot = ctx.workspaceFiles
    .filter(file => file.statements.some(AST.isProjectDeclaration))
    .map(file => FS.dirname(AST.getDocument(file).uri.path))
    .filter(directory => FS.pathIsWithin(appPath, directory))
    .toSorted((left, right) => right.length - left.length)[0] ?? FS.dirname(appPath)
  const files = ctx.workspaceFiles.filter(file => FS.pathIsWithin(AST.getDocument(file).uri.path, projectRoot))
  const collections = files.flatMap(file => file.statements.filter(AST.isEntityDataDeclaration))
  const entity = collections.find(candidate => candidate.singularName === step.entity)
  if (!entity) {
    ctx.error(step, testValidationMessages.unknownDatasourceFailureEntity(step.entity))
    return
  }
  const plan = ASTUtils.planDataStores(
    collections,
    files.flatMap(file => file.statements.filter(AST.isDatasourceDeclaration)),
  )
  const store = ASTUtils.storeOfCollection(plan, entity)
  const bindings = ASTUtils.appBoundDatasources(app)
  if (store?.kind === 'device' || bindings.length === 0) {
    return
  }
  const bound = bindings.some(binding =>
    binding.declaration === undefined
      ? store?.kind === 'default'
      : store?.datasources.includes(binding.declaration)
  )
  if (!bound) {
    ctx.error(step, testValidationMessages.unboundDatasourceFailureEntity(step.entity, app.name))
  }
}

// A test is either a group of nested tests or a leaf journey of steps, never a mix.
function validateTest(test: AST.TestDeclaration, ctx: ValidationContext): void {
  if (AST.testDisplayName(test) === '') {
    ctx.error(test, testValidationMessages.unnamedTest)
  }
  validateTestHeadClauses(test, ctx)
  const owner = test.$container
  if (!AST.isTaoFile(owner) && !AST.isTestDeclaration(blockOwner(test))) {
    ctx.error(test, testValidationMessages.testPlacement)
  }
  const nested = test.block.statements.filter(AST.isTestDeclaration)
  if (nested.length > 0) {
    for (const statement of test.block.statements) {
      if (!AST.isTestDeclaration(statement)) {
        ctx.error(statement, testValidationMessages.testBlock(AST.testDisplayName(test)))
      }
    }
    return
  }
  // A file-level test is a suite, and the compiler takes its checks from the tests nested in it and
  // from nothing else. Written as a leaf it parses, validates step by step, and then compiles to a
  // suite of zero checks — a file that runs nothing and passes, which is the one test failure mode
  // nothing downstream can notice. The steps are not wrong; the level they sit at is.
  if (AST.isTaoFile(owner)) {
    ctx.error(test, testValidationMessages.emptySuite(AST.testDisplayName(test)))
    return
  }
  validateLeafTest(test, ctx)
}

function validateLeafTest(check: AST.TestDeclaration, ctx: ValidationContext): void {
  for (const statement of check.block.statements) {
    if (!AST.isCheckStep(statement) && !AST.isActionFailureStubStep(statement)) {
      ctx.error(statement, testValidationMessages.checkBlock(AST.testDisplayName(check)))
    }
  }
  const stubbed = new Set<AST.ActionDeclaration>()
  let seenRun = false
  for (const statement of check.block.statements) {
    if (AST.isRunStep(statement)) {
      seenRun = true
    }
    if (!AST.isActionFailureStubStep(statement)) {
      continue
    }
    if (seenRun) {
      ctx.error(statement, testValidationMessages.actionStubBeforeRun)
    }
    const action = statement.action.ref
    if (action && stubbed.has(action)) {
      ctx.error(statement, testValidationMessages.actionStubDuplicate(action.name))
    }
    if (action) {
      stubbed.add(action)
    }
  }
  const runSteps = check.block.statements.filter(AST.isRunStep)
  if (runSteps.length === 0) {
    ctx.error(check, testValidationMessages.missingRun(AST.testDisplayName(check)))
    return
  }
  for (const run of runSteps) {
    validateRun(run, ctx)
    validateFixtureBinding(check, run, ctx)
  }
  for (const run of runSteps.slice(1)) {
    ctx.error(run, testValidationMessages.duplicateRun(AST.testDisplayName(check)))
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
      PressWordStep: checkStepOrder,
      InteractionWordStep: checkStepOrder,
      PressToolbarCommandStep: checkStepOrder,
      ExpectInteractionStep: checkStepOrder,
      RunStep: () => {
        hasRun = true
      },
      AdvanceStep: checkStepOrder,
      NetworkTestStep: checkStepOrder,
      WaitForSyncStep: checkStepOrder,
      DatasourceFailureStep: checkStepOrder,
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
      | AST.PressWordStep
      | AST.InteractionWordStep
      | AST.PressToolbarCommandStep
      | AST.ExpectInteractionStep
      | AST.SubmitInputStep
      | AST.TagSubmitStep
      | AST.SelectStep
      | AST.BackTestStep
      | AST.RelaunchStep
      | AST.AdvanceStep
      | AST.NetworkTestStep
      | AST.WaitForSyncStep
      | AST.DatasourceFailureStep,
  ): void {
    if (!hasRun) {
      ctx.error(step, testValidationMessages.expectationBeforeRun)
    }
  }
}

function validateActionFailureStub(step: AST.ActionFailureStubStep, ctx: ValidationContext): void {
  if (!AST.isTestDeclaration(blockOwner(step))) {
    ctx.error(step, testValidationMessages.actionStubPlacement)
    return
  }
  const action = step.action.ref
  if (!action) {
    return
  }
  if (!action.foreign) {
    ctx.error(step, testValidationMessages.actionStubForeign(action.name))
    return
  }
  if (!action.foreign.failures.some(failure => failure.case.ref?.name === step.case)) {
    ctx.error(step, testValidationMessages.actionStubCase(action.name, step.case))
  }
}

function validatePressWordStep(step: AST.PressWordStep, ctx: ValidationContext): void {
  if (step.subject === 'key') {
    if (step.target === undefined || step.selector !== undefined) {
      ctx.error(step, testValidationMessages.interactionVocabulary('key "value"'))
    }
    if (AST.findOwningScenario(step)) {
      ctx.error(step, testValidationMessages.interactionVocabulary('down or up in a scenario'))
    }
    return
  }
  if (step.subject !== 'down' && step.subject !== 'up') {
    ctx.error(step, testValidationMessages.interactionVocabulary('key, down, or up'))
  }
  validatePointerSelector(step, ctx)
}

function validateInteractionWordStep(
  step: AST.InteractionWordStep,
  ctx: ValidationContext,
  file: AST.TaoFile,
): void {
  if (step.head === 'hover') {
    validateHoverPlacement(step, ctx, file)
    validatePointerSelector(step, ctx)
    return
  }
  if (step.head === 'focus') {
    validateFocusPlacement(step, ctx, file)
    if (step.tag === undefined) {
      ctx.error(step, testValidationMessages.interactionVocabulary('focus #tag'))
    }
    return
  }
  if (step.head === 'narrow') {
    validateNarrowPlacement(step, ctx, file)
    if (step.target === undefined || step.selector !== undefined) {
      ctx.error(step, testValidationMessages.interactionVocabulary('narrow "text"'))
    }
    if (AST.findOwningScenario(step)) {
      ctx.error(step, testValidationMessages.interactionVocabulary('hover or focus in a scenario'))
    }
    return
  }
  ctx.error(step, testValidationMessages.interactionVocabulary('hover, focus, or narrow'))
}

function validateInteractionExpectation(step: AST.ExpectInteractionStep, ctx: ValidationContext): void {
  const valid = (step.subject === 'target' && step.detail === undefined && step.values.length === 1)
    || (step.subject === 'focus' && step.detail === 'region' && step.values.length === 1)
    || (step.subject === 'verbs' && step.detail === undefined)
  if (!valid) {
    ctx.error(step, testValidationMessages.interactionExpectation)
  }
}

function validateNavigationValue(
  step: AST.ExpectNavigationTitleStep | AST.ExpectToolbarCommandStep | AST.PressToolbarCommandStep,
  ctx: ValidationContext,
): void {
  if (!AST.isStringLiteral(step.value)) {
    const actual = Type.ofExpression(step.value)
    if (actual.kind === 'primitive' && actual.primitive === 'text') {
      ctx.error(step.value, testValidationMessages.navigationValueLiteral)
      return
    }
  }
  const actual = Type.ofExpression(step.value)
  const expected: ASTUtils.TaoType = { kind: 'primitive', primitive: 'text' }
  if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
    ctx.error(step.value, testValidationMessages.navigationValueType(Type.displayName(actual)))
  }
}

function validateNavigationVocabulary(
  step: AST.ExpectNavigationTitleStep | AST.ExpectToolbarCommandStep | AST.PressToolbarCommandStep,
  ctx: ValidationContext,
): void {
  const actual = AST.isExpectNavigationTitleStep(step) ? step.subject : step.surface
  const expected = AST.isExpectNavigationTitleStep(step) ? 'title' : 'toolbar'
  if (actual !== expected) {
    ctx.error(step, testValidationMessages.navigationVocabulary(expected))
  }
}

function validateSelect(select: AST.SelectStep, ctx: ValidationContext): void {
  if (statementNeedsStepPlacementDiagnostic(select)) {
    ctx.error(select, testValidationMessages.expectationPlacement)
  }
  if (select.index < 1) {
    ctx.error(select, testValidationMessages.selectIndex)
  }
  for (const statement of select.block.statements) {
    if (AST.isRelaunchStep(statement)) {
      ctx.error(statement, testValidationMessages.relaunchInSelect)
      continue
    }
    if (!AST.isCheckStep(statement) || AST.isRunStep(statement)) {
      ctx.error(statement, testValidationMessages.selectBlock)
    }
    if (AST.findOwningScenario(select) && AST.isCheckStep(statement) && !AST.isScenarioStep(statement)) {
      ctx.error(statement, testValidationMessages.scenarioSelectBlock)
    }
  }
}

function validateRun(run: AST.RunStep, ctx: ValidationContext): void {
  if (run.app.error !== undefined) {
    return
  }
  if (!run.app.ref) {
    ctx.error(run, testValidationMessages.runTarget(run.app.$refText))
  }
}

/** A test's own `on`/`with` may each appear at most once; a nested test overrides by repeating one. */
function validateTestHeadClauses(test: AST.TestDeclaration, ctx: ValidationContext): void {
  allowOneTestClause(test, 'on', AST.isTestDeviceClause, ctx)
  allowOneTestClause(test, 'with', AST.isTestFixtureClause, ctx)
  for (const device of test.headClauses.filter(AST.isTestDeviceClause)) {
    if (
      device.width !== undefined
      && (!Number.isInteger(device.width) || !Number.isInteger(device.height) || device.width <= 0
        || device.height! <= 0)
    ) {
      ctx.error(device, testValidationMessages.deviceDimensions)
    }
  }
}

function allowOneTestClause<ClauseT extends AST.TestHeadClause>(
  test: AST.TestDeclaration,
  name: string,
  predicate: (clause: AST.TestHeadClause) => clause is ClauseT,
  ctx: ValidationContext,
): void {
  for (const duplicate of test.headClauses.filter(predicate).slice(1)) {
    ctx.error(duplicate, testValidationMessages.duplicateHeadClause(AST.testDisplayName(test), name))
  }
}

/**
 * A check's effective fixture must be usable by the app it runs: every entity the fixture creates
 * must be covered by a datasource the app binds, or seeding it could write rows the app can never
 * read back. An app with no explicit `Datasource` binding, or one bound datasource with no `Data`
 * membership (the ordinary shape), holds everything, so there is nothing to check.
 */
function validateFixtureBinding(check: AST.TestDeclaration, run: AST.RunStep, ctx: ValidationContext): void {
  const fixture = AST.effectiveTestClause(check, AST.isTestFixtureClause)?.fixture.ref
  const app = run.app.ref
  if (!fixture || !app) {
    return
  }
  const bindings = ASTUtils.appBoundDatasources(app)
  const hasCatchAll = bindings.some(binding =>
    !binding.declaration || !ASTUtils.datasourceCollectionNames(binding.declaration)
  )
  if (bindings.length === 0 || hasCatchAll) {
    return
  }
  const bound = new Set(bindings.flatMap(binding => ASTUtils.datasourceCollectionNames(binding.declaration!) ?? []))
  for (const binding of AST.fixtureValueDeclarations(fixture).filter(AST.isFixtureCreateBinding)) {
    const entity = binding.entity.ref
    if (entity && !bound.has(entity.name)) {
      ctx.error(run, testValidationMessages.fixtureAppBinding(fixture.name, entity.singularName, app.name))
    }
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
    ctx.error(step, testValidationMessages.selector(step.selector))
  }
}

function validateInputSelector(step: AST.ExpectInputValueStep, ctx: ValidationContext): void {
  if (!supportedInputSelectors.includes(step.selector as (typeof supportedInputSelectors)[number])) {
    ctx.error(step, testValidationMessages.inputSelector(step.selector))
  }
}

function validatePointerSelector(step: AST.PressWordStep | AST.InteractionWordStep, ctx: ValidationContext): void {
  if (
    step.selector !== undefined && !supportedSelectors.includes(step.selector as (typeof supportedSelectors)[number])
  ) {
    ctx.error(step, testValidationMessages.selector(step.selector))
  }
}

function validateStepPlacement(message: string): NodeValidationCheck<AST.CheckStep> {
  return (statement, ctx) => {
    if (statementNeedsStepPlacementDiagnostic(statement)) {
      ctx.error(statement, message)
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
