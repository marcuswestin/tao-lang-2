import { ASTUtils } from '@ast-utils'
import Formatter from '@formatter'
import { AST } from '@parser'
import { Errors, Switch } from '@shared'
import { assertNoSyntaxErrors } from './source-actions-utils'

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
  | 'Progress'
  | 'Row'
  | 'ScrollView'
  | 'SegmentedControl'
  | 'Slider'
  | 'Spinner'
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

/** StudioInsertProjectViewPatchRequest inserts a zero-argument project view invocation into a Tao render block. */
export type StudioInsertProjectViewPatchRequest = {
  afterId?: string
  beforeId?: string
  kind: 'insert-project-view'
  viewName: string
}

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

/**
 * StudioSetDesignEntryPatchRequest (semantic agent PoC) sets one entry on a named design bundle without a
 * render occurrence, so a design file that renders nothing can still take the edit.
 */
type StudioSetDesignEntryPatchRequest = {
  designName: string
  entry: StudioStyleEntry
  kind: 'set-design-entry'
  memberName: string
}

/** StudioSourcePatchRequest declares one semantic visual source mutation from Studio. */
export type StudioSourcePatchRequest =
  | StudioInsertCapturedFixturePatchRequest
  | StudioSetDesignEntryPatchRequest
  | StudioInsertComponentPatchRequest
  | StudioInsertProjectViewPatchRequest
  | StudioSetLayoutEntryPatchRequest
  | StudioSetStyleEntryPatchRequest
  | StudioSetScenarioArgumentsPatchRequest
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
  applyPatch,
  insertCapturedFixture,
  insertComponent,
  insertProjectView,
  inspectRender,
  moveRender,
  setLayoutEntry,
  setScenarioArguments,
  setStyleEntry,
  sourceVersion: contentVersion,
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
    'insert-captured-fixture': async action => await insertCapturedFixture(document, action),
    'insert-component': async action => await insertComponent(document, action.component, action),
    'insert-project-view': async action => await insertProjectView(document, action.viewName, action),
    'move-render': async action => await moveRender(document, action),
    'set-design-entry': async action => await setDesignEntry(document, action),
    'set-layout-entry': async action => await setLayoutEntry(document, action),
    'set-scenario-arguments': async action => await setScenarioArguments(document, action),
    'set-style-entry': async action => await setStyleEntry(document, action, context),
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
    'insert-captured-fixture': () => undefined,
    'insert-component': action => action.beforeId ?? action.afterId,
    'insert-project-view': action => action.beforeId ?? action.afterId,
    'move-render': action => action.draggedId,
    'set-design-entry': () => undefined,
    'set-layout-entry': action => action.renderId,
    'set-scenario-arguments': () => undefined,
    'set-style-entry': action => action.renderId,
    'wrap-render': action => action.renderId,
  })
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
    edits.push({
      end: scenario.block.$cstNode.end - 1,
      replacement: `\n${additions.join('\n')}\n`,
      start: scenario.block.$cstNode.end - 1,
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

/** insertProjectView inserts a zero-argument project view invocation into the first render block. */
async function insertProjectView(
  document: AST.Document,
  viewName: string,
  gap: StudioRenderGap = {},
): Promise<string> {
  assertNoSyntaxErrors(document)
  const target = studioInsertionRender(document.parseResult.value)
  requireInsertableProjectView(document.parseResult.value, viewName, AST.findOwningView(target)?.name)
  return await insertViewRender(document, `${viewName}()`, gap)
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

/** setDesignEntry (semantic agent PoC) edits one named bundle/style/text member of a named design in this document. */
async function setDesignEntry(document: AST.Document, request: StudioSetDesignEntryPatchRequest): Promise<string> {
  assertNoSyntaxErrors(document)
  requireIdentifier(request.designName, 'design')
  requireIdentifier(request.memberName, 'design member')
  const designs = AST.streamAllContents(document.parseResult.value).filter(AST.isDesignDeclaration)
    .filter(design => design.name === request.designName)
  if (designs.length !== 1) {
    throw new Errors.UserInputError(`Design is not uniquely declared in this source file: ${request.designName}`)
  }
  const members = designSpecMembers(designs[0]!).filter(member => member.name === request.memberName)
  if (members.length !== 1) {
    throw new Errors.UserInputError(
      `Design member is not uniquely declared in ${request.designName}: ${request.memberName}`,
    )
  }
  const entry = formatDesignEntry(request.entry)
  // Edit in place and refuse a no-op: moving an unchanged entry to the end of the clause is not a change.
  const spec = members[0]!.spec
  const slot = layoutEntrySlot(entry.split(/\s+/))
  const existing = spec.entries.find(candidate => layoutEntrySlot(ASTUtils.layoutEntryValues(candidate)) === slot)
  const source = document.textDocument.getText()
  if (existing !== undefined) {
    const current = ASTUtils.layoutEntryValues(existing).join(' ')
    if (current === entry) {
      throw new Errors.UserInputError(
        `Design member ${request.memberName} already has ${entry}; the requested change is a no-op.`,
      )
    }
    return await Formatter.formatCode(applySourceEdits(source, [{
      end: existing.$cstNode!.end,
      replacement: entry,
      start: existing.$cstNode!.offset,
    }]))
  }
  return await Formatter.formatCode(setLayoutClauseEntrySource(source, spec, entry))
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

function requireInsertableProjectView(file: AST.TaoFile, viewName: string, targetViewName: string | undefined): void {
  const view = file.statements.filter(AST.isViewDeclaration).find(candidate => candidate.name === viewName)
  if (view === undefined) {
    throw new Errors.UserInputError(`Project view is not declared in this source file: ${viewName}`)
  }
  if (AST.parametersOf(view).length > 0) {
    throw new Errors.UserInputError(`Cannot insert parameterized project view without arguments: ${viewName}`)
  }
  if (viewName === targetViewName) {
    throw new Errors.UserInputError(`Cannot insert project view ${viewName} into its own render block.`)
  }
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
  Progress: 'Progress(0)',
  Row: 'Row() [gap 8] {\n   Text("New row")\n}',
  ScrollView: 'ScrollView() {\n   Text("Scrollable content")\n}',
  SegmentedControl:
    'SegmentedControl(Value: "First", Options: ["First", "Second"], Label: "Options") {\n   on change -> Value { }\n}',
  Slider: 'Slider(Value: 0, Label: "Slider") {\n   on change -> Value { }\n}',
  Spinner: 'Spinner()',
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
  const layoutClause = render.layoutClause
  if (layoutClause === undefined) {
    const insertionOffset = renderLayoutInsertionOffset(render)
    return applySourceEdits(source, [{
      end: insertionOffset,
      replacement: ` [${entry}]`,
      start: insertionOffset,
    }])
  }
  return setLayoutClauseEntrySource(source, layoutClause, entry)
}

function setLayoutClauseEntrySource(source: string, layoutClause: AST.LayoutClause, entry: string): string {
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
      return applySourceEdits(source, [{
        end: nextEntry.$cstNode!.offset,
        replacement: '',
        start: existingEntry.$cstNode!.offset,
      }, {
        end: insertionOffset,
        replacement: `, ${entry}`,
        start: insertionOffset,
      }])
    }
    return applySourceEdits(source, [{
      end: existingEntry.$cstNode!.end,
      replacement: entry,
      start: existingEntry.$cstNode!.offset,
    }])
  }
  const closeBracket = source.lastIndexOf(']', layoutClause.$cstNode!.end - 1)
  const insertionOffset = closeBracket === -1 ? layoutClause.$cstNode!.end : closeBracket
  return applySourceEdits(source, [{
    end: insertionOffset,
    replacement: layoutClause.entries.length === 0 ? entry : `, ${entry}`,
    start: insertionOffset,
  }])
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

const studioLayoutHeads = new Set<string>(ASTUtils.designLayoutHeads)
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

function insertStudioSnippetAtGap(document: AST.Document, snippet: string, gap: StudioRenderGap): string {
  const source = document.textDocument.getText()
  if (gap.afterId === undefined && gap.beforeId === undefined) {
    return insertStudioComponentSnippet(
      source,
      studioComponentInsertionOffset(document.parseResult.value, source),
      snippet,
    )
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
  const insertIndex = insertionTargetIndex(slices, gap)
  const target = slices[insertIndex] ?? slices[slices.length - 1]!
  const indent = lineIndentAt(source, target.start)
  const inserted = `${indentSnippet(snippet, indent)}\n`
  const offset = insertIndex === slices.length ? target.end : target.start
  return applySourceEdits(source, [{ end: offset, replacement: inserted, start: offset }])
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
