import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

/** scenarioValidationMessages declares diagnostics for decided fixture and app-scenario forms. */
export const scenarioValidationMessages = {
  fixturePlacement: 'Fixtures must be declared at file level.',
  scenarioPlacement: 'Scenarios must be declared at file level.',
  duplicateFixture: (name: string) => `Fixture '${name}' is declared more than once.`,
  duplicateScenario: (name: string) => `Scenario '${name}' is declared more than once.`,
  duplicateHandle: (fixture: string, name: string) => `Fixture '${fixture}' declares handle '${name}' more than once.`,
  duplicateField: (owner: string, name: string) => `${owner} supplies field '${name}' more than once.`,
  unknownField: (entity: string, name: string) => `Entity '${entity}' has no field named '${name}'.`,
  missingField: (entity: string, name: string) => `Create of '${entity}' is missing required field '${name}'.`,
  fieldType: (field: string, expected: string, actual: string) =>
    `Fixture field '${field}' expects ${expected}, got ${actual}.`,
  duplicateClause: (scenario: string, clause: string) => `Scenario '${scenario}' declares '${clause}' more than once.`,
  missingClause: (scenario: string, clause: string) =>
    `Scenario '${scenario}' must declare exactly one '${clause}' clause.`,
  subjectCount: (scenario: string) =>
    `Scenario '${scenario}' must declare exactly one subject: either 'run' or 'render'.`,
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
    file.statements.filter(AST.isScenarioDeclaration),
    scenario => scenario.name,
    scenarioValidationMessages.duplicateScenario,
    ctx,
  )
}

