import type { StudioRenderInspection } from '@source-actions'
import { StudioInspector } from '../../StudioInspector'
import type { StudioCanonicalSourceAction } from '../../StudioProtocol'
import type { StudioSelectionCommand } from './StudioSelectionGrouping'

type Bounds = Readonly<{ bottom: number; left: number; right: number; top: number }>

/** What the HUD shows for one inspected element: the handful of layout choices made most often. */
export type StudioSelectionHudModel = Readonly<{
  alignment: string
  /** Present only when the element is itself a Row or Col, whose direction the HUD flips. */
  direction?: 'Col' | 'Row'
  element: string
  gap: string
  pad: string
  sizing: string
}>

export type StudioSelectionHudControl = 'alignment' | 'direction' | 'gap' | 'pad' | 'sizing'

const studioSelectionHudAlignments = [
  'unset',
  'fill',
  'centered',
  'left',
  'center',
  'right',
  'top',
  'bottom',
  'baseline',
] as const

const studioSelectionHudSizings = ['unset', 'fill', 'hug'] as const

/** The layout heads each HUD control writes, which choosing "—" or emptying the field removes. */
const studioSelectionHudHeads: Readonly<Record<Exclude<StudioSelectionHudControl, 'direction'>, readonly string[]>> = {
  alignment: ['aligned', 'centered', 'fill'],
  gap: ['gap'],
  pad: ['pad'],
  sizing: ['claim', 'fill', 'hug'],
}

export function studioSelectionHudModel(inspection: StudioRenderInspection): StudioSelectionHudModel {
  const layout = StudioInspector.layout(inspection)
  const element = inspection.elementName ?? 'Element'
  return {
    alignment: layout.alignment.mode === 'aligned' ? layout.alignment.value : layout.alignment.mode,
    ...(element === 'Row' || element === 'Col' ? { direction: element } : {}),
    element,
    gap: layout.gap === undefined ? '' : String(layout.gap),
    pad: layout.padding?.[0] === 'pad' ? layout.padding.slice(1).join(' ') : '',
    sizing: layout.growth.mode === 'claim' ? `claim ${layout.growth.value}` : layout.growth.mode,
  }
}

/**
 * The one source action a HUD control commits, or nothing while its draft is not a valid value. "—"
 * in a picker and an emptied field both clear the control's entry.
 */
export function studioSelectionHudAction(
  renderId: string,
  control: StudioSelectionHudControl,
  value: string,
): StudioCanonicalSourceAction | undefined {
  if (control === 'direction') {
    return { kind: 'toggle-flow-direction', renderId }
  }
  if (value === '' || value === 'unset') {
    return { heads: studioSelectionHudHeads[control], kind: 'clear-layout-entry', renderId }
  }
  const entry = control === 'gap'
    ? gapEntry(value)
    : control === 'pad'
    ? StudioInspector.spacingEntryDraft('pad', value)
    : control === 'alignment'
    ? alignmentEntry(value)
    : value === 'fill' || value === 'hug'
    ? [value] as const
    : undefined
  return entry === undefined ? undefined : StudioInspector.layoutAction(renderId, entry)
}

function gapEntry(value: string): readonly ['gap', string | number] | undefined {
  const size = StudioInspector.layoutSizeDraft(value)
  return size === undefined ? undefined : ['gap', size]
}

function alignmentEntry(value: string) {
  if (value === 'fill' || value === 'centered') {
    return [value] as const
  }
  return value === 'baseline' || value === 'bottom' || value === 'center' || value === 'left'
      || value === 'right' || value === 'top'
    ? ['aligned', value] as const
    : undefined
}

/**
 * Where the HUD sits, relative to its host: just under the selection, above it when there is no room
 * below, and always inside the host with a small margin.
 */
export function studioSelectionHudPlacement(
  selection: Bounds,
  host: Bounds,
  hud: Readonly<{ height: number; width: number }>,
): Readonly<{ left: number; top: number }> {
  const margin = 8
  const below = selection.bottom + margin
  const above = selection.top - margin - hud.height
  const top = below + hud.height <= host.bottom - margin || above < host.top + margin ? below : above
  const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, high))
  return {
    left: clamp(selection.left, host.left + margin, host.right - margin - hud.width) - host.left,
    top: clamp(top, host.top + margin, host.bottom - margin - hud.height) - host.top,
  }
}

export type StudioSelectionHudDeps = Readonly<{
  apply: (action: StudioCanonicalSourceAction) => void
  bounds: () => Bounds | undefined
  busy: () => boolean
  command: (command: StudioSelectionCommand) => void
  enabled: () => boolean
  groupSize: () => number
  host: HTMLElement
  inspection: () => StudioRenderInspection | undefined
  selectedRenderId: () => string | undefined
}>

/**
 * The selection HUD floats beside the element selected in the preview, in Design, Draw, or Edit mode: direction,
 * alignment, gap, pad and sizing, each one edit away. With several elements selected it offers ⌘G
 * and ⌥⌘G instead. `render` rebuilds it for a new selection; `place` only follows pan, zoom and
 * layout.
 */
