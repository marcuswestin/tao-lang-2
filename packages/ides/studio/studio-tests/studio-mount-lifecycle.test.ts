import { Errors } from '@shared/core'
import { AfterAll, Deferred, Expect, MockModule, Test, testOverrideSlot } from '@shared/test'
import type { StudioFeedBrowseResult } from '../studio-src/StudioFeedProtocol'

const emptyFeed: StudioFeedBrowseResult = {
  catalog: { formatVersion: 1, nextViewNumber: 1, revision: 0, sketches: [] },
  inventory: { entities: [] },
  canUndo: false,
  draftRevision: 0,
  pending: false,
}

function node(document?: EventTarget) {
  return Object.assign(new EventTarget(), {
    dataset: {} as Record<string, string>,
    ownerDocument: document,
    children: [],
    querySelector: (_selector: string): unknown => null,
    querySelectorAll: () => [],
    toggleAttribute() {},
  })
}

function fixture() {
  const window = Object.assign(new EventTarget(), { localStorage: { getItem: () => null }, TaoStudioConfig: {} })
  const document = Object.assign(new EventTarget(), { defaultView: window })
  const root = node(document)
  const preview = node(document)
  const draw = node(document)
  draw.querySelector = () => ({})
  preview.querySelector = selector => selector === ':scope > [data-tao-studio-draw-canvas]' ? draw : null
  const disposed: string[] = []
  const view = Object.fromEntries([
    'status',
    'device',
    'devicePopover',
    'interactionMode',
    'drawerTabs',
    'searchInput',
    'rail',
  ].map(name => [name, node(document)]))
  Object.assign(view, { preview, dispose: () => disposed.push('view') })
  return {
    root,
    preview,
    document,
    window,
    view,
    disposed,
    startup: Deferred<void>(),
    started: Deferred<void>(),
    browse: Deferred<StudioFeedBrowseResult>(),
    snapshots: [] as unknown[],
    browseCount: 0,
    canvasRenders: 0,
  }
}

let current: ReturnType<typeof fixture>
const globalSlots = ['window', 'document'].map(key => ({
  key,
  slot: testOverrideSlot<PropertyDescriptor | undefined>({
    read: () => Object.getOwnPropertyDescriptor(globalThis, key),
    write: descriptor => {
      if (descriptor === undefined) {
        Reflect.deleteProperty(globalThis, key)
      } else {
        Object.defineProperty(globalThis, key, descriptor)
      }
    },
  }),
}))
const restoreModules: (() => void)[] = []
AfterAll(() => {
  for (const restore of restoreModules.reverse()) {
    restore()
  }
})

async function mockClient(path: string, exports: () => object): Promise<void> {
  const url = new URL(`../studio-src/client/${path}.ts`, import.meta.url)
  const original = { ...await import(url.href) }
  restoreModules.push(() => MockModule(url.pathname, () => original))
  MockModule(url.pathname, () => ({ ...original, ...exports() }))
}

