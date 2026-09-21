import { Type } from '@ast-utils'
import Formatter from '@formatter'
import { AST } from '@parser'
import { Errors } from '@shared'
import { assertNoSyntaxErrors } from '../source-actions-utils'
import type {
  StudioComponentKind,
  StudioInsertProjectViewPatchRequest,
  StudioInsertSeparatorPatchRequest,
  StudioInsertSpacerPatchRequest,
  StudioRenderGap,
  StudioToggleFlowDirectionPatchRequest,
} from './studio-contract'
import { setRenderLayoutEntryEdits } from './studio-layout-entries'
import {
  requireLocalRenderId,
  requireRenderById,
  type StudioLexicalValue,
  visibleInsertionValues,
} from './studio-render-occurrences'
import {
  insertionTargetIndex,
  insertStudioSnippetAtGap,
  studioInsertionTarget,
  studioSnippetInsertionEdit,
} from './studio-render-tree'
import {
  applySourceEdits,
  blockStatementSlices,
  isObject,
  requireExactKeys,
  requireIdentifier,
} from './studio-source-text'
import { ensureUiNamesImported } from './studio-use-imports'

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

/** ensureUiComponentImport imports one palette component, plus Text when its snippet renders one. */
export function ensureUiComponentImport(source: string, file: AST.TaoFile, component: StudioComponentKind): string {
  return ensureUiNamesImported(
    source,
    file,
    [...new Set(studioComponentSnippets[component].includes('Text(') ? [component, 'Text'] : [component])],
  )
}

/** insertComponent inserts a constrained current-dialect palette component into the first render block. */
export async function insertComponent(
  document: AST.Document,
  component: StudioComponentKind,
  gap: StudioRenderGap = {},
): Promise<string> {
  assertNoSyntaxErrors(document)
  if (!studioComponentKinds.has(component)) {
    Errors.throwUserInput(`Unsupported Studio palette component: ${String(component)}`)
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
export async function insertProjectView(
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

function validateInsertProjectViewRequest(request: StudioInsertProjectViewPatchRequest): void {
  requireExactKeys(request, ['afterId', 'beforeId', 'bindings', 'kind', 'viewName'], 'Insert project view request')
  requireIdentifier(request.viewName, 'project view')
  if (request.bindings === undefined) {
    return
  }
  if (!isObject(request.bindings)) {
    Errors.throwUserInput('Studio project-view lexical bindings must be an object.')
  }
  for (const [parameterName, valueName] of Object.entries(request.bindings)) {
    requireIdentifier(parameterName, 'project-view parameter')
    if (typeof valueName !== 'string') {
      Errors.throwUserInput(`Studio lexical binding for ${parameterName} must name a value.`)
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
    Errors.throwUserInput(
      views.length === 0
        ? `Project view is not declared in this source file: ${viewName}`
        : `Project view is not uniquely declared in this source file: ${viewName}`,
    )
  }
  if (viewName === targetViewName) {
    Errors.throwUserInput(`Cannot insert project view ${viewName} into its own render block.`)
  }
  return view
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
      Errors.throwUserInput(`Project view ${view.name} has no parameter named ${parameterName}.`)
    }
    const value = visible.get(valueName)
    if (value === undefined) {
      Errors.throwUserInput(`Lexical value ${valueName} is not visible at the project-view insertion gap.`)
    }
    if (!typesExactlyMatch(parameter, value)) {
      Errors.throwUserInput(
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
    Errors.throwUserInput(`Cannot insert parameterized project view ${view.name}; ${details}.`)
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

/** toggleFlowDirection changes the nearest Row/Col that directly or transitively owns a leaf render. */
export async function toggleFlowDirection(
  document: AST.Document,
  request: StudioToggleFlowDirectionPatchRequest,
): Promise<string> {
  assertNoSyntaxErrors(document)
  requireLocalRenderId(document, request.renderId, 'toggle flow direction for renders')
  const leaf = requireLeafRenderById(document.parseResult.value, request.renderId)
  const owner = nearestFlowOwner(leaf)
  const reference = owner.view!.$refNode
  if (reference === undefined) {
    Errors.throwUserInput('Cannot toggle a flow container without source coordinates.')
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
export async function insertSeparator(
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
export async function insertSpacer(
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
    Errors.throwUserInput('Studio Spacer claim ratio must contain two integers from 1 through 100.')
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
    Errors.throwUserInput('Studio flow edits require direct leaf siblings in the same container.')
  }
  const block = after.$container
  const owner = block.$container
  if (!isFlowOwner(owner)) {
    Errors.throwUserInput('Studio flow edits require leaf siblings owned by a Row or Col.')
  }
  if (
    AST.findOwningView(after) === undefined
    || (before !== undefined && AST.findOwningView(before) !== AST.findOwningView(after))
  ) {
    Errors.throwUserInput('Studio flow edits require render expressions in the same view definition.')
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
    Errors.throwUserInput(`Studio flow edit target is no longer a direct leaf render: ${id}`)
  }
  return render
}

type FlowOwner = AST.RenderStatement | AST.ViewRender

function flowDirection(render: FlowOwner): 'Col' | 'Row' {
  const direction = render.view?.$refText
  if (direction !== 'Row' && direction !== 'Col') {
    Errors.throwUnexpected('Expected a validated Studio Row or Col flow owner.')
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
  Errors.throwUserInput('Studio direction toggle requires a leaf owned by a Row or Col.')
}
