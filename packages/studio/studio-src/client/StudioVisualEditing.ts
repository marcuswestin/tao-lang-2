import type {
  StudioLayoutAlignment,
  StudioLayoutContentTerm,
  StudioLayoutEntry,
  StudioLayoutSizeValue,
  StudioRenderInspection,
  StudioStyleLandingScope,
} from '@source-actions'
import {
  type StudioEditorSnippet,
  StudioInspector,
  type StudioInspectorSelection,
  studioPaletteComponents,
  type StudioProjectViewPaletteItem,
  studioStyleProperties,
} from '../StudioInspector'
import type { StudioPreviewManifestV2 } from '../StudioPreviewManifest'
import type { StudioCanonicalSourceAction } from '../StudioProtocol'

export type StudioInspectorContext = 'Actions' | 'Data' | 'Layout' | 'Style'

export const studioInspectorContexts: readonly StudioInspectorContext[] = ['Layout', 'Style', 'Data', 'Actions']

type StudioInspectorPanelOptions = {
  busy: boolean
  canUndo: boolean
  currentSourceVersion?: string
  inspection?: StudioRenderInspection
  onAction: (action: StudioCanonicalSourceAction) => void
  /** Style actions use the server proposal/review/apply path rather than direct application. */
  onStyleAction?: (action: StudioCanonicalSourceAction) => void
  onUndo: () => void
  selection?: StudioInspectorSelection
}

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

export function renderInspectorPanel(
  parent: HTMLElement,
  options: StudioInspectorPanelOptions & { context: StudioInspectorContext },
): void {
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
  const content = renderInspectorContext(options.context, selection, options)
  parent.replaceChildren(heading, undo, summary, content)
}

/** Renders every visual editing context as an independently collapsible, initially open section. */
export function renderInspectorAccordions(parent: HTMLElement, options: StudioInspectorPanelOptions): void {
  const previousOpen = new Map(
    [...parent.querySelectorAll<HTMLDetailsElement>('[data-tao-studio-inspector-context]')].map(details => [
      details.dataset['taoStudioInspectorContext'] as StudioInspectorContext,
      details.open,
    ]),
  )
  const heading = document.createElement('h2')
  heading.textContent = 'Visual properties'
  const undo = document.createElement('button')
  undo.className = 'studio-inspector-button studio-undo'
  undo.dataset['taoStudioUndo'] = 'true'
  undo.disabled = options.busy || !options.canUndo
  undo.textContent = 'Undo visual edit'
  undo.type = 'button'
  undo.addEventListener('click', options.onUndo)
  const selection = options.selection
  const empty = selection === undefined
    ? (() => {
      const note = document.createElement('p')
      note.className = 'studio-inspector-empty'
      note.textContent = 'Select a rendered element in the preview.'
      return note
    })()
    : undefined
  const source = selection === undefined
    ? undefined
    : (() => {
      const current = selection.identity.sourceVersion === options.currentSourceVersion
      const summary = document.createElement('dl')
      summary.className = 'studio-inspector-summary'
      appendInspectorRow(summary, 'Source', projectPathLabel(selection.identity.path))
      appendInspectorRow(summary, 'Range', `${selection.range.start}–${selection.range.end}`)
      appendInspectorRow(summary, 'Version', current ? 'Current' : 'Waiting for refreshed preview')
      return summary
    })()
  const accordions = document.createElement('div')
  accordions.className = 'studio-inspector-accordions'
  accordions.append(...studioInspectorContexts.map(context => {
    const details = document.createElement('details')
    details.className = 'studio-inspector-accordion'
    details.dataset['taoStudioInspectorContext'] = context
    details.open = previousOpen.get(context) ?? true
    const label = document.createElement('summary')
    label.textContent = context
    const content = document.createElement('div')
    content.className = 'studio-inspector-accordion-content'
    content.append(
      selection === undefined
        ? inspectorNote('Select an element to edit this context.')
        : renderInspectorContext(context, selection, options),
    )
    details.append(label, content)
    return details
  }))
  const children: Node[] = [heading, undo]
  if (empty !== undefined) {
    children.push(empty)
  }
  if (source !== undefined) {
    children.push(source)
  }
  children.push(accordions)
  parent.replaceChildren(...children)
}