await mockClient('StudioShell', () => ({
  createStudioShell: () => current.view,
  studioLayoutPresetChangedEvent: 'tao-studio-layout-preset-changed',
  studioLayoutOwnsCanvasGestures: () => true,
  StudioWorkbenchState: { loadDrawerTab: () => 'Problems', saveDrawerTab() {} },
}))
await mockClient('StudioDialog', () => ({ StudioDialog: { mount: () => () => current.disposed.push('dialogs') } }))
await mockClient('StudioApiClient', () => ({
  StudioApiClient: {
    handshake: async () => ({
      identity: { project: '/reader', appName: 'Reader' },
      files: [],
      compile: { status: 'compiled' },
    }),
    deviceStatus: () => new Promise(() => {}),
    feedBrowse: () => {
      current.browseCount++
      return current.browse.promise
    },
  },
}))
await mockClient('StudioSketchView', () => ({
  StudioSketchView: {
    mount: () => ({ render: () => current.canvasRenders++, dispose() {} }),
  },
}))
await mockClient('StudioMatrixView', () => ({
  connectPreviews: async (parent: HTMLElement) => {
    const { StudioMatrixSketches } = await import('../studio-src/client/matrix/StudioMatrixSketches')
    StudioMatrixSketches.render(parent, '/reader', emptyFeed.catalog)
    return []
  },
  disconnectPreviews: () => current.disposed.push('previews'),
  configureInteractionMode() {},
  mountCanvasViewport: () => ({ cancelPan() {}, dispose: () => current.disposed.push('viewport') }),
  StudioActivePreview: class {
    current() {
      return undefined
    }
    subscribe() {}
    reconcile() {}
  },
}))
await mockClient('StudioDevicePanel', () => ({
  createStudioDevicePanel: () => ({ dispose: () => current.disposed.push('device') }),
}))
await mockClient('app/StudioCompileEvents', () => ({
  StudioStatusLine: { update() {} },
  connectStudioEvents: () => () => current.disposed.push('events'),
}))
await mockClient('app/StudioPreviewStatus', () => ({
  StudioPreviewNotice: class {},
  mountStudioBrowserLaunch: () => () => current.disposed.push('browser'),
  mountStudioPreviewReload() {},
}))
await mockClient('app/StudioCanvasFocus', () => ({
  mountStudioCanvasFocus: () => ({ dispose: () => current.disposed.push('focus') }),
}))
await mockClient('matrix/StudioCanvasViewport', () => ({ applyCanvasViewport() {} }))
await mockClient('app/StudioEditorSession', () => ({
  StudioEditorSession: class {
    activeFile() {
      return undefined
    }
    activePath() {
      return undefined
    }
    editor() {
      return undefined
    }
    async restore(_path: string, check: () => void) {
      check()
    }
    dispose() {
      current.disposed.push('session')
    }
  },
}))
await mockClient('app/StudioInspection', () => ({
  StudioInspection: class {
    selected() {
      return undefined
    }
    inspection() {
      return undefined
    }
  },
}))
await mockClient('app/StudioDrawerPanels', () => ({
  StudioDrawerPanels: class {
    data() {
      return { result: [] }
    }
    tab() {
      return 'Problems'
    }
    tests() {
      return {}
    }
    loadTestStatus() {}
    select() {}
    dispose() {
      current.disposed.push('drawer')
    }
  },
}))
await mockClient('app/StudioProjectSearch', () => ({
  StudioProjectSearch: class {
    results() {
      return []
    }
    dispose() {
      current.disposed.push('search')
    }
  },
}))
await mockClient('app/StudioSourceMutations', () => ({
  StudioSourceMutations: class {
    canUndo() {
      return false
    }
    busy() {
      return false
    }
  },
}))
await mockClient('app/StudioScenarioActions', () => ({ StudioScenarioActions: class {} }))
await mockClient('app/StudioAppNavigation', () => ({ StudioAppNavigation: class {} }))
await mockClient('app/StudioBetaShip', () => ({
  mountStudioBetaShip: () => ({ dispose: () => current.disposed.push('beta-ship') }),
}))
await mockClient('app/StudioAgentPanelWiring', () => ({ mountStudioAgentChat() {} }))
await mockClient('app/StudioCommandPaletteWiring', () => ({ mountStudioCommandPalette: () => ({}) }))
await mockClient('StudioFileTree', () => ({ mountStudioFileTree: () => ({}) }))
await mockClient('app/StudioProductHostState', () => ({
  publishStudioHostSnapshot: (snapshot: unknown) => current.snapshots.push(snapshot),
}))
await mockClient('app/StudioSessionPickers', () => ({
  configureStudioSessionPickers: () => {
    current.started.resolve()
    return current.startup.promise
  },
}))

const protocolUrl = new URL('../studio-src/StudioProductHostProtocol.ts', import.meta.url)
const originalProtocol = { ...await import('../studio-src/StudioProductHostProtocol') }
restoreModules.push(() => MockModule(protocolUrl.pathname, () => originalProtocol))
MockModule(protocolUrl.pathname, () => ({
  ...originalProtocol,
  registerStudioProductHostActions: () => () => current.disposed.push('actions'),
  publishStudioProductHostState() {},
}))

