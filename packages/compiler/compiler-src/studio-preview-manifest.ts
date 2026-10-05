import { ASTUtils, Type, Units } from '@ast-utils'
import type { GenerationDeclaration, GenerationField } from '@generation'
import { AST, type ParsedFile } from '@parser'
import { Assert, Switch } from '@shared'
import { studioRenderIdentity } from './studio-render-identity'

type StudioPreviewParameterKind =
  | 'boolean'
  | 'choice'
  | 'entity'
  | 'number'
  | 'text'
  | 'time'
  | 'unsupported'

type StudioPreviewParameterSchema = {
  choices?: readonly string[]
  entity?: string
  kind: StudioPreviewParameterKind
  name: string
  required: boolean
  typeName: string
}

type StudioPreviewViewManifest = {
  id: string
  name: string
  parameters: readonly StudioPreviewParameterSchema[]
  source: {
    end: number
    path: string
    start: number
  }
}

type StudioPreviewSource = {
  end: number
  path: string
  start: number
}

type StudioPreviewFixtureValue =
  | boolean
  | number
  | string
  | { kind: 'now' }
  | { handle: string; kind: 'fixture-reference' }

type StudioPreviewScenarioArgument =
  | StudioPreviewFixtureValue
  | { kind: 'action-stand-in'; parameter: string }

type StudioPreviewPointerTarget = {
  selector: 'label' | 'placeholder' | 'tag' | 'text'
  target: string
}

type StudioPreviewScenarioStep =
  | (StudioPreviewPointerTarget & { kind: 'press' })
  | (StudioPreviewPointerTarget & { kind: 'pressDown' })
  | (StudioPreviewPointerTarget & { kind: 'pressUp' })
  | (StudioPreviewPointerTarget & { kind: 'hover' })
  | (StudioPreviewPointerTarget & { kind: 'enter'; value: string })
  | (StudioPreviewPointerTarget & { kind: 'submit' })
  | { kind: 'select'; tag: string; index: number; steps: readonly StudioPreviewScenarioStep[] }
  | { kind: 'focus'; tag: string }
  | { kind: 'advance'; milliseconds: number }

type StudioPreviewFixtureManifest = {
  signedIn?: string
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

type StudioPreviewScenarioManifest = {
  environment: {
    appearance?: 'dark' | 'light'
    device: { height: number; preset: 'laptop' | 'phone' | 'tablet'; width: number }
    direction?: 'rightToLeft'
    locale?: string | 'pseudolocale'
    network?: 'offline' | 'online'
  }
  fixtureId?: string
  group: string
  id: string
  name: string
  prepare: readonly {
    fields: Readonly<Record<string, StudioPreviewFixtureValue>>
    target: string
  }[]
  source: StudioPreviewSource
  steps: readonly StudioPreviewScenarioStep[]
  subject:
    | {
      appName: string
      arguments: readonly { label?: string; value: StudioPreviewFixtureValue }[]
      destination?: string
      kind: 'app'
      subjectId: string
    }
    | {
      arguments: Readonly<Record<string, StudioPreviewScenarioArgument>>
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
  formatVersion: 2
  generationDeclarations: readonly GenerationDeclaration[]
  renders: readonly StudioPreviewRenderManifest[]
  scenarios: readonly StudioPreviewScenarioManifest[]
  selectedAppName: string
  views: readonly StudioPreviewViewManifest[]
}

type StudioPreviewRenderManifest = {
  elementName: string
  renderId: string
  source: StudioPreviewSource
  studioRectId?: string
}

/** compileStudioPreviewManifest publishes source-owned preview and generation schemas. */
export function compileStudioPreviewManifest(
  files: readonly ParsedFile[],
  selectedAppName: string,
  projectRoot: string,
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
    formatVersion: 2,
    generationDeclarations: files.flatMap(file =>
      file.ast.statements.flatMap(statement => generationDeclaration(statement))
    ),
    renders: files.flatMap(file =>
      [...AST.streamAllContents(file.ast).filter(AST.isRender)].flatMap(render => {
        const identity = studioRenderIdentity(render, projectRoot)
        return identity === undefined ? [] : [{ ...identity, source: sourceOf(render) }]
      })
    ),
    scenarios: files.flatMap(file =>
      file.ast.statements.filter(AST.isScenarioGroupDeclaration).flatMap(group =>
        AST.scenarioDeclarations(group).map(scenario => compileScenario(group, scenario))
      )
    ),
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
      cases: statement.type.cases.map(generationCaseName),
      kind: 'case',
      name: statement.name,
    }]
  }
  return []
}

