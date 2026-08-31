import type { StudioRenderInspection, StudioStyleLandingScope } from '@source-actions'
import {
  type StudioEditorSnippet,
  StudioInspector,
  type StudioInspectorSelection,
  studioPaletteComponents,
  type StudioProjectViewPaletteItem,
} from '../StudioInspector'
import type { StudioPreviewManifestV2 } from '../StudioPreviewManifest'
import type { StudioCanonicalSourceAction } from '../StudioProtocol'

export type StudioInspectorContext = 'Actions' | 'Data' | 'Layout' | 'Style'

export type StudioPaletteDragItem =
  | {
    component: (typeof studioPaletteComponents)[number]['component']
    kind: 'component'
    snippet: StudioEditorSnippet
  }
  | { kind: 'project-view'; snippet: StudioEditorSnippet; viewName: string }

export const studioPaletteMime = 'application/x-tao-studio-palette'

export const StudioPaletteTransfer = {
  parse(value: string): StudioPaletteDragItem | undefined {
    try {
      const parsed = JSON.parse(value) as unknown
      if (!isRecord(parsed) || !isEditorSnippet(parsed['snippet'])) {
        return undefined
      }
      if (
        parsed['kind'] === 'component'
        && typeof parsed['component'] === 'string'
        && studioPaletteComponents.some(component => component.component === parsed['component'])
      ) {
        return parsed as StudioPaletteDragItem
      }
      return parsed['kind'] === 'project-view' && typeof parsed['viewName'] === 'string'
        ? parsed as StudioPaletteDragItem
        : undefined
    } catch {
      return undefined
    }
  },
  serialize(item: StudioPaletteDragItem): string {
    return JSON.stringify(item)
  },
} as const

