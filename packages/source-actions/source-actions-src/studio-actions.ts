import { ASTUtils, Type } from '@ast-utils'
import Formatter from '@formatter'
import { AST } from '@parser'
import { Errors, Switch } from '@shared'
import { assertNoSyntaxErrors, parseSourceText } from './source-actions-utils'

export type StudioComponentKind =
  | 'Box'
  | 'Button'
  | 'Checkbox'
  | 'Col'
  | 'DatePicker'
  | 'FormButton'
  | 'Image'
  | 'Number'
  | 'Panes'
  | 'Picker'
  | 'Placeholder'
  | 'Progress'
  | 'Row'
  | 'ScrollView'
  | 'SegmentedControl'
  | 'Slider'
  | 'Spinner'
  | 'Spacer'
  | 'Stack'
  | 'Switch'
  | 'Text'
  | 'TextFrame'
  | 'TextInput'
  | 'TextMultiline'
  | 'WrappingRow'

export type StudioRenderGap = {
  afterId?: string
  beforeId?: string
}

/** StudioInsertComponentPatchRequest inserts one constrained palette choice into a Tao render block. */
export type StudioInsertComponentPatchRequest = {
  afterId?: string
  beforeId?: string
  component: StudioComponentKind
  kind: 'insert-component'
}

/** StudioInsertProjectViewPatchRequest inserts a project view with parser-resolved lexical bindings. */
export type StudioInsertProjectViewPatchRequest = {
  afterId?: string
  beforeId?: string
  bindings?: Readonly<Record<string, string>>
  kind: 'insert-project-view'
  viewName: string
}

export type StudioSketchScenarioFixtureBinding = Readonly<{
  fixtureHandle: string
  scenarioName: string
}>

/** Adds one entity parameter and fixture-backed argument to every entry of a generated sketch group. */
export type StudioAddSketchEntityParameterPatchRequest = Readonly<{
  entity: Readonly<{
    declarationName: string
    importPath: string
    parameterName: string
  }>
  fixtureName: string
  kind: 'add-sketch-entity-parameter'
  scenarioArguments: readonly StudioSketchScenarioFixtureBinding[]
  scenarioGroupName: string
  viewName: string
}>

export type StudioSketchFieldPath = readonly [string, ...string[]]

export type StudioSketchFieldPresentation =
  | Readonly<{ kind: 'image'; labelFieldPath?: StudioSketchFieldPath }>
  | Readonly<{ kind: 'text'; prefix?: string; suffix?: string }>

/** Rebinds one tagged snapped leaf from placeholder content to a typed entity field path. */
export type StudioBindSketchFieldPatchRequest = Readonly<{
  fieldPath: StudioSketchFieldPath
  kind: 'bind-sketch-field'
  parameterName: string
  presentation: StudioSketchFieldPresentation
  rectId: string
  renderId: string
  viewName: string
}>

export type StudioLayoutAlignment = 'baseline' | 'bottom' | 'center' | 'left' | 'right' | 'top'
export type StudioLayoutContentTerm = StudioLayoutAlignment | 'spread' | 'spread-balanced' | 'spread-inset' | 'stretch'
export type StudioLayoutSpacingSide = 'bottom' | 'horizontal' | 'left' | 'right' | 'top' | 'vertical'
export type StudioLayoutTermValue = string | number
export type StudioLayoutSizeValue = string | number
export type StudioLayoutEntry =
  | readonly ['aligned', StudioLayoutAlignment]
  | readonly ['centered' | 'compress' | 'fill' | 'hug' | 'rigid']
  | readonly ['claim', number]
  | readonly ['gap', StudioLayoutSizeValue]
  | readonly ['content', StudioLayoutContentTerm]
  | readonly [
    'content',
    StudioLayoutContentTerm,
    StudioLayoutContentTerm,
  ]
  | readonly ['height', 'fill' | StudioLayoutSizeValue]
  | readonly ['margin' | 'pad', StudioLayoutSizeValue]
  | readonly [
    'margin' | 'pad',
    StudioLayoutSpacingSide,
    StudioLayoutSizeValue,
    ...(StudioLayoutSpacingSide | StudioLayoutSizeValue)[],
  ]
  | readonly ['width', 'fill' | StudioLayoutSizeValue]
  | readonly ['width', 'max', StudioLayoutSizeValue]

/** StudioSetLayoutEntryPatchRequest sets one layout entry on a rendered Tao node. */
export type StudioSetLayoutEntryPatchRequest = {
  entry: StudioLayoutEntry
  kind: 'set-layout-entry'
  renderId: string
}

export type StudioStyleEntry = readonly [string, ...(number | string)[]]

export type StudioStyleLandingScope =
  | { kind: 'element-inline' }
  | { bundleName: string; kind: 'style-bundle'; mode: 'edit' | 'fork'; forkName?: string }
  | { elementName: string; kind: 'element-default' }
  | { kind: 'size-token'; tokenName: string }
  | { kind: 'token'; tokenName: string }

/** StudioSetStyleEntryPatchRequest keeps the landing scope explicit across the source-action bus. */
export type StudioSetStyleEntryPatchRequest = {
  entry: StudioStyleEntry
  kind: 'set-style-entry'
  landing: StudioStyleLandingScope
  renderId: string
}

export type StudioStyleProvenance = {
  blastRadius: number
  chain: readonly string[]
  editable?: false
  landing: StudioStyleLandingScope
  ownerPath?: string
  reason?: string
}

export type StudioRenderInspection = {
  design?: Readonly<{
    editable: boolean
    name: string
    ownerPath: string
    reason?: string
  }>
  elementName?: string
  explorations: readonly StudioStyleEntry[]
  layoutEntries: readonly StudioLayoutEntry[]
  renderId: string
  styleEntries: readonly StudioStyleEntry[]
  styleProvenance: readonly StudioStyleProvenance[]
}

export type StudioWorkspaceDesignContext = {
  files?: readonly AST.TaoFile[]
  occurrence?: StudioSourceOccurrencePrecondition
}

/** StudioSourceOccurrencePrecondition binds a revision-scoped render locator to compiler-owned identity. */
export type StudioSourceOccurrencePrecondition = {
  nodeKind: string
  renderOwner?: string
}

/** StudioSourceOccurrenceConflictError reports an exact render-identity mismatch before mutation. */
export class StudioSourceOccurrenceConflictError extends Errors.UserInputError {
  constructor(
    readonly code: 'node-kind-mismatch' | 'render-owner-mismatch',
    readonly renderId: string,
    readonly expected: string | undefined,
    readonly actual: string | undefined,
  ) {
    super(
      code === 'node-kind-mismatch'
        ? `Studio render node kind changed before the edit was applied: ${renderId}`
        : `Studio render owner changed before the edit was applied: ${renderId}`,
    )
  }
}

/** StudioWrapRenderPatchRequest wraps one rendered Tao node in a Studio-owned container. */
export type StudioWrapRenderPatchRequest = {
  kind: 'wrap-render'
  renderId: string
  wrapper: 'Stack'
}

export type StudioScenarioArgumentValue =
  | boolean
  | number
  | string
  | Readonly<{ kind: 'now' }>
  | Readonly<{ handle: string; kind: 'fixture-reference' }>

/** StudioSetScenarioArgumentsPatchRequest promotes ephemeral controls into Tao source truth. */
export type StudioSetScenarioArgumentsPatchRequest = {
  appearance?: 'dark' | 'light'
  arguments: Readonly<Record<string, StudioScenarioArgumentValue>>
  kind: 'set-scenario-arguments'
  scenarioGroupName: string
  scenarioName: string
}

/** StudioInsertCapturedFixturePatchRequest accepts a reviewed runtime-data capture into Tao source. */
export type StudioInsertCapturedFixturePatchRequest = {
  fixtureName: string
  kind: 'insert-captured-fixture'
  plan: Readonly<{
    accounts: readonly Readonly<{ fields: Readonly<Record<string, StudioScenarioArgumentValue>>; name: string }>[]
    creates: readonly Readonly<{
      entity: string
      fields: Readonly<Record<string, StudioScenarioArgumentValue>>
      name: string
    }>[]
  }>
}

/** StudioMoveRenderRequest declares a visual reorder of rendered Tao nodes. */
export type StudioMoveRenderRequest = {
  afterId?: string
  beforeId?: string
  draggedId: string
}

/** StudioMoveRenderPatchRequest moves a rendered Tao node to another visual render gap. */
export type StudioMoveRenderPatchRequest = StudioMoveRenderRequest & {
  kind: 'move-render'
}

/** Toggles the nearest Row/Col owning one stable leaf render. */
export type StudioToggleFlowDirectionPatchRequest = Readonly<{
  kind: 'toggle-flow-direction'
  renderId: string
}>

/** Inserts a one-pixel cross-axis separator after a stable leaf render. */
export type StudioInsertSeparatorPatchRequest = Readonly<{
  afterId: string
  beforeId?: string
  kind: 'insert-separator'
}>

/** Inserts a Spacer between adjacent leaves and assigns their proportional claims. */
export type StudioInsertSpacerPatchRequest = Readonly<{
  afterId: string
  beforeId: string
  kind: 'insert-spacer'
  ratio: readonly [number, number]
}>

export type StudioSketchSnapElement = Readonly<{
  arguments: readonly string[]
  component: 'Image' | 'Placeholder' | 'Text'
  content?: string
  layout: readonly StudioLayoutEntry[]
  rectId: string
  type: 'element'
}>

export type StudioSketchSnapContainer = Readonly<{
  children: readonly StudioSketchSnapTree[]
  direction: 'Col' | 'Row'
  layout: readonly StudioLayoutEntry[]
  type: 'container'
}>

export type StudioSketchSnapTree = StudioSketchSnapContainer | StudioSketchSnapElement

/** Structured-only request for replacing one generated public sketch view's render tree. */
export type StudioSnapSketchToFlowPatchRequest = Readonly<{
  expectedCatalogRevision: number
  kind: 'snap-sketch-to-flow'
  mergeDirection: 'Col' | 'Row'
  mergePosition: 'after' | 'before'
  rectIds: readonly string[]
  sketchId: string
  tree: StudioSketchSnapTree
  viewName: string
}>

/** Structured-only request for removing selected Studio-owned leaves from a generated sketch view. */
export type StudioUnsnapSketchFromFlowPatchRequest = Readonly<{
  fallback: Readonly<{ height: number; label: string; width: number }>
  kind: 'unsnap-sketch-from-flow'
  rectIds: readonly string[]
  sketchId: string
  viewName: string
}>

/** StudioSourcePatchRequest declares one semantic visual source mutation from Studio. */
export type StudioSourcePatchRequest =
  | StudioAddSketchEntityParameterPatchRequest
  | StudioBindSketchFieldPatchRequest
  | StudioInsertCapturedFixturePatchRequest
  | StudioInsertComponentPatchRequest
  | StudioInsertProjectViewPatchRequest
  | StudioInsertSeparatorPatchRequest
  | StudioInsertSpacerPatchRequest
  | StudioSetLayoutEntryPatchRequest
  | StudioSetStyleEntryPatchRequest
  | StudioSetScenarioArgumentsPatchRequest
  | StudioSnapSketchToFlowPatchRequest
  | StudioToggleFlowDirectionPatchRequest
  | StudioUnsnapSketchFromFlowPatchRequest
  | StudioWrapRenderPatchRequest
  | StudioMoveRenderPatchRequest

/** StudioSourceTextEdit describes one exact text replacement produced by a Studio source action. */
export type StudioSourceTextEdit = {
  end: number
  replacement: string
  start: number
}

/** StudioSourcePatch is the source-actions patch bus result consumed by Studio. */
export type StudioSourcePatch = {
  content: string
  edits: readonly StudioSourceTextEdit[]
  sourcePath: string
  sourceVersion: string
}

/** StudioActions exposes source transforms used by Tao Studio visual editing. */
export const StudioActions = {
  addSketchEntityParameter,
  applyPatch,
  bindSketchField,
  insertCapturedFixture,
  insertComponent,
  insertProjectView,
  insertSeparator,
  insertSpacer,
  inspectRender,
  moveRender,
  setLayoutEntry,
  setScenarioArguments,
  snapSketchToFlow,
  setStyleEntry,
  sourceVersion: contentVersion,
  toggleFlowDirection,
  wrapRender,
} as const

/** applyPatch applies a typed Studio source-action request to a Tao document. */
async function applyPatch(
  document: AST.Document,
  request: StudioSourcePatchRequest,
  context: StudioWorkspaceDesignContext = {},
): Promise<StudioSourcePatch> {
  const source = document.textDocument.getText()
  const content = await applyPatchContent(document, request, context)
  return {
    content,
    edits: fullDocumentEdit(source, content),
    sourcePath: document.uri.fsPath,
    sourceVersion: contentVersion(content),
  }
}

async function applyPatchContent(
  document: AST.Document,
  request: StudioSourcePatchRequest,
  context: StudioWorkspaceDesignContext,
): Promise<string> {
  validateOccurrencePrecondition(document, request, context.occurrence)
  return await Switch.kind(request, {
    'add-sketch-entity-parameter': async action => await addSketchEntityParameter(document, action, context),
    'bind-sketch-field': async action => await bindSketchField(document, action),
    'insert-captured-fixture': async action => await insertCapturedFixture(document, action),
    'insert-component': async action => await insertComponent(document, action.component, action),
    'insert-project-view': async action => await insertProjectView(document, action),
    'insert-separator': async action => await insertSeparator(document, action),
    'insert-spacer': async action => await insertSpacer(document, action),
    'move-render': async action => await moveRender(document, action),
    'set-layout-entry': async action => await setLayoutEntry(document, action),
    'set-scenario-arguments': async action => await setScenarioArguments(document, action),
    'set-style-entry': async action => await setStyleEntry(document, action, context),
    'snap-sketch-to-flow': async action => await snapSketchToFlow(document, action),
    'toggle-flow-direction': async action => await toggleFlowDirection(document, action),
    'unsnap-sketch-from-flow': async action => await unsnapSketchFromFlow(document, action),
    'wrap-render': async action => await wrapRender(document, action),
  })
}

function validateOccurrencePrecondition(
  document: AST.Document,
  request: StudioSourcePatchRequest,
  precondition: StudioSourceOccurrencePrecondition | undefined,
): void {
  if (precondition === undefined) {
    return
  }
  const targetId = occurrenceTargetRenderId(request)
  if (targetId === undefined) {
    throw new Errors.UserInputError(`Studio source action does not target a render occurrence: ${request.kind}`)
  }
  const render = requireRenderById(document.parseResult.value, targetId)
  const actualNodeKind = 'render'
  if (precondition.nodeKind !== actualNodeKind) {
    throw new StudioSourceOccurrenceConflictError(
      'node-kind-mismatch',
      targetId,
      precondition.nodeKind,
      actualNodeKind,
    )
  }
  const actualOwner = AST.findOwningView(render)?.name
  if (precondition.renderOwner !== actualOwner) {
    throw new StudioSourceOccurrenceConflictError(
      'render-owner-mismatch',
      targetId,
      precondition.renderOwner,
      actualOwner,
    )
  }
}