function generationCaseName(candidate: AST.CaseSetCase): string {
  const name = candidate.name ?? candidate.literal
  Assert.defined(name, 'validated generation case has a name or literal')
  return name
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
    // The grammar's BooleanLiteralValue is the source word; convert it to the declared boolean.
    BooleanLiteral: value => value.value === 'true',
    NowExpression: () => ({ kind: 'now' as const }),
    NumberLiteral: value => value.value,
    StringLiteral: value => value.value,
  })
}

function compileFixture(fixture: AST.FixtureDeclaration): StudioPreviewFixtureManifest {
  const signedIn = fixture.block.entries.find(AST.isFixtureSignedInClause)?.account.$refText
  return {
    ...(signedIn ? { signedIn } : {}),
    accounts: fixture.block.entries.filter(AST.isFixtureAccountDeclaration).map(account => ({
      fields: fieldsOf(account.block),
      name: account.name,
    })),
    creates: fixture.block.entries.filter(entry =>
      AST.isFixtureCreateBinding(entry) || AST.isFixtureCreateStatement(entry)
    ).map((binding, index) => ({
      ...(binding.account?.$refText ?? signedIn ? { account: binding.account?.$refText ?? signedIn } : {}),
      entity: binding.entity.$refText,
      fields: fieldsOf(binding.block),
      name: AST.isFixtureCreateBinding(binding) ? binding.name : `_Created${index + 1}`,
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

function compileScenario(
  group: AST.ScenarioGroupDeclaration,
  scenario: AST.ScenarioDeclaration,
): StudioPreviewScenarioManifest {
  const fixture = AST.effectiveScenarioClause(scenario, AST.isScenarioFixtureClause)?.fixture.ref
  const device = AST.effectiveScenarioClause(scenario, AST.isScenarioDeviceClause)!
  const subjectClause = AST.effectiveScenarioSubjectClause(scenario)
  const run = AST.isScenarioRunClause(subjectClause) ? subjectClause : undefined
  const render = AST.isScenarioRenderClause(subjectClause) ? subjectClause : undefined
  const subject = AST.scenarioSubjectDeclaration(scenario)
  const app = AST.isAppValueDeclaration(subject) ? subject : undefined
  const view = AST.isViewDeclaration(subject) ? subject : undefined
  const appearance = AST.effectiveScenarioClause(scenario, AST.isScenarioAppearanceClause)?.appearance
  const locale = AST.effectiveScenarioClause(scenario, AST.isScenarioLocaleClause)
  const network = AST.effectiveScenarioClause(scenario, AST.isScenarioNetworkClause)?.network
  const direction = AST.effectiveScenarioClause(scenario, AST.isScenarioDirectionClause)
  const prepare = AST.effectiveScenarioClause(scenario, AST.isScenarioPrepareClause)
  return {
    environment: {
      ...(appearance === undefined ? {} : { appearance }),
      device: deviceEnvironment(device),
      ...(direction === undefined ? {} : { direction: 'rightToLeft' as const }),
      ...(locale === undefined ? {} : { locale: locale.pseudolocale ? 'pseudolocale' as const : locale.locale! }),
      ...(network === undefined ? {} : { network }),
    },
    ...(fixture === undefined ? {} : { fixtureId: fixtureId(fixture) }),
    group: group.name,
    id: scenarioId(group, scenario),
    name: scenario.name,
    prepare: (prepare?.block.statements ?? []).map(update => ({
      fields: fieldsOf(update.block),
      target: update.target.$refText,
    })),
    source: sourceOf(scenario),
    steps: AST.scenarioSteps(scenario).map(compileScenarioStep),
    subject: app !== undefined
      ? {
        appName: app.name,
        arguments: (run?.argumentList?.arguments ?? []).map(argument => ({
          ...(argument.label === undefined ? {} : { label: argument.label }),
          value: fixtureValue(argument.value),
        })),
        ...(run?.destination === undefined ? {} : { destination: run.destination }),
        kind: 'app',
        subjectId: appId(app),
      }
      : {
        arguments: {
          ...Object.fromEntries((render?.argumentList?.arguments ?? []).map(argument => [
            argument.label,
            fixtureValue(argument.value),
          ])),
          ...omittedActionStandIns(view, render),
        },
        kind: 'view',
        subjectId: view === undefined ? '' : viewId(view),
        viewName: view?.name ?? '',
      },
  }
}

function omittedActionStandIns(
  view: AST.ViewDeclaration | undefined,
  render: AST.ScenarioRenderClause | undefined,
): Readonly<Record<string, StudioPreviewScenarioArgument>> {
  if (view === undefined) {
    return {}
  }
  const supplied = new Set((render?.argumentList?.arguments ?? []).map(argument => argument.label))
  return Object.fromEntries(
    AST.parametersOf(view)
      .filter(parameter => {
        const type = Type.ofParameter(parameter)
        return !supplied.has(Type.parameterName(parameter))
          && !parameter.optional
          && parameter.defaultValue === undefined
          && type.kind === 'primitive'
          && type.primitive === 'action'
      })
      .map(parameter => {
        const name = Type.parameterName(parameter)
        return [name, { kind: 'action-stand-in' as const, parameter: name }]
      }),
  )
}

function compileScenarioStep(step: AST.ScenarioStep): StudioPreviewScenarioStep {
  return Switch.type(step, {
    AdvanceStep: step => {
      const nanoseconds = ASTUtils.literalDurationOf(step.duration)
      Assert.defined(nanoseconds, 'validated scenario advance step names a literal duration')
      return { kind: 'advance' as const, milliseconds: Units.baseToMilliseconds(nanoseconds) }
    },
    InteractionWordStep: compileScenarioInteractionWordStep,
    EnterTextStep: step => ({
      kind: 'enter' as const,
      selector: (step.selector ?? 'text') as StudioPreviewPointerTarget['selector'],
      target: step.target,
      value: step.value,
    }),
    TagEnterStep: step => ({
      kind: 'enter' as const,
      selector: 'tag' as const,
      target: tagName(step.tag),
      value: step.value,
    }),
    PressTextStep: step => ({
      kind: 'press' as const,
      selector: (step.selector ?? 'text') as StudioPreviewPointerTarget['selector'],
      target: step.text,
    }),
    PressWordStep: step => {
      Assert(step.subject === 'down' || step.subject === 'up', 'validated scenario press names down or up')
      return {
        kind: step.subject === 'down' ? 'pressDown' as const : 'pressUp' as const,
        ...scenarioPointerTarget(step),
      }
    },
    SelectStep: step => ({
      index: step.index,
      kind: 'select' as const,
      steps: step.block.statements.filter(AST.isScenarioStep).map(compileScenarioStep),
      tag: tagName(step.tag),
    }),
    SubmitInputStep: step => ({
      kind: 'submit' as const,
      selector: (step.selector ?? 'text') as StudioPreviewPointerTarget['selector'],
      target: step.target,
    }),
    TagPressStep: step => ({ kind: 'press' as const, selector: 'tag' as const, target: tagName(step.tag) }),
    TagSubmitStep: step => ({ kind: 'submit' as const, selector: 'tag' as const, target: tagName(step.tag) }),
  })
}

function scenarioPointerTarget(
  step: AST.PressWordStep | AST.InteractionWordStep,
): Pick<Extract<StudioPreviewScenarioStep, { target: string }>, 'selector' | 'target'> {
  if (step.tag !== undefined) {
    return { selector: 'tag', target: tagName(step.tag) }
  }
  Assert.defined(step.target, 'parsed scenario pointer step has a text target or tag')
  return {
    selector: (step.selector ?? 'text') as 'label' | 'placeholder' | 'text',
    target: step.target,
  }
}

function compileScenarioInteractionWordStep(step: AST.InteractionWordStep): StudioPreviewScenarioStep {
  if (step.head === 'hover') {
    return { kind: 'hover', ...scenarioPointerTarget(step) }
  }
  Assert(step.head === 'focus', 'validated scenario interaction word step names hover or focus')
  Assert.defined(step.tag, 'validated focus step names a tag')
  return { kind: 'focus', tag: tagName(step.tag) }
}

function tagName(tag: string): string {
  return tag.slice(1)
}

function fieldsOf(block: AST.FixtureFieldBlock): Readonly<Record<string, StudioPreviewFixtureValue>> {
  return Object.fromEntries(block.fields.map(field => [field.name, fixtureValue(field.value)]))
}

function fixtureValue(value: AST.FixtureValue): StudioPreviewFixtureValue {
  return Switch.type(value, {
    // The grammar's BooleanLiteralValue is the source word; convert it to the declared boolean.
    BooleanLiteral: value => value.value === 'true',
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

function scenarioId(group: AST.ScenarioGroupDeclaration, scenario: AST.ScenarioDeclaration): string {
  return `${AST.getDocument(group).uri.fsPath}#scenario:${encodeURIComponent(group.name)}:${
    encodeURIComponent(scenario.name)
  }`
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
    entity: type => ({ ...base, entity: Type.dataEntityName(type.entity), kind: 'entity' }),
    capability: () => ({ ...base, kind: 'unsupported' }),
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