function renderInspectorContext(
  context: StudioInspectorContext,
  selection: StudioInspectorSelection,
  options: StudioInspectorPanelOptions,
): HTMLElement {
  return options.inspection === undefined
    ? inspectorNote('Reading parsed render values…')
    : context === 'Layout'
    ? renderLayoutControls(options.inspection, selection, options)
    : context === 'Style'
    ? renderStyleControls(options.inspection, selection, options)
    : context === 'Actions'
    ? renderActionControls(selection, options)
    : inspectorNote('No data binding metadata is published for this render yet.')
}

function renderLayoutControls(
  inspection: StudioRenderInspection,
  selection: StudioInspectorSelection,
  options: { busy: boolean; currentSourceVersion?: string; onAction: (action: StudioCanonicalSourceAction) => void },
): HTMLElement {
  const controls = document.createElement('div')
  controls.className = 'studio-inspector-controls'
  const disabled = options.busy || selection.identity.sourceVersion !== options.currentSourceVersion
  const model = StudioInspector.layout(inspection)
  controls.append(
    numericLayoutControl('Gap', model.gap, disabled, value => ['gap', value], options.onAction, selection.renderId),
    spacingLayoutControl('Padding', 'pad', model.padding, disabled, options.onAction, selection.renderId),
    spacingLayoutControl('Margin', 'margin', model.margin, disabled, options.onAction, selection.renderId),
    dimensionLayoutControl('Width', 'width', model.width, disabled, options.onAction, selection.renderId),
    numericLayoutControl(
      'Max width',
      model.widthCap,
      disabled,
      value => ['width', 'max', value],
      options.onAction,
      selection.renderId,
    ),
    dimensionLayoutControl('Height', 'height', model.height, disabled, options.onAction, selection.renderId),
    growthLayoutControl(model.growth, model.shrink, disabled, options.onAction, selection.renderId),
    shrinkLayoutControl(model.shrink, model.growth.mode, disabled, options.onAction, selection.renderId),
    alignmentLayoutControl(model.alignment, disabled, options.onAction, selection.renderId),
    contentLayoutControl(model.content, disabled, options.onAction, selection.renderId),
    inspectorActionButton(
      'Wrap in Stack',
      'wrap-stack-layout',
      disabled,
      () => options.onAction({ kind: 'wrap-render', renderId: selection.renderId, wrapper: 'Stack' }),
    ),
  )
  return controls
}

function numericLayoutControl(
  label: string,
  current: StudioLayoutSizeValue | undefined,
  disabled: boolean,
  entry: (value: StudioLayoutSizeValue) => StudioLayoutEntry,
  apply: (action: StudioCanonicalSourceAction) => void,
  renderId: string,
): HTMLElement {
  const input = document.createElement('input')
  input.disabled = disabled
  input.placeholder = '8 or spacing.compact'
  input.type = 'text'
  input.value = current === undefined ? '' : String(current)
  input.addEventListener('change', () => {
    const value = StudioInspector.layoutSizeDraft(input.value)
    input.setAttribute('aria-invalid', String(value === undefined))
    if (value !== undefined) {
      apply(StudioInspector.layoutAction(renderId, entry(value)))
    }
  })
  return inspectorField(label, input)
}

function spacingLayoutControl(
  label: string,
  head: 'margin' | 'pad',
  current: StudioLayoutEntry | undefined,
  disabled: boolean,
  apply: (action: StudioCanonicalSourceAction) => void,
  renderId: string,
): HTMLElement {
  const input = document.createElement('input')
  input.disabled = disabled
  input.placeholder = '8 or horizontal 8 vertical 4'
  input.value = current?.[0] === head ? current.slice(1).join(' ') : ''
  input.addEventListener('change', () => {
    const entry = StudioInspector.spacingEntryDraft(head, input.value)
    input.setAttribute('aria-invalid', String(entry === undefined))
    if (entry !== undefined) {
      apply(StudioInspector.layoutAction(renderId, entry))
    }
  })
  return inspectorField(label, input)
}

