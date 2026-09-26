import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

/** scenarioValidationMessages declares diagnostics for decided fixture and app-scenario forms. */
export const scenarioValidationMessages = {
  fixturePlacement: 'Fixtures must be declared at file level.',
  scenarioGroupPlacement: 'Scenario groups must be declared at file level.',
  scenarioPlacement: 'Scenario entries must be declared inside a scenario group.',
  duplicateFixture: (name: string) => `Fixture '${name}' is declared more than once.`,
  duplicateGroup: (name: string) => `Scenario group '${name}' is declared more than once.`,
  duplicateScenario: (group: string, name: string) =>
    `Scenario group '${group}' declares entry '${name}' more than once.`,
  missingScenario: (group: string) => `Scenario group '${group}' must declare at least one scenario entry.`,
  duplicateHandle: (fixture: string, name: string) => `Fixture '${fixture}' declares handle '${name}' more than once.`,
  duplicateField: (owner: string, name: string) => `${owner} supplies field '${name}' more than once.`,
  unknownField: (entity: string, name: string) => `Entity '${entity}' has no field named '${name}'.`,
  missingField: (entity: string, name: string) => `Create of '${entity}' is missing required field '${name}'.`,
  fieldType: (field: string, expected: string, actual: string) =>
    `Fixture field '${field}' expects ${expected}, got ${actual}.`,
  duplicateClause: (scenario: string, clause: string) => `Scenario '${scenario}' declares '${clause}' more than once.`,
  missingClause: (scenario: string, clause: string) =>
    `Scenario '${scenario}' must declare exactly one '${clause}' clause.`,
  fixtureRequired: (scenario: string) =>
    `Scenario '${scenario}' must declare a fixture when its arguments or prepare block reference fixture handles.`,
  subjectCount: (scenario: string) =>
    `Scenario '${scenario}' must declare exactly one subject: either 'run' or 'render'.`,
  subjectKind: (scenario: string, kind: 'run' | 'render') =>
    `Scenario '${scenario}' cannot use '${kind}' with its group subject.`,
  deviceDimensions: 'Scenario device dimensions must be positive whole numbers.',
  pseudolocaleDirection: "A pseudolocale scenario must declare 'direction rightToLeft'.",
  unknownArgument: (action: string, name: string) => `Action '${action}' has no parameter named '${name}'.`,
  duplicateArgument: (action: string, name: string) =>
    `Action '${action}' receives parameter '${name}' more than once.`,
  missingArgument: (action: string, name: string) => `Action '${action}' is missing required argument '${name}'.`,
  argumentCount: (action: string) =>
    `Unlabeled arguments for action '${action}' must match its remaining parameters in order.`,
  renderUnknownArgument: (view: string, name: string) => `View '${view}' has no parameter named '${name}'.`,
  renderDuplicateArgument: (view: string, name: string) =>
    `Render of '${view}' supplies parameter '${name}' more than once.`,
  renderMissingArgument: (view: string, name: string) => `Render of '${view}' is missing required parameter '${name}'.`,
  renderArgumentType: (view: string, name: string, expected: string, actual: string) =>
    `Render argument '${name}:' of '${view}' expects ${expected}, got ${actual}.`,
} as const

/** scenarioValidationChecks validates placement and the local structure of fixtures and scenarios. */
export const scenarioValidationChecks = {
  [AST.FixtureDeclaration.$type]: validateFixture,
  [AST.ScenarioGroupDeclaration.$type]: validateScenarioGroup,
  [AST.ScenarioDeclaration.$type]: validateScenario,
} satisfies NodeValidationChecks

/** validateScenarioFile validates the file-level fixture and scenario namespaces. */
export function validateScenarioFile(file: AST.TaoFile, ctx: ValidationContext): void {
  reportDuplicates(
    file.statements.filter(AST.isFixtureDeclaration),
    fixture => fixture.name,
    scenarioValidationMessages.duplicateFixture,
    ctx,
  )
  reportDuplicates(
    file.statements.filter(AST.isScenarioGroupDeclaration),
    group => group.name,
    scenarioValidationMessages.duplicateGroup,
    ctx,
  )
}

function validateFixture(fixture: AST.FixtureDeclaration, ctx: ValidationContext): void {
  if (!AST.isTaoFile(fixture.$container)) {
    ctx.error(fixture, scenarioValidationMessages.fixturePlacement)
  }
  reportDuplicates(
    AST.fixtureValueDeclarations(fixture),
    entry => entry.name,
    name => scenarioValidationMessages.duplicateHandle(fixture.name, name),
    ctx,
  )
  for (const account of fixture.block.entries.filter(AST.isFixtureAccountDeclaration)) {
    validateDuplicateFields(`Account '${account.name}'`, account.block.fields, ctx)
  }
  for (
    const binding of fixture.block.entries.filter(entry =>
      AST.isFixtureCreateBinding(entry) || AST.isFixtureCreateStatement(entry)
    )
  ) {
    validateCreateBinding(binding, ctx)
    if (binding.through) {
      validateThrough(binding.through, ctx)
    }
  }
}

