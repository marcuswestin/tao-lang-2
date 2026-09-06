import type { AST } from '@parser'
import { Errors } from '@shared'

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
  text?: StudioTextInspection
}

/** StudioTextBindingCandidate is one value a text leaf may bind to, visible at that render. */
export type StudioTextBindingCandidate = Readonly<{
  expression: string
  type: 'enum' | 'number' | 'text'
}>

/**
 * StudioTextInspection describes a Text or TextMultiline leaf's first argument: its current source,
 * its literal when it is a plain string, and every parameter, loop item, local value, or entity field
 * in scope that the leaf could show instead.
 */
export type StudioTextInspection = Readonly<{
  candidates: readonly StudioTextBindingCandidate[]
  expression: string
  literal?: string
}>

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
  wrapper: StudioWrapRenderContainer
}

export type StudioWrapRenderContainer = 'Col' | 'Row' | 'Stack'

/** StudioRemoveRenderPatchRequest removes one direct child render together with its attached tag. */
export type StudioRemoveRenderPatchRequest = Readonly<{
  kind: 'remove-render'
  renderId: string
}>

/** StudioSetTextContentPatchRequest replaces a text leaf's first argument with a string literal. */
export type StudioSetTextContentPatchRequest = Readonly<{
  content: string
  kind: 'set-text-content'
  renderId: string
}>

/** StudioBindTextPatchRequest points a text leaf's first argument at a value visible at that render. */
export type StudioBindTextPatchRequest = Readonly<{
  expression: string
  kind: 'bind-text'
  renderId: string
}>

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

export type StudioRecordedScenarioStep =
  | Readonly<{
    kind: 'press' | 'submit'
    selector: 'label' | 'placeholder' | 'tag' | 'text'
    target: string
  }>
  | Readonly<{
    kind: 'enter'
    selector: 'label' | 'placeholder' | 'tag' | 'text'
    target: string
    value: string
  }>

/** Appends reviewed semantic interactions to one exact authored scenario. */
export type StudioAppendScenarioStepsPatchRequest = {
  kind: 'append-scenario-steps'
  scenarioGroupName: string
  scenarioName: string
  steps: readonly StudioRecordedScenarioStep[]
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

/**
 * StudioSetDesignEntryPatchRequest (semantic agent PoC) sets one entry on a named design bundle without a
 * render occurrence, so a design file that renders nothing can still take the edit.
 */
export type StudioSetDesignEntryPatchRequest = {
  designName: string
  entry: StudioStyleEntry
  kind: 'set-design-entry'
  memberName: string
}

/** StudioSourcePatchRequest declares one semantic visual source mutation from Studio. */
export type StudioSourcePatchRequest =
  | StudioAddSketchEntityParameterPatchRequest
  | StudioAppendScenarioStepsPatchRequest
  | StudioBindSketchFieldPatchRequest
  | StudioInsertCapturedFixturePatchRequest
  | StudioSetDesignEntryPatchRequest
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
  | StudioRemoveRenderPatchRequest
  | StudioSetTextContentPatchRequest
  | StudioBindTextPatchRequest

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