function isEditorSnippet(value: unknown): value is StudioEditorSnippet {
  if (!isRecord(value) || typeof value['text'] !== 'string') {
    return false
  }
  const text = value['text']
  return Array.isArray(value['placeholders'])
    && value['placeholders'].every(range =>
      isRecord(range)
      && Number.isSafeInteger(range['start'])
      && Number.isSafeInteger(range['end'])
      && Number(range['start']) >= 0
      && Number(range['end']) >= Number(range['start'])
      && Number(range['end']) <= text.length
    )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function renderComponentPalette(
  parent: HTMLElement,
  insert: (component: (typeof studioPaletteComponents)[number]) => void,
): void {
  parent.replaceChildren(...(['Element', 'Container'] as const).map(category => {
    const section = document.createElement('section')
    section.className = 'studio-palette-group'
    const heading = document.createElement('h3')
    heading.textContent = `${category}s`
    const choices = document.createElement('div')
    choices.className = 'studio-palette-choices'
    choices.append(
      ...studioPaletteComponents.filter(component => component.category === category).map(component => {
        const button = document.createElement('button')
        button.className = 'studio-palette-button'
        button.dataset['taoStudioComponent'] = component.label
        button.textContent = component.label
        button.title = `Insert ${component.label}`
        button.type = 'button'
        button.draggable = true
        button.addEventListener('dragstart', event => {
          event.dataTransfer?.setData(
            studioPaletteMime,
            StudioPaletteTransfer.serialize({
              component: component.component,
              kind: 'component',
              snippet: component.snippet,
            }),
          )
        })
        button.addEventListener('click', () => insert(component))
        return button
      }),
    )
    section.append(heading, choices)
    return section
  }))
}

export function renderProjectViews(
  parent: HTMLElement,
  manifest: StudioPreviewManifestV2 | undefined,
  insert: (view: StudioProjectViewPaletteItem) => void,
): void {
  const views = StudioInspector.projectViews(manifest)
  if (views.length === 0) {
    const empty = document.createElement('span')
    empty.className = 'studio-palette-empty'
    empty.textContent = manifest === undefined ? 'Waiting for compiled views' : 'No project views'
    parent.replaceChildren(empty)
    return
  }
  parent.replaceChildren(...views.map(view => {
    const button = document.createElement('button')
    button.className = 'studio-palette-button'
    button.dataset['taoStudioProjectView'] = view.viewName
    button.textContent = view.label
    button.title = `Insert ${view.snippet.text}`
    button.type = 'button'
    button.draggable = true
    button.addEventListener('dragstart', event => {
      event.dataTransfer?.setData(
        studioPaletteMime,
        StudioPaletteTransfer.serialize({
          kind: 'project-view',
          snippet: view.snippet,
          viewName: view.viewName,
        }),
      )
    })
    button.addEventListener('click', () => insert(view))
    return button
  }))
}

export function renderInspectorPanel(parent: HTMLElement, options: {
  busy: boolean
  canUndo: boolean
  context: StudioInspectorContext
  currentSourceVersion?: string
  inspection?: StudioRenderInspection
  onAction: (action: StudioCanonicalSourceAction) => void
  onUndo: () => void
  selection?: StudioInspectorSelection
}): void {
  const heading = document.createElement('h2')
  heading.textContent = options.context
  const undo = document.createElement('button')
  undo.className = 'studio-inspector-button studio-undo'
  undo.dataset['taoStudioUndo'] = 'true'
  undo.disabled = options.busy || !options.canUndo
  undo.textContent = 'Undo visual edit'
  undo.type = 'button'
  undo.addEventListener('click', options.onUndo)
  const selection = options.selection
  if (selection === undefined) {
    const empty = document.createElement('p')
    empty.className = 'studio-inspector-empty'
    empty.textContent = 'Select a rendered element in the preview.'
    parent.replaceChildren(heading, undo, empty)
    return
  }
  const current = selection.identity.sourceVersion === options.currentSourceVersion
  const summary = document.createElement('dl')
  summary.className = 'studio-inspector-summary'
  appendInspectorRow(summary, 'Source', projectPathLabel(selection.identity.path))
  appendInspectorRow(summary, 'Range', `${selection.range.start}–${selection.range.end}`)
  appendInspectorRow(summary, 'Version', current ? 'Current' : 'Waiting for refreshed preview')
  const content = options.inspection === undefined
    ? inspectorNote('Reading parsed render values…')
    : options.context === 'Layout'
    ? renderLayoutControls(options.inspection, selection, options)
    : options.context === 'Style'
    ? renderStyleControls(options.inspection, selection, options)
    : options.context === 'Actions'
    ? renderActionControls(selection, options)
    : inspectorNote('No data binding metadata is published for this render yet.')
  parent.replaceChildren(heading, undo, summary, content)
}

function renderLayoutControls(
  inspection: StudioRenderInspection,
  selection: StudioInspectorSelection,
  options: { busy: boolean; currentSourceVersion?: string; onAction: (action: StudioCanonicalSourceAction) => void },
): HTMLElement {
  const controls = document.createElement('div')
  controls.className = 'studio-inspector-controls'
  const disabled = options.busy || selection.identity.sourceVersion !== options.currentSourceVersion
  controls.append(
    numericLayoutControl('Gap', 'gap', inspection, disabled, options.onAction, selection.renderId),
    numericLayoutControl('Padding', 'pad', inspection, disabled, options.onAction, selection.renderId),
    dimensionLayoutControl('Width', 'width', inspection, disabled, options.onAction, selection.renderId),
    dimensionLayoutControl('Height', 'height', inspection, disabled, options.onAction, selection.renderId),
    choiceLayoutControl(
      'Alignment',
      'aligned',
      ['baseline', 'bottom', 'center', 'left', 'right', 'top'],
      inspection,
      disabled,
      options.onAction,
      selection.renderId,
    ),
  )
  return controls
}

function numericLayoutControl(
  label: string,
  head: 'gap' | 'pad',
  inspection: StudioRenderInspection,
  disabled: boolean,
  apply: (action: StudioCanonicalSourceAction) => void,
  renderId: string,
): HTMLElement {
  const input = document.createElement('input')
  input.disabled = disabled
  input.min = '1'
  input.step = '1'
  input.type = 'number'
  input.value = String(layoutEntry(inspection, head)?.[1] ?? 8)
  input.addEventListener('change', () => {
    if (Number.isFinite(input.valueAsNumber)) {
      apply({ entry: [head, input.valueAsNumber], kind: 'set-layout-entry', renderId })
    }
  })
  return inspectorField(label, input)
}

function dimensionLayoutControl(
  label: string,
  head: 'height' | 'width',
  inspection: StudioRenderInspection,
  disabled: boolean,
  apply: (action: StudioCanonicalSourceAction) => void,
  renderId: string,
): HTMLElement {
  const current = layoutEntry(inspection, head)
  const mode = document.createElement('select')
  for (const [value, text] of [['fill', 'Fill'], ['fixed', 'Fixed']] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    mode.append(option)
  }
  mode.disabled = disabled
  mode.value = typeof current?.[1] === 'number' ? 'fixed' : 'fill'
  const value = document.createElement('input')
  value.disabled = disabled || mode.value !== 'fixed'
  value.min = '1'
  value.type = 'number'
  value.value = String(typeof current?.[1] === 'number' ? current[1] : 320)
  const commit = (): void => {
    const next = mode.value === 'fill' ? 'fill' : value.valueAsNumber
    if (next === 'fill' || Number.isFinite(next)) {
      apply({ entry: [head, next], kind: 'set-layout-entry', renderId })
    }
  }
  mode.addEventListener('change', () => {
    value.disabled = disabled || mode.value !== 'fixed'
    commit()
  })
  value.addEventListener('change', commit)
  const row = document.createElement('span')
  row.className = 'studio-inspector-inline-controls'
  row.append(mode, value)
  return inspectorField(label, row)
}

function choiceLayoutControl(
  label: string,
  head: string,
  values: readonly string[],
  inspection: StudioRenderInspection,
  disabled: boolean,
  apply: (action: StudioCanonicalSourceAction) => void,
  renderId: string,
): HTMLElement {
  const select = document.createElement('select')
  select.disabled = disabled
  for (const value of values) {
    const option = document.createElement('option')
    option.textContent = value
    option.value = value
    select.append(option)
  }
  select.value = String(layoutEntry(inspection, head)?.[1] ?? values[0])
  select.addEventListener('change', () => apply({ entry: [head, select.value], kind: 'set-layout-entry', renderId }))
  return inspectorField(label, select)
}

function renderStyleControls(
  inspection: StudioRenderInspection,
  selection: StudioInspectorSelection,
  options: { busy: boolean; currentSourceVersion?: string; onAction: (action: StudioCanonicalSourceAction) => void },
): HTMLElement {
  const controls = document.createElement('div')
  controls.className = 'studio-inspector-controls'
  const bundle = inspection.styleProvenance.find(provenance => provenance.landing.kind === 'style-bundle')
  const current = inspection.explorations[0]
    ?? bundle?.chain[1]?.split(/\s+/)
    ?? inspection.styleEntries[0]
    ?? ['fg', 'ink']
  const head = document.createElement('input')
  const value = document.createElement('input')
  head.value = String(current[0])
  value.value = current.slice(1).join(' ')
  const landing = document.createElement('select')
  const scopes: Array<{ disabled?: boolean; label: string; landing: StudioStyleLandingScope }> = [
    { label: 'Element inline', landing: { kind: 'element-inline' } },
  ]
  for (const provenance of inspection.styleProvenance) {
    const styleLanding = provenance.landing.kind === 'style-bundle' ? provenance.landing : undefined
    if (
      styleLanding !== undefined && !scopes.some(scope =>
        scope.landing.kind === 'style-bundle'
        && scope.landing.bundleName === styleLanding.bundleName
      )
    ) {
      scopes.push({
        ...(provenance.editable === false ? { disabled: true } : {}),
        label: `Edit style ${styleLanding.bundleName} · affects ${provenance.blastRadius}`,
        landing: styleLanding,
      })
      scopes.push({
        ...(provenance.editable === false ? { disabled: true } : {}),
        label: `Fork style ${styleLanding.bundleName} · selected render only`,
        landing: { bundleName: styleLanding.bundleName, kind: 'style-bundle', mode: 'fork' },
      })
    }
  }
  if (inspection.elementName !== undefined) {
    scopes.push({
      ...(inspection.design?.editable === false ? { disabled: true } : {}),
      label: `Promote to ${inspection.elementName} default`,
      landing: { elementName: inspection.elementName, kind: 'element-default' },
    })
  }
  if (
    (current[0] === 'bg' || current[0] === 'border' || current[0] === 'fg')
    && typeof current[1] === 'string'
    && current[1].startsWith('#')
  ) {
    scopes.push({
      ...(inspection.design?.editable === false ? { disabled: true } : {}),
      label: `Promote to color token ${current[0]}Color`,
      landing: { kind: 'token', tokenName: `${current[0]}Color` },
    })
  }
  for (const [index, scope] of scopes.entries()) {
    const option = document.createElement('option')
    option.disabled = scope.disabled === true
    option.value = String(index)
    option.textContent = scope.label
    landing.append(option)
  }
  if (bundle !== undefined) {
    landing.value = String(scopes.findIndex(scope =>
      scope.landing.kind === 'style-bundle'
      && bundle.landing.kind === 'style-bundle'
      && scope.landing.bundleName === bundle.landing.bundleName
    ))
  }
  const apply = document.createElement('button')
  apply.className = 'studio-inspector-button'
  apply.disabled = options.busy || selection.identity.sourceVersion !== options.currentSourceVersion
  apply.textContent = 'Apply style entry'
  apply.type = 'button'
  apply.addEventListener('click', () => {
    const terms = value.value.trim().split(/\s+/).filter(Boolean).map(term => {
      const number = Number(term)
      return Number.isFinite(number) && term !== '' ? number : term
    })
    const scope = scopes[Number(landing.value)]?.landing ?? { kind: 'element-inline' as const }
    const provenance = inspection.styleProvenance.find(candidate =>
      candidate.landing.kind === 'style-bundle'
      && scope.kind === 'style-bundle'
      && candidate.landing.bundleName === scope.bundleName
    )
    if (
      provenance !== undefined
      && provenance.blastRadius > 1
      && !window.confirm(
        `Edit shared style '${
          scope.kind === 'style-bundle' ? scope.bundleName : ''
        }' across ${provenance.blastRadius} renders? Choose the fork landing to affect only this render.`,
      )
    ) {
      return
    }
    options.onAction({
      entry: [head.value, ...terms],
      kind: 'set-style-entry',
      landing: scope,
      renderId: selection.renderId,
    })
  })
  controls.append(
    inspectorField('Property', head),
    inspectorField('Value', value),
    inspectorField('Landing', landing),
    apply,
  )
  const unavailable = options.busy || selection.identity.sourceVersion !== options.currentSourceVersion
  for (const exploration of inspection.explorations) {
    const label = exploration.join(' ')
    const promotion = document.createElement('div')
    promotion.className = 'studio-inspector-inline-controls'
    const localBundle = inspection.styleProvenance.find(provenance =>
      provenance.editable !== false && provenance.landing.kind === 'style-bundle'
    )
    if (localBundle?.landing.kind === 'style-bundle') {
      promotion.append(inspectorActionButton(
        `Promote ${label} to forked style`,
        'promote-style-fork',
        unavailable,
        () =>
          options.onAction({
            entry: exploration,
            kind: 'set-style-entry',
            landing: { ...localBundle.landing, mode: 'fork' },
            renderId: selection.renderId,
          }),
      ))
    }
    if (inspection.elementName !== undefined) {
      promotion.append(inspectorActionButton(
        `Promote ${label} to ${inspection.elementName} default`,
        'promote-element-default',
        unavailable || inspection.design?.editable === false,
        () =>
          options.onAction({
            entry: exploration,
            kind: 'set-style-entry',
            landing: { elementName: inspection.elementName!, kind: 'element-default' },
            renderId: selection.renderId,
          }),
      ))
    }
    if (
      (exploration[0] === 'bg' || exploration[0] === 'border' || exploration[0] === 'fg')
      && typeof exploration[1] === 'string'
      && exploration[1].startsWith('#')
    ) {
      promotion.append(inspectorActionButton(
        `Promote ${label} to token`,
        'promote-color-token',
        unavailable || inspection.design?.editable === false,
        () =>
          options.onAction({
            entry: exploration,
            kind: 'set-style-entry',
            landing: { kind: 'token', tokenName: `${exploration[0]}Color` },
            renderId: selection.renderId,
          }),
      ))
    }
    if (promotion.childElementCount > 0) {
      controls.append(inspectorField(`Explore ${label}`, promotion))
    }
  }
  for (const provenance of inspection.styleProvenance) {
    controls.append(inspectorNote(
      `${provenance.chain.join(' ← ')} · affects ${provenance.blastRadius} render${
        provenance.reason === undefined ? '' : ` · ${provenance.reason}`
      }`,
    ))
  }
  if (inspection.design?.reason !== undefined) {
    controls.append(inspectorNote(inspection.design.reason))
  }
  return controls
}

function renderActionControls(
  selection: StudioInspectorSelection,
  options: { busy: boolean; currentSourceVersion?: string; onAction: (action: StudioCanonicalSourceAction) => void },
): HTMLElement {
  const controls = document.createElement('div')
  controls.className = 'studio-inspector-controls'
  controls.append(inspectorActionButton(
    'Wrap in Stack',
    'wrap-stack',
    options.busy || selection.identity.sourceVersion !== options.currentSourceVersion,
    () => options.onAction({ kind: 'wrap-render', renderId: selection.renderId, wrapper: 'Stack' }),
  ))
  return controls
}

function layoutEntry(inspection: StudioRenderInspection, head: string): readonly (number | string)[] | undefined {
  return inspection.layoutEntries.findLast(entry => entry[0] === head)
}

function inspectorField(label: string, control: HTMLElement): HTMLElement {
  const field = document.createElement('label')
  field.className = 'studio-inspector-field'
  const name = document.createElement('span')
  name.textContent = label
  field.append(name, control)
  return field
}

function inspectorNote(text: string): HTMLElement {
  const note = document.createElement('p')
  note.className = 'studio-inspector-empty'
  note.textContent = text
  return note
}

function inspectorActionButton(
  label: string,
  action: string,
  disabled: boolean,
  apply: () => void,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'studio-inspector-button'
  button.dataset['taoStudioInspectorAction'] = action
  button.disabled = disabled
  button.textContent = label
  button.type = 'button'
  button.addEventListener('click', apply)
  return button
}

function appendInspectorRow(parent: HTMLElement, term: string, value: string): void {
  const dt = document.createElement('dt')
  const dd = document.createElement('dd')
  dt.textContent = term
  dd.textContent = value
  parent.append(dt, dd)
}

function projectPathLabel(path: string): string {
  return path.split('/').at(-1) ?? path
}

export function sourceActionLabel(action: StudioCanonicalSourceAction): string {
  return action.kind.replaceAll('-', ' ')
}

export function showSourceActionError(element: HTMLElement, error: unknown): void {
  element.dataset['state'] = 'error'
  element.textContent = error instanceof Error ? error.message : String(error)
}
