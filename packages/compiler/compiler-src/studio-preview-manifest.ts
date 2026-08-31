import { Type } from '@ast-utils'
import type { GenerationDeclaration, GenerationField } from '@generation'
import { AST, type ParsedFile } from '@parser'
import { Assert, Switch } from '@shared'

export type StudioPreviewParameterKind =
  | 'boolean'
  | 'choice'
  | 'number'
  | 'text'
  | 'time'
  | 'unsupported'

export type StudioPreviewParameterSchema = {
  choices?: readonly string[]
  kind: StudioPreviewParameterKind
  name: string
  required: boolean
  typeName: string
}

export type StudioPreviewViewManifest = {
  id: string
  name: string
  parameters: readonly StudioPreviewParameterSchema[]
  source: {
    end: number
    path: string
    start: number
  }
}

export type StudioPreviewSource = {
  end: number
  path: string
  start: number
}

export type StudioPreviewFixtureValue =
  | boolean
  | number
  | string
  | { kind: 'now' }
  | { handle: string; kind: 'fixture-reference' }

export type StudioPreviewFixtureManifest = {
  accounts: readonly {
    fields: Readonly<Record<string, StudioPreviewFixtureValue>>
    name: string
  }[]
  creates: readonly {
    account?: string
    entity: string
    fields: Readonly<Record<string, StudioPreviewFixtureValue>>
    name: string
    through?: {
      action: string
      arguments: readonly { label?: string; value: StudioPreviewFixtureValue }[]
    }
  }[]
  id: string
  name: string
  source: StudioPreviewSource
}

export type StudioPreviewScenarioManifest = {
  environment: {
    appearance?: 'dark' | 'light'
    device: { height: number; preset: 'laptop' | 'phone' | 'tablet'; width: number }
    direction?: 'rightToLeft'
    locale?: string | 'pseudolocale'
    network?: 'offline' | 'online'
  }
  fixtureId: string
  id: string
  name: string
  prepare: readonly {
    fields: Readonly<Record<string, StudioPreviewFixtureValue>>
    target: string
  }[]
  source: StudioPreviewSource
  subject:
    | {
      appName: string
      arguments: readonly { label?: string; value: StudioPreviewFixtureValue }[]
      destination?: string
      kind: 'app'
      subjectId: string
    }
    | {
      arguments: Readonly<Record<string, StudioPreviewFixtureValue>>
      kind: 'view'
      subjectId: string
      viewName: string
    }
}

export type StudioPreviewManifest = {
  apps: readonly {
    id: string
    name: string
    source: StudioPreviewSource
  }[]
  fixtures: readonly StudioPreviewFixtureManifest[]
  formatVersion: 1
  generationDeclarations: readonly GenerationDeclaration[]
  scenarios: readonly StudioPreviewScenarioManifest[]
  selectedAppName: string
  views: readonly StudioPreviewViewManifest[]
}

/** compileStudioPreviewManifest publishes source-owned preview and generation schemas. */
export function compileStudioPreviewManifest(
  files: readonly ParsedFile[],
  selectedAppName: string,
): StudioPreviewManifest {
  return {
    apps: files.flatMap(file =>
      AST.appValueDeclarationsInFile(file.ast).map(app => ({
        id: appId(app),
        name: app.name,
        source: sourceOf(app),
      }))
    ),
    fixtures: files.flatMap(file => file.ast.statements.filter(AST.isFixtureDeclaration).map(compileFixture)),
    formatVersion: 1,
    generationDeclarations: files.flatMap(file =>
      file.ast.statements.flatMap(statement => generationDeclaration(statement))
    ),
    scenarios: files.flatMap(file => file.ast.statements.filter(AST.isScenarioDeclaration).map(compileScenario)),
    selectedAppName,
    views: files.flatMap(file =>
      file.ast.statements.filter(AST.isViewDeclaration).map(view => ({
        id: viewId(view),
        name: view.name,
        parameters: AST.parametersOf(view).map(parameter => parameterSchema(parameter)),
        source: sourceOf(view),
      }))
    ),
  }
}

function generationDeclaration(statement: AST.Statement): GenerationDeclaration[] {
  if (AST.isEntityDataDeclaration(statement)) {
    return [{
      collection: statement.name,
      fields: statement.block.entries.filter(AST.isEntityDataField).map(generationField),
      kind: 'entity',
      name: statement.singularName,
    }]
  }
  if (AST.isTypeDeclaration(statement) && AST.isCaseSetTypeExpression(statement.type)) {
    return [{
      cases: statement.type.cases.map(candidate => candidate.name ?? candidate.literal ?? ''),
      kind: 'case',
      name: statement.name,
    }]
  }
  return []
}

