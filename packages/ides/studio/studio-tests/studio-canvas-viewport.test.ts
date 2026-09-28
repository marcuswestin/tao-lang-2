import { Expect, Test, testOverrideSlot } from '@shared/test'
import {
  applyCanvasViewport,
  mountCanvasViewport,
  type StudioCanvasViewportDeps,
} from '../studio-src/client/matrix/StudioCanvasViewport'

class CanvasElement extends EventTarget {
  dataset: Record<string, string> = {}
  properties: Record<string, string> = {}
  style: Record<string, string> & { setProperty: (name: string, value: string) => void } = Object.defineProperty(
    {} as Record<string, string> & { setProperty: (name: string, value: string) => void },
    'setProperty',
    {
      enumerable: false,
      value: (name: string, value: string) => {
        this.properties[name] = value
      },
    },
  )
  attributes = new Map<string, string>()
  children: CanvasElement[] = []
  captures = new Set<number>()
  tabIndex = 0
  hidden = false
  disabled = false
  scrollWidth = 1000
  scrollHeight = 800
  getBoundingClientRect() {
    return { left: 20, top: 30, width: 500, height: 400, right: 520, bottom: 430 }
  }
  typing = false
  focused = false
  ownerDocument!: ReturnType<typeof canvasDocument>
  append(child: CanvasElement): void {
    this.children.push(child)
  }
  remove(): void {}
  closest(): CanvasElement | null {
    return this.typing ? this : null
  }
  contains(child: CanvasElement): boolean {
    return this.children.includes(child)
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }
  querySelector(selector: string): CanvasElement | null {
    return selector.includes('draw-canvas')
      ? this.children.find(child => child.dataset['taoStudioDrawCanvas'] === 'true') ?? null
      : selector.includes('preview-grid')
      ? this.children[0]!
      : this.children[1] ?? null
  }
  /** The host's surfaces: the grid first, then the Draw canvas when one is mounted. */
  querySelectorAll(): CanvasElement[] {
    return [
      this.children[0],
      this.children.find(child => child.dataset['taoStudioDrawCanvas'] === 'true'),
    ].filter((child): child is CanvasElement => child !== undefined)
  }
  setPointerCapture(id: number): void {
    this.captures.add(id)
  }
  releasePointerCapture(id: number): void {
    this.captures.delete(id)
  }
  focus(): void {
    this.focused = true
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this
    }
  }
}

function canvasDocument() {
  const document = Object.assign(new EventTarget(), {
    createElement: () => {
      const node = new CanvasElement()
      node.ownerDocument = document
      return node
    },
    defaultView: new EventTarget(),
    activeElement: undefined as CanvasElement | undefined,
  })
  return document
}

const elementSlot = testOverrideSlot<PropertyDescriptor | undefined>({
  equals: (left, right) => left?.value === right?.value,
  read: () => Object.getOwnPropertyDescriptor(globalThis, 'Element'),
  write: value => {
    if (value === undefined) {
      Reflect.deleteProperty(globalThis, 'Element')
    } else {
      Object.defineProperty(globalThis, 'Element', value)
    }
  },
})

function emit(target: EventTarget, type: string, values: Record<string, unknown> = {}): Event {
  const event = Object.assign(new Event(type, { cancelable: true }), values)
  target.dispatchEvent(event)
  return event
}

function canvasTest(
  run: (fixture: {
    host: CanvasElement
    document: ReturnType<typeof canvasDocument>
    controls: ReturnType<typeof mountCanvasViewport>
    enabled: (value: boolean) => void
  }) => void,
  options: Partial<StudioCanvasViewportDeps> = {},
): void {
  const restore = elementSlot.install({ configurable: true, value: CanvasElement })
  const document = canvasDocument()
  const host = new CanvasElement()
  host.ownerDocument = document
  host.append(new CanvasElement())
  let enabled = true
  const controls = mountCanvasViewport({ ...options, enabled: () => enabled, host: host as unknown as HTMLElement })
  try {
    run({
      controls,
      document,
      enabled: value => {
        enabled = value
      },
      host,
    })
  } finally {
    controls.dispose()
    restore()
  }
}

