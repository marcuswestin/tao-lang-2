import { Type } from '@ast-utils'
import Formatter from '@formatter'
import { AST } from '@parser'
import { Errors } from '@shared'
import { assertNoSyntaxErrors } from '../source-actions-utils'
import { ensureUiComponentImport } from './studio-components'
import type {
  StudioAddSketchEntityParameterPatchRequest,
  StudioBindSketchFieldPatchRequest,
  StudioLayoutEntry,
  StudioSketchSnapTree,
  StudioSnapSketchToFlowPatchRequest,
  StudioUnsnapSketchFromFlowPatchRequest,
  StudioWorkspaceDesignContext,
} from './studio-contract'
import { formatLayoutEntry, requireSupportedLayoutEntry } from './studio-layout-entries'
import { requireLocalRenderId, requireRenderById } from './studio-render-occurrences'
import { scenarioRenderSource } from './studio-scenarios'
import {
  applySourceEdits,
  blockCloseBraceOffset,
  blockOpenBraceOffset,
  blockStatementSlices,
  formatAndReparse,
  indentSnippet,
  isObject,
  lineIndentAt,
  requireExactKeys,
  requireIdentifier,
  type SourceEdit,
  taoStringLiteral,
} from './studio-source-text'
import { ensureNamedImport } from './studio-use-imports'