function validateCreateBinding(
  binding: AST.FixtureCreateBinding | AST.FixtureCreateStatement,
  ctx: ValidationContext,
): void {
  const entity = binding.entity.ref
  if (!entity) {
    return
  }
  validateFields(entity, binding.block.fields, true, ctx)
}

function validateScenarioGroup(group: AST.ScenarioGroupDeclaration, ctx: ValidationContext): void {
  if (!AST.isTaoFile(group.$container)) {
    ctx.error(group, scenarioValidationMessages.scenarioGroupPlacement)
  }
  const scenarios = AST.scenarioDeclarations(group)
  if (scenarios.length === 0) {
    ctx.error(group, scenarioValidationMessages.missingScenario(group.name))
  }
  reportDuplicates(
    scenarios,
    scenario => scenario.name,
    name => scenarioValidationMessages.duplicateScenario(group.name, name),
    ctx,
  )
  validateClauseSet(group.name, AST.scenarioGroupClauses(group), ctx)
  validateClauseContents(AST.scenarioGroupClauses(group), ctx)
}

function validateScenario(scenario: AST.ScenarioDeclaration, ctx: ValidationContext): void {
  const group = AST.findOwningScenarioGroup(scenario)
  if (!group) {
    ctx.error(scenario, scenarioValidationMessages.scenarioPlacement)
    return
  }
  const identity = `${group.name} / ${scenario.name}`
  validateClauseSet(identity, scenario.block.entries, ctx)
  validateClauseContents(scenario.block.entries, ctx)
  requireEffectiveClause(scenario, identity, 'device', AST.isScenarioDeviceClause, ctx)

  if (!AST.effectiveScenarioClause(scenario, AST.isScenarioFixtureClause) && scenarioRequiresFixture(scenario)) {
    ctx.error(scenario, scenarioValidationMessages.fixtureRequired(identity))
  }

  const subjectClause = AST.effectiveScenarioSubjectClause(scenario)
  const subject = AST.scenarioSubjectDeclaration(scenario)
  if (!subject) {
    ctx.error(subjectClause ?? scenario, scenarioValidationMessages.subjectCount(identity))
  } else if (AST.isScenarioRenderClause(subjectClause) && !AST.isViewDeclaration(subject)) {
    ctx.error(subjectClause, scenarioValidationMessages.subjectKind(identity, 'render'))
  } else if (AST.isScenarioRunClause(subjectClause) && !AST.isAppValueDeclaration(subject)) {
    ctx.error(subjectClause, scenarioValidationMessages.subjectKind(identity, 'run'))
  }

  const locale = AST.effectiveScenarioClause(scenario, AST.isScenarioLocaleClause)
  const direction = AST.effectiveScenarioClause(scenario, AST.isScenarioDirectionClause)
  if (locale?.pseudolocale && !direction) {
    ctx.error(locale, scenarioValidationMessages.pseudolocaleDirection)
  }

  if (AST.isScenarioRenderClause(subjectClause) && AST.isViewDeclaration(subject)) {
    validateScenarioRender(subjectClause, subject, ctx)
  } else if (!subjectClause && AST.isViewDeclaration(subject)) {
    validateScenarioRender(undefined, subject, ctx)
  }
}

function validateClauseSet(owner: string, clauses: readonly AST.ScenarioClause[], ctx: ValidationContext): void {
  allowOne(owner, clauses, 'fixture', AST.isScenarioFixtureClause, ctx)
  allowOne(owner, clauses, 'device', AST.isScenarioDeviceClause, ctx)
  allowOne(owner, clauses, 'prepare', AST.isScenarioPrepareClause, ctx)
  allowOne(owner, clauses, 'appearance', AST.isScenarioAppearanceClause, ctx)
  allowOne(owner, clauses, 'locale', AST.isScenarioLocaleClause, ctx)
  allowOne(owner, clauses, 'direction', AST.isScenarioDirectionClause, ctx)
  allowOne(owner, clauses, 'network', AST.isScenarioNetworkClause, ctx)
  const subjects = clauses.filter((clause): clause is AST.ScenarioRenderClause | AST.ScenarioRunClause =>
    AST.isScenarioRunClause(clause) || AST.isScenarioRenderClause(clause)
  )
  for (const duplicate of subjects.slice(1)) {
    ctx.error(duplicate, scenarioValidationMessages.duplicateClause(owner, 'subject'))
  }
}