const down = { button: 0, clientX: 100, clientY: 100, pointerId: 7 }
const move = { clientX: 160, clientY: 125, movementX: 0, movementY: 0, pointerId: 7 }

Test('Studio Space drag pans by client coordinates and releases pointer capture', () => {
  canvasTest(({ controls, document, host }) => {
    Expect(emit(document, 'keydown', { key: ' ' }).defaultPrevented).toBe(true)
    Expect(emit(host, 'pointerdown', down).defaultPrevented).toBe(true)
    Expect(host.focused).toBe(true)
    emit(host, 'pointermove', move)
    Expect(controls.state()).toEqual({ x: 45, y: 18.75, z: 1 })
    emit(document, 'keyup', { key: ' ' })
    Expect(host.dataset['canvasPanReady']).toBeUndefined()
    emit(host, 'pointerup', { pointerId: 7 })
    Expect(host.captures.size).toBe(0)
    Expect(host.dataset['canvasPanning']).toBeUndefined()
    emit(host, 'pointerdown', down)
    emit(host, 'pointermove', move)
    Expect(controls.state()).toEqual({ x: 45, y: 18.75, z: 1 })
  })
})

Test('Studio focused preview Space arms panning on the surrounding canvas', () => {
  canvasTest(({ controls, host }) => {
    const frame = new CanvasElement()
    controls.iframePanKey(true, frame as unknown as Element)
    Expect(host.dataset['canvasPanReady']).toBeUndefined()
    host.append(frame)
    controls.iframePanKey(true, frame as unknown as Element)
    Expect(host.dataset['canvasPanReady']).toBe('true')
    emit(host, 'pointerdown', down)
    // Focus transfer releases the iframe's key; the captured drag must still finish.
    controls.iframePanKey(false, frame as unknown as Element)
    Expect(host.dataset['canvasPanReady']).toBe('true')
    emit(host, 'pointermove', move)
    Expect(controls.state()).toEqual({ x: 45, y: 18.75, z: 1 })
    emit(host, 'lostpointercapture', { pointerId: 7 })
    emit(host, 'pointermove', { ...move, clientX: 200 })
    Expect(controls.state()).toEqual({ x: 45, y: 18.75, z: 1 })
  })
})

Test('Studio Space leaves typing and disabled layouts alone', () => {
  canvasTest(({ controls, document, enabled, host }) => {
    const input = new CanvasElement()
    input.typing = true
    const typing = new Event('keydown', { cancelable: true })
    Object.defineProperties(typing, { key: { value: ' ' }, target: { value: input } })
    document.dispatchEvent(typing)
    Expect(typing.defaultPrevented).toBe(false)
    emit(host, 'pointerdown', down)
    emit(host, 'pointermove', move)
    Expect(controls.state()).toEqual({ x: 0, y: 0, z: 1 })
    enabled(false)
    Expect(emit(document, 'keydown', { key: ' ' }).defaultPrevented).toBe(false)
    emit(host, 'pointerdown', { ...down, button: 1 })
    emit(host, 'pointermove', move)
    Expect(controls.state()).toEqual({ x: 0, y: 0, z: 1 })
  })
})