function occurrenceTargetRenderId(request: StudioSourcePatchRequest): string | undefined {
  return Switch.kind(request, {
    'add-sketch-entity-parameter': () => undefined,
    'bind-sketch-field': action => action.renderId,
    'insert-captured-fixture': () => undefined,
    'insert-component': action => action.beforeId ?? action.afterId,
    'insert-project-view': action => action.beforeId ?? action.afterId,
    'insert-separator': action => action.afterId,
    'insert-spacer': action => action.afterId,
    'move-render': action => action.draggedId,
    'set-layout-entry': action => action.renderId,
    'set-scenario-arguments': () => undefined,
    'set-style-entry': action => action.renderId,
    'snap-sketch-to-flow': () => undefined,
    'toggle-flow-direction': action => action.renderId,
    'unsnap-sketch-from-flow': () => undefined,
    'wrap-render': action => action.renderId,
  })
}

async function addSketchEntityParameter(
  document: AST.Document,
  request: StudioAddSketchEntityParameterPatchRequest,
  context: StudioWorkspaceDesignContext = {},
): Promise<string> {
  assertNoSyntaxErrors(document)
  validateAddSketchEntityParameterRequest(request)
  const file = document.parseResult.value
  const view = uniqueGeneratedSketchView(file, request.viewName)
  const groups = file.statements.filter(AST.isScenarioGroupDeclaration)
    .filter(group => group.name === request.scenarioGroupName && group.subject?.ref === view)
  if (groups.length !== 1) {
    throw new Errors.UserInputError(
      `Studio entity binding requires one owned sketch scenario group: ${request.scenarioGroupName}`,
    )
  }
  const group = groups[0]!
  const fixture = file.statements.filter(AST.isFixtureDeclaration)
    .filter(candidate => candidate.name === request.fixtureName)
  if (fixture.length !== 1) {
    throw new Errors.UserInputError(
      `Studio sketch fixture is not uniquely declared in this source file: ${request.fixtureName}`,
    )
  }
  const entities = [
    ...new Set(
      (context.files ?? [file]).flatMap(candidate => candidate.statements.filter(AST.isEntityDataDeclaration)),
    ),
  ].filter(candidate =>
    candidate.name === request.entity.declarationName && candidate.singularName === request.entity.parameterName
  )
  if (entities.length > 1) {
    throw new Errors.UserInputError(
      `Studio sketch entity is not uniquely declared: ${request.entity.declarationName} / ${request.entity.parameterName}`,
    )
  }
  const entity = entities[0]
  if (AST.parametersOf(view).some(parameter => Type.parameterName(parameter) === request.entity.parameterName)) {
    throw new Errors.UserInputError(`Studio sketch view already declares parameter ${request.entity.parameterName}.`)
  }
  const scenarios = AST.scenarioDeclarations(group)
  const handles = new Map(request.scenarioArguments.map(binding => [binding.scenarioName, binding.fixtureHandle]))
  if (
    handles.size !== request.scenarioArguments.length
    || scenarios.length !== handles.size
    || scenarios.some(scenario => !handles.has(scenario.name))
  ) {
    throw new Errors.UserInputError(
      'Studio entity binding must supply one fixture handle for every sketch scenario entry.',
    )
  }
  const fixtureValues = new Map(AST.fixtureValueDeclarations(fixture[0]!).map(value => [value.name, value]))
  for (const binding of request.scenarioArguments) {
    const value = fixtureValues.get(binding.fixtureHandle)
    if (
      !AST.isFixtureCreateBinding(value)
      || value.entity.$refText !== request.entity.parameterName
      || (entity !== undefined && value.entity.ref !== undefined && value.entity.ref !== entity)
    ) {
      throw new Errors.UserInputError(
        `Studio fixture handle ${binding.fixtureHandle} does not create ${request.entity.parameterName}.`,
      )
    }
  }
  for (const scenario of scenarios) {
    const effectiveFixture = AST.effectiveScenarioClause(scenario, AST.isScenarioFixtureClause)
    if (effectiveFixture !== undefined && effectiveFixture.fixture.ref !== fixture[0]) {
      throw new Errors.UserInputError(`Studio scenario ${scenario.name} already uses another fixture.`)
    }
  }

  const source = document.textDocument.getText()
  const parameterList = view.parameterList?.$cstNode
  if (parameterList === undefined) {
    throw new Errors.UserInputError(`Studio sketch view has no editable parameter list: ${request.viewName}`)
  }
  const parameterSources = AST.parametersOf(view).map(parameter => parameter.$cstNode!.text)
  const edits: SourceEdit[] = [{
    end: parameterList.end,
    replacement: `(${[...parameterSources, request.entity.parameterName].join(', ')})`,
    start: parameterList.offset,
  }]
  if (group.block.entries.every(entry => !AST.isScenarioFixtureClause(entry))) {
    const offset = group.block.$cstNode!.offset + 1
    edits.push({ end: offset, replacement: `\nfixture ${request.fixtureName}`, start: offset })
  }
  for (const scenario of scenarios) {
    const ownRender = scenario.block.entries.find(AST.isScenarioRenderClause)
    const effectiveRender = AST.effectiveScenarioSubjectClause(scenario)
    if (effectiveRender !== undefined && !AST.isScenarioRenderClause(effectiveRender)) {
      throw new Errors.UserInputError(`Studio sketch scenario ${scenario.name} does not render a view.`)
    }
    const arguments_ = effectiveRender?.argumentList?.arguments ?? []
    if (arguments_.some(argument => argument.label === request.entity.parameterName)) {
      throw new Errors.UserInputError(
        `Studio sketch scenario ${scenario.name} already supplies ${request.entity.parameterName}.`,
      )
    }
    const argumentSource = [
      ...arguments_.map(argument => argument.$cstNode!.text),
      `${request.entity.parameterName}: ${handles.get(scenario.name)!}`,
    ].join(', ')
    const replacement = scenarioRenderSource(scenario, view, argumentSource)
    if (ownRender?.$cstNode !== undefined) {
      edits.push({ end: ownRender.$cstNode.end, replacement, start: ownRender.$cstNode.offset })
    } else {
      const firstStepOffset = scenario.block.steps[0]?.$cstNode?.offset
      const offset = firstStepOffset ?? scenario.block.$cstNode!.end - 1
      edits.push({
        end: offset,
        replacement: `${firstStepOffset === undefined ? '\n' : ''}${replacement}\n`,
        start: offset,
      })
    }
  }
  const changed = applySourceEdits(source, edits)
  const imported = ensureNamedImport(
    changed,
    file,
    request.entity.declarationName,
    request.entity.importPath,
  )
  return await formatAndReparse(document, imported)
}

async function bindSketchField(
  document: AST.Document,
  request: StudioBindSketchFieldPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  validateBindSketchFieldRequest(request)
  requireLocalRenderId(document, request.renderId, 'bind sketch fields')
  const file = document.parseResult.value
  const view = uniqueGeneratedSketchView(file, request.viewName)
  const render = requireRenderById(file, request.renderId)
  if (
    !AST.isRender(render)
    || (AST.isRenderStatement(render) && render.injection !== undefined)
    || render.block !== undefined
    || AST.findOwningView(render) !== view
    || render.$cstNode === undefined
  ) {
    throw new Errors.UserInputError('Studio field binding requires one leaf in the generated sketch view.')
  }
  if (AST.attachedTag(render)?.tag !== `#studio_rect_${encodedTag(request.rectId)}`) {
    throw new Errors.UserInputError(`Studio field binding target does not match rectangle ${request.rectId}.`)
  }
  const parameter = AST.parametersOf(view)
    .find(candidate => Type.parameterName(candidate) === request.parameterName)
  if (parameter === undefined) {
    throw new Errors.UserInputError(`Studio sketch parameter does not exist: ${request.parameterName}`)
  }
  const field = resolveSketchFieldPath(parameter, request.fieldPath)
  const expression = [request.parameterName, ...request.fieldPath].join('.')
  let component: 'Image' | 'Text'
  let invocation: string
  if (request.presentation.kind === 'image') {
    requireTextField(field, request.fieldPath, 'image source')
    const label = request.presentation.labelFieldPath === undefined
      ? undefined
      : resolveSketchFieldPath(parameter, request.presentation.labelFieldPath)
    if (request.presentation.labelFieldPath !== undefined) {
      requireTextField(label!, request.presentation.labelFieldPath, 'image label')
    }
    component = 'Image'
    invocation = `Image(${expression}${
      request.presentation.labelFieldPath === undefined
        ? ''
        : `, Label: ${[request.parameterName, ...request.presentation.labelFieldPath].join('.')}`
    })`
  } else {
    if (field.kind !== 'primitive' && field.kind !== 'enum') {
      throw new Errors.UserInputError(`Studio text binding cannot render field path ${request.fieldPath.join('.')}.`)
    }
    component = 'Text'
    invocation = field.kind === 'primitive'
        && field.primitive === 'text'
        && request.presentation.prefix === undefined
        && request.presentation.suffix === undefined
      ? `Text(${expression})`
      : `Text(${interpolatedFieldSource(expression, request.presentation.prefix, request.presentation.suffix)})`
  }
  const layout = render.layoutClause?.$cstNode?.text
  const source = applySourceEdits(document.textDocument.getText(), [{
    end: render.$cstNode.end,
    replacement: `${AST.isRenderStatement(render) ? 'render ' : ''}${invocation}${
      layout === undefined ? '' : ` ${layout}`
    }`,
    start: render.$cstNode.offset,
  }])
  return await formatAndReparse(document, ensureUiComponentImport(source, file, component))
}

function validateAddSketchEntityParameterRequest(request: StudioAddSketchEntityParameterPatchRequest): void {
  requireExactKeys(
    request,
    ['entity', 'fixtureName', 'kind', 'scenarioArguments', 'scenarioGroupName', 'viewName'],
    'Add sketch entity parameter request',
  )
  requireExactKeys(request.entity, ['declarationName', 'importPath', 'parameterName'], 'Sketch entity reference')
  requireIdentifier(request.viewName, 'sketch view')
  requireIdentifier(request.entity.declarationName, 'entity declaration')
  requireIdentifier(request.entity.parameterName, 'entity parameter')
  requireIdentifier(request.fixtureName, 'sketch fixture')
  if (request.scenarioGroupName.length === 0 || /[\u0000-\u001f\u007f]/u.test(request.scenarioGroupName)) {
    throw new Errors.UserInputError('Studio sketch scenario group name is invalid.')
  }
  if (
    !/^(?:\.\.?\/)+(?:[A-Za-z_][A-Za-z0-9_-]*)(?:\/[A-Za-z_][A-Za-z0-9_-]*)*(?:\.tao)?$/.test(
      request.entity.importPath,
    )
  ) {
    throw new Errors.UserInputError(`Studio entity import path is invalid: ${request.entity.importPath}`)
  }
  if (!Array.isArray(request.scenarioArguments) || request.scenarioArguments.length === 0) {
    throw new Errors.UserInputError('Studio entity binding requires sketch scenario arguments.')
  }
  for (const binding of request.scenarioArguments) {
    requireExactKeys(binding, ['fixtureHandle', 'scenarioName'], 'Sketch scenario fixture binding')
    requireIdentifier(binding.fixtureHandle, 'fixture handle')
    if (binding.scenarioName.length === 0 || /[\u0000-\u001f\u007f]/u.test(binding.scenarioName)) {
      throw new Errors.UserInputError('Studio sketch scenario name is invalid.')
    }
  }
}

function validateBindSketchFieldRequest(request: StudioBindSketchFieldPatchRequest): void {
  requireExactKeys(
    request,
    ['fieldPath', 'kind', 'parameterName', 'presentation', 'rectId', 'renderId', 'viewName'],
    'Bind sketch field request',
  )
  requireIdentifier(request.viewName, 'sketch view')
  requireIdentifier(request.parameterName, 'sketch parameter')
  if (request.rectId.length === 0) {
    throw new Errors.UserInputError('Studio field binding rectangle identity must be nonempty.')
  }
  validateFieldPath(request.fieldPath, 'field')
  if (request.presentation.kind === 'image') {
    requireExactKeys(request.presentation, ['kind', 'labelFieldPath'], 'Sketch image presentation')
    if (request.presentation.labelFieldPath !== undefined) {
      validateFieldPath(request.presentation.labelFieldPath, 'image label')
    }
  } else if (request.presentation.kind === 'text') {
    requireExactKeys(request.presentation, ['kind', 'prefix', 'suffix'], 'Sketch text presentation')
    for (const value of [request.presentation.prefix, request.presentation.suffix]) {
      if (value !== undefined && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
        throw new Errors.UserInputError('Studio text binding affixes contain unsupported control characters.')
      }
    }
  } else {
    throw new Errors.UserInputError('Studio sketch field presentation is invalid.')
  }
}

function validateFieldPath(path: readonly string[], label: string): void {
  if (!Array.isArray(path) || path.length === 0) {
    throw new Errors.UserInputError(`Studio ${label} path must contain at least one field.`)
  }
  path.forEach(segment => requireIdentifier(segment, `${label} path segment`))
}

function uniqueGeneratedSketchView(file: AST.TaoFile, viewName: string): AST.ViewDeclaration {
  const views = file.statements.filter(AST.isViewDeclaration).filter(view => view.name === viewName)
  const view = views.length === 1 ? views[0] : undefined
  if (
    view === undefined || view.visibility !== 'public' || view.block === undefined
    || !/^View[1-9][0-9]*$/.test(viewName)
  ) {
    throw new Errors.UserInputError(`Studio entity binding requires one generated public ViewN: ${viewName}`)
  }
  return view
}

function resolveSketchFieldPath(parameter: AST.ParameterDeclaration, path: readonly string[]) {
  let type = Type.ofParameter(parameter)
  for (const [index, segment] of path.entries()) {
    if (type.kind === 'list' && segment === 'Count' && index === path.length - 1) {
      return { kind: 'primitive' as const, primitive: 'number' as const }
    }
    if (type.kind !== 'entity') {
      throw new Errors.UserInputError(`Studio field path cannot traverse ${path.slice(0, index).join('.') || 'value'}.`)
    }
    const field = Type.dataFields(type.entity).find(candidate => candidate.name === segment)
    if (field === undefined) {
      throw new Errors.UserInputError(`Studio entity ${type.entity.singularName} has no field ${segment}.`)
    }
    if (field.optional) {
      throw new Errors.UserInputError(`Studio field path cannot bind optional field ${segment} without a fallback.`)
    }
    type = Type.dataFieldType(field)
  }
  return type
}

function requireTextField(
  field: ReturnType<typeof resolveSketchFieldPath>,
  path: readonly string[],
  label: string,
): void {
  if (field.kind !== 'primitive' || field.primitive !== 'text') {
    throw new Errors.UserInputError(`Studio ${label} must be a text field: ${path.join('.')}`)
  }
}

function interpolatedFieldSource(expression: string, prefix = '', suffix = ''): string {
  const escapedPrefix = taoStringLiteral(prefix).slice(1, -1)
  const escapedSuffix = taoStringLiteral(suffix).slice(1, -1)
  return `"${escapedPrefix}{ ${expression} }${escapedSuffix}"`
}

