import { Expect, Test, testOverrideSlot } from '@shared/test'
import { mountPreviewActivation } from '../studio-src/client/matrix/StudioPreviewActivation'
import type { StudioPreviewConnection } from '../studio-src/client/matrix/StudioPreviewConnection'

class PreviewElement extends EventTarget {
  className = ''
  type = ''
  title = 'App preview'
  tagName = 'DIV'
  tabIndex = 0
  hidden = false
  dataset: Record<string, string> = {}
  style = { pointerEvents: '' }
  attributes = new Map<string, string>()
  children: PreviewElement[] = []
  parentElement: PreviewElement | undefined
  ownerDocument!: ReturnType<typeof previewDocument>
  blur(): void {
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = undefined
    }
  }
  append(child: PreviewElement): void {
    child.remove()
    child.parentElement = this
    child.ownerDocument = this.ownerDocument
    this.children.push(child)
  }
  remove(): void {
    const parent = this.parentElement
    if (parent !== undefined) {
      parent.children.splice(parent.children.indexOf(this), 1)
      this.parentElement = undefined
    }
  }
  contains(child: PreviewElement): boolean {
    return child === this || this.children.some(node => node.contains(child))
  }
  closest(selector: string): PreviewElement | null {
    const match = selector.split(',').some(part => {
      const value = part.trim()
      return value.startsWith('.')
        ? this.className.split(' ').includes(value.slice(1))
        : value.toUpperCase() === this.tagName
    })
    return match ? this : this.parentElement?.closest(selector) ?? null
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
}