Test('Studio focus loss and disposal release pan state and listeners', () => {
  canvasTest(({ controls, document, host }) => {
    emit(document, 'keydown', { key: ' ' })
    emit(host, 'pointerdown', down)
    emit(document.defaultView, 'blur')
    Expect(host.captures.size).toBe(0)
    Expect(host.dataset['canvasPanReady']).toBeUndefined()
    emit(host, 'pointermove', move)
    Expect(controls.state()).toEqual({ x: 0, y: 0, z: 1 })
    emit(document, 'keydown', { key: ' ' })
    emit(host, 'pointerdown', { ...down, button: 1 })
    emit(host, 'pointermove', move)
    Expect(controls.state()).toEqual({ x: 45, y: 18.75, z: 1 })
    controls.dispose()
    Expect(host.captures.size).toBe(0)
    emit(document, 'keydown', { key: ' ' })
    emit(host, 'pointerdown', down)
    emit(host, 'pointermove', move)
    Expect(host.dataset['canvasPanReady']).toBeUndefined()
    Expect(controls.state()).toEqual({ x: 45, y: 18.75, z: 1 })
  })
})

Test('Studio releases canvas input when a layout change cancels a pan', () => {
  canvasTest(({ controls, document, enabled, host }) => {
    emit(document, 'keydown', { key: ' ' })
    emit(host, 'pointerdown', down)
    enabled(false)
    controls.cancelPan()
    Expect(host.dataset['canvasPanReady']).toBeUndefined()
    Expect(host.dataset['canvasPanning']).toBeUndefined()
    Expect(host.captures.size).toBe(0)
    emit(host, 'pointermove', move)
    Expect(controls.state()).toEqual({ x: 0, y: 0, z: 1 })
  })
})

Test('Studio wheel pans without Space while iframe scrolling stays local and pinch zoom remains available', () => {
  canvasTest(({ controls, document, host }) => {
    const wheel = { clientX: 100, clientY: 100, deltaX: 20, deltaY: 10 }
    Expect(emit(host, 'wheel', wheel).defaultPrevented).toBe(true)
    emit(host, 'pointerdown', { ...down, button: 1 })
    emit(host, 'pointermove', move)
    Expect(controls.state()).toEqual({ x: -15, y: -7.5, z: 1 })
    const frame = new CanvasElement()
    host.append(frame)
    controls.iframeWheel({ ...wheel, zoom: false }, frame as unknown as Element)
    Expect(controls.state()).toEqual({ x: -15, y: -7.5, z: 1 })
    emit(document, 'keydown', { key: ' ' })
    Expect(emit(host, 'wheel', wheel).defaultPrevented).toBe(true)
    Expect(controls.state()).toEqual({ x: -30, y: -15, z: 1 })
    emit(host, 'pointerdown', down)
    emit(document, 'keyup', { key: ' ' })
    emit(host, 'pointermove', move)
    Expect(controls.state()).toEqual({ x: -30, y: -15, z: 1 })
    Expect(host.captures.size).toBe(0)
    Expect(emit(host, 'wheel', { ...wheel, ctrlKey: true }).defaultPrevented).toBe(true)
    Expect(controls.state().z).toBeLessThan(1)
  })
})

Test('Studio restores viewport and menu frames selection in the current transformed coordinate system', () => {
  const published: unknown[] = []
  canvasTest(({ controls, host, document }) => {
    Expect(controls.state()).toEqual({ x: -100, y: -50, z: 2 })
    const pill = host.children[1]!
    const menu = host.children[2]!
    emit(pill, 'click')
    Expect(menu.hidden).toBe(false)
    Expect(menu.children[2]!.disabled).toBe(false)
    Expect(menu.children[3]!.disabled).toBe(true)
    emit(menu.children[2]!, 'click')
    // Screen rect 120,130..320,230 is model rect 100,75..200,125 at the restored camera.
    Expect(controls.state()).toEqual({ x: -350, y: -200, z: 4 })
    Expect(menu.hidden).toBe(true)
    Expect(pill.focused).toBe(true)
    emit(pill, 'click')
    Expect(emit(menu, 'keydown', { key: 'Escape' }).defaultPrevented).toBe(true)
    Expect(menu.hidden).toBe(true)
    emit(pill, 'click')
    emit(menu, 'keydown', { key: 'End' })
    Expect(document.activeElement).toBe(menu.children[2])
    emit(menu.children[1]!, 'click')
    Expect(controls.state()).toEqual({ x: 0, y: 0, z: 1 })
    Expect(published.length).toBe(2)
  }, {
    initialState: { x: -100, y: -50, z: 2 },
    selectionBounds: () => ({ left: 120, top: 130, right: 320, bottom: 230 }),
    onChange: state => published.push(state),
  })
})

