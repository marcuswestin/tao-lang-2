/**
 * The preview area is one pannable, zoomable surface rather than a scrolling column, so every
 * scenario group can be seen at once and any one of them can be brought close. The surface is a
 * single transform on the matrix grid: `translate(x, y) scale(z)` with the grid's own origin at its
 * top left. Cells keep their DOM identity through it, so preview iframes never reload when the
 * person zooms or pans.
 */

import { Switch } from '@shared/core'
import type { StudioCanvasViewport, StudioCanvasZoomCommand } from '../../StudioProtocol'

type StudioCanvasViewportState = StudioCanvasViewport
type CanvasRect = Readonly<{ bottom: number; left: number; right: number; top: number }>

const minimumScale = 0.1
const maximumScale = 4
const panSensitivity = 0.75
const zoomSensitivity = 0.006
const zoomStops = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const

type MutableState = { x: number; y: number; z: number }

const states = new WeakMap<HTMLElement, MutableState>()
const listeners = new WeakMap<HTMLElement, (next: StudioCanvasViewportState) => void>()

function state(host: HTMLElement): MutableState {
  const existing = states.get(host)
  if (existing !== undefined) {
    return existing
  }
  const created: MutableState = { x: 0, y: 0, z: 1 }
  states.set(host, created)
  return created
}

function clampScale(scale: number): number {
  return Math.min(maximumScale, Math.max(minimumScale, scale))
}

function grid(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>(
    host.dataset['canvasWorkspace'] === 'draw'
      ? ':scope > [data-tao-studio-draw-canvas]'
      : ':scope > .studio-preview-grid',
  )
}

/**
 * Both planes the host holds share its pan and zoom: Draw lays the preview grid's running cells over
 * its own canvas, so the two must move as one.
 */
function surfaces(host: HTMLElement): readonly HTMLElement[] {
  return [
    ...host.querySelectorAll<HTMLElement>(':scope > .studio-preview-grid, :scope > [data-tao-studio-draw-canvas]'),
  ]
}

/** canvasScale reports the zoom a node is rendered under, so a pointer gesture can undo it. */
export function canvasScale(node: Element | null | undefined): number {
  const host = node?.closest<HTMLElement>('[data-canvas-surface="on"]') ?? null
  return host === null || node === undefined || !surfaces(host).some(surface => surface.contains(node))
    ? 1
    : states.get(host)?.z ?? 1
}

/** applyCanvasViewport writes the current pan and zoom onto the surfaces; the matrix calls it after each reconcile. */
export function applyCanvasViewport(host: HTMLElement): void {
  if (grid(host) === null) {
    return
  }
  const current = state(host)
  host.dataset['canvasSurface'] = 'on'
  for (const surface of surfaces(host)) {
    surface.style.transform = `translate(${current.x}px, ${current.y}px) scale(${current.z})`
    // Handles and selection strokes scale by the inverse, so they keep one on-screen width at any zoom.
    surface.style.setProperty('--studio-canvas-counter-scale', String(1 / current.z))
  }
  const pill = host.querySelector<HTMLElement>(':scope > .studio-canvas-zoom')
  if (pill !== null) {
    pill.textContent = `${Math.round(current.z * 100)}%`
  }
}

/** canvasRevealDelta is the geometry behind reveal; exported so clipped-host behavior is regression tested. */
export function canvasRevealDelta(
  host: CanvasRect,
  node: CanvasRect,
  padding = 24,
): Readonly<{ x: number; y: number }> {
  const x = node.left < host.left + padding
    ? host.left + padding - node.left
    : node.right > host.right - padding
    ? host.right - padding - node.right
    : 0
  const y = node.top < host.top + padding
    ? host.top + padding - node.top
    : node.bottom > host.bottom - padding
    ? host.bottom - padding - node.bottom
    : 0
  return { x, y }
}