function dimensionLayoutControl(
  label: string,
  head: 'height' | 'width',
  current: ReturnType<typeof StudioInspector.layout>['width'],
  disabled: boolean,
  apply: (action: StudioCanonicalSourceAction) => void,
  renderId: string,
): HTMLElement {
  const mode = document.createElement('select')
  const modes = [
    ['unset', 'Not set'],
    ['fill', 'Fill'],
    ['fixed', 'Fixed'],
  ] as const
  for (const [value, text] of modes) {
    const option = document.createElement('option')
    option.disabled = value === 'unset'
    option.value = value
    option.textContent = text
    mode.append(option)
  }
  mode.disabled = disabled
  mode.value = current.mode
  const value = document.createElement('input')
  value.disabled = disabled || mode.value !== 'fixed'
  value.placeholder = '320 or surface.card'
  value.type = 'text'
  value.value = 'value' in current ? String(current.value) : ''
  const commit = (): void => {
    if (mode.value === 'fill') {
      apply(StudioInspector.layoutAction(renderId, [head, 'fill']))
      return
    }
    const next = StudioInspector.layoutSizeDraft(value.value)
    value.setAttribute('aria-invalid', String(next === undefined))
    if (next !== undefined) {
      apply(StudioInspector.layoutAction(renderId, [head, next]))
    }
  }
  mode.addEventListener('change', () => {
    value.disabled = disabled || mode.value !== 'fixed'
    if (mode.value !== 'unset') {
      commit()
    }
  })
  value.addEventListener('change', commit)
  const row = document.createElement('span')
  row.className = 'studio-inspector-inline-controls'
  row.append(mode, value)
  return inspectorField(label, row)
}

function growthLayoutControl(
  current: ReturnType<typeof StudioInspector.layout>['growth'],
  shrink: ReturnType<typeof StudioInspector.layout>['shrink'],
  disabled: boolean,
  apply: (action: StudioCanonicalSourceAction) => void,
  renderId: string,
): HTMLElement {
  const mode = document.createElement('select')
  for (
    const [value, text] of [
      ['unset', 'Not set'],
      ['fill', 'Fill'],
      ['claim', 'Claim'],
      ['hug', 'Hug'],
    ] as const
  ) {
    const option = document.createElement('option')
    option.disabled = value === 'unset' || (value === 'claim' && shrink === 'rigid')
    option.textContent = text
    option.value = value
    mode.append(option)
  }
  mode.disabled = disabled
  mode.value = current.mode
  const value = document.createElement('input')
  value.disabled = disabled || mode.value !== 'claim'
  value.min = '1'
  value.type = 'number'
  value.value = current.mode === 'claim' ? String(current.value) : ''
  const commit = (): void => {
    if (mode.value === 'fill' || mode.value === 'hug') {
      apply(StudioInspector.layoutAction(renderId, [mode.value]))
      return
    }
    const claim = StudioInspector.positiveNumberDraft(value.value)
    value.setAttribute('aria-invalid', String(claim === undefined))
    if (mode.value === 'claim' && claim !== undefined) {
      apply(StudioInspector.layoutAction(renderId, ['claim', claim]))
    }
  }
  mode.addEventListener('change', () => {
    value.disabled = disabled || mode.value !== 'claim'
    if (mode.value !== 'unset') {
      commit()
    }
  })
  value.addEventListener('change', commit)
  const row = document.createElement('span')
  row.className = 'studio-inspector-inline-controls'
  row.append(mode, value)
  return inspectorField('Growth', row)
}

function shrinkLayoutControl(
  current: ReturnType<typeof StudioInspector.layout>['shrink'],
  growth: ReturnType<typeof StudioInspector.layout>['growth']['mode'],
  disabled: boolean,
  apply: (action: StudioCanonicalSourceAction) => void,
  renderId: string,
): HTMLElement {
  const select = document.createElement('select')
  for (const [value, text] of [['unset', 'Not set'], ['compress', 'Compress'], ['rigid', 'Rigid']] as const) {
    const option = document.createElement('option')
    option.disabled = value === 'unset' || (value === 'rigid' && growth === 'claim')
    option.textContent = text
    option.value = value
    select.append(option)
  }
  select.disabled = disabled
  select.value = current
  select.addEventListener('change', () => {
    if (select.value === 'compress' || select.value === 'rigid') {
      apply(StudioInspector.layoutAction(renderId, [select.value]))
    }
  })
  return inspectorField('Shrink', select)
}