function ensureNamedImport(
  source: string,
  file: AST.TaoFile,
  declarationName: string,
  importPath: string,
): string {
  const use = file.statements.filter(AST.isUseStatement).find(statement => statement.importPath === importPath)
  if (use?.$cstNode !== undefined) {
    const imported = use.importedDeclarations.map(reference => reference.$refText)
    return imported.includes(declarationName)
      ? source
      : applySourceEdits(source, [{
        end: use.$cstNode.end,
        replacement: `use ${[...new Set([...imported, declarationName])].toSorted().join(', ')} from ${importPath}`,
        start: use.$cstNode.offset,
      }])
  }
  const offset = file.statements[0]?.$cstNode?.offset ?? 0
  return applySourceEdits(source, [{
    end: offset,
    replacement: `use ${declarationName} from ${importPath}\n\n`,
    start: offset,
  }])
}

async function formatAndReparse(document: AST.Document, source: string): Promise<string> {
  const formatted = await Formatter.formatCode(source)
  assertNoSyntaxErrors(await parseSourceText(document, formatted))
  return formatted
}

async function insertCapturedFixture(
  document: AST.Document,
  request: StudioInsertCapturedFixturePatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireIdentifier(request.fixtureName, 'captured fixture')
  if (
    document.parseResult.value.statements.some(statement =>
      AST.isFixtureDeclaration(statement) && statement.name === request.fixtureName
    )
  ) {
    throw new Errors.UserInputError(`Tao fixture already exists: ${request.fixtureName}`)
  }
  const entries = [
    ...request.plan.accounts.map(account => {
      requireIdentifier(account.name, 'captured account')
      return `account ${account.name} { ${fixtureFieldsSource(account.fields)} }`
    }),
    ...request.plan.creates.map(create => {
      requireIdentifier(create.name, 'captured row')
      requireIdentifier(create.entity, 'captured entity')
      return `${create.name} = create ${create.entity} { ${fixtureFieldsSource(create.fields)} }`
    }),
  ]
  const suffix = document.textDocument.getText().endsWith('\n') ? '' : '\n'
  return await Formatter.formatCode(
    `${document.textDocument.getText()}${suffix}\nfixture ${request.fixtureName} {\n${entries.join('\n')}\n}\n`,
  )
}

function fixtureFieldsSource(fields: Readonly<Record<string, StudioScenarioArgumentValue>>): string {
  return Object.entries(fields).map(([name, value]) => {
    requireIdentifier(name, 'captured field')
    return `${name}: ${scenarioArgumentSource(value)}`
  }).join(', ')
}

function requireIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Errors.UserInputError(`Studio ${label} name is invalid: ${value}`)
  }
}

/** setScenarioArguments replaces one focused scenario's named arguments and canonicalizes the file. */
async function setScenarioArguments(
  document: AST.Document,
  request: StudioSetScenarioArgumentsPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  const groups = document.parseResult.value.statements
    .filter(AST.isScenarioGroupDeclaration)
    .filter(group => group.name === request.scenarioGroupName)
  const scenarios = groups.flatMap(group => AST.scenarioDeclarations(group))
    .filter(scenario => scenario.name === request.scenarioName)
  if (groups.length !== 1 || scenarios.length !== 1) {
    throw new Errors.UserInputError(
      `Studio scenario is not uniquely declared in this source file: ${request.scenarioGroupName} / ${request.scenarioName}`,
    )
  }
  const scenario = scenarios[0]!
  const subject = AST.scenarioSubjectDeclaration(scenario)
  const ownRender = scenario.block.entries.find(AST.isScenarioRenderClause)
  const ownAppearance = scenario.block.entries.find(AST.isScenarioAppearanceClause)
  if (!AST.isViewDeclaration(subject) || scenario.block.$cstNode === undefined) {
    throw new Errors.UserInputError(
      `Studio can only promote arguments into a focused render scenario: ${request.scenarioGroupName} / ${request.scenarioName}`,
    )
  }
  const argumentsSource = Object.entries(request.arguments)
    .map(([name, value]) => `${name}: ${scenarioArgumentSource(value)}`)
    .join(', ')
  const source = document.textDocument.getText()
  const renderSource = scenarioRenderSource(scenario, subject, argumentsSource)
  const edits: SourceEdit[] = []
  const additions: string[] = []
  if (ownRender?.$cstNode) {
    edits.push({
      end: ownRender.$cstNode.end,
      replacement: renderSource,
      start: ownRender.$cstNode.offset,
    })
  } else {
    additions.push(renderSource)
  }
  if (request.appearance !== undefined) {
    if (ownAppearance?.$cstNode) {
      edits.push({
        end: ownAppearance.$cstNode.end,
        replacement: `appearance ${request.appearance}`,
        start: ownAppearance.$cstNode.offset,
      })
    } else {
      additions.push(`appearance ${request.appearance}`)
    }
  }
  if (additions.length > 0) {
    const firstStepOffset = scenario.block.steps[0]?.$cstNode?.offset
    const insertionOffset = firstStepOffset ?? scenario.block.$cstNode.end - 1
    edits.push({
      end: insertionOffset,
      replacement: `${firstStepOffset === undefined ? '\n' : ''}${additions.join('\n')}\n`,
      start: insertionOffset,
    })
  }
  const content = applySourceEdits(source, edits)
  return await Formatter.formatCode(content)
}

function scenarioRenderSource(
  scenario: AST.ScenarioDeclaration,
  view: AST.ViewDeclaration,
  argumentsSource: string,
): string {
  const ownRender = scenario.block.entries.find(AST.isScenarioRenderClause)
  if (ownRender?.view) {
    return `render ${ownRender.view.$refText}(${argumentsSource})`
  }
  const groupSubject = AST.findOwningScenarioGroup(scenario)?.subject?.ref
  return groupSubject === view
    ? `render (${argumentsSource})`
    : `render ${view.name}(${argumentsSource})`
}

function scenarioArgumentSource(value: StudioScenarioArgumentValue): string {
  if (typeof value === 'string') {
    return taoStringLiteral(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Errors.UserInputError('Studio scenario numbers must be finite.')
    }
    return String(value)
  }
  if (typeof value === 'boolean') {
    return String(value)
  }
  if (value.kind === 'now') {
    return 'now'
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.handle)) {
    throw new Errors.UserInputError(`Studio fixture handle is invalid: ${value.handle}`)
  }
  return value.handle
}

function taoStringLiteral(value: string): string {
  let source = '"'
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    const escaped = taoStringEscapes[character]
    if (escaped !== undefined) {
      source += escaped
      continue
    }
    const codeUnit = value.charCodeAt(index)
    source += codeUnit <= 0x1f || (codeUnit >= 0xd800 && codeUnit <= 0xdfff)
      ? `\\u${codeUnit.toString(16).padStart(4, '0')}`
      : character
  }
  return `${source}"`
}

const taoStringEscapes: Readonly<Record<string, string>> = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
  '"': '\\"',
  '\\': '\\\\',
  '{': '\\{',
}

/** insertComponent inserts a constrained current-dialect palette component into the first render block. */
async function insertComponent(
  document: AST.Document,
  component: StudioComponentKind,
  gap: StudioRenderGap = {},
): Promise<string> {
  assertNoSyntaxErrors(document)
  if (!studioComponentKinds.has(component)) {
    throw new Errors.UserInputError(`Unsupported Studio palette component: ${String(component)}`)
  }
  const insertion = studioComponentSnippets[component]
  const inserted = insertStudioSnippetAtGap(document, insertion, gap)
  return await Formatter.formatCode(ensureUiComponentImport(inserted, document.parseResult.value, component))
}

async function insertViewRender(
  document: AST.Document,
  insertion: string,
  gap: StudioRenderGap = {},
): Promise<string> {
  return await Formatter.formatCode(insertStudioSnippetAtGap(document, insertion, gap))
}

/** insertProjectView binds required parameters from the exact target gap's lexical scope. */
async function insertProjectView(
  document: AST.Document,
  request: StudioInsertProjectViewPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  validateInsertProjectViewRequest(request)
  const target = studioInsertionTarget(document, request)
  const view = requireInsertableProjectView(
    document.parseResult.value,
    request.viewName,
    AST.findOwningView(target.block)?.name,
  )
  const arguments_ = projectViewArguments(
    view,
    visibleInsertionValues(target.block, target.offset),
    request.bindings ?? {},
  )
  return await insertViewRender(document, `${request.viewName}(${arguments_})`, request)
}

/** toggleFlowDirection changes the nearest Row/Col that directly or transitively owns a leaf render. */
async function toggleFlowDirection(
  document: AST.Document,
  request: StudioToggleFlowDirectionPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireLocalRenderId(document, request.renderId, 'toggle flow direction for renders')
  const leaf = requireLeafRenderById(document.parseResult.value, request.renderId)
  const owner = nearestFlowOwner(leaf)
  const reference = owner.view!.$refNode
  if (reference === undefined) {
    throw new Errors.UserInputError('Cannot toggle a flow container without source coordinates.')
  }
  const direction: 'Col' | 'Row' = flowDirection(owner) === 'Row' ? 'Col' : 'Row'
  const source = applySourceEdits(document.textDocument.getText(), [{
    end: reference.end,
    replacement: direction,
    start: reference.offset,
  }])
  return await Formatter.formatCode(ensureUiComponentImport(source, document.parseResult.value, direction))
}

/** insertSeparator inserts the current-dialect Box separator for the owning flow direction. */
async function insertSeparator(
  document: AST.Document,
  request: StudioInsertSeparatorPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  const siblings = requireFlowSiblings(document, request.afterId, request.beforeId)
  const direction = flowDirection(siblings.owner)
  const snippet = direction === 'Row' ? 'Box() [width 1, height fill]' : 'Box() [width fill, height 1]'
  const inserted = insertStudioSnippetAtGap(document, snippet, request)
  return await Formatter.formatCode(ensureUiComponentImport(inserted, document.parseResult.value, 'Box'))
}

/** insertSpacer inserts one Spacer and applies a deterministic two-sided claim ratio. */
async function insertSpacer(
  document: AST.Document,
  request: StudioInsertSpacerPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  const ratio = requireClaimRatio(request.ratio)
  const siblings = requireFlowSiblings(document, request.afterId, request.beforeId)
  const source = document.textDocument.getText()
  const slices = blockStatementSlices(source, siblings.block)
  const insertEdit = studioSnippetInsertionEdit(source, slices, request, 'Spacer()')
  const edits = [
    ...setRenderLayoutEntryEdits(source, siblings.after, `claim ${ratio[0]}`),
    ...setRenderLayoutEntryEdits(source, siblings.before!, `claim ${ratio[1]}`),
    insertEdit,
  ]
  const inserted = applySourceEdits(source, edits)
  return await Formatter.formatCode(ensureUiComponentImport(inserted, document.parseResult.value, 'Spacer'))
}

function requireClaimRatio(value: readonly [number, number]): readonly [number, number] {
  if (
    !Array.isArray(value)
    || value.length !== 2
    || value.some(weight => !Number.isSafeInteger(weight) || weight < 1 || weight > 100)
  ) {
    throw new Errors.UserInputError('Studio Spacer claim ratio must contain two integers from 1 through 100.')
  }
  return value
}

type FlowSiblings = {
  after: AST.ViewRender
  before?: AST.ViewRender
  block: AST.Block
  owner: FlowOwner
}

function requireFlowSiblings(
  document: AST.Document,
  afterId: string,
  beforeId: string | undefined,
): FlowSiblings {
  requireLocalRenderId(document, afterId, 'edit flow siblings')
  if (beforeId !== undefined) {
    requireLocalRenderId(document, beforeId, 'edit flow siblings')
  }
  const after = requireLeafRenderById(document.parseResult.value, afterId)
  const before = beforeId === undefined ? undefined : requireLeafRenderById(document.parseResult.value, beforeId)
  if (!AST.isBlock(after.$container) || (before !== undefined && before.$container !== after.$container)) {
    throw new Errors.UserInputError('Studio flow edits require direct leaf siblings in the same container.')
  }
  const block = after.$container
  const owner = block.$container
  if (!isFlowOwner(owner)) {
    throw new Errors.UserInputError('Studio flow edits require leaf siblings owned by a Row or Col.')
  }
  if (
    AST.findOwningView(after) === undefined
    || (before !== undefined && AST.findOwningView(before) !== AST.findOwningView(after))
  ) {
    throw new Errors.UserInputError('Studio flow edits require render expressions in the same view definition.')
  }
  if (before !== undefined) {
    const slices = blockStatementSlices(document.textDocument.getText(), block)
    insertionTargetIndex(slices, { afterId, beforeId })
  }
  return { after, ...(before === undefined ? {} : { before }), block, owner }
}

function requireLeafRenderById(file: AST.TaoFile, id: string): AST.ViewRender {
  const render = requireRenderById(file, id)
  if (!AST.isViewRender(render) || render.block !== undefined || !AST.isBlock(render.$container)) {
    throw new Errors.UserInputError(`Studio flow edit target is no longer a direct leaf render: ${id}`)
  }
  return render
}

type FlowOwner = AST.RenderStatement | AST.ViewRender

function flowDirection(render: FlowOwner): 'Col' | 'Row' {
  const direction = render.view?.$refText
  if (direction !== 'Row' && direction !== 'Col') {
    throw new Errors.UnexpectedBehaviorError('Expected a validated Studio Row or Col flow owner.')
  }
  return direction
}

function isFlowOwner(value: unknown): value is FlowOwner {
  return (AST.isViewRender(value) || AST.isRenderStatement(value))
    && (value.view?.$refText === 'Row' || value.view?.$refText === 'Col')
}

function nearestFlowOwner(render: AST.ViewRender): FlowOwner {
  let candidate: unknown = render.$container
  while (candidate !== undefined) {
    if (isFlowOwner(candidate)) {
      return candidate
    }
    candidate = typeof candidate === 'object' && candidate !== null && '$container' in candidate
      ? candidate.$container
      : undefined
  }
  throw new Errors.UserInputError('Studio direction toggle requires a leaf owned by a Row or Col.')
}

/** setLayoutEntry sets or replaces one layout entry on a rendered node. */
async function setLayoutEntry(document: AST.Document, request: StudioSetLayoutEntryPatchRequest): Promise<string> {
  assertNoSyntaxErrors(document)
  requireLocalRenderId(document, request.renderId, 'edit layout for renders')
  const entry = formatLayoutEntry(requireSupportedLayoutEntry(request.entry))
  const render = requireRenderById(document.parseResult.value, request.renderId)
  if (AST.isRenderStatement(render) && render.injection !== undefined) {
    throw new Errors.UserInputError('Cannot add a Tao layout clause to an injected root render.')
  }
  requireCompatibleLayoutEntry(render, layoutEntryHead(entry))
  return await Formatter.formatCode(setRenderLayoutEntrySource(document.textDocument.getText(), render, entry))
}