function validateClauseContents(clauses: readonly AST.ScenarioClause[], ctx: ValidationContext): void {
  for (const device of clauses.filter(AST.isScenarioDeviceClause)) {
    if (
      device.width !== undefined
      && (!Number.isInteger(device.width) || !Number.isInteger(device.height) || device.width <= 0
        || device.height! <= 0)
    ) {
      ctx.error(device, scenarioValidationMessages.deviceDimensions)
    }
  }
  for (const prepare of clauses.filter(AST.isScenarioPrepareClause)) {
    validateScenarioPrepare(prepare, ctx)
  }
}

function validateScenarioPrepare(prepare: AST.ScenarioPrepareClause, ctx: ValidationContext): void {
  for (const update of prepare.block.statements) {
    const target = update.target.ref
    if (AST.isFixtureCreateBinding(target) && target.entity.ref) {
      validateFields(target.entity.ref, update.block.fields, false, ctx)
    }
  }
}

function validateScenarioRender(
  render: AST.ScenarioRenderClause | undefined,
  view: AST.ViewDeclaration,
  ctx: ValidationContext,
): void {
  const parameters = AST.parametersOf(view)
  const parametersByName = new Map(parameters.map(parameter => [Type.parameterName(parameter), parameter]))
  const supplied = new Set<string>()
  for (const argument of render?.argumentList?.arguments ?? []) {
    const parameter = parametersByName.get(argument.label)
    if (!parameter) {
      ctx.error(argument, scenarioValidationMessages.renderUnknownArgument(view.name, argument.label))
      continue
    }
    if (supplied.has(argument.label)) {
      ctx.error(argument, scenarioValidationMessages.renderDuplicateArgument(view.name, argument.label))
      continue
    }
    supplied.add(argument.label)
    const actual = fixtureValueTaoType(argument.value)
    const expected = Type.ofParameter(parameter)
    if (actual.kind !== 'unresolved' && expected.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
      ctx.error(
        argument.value,
        scenarioValidationMessages.renderArgumentType(
          view.name,
          argument.label,
          Type.displayName(expected),
          Type.displayName(actual),
        ),
      )
    }
  }
  for (const parameter of parameters) {
    const name = Type.parameterName(parameter)
    const type = Type.ofParameter(parameter)
    const omittedRequiredAction = type.kind === 'primitive' && type.primitive === 'action'
    if (!supplied.has(name) && !parameter.optional && !parameter.defaultValue && !omittedRequiredAction) {
      ctx.error(render ?? view, scenarioValidationMessages.renderMissingArgument(view.name, name))
    }
  }
}

function scenarioRequiresFixture(scenario: AST.ScenarioDeclaration): boolean {
  const prepare = AST.effectiveScenarioClause(scenario, AST.isScenarioPrepareClause)
  // Every currently supported prepare statement targets a fixture handle. An empty prepare block
  // is still meaningful as an explicitly empty data delta and therefore needs no fixture.
  if ((prepare?.block.statements.length ?? 0) > 0) {
    return true
  }
  const subject = AST.effectiveScenarioSubjectClause(scenario)
  const arguments_ = AST.isScenarioRenderClause(subject)
    ? subject.argumentList?.arguments
    : AST.isScenarioRunClause(subject)
    ? subject.argumentList?.arguments
    : undefined
  return (arguments_ ?? []).some(argument =>
    AST.isFixtureValueReference(argument.value)
    || AST.streamAllContents(argument.value).some(AST.isFixtureValueReference)
  )
}

function validateFields(
  entity: AST.EntityDataDeclaration,
  supplied: readonly AST.FixtureField[],
  requireAll: boolean,
  ctx: ValidationContext,
): void {
  validateDuplicateFields(`Create of '${entity.singularName}'`, supplied, ctx)
  const fields = Type.dataFields(entity).filter(field => Type.dataFieldType(field).kind !== 'list')
  const fieldsByName = new Map(fields.map(field => [field.name, field]))
  for (const suppliedField of supplied) {
    const field = fieldsByName.get(suppliedField.name)
    if (!field) {
      ctx.error(suppliedField, scenarioValidationMessages.unknownField(entity.singularName, suppliedField.name))
      continue
    }
    const expected = fixtureFieldType(field)
    const actual = fixtureValueType(suppliedField.value)
    if (expected !== 'unresolved' && actual !== 'unresolved' && expected !== actual) {
      ctx.error(suppliedField.value, scenarioValidationMessages.fieldType(field.name, expected, actual))
    }
  }
  if (!requireAll) {
    return
  }
  const suppliedNames = new Set(supplied.map(field => field.name))
  for (const field of fields) {
    if (!suppliedNames.has(field.name) && fieldRequiresValue(field)) {
      ctx.error(entity, scenarioValidationMessages.missingField(entity.singularName, field.name))
    }
  }
}