function alignmentLayoutControl(
  current: ReturnType<typeof StudioInspector.layout>['alignment'],
  disabled: boolean,
  apply: (action: StudioCanonicalSourceAction) => void,
  renderId: string,
): HTMLElement {
  const select = document.createElement('select')
  const values = [
    ['unset', 'Not set'],
    ['fill', 'Fill cross axis'],
    ['centered', 'Centered'],
    ...(['baseline', 'bottom', 'center', 'left', 'right', 'top'] as const).map(value => [`aligned:${value}`, value]),
  ] as const
  for (const [value, text] of values) {
    const option = document.createElement('option')
    option.disabled = value === 'unset'
    option.textContent = text
    option.value = value
    select.append(option)
  }
  select.disabled = disabled
  select.value = current.mode === 'aligned' ? `aligned:${current.value}` : current.mode
  select.addEventListener('change', () => {
    const alignment = select.value.startsWith('aligned:')
      ? select.value.slice('aligned:'.length) as StudioLayoutAlignment
      : undefined
    const entry: StudioLayoutEntry | undefined = alignment === undefined
      ? select.value === 'fill' || select.value === 'centered' ? [select.value] : undefined
      : ['aligned', alignment]
    if (entry !== undefined) {
      apply(StudioInspector.layoutAction(renderId, entry))
    }
  })
  return inspectorField('Self alignment', select)
}

function contentLayoutControl(
  current: readonly StudioLayoutContentTerm[] | undefined,
  disabled: boolean,
  apply: (action: StudioCanonicalSourceAction) => void,
  renderId: string,
): HTMLElement {
  const terms: readonly StudioLayoutContentTerm[] = [
    'baseline',
    'bottom',
    'center',
    'left',
    'right',
    'top',
    'spread',
    'spread-balanced',
    'spread-inset',
    'stretch',
  ]
  const first = contentTermSelect('Not set', current?.[0], terms, disabled)
  const second = contentTermSelect('One term', current?.[1], terms, disabled)
  const commit = (): void => {
    if (first.value === '') {
      return
    }
    const selected = [first.value, ...(second.value === '' ? [] : [second.value])] as StudioLayoutContentTerm[]
    const entry = StudioInspector.contentEntry(selected)
    second.setAttribute('aria-invalid', String(entry === undefined))
    if (entry !== undefined) {
      apply(StudioInspector.layoutAction(renderId, entry))
    }
  }
  first.addEventListener('change', () => {
    const paired = second.value === ''
      ? undefined
      : StudioInspector.contentEntry([first.value, second.value] as StudioLayoutContentTerm[])
    if (paired === undefined) {
      second.value = ''
    }
    commit()
  })
  second.addEventListener('change', commit)
  const row = document.createElement('span')
  row.className = 'studio-inspector-inline-controls'
  row.append(first, second)
  return inspectorField('Content', row)
}

function contentTermSelect(
  emptyLabel: string,
  current: StudioLayoutContentTerm | undefined,
  terms: readonly StudioLayoutContentTerm[],
  disabled: boolean,
): HTMLSelectElement {
  const select = document.createElement('select')
  const empty = document.createElement('option')
  empty.textContent = emptyLabel
  empty.value = ''
  select.append(empty)
  for (const term of terms) {
    const option = document.createElement('option')
    option.textContent = term
    option.value = term
    select.append(option)
  }
  select.disabled = disabled
  select.value = current ?? ''
  return select
}