export function mountStudioSelectionHud(
  deps: StudioSelectionHudDeps,
): Readonly<{ dispose: () => void; place: () => void; render: () => void }> {
  const root = document.createElement('div')
  root.className = 'studio-selection-hud'
  root.dataset['taoStudioSelectionHud'] = ''
  root.dataset['taoStudioCanvasChrome'] = ''
  root.setAttribute('role', 'toolbar')
  root.setAttribute('aria-label', 'Selection layout')
  root.hidden = true
  deps.host.append(root)
  let shownKey: string | undefined
  let shownRenderId: string | undefined
  let frame: number | undefined

  const place = (): void => {
    if (frame !== undefined) {
      return
    }
    frame = requestAnimationFrame(() => {
      frame = undefined
      const bounds = root.hidden ? undefined : deps.bounds()
      root.style.visibility = bounds === undefined ? 'hidden' : ''
      if (bounds === undefined) {
        return
      }
      const host = deps.host.getBoundingClientRect()
      const position = studioSelectionHudPlacement(bounds, host, {
        height: root.offsetHeight,
        width: root.offsetWidth,
      })
      root.style.left = `${position.left + deps.host.scrollLeft}px`
      root.style.top = `${position.top + deps.host.scrollTop}px`
    })
  }

  const render = (): void => {
    // Mounting the preview matrix replaces the host's children, so the HUD re-attaches when it renders.
    if (root.parentElement !== deps.host) {
      deps.host.append(root)
    }
    const renderId = deps.selectedRenderId()
    const inspection = deps.inspection()
    const groupSize = deps.groupSize()
    const current = inspection !== undefined && inspection.renderId === renderId ? inspection : undefined
    root.hidden = !deps.enabled() || renderId === undefined || (groupSize < 2 && current === undefined)
    const busy = deps.busy()
    const key = root.hidden ? undefined : JSON.stringify([renderId, groupSize, busy, current?.layoutEntries])
    // A draft being typed survives the publishes that happen around it; a new selection replaces it.
    const typing = root.contains(document.activeElement) && document.activeElement !== root
    if (key !== shownKey && !(typing && key !== undefined && renderId === shownRenderId)) {
      shownKey = key
      shownRenderId = renderId
      root.replaceChildren(
        ...(renderId === undefined || root.hidden
          ? []
          : groupSize > 1
          ? groupControls(groupSize, deps.command)
          : layoutControls(studioSelectionHudModel(current!), busy, (control, value) => {
            const action = studioSelectionHudAction(renderId, control, value)
            if (action !== undefined) {
              deps.apply(action)
            }
          })),
      )
    }
    place()
  }

  const onResize = (): void => place()
  window.addEventListener('resize', onResize)
  render()
  return {
    dispose() {
      window.removeEventListener('resize', onResize)
      if (frame !== undefined) {
        cancelAnimationFrame(frame)
      }
      root.remove()
    },
    place,
    render,
  }
}

function groupControls(size: number, command: (command: StudioSelectionCommand) => void): HTMLElement[] {
  const count = document.createElement('span')
  count.className = 'studio-selection-hud-name'
  count.textContent = `${size} selected`
  const makeView = hudButton('Make view', '⌘G', () => command('make-view'))
  const group = hudButton('Group', '⌥⌘G', () => command('group'))
  return [count, makeView, group]
}

function layoutControls(
  model: StudioSelectionHudModel,
  busy: boolean,
  commit: (control: StudioSelectionHudControl, value: string) => void,
): HTMLElement[] {
  const name = document.createElement('span')
  name.className = 'studio-selection-hud-name'
  name.textContent = model.element
  const controls: HTMLElement[] = [name]
  if (model.direction !== undefined) {
    const next = model.direction === 'Row' ? 'Col' : 'Row'
    controls.push(
      hudButton(model.direction === 'Row' ? '→ Row' : '↓ Col', `Flip to ${next}`, () => commit('direction', next)),
    )
    controls.push(hudField('Gap', model.gap, value => commit('gap', value)))
  }
  controls.push(
    hudPicker('Align', model.alignment, studioSelectionHudAlignments, value => commit('alignment', value)),
    hudField('Pad', model.pad, value => commit('pad', value)),
    hudPicker('Size', model.sizing, studioSelectionHudSizings, value => commit('sizing', value)),
  )
  // While an edit is in flight the controls wait for it rather than queue a second one.
  for (const field of controls.flatMap(control => [control, ...control.querySelectorAll('*')])) {
    if (field instanceof HTMLButtonElement || field instanceof HTMLInputElement || field instanceof HTMLSelectElement) {
      field.disabled = busy
    }
  }
  return controls
}

function hudButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.title = title
  button.addEventListener('click', onClick)
  return button
}

function hudField(label: string, value: string, commit: (value: string) => void): HTMLLabelElement {
  const wrapper = document.createElement('label')
  const caption = document.createElement('span')
  caption.textContent = label
  const input = document.createElement('input')
  input.value = value
  input.placeholder = '—'
  input.size = 4
  input.spellcheck = false
  input.addEventListener('change', () => {
    if (input.value.trim() !== value) {
      commit(input.value.trim())
    }
  })
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      input.value = value
      input.blur()
    }
  })
  wrapper.append(caption, input)
  return wrapper
}

function hudPicker(
  label: string,
  value: string,
  options: readonly string[],
  commit: (value: string) => void,
): HTMLLabelElement {
  const wrapper = document.createElement('label')
  const caption = document.createElement('span')
  caption.textContent = label
  const select = document.createElement('select')
  // The current value leads even when the HUD cannot set it (a claim weight), so the picker never shows
  // a choice that is not in the source. "—" is the unset choice, and picking it clears the entry.
  const choices = options.includes(value) ? options : [value, ...options]
  for (const choice of choices) {
    const option = document.createElement('option')
    option.value = choice
    option.textContent = choice === 'unset' ? '—' : choice
    option.disabled = !options.includes(choice)
    select.append(option)
  }
  select.value = value
  select.addEventListener('change', () => commit(select.value))
  wrapper.append(caption, select)
  return wrapper
}