/** revealCanvasNode pans the transformed preview plane; `scrollIntoView` would move the clipped host itself. */
export function revealCanvasNode(node: Element | null | undefined): boolean {
  const host = node?.closest<HTMLElement>('[data-canvas-surface="on"]') ?? null
  if (
    host === null || node === undefined || node === null || !surfaces(host).some(surface => surface.contains(node))
  ) {
    return false
  }
  const delta = canvasRevealDelta(host.getBoundingClientRect(), node.getBoundingClientRect())
  const current = state(host)
  current.x += delta.x
  current.y += delta.y
  applyCanvasViewport(host)
  listeners.get(host)?.({ ...current })
  return true
}

export type StudioCanvasViewportControls = Readonly<{
  cancelPan: () => void
  dispose: () => void
  /** fit frames the whole surface inside the host, the way ⌘0 does in a drawing tool. */
  fit: () => void
  /** reset returns to 100 % with the surface's top left in the host's top left. */
  reset: () => void
  state: () => StudioCanvasViewportState
  /** reveal moves the transformed surface rather than scrolling its clipped host. */
  reveal: (node: Element) => void
  /** iframeWheel forwards wheel/pinch gestures that cannot bubble across the iframe boundary. */
  iframeWheel: (gesture: StudioCanvasWheelGesture, frame: Element) => void
  /** Space presses in a focused preview cannot bubble into the parent document. */
  iframePanKey: (held: boolean, frame: Element) => void
  iframeShortcut: (command: StudioCanvasZoomCommand, frame: Element) => void
  zoomTo: (scale: number, anchor?: Readonly<{ x: number; y: number }>) => void
}>

export type StudioCanvasViewportDeps = Readonly<{
  /** Neutral Design canvas and unfocused previews may offer drag navigation without Space. */
  canPanWithoutSpace?: (event: PointerEvent) => boolean
  /** Canvas shortcuts are active in the Design and Draw presets. */
  enabled?: () => boolean
  host: HTMLElement
  initialState?: StudioCanvasViewportState
  /** Target rectangles use browser viewport coordinates, including the current canvas transform. */
  selectionBounds?: () => CanvasRect | undefined
  focusedBounds?: () => CanvasRect | undefined
  onGestureEnd?: () => void
  /** Runs after every pan or zoom, so a caller can persist the viewport. */
  onChange?: (next: StudioCanvasViewportState) => void
}>

type StudioCanvasWheelGesture = Readonly<{
  clientX: number
  clientY: number
  deltaX: number
  deltaY: number
  zoom: boolean
}>

/** Translates iframe-local wheel coordinates into the surrounding canvas host's coordinate space. */
export function canvasIframeGestureAnchor(
  host: Pick<DOMRect, 'left' | 'top'>,
  iframe: Pick<DOMRect, 'left' | 'top'>,
  gesture: Pick<StudioCanvasWheelGesture, 'clientX' | 'clientY'>,
): Readonly<{ x: number; y: number }> {
  return {
    x: iframe.left - host.left + gesture.clientX,
    y: iframe.top - host.top + gesture.clientY,
  }
}

/**
 * mountCanvasViewport owns canvas navigation: wheel or held-Space drag pans, pinch or modifier
 * wheel zooms around the pointer, and the zoom menu frames the canvas or its current selection.
 */