/** inspectRender returns parser-owned current clause values and workspace-aware design provenance. */
function inspectRender(
  document: AST.Document,
  renderId: string,
  context: StudioWorkspaceDesignContext = {},
): StudioRenderInspection {
  assertNoSyntaxErrors(document)
  requireLocalRenderId(document, renderId, 'inspect renders')
  const render = requireRenderById(document.parseResult.value, renderId)
  const entries = (render.layoutClause?.entries ?? []).map(entry => ASTUtils.layoutEntryValues(entry))
  const layoutEntries = entries.filter(isStudioLayoutEntry) as unknown as StudioLayoutEntry[]
  const styleEntries = entries.filter(entry => !isStudioLayoutEntry(entry)) as unknown as StudioStyleEntry[]
  const files = context.files ?? [document.parseResult.value]
  const design = selectedDesign(files)
  const ownerPath = design === undefined ? undefined : AST.getDocument(design).uri.fsPath
  const local = ownerPath === undefined || ownerPath === document.uri.fsPath
  const elementName = ASTUtils.standardDesignElementName(render)
  return {
    ...(design === undefined || ownerPath === undefined
      ? {}
      : {
        design: {
          editable: local,
          name: design.name,
          ownerPath,
          ...(local ? {} : { reason: 'Imported design values are read-only in this source file.' }),
        },
      }),
    ...(elementName === undefined ? {} : { elementName }),
    explorations: entries.filter(isInlineDesignExploration) as unknown as StudioStyleEntry[],
    layoutEntries,
    renderId,
    styleEntries,
    styleProvenance: styleEntries.map(entry => styleProvenance(files, document, design, entry)),
  }
}

function styleProvenance(
  files: readonly AST.TaoFile[],
  document: AST.Document,
  design: AST.DesignDeclaration | undefined,
  entry: StudioStyleEntry,
): StudioStyleProvenance {
  const bundleName = entry.length === 1 && typeof entry[0] === 'string' ? entry[0] : undefined
  const bundles = design === undefined ? [] : designSpecMembers(design).filter(bundle => bundle.name === bundleName)
  if (bundleName === undefined || bundles.length !== 1) {
    return { blastRadius: 1, chain: [formatLayoutValues(entry)], landing: { kind: 'element-inline' } }
  }
  const bundle = bundles[0]!
  const blastRadius = [
    ...files.flatMap(file => [
      ...AST.streamAllContents(file).filter(AST.isRender).filter(render =>
        render.layoutClause?.entries.some(candidate => {
          const values = ASTUtils.layoutEntryValues(candidate)
          return values.length === 1 && values[0] === bundleName
        }) === true
      ),
    ]),
  ].length
  const ownerPath = AST.getDocument(bundle).uri.fsPath
  const editable = ownerPath === document.uri.fsPath
  return {
    blastRadius,
    chain: [bundleName, ...bundle.spec.entries.map(candidate => ASTUtils.layoutEntryValues(candidate).join(' '))],
    ...(editable
      ? {}
      : {
        editable: false as const,
        ownerPath,
        reason: 'Imported style bundles are read-only; open their owning file to edit or fork them.',
      }),
    landing: { bundleName, kind: 'style-bundle', mode: 'edit' },
  }
}

type DesignSpecMember = AST.DesignBundle | AST.DesignStyleEntry | AST.DesignTextEntry

function designSpecMembers(design: AST.DesignDeclaration): DesignSpecMember[] {
  const result: DesignSpecMember[] = []
  for (const member of design.block.members) {
    if (AST.isDesignBundle(member)) {
      result.push(member)
    } else if (AST.isDesignStylesBlock(member) || AST.isDesignTextBlock(member)) {
      result.push(...member.entries)
    }
  }
  return result
}

/** setStyleEntry lands an exploration in an explicit, parser-owned current-grammar design scope. */
async function setStyleEntry(
  document: AST.Document,
  request: StudioSetStyleEntryPatchRequest,
  context: StudioWorkspaceDesignContext = {},
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireLocalRenderId(document, request.renderId, 'edit styles for renders')
  const render = requireRenderById(document.parseResult.value, request.renderId)
  const files = context.files ?? [document.parseResult.value]
  const entry = request.landing.kind === 'element-inline'
    ? formatStyleEntry(request.entry)
    : formatDesignEntry(request.entry)
  if (request.landing.kind === 'element-inline') {
    return await Formatter.formatCode(setRenderLayoutEntrySource(document.textDocument.getText(), render, entry))
  }
  const design = requireEditableSelectedDesign(document, files)
  if (request.landing.kind === 'size-token') {
    return await setSizeToken(document, design, render, request.entry, request.landing.tokenName)
  }
  if (request.landing.kind === 'style-bundle' && request.landing.mode === 'edit') {
    const bundleName = request.landing.bundleName
    requireIdentifier(bundleName, 'style bundle')
    const bundles = designSpecMembers(design).filter(bundle => bundle.name === bundleName)
    if (bundles.length !== 1) {
      throw new Errors.UserInputError(`Studio style bundle is not uniquely declared in this source file: ${bundleName}`)
    }
    return await Formatter.formatCode(
      setLayoutClauseEntrySource(document.textDocument.getText(), bundles[0]!.spec, entry),
    )
  }
  if (request.landing.kind === 'style-bundle') {
    return await forkStyleBundle(document, design, render, request.landing, entry)
  }
  if (request.landing.kind === 'element-default') {
    return await setElementDefault(document, design, render, request.landing.elementName, entry)
  }
  return await setColorToken(document, design, render, request.entry, request.landing.tokenName)
}

function selectedDesign(files: readonly AST.TaoFile[]): AST.DesignDeclaration | undefined {
  const selected = files.flatMap(file => [
    ...AST.streamAllContents(file).filter(AST.isAppProperty)
      .filter(property => property.name === 'Design')
      .flatMap(property => {
        const value = property.value
        const target = AST.isValueReference(value) ? value.target.ref : undefined
        return AST.isDesignDeclaration(target) ? [target] : []
      }),
  ])
  const uniqueSelected = [...new Set(selected)]
  if (uniqueSelected.length === 1) {
    return uniqueSelected[0]
  }
  const declarations = files.flatMap(file => [
    ...AST.streamAllContents(file).filter(AST.isDesignDeclaration),
  ])
  return declarations.length === 1 ? declarations[0] : undefined
}

function requireEditableSelectedDesign(
  document: AST.Document,
  files: readonly AST.TaoFile[],
): AST.DesignDeclaration {
  const design = selectedDesign(files)
  if (design === undefined) {
    throw new Errors.UserInputError('Studio design landing requires one uniquely selected design declaration.')
  }
  const ownerPath = AST.getDocument(design).uri.fsPath
  if (ownerPath !== document.uri.fsPath) {
    throw new Errors.UserInputError(
      `Studio cannot write imported design ${design.name} from this file; open its owning source file: ${ownerPath}`,
    )
  }
  return design
}

async function forkStyleBundle(
  document: AST.Document,
  design: AST.DesignDeclaration,
  render: AST.Render,
  landing: Extract<StudioStyleLandingScope, { kind: 'style-bundle' }>,
  entry: string,
): Promise<string> {
  requireIdentifier(landing.bundleName, 'style bundle')
  const bundles = designSpecMembers(design).filter(bundle => bundle.name === landing.bundleName)
  if (bundles.length !== 1) {
    throw new Errors.UserInputError(
      `Studio style bundle is not uniquely declared in this source file: ${landing.bundleName}`,
    )
  }
  const names = designValueNames(design)
  const forkName = landing.forkName === undefined
    ? uniqueDesignMemberName(`${landing.bundleName}Variant`, names)
    : landing.forkName
  requireIdentifier(forkName, 'forked style bundle')
  if (names.has(forkName)) {
    throw new Errors.UserInputError(`Studio design member already exists: ${forkName}`)
  }
  const source = document.textDocument.getText()
  const base = bundles[0]!
  const entries = base.spec.entries.map(candidate => candidate.$cstNode!.text)
  const slot = layoutEntrySlot(entry.split(/\s+/))
  const existingIndex = base.spec.entries.findLastIndex(candidate =>
    layoutEntrySlot(ASTUtils.layoutEntryValues(candidate)) === slot
  )
  if (existingIndex === -1) {
    entries.push(entry)
  } else {
    entries[existingIndex] = entry
  }
  const bundleReference = render.layoutClause?.entries.find(candidate => {
    const values = ASTUtils.layoutEntryValues(candidate)
    return values.length === 1 && values[0] === landing.bundleName
  })
  if (bundleReference?.$cstNode === undefined) {
    throw new Errors.UserInputError(`Selected render no longer applies style bundle ${landing.bundleName}.`)
  }
  const inlineExploration = render.layoutClause?.entries.findLast(candidate =>
    candidate !== bundleReference && layoutEntrySlot(ASTUtils.layoutEntryValues(candidate)) === slot
  )
  const content = applySourceEdits(source, [
    designSpecInsertionEdit(source, design, base, `${forkName} [${entries.join(', ')}]`),
    {
      end: bundleReference.$cstNode.end,
      replacement: forkName,
      start: bundleReference.$cstNode.offset,
    },
    ...(inlineExploration?.$cstNode === undefined
      ? []
      : [removeLayoutClauseEntryEdit(source, render, inlineExploration)]),
  ])
  return await Formatter.formatCode(content)
}

async function setElementDefault(
  document: AST.Document,
  design: AST.DesignDeclaration,
  render: AST.Render,
  elementName: string,
  entry: string,
): Promise<string> {
  requireIdentifier(elementName, 'element default')
  if (ASTUtils.standardDesignElementName(render) !== elementName) {
    throw new Errors.UserInputError(`Selected render is not the standard Tao element ${elementName}.`)
  }
  const source = document.textDocument.getText()
  const defaults = designSpecMembers(design).filter(bundle => bundle.name === elementName)
  if (defaults.length > 1) {
    throw new Errors.UserInputError(`Studio element default is not uniquely declared: ${elementName}`)
  }
  const designEdit = defaults[0] === undefined
    ? preferredStyleInsertionEdit(source, design, `${elementName} [${entry}]`)
    : setLayoutClauseEntryEdit(source, defaults[0].spec, entry)
  const exploration = requireRenderEntryByHead(render, layoutEntryHead(entry))
  const content = applySourceEdits(source, [designEdit, removeLayoutClauseEntryEdit(source, render, exploration)])
  return await Formatter.formatCode(content)
}

async function setColorToken(
  document: AST.Document,
  design: AST.DesignDeclaration,
  render: AST.Render,
  values: StudioStyleEntry,
  tokenName: string,
): Promise<string> {
  requireIdentifier(tokenName, 'color token')
  const [head, value, ...rest] = values
  if (!colorEntryHeads.has(head) || typeof value !== 'string' || !cssHexColor.test(value) || rest.length > 0) {
    throw new Errors.UserInputError(
      'Current Tao design tokens can only promote raw background, bg, border, fg, or ink colors.',
    )
  }
  const source = document.textDocument.getText()
  const colorBlocks = design.block.members.filter(AST.isDesignColorsBlock)
  if (colorBlocks.length > 0 || designUsesStructuredSurface(design)) {
    const entries = colorBlocks.flatMap(block => block.entries).filter(candidate => candidate.name === tokenName)
    if (entries.length > 1) {
      throw new Errors.UserInputError(`Studio color token is not uniquely declared: ${tokenName}`)
    }
    const tokenEdit = entries[0]?.$cstNode === undefined
      ? colorBlocks[0] === undefined
        ? designMemberInsertionEdit(source, design, `colors { ${tokenName} ${value} }`)
        : typedBlockEntryInsertionEdit(source, colorBlocks[0], `${tokenName} ${value}`)
      : {
        end: entries[0].$cstNode.end,
        replacement: `${tokenName} ${value}`,
        start: entries[0].$cstNode.offset,
      }
    const exploration = requireRenderEntryByHead(render, head)
    return await Formatter.formatCode(applySourceEdits(source, [
      tokenEdit,
      {
        end: exploration.$cstNode!.end,
        replacement: `${head} ${tokenName}`,
        start: exploration.$cstNode!.offset,
      },
    ]))
  }
  const tokens = design.block.members.filter(AST.isDesignToken).filter(token => token.name === tokenName)
  if (tokens.length > 1) {
    throw new Errors.UserInputError(`Studio color token is not uniquely declared: ${tokenName}`)
  }
  const tokenEdit = tokens[0]?.$cstNode === undefined
    ? designMemberInsertionEdit(source, design, `${tokenName} ${value}`)
    : {
      end: tokens[0].$cstNode.end,
      replacement: `${tokenName} ${value}`,
      start: tokens[0].$cstNode.offset,
    }
  const exploration = requireRenderEntryByHead(render, head)
  const content = applySourceEdits(source, [
    tokenEdit,
    {
      end: exploration.$cstNode!.end,
      replacement: `${head} ${tokenName}`,
      start: exploration.$cstNode!.offset,
    },
  ])
  return await Formatter.formatCode(content)
}

const sizeTokenHeads = new Set(['gap', 'height', 'line', 'margin', 'pad', 'radius', 'size', 'width'])

async function setSizeToken(
  document: AST.Document,
  design: AST.DesignDeclaration,
  render: AST.Render,
  values: StudioStyleEntry,
  tokenName: string,
): Promise<string> {
  requireIdentifier(tokenName, 'size token')
  const [head, ...terms] = values
  const numberIndices = terms.flatMap((term, index) => typeof term === 'number' ? [index] : [])
  if (!sizeTokenHeads.has(head) || numberIndices.length !== 1 || Number(terms[numberIndices[0]!]) <= 0) {
    throw new Errors.UserInputError(
      'Studio size promotion requires one positive numeric typography, spacing, radius, width, or height value.',
    )
  }
  const numericIndex = numberIndices[0]!
  const numericValue = terms[numericIndex] as number
  const source = document.textDocument.getText()
  const sizeBlocks = design.block.members.filter(AST.isDesignSizesBlock)
  const sizes = sizeBlocks.flatMap(block => block.entries).filter(candidate => candidate.name === tokenName)
  const conflicts = designValueNames(design)
  if (sizes.length > 1 || (sizes.length === 0 && conflicts.has(tokenName))) {
    throw new Errors.UserInputError(`Studio size token is not uniquely available: ${tokenName}`)
  }
  const sizeEdit = sizes[0]?.$cstNode === undefined
    ? sizeBlocks[0] === undefined
      ? designMemberInsertionEdit(source, design, `sizes { ${tokenName} ${numericValue}.px }`)
      : typedBlockEntryInsertionEdit(source, sizeBlocks[0], `${tokenName} ${numericValue}.px`)
    : {
      end: sizes[0].$cstNode.end,
      replacement: `${tokenName} ${numericValue}.px`,
      start: sizes[0].$cstNode.offset,
    }
  const exploration = requireRenderEntryByHead(render, head)
  const replacementTerms = [...terms]
  replacementTerms[numericIndex] = tokenName
  return await Formatter.formatCode(applySourceEdits(source, [
    sizeEdit,
    {
      end: exploration.$cstNode!.end,
      replacement: [head, ...replacementTerms].map(formatLayoutTermValue).join(' '),
      start: exploration.$cstNode!.offset,
    },
  ]))
}

function requireRenderEntryByHead(render: AST.Render, head: StudioLayoutTermValue): AST.LayoutEntry {
  const slot = layoutEntrySlot([head])
  const entry = render.layoutClause?.entries.findLast(candidate =>
    layoutEntrySlot(ASTUtils.layoutEntryValues(candidate)) === slot
  )
  if (entry?.$cstNode === undefined) {
    throw new Errors.UserInputError(`Selected render no longer has inline design exploration '${head}'.`)
  }
  return entry
}

function uniqueDesignMemberName(base: string, names: ReadonlySet<string>): string {
  if (!names.has(base)) {
    return base
  }
  let suffix = 2
  while (names.has(`${base}${suffix}`)) {
    suffix += 1
  }
  return `${base}${suffix}`
}