function fixtureFieldType(field: AST.EntityDataField): string {
  const type = Type.dataFieldType(field)
  if (type.kind === 'primitive') {
    return type.primitive
  }
  if (type.kind === 'entity') {
    return `entity ${type.entity.singularName}`
  }
  return 'unresolved'
}

function fixtureValueType(value: AST.FixtureValue): string {
  if (AST.isStringLiteral(value)) {
    return 'text'
  }
  if (AST.isNumberLiteral(value)) {
    return 'number'
  }
  if (AST.isBooleanLiteral(value)) {
    return 'boolean'
  }
  if (AST.isNowExpression(value)) {
    return 'time'
  }
  const target = value.target.ref
  if (AST.isFixtureCreateBinding(target) && target.entity.ref) {
    return `entity ${target.entity.ref.singularName}`
  }
  return 'unresolved'
}

function fixtureValueTaoType(value: AST.FixtureValue): ASTUtils.TaoType {
  if (AST.isStringLiteral(value)) {
    return { kind: 'primitive', primitive: 'text' }
  }
  if (AST.isNumberLiteral(value)) {
    return { kind: 'primitive', primitive: 'number' }
  }
  if (AST.isBooleanLiteral(value)) {
    return { kind: 'primitive', primitive: 'boolean' }
  }
  if (AST.isNowExpression(value)) {
    return { kind: 'primitive', primitive: 'time' }
  }
  const target = value.target.ref
  if (AST.isFixtureCreateBinding(target) && target.entity.ref) {
    return { kind: 'entity', entity: target.entity.ref }
  }
  return { kind: 'unresolved' }
}

function fieldRequiresValue(field: AST.EntityDataField): boolean {
  if (field.optional || field.boolean) {
    return false
  }
  return !(field.traits?.traits ?? []).some(trait =>
    trait.defaultValue !== undefined || trait.defaultCase !== undefined
  )
}

function validateThrough(through: AST.FixtureThroughClause, ctx: ValidationContext): void {
  const action = through.action.ref
  if (!action) {
    return
  }
  const parameters = AST.parametersOf(action)
  const parameterNames = parameters.map(Type.parameterName)
  const arguments_ = through.argumentList?.arguments ?? []
  const named = arguments_.filter(argument => argument.label !== undefined)
  const seen = new Set<string>()
  for (const argument of named) {
    const name = argument.label!
    if (!parameterNames.includes(name)) {
      ctx.error(argument, scenarioValidationMessages.unknownArgument(action.name, name))
    } else if (seen.has(name)) {
      ctx.error(argument, scenarioValidationMessages.duplicateArgument(action.name, name))
    }
    seen.add(name)
  }
  const remaining = parameters.filter(parameter => !seen.has(Type.parameterName(parameter)))
  const positional = arguments_.filter(argument => argument.label === undefined)
  if (positional.length > remaining.length) {
    ctx.error(through, scenarioValidationMessages.argumentCount(action.name))
  }
  const suppliedPositionally = new Set(remaining.slice(0, positional.length))
  for (const parameter of parameters) {
    if (
      !seen.has(Type.parameterName(parameter))
      && !suppliedPositionally.has(parameter)
      && !parameter.optional
      && !parameter.defaultValue
    ) {
      ctx.error(through, scenarioValidationMessages.missingArgument(action.name, Type.parameterName(parameter)))
    }
  }
}

function validateDuplicateFields(
  owner: string,
  fields: readonly AST.FixtureField[],
  ctx: ValidationContext,
): void {
  reportDuplicates(fields, field => field.name, name => scenarioValidationMessages.duplicateField(owner, name), ctx)
}

function requireEffectiveClause<ClauseT extends AST.ScenarioClause>(
  scenario: AST.ScenarioDeclaration,
  owner: string,
  name: string,
  predicate: (entry: AST.ScenarioClause) => entry is ClauseT,
  ctx: ValidationContext,
): void {
  if (!AST.effectiveScenarioClause(scenario, predicate)) {
    ctx.error(scenario, scenarioValidationMessages.missingClause(owner, name))
  }
}

function allowOne<ClauseT extends AST.ScenarioClause>(
  owner: string,
  clauses: readonly AST.ScenarioClause[],
  name: string,
  predicate: (entry: AST.ScenarioClause) => entry is ClauseT,
  ctx: ValidationContext,
): void {
  for (const duplicate of clauses.filter(predicate).slice(1)) {
    ctx.error(duplicate, scenarioValidationMessages.duplicateClause(owner, name))
  }
}

function reportDuplicates<NodeT extends AST.Node>(
  nodes: readonly NodeT[],
  key: (node: NodeT) => string,
  message: (name: string) => string,
  ctx: ValidationContext,
): void {
  const seen = new Set<string>()
  for (const node of nodes) {
    const name = key(node)
    if (seen.has(name)) {
      ctx.error(node, message(name))
    }
    seen.add(name)
  }
}
