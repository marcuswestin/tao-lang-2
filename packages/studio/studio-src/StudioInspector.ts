import type {
  StudioLayoutAlignment,
  StudioLayoutContentTerm,
  StudioLayoutEntry,
  StudioLayoutSizeValue,
  StudioLayoutSpacingSide,
  StudioRenderInspection,
  StudioStyleEntry,
  StudioStyleLandingScope,
} from '@source-actions'
import type {
  StudioParameterSchema,
  StudioPreviewManifestV2,
  StudioScenarioSubject,
} from './StudioPreviewManifest'
import {
  type StudioCanonicalSourceAction,
  type StudioPreviewSourceMessage,
  studioProtocolChannel,
  studioProtocolVersion,
  type StudioSourceActionEnvelope,
  type StudioSourceActionIdentity,
  type StudioSourceActionUndoEnvelope,
  studioSourceActionVersion,
  type StudioSourceRange,
} from './StudioProtocol'

export type StudioInspectorSelection = {
  identity: StudioSourceActionIdentity
  range: StudioSourceRange
  renderId: string
}

export type StudioLayoutDimensionModel =
  | { mode: 'fill' }
  | { mode: 'fixed'; value: StudioLayoutSizeValue }
  | { mode: 'unset' }

export type StudioLayoutGrowthModel =
  | { mode: 'claim'; value: number }
  | { mode: 'fill' | 'hug' | 'unset' }

export type StudioLayoutAlignmentModel =
  | { mode: 'aligned'; value: StudioLayoutAlignment }
  | { mode: 'centered' | 'fill' | 'unset' }

export type StudioLayoutInspectorModel = {
  alignment: StudioLayoutAlignmentModel
  content?: readonly StudioLayoutContentTerm[]
  gap?: StudioLayoutSizeValue
  growth: StudioLayoutGrowthModel
  height: StudioLayoutDimensionModel
  margin?: StudioLayoutEntry
  padding?: StudioLayoutEntry
  shrink: 'compress' | 'rigid' | 'unset'
  width: StudioLayoutDimensionModel
  widthCap?: StudioLayoutSizeValue
}

export type StudioStyleProperty =
  | 'background'
  | 'bg'
  | 'border'
  | 'fg'
  | 'ink'
  | 'line'
  | 'radius'
  | 'size'
  | 'weight'

export const studioStyleProperties: readonly Readonly<{
  head: StudioStyleProperty
  label: string
  valueKind: 'color' | 'size' | 'weight'
}>[] = [
  { head: 'background', label: 'Background', valueKind: 'color' },
  { head: 'ink', label: 'Foreground', valueKind: 'color' },
  { head: 'border', label: 'Border', valueKind: 'color' },
  { head: 'size', label: 'Font size', valueKind: 'size' },
  { head: 'weight', label: 'Font weight', valueKind: 'weight' },
  { head: 'line', label: 'Line height', valueKind: 'size' },
  { head: 'radius', label: 'Radius', valueKind: 'size' },
  { head: 'bg', label: 'Background (legacy bg)', valueKind: 'color' },
  { head: 'fg', label: 'Foreground (legacy fg)', valueKind: 'color' },
]

export type StudioPaletteComponent = {
  category: 'Container' | 'Element'
  component:
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
  label: string
  snippet: StudioEditorSnippet
}

export type StudioEditorSnippet = {
  placeholders: readonly StudioSourceRange[]
  text: string
}

export type StudioProjectViewPaletteItem = {
  label: string
  snippet: StudioEditorSnippet
  sourcePath: string
  viewName: string
}