function designUsesStructuredSurface(design: AST.DesignDeclaration): boolean {
  return design.block.members.some(member =>
    AST.isDesignColorsBlock(member)
    || AST.isDesignSizesBlock(member)
    || AST.isDesignTextBlock(member)
    || AST.isDesignScreensBlock(member)
    || AST.isDesignStylesBlock(member)
  )
}

function designValueNames(design: AST.DesignDeclaration): Set<string> {
  const names = new Set<string>()
  for (const member of design.block.members) {
    if (AST.isDesignToken(member) || AST.isDesignBundle(member)) {
      names.add(member.name)
    } else if (AST.isDesignColorsBlock(member)) {
      for (const entry of member.entries) {
        names.add(entry.name)
        for (const family of entry.family?.members ?? []) {
          names.add(`${entry.name}.${family.name}`)
        }
      }
    } else if (AST.isDesignSizesBlock(member) || AST.isDesignTextBlock(member) || AST.isDesignStylesBlock(member)) {
      for (const entry of member.entries) {
        names.add(entry.name)
      }
    }
  }
  return names
}

function designSpecInsertionEdit(
  source: string,
  design: AST.DesignDeclaration,
  base: DesignSpecMember,
  entry: string,
): SourceEdit {
  if (AST.isDesignStyleEntry(base) && AST.isDesignStylesBlock(base.$container)) {
    return typedBlockEntryInsertionEdit(source, base.$container, entry)
  }
  if (AST.isDesignTextEntry(base) && AST.isDesignTextBlock(base.$container)) {
    return typedBlockEntryInsertionEdit(source, base.$container, entry)
  }
  return designMemberInsertionEdit(source, design, entry)
}

function preferredStyleInsertionEdit(source: string, design: AST.DesignDeclaration, entry: string): SourceEdit {
  const blocks = design.block.members.filter(AST.isDesignStylesBlock)
  if (blocks[0] !== undefined) {
    return typedBlockEntryInsertionEdit(source, blocks[0], entry)
  }
  return designUsesStructuredSurface(design)
    ? designMemberInsertionEdit(source, design, `styles { ${entry} }`)
    : designMemberInsertionEdit(source, design, entry)
}

function typedBlockEntryInsertionEdit(source: string, block: AST.Node, entry: string): SourceEdit {
  const cstNode = block.$cstNode
  if (cstNode === undefined) {
    throw new Errors.UserInputError('Cannot edit a structured design block without source coordinates.')
  }
  const closeBrace = source.lastIndexOf('}', cstNode.end - 1)
  const insertionOffset = closeBrace === -1 ? cstNode.end : closeBrace
  return { end: insertionOffset, replacement: `\n${entry}\n`, start: insertionOffset }
}

function designMemberInsertionEdit(source: string, design: AST.DesignDeclaration, member: string): SourceEdit {
  const cstNode = design.$cstNode
  if (cstNode === undefined) {
    throw new Errors.UserInputError('Cannot edit a design declaration without source coordinates.')
  }
  const closeBrace = source.lastIndexOf('}', cstNode.end - 1)
  const insertionOffset = closeBrace === -1 ? cstNode.end : closeBrace
  return { end: insertionOffset, replacement: `\n${member}\n`, start: insertionOffset }
}

function setLayoutClauseEntryEdit(source: string, layoutClause: AST.LayoutClause, entry: string): SourceEdit {
  const slot = layoutEntrySlot(entry.split(/\s+/))
  const existingEntry = layoutClause.entries.findLast(candidate =>
    layoutEntrySlot(ASTUtils.layoutEntryValues(candidate)) === slot
  )
  if (existingEntry?.$cstNode !== undefined) {
    return {
      end: existingEntry.$cstNode.end,
      replacement: entry,
      start: existingEntry.$cstNode.offset,
    }
  }
  const closeBracket = source.lastIndexOf(']', layoutClause.$cstNode!.end - 1)
  const insertionOffset = closeBracket === -1 ? layoutClause.$cstNode!.end : closeBracket
  return {
    end: insertionOffset,
    replacement: layoutClause.entries.length === 0 ? entry : `, ${entry}`,
    start: insertionOffset,
  }
}

function removeLayoutClauseEntryEdit(source: string, render: AST.Render, entry: AST.LayoutEntry): SourceEdit {
  const layoutClause = render.layoutClause!
  const entries = layoutClause.entries
  const index = entries.indexOf(entry)
  if (entries.length === 1) {
    let start = layoutClause.$cstNode!.offset
    while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) {
      start -= 1
    }
    return { end: layoutClause.$cstNode!.end, replacement: '', start }
  }
  if (index === entries.length - 1) {
    return { end: entry.$cstNode!.end, replacement: '', start: entries[index - 1]!.$cstNode!.end }
  }
  return { end: entries[index + 1]!.$cstNode!.offset, replacement: '', start: entry.$cstNode!.offset }
}

const colorEntryHeads = new Set<string>(ASTUtils.designColorHeads)
const cssHexColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/** Adds a validated structured Snap tree without rebuilding an existing snapped render tree. */
async function snapSketchToFlow(
  document: AST.Document,
  request: StudioSnapSketchToFlowPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  validateSnapRequest(request)
  const views = document.parseResult.value.statements.filter(AST.isViewDeclaration)
    .filter(view => view.name === request.viewName)
  const view = views.length === 1 ? views[0] : undefined
  if (view === undefined || view.visibility !== 'public' || view.block === undefined) {
    throw new Errors.UserInputError(`Studio Snap requires one generated public view: ${request.viewName}`)
  }
  const owners = document.parseResult.value.statements.filter(AST.isScenarioGroupDeclaration)
    .filter(group => group.name === 'sketch' && group.subject?.ref === view)
  if (owners.length !== 1) {
    throw new Errors.UserInputError(
      `Studio Snap view is not owned by one generated sketch scenario: ${request.viewName}`,
    )
  }
  const renders = view.block.statements.filter(AST.isRenderStatement)
  if (renders.length !== 1 || renders[0]?.$cstNode === undefined) {
    throw new Errors.UserInputError(`Studio Snap requires one direct render tree in ${request.viewName}.`)
  }
  const leafIds: string[] = []
  const components = new Set<string>()
  const nodeSource = snapNodeSource(request.tree, '', leafIds, components)
  if (leafIds.length !== request.rectIds.length || leafIds.some((id, index) => id !== request.rectIds[index])) {
    throw new Errors.UserInputError('Studio Snap rectangle identities do not match the structured tree.')
  }
  const source = document.textDocument.getText()
  const root = renders[0]!
  const rootCst = root.$cstNode!
  const existing = AST.streamAllContents(view).filter(AST.isRender)
    .filter(render => AST.attachedTag(render)?.tag.startsWith('#studio_rect_'))
  const requestedTags = new Set(request.rectIds.map(id => `#studio_rect_${encodedTag(id)}`))
  if (existing.some(render => requestedTags.has(AST.attachedTag(render)!.tag))) {
    throw new Errors.UserInputError('Studio Snap cannot add a rectangle that is already snapped.')
  }
  const edits: SourceEdit[] = []
  if (existing.length === 0) {
    const replacement = request.tree.type === 'element'
      ? nodeSource.replace('\n', '\nrender ')
      : `render ${nodeSource}`
    edits.push({ end: rootCst.end, replacement, start: rootCst.offset })
  } else if (root.block !== undefined && root.view?.$refText === request.mergeDirection) {
    const indentation = `${lineIndentAt(source, rootCst.offset)}   `
    if (request.mergePosition === 'before') {
      const offset = blockOpenBraceOffset(source, root.block)
      edits.push({
        end: offset,
        replacement: `\n${indentSnippet(nodeSource, indentation)}`,
        start: offset,
      })
    } else {
      const offset = blockCloseBraceOffset(source, root.block)
      edits.push({
        end: offset,
        replacement: `\n${indentSnippet(nodeSource, indentation)}`,
        start: offset,
      })
    }
  } else {
    const rootTag = AST.attachedTag(root)
    const rootStart = rootTag?.tag.startsWith('#studio_rect_') && rootTag.$cstNode !== undefined
      ? rootTag.$cstNode.offset
      : rootCst.offset
    const indentation = lineIndentAt(source, rootCst.offset)
    const childIndentation = `${indentation}   `
    const invocationSource = source.slice(rootCst.offset, rootCst.end)
      .replace(/^\s*render\s+/, '')
      .trim()
    const tagSource = rootStart === rootCst.offset
      ? ''
      : `${source.slice(rootStart, rootCst.offset).trim()}\n`
    const existingSource = `${tagSource}${invocationSource}`
    const children = request.mergePosition === 'before'
      ? `${indentSnippet(nodeSource, childIndentation)}\n${indentSnippet(existingSource, childIndentation)}`
      : `${indentSnippet(existingSource, childIndentation)}\n${indentSnippet(nodeSource, childIndentation)}`
    edits.push({
      end: rootCst.end,
      replacement: `render ${request.mergeDirection}() {\n${children}\n${indentation}}`,
      start: rootStart,
    })
  }
  const required = [...components].toSorted()
  const uses = document.parseResult.value.statements.filter(AST.isUseStatement)
  const uiUse = uses.find(statement => statement.importPath === '@tao/ui')
  const imported = new Set(uiUse?.importedDeclarations.map(reference => reference.$refText) ?? [])
  if (required.some(component => !imported.has(component))) {
    if (uiUse?.$cstNode !== undefined) {
      edits.push({
        end: uiUse.$cstNode.end,
        replacement: `use ${[...new Set([...imported, ...required])].toSorted().join(', ')} from @tao/ui`,
        start: uiUse.$cstNode.offset,
      })
    } else {
      const offset = document.parseResult.value.statements[0]?.$cstNode?.offset ?? 0
      edits.push({ end: offset, replacement: `use ${required.join(', ')} from @tao/ui\n\n`, start: offset })
    }
  }
  return await Formatter.formatCode(applySourceEdits(source, edits))
}

/** Removes only selected Studio-owned leaves, preserving the rest of the view and source file. */
async function unsnapSketchFromFlow(
  document: AST.Document,
  request: StudioUnsnapSketchFromFlowPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  validateUnsnapRequest(request)
  const file = document.parseResult.value
  const views = file.statements.filter(AST.isViewDeclaration).filter(view => view.name === request.viewName)
  const view = views.length === 1 ? views[0] : undefined
  if (view === undefined || view.visibility !== 'public' || view.block === undefined) {
    throw new Errors.UserInputError(`Studio Unsnap requires one generated public view: ${request.viewName}`)
  }
  const owners = file.statements.filter(AST.isScenarioGroupDeclaration)
    .filter(group => group.name === 'sketch' && group.subject?.ref === view)
  if (owners.length !== 1) {
    throw new Errors.UserInputError(
      `Studio Unsnap view is not owned by one generated sketch scenario: ${request.viewName}`,
    )
  }
  const roots = view.block.statements.filter(AST.isRenderStatement)
  const root = roots.length === 1 ? roots[0] : undefined
  if (root?.$cstNode === undefined) {
    throw new Errors.UserInputError(`Studio Unsnap requires one direct render tree in ${request.viewName}.`)
  }
  const selectedTags = new Map(request.rectIds.map(id => [`#studio_rect_${encodedTag(id)}`, id]))
  const marked = AST.streamAllContents(view).filter(AST.isRender)
    .map(render => ({ render, tag: AST.attachedTag(render) }))
    .filter(item => item.tag?.tag.startsWith('#studio_rect_'))
  const selected = marked.filter(item => selectedTags.has(item.tag!.tag))
  if (selected.length !== request.rectIds.length) {
    throw new Errors.UserInputError('Studio Unsnap could not find every selected rectangle in the current source.')
  }
  const source = document.textDocument.getText()
  const selectedRenders = new Set(selected.map(item => item.render))
  const survivingLeaves = AST.streamAllContents(view).filter(AST.isRender)
    .filter(render => render.block === undefined && !selectedRenders.has(render))
  if (survivingLeaves.length === 0) {
    const rootTag = AST.attachedTag(root)
    const start = rootTag?.tag.startsWith('#studio_rect_') && rootTag.$cstNode !== undefined
      ? rootTag.$cstNode.offset
      : root.$cstNode.offset
    const replacement = `render Placeholder(${
      taoStringLiteral(request.fallback.label)
    }) [width ${request.fallback.width}, height ${request.fallback.height}]`
    return await formatAndReparse(
      document,
      ensureUiComponentImport(
        applySourceEdits(source, [{ end: root.$cstNode.end, replacement, start }]),
        file,
        'Placeholder',
      ),
    )
  }
  const edits = selected.map(({ render }) => {
    if (!AST.isViewRender(render) || !AST.isBlock(render.$container)) {
      throw new Errors.UserInputError('Studio Unsnap can only remove a selected leaf inside the generated render tree.')
    }
    const slice = blockStatementSlices(source, render.$container).find(candidate => candidate.statement === render)
    if (slice === undefined) {
      throw new Errors.UserInputError('Studio Unsnap could not locate the selected leaf source.')
    }
    return { end: slice.end, replacement: '', start: slice.start }
  })
  return await formatAndReparse(document, applySourceEdits(source, edits))
}

function validateSnapRequest(request: StudioSnapSketchToFlowPatchRequest): void {
  requireExactKeys(
    request,
    [
      'expectedCatalogRevision',
      'kind',
      'mergeDirection',
      'mergePosition',
      'rectIds',
      'sketchId',
      'tree',
      'viewName',
    ],
    'Snap request',
  )
  if (!Number.isSafeInteger(request.expectedCatalogRevision) || request.expectedCatalogRevision < 0) {
    throw new Errors.UserInputError('Studio Snap catalog revision must be a nonnegative integer.')
  }
  if (
    typeof request.viewName !== 'string'
    || !/^View[1-9][0-9]*$/.test(request.viewName)
    || typeof request.sketchId !== 'string'
    || request.sketchId.length === 0
  ) {
    throw new Errors.UserInputError('Studio Snap requires a generated ViewN and sketch identity.')
  }
  if (request.mergeDirection !== 'Col' && request.mergeDirection !== 'Row') {
    throw new Errors.UserInputError('Studio Snap merge direction is invalid.')
  }
  if (request.mergePosition !== 'after' && request.mergePosition !== 'before') {
    throw new Errors.UserInputError('Studio Snap merge position is invalid.')
  }
  if (!Array.isArray(request.rectIds) || request.rectIds.some(id => typeof id !== 'string' || id.length === 0)) {
    throw new Errors.UserInputError('Studio Snap rectangle identities must be nonempty strings.')
  }
  validateSnapNode(request.tree, new Set(), 0)
}