function generationField(field: AST.EntityDataField): GenerationField {
  const traits = field.traits?.traits ?? []
  const guidance = traits.find(trait => trait.sentence)?.sentence
  const defaultValue = generationFieldDefault(field)
  return {
    ...(defaultValue === undefined ? {} : { defaultValue }),
    ...(guidance === undefined ? {} : { guidance }),
    name: field.name,
    optional: field.optional,
    secret: false,
    type: generationFieldType(field),
  }
}

function generationFieldType(field: AST.EntityDataField): GenerationField['type'] {
  if (field.primitive || field.boolean) {
    return {
      kind: 'scalar',
      scalar: field.boolean ? 'boolean' : field.primitive!,
    }
  }
  const relation = Type.dataFieldRelationEntity(field)
  Assert.defined(relation, 'validated generation field resolves a scalar or relation type')
  return {
    entity: relation.singularName,
    inverse: Type.dataFieldIsInverseRelation(field),
    kind: 'relation',
  }
}

function generationFieldDefault(field: AST.EntityDataField): GenerationField['defaultValue'] {
  const modifier = field.traits?.traits.find(trait => trait.defaultValue || trait.defaultCase)
  if (modifier === undefined) {
    return field.boolean ? false : undefined
  }
  if (modifier.defaultCase !== undefined) {
    return modifier.defaultCase === field.name
  }
  const value = modifier.defaultValue
  Assert.defined(value, 'validated generation field default trait has a value')
  return Switch.type(value, {
    BooleanLiteral: value => value.value,
    NowExpression: () => ({ kind: 'now' as const }),
    NumberLiteral: value => value.value,
    StringLiteral: value => value.value,
  })
}

function compileFixture(fixture: AST.FixtureDeclaration): StudioPreviewFixtureManifest {
  return {
    accounts: fixture.block.entries.filter(AST.isFixtureAccountDeclaration).map(account => ({
      fields: fieldsOf(account.block),
      name: account.name,
    })),
    creates: fixture.block.entries.filter(AST.isFixtureCreateBinding).map(binding => ({
      ...(binding.account?.$refText === undefined ? {} : { account: binding.account.$refText }),
      entity: binding.entity.$refText,
      fields: fieldsOf(binding.block),
      name: binding.name,
      ...(binding.through === undefined
        ? {}
        : {
          through: {
            action: binding.through.action.$refText,
            arguments: (binding.through.argumentList?.arguments ?? []).map(argument => ({
              ...(argument.label === undefined ? {} : { label: argument.label }),
              value: fixtureValue(argument.value),
            })),
          },
        }),
    })),
    id: fixtureId(fixture),
    name: fixture.name,
    source: sourceOf(fixture),
  }
}

function compileScenario(scenario: AST.ScenarioDeclaration): StudioPreviewScenarioManifest {
  const entries = scenario.block.entries
  const fixture = entries.find(AST.isScenarioFixtureClause)?.fixture.ref
  const device = entries.find(AST.isScenarioDeviceClause)!
  const run = entries.find(AST.isScenarioRunClause)
  const render = entries.find(AST.isScenarioRenderClause)
  const app = run?.app.ref
  const view = render?.view.ref
  const appearance = entries.find(AST.isScenarioAppearanceClause)?.appearance
  const locale = entries.find(AST.isScenarioLocaleClause)
  const network = entries.find(AST.isScenarioNetworkClause)?.network
  return {
    environment: {
      ...(appearance === undefined ? {} : { appearance }),
      device: deviceEnvironment(device),
      ...(entries.some(AST.isScenarioDirectionClause) ? { direction: 'rightToLeft' as const } : {}),
      ...(locale === undefined ? {} : { locale: locale.pseudolocale ? 'pseudolocale' as const : locale.locale! }),
      ...(network === undefined ? {} : { network }),
    },
    fixtureId: fixture === undefined ? '' : fixtureId(fixture),
    id: scenarioId(scenario),
    name: scenario.name,
    prepare: entries.filter(AST.isScenarioPrepareClause).flatMap(prepare =>
      prepare.block.statements.map(update => ({
        fields: fieldsOf(update.block),
        target: update.target.$refText,
      }))
    ),
    source: sourceOf(scenario),
    subject: run !== undefined && app !== undefined
      ? {
        appName: app.name,
        arguments: (run.argumentList?.arguments ?? []).map(argument => ({
          ...(argument.label === undefined ? {} : { label: argument.label }),
          value: fixtureValue(argument.value),
        })),
        ...(run.destination === undefined ? {} : { destination: run.destination }),
        kind: 'app',
        subjectId: appId(app),
      }
      : {
        arguments: Object.fromEntries((render?.argumentList?.arguments ?? []).map(argument => [
          argument.label,
          fixtureValue(argument.value),
        ])),
        kind: 'view',
        subjectId: view === undefined ? '' : viewId(view),
        viewName: view?.name ?? '',
      },
  }
}

