import { Describe, Expect, Test } from '@shared/test'
import {
  collectStudioPreviewLayoutMeasurements,
  mountStudioPreviewBridge,
  publishStudioScheme,
  replayStudioJourney,
  type StudioPreviewConfig,
  type StudioPreviewElement,
  type StudioPreviewHost,
} from '../TaoRuntime-src/TR-studio-preview'
import { Clock } from '../TaoRuntime-src/TR-units'

type Listener = (event: unknown) => void

type PostedMessage = {
  message: unknown
  targetOrigin: string
}

type FakeOverlay = StudioPreviewElement & {
  attributes: Record<string, string>
  removed: boolean
  remove(): void
  setAttribute(name: string, value: string): void
  style: Record<string, string>
}

const config: StudioPreviewConfig = {
  appName: 'Demo',
  compileRevision: 7,
  parentOrigin: 'http://127.0.0.1:5500',
  previewInstanceId: 'preview-1',
  project: '/project',
  sourceVersions: { '/project/Main.tao': 'version-1' },
}

Describe('Studio preview runtime bridge', () => {
  Test('collects finite non-negative render geometry relative to the cell content root', () => {
    const measured = renderElement('/project/Main.tao', 10, 20, {
      height: 40,
      left: 25,
      top: 35,
      width: 80,
    }, { elementName: 'Text', studioRectId: 'art' })
    const outside = renderElement('/project/Main.tao', 30, 40, {
      height: 10,
      left: 5,
      top: 35,
      width: 10,
    }, { elementName: 'Button' })

    Expect(collectStudioPreviewLayoutMeasurements(
      [measured, outside],
      { height: 200, left: 10, top: 20, width: 200 },
    )).toEqual([{
      elementName: 'Text',
      rect: { height: 40, width: 80, x: 15, y: 15 },
      renderId: '/project/Main.tao:10:20',
      studioRectId: 'art',
    }])
  })

  Test('coalesces layout reporting after apply and resize', async () => {
    const element = renderElement('/project/Main.tao', 10, 20, {
      height: 40,
      left: 25,
      top: 35,
      width: 80,
    }, { elementName: 'Text', studioRectId: 'art' })
    const fake = previewHost([element])
    fake.host.document.body = {
      appendChild: overlay => fake.overlays.push(overlay as FakeOverlay),
      getBoundingClientRect: () => ({ height: 200, left: 10, top: 20, width: 200 }),
    }
    const cleanup = mountStudioPreviewBridge(config, fake.host)

    await Promise.resolve()
    Expect(fake.messages[1]?.message).toMatchObject({
      measurements: [{
        elementName: 'Text',
        rect: { height: 40, width: 80, x: 15, y: 15 },
        renderId: '/project/Main.tao:10:20',
        studioRectId: 'art',
      }],
      type: 'preview-layout-measurements',
    })
    fake.dispatchWindow('resize', {})
    fake.dispatchWindow('resize', {})
    await Promise.resolve()
    Expect(fake.messages.filter(post => (post.message as { type?: string }).type === 'preview-layout-measurements'))
      .toHaveLength(2)
    cleanup()
  })
  Test('replays text steps against the deepest exact match instead of its matching ancestors', async () => {
    const events: string[] = []
    const parent: StudioPreviewElement = {
      dispatchEvent: event => {
        events.push(`parent:${String((event as { type?: string }).type)}`)
        return true
      },
      getAttribute: () => null,
      getBoundingClientRect: () => ({ height: 0, left: 0, top: 0, width: 0 }),
      textContent: 'Save',
    }
    const leaf: StudioPreviewElement = {
      dispatchEvent: event => {
        events.push(`leaf:${String((event as { type?: string }).type)}`)
        return true
      },
      getAttribute: () => null,
      getBoundingClientRect: () => ({ height: 0, left: 0, top: 0, width: 0 }),
      parentElement: parent,
      textContent: 'Save',
    }
    const fake = previewHost([parent, leaf])

    await replayStudioJourney([{ kind: 'hover', selector: 'text', target: 'Save' }], fake.host)

    Expect(events).toEqual(['leaf:mouseover', 'leaf:mouseenter'])
  })

  Test('maps the held-pointer journey to browser phases in exact order', async () => {
    const observed: string[] = []
    const target: StudioPreviewElement = {
      dispatchEvent: event => {
        observed.push(String((event as { type?: string }).type))
        return true
      },
      focus: () => observed.push('focus'),
      getAttribute: name => name === 'data-testid' ? 'revertSave' : null,
      getBoundingClientRect: () => ({ height: 0, left: 0, top: 0, width: 0 }),
    }
    const fake = previewHost([target])

    await replayStudioJourney([
      { kind: 'pressDown', selector: 'tag', target: 'revertSave' },
      { kind: 'advance', milliseconds: 600 },
      { kind: 'pressUp', selector: 'tag', target: 'revertSave' },
      { kind: 'hover', selector: 'tag', target: 'revertSave' },
      { kind: 'focus', tag: 'revertSave' },
    ], fake.host)

    Expect(observed).toEqual(['mousedown', 'mouseup', 'mouseover', 'mouseenter', 'focus'])
  })

  Test('does not freeze the app clock for a journey with no advance step', async () => {
    const target: StudioPreviewElement = {
      dispatchEvent: () => true,
      getAttribute: name => name === 'data-testid' ? 'target' : null,
      getBoundingClientRect: () => ({ height: 0, left: 0, top: 0, width: 0 }),
    }
    const fake = previewHost([target])
    Clock.beginTest(1234)
    try {
      await replayStudioJourney([{ kind: 'pressDown', selector: 'tag', target: 'target' }], fake.host)
      Expect(Clock.now()).toBe(1234)
    } finally {
      Clock.endTest()
    }
  })

  Test('keeps state reached by an advanced held-pointer journey after replay releases the clock', async () => {
    let reached = false
    const target: StudioPreviewElement = {
      dispatchEvent: event => {
        if ((event as { type?: string }).type === 'mousedown') {
          Clock.after(600, () => {
            reached = true
          })
        }
        return true
      },
      getAttribute: name => name === 'data-testid' ? 'hold' : null,
      getBoundingClientRect: () => ({ height: 0, left: 0, top: 0, width: 0 }),
    }
    const fake = previewHost([target])

    await replayStudioJourney([
      { kind: 'pressDown', selector: 'tag', target: 'hold' },
      { kind: 'advance', milliseconds: 600 },
      { kind: 'pressUp', selector: 'tag', target: 'hold' },
    ], fake.host)

    Expect(reached).toBe(true)
  })

  Test('publishes the runtime-resolved Scheme with complete provenance', () => {
    const fake = previewHost([])
    publishStudioScheme(config, {
      capability: 'reactive-browser',
      requested: 'system',
      resolved: 'dark',
      source: 'system',
    }, fake.host)

    Expect(fake.messages).toContainEqual({
      message: Expect['objectContaining']({
        scheme: {
          capability: 'reactive-browser',
          requested: 'system',
          resolved: 'dark',
          source: 'system',
        },
        type: 'preview-scheme-changed',
      }),
      targetOrigin: config.parentOrigin,
    })
  })

  Test('separates normal app interaction from selecting and visual editing', () => {
    const render = renderElement('/project/Main.tao', 12, 28, { height: 30, left: 20, top: 10, width: 80 })
    const fake = previewHost([render])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    let blocked = 0
    const pointer = {
      preventDefault: () => {
        blocked += 1
      },
      stopImmediatePropagation: () => {
        blocked += 1
      },
      stopPropagation: () => {
        blocked += 1
      },
      target: render,
    }

    fake.dispatchWindow('message', interactionModeMessage('run', fake.parent))
    fake.dispatchDocument('mouseover', pointer)
    fake.dispatchDocument('click', pointer)
    Expect(blocked).toBe(0)
    Expect(fake.messages).toHaveLength(1)
    Expect(fake.overlays).toHaveLength(0)

    fake.dispatchWindow('message', interactionModeMessage('edit', fake.parent))
    fake.dispatchDocument('mouseover', pointer)
    fake.dispatchDocument('click', pointer)
    Expect(blocked).toBe(3)
    Expect(fake.messages[1]?.message).toMatchObject({ type: 'preview-hover-source' })
    Expect(fake.messages[2]?.message).toMatchObject({ type: 'preview-select-source' })
    Expect(fake.overlays[0]?.attributes['data-tao-studio-overlay']).toBe('selection')
    cleanup()
  })

  Test('captures fixture data only for an exact trusted parent request', async () => {
    const fake = previewHost([])
    const fixture = {
      accounts: [],
      creates: [{ entity: 'Story', fields: { Title: 'Captured' }, name: 'Story1' }],
    } as const
    const cleanup = mountStudioPreviewBridge(config, fake.host, async () => fixture)
    const request = {
      channel: 'tao-studio',
      identity: { appName: 'Demo', previewInstanceId: 'preview-1', project: '/project' },
      protocolVersion: 1,
      requestId: 'capture-1',
      type: 'capture-fixture',
    }

    fake.dispatchWindow('message', { data: request, origin: 'https://attacker.invalid', source: fake.parent })
    fake.dispatchWindow('message', { data: request, origin: config.parentOrigin, source: fake.parent })
    await Promise.resolve()

    Expect(fake.messages).toHaveLength(2)
    Expect(fake.messages[1]).toEqual({
      message: {
        channel: 'tao-studio',
        fixture,
        identity: { appName: 'Demo', previewInstanceId: 'preview-1', project: '/project' },
        protocolVersion: 1,
        requestId: 'capture-1',
        type: 'preview-fixture-captured',
      },
      targetOrigin: config.parentOrigin,
    })
    cleanup()
  })

  Test('forwards bounded preview console records and restores the console on cleanup', () => {
    const fake = previewHost([])
    const original = fake.host.console?.log
    const cleanup = mountStudioPreviewBridge(config, fake.host)

    fake.host.console?.log?.('loaded', { count: 2 })

    Expect(fake.consoleCalls).toEqual([['loaded', { count: 2 }]])
    Expect(fake.messages.at(-1)?.message).toMatchObject({
      arguments: ['loaded', { count: 2 }],
      level: 'log',
      type: 'preview-console',
    })
    cleanup()
    Expect(fake.host.console?.log).toBe(original)
  })

  Test('reports applied revisions and maps pointer identity back to trusted Studio source messages', () => {
    const render = renderElement('/project/Main.tao', 12, 28, { height: 30, left: 20, top: 10, width: 80 })
    const fake = previewHost([render])
    const cleanup = mountStudioPreviewBridge(config, fake.host)

    Expect(fake.messages).toEqual([{
      message: {
        appliedRevision: 7,
        channel: 'tao-studio',
        compileRevision: 7,
        identity: { appName: 'Demo', previewInstanceId: 'preview-1', project: '/project' },
        protocolVersion: 1,
        type: 'preview-applied',
      },
      targetOrigin: 'http://127.0.0.1:5500',
    }])

    fake.dispatchDocument('mouseover', { target: render })
    Expect(fake.messages[1]).toEqual({
      message: {
        channel: 'tao-studio',
        identity: {
          appName: 'Demo',
          occurrence: { nodeKind: 'render', renderOwner: 'MainView' },
          path: '/project/Main.tao',
          previewInstanceId: 'preview-1',
          project: '/project',
          sourceVersion: 'version-1',
        },
        protocolVersion: 1,
        range: { end: 28, start: 12 },
        type: 'preview-hover-source',
      },
      targetOrigin: 'http://127.0.0.1:5500',
    })
    Expect(fake.overlays[0]?.attributes['data-tao-studio-overlay']).toBe('hover')

    fake.dispatchDocument('click', { target: render })
    Expect(fake.messages[2]?.message).toEqual({
      channel: 'tao-studio',
      identity: {
        appName: 'Demo',
        occurrence: { nodeKind: 'render', renderOwner: 'MainView' },
        path: '/project/Main.tao',
        previewInstanceId: 'preview-1',
        project: '/project',
        sourceVersion: 'version-1',
      },
      protocolVersion: 1,
      range: { end: 28, start: 12 },
      type: 'preview-select-source',
    })
    Expect(fake.overlays[0]?.attributes['data-tao-studio-overlay']).toBe('selection')

    cleanup()
    Expect(fake.overlays[0]?.removed).toBe(true)
    Expect(fake.listenerCount()).toBe(0)
    fake.dispatchDocument('click', { target: render })
    Expect(fake.messages.length).toBe(3)
  })

  Test('accepts source highlights only from the configured parent and current source version', () => {
    const broad = renderElement('/project/Main.tao', 0, 100, { height: 90, left: 5, top: 6, width: 120 })
    const precise = renderElement('/project/Main.tao', 30, 40, { height: 20, left: 25, top: 36, width: 50 })
    const fake = previewHost([broad, precise])
    const cleanup = mountStudioPreviewBridge(config, fake.host)
    const highlight = highlightMessage('version-1')

    fake.dispatchWindow('message', { data: highlight, origin: 'https://attacker.example', source: fake.parent })
    fake.dispatchWindow('message', {
      data: highlightMessage('obsolete'),
      origin: config.parentOrigin,
      source: fake.parent,
    })
    fake.dispatchWindow('message', { data: highlight, origin: config.parentOrigin, source: {} })
    Expect(fake.overlays.length).toBe(0)

    fake.dispatchWindow('message', { data: highlight, origin: config.parentOrigin, source: fake.parent })
    Expect(fake.overlays.length).toBe(1)
    Expect(fake.overlays[0]?.attributes['data-tao-studio-overlay']).toBe('source')
    Expect(fake.overlays[0]?.style).toMatchObject({
      display: 'block',
      height: '20px',
      left: '25px',
      top: '36px',
      width: '50px',
    })

    fake.dispatchWindow('message', {
      data: { ...highlight, range: undefined },
      origin: config.parentOrigin,
      source: fake.parent,
    })
    Expect(fake.overlays[0]?.style['display']).toBe('none')

    cleanup()
  })

  Test('carries complete matrix-cell identity through every preview message', () => {
    const fake = previewHost([])
    const cellConfig: StudioPreviewConfig = {
      ...config,
      cellId: 'cell:phone',
      cellRevision: 2,
      manifestRevision: 'manifest-7',
    }
    const cleanup = mountStudioPreviewBridge(cellConfig, fake.host)

    Expect(fake.messages[0]?.message).toMatchObject({
      identity: {
        appName: 'Demo',
        cellId: 'cell:phone',
        cellRevision: 2,
        compileRevision: 7,
        manifestRevision: 'manifest-7',
        previewInstanceId: 'preview-1',
        project: '/project',
      },
    })
    cleanup()

    const invalid = previewHost([])
    mountStudioPreviewBridge({ ...config, cellId: 'partial' }, invalid.host)()
    Expect(invalid.messages).toEqual([])
  })

  Test('turns one render drag into one versioned semantic move action', () => {
    const first = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 10, top: 10, width: 100 })
    const second = renderElement('/project/Main.tao', 30, 40, { height: 20, left: 10, top: 50, width: 100 })
    const third = renderElement('/project/Main.tao', 50, 60, { height: 20, left: 10, top: 90, width: 100 })
    const fake = previewHost([first, second, third])
    const cleanup = mountStudioPreviewBridge(config, fake.host)

    fake.dispatchDocument('mousedown', { clientX: 40, clientY: 100, target: third })
    fake.dispatchDocument('mousemove', { clientX: 40, clientY: 40, target: second })
    fake.dispatchDocument('mouseup', { clientX: 40, clientY: 40, preventDefault() {}, target: second })

    Expect(fake.messages[1]).toMatchObject({
      message: {
        action: {
          afterId: '/project/Main.tao:10:20',
          beforeId: '/project/Main.tao:30:40',
          draggedId: '/project/Main.tao:50:60',
          kind: 'move-render',
        },
        channel: 'tao-studio',
        checkpoint: { phase: 'single' },
        identity: {
          appName: 'Demo',
          occurrence: { nodeKind: 'render', renderOwner: 'MainView' },
          path: '/project/Main.tao',
          previewInstanceId: 'preview-1',
          project: '/project',
          sourceVersion: 'version-1',
        },
        protocolVersion: 1,
        sourceActionVersion: 2,
        type: 'source-action',
      },
      targetOrigin: 'http://127.0.0.1:5500',
    })
    Expect((fake.messages[1]?.message as { requestId?: string }).requestId).toMatch(/^preview-preview-1-\d+$/)
    Expect(fake.overlays.filter(overlay => overlay.attributes['data-tao-studio-drag-overlay']).length).toBe(2)
    Expect(fake.overlays.filter(overlay => overlay.removed).length).toBe(2)

    cleanup()
  })

  Test('disarms an abandoned drag before a later mouseup can emit a ghost move', () => {
    const first = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 10, top: 10, width: 100 })
    const second = renderElement('/project/Main.tao', 30, 40, { height: 20, left: 10, top: 50, width: 100 })
    const third = renderElement('/project/Main.tao', 50, 60, { height: 20, left: 10, top: 90, width: 100 })
    const fake = previewHost([first, second, third])
    const cleanup = mountStudioPreviewBridge(config, fake.host)

    fake.dispatchDocument('mousedown', { clientX: 40, clientY: 100, target: third })
    fake.dispatchDocument('mousemove', { clientX: 40, clientY: 40, target: second })
    fake.dispatchDocument('mouseleave', {})
    fake.dispatchDocument('mouseup', { clientX: 40, clientY: 40, target: second })

    Expect(fake.messages).toHaveLength(1)
    Expect(fake.overlays.filter(overlay => overlay.removed)).toHaveLength(2)
    cleanup()
  })

  Test('emits edge-anchor moves when only one sibling remains', () => {
    const first = renderElement('/project/Main.tao', 10, 20, { height: 20, left: 10, top: 10, width: 100 })
    const second = renderElement('/project/Main.tao', 30, 40, { height: 20, left: 10, top: 50, width: 100 })

    const beforeFake = previewHost([first, second])
    const cleanupBefore = mountStudioPreviewBridge(config, beforeFake.host)
    beforeFake.dispatchDocument('mousedown', { clientX: 40, clientY: 60, target: second })
    beforeFake.dispatchDocument('mousemove', { clientX: 40, clientY: 0, target: first })
    beforeFake.dispatchDocument('mouseup', { clientX: 40, clientY: 0, preventDefault() {}, target: first })
    Expect(beforeFake.messages[1]).toMatchObject({
      message: {
        action: {
          beforeId: '/project/Main.tao:10:20',
          draggedId: '/project/Main.tao:30:40',
          kind: 'move-render',
        },
        type: 'source-action',
      },
    })
    cleanupBefore()

    const afterFake = previewHost([first, second])
    const cleanupAfter = mountStudioPreviewBridge(config, afterFake.host)
    afterFake.dispatchDocument('mousedown', { clientX: 40, clientY: 20, target: first })
    afterFake.dispatchDocument('mousemove', { clientX: 40, clientY: 100, target: second })
    afterFake.dispatchDocument('mouseup', { clientX: 40, clientY: 100, preventDefault() {}, target: second })
    Expect(afterFake.messages[1]).toMatchObject({
      message: {
        action: {
          afterId: '/project/Main.tao:30:40',
          draggedId: '/project/Main.tao:10:20',
          kind: 'move-render',
        },
        type: 'source-action',
      },
    })
    cleanupAfter()
  })

  Test('stays inert without an exact trusted web origin', () => {
    const fake = previewHost([])
    const cleanup = mountStudioPreviewBridge({ ...config, parentOrigin: '*' }, fake.host)

    Expect(fake.messages.length).toBe(0)
    Expect(fake.listenerCount()).toBe(0)
    Expect(fake.overlays.length).toBe(0)
    cleanup()
  })
})