function validateUnsnapRequest(request: StudioUnsnapSketchFromFlowPatchRequest): void {
  requireExactKeys(request, ['fallback', 'kind', 'rectIds', 'sketchId', 'viewName'], 'Unsnap request')
  if (!isObject(request.fallback)) {
    throw new Errors.UserInputError('Studio Unsnap fallback is invalid.')
  }
  requireExactKeys(request.fallback, ['height', 'label', 'width'], 'Unsnap fallback')
  if (
    typeof request.viewName !== 'string'
    || !/^View[1-9][0-9]*$/.test(request.viewName)
    || typeof request.sketchId !== 'string'
    || request.sketchId.length === 0
    || typeof request.fallback.label !== 'string'
    || request.fallback.label.length === 0
  ) {
    throw new Errors.UserInputError('Studio Unsnap requires a generated ViewN and sketch identity.')
  }
  if (
    !Array.isArray(request.rectIds)
    || request.rectIds.length === 0
    || request.rectIds.some(id => typeof id !== 'string' || id.length === 0)
    || new Set(request.rectIds).size !== request.rectIds.length
  ) {
    throw new Errors.UserInputError('Studio Unsnap rectangle identities must be unique nonempty strings.')
  }
  if (
    !Number.isFinite(request.fallback.width)
    || request.fallback.width <= 0
    || !Number.isFinite(request.fallback.height)
    || request.fallback.height <= 0
  ) {
    throw new Errors.UserInputError('Studio Unsnap fallback dimensions must be positive and finite.')
  }
}

function validateSnapNode(node: StudioSketchSnapTree, seen: Set<string>, depth: number): void {
  if (depth > 64 || !isObject(node)) {
    throw new Errors.UserInputError('Studio Snap tree is invalid or too deeply nested.')
  }
  if (node.type === 'container') {
    requireExactKeys(node, ['children', 'direction', 'layout', 'type'], 'Snap container')
    if (
      (node.direction !== 'Row' && node.direction !== 'Col') || !Array.isArray(node.children)
      || node.children.length === 0
    ) {
      throw new Errors.UserInputError('Studio Snap container direction and children are invalid.')
    }
    validateSnapLayout(node.layout, new Set(['gap', 'pad', 'claim']), 'container')
    node.children.forEach(child => validateSnapNode(child, seen, depth + 1))
    return
  }
  if (node.type !== 'element') {
    throw new Errors.UserInputError('Studio Snap node kind is invalid.')
  }
  requireExactKeys(node, ['arguments', 'component', 'content', 'layout', 'rectId', 'type'], 'Snap element')
  if (!['Image', 'Placeholder', 'Text'].includes(node.component)) {
    throw new Errors.UserInputError(`Studio Snap component is unsupported: ${String(node.component)}`)
  }
  if (!Array.isArray(node.arguments) || node.arguments.length !== 1 || typeof node.arguments[0] !== 'string') {
    throw new Errors.UserInputError('Studio Snap elements require one text argument.')
  }
  if (typeof node.rectId !== 'string' || node.rectId.length === 0 || seen.has(node.rectId)) {
    throw new Errors.UserInputError(`Studio Snap rectangle identity is invalid or duplicated: ${String(node.rectId)}`)
  }
  if (node.content !== undefined && typeof node.content !== 'string') {
    throw new Errors.UserInputError('Studio Snap element metadata must be text.')
  }
  seen.add(node.rectId)
  validateSnapLayout(node.layout, new Set(['width', 'height', 'hug', 'claim']), 'element')
}

function validateSnapLayout(layout: readonly StudioLayoutEntry[], allowed: ReadonlySet<string>, owner: string): void {
  if (!Array.isArray(layout)) {
    throw new Errors.UserInputError(`Studio Snap ${owner} layout must be an array.`)
  }
  const heads = new Set<string>()
  for (const raw of layout) {
    const entry = requireSupportedLayoutEntry(raw)
    const head = entry[0]
    if (!allowed.has(head) || heads.has(head)) {
      throw new Errors.UserInputError(`Studio Snap ${owner} layout entry is invalid or duplicated: ${head}`)
    }
    if (head === 'claim' && (entry.length !== 2 || entry[1] !== 1)) {
      throw new Errors.UserInputError('Studio Snap claim must be exactly 1.')
    }
    heads.add(head)
  }
}

function snapNodeSource(
  node: StudioSketchSnapTree,
  indentation: string,
  leafIds: string[],
  components: Set<string>,
): string {
  if (node.type === 'element') {
    leafIds.push(node.rectId)
    components.add(node.component)
    return `#studio_rect_${encodedTag(node.rectId)}\n${indentation}${node.component}(${
      node.arguments.map(taoStringLiteral).join(', ')
    })${snapLayoutSource(node.layout)}`
  }
  components.add(node.direction)
  const childIndent = `${indentation}   `
  const children = node.children.map(child =>
    `${childIndent}${snapNodeSource(child, childIndent, leafIds, components)}`
  )
    .join('\n')
  return `${node.direction}()${snapLayoutSource(node.layout)} {\n${children}\n${indentation}}`
}

function snapLayoutSource(layout: readonly StudioLayoutEntry[]): string {
  return layout.length === 0 ? '' : ` [${layout.map(formatLayoutEntry).join(', ')}]`
}

function encodedTag(value: string): string {
  let encoded = ''
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, '0')
  }
  return encoded
}