function previewDocument() {
  const document = Object.assign(new EventTarget(), {
    activeElement: undefined as PreviewElement | undefined,
    createElement: (tag: string) => {
      const element = new PreviewElement()
      element.tagName = tag.toUpperCase()
      element.ownerDocument = document
      return element
    },
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
  const event = new Event(type, { cancelable: true })
  for (const [key, value] of Object.entries({ button: 0, detail: 1, ...values })) {
    Object.defineProperty(event, key, { value })
  }
  target.dispatchEvent(event)
  return event
}

function activationTest(
  run: (fixture: {
    host: PreviewElement
    document: ReturnType<typeof previewDocument>
    previews: StudioPreviewConnection[]
    controls: ReturnType<typeof mountPreviewActivation>
    add: (wholeApp?: boolean) => { preview: StudioPreviewConnection; iframe: PreviewElement; viewport: PreviewElement }
    activations: string[]
  }) => void,
): void {
  const restore = elementSlot.install({ configurable: true, value: PreviewElement })
  const document = previewDocument()
  const host = document.createElement('div')
  const previews: StudioPreviewConnection[] = []
  const activations: string[] = []
  const add = (wholeApp = false) => {
    const frame = document.createElement('section')
    frame.className = 'studio-preview-cell'
    const viewport = wholeApp ? host : document.createElement('div')
    if (!wholeApp) {
      viewport.className = 'studio-preview-cell-viewport'
      frame.append(viewport)
      host.append(frame)
    }
    const iframe = document.createElement('iframe')
    viewport.append(iframe)
    const id = `preview-${previews.length}`
    const preview: StudioPreviewConnection = {
      iframe: iframe as unknown as HTMLIFrameElement,
      ...(wholeApp ? {} : { frame: frame as unknown as HTMLElement }),
      previewInstanceId: id,
      origin: 'https://example.com',
      interactionMode: 'edit',
      activate: () => activations.push(id),
    }
    previews.push(preview)
    return { preview, iframe, viewport }
  }
  const controls = mountPreviewActivation(host as unknown as HTMLElement, previews)
  try {
    run({ host, document, previews, controls, add, activations })
  } finally {
    controls.dispose()
    restore()
  }
}

Test('Studio requires a consumed activation click before one preview accepts input', () => {
  activationTest(({ add, controls, activations }) => {
    const first = add()
    const second = add()
    controls.reconcile()
    Expect(first.iframe.style.pointerEvents).toBe('none')
    Expect(second.iframe.style.pointerEvents).toBe('none')
    Expect(first.iframe.tabIndex).toBe(-1)
    const shield = first.viewport.children[1]!
    Expect(shield.attributes.get('aria-label')).toBe('Activate App preview')
    let iframeClicks = 0
    first.iframe.addEventListener('click', () => iframeClicks++)
    Expect(emit(shield, 'click').defaultPrevented).toBe(true)
    Expect(iframeClicks).toBe(0)
    Expect(shield.hidden).toBe(true)
    Expect(first.iframe.style.pointerEvents).toBe('')
    Expect(first.preview.frame!.dataset['previewInteractive']).toBe('true')
    Expect(second.iframe.style.pointerEvents).toBe('none')
    emit(second.viewport.children[1]!, 'click')
    Expect(first.iframe.style.pointerEvents).toBe('none')
    Expect(first.preview.frame!.dataset['previewInteractive']).toBeUndefined()
    Expect(second.preview.frame!.dataset['previewInteractive']).toBe('true')
    Expect(activations).toEqual(['preview-0', 'preview-1'])
  })
})

Test('Studio outside pointer capture deselects despite cancelled controls while Space pans preserve selection', () => {
  activationTest(({ add, controls, document, host, activations }) => {
    const { iframe, viewport } = add()
    controls.reconcile()
    emit(viewport.children[1]!, 'click')
    document.activeElement = iframe
    emit(document, 'pointerdown', { target: iframe })
    emit(document, 'click', { target: host, detail: 0 })
    emit(document, 'pointerdown', { target: host, button: 1 })
    host.dataset['canvasPanReady'] = 'true'
    emit(document, 'pointerdown', { target: host })
    delete host.dataset['canvasPanReady']
    host.dataset['canvasPanning'] = 'true'
    emit(document, 'pointerdown', { target: host })
    delete host.dataset['canvasPanning']
    Expect(iframe.style.pointerEvents).toBe('')
    Expect(document.activeElement).toBe(iframe)
    const toolbar = document.createElement('button')
    const cancelled = new Event('pointerdown', { cancelable: true })
    Object.defineProperties(cancelled, { target: { value: toolbar }, button: { value: 0 } })
    cancelled.preventDefault()
    cancelled.stopPropagation()
    document.dispatchEvent(cancelled)
    Expect(iframe.style.pointerEvents).toBe('none')
    Expect(document.activeElement).toBeUndefined()
    Expect(activations).toEqual(['preview-0'])
  })
})

Test('Studio retains selection across reconciliation but clears replaced and removed connections', () => {
  activationTest(({ add, controls, previews, document }) => {
    const retained = add()
    controls.reconcile()
    emit(retained.viewport.children[1]!, 'click')
    const added = add()
    controls.reconcile()
    Expect(retained.iframe.style.pointerEvents).toBe('')
    Expect(retained.viewport.children.length).toBe(2)
    Expect(added.iframe.style.pointerEvents).toBe('none')
    const replacement = document.createElement('iframe')
    retained.iframe.remove()
    retained.viewport.append(replacement)
    retained.preview.iframe = replacement as unknown as HTMLIFrameElement
    controls.reconcile()
    Expect(replacement.style.pointerEvents).toBe('none')
    Expect(retained.preview.frame!.dataset['previewInteractive']).toBeUndefined()
    emit(retained.viewport.children[1]!, 'click')
    previews.splice(0, 1)
    controls.reconcile()
    Expect(retained.viewport.children.length).toBe(1)
    Expect(replacement.style.pointerEvents).toBe('')
    Expect(retained.preview.frame!.dataset['previewInteractive']).toBeUndefined()
    Expect(added.iframe.style.pointerEvents).toBe('none')
  })
})

Test('Studio fallback preview activates by keyboard without reparenting and restores input on disposal', () => {
  activationTest(({ add, controls, host, document, activations }) => {
    const { iframe } = add(true)
    iframe.style.pointerEvents = 'auto'
    iframe.tabIndex = 3
    controls.reconcile()
    const shield = host.children[1]!
    Expect(shield.className).toContain('studio-preview-activation-whole-app')
    Expect(iframe.parentElement).toBe(host)
    Expect(emit(shield, 'keydown', { key: 'Enter' }).defaultPrevented).toBe(true)
    Expect(iframe.dataset['previewInteractive']).toBe('true')
    controls.clear()
    Expect(iframe.style.pointerEvents).toBe('none')
    emit(shield, 'keydown', { key: ' ' })
    Expect(activations).toEqual(['preview-0', 'preview-0'])
    controls.dispose()
    Expect(host.children).toEqual([iframe])
    Expect(iframe.style.pointerEvents).toBe('auto')
    Expect(iframe.tabIndex).toBe(3)
    Expect(iframe.dataset['previewInteractive']).toBeUndefined()
    emit(shield, 'click')
    emit(document, 'click', { target: host })
    controls.reconcile()
    Expect(activations).toEqual(['preview-0', 'preview-0'])
    Expect(host.children).toEqual([iframe])
  })
})

Test('Studio neutral pan excludes controls and active previews and activation ignores Space pans', () => {
  activationTest(({ add, controls, host, document, activations }) => {
    const { iframe, viewport } = add()
    controls.reconcile()
    const shield = viewport.children[1]!
    const canPan = (target: PreviewElement, button = 0) =>
      controls.canPanWithoutSpace({ target, button } as unknown as PointerEvent)
    Expect(canPan(host)).toBe(true)
    Expect(canPan(shield, 1)).toBe(true)
    Expect(canPan(viewport)).toBe(true)
    Expect(canPan(iframe)).toBe(false)
    Expect(canPan(shield, 2)).toBe(false)
    const button = document.createElement('button')
    host.append(button)
    Expect(canPan(button)).toBe(false)
    host.dataset['canvasPanReady'] = 'true'
    emit(shield, 'click')
    Expect(activations).toEqual([])
    delete host.dataset['canvasPanReady']
    emit(shield, 'click')
    Expect(canPan(viewport)).toBe(false)
    Expect(canPan(shield)).toBe(false)
    Expect(canPan(iframe, 1)).toBe(false)
  })
})