function renderStyleControls(
  inspection: StudioRenderInspection,
  selection: StudioInspectorSelection,
  options: {
    busy: boolean
    currentSourceVersion?: string
    onStyleAction?: (action: StudioCanonicalSourceAction) => void
  },
): HTMLElement {
  const controls = document.createElement('div')
  controls.className = 'studio-inspector-controls'
  const bundle = inspection.styleProvenance.find(provenance => provenance.landing.kind === 'style-bundle')
  const current =
    inspection.explorations.find(entry => studioStyleProperties.some(property => property.head === entry[0]))
      ?? bundle?.chain[1]?.split(/\s+/)
      ?? inspection.styleEntries[0]
      ?? ['fg', 'ink']
  const head = document.createElement('select')
  const value = document.createElement('input')
  for (const property of studioStyleProperties) {
    const option = document.createElement('option')
    option.textContent = property.label
    option.value = property.head
    head.append(option)
  }
  if (!studioStyleProperties.some(property => property.head === current[0])) {
    const unsupported = document.createElement('option')
    unsupported.disabled = true
    unsupported.textContent = `Unsupported: ${String(current[0])}`
    unsupported.value = String(current[0])
    head.append(unsupported)
  }
  head.value = String(current[0])
  value.value = current.slice(1).join(' ')
  value.type = 'text'
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
    isStudioColorHead(current[0])
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
  apply.disabled = options.busy
    || selection.identity.sourceVersion !== options.currentSourceVersion
    || options.onStyleAction === undefined
  apply.textContent = 'Apply style entry'
  apply.type = 'button'
  apply.addEventListener('click', () => {
    if (options.onStyleAction === undefined) {
      return
    }
    const entry = StudioInspector.styleEntryDraft(head.value, value.value)
    value.setAttribute('aria-invalid', String(entry === undefined))
    if (entry === undefined) {
      return
    }
    const scope = scopes[Number(landing.value)]?.landing ?? { kind: 'element-inline' as const }
    options.onStyleAction(StudioInspector.styleAction({
      entry,
      landing: scope,
      renderId: selection.renderId,
    }))
  })
  controls.append(
    inspectorField('Property', head),
    inspectorField('Value', value),
    inspectorField('Landing', landing),
    apply,
  )
  if (options.onStyleAction === undefined) {
    controls.append(inspectorNote('Style editing is waiting for the server proposal/review path.'))
  }
  const unavailable = options.busy
    || selection.identity.sourceVersion !== options.currentSourceVersion
    || options.onStyleAction === undefined
  for (const exploration of inspection.explorations) {
    const label = exploration.join(' ')
    const promotion = document.createElement('div')
    promotion.className = 'studio-inspector-inline-controls'
    const localBundle = inspection.styleProvenance.find(provenance =>
      provenance.editable !== false && provenance.landing.kind === 'style-bundle'
    )
    if (localBundle?.landing.kind === 'style-bundle') {
      const bundleName = localBundle.landing.bundleName
      promotion.append(inspectorActionButton(
        `Promote ${label} to forked style`,
        'promote-style-fork',
        unavailable,
        () =>
          options.onStyleAction?.(StudioInspector.styleAction({
            entry: exploration,
            landing: { bundleName, kind: 'style-bundle', mode: 'fork' },
            renderId: selection.renderId,
          })),
      ))
    }
    if (inspection.elementName !== undefined) {
      promotion.append(inspectorActionButton(
        `Promote ${label} to ${inspection.elementName} default`,
        'promote-element-default',
        unavailable || inspection.design?.editable === false,
        () =>
          options.onStyleAction?.(StudioInspector.styleAction({
            entry: exploration,
            landing: { elementName: inspection.elementName!, kind: 'element-default' },
            renderId: selection.renderId,
          })),
      ))
    }
    if (
      isStudioColorHead(exploration[0])
      && typeof exploration[1] === 'string'
      && exploration[1].startsWith('#')
    ) {
      promotion.append(inspectorActionButton(
        `Promote ${label} to token`,
        'promote-color-token',
        unavailable || inspection.design?.editable === false,
        () =>
          options.onStyleAction?.(StudioInspector.styleAction({
            entry: exploration,
            landing: { kind: 'token', tokenName: `${exploration[0]}Color` },
            renderId: selection.renderId,
          })),
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

function isStudioColorHead(value: string | number | undefined): boolean {
  return typeof value === 'string'
    && studioStyleProperties.some(property => property.head === value && property.valueKind === 'color')
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