function requireExactKeys(value: object, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    throw new Errors.UserInputError(`${label} contains unsupported fields.`)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** wrapRender wraps a rendered node in a Studio-owned Stack() container. */
async function wrapRender(document: AST.Document, request: StudioWrapRenderPatchRequest): Promise<string> {
  assertNoSyntaxErrors(document)
  requireLocalRenderId(document, request.renderId, 'wrap renders')
  const render = requireRenderById(document.parseResult.value, request.renderId)
  return await Formatter.formatCode(wrapRenderSource(document.textDocument.getText(), render, request.wrapper))
}

/** moveRender moves a rendered source node between sibling render positions. */
async function moveRender(document: AST.Document, request: StudioMoveRenderRequest): Promise<string> {
  assertNoSyntaxErrors(document)
  requireLocalRenderId(document, request.draggedId, 'move render expressions')
  if (request.afterId === undefined && request.beforeId === undefined) {
    throw new Errors.UserInputError('A render move requires at least one drop-gap anchor.')
  }
  if (request.afterId !== undefined) {
    requireLocalRenderId(document, request.afterId, 'move render expressions')
  }
  if (request.beforeId !== undefined) {
    requireLocalRenderId(document, request.beforeId, 'move render expressions')
  }
  return await Formatter.formatCode(
    moveRenderSource(document.textDocument.getText(), document.parseResult.value, request),
  )
}

function validateInsertProjectViewRequest(request: StudioInsertProjectViewPatchRequest): void {
  requireExactKeys(request, ['afterId', 'beforeId', 'bindings', 'kind', 'viewName'], 'Insert project view request')
  requireIdentifier(request.viewName, 'project view')
  if (request.bindings === undefined) {
    return
  }
  if (!isObject(request.bindings)) {
    throw new Errors.UserInputError('Studio project-view lexical bindings must be an object.')
  }
  for (const [parameterName, valueName] of Object.entries(request.bindings)) {
    requireIdentifier(parameterName, 'project-view parameter')
    if (typeof valueName !== 'string') {
      throw new Errors.UserInputError(`Studio lexical binding for ${parameterName} must name a value.`)
    }
    requireIdentifier(valueName, 'lexical binding')
  }
}

function requireInsertableProjectView(
  file: AST.TaoFile,
  viewName: string,
  targetViewName: string | undefined,
): AST.ViewDeclaration {
  const views = file.statements.filter(AST.isViewDeclaration).filter(candidate => candidate.name === viewName)
  const view = views.length === 1 ? views[0] : undefined
  if (view === undefined) {
    throw new Errors.UserInputError(
      views.length === 0
        ? `Project view is not declared in this source file: ${viewName}`
        : `Project view is not uniquely declared in this source file: ${viewName}`,
    )
  }
  if (viewName === targetViewName) {
    throw new Errors.UserInputError(`Cannot insert project view ${viewName} into its own render block.`)
  }
  return view
}

type StudioLexicalValue =
  | AST.ParameterDeclaration
  | AST.ForStatement
  | ReturnType<typeof AST.valueDeclarationsOwnedByBlock>[number]

function visibleInsertionValues(block: AST.Block, insertionOffset: number): ReadonlyMap<string, StudioLexicalValue> {
  const values = new Map<string, StudioLexicalValue>()
  const blocks = [block, ...AST.ancestorBlocks(block)]
  for (const candidateBlock of blocks) {
    const local = AST.valueDeclarationsOwnedByBlock(candidateBlock)
      .filter(declaration => (declaration.$cstNode?.offset ?? Number.MAX_SAFE_INTEGER) < insertionOffset)
      .toSorted((left, right) => (right.$cstNode?.offset ?? 0) - (left.$cstNode?.offset ?? 0))
    for (const declaration of local) {
      addVisibleInsertionValue(values, declaration)
    }
    const loop = AST.forBindingOwnedByBlock(candidateBlock)
    if (loop !== undefined) {
      addVisibleInsertionValue(values, loop)
    }
  }
  const owner = AST.findOwningView(block)
  for (const parameter of owner === undefined ? [] : AST.parametersOf(owner)) {
    addVisibleInsertionValue(values, parameter)
  }
  return values
}

function addVisibleInsertionValue(values: Map<string, StudioLexicalValue>, declaration: StudioLexicalValue): void {
  const name = Type.declarationName(declaration)
  if (!values.has(name)) {
    values.set(name, declaration)
  }
}

function projectViewArguments(
  view: AST.ViewDeclaration,
  visible: ReadonlyMap<string, StudioLexicalValue>,
  requested: Readonly<Record<string, string>>,
): string {
  const parameters = AST.parametersOf(view)
  const parametersByName = new Map(parameters.map(parameter => [Type.parameterName(parameter), parameter]))
  const bindings = new Map<string, string>()
  for (const [parameterName, valueName] of Object.entries(requested)) {
    const parameter = parametersByName.get(parameterName)
    if (parameter === undefined) {
      throw new Errors.UserInputError(`Project view ${view.name} has no parameter named ${parameterName}.`)
    }
    const value = visible.get(valueName)
    if (value === undefined) {
      throw new Errors.UserInputError(`Lexical value ${valueName} is not visible at the project-view insertion gap.`)
    }
    if (!typesExactlyMatch(parameter, value)) {
      throw new Errors.UserInputError(
        `Lexical value ${valueName} does not exactly match project-view parameter ${parameterName}.`,
      )
    }
    bindings.set(parameterName, valueName)
  }

  const required = parameters.filter(parameter =>
    parameter.defaultValue === undefined && !bindings.has(Type.parameterName(parameter))
  )
  const unresolved: string[] = []
  const ambiguous: string[] = []
  const requiredTypeCounts = new Map<string, number>()
  for (const parameter of required) {
    const key = Type.identityKey(Type.ofParameter(parameter))
    if (key !== undefined) {
      requiredTypeCounts.set(key, (requiredTypeCounts.get(key) ?? 0) + 1)
    }
  }
  for (const parameter of required) {
    const parameterName = Type.parameterName(parameter)
    const key = Type.identityKey(Type.ofParameter(parameter))
    if (key === undefined) {
      unresolved.push(parameterName)
      continue
    }
    const candidates = [...visible.entries()].filter(([, value]) =>
      Type.identityKey(Type.ofValueDeclaration(value)) === key
    )
    if (candidates.length === 0) {
      unresolved.push(parameterName)
    } else if (candidates.length > 1 || (requiredTypeCounts.get(key) ?? 0) > 1) {
      ambiguous.push(parameterName)
    } else {
      bindings.set(parameterName, candidates[0]![0])
    }
  }
  if (unresolved.length > 0 || ambiguous.length > 0) {
    const details = [
      ...(unresolved.length === 0 ? [] : [`unresolved required parameters: ${unresolved.join(', ')}`]),
      ...(ambiguous.length === 0 ? [] : [`ambiguous required parameters: ${ambiguous.join(', ')}`]),
    ].join('; ')
    throw new Errors.UserInputError(`Cannot insert parameterized project view ${view.name}; ${details}.`)
  }
  return parameters.flatMap(parameter => {
    const parameterName = Type.parameterName(parameter)
    const valueName = bindings.get(parameterName)
    return valueName === undefined ? [] : [`${parameterName}: ${valueName}`]
  }).join(', ')
}

function typesExactlyMatch(parameter: AST.ParameterDeclaration, value: StudioLexicalValue): boolean {
  const expected = Type.identityKey(Type.ofParameter(parameter))
  return expected !== undefined && expected === Type.identityKey(Type.ofValueDeclaration(value))
}

const studioComponentSnippets: Readonly<Record<StudioComponentKind, string>> = {
  Box: 'Box() {\n   Text("New box")\n}',
  Button: 'Button("New button") {\n   on press -> { }\n}',
  Checkbox: 'Checkbox(Value: false, Label: "Checkbox") {\n   on change -> Value { }\n}',
  Col: 'Col() [gap 8] {\n   Text("New column")\n}',
  DatePicker: 'DatePicker(Value: now, Label: "Date") {\n   on change -> Value { }\n}',
  FormButton: 'FormButton("Save") {\n   on press -> { }\n}',
  Image: 'Image("image-url", Label: "Image")',
  Number: 'Number(0)',
  Panes: 'Panes() {\n   Text("New pane")\n}',
  Picker: 'Picker(Value: "First", Options: ["First", "Second"], Label: "Picker") {\n   on change -> Value { }\n}',
  Placeholder: 'Placeholder("Unfinished content") [width 120, height 80]',
  Progress: 'Progress(0)',
  Row: 'Row() [gap 8] {\n   Text("New row")\n}',
  ScrollView: 'ScrollView() {\n   Text("Scrollable content")\n}',
  SegmentedControl:
    'SegmentedControl(Value: "First", Options: ["First", "Second"], Label: "Options") {\n   on change -> Value { }\n}',
  Slider: 'Slider(Value: 0, Label: "Slider") {\n   on change -> Value { }\n}',
  Spinner: 'Spinner()',
  Spacer: 'Spacer()',
  Stack: 'Stack() [gap 8, pad 8] {\n   Text("Nested text")\n}',
  Switch: 'Switch(Value: false, Label: "Switch") {\n   on change -> Value { }\n}',
  Text: 'Text("New text")',
  TextFrame: 'TextFrame("New text")',
  TextInput: 'TextInput(Value: "", Label: "Text field") {\n   on change -> Value { }\n   on submit -> { }\n}',
  TextMultiline: 'TextMultiline("New text")',
  WrappingRow: 'WrappingRow() [gap 8] {\n   Text("New item")\n}',
}
const studioComponentKinds = new Set<StudioComponentKind>(Object.keys(studioComponentSnippets) as StudioComponentKind[])

function ensureUiComponentImport(source: string, file: AST.TaoFile, component: StudioComponentKind): string {
  const uses = file.statements.filter(AST.isUseStatement)
  const required = [
    ...new Set(studioComponentSnippets[component].includes('Text(') ? [component, 'Text'] : [component]),
  ]
  const imported = new Set(uses.flatMap(statement =>
    statement.importPath === '@tao/ui'
      ? statement.importedDeclarations.map(reference => reference.$refText)
      : []
  ))
  if (required.every(name => imported.has(name))) {
    return source
  }
  const uiUse = uses.find(statement => statement.importPath === '@tao/ui')
  if (uiUse?.$cstNode !== undefined) {
    const names = new Set(uiUse.importedDeclarations.map(reference => reference.$refText))
    for (const name of required) {
      names.add(name)
    }
    return applySourceEdits(source, [{
      end: uiUse.$cstNode.end,
      replacement: `use ${[...names].toSorted().join(', ')} from @tao/ui`,
      start: uiUse.$cstNode.offset,
    }])
  }
  const insertionOffset = file.statements[0]?.$cstNode?.offset ?? 0
  return applySourceEdits(source, [{
    end: insertionOffset,
    replacement: `use ${required.join(', ')} from @tao/ui\n\n`,
    start: insertionOffset,
  }])
}

function fullDocumentEdit(source: string, content: string): readonly StudioSourceTextEdit[] {
  return source === content
    ? []
    : [{
      end: source.length,
      replacement: content,
      start: 0,
    }]
}

type RenderId = {
  end: number
  sourcePath: string
  start: number
}

function parseRenderId(value: string): RenderId {
  const endSeparator = value.lastIndexOf(':')
  const startSeparator = value.lastIndexOf(':', endSeparator - 1)
  const sourcePath = value.slice(0, startSeparator)
  const start = Number(value.slice(startSeparator + 1, endSeparator))
  const end = Number(value.slice(endSeparator + 1))
  if (
    sourcePath === ''
    || !Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 0
    || end < start
  ) {
    throw new Errors.UserInputError(`Invalid render id: ${value}`)
  }
  return { end, sourcePath, start }
}

function requireLocalRenderId(document: AST.Document, value: string, operation: string): RenderId {
  const renderId = parseRenderId(value)
  if (renderId.sourcePath !== document.uri.fsPath) {
    throw new Errors.UserInputError(`Can only ${operation} inside the edited Tao source file.`)
  }
  return renderId
}

function moveRenderSource(source: string, file: AST.TaoFile, request: StudioMoveRenderRequest): string {
  const dragged = requireRenderById(file, request.draggedId)
  const after = request.afterId === undefined ? undefined : requireRenderById(file, request.afterId)
  const before = request.beforeId === undefined ? undefined : requireRenderById(file, request.beforeId)
  const owner = AST.findOwningView(dragged)
  if (
    owner === undefined
    || (after !== undefined && AST.findOwningView(after) !== owner)
    || (before !== undefined && AST.findOwningView(before) !== owner)
  ) {
    throw new Errors.UserInputError('Can only move between render expressions in the same view definition.')
  }
  const draggedStatement = directViewRenderStatement(dragged)
  const afterStatement = after === undefined ? undefined : directViewRenderStatement(after)
  const beforeStatement = before === undefined ? undefined : directViewRenderStatement(before)
  const targetStatement = afterStatement ?? beforeStatement
  if (
    draggedStatement === undefined
    || targetStatement === undefined
    || !AST.isBlock(draggedStatement.$container)
    || !AST.isBlock(targetStatement.$container)
    || (afterStatement !== undefined && afterStatement.$container !== targetStatement.$container)
    || (beforeStatement !== undefined && beforeStatement.$container !== targetStatement.$container)
  ) {
    throw new Errors.UserInputError('Can only move direct child view renders between render blocks.')
  }
  return moveRenderBetweenBlocksSource(source, draggedStatement.$container, targetStatement.$container, request)
}

function directViewRenderStatement(render: AST.Render): AST.ViewRender | undefined {
  return AST.isViewRender(render) && AST.isBlock(render.$container) ? render : undefined
}

function requireRenderById(file: AST.TaoFile, id: string): AST.Render {
  const render = AST.streamAllContents(file)
    .filter(AST.isRender)
    .find(candidate => renderIdFor(candidate) === id)
  if (render === undefined) {
    throw new Errors.UserInputError(`Render expression no longer exists: ${id}`)
  }
  return render
}

function setRenderLayoutEntrySource(source: string, render: AST.Render, entry: string): string {
  return applySourceEdits(source, setRenderLayoutEntryEdits(source, render, entry))
}

function setRenderLayoutEntryEdits(source: string, render: AST.Render, entry: string): readonly SourceEdit[] {
  const layoutClause = render.layoutClause
  if (layoutClause === undefined) {
    const insertionOffset = renderLayoutInsertionOffset(render)
    return [{
      end: insertionOffset,
      replacement: ` [${entry}]`,
      start: insertionOffset,
    }]
  }
  return setLayoutClauseEntryEdits(source, layoutClause, entry)
}

function setLayoutClauseEntrySource(source: string, layoutClause: AST.LayoutClause, entry: string): string {
  return applySourceEdits(source, setLayoutClauseEntryEdits(source, layoutClause, entry))
}

function setLayoutClauseEntryEdits(
  source: string,
  layoutClause: AST.LayoutClause,
  entry: string,
): readonly SourceEdit[] {
  const slot = layoutEntrySlot(entry.split(/\s+/))
  const existingIndex = layoutClause.entries.findLastIndex(candidate =>
    layoutEntrySlot(ASTUtils.layoutEntryValues(candidate)) === slot
  )
  const existingEntry = layoutClause.entries[existingIndex]
  if (existingEntry !== undefined) {
    if (existingIndex < layoutClause.entries.length - 1) {
      const nextEntry = layoutClause.entries[existingIndex + 1]!
      const closeBracket = source.lastIndexOf(']', layoutClause.$cstNode!.end - 1)
      const insertionOffset = closeBracket === -1 ? layoutClause.$cstNode!.end : closeBracket
      return [{
        end: nextEntry.$cstNode!.offset,
        replacement: '',
        start: existingEntry.$cstNode!.offset,
      }, {
        end: insertionOffset,
        replacement: `, ${entry}`,
        start: insertionOffset,
      }]
    }
    return [{
      end: existingEntry.$cstNode!.end,
      replacement: entry,
      start: existingEntry.$cstNode!.offset,
    }]
  }
  const closeBracket = source.lastIndexOf(']', layoutClause.$cstNode!.end - 1)
  const insertionOffset = closeBracket === -1 ? layoutClause.$cstNode!.end : closeBracket
  return [{
    end: insertionOffset,
    replacement: layoutClause.entries.length === 0 ? entry : `, ${entry}`,
    start: insertionOffset,
  }]
}

function layoutEntrySlot(values: readonly StudioLayoutTermValue[]): string {
  const head = String(values[0])
  if ((ASTUtils.designVisualHeads as readonly string[]).includes(head)) {
    return `visual:${ASTUtils.canonicalDesignVisualHead(head)}`
  }
  // LayoutValidator currently grants the independent maximum slot only to `width max`.
  // Extend this alongside that validator when another dimension gains a maximum constraint.
  return head === 'width' && values[1] === 'max' ? 'width:max' : head
}

function formatStyleEntry(entry: StudioStyleEntry): string {
  if (!Array.isArray(entry) || entry.length === 0 || typeof entry[0] !== 'string') {
    throw new Errors.UserInputError(`Invalid Studio style entry: ${formatLayoutValues(entry)}`)
  }
  const values = entry as readonly StudioLayoutTermValue[]
  if (isStudioLayoutEntry(values)) {
    throw new Errors.UserInputError(`Studio style entry targets a layout clause: ${formatLayoutValues(entry)}`)
  }
  return values.map(formatLayoutTermValue).join(' ')
}

function formatDesignEntry(entry: StudioStyleEntry): string {
  if (!Array.isArray(entry) || entry.length === 0 || typeof entry[0] !== 'string') {
    throw new Errors.UserInputError(`Invalid Studio design entry: ${formatLayoutValues(entry)}`)
  }
  return (entry as readonly StudioLayoutTermValue[]).map(formatLayoutTermValue).join(' ')
}

const studioLayoutHeads = new Set([
  'aligned',
  'centered',
  'claim',
  'compress',
  'content',
  'fill',
  'gap',
  'height',
  'hug',
  'margin',
  'pad',
  'rigid',
  'width',
])
const studioVisualHeads = new Set<string>(ASTUtils.designVisualHeads)

function isStudioLayoutEntry(entry: readonly StudioLayoutTermValue[]): boolean {
  return typeof entry[0] === 'string' && studioLayoutHeads.has(entry[0])
}

function isInlineDesignExploration(entry: readonly StudioLayoutTermValue[]): boolean {
  if (isStudioLayoutEntry(entry)) {
    return true
  }
  return typeof entry[0] === 'string' && studioVisualHeads.has(entry[0]) && entry.length === 2
    && (typeof entry[1] === 'number'
      || (typeof entry[1] === 'string' && entry[1].startsWith('#')))
}

function renderLayoutInsertionOffset(render: AST.Render): number {
  return render.block?.$cstNode?.offset ?? render.$cstNode!.end
}

function wrapRenderSource(source: string, render: AST.Render, wrapper: 'Stack'): string {
  const cstNode = render.$cstNode
  if (cstNode === undefined) {
    throw new Errors.UserInputError('Cannot wrap a render without source coordinates.')
  }
  const indent = lineIndentAt(source, cstNode.offset)
  const childIndent = `${indent}   `
  if (AST.isRenderStatement(render) && render.injection !== undefined) {
    throw new Errors.UserInputError('Cannot wrap an injected root render.')
  }
  const selectedSource = source.slice(cstNode.offset, cstNode.end).trimEnd()
  const childSource = AST.isRenderStatement(render)
    ? selectedSource.replace(/^render\s+/, '')
    : selectedSource
  const rootPrefix = AST.isRenderStatement(render) ? 'render ' : ''
  return applySourceEdits(source, [{
    end: cstNode.end,
    replacement: `${rootPrefix}${wrapper}() [gap 8, pad 8] {\n${indentSnippet(childSource, childIndent)}\n${indent}}`,
    start: cstNode.offset,
  }])
}

function layoutEntryHead(entry: string): StudioLayoutTermValue {
  const head = entry.split(/\s+/, 1)[0]
  if (head === undefined || head === '') {
    throw new Errors.UserInputError('Layout entry must have a head term.')
  }
  return head
}

function formatLayoutEntry(values: StudioLayoutEntry): string {
  if (values.length === 0) {
    throw new Errors.UserInputError('Layout entry cannot be empty.')
  }
  return values.map(formatLayoutTermValue).join(' ')
}

function requireSupportedLayoutEntry(values: StudioLayoutEntry): StudioLayoutEntry {
  if (!Array.isArray(values) || values.length === 0 || typeof values[0] !== 'string') {
    throw invalidLayoutEntry(values)
  }
  const head = values[0]
  if (bareLayoutHeads.has(head)) {
    if (values.length !== 1) {
      throw invalidLayoutEntry(values)
    }
    return values
  }
  if (head === 'claim') {
    requirePositiveLayoutNumber(values, 1, 2)
    return values
  }
  if (head === 'gap') {
    requirePositiveLayoutSize(values, 1, 2)
    return values
  }
  if (head === 'aligned') {
    if (values.length !== 2 || typeof values[1] !== 'string' || !alignmentTerms.has(values[1])) {
      throw invalidLayoutEntry(values)
    }
    return values
  }
  if (head === 'content') {
    requireContentLayoutEntry(values)
    return values
  }
  if (head === 'width' || head === 'height') {
    requireDimensionLayoutEntry(values, head)
    return values
  }
  if (head === 'margin' || head === 'pad') {
    requireSpacingLayoutEntry(values)
    return values
  }
  throw new Errors.UserInputError(`Unsupported Studio layout entry: ${formatLayoutValues(values)}`)
}

const alignmentTerms = new Set<StudioLayoutAlignment>(['baseline', 'bottom', 'center', 'left', 'right', 'top'])
const contentTerms = new Set<StudioLayoutContentTerm>([
  ...alignmentTerms,
  'spread',
  'spread-balanced',
  'spread-inset',
  'stretch',
])
const spacingSides = new Set<StudioLayoutSpacingSide>([
  'bottom',
  'horizontal',
  'left',
  'right',
  'top',
  'vertical',
])
const bareLayoutHeads = new Set(['centered', 'compress', 'fill', 'hug', 'rigid'])

function requireContentLayoutEntry(values: readonly StudioLayoutTermValue[]): void {
  const terms = values.slice(1)
  if (
    (terms.length !== 1 && terms.length !== 2)
    || terms.some(term => typeof term !== 'string' || !contentTerms.has(term as StudioLayoutContentTerm))
  ) {
    throw invalidLayoutEntry(values)
  }
  const slots = new Set<string>()
  for (const term of terms as StudioLayoutContentTerm[]) {
    const slot = contentTermSlot(term)
    if (slots.has(slot)) {
      throw invalidLayoutEntry(values)
    }
    slots.add(slot)
  }
}

function contentTermSlot(term: StudioLayoutContentTerm): string {
  if (term === 'left' || term === 'right') {
    return 'horizontal'
  }
  if (term === 'top' || term === 'bottom') {
    return 'vertical'
  }
  if (term === 'baseline' || term === 'stretch') {
    return 'cross-alignment'
  }
  if (term === 'spread' || term === 'spread-balanced' || term === 'spread-inset') {
    return 'main-distribution'
  }
  return 'center'
}

function requireDimensionLayoutEntry(values: readonly StudioLayoutTermValue[], head: 'height' | 'width'): void {
  if (values.length === 2 && values[1] === 'fill') {
    return
  }
  if (values.length === 2) {
    requirePositiveLayoutSize(values, 1, 2)
    return
  }
  if (head === 'width' && values.length === 3 && values[1] === 'max') {
    requirePositiveLayoutSize(values, 2, 3)
    return
  }
  throw invalidLayoutEntry(values)
}

function requireSpacingLayoutEntry(values: readonly StudioLayoutTermValue[]): void {
  if (values.length === 2) {
    requirePositiveLayoutSize(values, 1, 2)
    return
  }
  if (values.length < 3 || values.length > 9 || values.length % 2 === 0) {
    throw invalidLayoutEntry(values)
  }
  const physicalSides = new Set<string>()
  for (let index = 1; index < values.length; index += 2) {
    const side = values[index]
    if (typeof side !== 'string' || !spacingSides.has(side as StudioLayoutSpacingSide)) {
      throw invalidLayoutEntry(values)
    }
    requirePositiveLayoutSize(values, index + 1, values.length)
    for (const physicalSide of spacingPhysicalSides(side as StudioLayoutSpacingSide)) {
      if (physicalSides.has(physicalSide)) {
        throw invalidLayoutEntry(values)
      }
      physicalSides.add(physicalSide)
    }
  }
}

function spacingPhysicalSides(side: StudioLayoutSpacingSide): readonly string[] {
  if (side === 'horizontal') {
    return ['left', 'right']
  }
  if (side === 'vertical') {
    return ['top', 'bottom']
  }
  return [side]
}

function requirePositiveLayoutNumber(
  values: readonly StudioLayoutTermValue[],
  index: number,
  expectedLength: number,
): void {
  const value = values[index]
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Errors.UserInputError('Layout number must be finite.')
  }
  if (values.length !== expectedLength || typeof value !== 'number' || value <= 0) {
    throw invalidLayoutEntry(values)
  }
}

function requirePositiveLayoutSize(
  values: readonly StudioLayoutTermValue[],
  index: number,
  expectedLength: number,
): void {
  const value = values[index]
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Errors.UserInputError('Layout number must be finite.')
  }
  if (values.length !== expectedLength || !isPositiveLayoutSize(value)) {
    throw invalidLayoutEntry(values)
  }
}

function isPositiveLayoutSize(value: StudioLayoutTermValue | undefined): boolean {
  return typeof value === 'number'
    ? Number.isFinite(value) && value > 0
    : typeof value === 'string' && designValuePath.test(value)
}