export const studioPaletteComponents: readonly StudioPaletteComponent[] = [
  component('Text', 'Element', 'Text(«"New text"»)'),
  component('TextFrame', 'Element', 'TextFrame(«"New text"»)'),
  component('TextMultiline', 'Element', 'TextMultiline(«"New text"»)'),
  component('Number', 'Element', 'Number(«0»)'),
  component('Image', 'Element', 'Image(«"image-url"», Label: "Image")'),
  component('Progress', 'Element', 'Progress(«0»)'),
  component('Button', 'Element', 'Button(«"New button"») {\n   on press -> { }\n}'),
  component('FormButton', 'Element', 'FormButton(«"Save"») {\n   on press -> { }\n}'),
  component('Checkbox', 'Element', 'Checkbox(Value: «false», Label: "Checkbox") {\n   on change -> Value { }\n}'),
  component('Switch', 'Element', 'Switch(Value: «false», Label: "Switch") {\n   on change -> Value { }\n}'),
  component('Slider', 'Element', 'Slider(Value: «0», Label: "Slider") {\n   on change -> Value { }\n}'),
  component(
    'Picker',
    'Element',
    'Picker(Value: «"First"», Options: ["First", "Second"], Label: "Picker") {\n   on change -> Value { }\n}',
  ),
  component(
    'SegmentedControl',
    'Element',
    'SegmentedControl(Value: «"First"», Options: ["First", "Second"], Label: "Options") {\n   on change -> Value { }\n}',
  ),
  component('DatePicker', 'Element', 'DatePicker(Value: «now», Label: "Date") {\n   on change -> Value { }\n}'),
  component(
    'TextInput',
    'Element',
    'TextInput(Value: «""», Label: "Text field") {\n   on change -> Value { }\n   on submit -> { }\n}',
  ),
  component('Spinner', 'Element', 'Spinner()'),
  component('Box', 'Container', 'Box() {\n   Text(«"New box"»)\n}'),
  component('Stack', 'Container', 'Stack() [gap 8, pad 8] {\n   Text(«"Nested text"»)\n}'),
  component('Col', 'Container', 'Col() [gap 8] {\n   Text(«"New column"»)\n}'),
  component('Row', 'Container', 'Row() [gap 8] {\n   Text(«"New row"»)\n}'),
  component('WrappingRow', 'Container', 'WrappingRow() [gap 8] {\n   Text(«"New item"»)\n}'),
  component('Panes', 'Container', 'Panes() {\n   Text(«"New pane"»)\n}'),
  component('ScrollView', 'Container', 'ScrollView() {\n   Text(«"Scrollable content"»)\n}'),
]

/** StudioInspector derives the browser inspector's canonical source-action DTOs without hidden visual state. */
export const StudioInspector = {
  contentEntry,
  layout,
  layoutAction,
  layoutSizeDraft,
  positiveNumberDraft,
  projectViews,
  selection,
  singleAction,
  spacingEntryDraft,
  styleAction,
  styleEntryDraft,
  undo,
} as const

function layout(inspection: StudioRenderInspection): StudioLayoutInspectorModel {
  const width = lastLayoutEntry(inspection.layoutEntries, entry => entry[0] === 'width' && entry[1] !== 'max')
  const widthCap = lastLayoutEntry(inspection.layoutEntries, entry => entry[0] === 'width' && entry[1] === 'max')
  const height = lastLayoutEntry(inspection.layoutEntries, entry => entry[0] === 'height')
  const growth = lastLayoutEntry(
    inspection.layoutEntries,
    entry => entry[0] === 'claim' || entry[0] === 'fill' || entry[0] === 'hug',
  )
  const shrink = lastLayoutEntry(
    inspection.layoutEntries,
    entry => entry[0] === 'compress' || entry[0] === 'rigid',
  )
  const alignment = lastLayoutEntry(
    inspection.layoutEntries,
    entry => entry[0] === 'aligned' || entry[0] === 'centered' || entry[0] === 'fill',
  )
  const content = lastLayoutEntry(inspection.layoutEntries, entry => entry[0] === 'content')
  return {
    alignment: alignment?.[0] === 'aligned'
      ? { mode: 'aligned', value: alignment[1] }
      : alignment?.[0] === 'centered' || alignment?.[0] === 'fill'
      ? { mode: alignment[0] }
      : { mode: 'unset' },
    ...(content?.[0] === 'content' ? { content: content.slice(1) as readonly StudioLayoutContentTerm[] } : {}),
    gap: layoutSize(lastLayoutEntry(inspection.layoutEntries, entry => entry[0] === 'gap')),
    growth: growth?.[0] === 'claim'
      ? { mode: 'claim', value: growth[1] }
      : growth?.[0] === 'fill' || growth?.[0] === 'hug'
      ? { mode: growth[0] }
      : { mode: 'unset' },
    height: dimensionModel(height, false),
    margin: lastLayoutEntry(inspection.layoutEntries, entry => entry[0] === 'margin'),
    padding: lastLayoutEntry(inspection.layoutEntries, entry => entry[0] === 'pad'),
    shrink: shrink?.[0] === 'compress' || shrink?.[0] === 'rigid' ? shrink[0] : 'unset',
    width: dimensionModel(width, true),
    widthCap: widthCap?.[0] === 'width' && widthCap[1] === 'max' ? widthCap[2] : undefined,
  }
}

