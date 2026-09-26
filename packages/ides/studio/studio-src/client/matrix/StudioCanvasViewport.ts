/**
 * The preview area is one pannable, zoomable surface rather than a scrolling column, so every
 * scenario group can be seen at once and any one of them can be brought close. The surface is a
 * single transform on the matrix grid: `translate(x, y) scale(z)` with the grid's own origin at its
 * top left. Cells keep their DOM identity through it, so preview iframes never reload when the
 * person zooms or pans.
 */

type StudioCanvasViewportState = Readonly<{ x: number; y: number; z: number }>
type CanvasRect = Readonly<{ bottom: number; left: number; right: number; top: number }>

const minimumScale = 0.1
const maximumScale = 4
const panSensitivity = 0.75
const zoomSensitivity = 0.006
const zoomStops = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const

type MutableState = { x: number; y: number; z: number }

const states = new WeakMap<HTMLElement, MutableState>()

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
  return host.querySelector<HTMLElement>(':scope > .studio-preview-grid')
}

/** canvasScale reports the zoom a node is rendered under, so a pointer gesture can undo it. */
export function canvasScale(node: Element | null | undefined): number {
  const host = node?.closest<HTMLElement>('[data-canvas-surface="on"]') ?? null
  const surface = host === null ? null : grid(host)
  return host === null || surface === null || node === undefined || !surface.contains(node)
    ? 1
    : states.get(host)?.z ?? 1
}

/** applyCanvasViewport writes the current pan and zoom onto the grid; the matrix calls it after each reconcile. */
export function applyCanvasViewport(host: HTMLElement): void {
  const surface = grid(host)
  if (surface === null) {
    return
  }
  const current = state(host)
  host.dataset['canvasSurface'] = 'on'
  surface.style.transform = `translate(${current.x}px, ${current.y}px) scale(${current.z})`
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
  const surface = host === null ? null : grid(host)
  if (host === null || surface === null || node === undefined || node === null || !surface.contains(node)) {
    return false
  }
  const delta = canvasRevealDelta(host.getBoundingClientRect(), node.getBoundingClientRect())
  const current = state(host)
  current.x += delta.x
  current.y += delta.y
  applyCanvasViewport(host)
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
  zoomTo: (scale: number, anchor?: Readonly<{ x: number; y: number }>) => void
}>

export type StudioCanvasViewportDeps = Readonly<{
  /** Canvas shortcuts and forwarded iframe gestures are active only in the Design preset. */
  enabled?: () => boolean
  host: HTMLElement
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
 * mountCanvasViewport gives the host Figma's gestures: wheel or two-finger scroll pans, the same
 * with a modifier zooms around the pointer, a drag with space held or the middle button pans, and
 * the zoom pill in the corner shows and resets the scale.
 */
export function mountCanvasViewport(deps: StudioCanvasViewportDeps): StudioCanvasViewportControls {
  const { host } = deps
  const document = host.ownerDocument
  const current = state(host)
  let disposed = false

  const publish = (): void => {
    applyCanvasViewport(host)
    deps.onChange?.({ ...current })
  }

  const pill = document.createElement('button')
  pill.className = 'studio-canvas-zoom'
  pill.type = 'button'
  pill.title = 'Zoom to fit; hold a modifier and scroll to zoom'
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

  const onPillClick = (): void => (current.z === 1 ? fit() : reset())
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
  /** The canvas pans on the middle button, or on the left button while space is held. */
  const startsPan = (event: PointerEvent): boolean => event.button === 1 || (event.button === 0 && spaceHeld)
  const onPointerDown = (event: PointerEvent): void => {
    if (deps.enabled?.() === false || panning !== undefined || !startsPan(event)) {
      return
    }
    panning = event.pointerId
    lastPoint = { x: event.clientX, y: event.clientY }
    host.setPointerCapture?.(event.pointerId)
    host.dataset['canvasPanning'] = 'true'
    host.focus({ preventScroll: true })
    event.preventDefault()
    event.stopPropagation()
  }
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== panning) {
      return
    }
    current.x += (event.clientX - lastPoint.x) * panSensitivity
    current.y += (event.clientY - lastPoint.y) * panSensitivity
    lastPoint = { x: event.clientX, y: event.clientY }
    publish()
  }
  const releasePan = (): void => {
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
  }
  const endPan = (event: PointerEvent): void => {
    if (event.pointerId === panning) {
      releasePan()
    }
  }
  const onBlur = (): void => {
    setSpaceHeld(false)
    releasePan()
  }
  host.addEventListener('pointerdown', onPointerDown, true)
  host.addEventListener('pointermove', onPointerMove)
  host.addEventListener('pointerup', endPan)
  host.addEventListener('pointercancel', endPan)
  host.addEventListener('lostpointercapture', endPan)

  const onKeyDown = (event: KeyboardEvent): void => {
    if (deps.enabled?.() === false) {
      return
    }
    if (event.key === ' ' && !event.isComposing && !isTypingTarget(event.target)) {
      event.preventDefault()
      event.stopPropagation()
      setSpaceHeld(true)
      return
    }
    if (!(event.metaKey || event.ctrlKey) || isTypingTarget(event.target)) {
      return
    }
    if (event.key === '0') {
      event.preventDefault()
      fit()
    } else if (event.key === '1') {
      event.preventDefault()
      reset()
    } else if (event.key === '=' || event.key === '+') {
      event.preventDefault()
      zoomTo(nextStop(current.z, 1))
    } else if (event.key === '-') {
      event.preventDefault()
      zoomTo(nextStop(current.z, -1))
    }
  }
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === ' ') {
      if (spaceHeld) {
        event.preventDefault()
        event.stopPropagation()
      }
      setSpaceHeld(false)
    }
  }
  // The product host's keyboard handlers can stop bubbling before it reaches document.
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('keyup', onKeyUp, true)
  document.defaultView?.addEventListener('blur', onBlur)

  const reveal = (node: Element): void => {
    if (revealCanvasNode(node)) {
      deps.onChange?.({ ...current })
    }
  }

  const iframeWheel = (gesture: StudioCanvasWheelGesture, frame: Element): void => {
    if (deps.enabled?.() === false || !host.contains(frame)) {
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
      onBlur()
      pill.removeEventListener('click', onPillClick)
      host.removeEventListener('wheel', onWheel)
      host.removeEventListener('pointerdown', onPointerDown, true)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerup', endPan)
      host.removeEventListener('pointercancel', endPan)
      host.removeEventListener('lostpointercapture', endPan)
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
    iframeWheel,
    reset,
    reveal,
    state: () => ({ ...current }),
    zoomTo,
  }
}

/** nextStop moves one notch along the zoom ladder, so ⌘+ and ⌘− land on round percentages. */
export function nextStop(scale: number, direction: 1 | -1): number {
  const stops = direction === 1 ? zoomStops : [...zoomStops].reverse()
  return stops.find(stop => (direction === 1 ? stop > scale + 0.001 : stop < scale - 0.001))
    ?? clampScale(direction === 1 ? maximumScale : minimumScale)
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  return target.closest(
    'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"], .cm-content',
  ) !== null
}