function renderElement(
  sourcePath: string,
  start: number,
  end: number,
  rect: { height: number; left: number; top: number; width: number },
  studio: { elementName?: string; studioRectId?: string } = {},
): StudioPreviewElement {
  const identity = JSON.stringify({ end, kind: 'render', ownerName: 'MainView', sourcePath, start, ...studio })
  const element: StudioPreviewElement = {
    closest: () => element,
    getAttribute: name => name === 'data-tao-studio' ? identity : null,
    getBoundingClientRect: () => rect,
  }
  return element
}

function highlightMessage(sourceVersion: string): Record<string, unknown> {
  return {
    channel: 'tao-studio',
    identity: {
      appName: config.appName,
      path: '/project/Main.tao',
      previewInstanceId: config.previewInstanceId,
      project: config.project,
      sourceVersion,
    },
    protocolVersion: 1,
    range: { end: 36, start: 35 },
    type: 'highlight-source',
  }
}

function interactionModeMessage(mode: 'edit' | 'run', parent: StudioPreviewHost['parent']): {
  data: Record<string, unknown>
  origin: string
  source: StudioPreviewHost['parent']
} {
  return {
    data: {
      channel: 'tao-studio',
      identity: {
        appName: config.appName,
        previewInstanceId: config.previewInstanceId,
        project: config.project,
      },
      mode,
      protocolVersion: 1,
      type: 'set-interaction-mode',
    },
    origin: config.parentOrigin,
    source: parent,
  }
}