function layoutAction(renderId: string, entry: StudioLayoutEntry): StudioCanonicalSourceAction {
  return { entry, kind: 'set-layout-entry', renderId }
}

function styleAction(options: {
  entry: StudioStyleEntry
  landing: StudioStyleLandingScope
  renderId: string
}): StudioCanonicalSourceAction {
  return { ...options, kind: 'set-style-entry' }
}

function styleEntryDraft(head: string, draft: string): StudioStyleEntry | undefined {
  const property = studioStyleProperties.find(candidate => candidate.head === head)
  if (property === undefined) {
    return undefined
  }
  if (property.valueKind === 'color') {
    const value = draft.trim()
    return designPath.test(value) || /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
      ? [property.head, value]
      : undefined
  }
  if (property.valueKind === 'size') {
    const value = positiveNumberDraft(draft)
    return value === undefined
      ? designPath.test(draft.trim()) ? [property.head, draft.trim()] : undefined
      : [property.head, value]
  }
  const symbolicWeight = draft.trim()
  if (['bold', 'medium', 'regular', 'semibold'].includes(symbolicWeight)) {
    return [property.head, symbolicWeight]
  }
  const value = positiveNumberDraft(draft)
  if (value === undefined || value < 100 || value > 900 || value % 100 !== 0) {
    return undefined
  }
  return [property.head, value]
}

const designPath = /^[A-Za-z_]\w*(?:\.(?:[A-Za-z_]\w*|\d+))*$/