for (const ending of ['abort', 'failure'] as const) {
  Test(`Studio ${ending} during startup releases acquired owners and ignores late Feed work`, async () => {
    current = fixture()
    const f = current
    const restore = globalSlots.map(({ key, slot }) =>
      slot.install({
        configurable: true,
        value: key === 'window' ? f.window : f.document,
      })
    )
    const controller = new AbortController()
    try {
      const { mountStudio } = await import('../studio-src/client/StudioApp')
      const mounted = mountStudio({ root: f.root as unknown as HTMLElement, signal: controller.signal })
      const outcome = mounted.then(() => undefined, error => error as Error)
      await f.started.promise
      Expect(f.browseCount).toBe(1)
      const snapshots = f.snapshots.length
      const renders = f.canvasRenders
      if (ending === 'abort') {
        controller.abort()
      } else {
        f.startup.reject(new Errors.HostEnvironmentError('Startup picker failed'))
        Expect((await outcome)?.message).toBe('Startup picker failed')
      }
      f.document.dispatchEvent(Object.assign(new Event('dragstart'), {
        dataTransfer: { types: ['application/x-tao-studio-feed'] },
      }))
      Expect(f.preview.dataset['feedDragging']).toBeUndefined()
      f.browse.resolve(emptyFeed)
      // Await the production mutation lane and Feed continuation, independently of startup.
      const { StudioMatrixSketches } = await import('../studio-src/client/matrix/StudioMatrixSketches')
      await StudioMatrixSketches.runFeed(f.preview as unknown as HTMLElement, async () => emptyFeed)
      Expect(f.snapshots).toHaveLength(snapshots)
      // The explicit live adapter call above renders once; the cancelled response must not render.
      Expect(f.canvasRenders).toBe(renders + 1)
      if (ending === 'abort') {
        f.startup.resolve()
        Expect((await outcome)?.name).toBe('AbortError')
      }
      controller.abort()
      Expect(f.disposed.slice().sort()).toEqual([
        'beta-ship',
        'device',
        'dialogs',
        'drawer',
        'previews',
        'search',
        'session',
        'view',
      ])
    } finally {
      controller.abort()
      f.startup.resolve()
      f.browse.resolve(emptyFeed)
      for (const undo of restore.reverse()) {
        undo()
      }
    }
  })
}

Test('a completed Studio mount releases the same owners once on repeated teardown', async () => {
  current = fixture()
  const f = current
  const restore = globalSlots.map(({ key, slot }) =>
    slot.install({
      configurable: true,
      value: key === 'window' ? f.window : f.document,
    })
  )
  const controller = new AbortController()
  try {
    const { mountStudio } = await import('../studio-src/client/StudioApp')
    const mounted = mountStudio({ root: f.root as unknown as HTMLElement, signal: controller.signal })
    await f.started.promise
    f.startup.resolve()
    const dispose = await mounted
    dispose()
    dispose()
    controller.abort()
    f.document.dispatchEvent(Object.assign(new Event('dragstart'), {
      dataTransfer: { types: ['application/x-tao-studio-feed'] },
    }))
    Expect(f.preview.dataset['feedDragging']).toBeUndefined()
    Expect(f.disposed.slice().sort()).toEqual([
      'actions',
      'beta-ship',
      'browser',
      'device',
      'dialogs',
      'drawer',
      'events',
      'focus',
      'previews',
      'search',
      'session',
      'view',
      'viewport',
    ])
  } finally {
    controller.abort()
    f.startup.resolve()
    f.browse.resolve(emptyFeed)
    for (const undo of restore.reverse()) {
      undo()
    }
  }
})

Test('cancelling queued Feed work prevents its request from starting after the previous edit completes', async () => {
  current = fixture()
  const f = current
  const { StudioMatrixSketches } = await import('../studio-src/client/matrix/StudioMatrixSketches')
  const preview = f.preview as unknown as HTMLElement
  StudioMatrixSketches.render(preview, '/reader', emptyFeed.catalog)
  const first = Deferred<StudioFeedBrowseResult>()
  const started = Deferred<void>()
  const preceding = StudioMatrixSketches.runFeed(preview, () => {
    started.resolve()
    return first.promise
  })
  await started.promise
  const controller = new AbortController()
  let requests = 0
  const queued = StudioMatrixSketches.runFeed(preview, async () => {
    requests++
    return emptyFeed
  }, controller.signal).then(() => undefined, error => error as Error)
  controller.abort()
  first.resolve(emptyFeed)
  await preceding
  Expect((await queued)?.name).toBe('AbortError')
  Expect(requests).toBe(0)
})
