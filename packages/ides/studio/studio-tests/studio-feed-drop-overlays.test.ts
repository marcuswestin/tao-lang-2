import { Expect, Test } from '@shared/test'
import { type StudioPreviewWiringDeps, wireStudioPreviews } from '../studio-src/client/app/StudioPreviewWiring'
import { mountFeedDropOverlay } from '../studio-src/client/matrix/StudioFeedDropOverlays'
import type { StudioPreviewConnection } from '../studio-src/client/matrix/StudioPreviewConnection'

const payload = { kind: 'field', entity: 'Story', rowId: 'typical', path: ['Title'], presentation: 'text' }
const transfer = {
  types: ['application/x-tao-studio-feed'],
  dropEffect: 'none',
  getData: (mime: string) => mime === 'application/x-tao-studio-feed' ? JSON.stringify(payload) : '',
}

function fixture() {
  const document = Object.assign(new EventTarget(), { defaultView: new EventTarget() })
  const host = Object.assign(new EventTarget(), { dataset: {} as Record<string, string>, ownerDocument: document })
  const messages: unknown[] = []
  const preview = {
    interactionMode: 'edit',
    origin: 'http://preview.local:9000',
    previewInstanceId: 'preview-1',
    cellIdentity: { appName: 'Reader', project: '/reader', cellId: 'story', cellRevision: 2 },
    iframe: {
      clientWidth: 400,
      clientHeight: 800,
      getBoundingClientRect: () => ({ left: 100, top: 200, right: 300, bottom: 600, width: 200, height: 400 }),
      contentWindow: { postMessage: (message: unknown, origin: string) => messages.push({ message, origin }) },
    },
  } as unknown as StudioPreviewConnection
  let enabled = true
  const dispose = mountFeedDropOverlay(host as unknown as HTMLElement, [preview], () => enabled)
  const emit = (target: EventTarget, type: string, values: Record<string, unknown> = {}): Event => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      clientX: 150,
      clientY: 260,
      dataTransfer: transfer,
      ...values,
    })
    target.dispatchEvent(event)
    return event
  }
  return {
    document,
    host,
    preview,
    messages,
    dispose,
    emit,
    disable: () => {
      enabled = false
    },
  }
}

Test('Feed overlay forwards a native drop at zoomed iframe coordinates to only its current preview', () => {
  const f = fixture()
  try {
    f.emit(f.document, 'dragstart')
    Expect(f.host.dataset['feedDragging']).toBe('true')
    Expect(f.emit(f.host, 'dragover').defaultPrevented).toBe(true)
    f.emit(f.host, 'drop')
    Expect(f.messages).toEqual([{
      origin: 'http://preview.local:9000',
      message: {
        channel: 'tao-studio',
        protocolVersion: 1,
        type: 'feed-drop-at-point',
        identity: {
          appName: 'Reader',
          project: '/reader',
          cellId: 'story',
          cellRevision: 2,
          previewInstanceId: 'preview-1',
        },
        drop: payload,
        clientX: 100,
        clientY: 120,
      },
    }])
    Expect(f.host.dataset['feedDragging']).toBeUndefined()
  } finally {
    f.dispose()
  }
})

Test('Feed overlay rejects non-Feed drags, misses, malformed payloads, Run mode and held Space', () => {
  const f = fixture()
  try {
    f.emit(f.document, 'dragstart', { dataTransfer: { types: ['text/plain'] } })
    Expect(f.host.dataset['feedDragging']).toBeUndefined()
    Expect(f.emit(f.host, 'drop').defaultPrevented).toBe(false)
    f.emit(f.document, 'dragstart')
    f.emit(f.host, 'drop', { clientX: 99 })
    f.emit(f.document, 'dragstart')
    f.emit(f.host, 'drop', { dataTransfer: { ...transfer, getData: () => '{}' } })
    f.emit(f.document, 'dragstart')
    f.emit(f.host, 'drop', {
      dataTransfer: { ...transfer, getData: () => '{"kind":"entity","entity":"Story","rowId":"typical"}' },
    })
    f.preview.interactionMode = 'run'
    f.emit(f.document, 'dragstart')
    f.emit(f.host, 'drop')
    f.preview.interactionMode = 'edit'
    f.host.dataset['canvasPanReady'] = 'true'
    f.emit(f.document, 'dragstart')
    f.emit(f.host, 'drop')
    f.disable()
    f.emit(f.document, 'dragstart')
    Expect(f.host.dataset['feedDragging']).toBeUndefined()
    Expect(f.messages).toEqual([])
  } finally {
    f.dispose()
  }
})

Test('Feed overlay releases hit testing on cancellation, external drop and disposal', () => {
  const f = fixture()
  try {
    for (const type of ['dragend', 'drop', 'keydown']) {
      f.emit(f.document, 'dragstart')
      f.emit(f.document, type, { key: 'Escape' })
      Expect(f.host.dataset['feedDragging']).toBeUndefined()
    }
    f.emit(f.document, 'dragstart')
    f.emit(f.document.defaultView, 'blur')
    Expect(f.host.dataset['feedDragging']).toBeUndefined()
    f.emit(f.document, 'dragstart')
    f.dispose()
    Expect(f.host.dataset['feedDragging']).toBeUndefined()
    f.emit(f.document, 'dragstart')
    Expect(f.host.dataset['feedDragging']).toBeUndefined()
    Expect(f.emit(f.host, 'drop').defaultPrevented).toBe(false)
    Expect(f.messages).toEqual([])
  } finally {
    f.dispose()
  }
})

Test('Feed and palette listeners on the same canvas route only their own drop MIME', () => {
  const f = fixture()
  const status = { dataset: { state: 'compiled' }, textContent: 'Ready' }
  let mutations = 0
  wireStudioPreviews({
    activePreview: { subscribe() {}, reconcile() {}, current: () => undefined },
    session: { activeFile: () => undefined },
    preview: f.host,
    status,
    mutations: { submitLocal: () => mutations++ },
  } as unknown as StudioPreviewWiringDeps)
  try {
    f.emit(f.document, 'dragstart')
    f.emit(f.host, 'drop')
    Expect(f.messages).toHaveLength(1)
    Expect(status).toEqual({ dataset: { state: 'compiled' }, textContent: 'Ready' })
    f.emit(f.host, 'drop', { dataTransfer: { types: ['text/plain'], getData: () => 'external text' } })
    Expect(status.textContent).toBe('Ready')
    f.emit(f.host, 'drop', {
      dataTransfer: { types: ['application/x-tao-studio-palette'], getData: () => '{invalid' },
    })
    Expect(status).toEqual({
      dataset: { state: 'error' },
      textContent: 'Studio could not read the dropped palette item.',
    })
    Expect(mutations).toBe(0)
  } finally {
    f.dispose()
  }
})
