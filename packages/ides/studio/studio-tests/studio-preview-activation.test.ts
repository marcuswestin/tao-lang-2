import { Expect, settle, Test, testOverrideSlot } from '@shared/test'
import { previewActivationToggle } from '../studio-src/client/matrix/StudioPreviewCellView'
import type { StudioPreviewConnection } from '../studio-src/client/matrix/StudioPreviewConnection'
import { mountPreviewFocus } from '../studio-src/client/matrix/StudioPreviewFocus'

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

const documentSlot = testOverrideSlot<PropertyDescriptor | undefined>({
  equals: (left, right) => left?.value === right?.value,
  read: () => Object.getOwnPropertyDescriptor(globalThis, 'document'),
  write: value => {
    if (value === undefined) {
      Reflect.deleteProperty(globalThis, 'document')
    } else {
      Object.defineProperty(globalThis, 'document', value)
    }
  },
})

Test('Studio preview toggle starts off and reports activation accessibly', async () => {
  const document = previewDocument()
  const restore = documentSlot.install({ configurable: true, value: document })
  let toggles = 0
  const preview = {
    activated: false,
    toggleActivation: async () => {
      toggles++
    },
  } as StudioPreviewConnection
  try {
    const inactive = previewActivationToggle(preview) as unknown as PreviewElement
    Expect(inactive.attributes.get('aria-label')).toBe('Activate preview')
    Expect(inactive.attributes.get('aria-pressed')).toBe('false')
    Expect(inactive.title).toBe('Activate preview')
    emit(inactive, 'click')
    await settle()
    Expect(toggles).toBe(1)
    preview.activated = true
    const active = previewActivationToggle(preview) as unknown as PreviewElement
    Expect(active.attributes.get('aria-label')).toBe('Deactivate preview')
    Expect(active.attributes.get('aria-pressed')).toBe('true')
  } finally {
    restore()
  }
})

function emit(target: EventTarget, type: string, values: Record<string, unknown> = {}): Event {
  const event = new Event(type, { cancelable: true })
  for (const [key, value] of Object.entries({ button: 0, detail: 1, ...values })) {
    Object.defineProperty(event, key, { value })
  }
  target.dispatchEvent(event)
  return event
}

function focusTest(
  run: (fixture: {
    host: PreviewElement
    document: ReturnType<typeof previewDocument>
    previews: StudioPreviewConnection[]
    controls: ReturnType<typeof mountPreviewFocus>
    add: (wholeApp?: boolean) => { preview: StudioPreviewConnection; iframe: PreviewElement; viewport: PreviewElement }
    focuses: string[]
  }) => void,
): void {
  const restore = elementSlot.install({ configurable: true, value: PreviewElement })
  const document = previewDocument()
  const host = document.createElement('div')
  const previews: StudioPreviewConnection[] = []
  const focuses: string[] = []
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
      focus: () => focuses.push(id),
    }
    previews.push(preview)
    return { preview, iframe, viewport }
  }
  const controls = mountPreviewFocus(host as unknown as HTMLElement, previews)
  try {
    run({ host, document, previews, controls, add, focuses })
  } finally {
    controls.dispose()
    restore()
  }
}

Test('Studio requires a consumed focus click before one preview accepts input', () => {
  focusTest(({ add, controls, focuses }) => {
    const first = add()
    const second = add()
    controls.reconcile()
    Expect(first.iframe.style.pointerEvents).toBe('none')
    Expect(second.iframe.style.pointerEvents).toBe('none')
    Expect(first.iframe.tabIndex).toBe(-1)
    const shield = first.viewport.children[1]!
    Expect(shield.attributes.get('aria-label')).toBe('Focus App preview')
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
    Expect(focuses).toEqual(['preview-0', 'preview-1'])
  })
})

Test('Studio outside pointer capture clears focus despite cancelled controls while Space pans preserve focus', () => {
  focusTest(({ add, controls, document, host, focuses }) => {
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
    Expect(focuses).toEqual(['preview-0'])
  })
})

Test('Studio retains focus across reconciliation but clears replaced and removed connections', () => {
  focusTest(({ add, controls, previews, document }) => {
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

Test('Studio fallback preview focuses by keyboard without reparenting and restores input on disposal', () => {
  focusTest(({ add, controls, host, document, focuses }) => {
    const { iframe } = add(true)
    iframe.style.pointerEvents = 'auto'
    iframe.tabIndex = 3
    controls.reconcile()
    const shield = host.children[1]!
    Expect(shield.className).toContain('studio-preview-focus-whole-app')
    Expect(iframe.parentElement).toBe(host)
    Expect(emit(shield, 'keydown', { key: 'Enter' }).defaultPrevented).toBe(true)
    Expect(iframe.dataset['previewInteractive']).toBe('true')
    controls.clear()
    Expect(iframe.style.pointerEvents).toBe('none')
    emit(shield, 'keydown', { key: ' ' })
    Expect(focuses).toEqual(['preview-0', 'preview-0'])
    controls.dispose()
    Expect(host.children).toEqual([iframe])
    Expect(iframe.style.pointerEvents).toBe('auto')
    Expect(iframe.tabIndex).toBe(3)
    Expect(iframe.dataset['previewInteractive']).toBeUndefined()
    emit(shield, 'click')
    emit(document, 'click', { target: host })
    controls.reconcile()
    Expect(focuses).toEqual(['preview-0', 'preview-0'])
    Expect(host.children).toEqual([iframe])
  })
})

Test('Studio neutral pan excludes controls and focused previews and focus ignores Space pans', () => {
  focusTest(({ add, controls, host, document, focuses }) => {
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
    Expect(focuses).toEqual([])
    delete host.dataset['canvasPanReady']
    emit(shield, 'click')
    Expect(canPan(viewport)).toBe(false)
    Expect(canPan(shield)).toBe(false)
    Expect(canPan(iframe, 1)).toBe(false)
  })
})