function validateFixture(fixture: AST.FixtureDeclaration, ctx: ValidationContext): void {
  if (!AST.isTaoFile(fixture.$container)) {
    ctx.error(scenarioValidationMessages.fixturePlacement, fixture)
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
  for (const binding of fixture.block.entries.filter(AST.isFixtureCreateBinding)) {
    validateCreateBinding(binding, ctx)
    if (binding.through) {
      validateThrough(binding.through, ctx)
    }
  }
}

function validateCreateBinding(binding: AST.FixtureCreateBinding, ctx: ValidationContext): void {
  const entity = binding.entity.ref
  if (!entity) {
    return
  }
  validateFields(entity, binding.block.fields, true, ctx)
}

function validateScenario(scenario: AST.ScenarioDeclaration, ctx: ValidationContext): void {
  if (!AST.isTaoFile(scenario.$container)) {
    ctx.error(scenarioValidationMessages.scenarioPlacement, scenario)
  }
  requireOne(scenario, 'fixture', AST.isScenarioFixtureClause, ctx)
  requireOne(scenario, 'device', AST.isScenarioDeviceClause, ctx)
  allowOne(scenario, 'prepare', AST.isScenarioPrepareClause, ctx)
  allowOne(scenario, 'appearance', AST.isScenarioAppearanceClause, ctx)
  allowOne(scenario, 'locale', AST.isScenarioLocaleClause, ctx)
  allowOne(scenario, 'direction', AST.isScenarioDirectionClause, ctx)
  allowOne(scenario, 'network', AST.isScenarioNetworkClause, ctx)

  const subjects = scenario.block.entries.filter(entry =>
    AST.isScenarioRunClause(entry) || AST.isScenarioRenderClause(entry)
  )
  if (subjects.length !== 1) {
    ctx.error(scenarioValidationMessages.subjectCount(scenario.name), subjects[1] ?? scenario)
  }

  for (const device of scenario.block.entries.filter(AST.isScenarioDeviceClause)) {
    if (
      device.width !== undefined
      && (!Number.isInteger(device.width) || !Number.isInteger(device.height) || device.width <= 0
        || device.height! <= 0)
    ) {
      ctx.error(scenarioValidationMessages.deviceDimensions, device)
    }
  }
  const pseudolocale = scenario.block.entries.some(entry => AST.isScenarioLocaleClause(entry) && entry.pseudolocale)
  if (pseudolocale && !scenario.block.entries.some(AST.isScenarioDirectionClause)) {
    ctx.error(scenarioValidationMessages.pseudolocaleDirection, scenario)
  }
  for (const prepare of scenario.block.entries.filter(AST.isScenarioPrepareClause)) {
    for (const update of prepare.block.statements) {
      const target = update.target.ref
      if (AST.isFixtureCreateBinding(target) && target.entity.ref) {
        validateFields(target.entity.ref, update.block.fields, false, ctx)
      }
    }
  }
  for (const render of scenario.block.entries.filter(AST.isScenarioRenderClause)) {
    validateScenarioRender(render, ctx)
  }
}

function validateScenarioRender(render: AST.ScenarioRenderClause, ctx: ValidationContext): void {
  const view = render.view.ref
  if (!view) {
    return
  }
  const parameters = AST.parametersOf(view)
  const parametersByName = new Map(parameters.map(parameter => [Type.parameterName(parameter), parameter]))
  const supplied = new Set<string>()
  for (const argument of render.argumentList?.arguments ?? []) {
    const parameter = parametersByName.get(argument.label)
    if (!parameter) {
      ctx.error(scenarioValidationMessages.renderUnknownArgument(view.name, argument.label), argument)
      continue
    }
    if (supplied.has(argument.label)) {
      ctx.error(scenarioValidationMessages.renderDuplicateArgument(view.name, argument.label), argument)
      continue
    }
    supplied.add(argument.label)
    const actual = fixtureValueTaoType(argument.value)
    const expected = Type.ofParameter(parameter)
    if (actual.kind !== 'unresolved' && expected.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
      ctx.error(
        scenarioValidationMessages.renderArgumentType(
          view.name,
          argument.label,
          Type.displayName(expected),
          Type.displayName(actual),
        ),
        argument.value,
      )
    }
  }
  for (const parameter of parameters) {
    const name = Type.parameterName(parameter)
    if (!supplied.has(name) && !parameter.optional && !parameter.defaultValue) {
      ctx.error(scenarioValidationMessages.renderMissingArgument(view.name, name), render)
    }
  }
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
      ctx.error(scenarioValidationMessages.unknownField(entity.singularName, suppliedField.name), suppliedField)
      continue
    }
    const expected = fixtureFieldType(field)
    const actual = fixtureValueType(suppliedField.value)
    if (expected !== 'unresolved' && actual !== 'unresolved' && expected !== actual) {
      ctx.error(scenarioValidationMessages.fieldType(field.name, expected, actual), suppliedField.value)
    }
  }
  if (!requireAll) {
    return
  }
  const suppliedNames = new Set(supplied.map(field => field.name))
  for (const field of fields) {
    if (!suppliedNames.has(field.name) && fieldRequiresValue(field)) {
      ctx.error(scenarioValidationMessages.missingField(entity.singularName, field.name), entity)
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
      ctx.error(scenarioValidationMessages.unknownArgument(action.name, name), argument)
    } else if (seen.has(name)) {
      ctx.error(scenarioValidationMessages.duplicateArgument(action.name, name), argument)
    }
    seen.add(name)
  }
  const remaining = parameters.filter(parameter => !seen.has(Type.parameterName(parameter)))
  const positional = arguments_.filter(argument => argument.label === undefined)
  if (positional.length > remaining.length) {
    ctx.error(scenarioValidationMessages.argumentCount(action.name), through)
  }
  const suppliedPositionally = new Set(remaining.slice(0, positional.length))
  for (const parameter of parameters) {
    if (
      !seen.has(Type.parameterName(parameter))
      && !suppliedPositionally.has(parameter)
      && !parameter.optional
      && !parameter.defaultValue
    ) {
      ctx.error(scenarioValidationMessages.missingArgument(action.name, Type.parameterName(parameter)), through)
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

function requireOne<ClauseT extends AST.ScenarioEntry>(
  scenario: AST.ScenarioDeclaration,
  name: string,
  predicate: (entry: AST.ScenarioEntry) => entry is ClauseT,
  ctx: ValidationContext,
): void {
  const matches = scenario.block.entries.filter(predicate)
  if (matches.length === 0) {
    ctx.error(scenarioValidationMessages.missingClause(scenario.name, name), scenario)
  }
  for (const duplicate of matches.slice(1)) {
    ctx.error(scenarioValidationMessages.duplicateClause(scenario.name, name), duplicate)
  }
}

function allowOne<ClauseT extends AST.ScenarioEntry>(
  scenario: AST.ScenarioDeclaration,
  name: string,
  predicate: (entry: AST.ScenarioEntry) => entry is ClauseT,
  ctx: ValidationContext,
): void {
  for (const duplicate of scenario.block.entries.filter(predicate).slice(1)) {
    ctx.error(scenarioValidationMessages.duplicateClause(scenario.name, name), duplicate)
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
      ctx.error(message(name), node)
    }
    seen.add(name)
  }
}