export async function addSketchEntityParameter(
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
    Errors.throwUserInput(
      `Studio entity binding requires one owned sketch scenario group: ${request.scenarioGroupName}`,
    )
  }
  const group = groups[0]!
  const fixture = file.statements.filter(AST.isFixtureDeclaration)
    .filter(candidate => candidate.name === request.fixtureName)
  if (fixture.length !== 1) {
    Errors.throwUserInput(
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
    Errors.throwUserInput(
      `Studio sketch entity is not uniquely declared: ${request.entity.declarationName} / ${request.entity.parameterName}`,
    )
  }
  const entity = entities[0]
  if (AST.parametersOf(view).some(parameter => Type.parameterName(parameter) === request.entity.parameterName)) {
    Errors.throwUserInput(`Studio sketch view already declares parameter ${request.entity.parameterName}.`)
  }
  const scenarios = AST.scenarioDeclarations(group)
  const handles = new Map(request.scenarioArguments.map(binding => [binding.scenarioName, binding.fixtureHandle]))
  if (
    handles.size !== request.scenarioArguments.length
    || scenarios.length !== handles.size
    || scenarios.some(scenario => !handles.has(scenario.name))
  ) {
    Errors.throwUserInput(
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
      Errors.throwUserInput(
        `Studio fixture handle ${binding.fixtureHandle} does not create ${request.entity.parameterName}.`,
      )
    }
  }
  for (const scenario of scenarios) {
    const effectiveFixture = AST.effectiveScenarioClause(scenario, AST.isScenarioFixtureClause)
    if (effectiveFixture !== undefined && effectiveFixture.fixture.ref !== fixture[0]) {
      Errors.throwUserInput(`Studio scenario ${scenario.name} already uses another fixture.`)
    }
  }

  const source = document.textDocument.getText()
  const parameterList = view.parameterList?.$cstNode
  if (parameterList === undefined) {
    Errors.throwUserInput(`Studio sketch view has no editable parameter list: ${request.viewName}`)
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
      Errors.throwUserInput(`Studio sketch scenario ${scenario.name} does not render a view.`)
    }
    const arguments_ = effectiveRender?.argumentList?.arguments ?? []
    if (arguments_.some(argument => argument.label === request.entity.parameterName)) {
      Errors.throwUserInput(
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

export async function bindSketchField(
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
    Errors.throwUserInput('Studio field binding requires one leaf in the generated sketch view.')
  }
  if (AST.attachedTag(render)?.tag !== `#studio_rect_${encodedTag(request.rectId)}`) {
    Errors.throwUserInput(`Studio field binding target does not match rectangle ${request.rectId}.`)
  }
  const parameter = AST.parametersOf(view)
    .find(candidate => Type.parameterName(candidate) === request.parameterName)
  if (parameter === undefined) {
    Errors.throwUserInput(`Studio sketch parameter does not exist: ${request.parameterName}`)
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
      Errors.throwUserInput(`Studio text binding cannot render field path ${request.fieldPath.join('.')}.`)
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
  if (request.scenarioGroupName.length === 0 || /[\x00-\x1f\x7f]/u.test(request.scenarioGroupName)) {
    Errors.throwUserInput('Studio sketch scenario group name is invalid.')
  }
  if (
    !/^(?:\.\.?\/)+(?:[A-Za-z_][A-Za-z0-9_-]*)(?:\/[A-Za-z_][A-Za-z0-9_-]*)*(?:\.tao)?$/.test(
      request.entity.importPath,
    )
  ) {
    Errors.throwUserInput(`Studio entity import path is invalid: ${request.entity.importPath}`)
  }
  if (!Array.isArray(request.scenarioArguments) || request.scenarioArguments.length === 0) {
    Errors.throwUserInput('Studio entity binding requires sketch scenario arguments.')
  }
  for (const binding of request.scenarioArguments) {
    requireExactKeys(binding, ['fixtureHandle', 'scenarioName'], 'Sketch scenario fixture binding')
    requireIdentifier(binding.fixtureHandle, 'fixture handle')
    if (binding.scenarioName.length === 0 || /[\x00-\x1f\x7f]/u.test(binding.scenarioName)) {
      Errors.throwUserInput('Studio sketch scenario name is invalid.')
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
    Errors.throwUserInput('Studio field binding rectangle identity must be nonempty.')
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
      if (value !== undefined && /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value)) {
        Errors.throwUserInput('Studio text binding affixes contain unsupported control characters.')
      }
    }
  } else {
    Errors.throwUserInput('Studio sketch field presentation is invalid.')
  }
}

function validateFieldPath(path: readonly string[], label: string): void {
  if (!Array.isArray(path) || path.length === 0) {
    Errors.throwUserInput(`Studio ${label} path must contain at least one field.`)
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
    Errors.throwUserInput(`Studio entity binding requires one generated public ViewN: ${viewName}`)
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
      Errors.throwUserInput(`Studio field path cannot traverse ${path.slice(0, index).join('.') || 'value'}.`)
    }
    const field = Type.dataFields(type.entity).find(candidate => candidate.name === segment)
    if (field === undefined) {
      Errors.throwUserInput(`Studio entity ${type.entity.singularName} has no field ${segment}.`)
    }
    if (field.optional) {
      Errors.throwUserInput(`Studio field path cannot bind optional field ${segment} without a fallback.`)
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
    Errors.throwUserInput(`Studio ${label} must be a text field: ${path.join('.')}`)
  }
}

function interpolatedFieldSource(expression: string, prefix = '', suffix = ''): string {
  const escapedPrefix = taoStringLiteral(prefix).slice(1, -1)
  const escapedSuffix = taoStringLiteral(suffix).slice(1, -1)
  return `"${escapedPrefix}{ ${expression} }${escapedSuffix}"`
}

/** Adds a validated structured Snap tree without rebuilding an existing snapped render tree. */
export async function snapSketchToFlow(
  document: AST.Document,
  request: StudioSnapSketchToFlowPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  validateSnapRequest(request)
  const views = document.parseResult.value.statements.filter(AST.isViewDeclaration)
    .filter(view => view.name === request.viewName)
  const view = views.length === 1 ? views[0] : undefined
  if (view === undefined || view.visibility !== 'public' || view.block === undefined) {
    Errors.throwUserInput(`Studio Snap requires one generated public view: ${request.viewName}`)
  }
  const owners = document.parseResult.value.statements.filter(AST.isScenarioGroupDeclaration)
    .filter(group => group.name === 'sketch' && group.subject?.ref === view)
  if (owners.length !== 1) {
    Errors.throwUserInput(
      `Studio Snap view is not owned by one generated sketch scenario: ${request.viewName}`,
    )
  }
  const renders = view.block.statements.filter(AST.isRenderStatement)
  if (renders.length !== 1 || renders[0]?.$cstNode === undefined) {
    Errors.throwUserInput(`Studio Snap requires one direct render tree in ${request.viewName}.`)
  }
  const leafIds: string[] = []
  const components = new Set<string>()
  const nodeSource = snapNodeSource(request.tree, '', leafIds, components)
  if (leafIds.length !== request.rectIds.length || leafIds.some((id, index) => id !== request.rectIds[index])) {
    Errors.throwUserInput('Studio Snap rectangle identities do not match the structured tree.')
  }
  const source = document.textDocument.getText()
  const root = renders[0]!
  const rootCst = root.$cstNode!
  const existing = AST.streamAllContents(view).filter(AST.isRender)
    .filter(render => AST.attachedTag(render)?.tag.startsWith('#studio_rect_'))
  const requestedTags = new Set(request.rectIds.map(id => `#studio_rect_${encodedTag(id)}`))
  if (existing.some(render => requestedTags.has(AST.attachedTag(render)!.tag))) {
    Errors.throwUserInput('Studio Snap cannot add a rectangle that is already snapped.')
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
export async function unsnapSketchFromFlow(
  document: AST.Document,
  request: StudioUnsnapSketchFromFlowPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  validateUnsnapRequest(request)
  const file = document.parseResult.value
  const views = file.statements.filter(AST.isViewDeclaration).filter(view => view.name === request.viewName)
  const view = views.length === 1 ? views[0] : undefined
  if (view === undefined || view.visibility !== 'public' || view.block === undefined) {
    Errors.throwUserInput(`Studio Unsnap requires one generated public view: ${request.viewName}`)
  }
  const owners = file.statements.filter(AST.isScenarioGroupDeclaration)
    .filter(group => group.name === 'sketch' && group.subject?.ref === view)
  if (owners.length !== 1) {
    Errors.throwUserInput(
      `Studio Unsnap view is not owned by one generated sketch scenario: ${request.viewName}`,
    )
  }
  const roots = view.block.statements.filter(AST.isRenderStatement)
  const root = roots.length === 1 ? roots[0] : undefined
  if (root?.$cstNode === undefined) {
    Errors.throwUserInput(`Studio Unsnap requires one direct render tree in ${request.viewName}.`)
  }
  const selectedTags = new Map(request.rectIds.map(id => [`#studio_rect_${encodedTag(id)}`, id]))
  const marked = AST.streamAllContents(view).filter(AST.isRender)
    .map(render => ({ render, tag: AST.attachedTag(render) }))
    .filter(item => item.tag?.tag.startsWith('#studio_rect_'))
  const selected = marked.filter(item => selectedTags.has(item.tag!.tag))
  if (selected.length !== request.rectIds.length) {
    Errors.throwUserInput('Studio Unsnap could not find every selected rectangle in the current source.')
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
      Errors.throwUserInput('Studio Unsnap can only remove a selected leaf inside the generated render tree.')
    }
    const slice = blockStatementSlices(source, render.$container).find(candidate => candidate.statement === render)
    if (slice === undefined) {
      Errors.throwUserInput('Studio Unsnap could not locate the selected leaf source.')
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
    Errors.throwUserInput('Studio Snap catalog revision must be a nonnegative integer.')
  }
  if (
    typeof request.viewName !== 'string'
    || !/^View[1-9][0-9]*$/.test(request.viewName)
    || typeof request.sketchId !== 'string'
    || request.sketchId.length === 0
  ) {
    Errors.throwUserInput('Studio Snap requires a generated ViewN and sketch identity.')
  }
  if (request.mergeDirection !== 'Col' && request.mergeDirection !== 'Row') {
    Errors.throwUserInput('Studio Snap merge direction is invalid.')
  }
  if (request.mergePosition !== 'after' && request.mergePosition !== 'before') {
    Errors.throwUserInput('Studio Snap merge position is invalid.')
  }
  if (!Array.isArray(request.rectIds) || request.rectIds.some(id => typeof id !== 'string' || id.length === 0)) {
    Errors.throwUserInput('Studio Snap rectangle identities must be nonempty strings.')
  }
  validateSnapNode(request.tree, new Set(), 0)
}

function validateUnsnapRequest(request: StudioUnsnapSketchFromFlowPatchRequest): void {
  requireExactKeys(request, ['fallback', 'kind', 'rectIds', 'sketchId', 'viewName'], 'Unsnap request')
  if (!isObject(request.fallback)) {
    Errors.throwUserInput('Studio Unsnap fallback is invalid.')
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
    Errors.throwUserInput('Studio Unsnap requires a generated ViewN and sketch identity.')
  }
  if (
    !Array.isArray(request.rectIds)
    || request.rectIds.length === 0
    || request.rectIds.some(id => typeof id !== 'string' || id.length === 0)
    || new Set(request.rectIds).size !== request.rectIds.length
  ) {
    Errors.throwUserInput('Studio Unsnap rectangle identities must be unique nonempty strings.')
  }
  if (
    !Number.isFinite(request.fallback.width)
    || request.fallback.width <= 0
    || !Number.isFinite(request.fallback.height)
    || request.fallback.height <= 0
  ) {
    Errors.throwUserInput('Studio Unsnap fallback dimensions must be positive and finite.')
  }
}

function validateSnapNode(node: StudioSketchSnapTree, seen: Set<string>, depth: number): void {
  if (depth > 64 || !isObject(node)) {
    Errors.throwUserInput('Studio Snap tree is invalid or too deeply nested.')
  }
  if (node.type === 'container') {
    requireExactKeys(node, ['children', 'direction', 'layout', 'type'], 'Snap container')
    if (
      (node.direction !== 'Row' && node.direction !== 'Col') || !Array.isArray(node.children)
      || node.children.length === 0
    ) {
      Errors.throwUserInput('Studio Snap container direction and children are invalid.')
    }
    validateSnapLayout(node.layout, new Set(['gap', 'pad', 'claim']), 'container')
    node.children.forEach(child => validateSnapNode(child, seen, depth + 1))
    return
  }
  if (node.type !== 'element') {
    Errors.throwUserInput('Studio Snap node kind is invalid.')
  }
  requireExactKeys(node, ['arguments', 'component', 'content', 'layout', 'rectId', 'type'], 'Snap element')
  if (!['Image', 'Placeholder', 'Text'].includes(node.component)) {
    Errors.throwUserInput(`Studio Snap component is unsupported: ${String(node.component)}`)
  }
  if (!Array.isArray(node.arguments) || node.arguments.length !== 1 || typeof node.arguments[0] !== 'string') {
    Errors.throwUserInput('Studio Snap elements require one text argument.')
  }
  if (typeof node.rectId !== 'string' || node.rectId.length === 0 || seen.has(node.rectId)) {
    Errors.throwUserInput(`Studio Snap rectangle identity is invalid or duplicated: ${String(node.rectId)}`)
  }
  if (node.content !== undefined && typeof node.content !== 'string') {
    Errors.throwUserInput('Studio Snap element metadata must be text.')
  }
  seen.add(node.rectId)
  validateSnapLayout(node.layout, new Set(['width', 'height', 'hug', 'claim']), 'element')
}

function validateSnapLayout(layout: readonly StudioLayoutEntry[], allowed: ReadonlySet<string>, owner: string): void {
  if (!Array.isArray(layout)) {
    Errors.throwUserInput(`Studio Snap ${owner} layout must be an array.`)
  }
  const heads = new Set<string>()
  for (const raw of layout) {
    const entry = requireSupportedLayoutEntry(raw)
    const head = entry[0]
    if (!allowed.has(head) || heads.has(head)) {
      Errors.throwUserInput(`Studio Snap ${owner} layout entry is invalid or duplicated: ${head}`)
    }
    if (head === 'claim' && (entry.length !== 2 || entry[1] !== 1)) {
      Errors.throwUserInput('Studio Snap claim must be exactly 1.')
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

/** encodedTag spells a sketch rectangle id as the hex body of its `#studio_rect_` marker tag. */
function encodedTag(value: string): string {
  let encoded = ''
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, '0')
  }
  return encoded
}
