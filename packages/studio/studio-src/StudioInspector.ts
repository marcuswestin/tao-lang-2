import type {
  StudioParameterSchema,
  StudioPreviewManifestV2,
  StudioScenarioSubject,
} from './StudioPreviewManifest'
import {
  type StudioCanonicalSourceAction,
  type StudioPreviewSourceIdentity,
  type StudioPreviewSourceMessage,
  studioProtocolChannel,
  studioProtocolVersion,
  type StudioSourceActionEnvelope,
  type StudioSourceActionUndoEnvelope,
  studioSourceActionVersion,
  type StudioSourceRange,
} from './StudioProtocol'

export type StudioInspectorSelection = {
  identity: StudioPreviewSourceIdentity
  range: StudioSourceRange
  renderId: string
}

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
  projectViews,
  selection,
  singleAction,
  undo,
} as const

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
  identity: StudioPreviewSourceIdentity
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
  identity: StudioPreviewSourceIdentity
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