Test('Studio Shift+1 frames the selection and Shift+2 the focused frame, from the page or a focused preview', () => {
  let focused: { left: number; top: number; right: number; bottom: number } | undefined
  canvasTest(({ controls, document, host }) => {
    // Shift turns the digit into punctuation, so the physical key names the command.
    const selection = emit(document, 'keydown', { code: 'Digit1', key: '!', shiftKey: true })
    Expect(selection.defaultPrevented).toBe(true)
    // Screen rect 120,130..320,230 fills the 500x400 host at 2.18x with 32px of padding.
    const framed = controls.state()
    Expect(framed.z).toBe(2.18)
    Expect(framed.x).toBeCloseTo(-186)
    Expect(framed.y).toBeCloseTo(-127)
    Expect(host.children[0]!.properties['--studio-canvas-counter-scale']).toBe(String(1 / 2.18))
    const before = controls.state()
    Expect(emit(document, 'keydown', { code: 'Digit2', key: '@', shiftKey: true }).defaultPrevented).toBe(true)
    Expect(controls.state()).toEqual(before)
    focused = { left: 20, top: 30, right: 238, bottom: 139 }
    emit(document, 'keydown', { code: 'Digit2', key: '@', shiftKey: true })
    Expect(controls.state().z).toBe(4)
    controls.reset()
    const frame = new CanvasElement()
    host.append(frame)
    controls.iframeShortcut('zoom-selection', frame as unknown as Element)
    Expect(controls.state()).toEqual(framed)
    controls.reset()
    const input = new CanvasElement()
    input.typing = true
    const typing = new Event('keydown', { cancelable: true })
    Object.defineProperties(typing, {
      code: { value: 'Digit1' },
      shiftKey: { value: true },
      target: { value: input },
    })
    document.dispatchEvent(typing)
    Expect(typing.defaultPrevented).toBe(false)
    Expect(emit(document, 'keydown', { altKey: true, code: 'Digit1', shiftKey: true }).defaultPrevented).toBe(false)
    Expect(emit(document, 'keydown', { code: 'Digit3', shiftKey: true }).defaultPrevented).toBe(false)
    Expect(controls.state()).toEqual({ x: 0, y: 0, z: 1 })
  }, {
    focusedBounds: () => focused,
    selectionBounds: () => ({ left: 120, top: 130, right: 320, bottom: 230 }),
  })
})

Test('Studio ⌘0 fits the selection and ⌘+/⌘− keep it centred, and fit the whole canvas without one', () => {
  let selection: { left: number; top: number; right: number; bottom: number } | undefined = {
    left: 120,
    top: 130,
    right: 320,
    bottom: 230,
  }
  canvasTest(({ controls, document }) => {
    // The 500x400 host sits at 20,30, so the selection's centre is host point 200,150.
    emit(document, 'keydown', { key: '=', metaKey: true })
    Expect(controls.state()).toEqual({ x: -50, y: -25, z: 1.5 })
    controls.reset()
    emit(document, 'keydown', { key: '-', metaKey: true })
    Expect(controls.state()).toEqual({ x: 100, y: 87.5, z: 0.75 })
    controls.reset()
    emit(document, 'keydown', { key: '0', metaKey: true })
    Expect(controls.state().z).toBe(2.18)
    Expect(controls.state().x).toBeCloseTo(-186)
    selection = undefined
    emit(document, 'keydown', { key: '0', metaKey: true })
    Expect(controls.state()).toEqual({ x: 0, y: 0, z: 0.5 })
  }, { selectionBounds: () => selection })
})