function previewHost(renderElements: StudioPreviewElement[]): {
  consoleCalls: unknown[][]
  dispatchDocument(type: string, event: unknown): void
  dispatchWindow(type: string, event: unknown): void
  host: StudioPreviewHost
  listenerCount(): number
  messages: PostedMessage[]
  overlays: FakeOverlay[]
  parent: StudioPreviewHost['parent']
} {
  const documentListeners = new Map<string, Set<Listener>>()
  const windowListeners = new Map<string, Set<Listener>>()
  const messages: PostedMessage[] = []
  const consoleCalls: unknown[][] = []
  const overlays: FakeOverlay[] = []
  const parent = {
    postMessage: (message: unknown, targetOrigin: string) => messages.push({ message, targetOrigin }),
  }
  const host: StudioPreviewHost = {
    console: {
      log: (...arguments_) => consoleCalls.push(arguments_),
    },
    document: {
      addEventListener: (type, listener) => {
        addListener(documentListeners, type, listener as unknown as Listener)
      },
      body: { appendChild: overlay => overlays.push(overlay as FakeOverlay) },
      createElement: () => {
        const overlay: FakeOverlay = {
          attributes: {},
          getAttribute: name => overlay.attributes[name] ?? null,
          getBoundingClientRect: () => ({ height: 0, left: 0, top: 0, width: 0 }),
          removed: false,
          remove: () => {
            overlay.removed = true
          },
          setAttribute: (name, value) => {
            overlay.attributes[name] = value
          },
          style: {},
        }
        return overlay
      },
      querySelectorAll: () => renderElements,
      removeEventListener: (type, listener) => {
        removeListener(documentListeners, type, listener as unknown as Listener)
      },
    },
    parent,
    window: {
      addEventListener: (type, listener) => {
        addListener(windowListeners, type, listener as unknown as Listener)
      },
      removeEventListener: (type, listener) => {
        removeListener(windowListeners, type, listener as unknown as Listener)
      },
    },
  }
  return {
    consoleCalls,
    dispatchDocument: (type, event) => dispatch(documentListeners, type, event),
    dispatchWindow: (type, event) => dispatch(windowListeners, type, event),
    host,
    listenerCount: () => listenerCount(documentListeners) + listenerCount(windowListeners),
    messages,
    overlays,
    parent,
  }
}

function addListener(listeners: Map<string, Set<Listener>>, type: string, listener: Listener): void {
  const group = listeners.get(type) ?? new Set<Listener>()
  group.add(listener)
  listeners.set(type, group)
}

function removeListener(listeners: Map<string, Set<Listener>>, type: string, listener: Listener): void {
  listeners.get(type)?.delete(listener)
}

function dispatch(listeners: Map<string, Set<Listener>>, type: string, event: unknown): void {
  for (const listener of listeners.get(type) ?? []) {
    listener(event)
  }
}

function listenerCount(listeners: Map<string, Set<Listener>>): number {
  return Array.from(listeners.values()).reduce((count, group) => count + group.size, 0)
}