export function mountCanvasViewport(deps: StudioCanvasViewportDeps): StudioCanvasViewportControls {
  const { host } = deps
  const document = host.ownerDocument
  const current = state(host)
  const initial = deps.initialState
  if (initial !== undefined && [initial.x, initial.y, initial.z].every(Number.isFinite)) {
    Object.assign(current, { ...initial, z: clampScale(initial.z) })
  }
  if (deps.onChange !== undefined) {
    listeners.set(host, deps.onChange)
  }
  let disposed = false

  const publish = (): void => {
    applyCanvasViewport(host)
    deps.onChange?.({ ...current })
  }

  const pill = document.createElement('button')
  pill.className = 'studio-canvas-zoom'
  pill.type = 'button'
  pill.title = 'Canvas zoom'
  pill.setAttribute('aria-label', 'Canvas zoom')
  pill.setAttribute('aria-haspopup', 'menu')
  pill.setAttribute('aria-expanded', 'false')
  pill.dataset['taoStudioCanvasZoom'] = 'true'
  host.append(pill)

  const zoomTo = (scale: number, anchor?: Readonly<{ x: number; y: number }>): void => {
    const next = clampScale(scale)
    if (next === current.z) {
      return
    }
    const bounds = host.getBoundingClientRect()
    const point = anchor ?? { x: bounds.width / 2, y: bounds.height / 2 }
    // Keep whatever sits under the anchor exactly where it is: the surface point below it must map
    // back onto the same host point after the scale changes.
    const ratio = next / current.z
    current.x = point.x - (point.x - current.x) * ratio
    current.y = point.y - (point.y - current.y) * ratio
    current.z = next
    publish()
  }

  const fit = (): void => {
    const surface = grid(host)
    if (surface === null) {
      return
    }
    // The surface's own size is its layout size, which the current scale does not change.
    const width = surface.scrollWidth
    const height = surface.scrollHeight
    const bounds = host.getBoundingClientRect()
    if (width < 1 || height < 1 || bounds.width < 1 || bounds.height < 1) {
      return
    }
    const scale = clampScale(Math.min(bounds.width / width, bounds.height / height))
    current.z = scale
    current.x = Math.max(0, (bounds.width - width * scale) / 2)
    current.y = 0
    publish()
  }

  const reset = (): void => {
    current.x = 0
    current.y = 0
    current.z = 1
    publish()
  }

  const frameBounds = (target: CanvasRect | undefined): void => {
    if (target === undefined) {
      return
    }
    const bounds = host.getBoundingClientRect()
    const width = (target.right - target.left) / current.z
    const height = (target.bottom - target.top) / current.z
    if (width <= 0 || height <= 0 || bounds.width <= 0 || bounds.height <= 0) {
      return
    }
    const x = (target.left - bounds.left - current.x) / current.z
    const y = (target.top - bounds.top - current.y) / current.z
    const padding = Math.min(32, bounds.width / 8, bounds.height / 8)
    const z = clampScale(Math.min((bounds.width - padding * 2) / width, (bounds.height - padding * 2) / height))
    Object.assign(current, {
      x: (bounds.width - width * z) / 2 - x * z,
      y: (bounds.height - height * z) / 2 - y * z,
      z,
    })
    publish()
  }
  /** A zoom step keeps the selection in view: its centre lands in the host's centre at the new scale. */
  const zoomStep = (direction: 1 | -1): void => {
    const target = deps.selectionBounds?.()
    if (target === undefined) {
      zoomTo(nextStop(current.z, direction))
      return
    }
    const bounds = host.getBoundingClientRect()
    const next = nextStop(current.z, direction)
    const x = ((target.left + target.right) / 2 - bounds.left - current.x) / current.z
    const y = ((target.top + target.bottom) / 2 - bounds.top - current.y) / current.z
    Object.assign(current, { x: bounds.width / 2 - x * next, y: bounds.height / 2 - y * next, z: next })
    publish()
  }
  const shortcut = (command: StudioCanvasZoomCommand): void => {
    Switch(command, {
      // ⌘0 fits what is selected, and the whole canvas only when nothing is.
      fit: () => {
        const selected = deps.selectionBounds?.()
        return selected === undefined ? fit() : frameBounds(selected)
      },
      reset,
      'zoom-focused': () => frameBounds(deps.focusedBounds?.()),
      'zoom-in': () => zoomStep(1),
      'zoom-out': () => zoomStep(-1),
      'zoom-selection': () => frameBounds(deps.selectionBounds?.()),
    })
    deps.onGestureEnd?.()
  }
  const menu = document.createElement('div')
  menu.className = 'studio-canvas-zoom-menu'
  menu.dataset['taoStudioCanvasZoom'] = 'menu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', 'Canvas zoom')
  menu.hidden = true
  const closeMenu = (restoreFocus = false): void => {
    menu.hidden = true
    pill.setAttribute('aria-expanded', 'false')
    if (restoreFocus) {
      pill.focus({ preventScroll: true })
    }
  }
  const choices = [
    { label: 'Fit all', action: fit },
    { label: '100%', action: reset },
    {
      label: 'Zoom to selection',
      action: () => frameBounds(deps.selectionBounds?.()),
      available: deps.selectionBounds,
    },
    {
      label: 'Zoom to focused frame',
      action: () => frameBounds(deps.focusedBounds?.()),
      available: deps.focusedBounds,
    },
  ].map((choice, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = choice.label
    button.setAttribute('role', 'menuitem')
    button.dataset['taoStudioCanvasZoomAction'] = String(index)
    button.addEventListener('click', () => {
      if (deps.enabled?.() === false || button.disabled) {
        return
      }
      choice.action()
      closeMenu(true)
      deps.onGestureEnd?.()
    })
    menu.append(button)
    return { button, available: choice.available, needsTarget: index > 1 }
  })
  const onPillClick = (): void => {
    if (deps.enabled?.() === false) {
      return
    }
    if (!menu.hidden) {
      closeMenu()
      return
    }
    for (const choice of choices) {
      choice.button.disabled = choice.needsTarget && choice.available?.() === undefined
    }
    menu.hidden = false
    pill.setAttribute('aria-expanded', 'true')
    choices[0]?.button.focus({ preventScroll: true })
  }
  const onMenuKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeMenu(true)
      return
    }
    if (event.key === 'Tab') {
      closeMenu()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
      return
    }
    event.preventDefault()
    const enabled = choices.map(choice => choice.button).filter(button => !button.disabled)
    const index = enabled.findIndex(button => button === document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End'
      ? enabled.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length
    enabled[next]?.focus({ preventScroll: true })
  }
  const onOutsidePointer = (event: PointerEvent): void => {
    if (!menu.hidden && event.target instanceof Node && !menu.contains(event.target) && event.target !== pill) {
      closeMenu()
    }
  }
  menu.addEventListener('keydown', onMenuKey)
  document.addEventListener('pointerdown', onOutsidePointer, true)
  host.append(menu)
  pill.addEventListener('click', onPillClick)

  const applyWheel = (gesture: StudioCanvasWheelGesture, anchor: Readonly<{ x: number; y: number }>): void => {
    if (gesture.zoom) {
      const notch = Math.max(-0.2, Math.min(0.2, -gesture.deltaY * zoomSensitivity))
      zoomTo(current.z * Math.exp(notch), anchor)
      return
    }
    current.x -= gesture.deltaX * panSensitivity
    current.y -= gesture.deltaY * panSensitivity
    publish()
  }

  const onWheel = (event: WheelEvent): void => {
    if (deps.enabled?.() === false) {
      return
    }
    // Wheel input over the canvas pans its plane. Ordinary scrolling in an active iframe
    // stays inside that document and never reaches this listener.
    event.preventDefault()
    const bounds = host.getBoundingClientRect()
    const anchor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    if (event.ctrlKey || event.metaKey) {
      // A trackpad pinch arrives as a wheel event with ctrlKey set; both it and a modifier-held
      // wheel zoom around the pointer rather than the surface's corner. One notch is a few percent:
      // a mouse wheel reports a whole line or page at once, and an unbounded exponent would jump
      // several hundred percent on a single tick.
      event.preventDefault()
      applyWheel({
        clientX: event.clientX,
        clientY: event.clientY,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        zoom: true,
      }, anchor)
      return
    }
    event.preventDefault()
    applyWheel({
      clientX: event.clientX,
      clientY: event.clientY,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      zoom: false,
    }, anchor)
  }
  host.addEventListener('wheel', onWheel, { passive: false })

  let panning: number | undefined
  let spaceHeld = false
  let pendingPan: Readonly<{ pointerId: number; x: number; y: number }> | undefined
  let suppressClick = false
  let lastPoint = { x: 0, y: 0 }
  const previousTabIndex = host.getAttribute('tabindex')
  host.tabIndex = -1
  const setSpaceHeld = (held: boolean): void => {
    spaceHeld = held
    if (held) {
      host.dataset['canvasPanReady'] = 'true'
    } else {
      delete host.dataset['canvasPanReady']
    }
  }
  const beginPan = (pointerId: number): void => {
    panning = pointerId
    host.setPointerCapture?.(pointerId)
    host.dataset['canvasPanning'] = 'true'
    host.focus({ preventScroll: true })
  }
  const onPointerDown = (event: PointerEvent): void => {
    if (deps.enabled?.() === false || panning !== undefined || pendingPan !== undefined) {
      return
    }
    suppressClick = false
    if ((event.button !== 0 && event.button !== 1) || (!spaceHeld && !deps.canPanWithoutSpace?.(event))) {
      return
    }
    lastPoint = { x: event.clientX, y: event.clientY }
    if (!spaceHeld) {
      pendingPan = { pointerId: event.pointerId, ...lastPoint }
      return
    }
    beginPan(event.pointerId)
    suppressClick = true
    event.preventDefault()
    event.stopPropagation()
  }
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === pendingPan?.pointerId) {
      if (Math.hypot(event.clientX - pendingPan.x, event.clientY - pendingPan.y) <= 4) {
        return
      }
      beginPan(event.pointerId)
      pendingPan = undefined
      suppressClick = true
      event.preventDefault()
      event.stopPropagation()
    }
    if (event.pointerId !== panning) {
      return
    }
    current.x += (event.clientX - lastPoint.x) * panSensitivity
    current.y += (event.clientY - lastPoint.y) * panSensitivity
    lastPoint = { x: event.clientX, y: event.clientY }
    publish()
  }
  const onClick = (event: MouseEvent): void => {
    if (suppressClick) {
      suppressClick = false
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }
  const releasePan = (): void => {
    pendingPan = undefined
    if (panning === undefined) {
      return
    }
    const pointerId = panning
    panning = undefined
    try {
      host.releasePointerCapture?.(pointerId)
    } catch {
      // The capture was already gone.
    }
    delete host.dataset['canvasPanning']
    deps.onGestureEnd?.()
  }
  const endPan = (event: PointerEvent): void => {
    if (event.pointerId === panning || event.pointerId === pendingPan?.pointerId) {
      releasePan()
    }
  }
  const onBlur = (): void => {
    closeMenu()
    suppressClick = false
    setSpaceHeld(false)
    releasePan()
  }
  host.addEventListener('pointerdown', onPointerDown, true)
  host.addEventListener('pointermove', onPointerMove)
  host.addEventListener('click', onClick, true)
  host.addEventListener('pointerup', endPan)
  host.addEventListener('pointercancel', endPan)
  host.addEventListener('lostpointercapture', endPan)
  // A pending drag has no capture yet, so release outside the host must also clear it.
  document.addEventListener('pointerup', endPan)
  document.addEventListener('pointercancel', endPan)

  const onKeyDown = (event: KeyboardEvent): void => {
    if (deps.enabled?.() === false) {
      return
    }
    // Native buttons use Space to activate; their key must not start canvas panning.
    if (event.key === ' ' && event.target instanceof Element && event.target.closest('button, [role="button"]')) {
      return
    }
    if (event.key === ' ' && !event.isComposing && !isStudioTypingTarget(event.target)) {
      event.preventDefault()
      event.stopPropagation()
      setSpaceHeld(true)
      return
    }
    if (event.isComposing || isStudioTypingTarget(event.target)) {
      return
    }
    const command = canvasShortcutCommand(event)
    if (command !== undefined) {
      event.preventDefault()
      event.stopPropagation()
      shortcut(command)
    }
  }
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === ' ') {
      if (spaceHeld) {
        event.preventDefault()
        event.stopPropagation()
      }
      setSpaceHeld(false)
      releasePan()
    }
  }
  // The product host's keyboard handlers can stop bubbling before it reaches document.
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('keyup', onKeyUp, true)
  document.defaultView?.addEventListener('blur', onBlur)

  const reveal = (node: Element): void => {
    revealCanvasNode(node)
  }

  const iframeWheel = (gesture: StudioCanvasWheelGesture, frame: Element): void => {
    if (deps.enabled?.() === false || !host.contains(frame) || (!gesture.zoom && !spaceHeld)) {
      return
    }
    const hostRect = host.getBoundingClientRect()
    const frameRect = frame.getBoundingClientRect()
    applyWheel(gesture, canvasIframeGestureAnchor(hostRect, frameRect, gesture))
  }

  const iframePanKey = (held: boolean, frame: Element): void => {
    if (!host.contains(frame) || (held && deps.enabled?.() === false)) {
      return
    }
    // Starting a pan focuses the host, which blurs the iframe. The parent now owns keyup;
    // that focus-transfer notification must not disarm a still-held Space between drags.
    if (!held && panning !== undefined) {
      return
    }
    setSpaceHeld(held)
  }

  applyCanvasViewport(host)
  return {
    cancelPan: onBlur,
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      listeners.delete(host)
      onBlur()
      pill.removeEventListener('click', onPillClick)
      menu.removeEventListener('keydown', onMenuKey)
      document.removeEventListener('pointerdown', onOutsidePointer, true)
      menu.remove()
      host.removeEventListener('wheel', onWheel)
      host.removeEventListener('pointerdown', onPointerDown, true)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('click', onClick, true)
      host.removeEventListener('pointerup', endPan)
      host.removeEventListener('pointercancel', endPan)
      host.removeEventListener('lostpointercapture', endPan)
      document.removeEventListener('pointerup', endPan)
      document.removeEventListener('pointercancel', endPan)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keyup', onKeyUp, true)
      document.defaultView?.removeEventListener('blur', onBlur)
      if (previousTabIndex === null) {
        host.removeAttribute('tabindex')
      } else {
        host.setAttribute('tabindex', previousTabIndex)
      }
      pill.remove()
      delete host.dataset['canvasPanReady']
      delete host.dataset['canvasPanning']
    },
    fit,
    iframePanKey,
    iframeShortcut(command, frame) {
      if (!disposed && deps.enabled?.() !== false && host.contains(frame)) {
        shortcut(command)
      }
    },
    iframeWheel,
    reset,
    reveal,
    state: () => ({ ...current }),
    zoomTo,
  }
}