function positiveNumberDraft(draft: string): number | undefined {
  if (draft.trim() === '') {
    return undefined
  }
  const value = Number(draft)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function layoutSizeDraft(draft: string): StudioLayoutSizeValue | undefined {
  const number = positiveNumberDraft(draft)
  const value = draft.trim()
  return number ?? (designPath.test(value) ? value : undefined)
}

function spacingEntryDraft(head: 'margin' | 'pad', draft: string): StudioLayoutEntry | undefined {
  const terms = draft.trim().split(/\s+/).filter(Boolean)
  if (terms.length === 1) {
    const value = layoutSizeDraft(terms[0]!)
    return value === undefined ? undefined : [head, value]
  }
  if (terms.length < 2 || terms.length > 8 || terms.length % 2 !== 0) {
    return undefined
  }
  const sides = new Set<StudioLayoutSpacingSide>(['bottom', 'horizontal', 'left', 'right', 'top', 'vertical'])
  const physicalSides = new Set<string>()
  const entry: Array<StudioLayoutSizeValue | StudioLayoutSpacingSide | 'margin' | 'pad'> = [head]
  for (let index = 0; index < terms.length; index += 2) {
    const side = terms[index] as StudioLayoutSpacingSide
    const value = layoutSizeDraft(terms[index + 1]!)
    if (!sides.has(side) || value === undefined) {
      return undefined
    }
    const physical = side === 'horizontal'
      ? ['left', 'right']
      : side === 'vertical'
      ? ['top', 'bottom']
      : [side]
    if (physical.some(candidate => physicalSides.has(candidate))) {
      return undefined
    }
    physical.forEach(candidate => physicalSides.add(candidate))
    entry.push(side, value)
  }
  return entry as unknown as StudioLayoutEntry
}

function contentEntry(terms: readonly StudioLayoutContentTerm[]): StudioLayoutEntry | undefined {
  if (terms.length !== 1 && terms.length !== 2) {
    return undefined
  }
  const slots = terms.map(contentTermSlot)
  if (new Set(slots).size !== slots.length) {
    return undefined
  }
  return terms.length === 1 ? ['content', terms[0]!] : ['content', terms[0]!, terms[1]!]
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

function lastLayoutEntry(
  entries: readonly StudioLayoutEntry[],
  matches: (entry: StudioLayoutEntry) => boolean,
): StudioLayoutEntry | undefined {
  return entries.findLast(matches)
}

function layoutSize(entry: StudioLayoutEntry | undefined): StudioLayoutSizeValue | undefined {
  const value = entry?.[1]
  return typeof value === 'number' || (typeof value === 'string' && designPath.test(value)) ? value : undefined
}

function dimensionModel(
  entry: StudioLayoutEntry | undefined,
  _supportsMax: boolean,
): StudioLayoutDimensionModel {
  if (entry?.[0] !== 'width' && entry?.[0] !== 'height') {
    return { mode: 'unset' }
  }
  if (entry[1] === 'fill') {
    return { mode: 'fill' }
  }
  if (typeof entry[1] === 'number' || designPath.test(entry[1])) {
    return { mode: 'fixed', value: entry[1] }
  }
  return { mode: 'unset' }
}

function selection(message: StudioPreviewSourceMessage): StudioInspectorSelection {
  return {
    identity: message.identity,
    range: message.range,
    renderId: `${message.identity.path}:${message.range.start}:${message.range.end}`,
  }
}

function singleAction(options: {
  action: StudioCanonicalSourceAction
  checkpointId: string
  identity: StudioSourceActionIdentity
  requestId: string
}): StudioSourceActionEnvelope {
  return {
    action: options.action,
    channel: studioProtocolChannel,
    checkpoint: { id: options.checkpointId, phase: 'single' },
    identity: options.identity,
    protocolVersion: studioProtocolVersion,
    requestId: options.requestId,
    sourceActionVersion: studioSourceActionVersion,
    type: 'source-action',
  }
}

function undo(options: {
  checkpointId: string
  identity: StudioSourceActionIdentity
  requestId: string
}): StudioSourceActionUndoEnvelope {
  return {
    channel: studioProtocolChannel,
    checkpointId: options.checkpointId,
    identity: options.identity,
    protocolVersion: studioProtocolVersion,
    requestId: options.requestId,
    sourceActionVersion: studioSourceActionVersion,
    type: 'source-action-undo',
  }
}

function component(
  name: StudioPaletteComponent['component'],
  category: StudioPaletteComponent['category'],
  template: string,
): StudioPaletteComponent {
  return { category, component: name, label: name, snippet: editorSnippet(template) }
}

function editorSnippet(template: string): StudioEditorSnippet {
  let text = ''
  const placeholders: StudioSourceRange[] = []
  let index = 0
  while (index < template.length) {
    const start = template.indexOf('«', index)
    if (start === -1) {
      text += template.slice(index)
      break
    }
    text += template.slice(index, start)
    const end = template.indexOf('»', start + 1)
    if (end === -1) {
      throw new Error('Studio editor snippet has an unclosed placeholder.')
    }
    const placeholder = template.slice(start + 1, end)
    const range = { end: text.length + placeholder.length, start: text.length }
    text += placeholder
    placeholders.push(range)
    index = end + 1
  }
  return { placeholders, text }
}

function projectViews(manifest: StudioPreviewManifestV2 | undefined): readonly StudioProjectViewPaletteItem[] {
  if (manifest === undefined) {
    return []
  }
  const projectPrefix = `${manifest.project.root.replace(/\/$/, '')}/`
  return manifest.subjects.filter((subject): subject is Extract<StudioScenarioSubject, { kind: 'view' }> =>
    subject.kind === 'view'
    && (subject.source.path === manifest.project.root || subject.source.path.startsWith(projectPrefix))
  ).map(subject => {
    const required = (manifest.parametersBySubject[subject.subjectId] ?? []).filter(parameter => parameter.required)
    return {
      label: subject.viewName,
      snippet: projectViewSnippet(subject.viewName, required),
      sourcePath: subject.source.path,
      viewName: subject.viewName,
    }
  })
}

function projectViewSnippet(viewName: string, parameters: readonly StudioParameterSchema[]): StudioEditorSnippet {
  const marked = parameters.map(parameter => `${parameter.parameterId}: «${parameterPlaceholder(parameter)}»`).join(
    ', ',
  )
  return editorSnippet(`${viewName}(${marked})`)
}

function parameterPlaceholder(parameter: StudioParameterSchema): string {
  if (parameter.type.kind === 'boolean') {
    return 'false'
  }
  if (parameter.type.kind === 'number') {
    return '0'
  }
  if (parameter.type.kind === 'time') {
    return 'now'
  }
  if (parameter.type.kind === 'choice') {
    const first = parameter.type.values[0]
    return typeof first === 'string' ? first : String(first ?? 'none')
  }
  return parameter.type.kind === 'text' ? '"text"' : 'none'
}
