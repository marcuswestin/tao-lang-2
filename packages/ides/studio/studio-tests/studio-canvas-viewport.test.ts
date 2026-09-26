import { Expect, Test, testOverrideSlot } from '@shared/test'
import { mountCanvasViewport } from '../studio-src/client/matrix/StudioCanvasViewport'

class CanvasElement extends EventTarget {
  dataset: Record<string, string> = {}
  style: Record<string, string> = {}
  attributes = new Map<string, string>()
  children: CanvasElement[] = []
  captures = new Set<number>()
  tabIndex = 0
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
    return selector.includes('preview-grid') ? this.children[0]! : this.children[1] ?? null
  }
  setPointerCapture(id: number): void {
    this.captures.add(id)
  }
  releasePointerCapture(id: number): void {
    this.captures.delete(id)
  }
  focus(): void {
    this.focused = true
  }
}

function canvasDocument() {
  return Object.assign(new EventTarget(), {
    createElement: () => new CanvasElement(),
    defaultView: new EventTarget(),
  })
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
): void {
  const restore = elementSlot.install({ configurable: true, value: CanvasElement })
  const document = canvasDocument()
  const host = new CanvasElement()
  host.ownerDocument = document
  host.append(new CanvasElement())
  let enabled = true
  const controls = mountCanvasViewport({ enabled: () => enabled, host: host as unknown as HTMLElement })
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