const modifiedShortcuts: Readonly<Record<string, StudioCanvasZoomCommand>> = {
  '0': 'fit',
  '1': 'reset',
  '=': 'zoom-in',
  '+': 'zoom-in',
  '-': 'zoom-out',
}

/** Shift turns a digit into punctuation that differs by keyboard layout, so ⇧1 and ⇧2 are read from the physical key. */
const shiftedShortcuts: Readonly<Record<string, StudioCanvasZoomCommand>> = {
  Digit1: 'zoom-selection',
  Digit2: 'zoom-focused',
}

/**
 * canvasShortcutCommand names the canvas command a key press asks for: ⌘0, ⌘1, ⌘+ and ⌘− with the
 * platform modifier, ⇧1 and ⇧2 with Shift alone. ⌘0 fits the selection when there is one and the
 * whole canvas otherwise; ⌘+ and ⌘− keep the selection centred.
 */
function canvasShortcutCommand(
  event: Readonly<{
    altKey?: boolean | undefined
    code?: string | undefined
    ctrlKey?: boolean | undefined
    key?: string | undefined
    metaKey?: boolean | undefined
    shiftKey?: boolean | undefined
  }>,
): StudioCanvasZoomCommand | undefined {
  const modified = event.metaKey === true || event.ctrlKey === true
  if (modified) {
    return event.key !== undefined && Object.hasOwn(modifiedShortcuts, event.key)
      ? modifiedShortcuts[event.key]
      : undefined
  }
  return event.shiftKey === true && event.altKey !== true && event.code !== undefined
      && Object.hasOwn(shiftedShortcuts, event.code)
    ? shiftedShortcuts[event.code]
    : undefined
}

/** nextStop moves one notch along the zoom ladder, so ⌘+ and ⌘− land on round percentages. */
export function nextStop(scale: number, direction: 1 | -1): number {
  const stops = direction === 1 ? zoomStops : [...zoomStops].reverse()
  return stops.find(stop => (direction === 1 ? stop > scale + 0.001 : stop < scale - 0.001))
    ?? clampScale(direction === 1 ? maximumScale : minimumScale)
}

/** Keys typed into a field or the code editor belong to it, not to canvas shortcuts. */
export function isStudioTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  return target.closest(
    'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"], .cm-content',
  ) !== null
}