Test('Studio iframe shortcuts require a contained frame and enabled canvas', () => {
  canvasTest(({ controls, host, enabled }) => {
    const frame = new CanvasElement()
    controls.iframeShortcut('zoom-in', frame as unknown as Element)
    Expect(controls.state().z).toBe(1)
    host.append(frame)
    controls.iframeShortcut('zoom-in', frame as unknown as Element)
    Expect(controls.state().z).toBe(1.5)
    controls.iframeShortcut('zoom-out', frame as unknown as Element)
    Expect(controls.state().z).toBe(1)
    controls.iframeShortcut('fit', frame as unknown as Element)
    Expect(controls.state()).toEqual({ x: 0, y: 0, z: 0.5 })
    enabled(false)
    controls.iframeShortcut('reset', frame as unknown as Element)
    Expect(controls.state().z).toBe(0.5)
    enabled(true)
    controls.iframeShortcut('reset', frame as unknown as Element)
    Expect(controls.state()).toEqual({ x: 0, y: 0, z: 1 })
  })
})

Test('Studio neutral canvas drag waits for movement and suppresses only the drag click', () => {
  canvasTest(({ controls, host }) => {
    emit(host, 'pointerdown', down)
    emit(host, 'pointermove', { ...move, clientX: 103, clientY: 100 })
    Expect(host.captures.size).toBe(0)
    emit(host, 'pointerup', down)
    Expect(emit(host, 'click').defaultPrevented).toBe(false)
    Expect(controls.state()).toEqual({ x: 0, y: 0, z: 1 })
    emit(host, 'pointerdown', down)
    emit(host, 'pointermove', move)
    Expect(host.captures.has(7)).toBe(true)
    Expect(controls.state()).toEqual({ x: 45, y: 18.75, z: 1 })
    emit(host, 'pointerup', move)
    Expect(emit(host, 'click').defaultPrevented).toBe(true)
    Expect(host.captures.size).toBe(0)
    emit(host, 'pointerdown', down)
    emit(host, 'pointerup', down)
    Expect(emit(host, 'click').defaultPrevented).toBe(false)
  }, { canPanWithoutSpace: () => true })
})

Test('Studio Draw Space panning transforms Draw and returns geometry ownership on key release or blur', () => {
  canvasTest(({ controls, document, host }) => {
    const draw = new CanvasElement()
    draw.dataset['taoStudioDrawCanvas'] = 'true'
    host.append(draw)
    host.dataset['canvasWorkspace'] = 'draw'
    applyCanvasViewport(host as unknown as HTMLElement)
    Expect(draw.style['transform']).toBe('translate(0px, 0px) scale(1)')
    for (const release of ['keyup', 'blur']) {
      emit(document, 'keydown', { key: ' ' })
      const drag = emit(host, 'pointerdown', down)
      Expect(drag.defaultPrevented).toBe(true)
      Expect(host.captures.has(7)).toBe(true)
      emit(host, 'pointermove', move)
      if (release === 'keyup') {
        emit(document, 'keyup', { key: ' ' })
      } else {
        emit(document.defaultView, 'blur')
      }
      Expect(host.captures.size).toBe(0)
      Expect(host.dataset['canvasPanReady']).toBeUndefined()
      Expect(emit(host, 'pointerdown', down).defaultPrevented).toBe(false)
      emit(host, 'pointermove', move)
    }
    Expect(controls.state()).toEqual({ x: 90, y: 37.5, z: 1 })
    Expect(draw.style['transform']).toBe('translate(90px, 37.5px) scale(1)')
    // The grid moves with Draw, so the running views laid over drawn frames stay under them.
    Expect(host.children[0]!.style['transform']).toBe('translate(90px, 37.5px) scale(1)')
    Expect(host.children[0]!.properties['--studio-canvas-counter-scale']).toBe('1')
  })
})