function invalidLayoutEntry(values: unknown): Errors.UserInputError {
  return new Errors.UserInputError(`Invalid Studio layout entry: ${formatLayoutValues(values)}`)
}

function formatLayoutValues(values: unknown): string {
  return Array.isArray(values) ? values.map(String).join(' ') : String(values)
}

function requireCompatibleLayoutEntry(render: AST.Render, nextHead: StudioLayoutTermValue): void {
  const entries = render.layoutClause?.entries ?? []
  const heads = entries.map(entry => String(ASTUtils.layoutEntryValues(entry)[0]))
  const replacementIndex = heads.findLastIndex(head => head === nextHead)
  if (replacementIndex === -1) {
    heads.push(String(nextHead))
  } else {
    heads[replacementIndex] = String(nextHead)
  }
  const growth = heads.findLast(head => head === 'claim' || head === 'fill' || head === 'hug')
  const shrink = heads.findLast(head => head === 'compress' || head === 'rigid')
  if (growth === 'claim' && shrink === 'rigid') {
    throw new Errors.UserInputError("Studio layout action would leave incompatible 'claim' and 'rigid' entries.")
  }
}

function formatLayoutTermValue(value: StudioLayoutTermValue): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Errors.UserInputError('Layout number must be finite.')
    }
    return String(value)
  }
  if (/^[A-Za-z_]\w*(?:-[A-Za-z_]\w*)*$/.test(value) || designValuePath.test(value)) {
    return value
  }
  if (cssHexColor.test(value)) {
    return value
  }
  throw new Errors.UserInputError(`Invalid layout word: ${value}`)
}

const designValuePath = /^[A-Za-z_]\w*(?:\.(?:[A-Za-z_]\w*|\d+))*$/

function renderIdFor(render: AST.Render): string {
  const document = AST.getDocument(render)
  const cstNode = render.$cstNode
  return `${document.uri.fsPath}:${cstNode?.offset ?? 0}:${cstNode?.end ?? 0}`
}

function moveRenderBetweenBlocksSource(
  source: string,
  draggedBlock: AST.Block,
  targetBlock: AST.Block,
  request: StudioMoveRenderRequest,
): string {
  const draggedSlices = blockStatementSlices(source, draggedBlock)
  const targetSlices = draggedBlock === targetBlock ? draggedSlices : blockStatementSlices(source, targetBlock)
  const draggedIndex = renderStatementIndex(draggedSlices, request.draggedId)
  if (draggedIndex === -1) {
    throw new Errors.UserInputError('Dragged render is not a direct block statement.')
  }
  const draggedSlice = draggedSlices[draggedIndex]!
  if (draggedBlock === targetBlock) {
    return moveRenderInsideBlockSource(source, draggedBlock, draggedSlices, draggedIndex, request)
  }
  if (sliceContainsBlock(draggedSlice, targetBlock)) {
    throw new Errors.UserInputError('Cannot move a render expression into its own contents.')
  }
  const removeEdit = removeStatementEdit(source, draggedBlock, draggedSlices, draggedIndex)
  const insertEdit = insertStatementEdit(source, targetBlock, targetSlices, draggedSlice.source, request)
  if (sourceEditsOverlap(removeEdit, insertEdit)) {
    throw new Errors.UserInputError('Cannot move render expressions across overlapping block edits.')
  }
  return applySourceEdits(source, [removeEdit, insertEdit])
}

function moveRenderInsideBlockSource(
  source: string,
  block: AST.Block,
  slices: BlockStatementSlice[],
  draggedIndex: number,
  request: StudioMoveRenderRequest,
): string {
  const draggedSlice = slices[draggedIndex]!
  const remaining = slices.filter((_, index) => index !== draggedIndex)
  const beforeIndex = requireOrderedTargetIndex(remaining, request)
  remaining.splice(beforeIndex, 0, draggedSlice)
  return applySourceEdits(source, [replaceBlockStatementsEdit(source, block, slices, remaining)])
}

function removeStatementEdit(
  source: string,
  block: AST.Block,
  slices: BlockStatementSlice[],
  draggedIndex: number,
): SourceEdit {
  return replaceBlockStatementsEdit(source, block, slices, slices.filter((_, index) => index !== draggedIndex))
}

function insertStatementEdit(
  source: string,
  block: AST.Block,
  slices: BlockStatementSlice[],
  draggedSource: string,
  request: StudioMoveRenderRequest,
): SourceEdit {
  const insertIndex = requireOrderedTargetIndex(slices, request)
  const next = [...slices]
  const targetSlice = slices[insertIndex] ?? slices[slices.length - 1]
  const insertionOffset = targetSlice === undefined
    ? blockCloseBraceOffset(source, block)
    : insertIndex === slices.length
    ? targetSlice.end
    : targetSlice.start
  next.splice(insertIndex, 0, {
    end: insertionOffset,
    source: draggedSource,
    start: insertionOffset,
    statement: targetSlice?.statement ?? throwEmptyMoveTarget(),
  })
  return replaceBlockStatementsEdit(source, block, slices, next)
}

function requireOrderedTargetIndex(slices: BlockStatementSlice[], request: StudioMoveRenderRequest): number {
  const afterIndex = request.afterId === undefined ? undefined : renderStatementIndex(slices, request.afterId)
  const beforeIndex = request.beforeId === undefined ? undefined : renderStatementIndex(slices, request.beforeId)
  if (afterIndex === -1 || beforeIndex === -1) {
    throw new Errors.UserInputError('Drop target is no longer between the requested render expressions.')
  }
  if (afterIndex !== undefined && beforeIndex !== undefined) {
    if (beforeIndex !== afterIndex + 1) {
      throw new Errors.UserInputError('Drop-gap anchors are no longer adjacent render expressions.')
    }
    return beforeIndex
  }
  if (beforeIndex !== undefined) {
    if (beforeIndex !== 0) {
      throw new Errors.UserInputError('A before-only drop anchor must be the first render expression.')
    }
    return 0
  }
  if (afterIndex !== undefined) {
    if (afterIndex !== slices.length - 1) {
      throw new Errors.UserInputError('An after-only drop anchor must be the last render expression.')
    }
    return slices.length
  }
  throw new Errors.UserInputError('A render move requires at least one drop-gap anchor.')
}

function throwEmptyMoveTarget(): never {
  throw new Errors.UserInputError('Cannot move a render into an empty target block without an anchor.')
}

function replaceBlockStatementsEdit(
  source: string,
  block: AST.Block,
  oldSlices: BlockStatementSlice[],
  nextSlices: BlockStatementSlice[],
): SourceEdit {
  const start = oldSlices[0]?.start ?? blockCloseBraceOffset(source, block)
  return {
    end: blockCloseBraceOffset(source, block),
    replacement: nextSlices.map(slice => slice.source).join(''),
    start,
  }
}

function applySourceEdits(source: string, edits: readonly SourceEdit[]): string {
  return edits.toSorted((left, right) => right.start - left.start)
    .reduce(
      (nextSource, edit) => `${nextSource.slice(0, edit.start)}${edit.replacement}${nextSource.slice(edit.end)}`,
      source,
    )
}

function sourceEditsOverlap(left: SourceEdit, right: SourceEdit): boolean {
  return left.start < right.end && right.start < left.end
}

function renderStatementIndex(slices: readonly BlockStatementSlice[], renderId: string): number {
  return slices.findIndex(slice => statementContainsRenderId(slice.statement, renderId))
}

function sliceContainsBlock(slice: BlockStatementSlice, block: AST.Block): boolean {
  const cstNode = block.$cstNode
  return cstNode !== undefined && slice.start <= cstNode.offset && cstNode.end <= slice.end
}

type BlockStatementSlice = {
  end: number
  source: string
  start: number
  statement: AST.Statement
}

type SourceEdit = {
  end: number
  replacement: string
  start: number
}

function blockStatementSlices(source: string, block: AST.Block): BlockStatementSlice[] {
  const contentStart = block.$cstNode!.offset + 1
  const starts = block.statements.map((statement, index) => {
    const statementStart = statement.$cstNode!.offset
    const lineStart = lineStartAt(source, statementStart)
    const previousEnd = block.statements[index - 1]?.$cstNode?.end ?? contentStart
    return lineStart < previousEnd ? statementStart : lineStart
  })
  const slices = block.statements.map((statement, index) => {
    const start = starts[index]!
    const end = starts[index + 1] ?? blockCloseBraceOffset(source, block)
    return {
      end,
      source: source.slice(start, end),
      start,
      statement,
    }
  })
  const grouped: BlockStatementSlice[] = []
  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index]!
    const next = slices[index + 1]
    if (
      AST.isTagStatement(slice.statement)
      && next !== undefined
      && (AST.isRender(next.statement) || AST.isForStatement(next.statement))
    ) {
      grouped.push({
        end: next.end,
        source: source.slice(slice.start, next.end),
        start: slice.start,
        statement: next.statement,
      })
      index += 1
    } else {
      grouped.push(slice)
    }
  }
  return grouped
}

function renderIdForStatement(statement: AST.Statement): string | undefined {
  return AST.isRender(statement) ? renderIdFor(statement) : undefined
}

function statementContainsRenderId(statement: AST.Statement, renderId: string): boolean {
  return renderIdForStatement(statement) === renderId
    || AST.streamAllContents(statement).filter(AST.isRender).some(render => renderIdFor(render) === renderId)
}

function studioComponentInsertionOffset(file: AST.TaoFile, text: string): number {
  return blockCloseBraceOffset(text, studioInsertionRender(file).block)
}

type StudioInsertionTarget = Readonly<{ block: AST.Block; offset: number }>

function studioInsertionTarget(document: AST.Document, gap: StudioRenderGap): StudioInsertionTarget {
  const source = document.textDocument.getText()
  if (gap.afterId === undefined && gap.beforeId === undefined) {
    const block = studioInsertionRender(document.parseResult.value).block
    return { block, offset: blockCloseBraceOffset(source, block) }
  }
  if (gap.afterId !== undefined) {
    requireLocalRenderId(document, gap.afterId, 'insert renders')
  }
  if (gap.beforeId !== undefined) {
    requireLocalRenderId(document, gap.beforeId, 'insert renders')
  }
  const after = gap.afterId === undefined ? undefined : requireRenderById(document.parseResult.value, gap.afterId)
  const before = gap.beforeId === undefined ? undefined : requireRenderById(document.parseResult.value, gap.beforeId)
  const afterStatement = after === undefined ? undefined : directViewRenderStatement(after)
  const beforeStatement = before === undefined ? undefined : directViewRenderStatement(before)
  const targetStatement = afterStatement ?? beforeStatement
  if (
    targetStatement === undefined
    || !AST.isBlock(targetStatement.$container)
    || (afterStatement !== undefined && afterStatement.$container !== targetStatement.$container)
    || (beforeStatement !== undefined && beforeStatement.$container !== targetStatement.$container)
  ) {
    throw new Errors.UserInputError('Can only insert into a drop gap between direct child view renders.')
  }
  const block = targetStatement.$container
  const slices = blockStatementSlices(source, block)
  const edit = studioSnippetInsertionEdit(source, slices, gap, '')
  return { block, offset: edit.start }
}

function insertStudioSnippetAtGap(document: AST.Document, snippet: string, gap: StudioRenderGap): string {
  const source = document.textDocument.getText()
  if (gap.afterId === undefined && gap.beforeId === undefined) {
    return insertStudioComponentSnippet(
      source,
      studioComponentInsertionOffset(document.parseResult.value, source),
      snippet,
    )
  }
  const { block } = studioInsertionTarget(document, gap)
  const slices = blockStatementSlices(source, block)
  return applySourceEdits(source, [studioSnippetInsertionEdit(source, slices, gap, snippet)])
}

function studioSnippetInsertionEdit(
  source: string,
  slices: BlockStatementSlice[],
  gap: StudioRenderGap,
  snippet: string,
): SourceEdit {
  const insertIndex = insertionTargetIndex(slices, gap)
  const target = slices[insertIndex] ?? slices[slices.length - 1]!
  const indent = lineIndentAt(source, target.start)
  const inserted = `${indentSnippet(snippet, indent)}\n`
  const offset = insertIndex === slices.length ? target.end : target.start
  return { end: offset, replacement: inserted, start: offset }
}

function insertionTargetIndex(slices: BlockStatementSlice[], gap: StudioRenderGap): number {
  const afterIndex = gap.afterId === undefined ? undefined : renderStatementIndex(slices, gap.afterId)
  const beforeIndex = gap.beforeId === undefined ? undefined : renderStatementIndex(slices, gap.beforeId)
  if (afterIndex === -1 || beforeIndex === -1) {
    throw new Errors.UserInputError('Drop target is no longer between the requested render expressions.')
  }
  if (afterIndex !== undefined && beforeIndex !== undefined && beforeIndex !== afterIndex + 1) {
    throw new Errors.UserInputError('Drop-gap anchors are no longer adjacent render expressions.')
  }
  return beforeIndex ?? (afterIndex === undefined ? slices.length : afterIndex + 1)
}

function studioInsertionRender(file: AST.TaoFile): AST.Render & { block: AST.Block } {
  const render = AST.streamAllContents(file)
    .filter(AST.isRender)
    .filter(candidate => candidate.block !== undefined)
    .sort((left, right) => left.$cstNode!.offset - right.$cstNode!.offset)[0]
  if (render?.block === undefined) {
    throw new Errors.UserInputError('No render block found for Studio component insertion.')
  }
  return render as AST.Render & { block: AST.Block }
}

function blockCloseBraceOffset(text: string, block: AST.Block): number {
  const blockEnd = block.$cstNode!.end
  const closeOffset = text.lastIndexOf('}', blockEnd - 1)
  return closeOffset === -1 ? blockEnd : closeOffset
}

function blockOpenBraceOffset(text: string, block: AST.Block): number {
  const blockStart = block.$cstNode!.offset
  const openOffset = text.indexOf('{', blockStart)
  return openOffset === -1 ? blockStart : openOffset + 1
}

function insertStudioComponentSnippet(source: string, offset: number, snippet: string): string {
  const indent = `${lineIndentAt(source, offset)}   `
  return `${source.slice(0, offset)}\n${indentSnippet(snippet, indent)}${source.slice(offset)}`
}

function lineIndentAt(source: string, offset: number): string {
  const lineStart = lineStartAt(source, offset)
  const line = source.slice(lineStart, offset)
  return /^[ \t]*/.exec(line)?.[0] ?? ''
}

function lineStartAt(source: string, offset: number): number {
  return source.lastIndexOf('\n', offset - 1) + 1
}

function indentSnippet(snippet: string, indent: string): string {
  return snippet.split('\n').map(line => line === '' ? line : `${indent}${line}`).join('\n')
}

/** contentVersion returns the patch protocol's deterministic text version token. */
function contentVersion(text: string): string {
  let fnvHash = 0x811c9dc5
  let mixedHash = 0x9e3779b9
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index)
    fnvHash ^= codeUnit
    fnvHash = Math.imul(fnvHash, 0x01000193) >>> 0
    mixedHash = Math.imul(mixedHash ^ codeUnit, 0x85ebca6b) >>> 0
  }
  return `text-v1:${text.length}:${fnvHash.toString(36).padStart(7, '0')}${mixedHash.toString(36).padStart(7, '0')}`
}