function fieldsOf(block: AST.FixtureFieldBlock): Readonly<Record<string, StudioPreviewFixtureValue>> {
  return Object.fromEntries(block.fields.map(field => [field.name, fixtureValue(field.value)]))
}

function fixtureValue(value: AST.FixtureValue): StudioPreviewFixtureValue {
  return Switch.type(value, {
    BooleanLiteral: value => value.value,
    FixtureValueReference: value => ({ handle: value.target.$refText, kind: 'fixture-reference' }),
    NowExpression: () => ({ kind: 'now' }),
    NumberLiteral: value => value.value,
    StringLiteral: value => value.value,
  })
}

function deviceEnvironment(device: AST.ScenarioDeviceClause): {
  height: number
  preset: 'laptop' | 'phone' | 'tablet'
  width: number
} {
  const defaults = device.device === 'phone'
    ? { height: 844, width: 390 }
    : device.device === 'tablet'
    ? { height: 1024, width: 768 }
    : { height: 900, width: 1440 }
  return {
    height: device.height ?? defaults.height,
    preset: device.device,
    width: device.width ?? defaults.width,
  }
}

function sourceOf(node: AST.Node): StudioPreviewSource {
  return {
    end: node.$cstNode?.end ?? 0,
    path: AST.getDocument(node).uri.fsPath,
    start: node.$cstNode?.offset ?? 0,
  }
}

function appId(app: AST.AppValueDeclaration): string {
  return `${AST.getDocument(app).uri.fsPath}#app:${app.name}`
}

function fixtureId(fixture: AST.FixtureDeclaration): string {
  return `${AST.getDocument(fixture).uri.fsPath}#fixture:${fixture.name}`
}

function scenarioId(scenario: AST.ScenarioDeclaration): string {
  return `${AST.getDocument(scenario).uri.fsPath}#scenario:${scenario.name}`
}

function viewId(view: AST.ViewDeclaration): string {
  return `${AST.getDocument(view).uri.fsPath}#${view.name}`
}

/** studioPreviewManifestModule emits the JSON-safe manifest as a generated TypeScript sidecar. */
export function studioPreviewManifestModule(manifest: StudioPreviewManifest): string {
  return `const TaoStudioManifest = ${JSON.stringify(manifest)} as const\n\nexport default TaoStudioManifest\n`
}

function parameterSchema(parameter: AST.ParameterDeclaration): StudioPreviewParameterSchema {
  const type = Type.ofParameter(parameter)
  const base = {
    name: Type.parameterName(parameter),
    required: parameter.defaultValue === undefined,
    typeName: parameter.type
      ? Type.referenceName(parameter.type)
      : parameter.inlineType
      ? Type.displayName(Type.ofTypeExpression(parameter.inlineType.type))
      : Type.displayName(type),
  }
  return Switch.kind(type, {
    entity: () => ({ ...base, kind: 'unsupported' }),
    item: () => ({ ...base, kind: 'unsupported' }),
    list: () => ({ ...base, kind: 'unsupported' }),
    unresolved: () => ({ ...base, kind: 'unsupported' }),
    union: () => ({ ...base, kind: 'unsupported' }),
    enum: type => ({
      ...base,
      choices: AST.isCaseSetTypeExpression(type.declaration.type)
        ? type.declaration.type.cases.map(candidate => candidate.name ?? candidate.literal ?? '')
          .filter(Boolean)
        : [],
      kind: 'choice',
    }),
    primitive: type => ({
      ...base,
      kind: type.primitive === 'boolean'
        ? 'boolean'
        : type.primitive === 'number' || type.primitive === 'duration'
        ? 'number'
        : type.primitive === 'text'
        ? 'text'
        : type.primitive === 'time'
        ? 'time'
        : 'unsupported',
    }),
  })
}
