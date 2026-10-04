import { EditorState, type Transaction } from '@codemirror/state'
import { type Command, type EditorView, keymap } from '@codemirror/view'
import { Errors } from '@shared'
import { Deferred, Expect, Test, testOverrideSlot, until } from '@shared/test'
import type { StudioRenderInspection } from '@source-actions'
import { mountStudioCanvasFocus, StudioCanvasFocusLane } from '../studio-src/client/app/StudioCanvasFocus'
import { studioInspectionRequest } from '../studio-src/client/app/StudioInspection'
import {
  mountStudioBrowserLaunch,
  mountStudioPreviewReload,
  StudioPreviewNotice,
} from '../studio-src/client/app/StudioPreviewStatus'
import {
  forwardPreviewCanvasGesture,
  studioPreviewMessageListener,
} from '../studio-src/client/app/StudioPreviewWiring'
import { StudioSourceMutations } from '../studio-src/client/app/StudioSourceMutations'
import {
  canvasIframeGestureAnchor,
  canvasRevealDelta,
  nextStop,
} from '../studio-src/client/matrix/StudioCanvasViewport'
import { watchCellPreviewLoad } from '../studio-src/client/matrix/StudioPreviewMatrix'
import {
  StudioApiClient,
  StudioApiError,
  type StudioApiEventHandlers,
  StudioApiEventStream,
  StudioApiRoutes,
  type StudioHandshake,
} from '../studio-src/client/StudioApiClient'
import {
  parseScenarioPanelCommand,
  StudioDataFillCoordinator,
  StudioDraftStatus,
  StudioProjectContext,
} from '../studio-src/client/StudioApp'
import { StudioDialog } from '../studio-src/client/StudioDialog'
import {
  isStudioSaveShortcut,
  studioCellLabel,
  StudioCodeEditor,
  StudioDefinitionNavigation,
  StudioDiagnosticNavigation,
  StudioEditorInsertion,
  studioHostDocumentUpdate,
  StudioOpenFileLifecycle,
} from '../studio-src/client/StudioEditor'
import { StudioEditorTabs } from '../studio-src/client/StudioEditorTabs'
import {
  StudioFileTreeController,
  StudioFileTreeModel,
  StudioFileTreeTransitions,
} from '../studio-src/client/StudioFileTree'
import {
  awaitPreviewJourneyRecordingAcknowledgement,
  configureInteractionMode,
  currentSourceIdentity,
  disconnectPreviews,
  handlePreviewMessage,
  postCanvasGestureOwnership,
  postEditorSelection,
  previewBundleNoticeFor,
  previewMatrixPlan,
  previewNoticeFor,
  runtimeCaptureWithEnvironment,
  StudioActivePreview,
  StudioFixtureGenerationFeedback,
  StudioFixtureProposal,
  StudioJourneyRecorder,
  StudioMatrixLayout,
  studioPreviewCaptureError,
  type StudioPreviewConnection,
  StudioPreviewFrameUrl,
  StudioPreviewPublication,
  StudioPreviewSourceSync,
  StudioPreviewSuspension,
  studioReplayConfiguration,
  StudioRetainedPreview,
  StudioReviewDom,
  StudioRuntimeData,
} from '../studio-src/client/StudioMatrixView'
import { protectSketchToolbarPress } from '../studio-src/client/StudioSketchView'

import {
  StudioCommandPalette,
  StudioPanelBounds,
  StudioPanelModels,
} from '../studio-src/client/StudioProductPanels'
import { StudioRailPanels } from '../studio-src/client/StudioRailPanels'
import { StudioScenarioControls } from '../studio-src/client/StudioScenarioControls'
import {
  studioDesignPreviewSize,
  studioDraggedPaneSize,
  StudioGlobalLoading,
  studioLayoutOwnsCanvasGestures,
  StudioPaneSizes,
  studioPaneVisibility,
  studioSearchBlurIntent,
  studioShellMarkup,
  studioShellRailPanels,
  StudioWorkbenchState,
} from '../studio-src/client/StudioShell'
import type { StudioDeviceStatus } from '../studio-src/device/StudioDeviceStatus'
import { StudioClientAssets } from '../studio-src/StudioClientAssets'
import {
  StudioDraftSync,
  type StudioDraftSyncRequest,
  type StudioDraftSyncResult,
} from '../studio-src/StudioDraftSync'
import { StudioInspector } from '../studio-src/StudioInspector'
import { StudioPanelPayloads } from '../studio-src/StudioPanelPayloads'
import type { StudioPreviewManifestV2 } from '../studio-src/StudioPreviewManifest'
import {
  publishStudioProductHostState,
  registerStudioProductHostActions,
  rejectPendingStudioProductHostActions,
  requestStudioProductHostApplyActiveCellEnvironment,
  requestStudioProductHostChangeActiveFile,
  requestStudioProductHostCreateFile,
  requestStudioProductHostMoveGeneratedSource,
  requestStudioProductHostOpenFile,
  requestStudioProductHostOpenSource,
  requestStudioProductHostPanelAction,
  requestStudioProductHostSelectActiveFile,
  studioProductHostState,
  subscribeStudioProductHostState,
  validStudioProductHostPath,
} from '../studio-src/StudioProductHostProtocol'
import {
  studioProtocolChannel,
  studioProtocolVersion,
  studioSourceActionVersion,
} from '../studio-src/StudioProtocol'
import { StudioTestOutput } from '../studio-src/StudioTestRunner'
import { cellEnvironment } from './test-studio-fixtures'

const timeoutSlot = testOverrideSlot({
  read: () => globalThis.setTimeout,
  write: value => {
    globalThis.setTimeout = value
  },
})
const clearTimeoutSlot = testOverrideSlot({
  read: () => globalThis.clearTimeout,
  write: value => {
    globalThis.clearTimeout = value
  },
})

/** Deliver scheduled callbacks explicitly; these checks never depend on an elapsed wall-clock window. */
function withControlledTimeouts(run: (timers: { fire(): void; delays(): number[] }) => void): void {
  const pending = new Map<ReturnType<typeof setTimeout>, { callback: () => void; delay: number }>()
  let issued = 0
  const restoreTimeout = timeoutSlot.install(
    ((callback: () => void, delay = 0) => {
      const id = ++issued as unknown as ReturnType<typeof setTimeout>
      pending.set(id, { callback, delay })
      return id
    }) as unknown as typeof setTimeout,
  )
  const restoreClear = clearTimeoutSlot.install(
    (id => pending.delete(id as ReturnType<typeof setTimeout>)) as typeof clearTimeout,
  )
  try {
    run({
      delays: () => [...pending.values()].map(timer => timer.delay),
      fire() {
        const next = pending.entries().next().value
        if (next === undefined) {
          Errors.throwUnexpected('The Tao operation did not schedule a timeout.')
        }
        pending.delete(next[0])
        next[1].callback()
      },
    })
  } finally {
    restoreClear()
    restoreTimeout()
  }
}

Test('Studio rebuilds preview capture failures with their original Tao error category', () => {
  Expect(studioPreviewCaptureError('UserInputError', 'bad data')).toBeInstanceOf(Errors.UserInputError)
  Expect(studioPreviewCaptureError('HostEnvironmentError', 'offline')).toBeInstanceOf(Errors.HostEnvironmentError)
  Expect(studioPreviewCaptureError('UnexpectedBehaviorError', 'broken invariant'))
    .toBeInstanceOf(Errors.UnexpectedBehaviorError)
})

Test('Studio browser assets bundle the client and escape injected config', async () => {
  const bundle = await StudioClientAssets.bundle({ validationMode: 'release' })
  const html = StudioClientAssets.html({
    previewUrl: 'http://127.0.0.1:55102/?value=</script><script>bad()</script>',
  })

  Expect(bundle).toContain('Tao Studio root is missing')
  Expect(bundle).not.toContain('createHighlighterCore')
  Expect(bundle).not.toContain('sourceMappingURL=data:')
  Expect(html).toContain('<div id="tao-studio-viewport"></div>')
  Expect(html).toContain('rel="icon" href="data:image/svg+xml,')
  Expect(html).toContain('<script type="module" src="/studio.js"></script>')
  Expect(html).not.toContain('</script><script>bad()</script>')
  Expect(html).toContain('\\u003c/script>')
})

Test('Studio client bundle cache surfaces a failed Tao compilation and retries the next request', async () => {
  const cache = new Map<'development' | 'release', Promise<string>>()
  let builds = 0
  const build = async () => {
    builds += 1
    if (builds === 1) {
      Errors.throwHostEnvironment('Could not compile the Tao Studio browser client.')
    }
    return 'Tao client'
  }

  await Expect(StudioClientAssets.testing.cachedBundle(cache, 'development', build)).rejects.toThrow(
    'Could not compile the Tao Studio browser client.',
  )
  Expect(await StudioClientAssets.testing.cachedBundle(cache, 'development', build)).toBe('Tao client')
  Expect(await StudioClientAssets.testing.cachedBundle(cache, 'development', build)).toBe('Tao client')
  Expect(builds).toBe(2)
})

Test('Studio events dispatch typed handshakes so startup scenario manifests are not missed', () => {
  const handshake = {
    type: 'handshake',
  } as StudioHandshake
  let received: StudioHandshake | undefined

  StudioApiEventStream.dispatch(handshake, {
    onCompile() {},
    onDisconnect() {},
    onFile() {},
    onHandshake(value) {
      received = value
    },
    onManifest() {},
  })

  Expect(received).toBe(handshake)
})

Test('Studio events dispatch device-state snapshots to an optional handler', () => {
  const status = {
    gateway: { hosts: ['192.168.4.20'], port: 8765, studioFingerprint: 'AB12' },
    pairing: { open: false },
    sessionId: 'session-1',
    trusted: [],
  } satisfies StudioDeviceStatus
  const received: StudioDeviceStatus[] = []
  const handlers = {
    onCompile() {},
    onDisconnect() {},
    onFile() {},
    onManifest() {},
  }

  StudioApiEventStream.dispatch({ channel: 'tao-studio', protocolVersion: 1, status, type: 'device-state' }, handlers)
  StudioApiEventStream.dispatch({ channel: 'tao-studio', protocolVersion: 1, status, type: 'device-state' }, {
    ...handlers,
    onDeviceState: value => received.push(value),
  })

  Expect(received).toEqual([status])
})

Test('Studio events dispatch checkpoint, data-invalidation, cell, and write-receipt notices', () => {
  const received: string[] = []
  const handlers: StudioApiEventHandlers = {
    onCellReconfigured: cellId => received.push(`cell:${cellId}`),
    onCheckpoint: checkpoint => received.push(`checkpoint:${checkpoint.id}:${checkpoint.status}`),
    onCompile() {},
    onDataInvalidated: invalidation =>
      received.push(`data:${invalidation.entities.join(',')}:${invalidation.revision}`),
    onDisconnect() {},
    onFile() {},
    onManifest() {},
    onWritesAcknowledged: acknowledgements =>
      received.push(`writes:${acknowledgements.map(acknowledgement => acknowledgement.writeId).join(',')}`),
  }
  const envelope = { channel: studioProtocolChannel, protocolVersion: studioProtocolVersion } as const

  StudioApiEventStream.dispatch(
    { ...envelope, checkpoint: { id: 'checkpoint-1', status: 'committed' }, type: 'checkpoint-changed' },
    handlers,
  )
  StudioApiEventStream.dispatch({ entities: ['Files', 'Problems'], revision: 3, type: 'data-invalidated' }, handlers)
  StudioApiEventStream.dispatch({ ...envelope, cellId: 'cell-1', type: 'cell-reconfigured' }, handlers)
  StudioApiEventStream.dispatch({
    ...envelope,
    acknowledgements: [{ compileRevision: 2, path: 'Garden.tao', writeId: 'write-1' }],
    type: 'studio-writes-acknowledged',
  }, handlers)

  Expect(received).toEqual([
    'checkpoint:checkpoint-1:committed',
    'data:Files,Problems:3',
    'cell:cell-1',
    'writes:write-1',
  ])
})

Test('Studio Browser launch coalesces clicks, reports failures, and retries', async () => {
  const button = Object.assign(new EventTarget(), { disabled: false, title: '' }) as HTMLButtonElement
  const status = { textContent: '' } as HTMLElement
  const pending = Deferred<void>()
  let calls = 0
  let failure: unknown
  const dispose = mountStudioBrowserLaunch({
    available: true,
    button,
    onError: error => {
      failure = error
    },
    open: async () => {
      calls += 1
      if (calls === 1) {
        await pending.promise
        Errors.throwHostEnvironment('Browser could not open')
      }
    },
    status,
  })
  button.dispatchEvent(new Event('click'))
  button.dispatchEvent(new Event('click'))
  Expect(calls).toBe(1)
  Expect(button.disabled).toBe(true)
  pending.resolve()
  await until(() => !button.disabled)
  Expect((failure as Error).message).toBe('Browser could not open')
  button.dispatchEvent(new Event('click'))
  await until(() => !button.disabled)
  Expect(calls).toBe(2)
  Expect(status.textContent).toBe('Opened app in browser')
  dispose()
  button.dispatchEvent(new Event('click'))
  Expect(calls).toBe(2)
})

Test('Studio Browser launch disables absent previews and ignores completion after disposal', async () => {
  const button = Object.assign(new EventTarget(), { disabled: false, title: '' }) as HTMLButtonElement
  const status = { textContent: '' } as HTMLElement
  const pending = Deferred<void>()
  let calls = 0
  const options = {
    button,
    onError: () => {
      Errors.throwUnexpected('Disposed launch reported an error')
    },
    open: async () => {
      calls += 1
      await pending.promise
    },
    status,
  }
  const unavailable = mountStudioBrowserLaunch({ ...options, available: false })
  Expect(button.disabled).toBe(true)
  button.dispatchEvent(new Event('click'))
  Expect(calls).toBe(0)
  unavailable()
  const dispose = mountStudioBrowserLaunch({ ...options, available: true })
  button.dispatchEvent(new Event('click'))
  Expect(calls).toBe(1)
  dispose()
  pending.resolve()
  await pending.promise
  await Promise.resolve()
  Expect(status.textContent).toBe('Opening app in browser…')
})

Test(
  'Studio API client addresses browser launch and every loopback device route with the contract bodies',
  async () => {
    const previousFetch = globalThis.fetch
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const requests: Array<{ body: unknown; method: string; url: string }> = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { pathname: '/sessions/window-7' } },
      writable: true,
    })
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      requests.push({
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
        method: init?.method ?? 'GET',
        url,
      })
      if (url.endsWith('/api/device/launch')) {
        return new Response(JSON.stringify({ error: 'Device launch tooling is not injected.' }), { status: 501 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch
    try {
      await StudioApiClient.browserOpen()
      await StudioApiClient.deviceStatus()
      await StudioApiClient.deviceOpenPairing()
      await StudioApiClient.deviceConfirmPairing('key-1')
      await StudioApiClient.deviceDeclinePairing('key-2')
      await StudioApiClient.deviceRevoke('key-3')
      await StudioApiClient.deviceReconnect()
      await StudioApiClient.deviceSelectCell('cell-home')
      await StudioApiClient.deviceLaunchOpen('host-1', 'cable')
      let launchFailure: unknown
      try {
        await StudioApiClient.deviceLaunch()
      } catch (error) {
        launchFailure = error
      }
      Expect(launchFailure).toBeInstanceOf(StudioApiError)
      Expect((launchFailure as StudioApiError).status).toBe(501)
      Expect((launchFailure as StudioApiError).message).toBe('Device launch tooling is not injected.')
      Expect(requests).toEqual([
        { body: {}, method: 'POST', url: '/sessions/window-7/api/browser/open' },
        { body: undefined, method: 'GET', url: '/sessions/window-7/api/device/status' },
        { body: {}, method: 'POST', url: '/sessions/window-7/api/device/pairing/open' },
        { body: { devicePublicKey: 'key-1' }, method: 'POST', url: '/sessions/window-7/api/device/pairing/confirm' },
        { body: { devicePublicKey: 'key-2' }, method: 'POST', url: '/sessions/window-7/api/device/pairing/decline' },
        { body: { devicePublicKey: 'key-3' }, method: 'POST', url: '/sessions/window-7/api/device/revoke' },
        { body: {}, method: 'POST', url: '/sessions/window-7/api/device/reconnect' },
        { body: { cellId: 'cell-home' }, method: 'POST', url: '/sessions/window-7/api/device/select-cell' },
        {
          body: { hostId: 'host-1', route: 'cable' },
          method: 'POST',
          url: '/sessions/window-7/api/device/launch/open',
        },
        { body: undefined, method: 'GET', url: '/sessions/window-7/api/device/launch' },
      ])
    } finally {
      globalThis.fetch = previousFetch
      if (previousWindow === undefined) {
        delete (globalThis as { window?: unknown }).window
      } else {
        Object.defineProperty(globalThis, 'window', previousWindow)
      }
    }
  },
)

Test('Studio generated fixture proposals use the captured-fixture source-action flow', () => {
  const identity = {
    appName: 'WordFlower',
    cellId: 'Workspace.focused#cell',
    cellRevision: 0,
    compileRevision: 1,
    manifestRevision: 'compile:1',
    path: 'Scenarios.tao',
    previewInstanceId: 'preview-1',
    project: '/project',
    sourceVersion: 'text-v1:scenarios',
  }
  const plan = {
    accounts: [],
    creates: [{ entity: 'Workspace', fields: { CreatedAt: { kind: 'now' as const }, Title: 'Roadmap' }, name: 'Main' }],
  }

  Expect(StudioFixtureProposal.source('GeneratedState', plan)).toContain(
    'fixture GeneratedState {\n   Main = create Workspace { CreatedAt: now, Title: "Roadmap" }\n}',
  )
  Expect(StudioFixtureProposal.sourceAction({
    fixtureName: 'GeneratedState',
    identity,
    origin: 'generated',
    plan,
    requestId: 'generation-1',
  })).toMatchObject({
    action: { fixtureName: 'GeneratedState', kind: 'insert-captured-fixture', plan },
    checkpoint: { id: 'generated-fixture:generation-1', phase: 'single' },
    identity,
    requestId: 'generation-1',
    type: 'source-action',
  })
})

Test('Studio generated fixture failures include actionable validation issues', () => {
  Expect(StudioFixtureGenerationFeedback.failure({
    error: 'The generated draft failed validation.',
    issues: ['Title is required.', 'Count must be positive.'],
  })).toBe('The generated draft failed validation. Title is required. Count must be positive.')
})

Test('Studio browser assets bundle one CodeMirror view singleton', async () => {
  const inputs = await StudioClientAssets.testing.moduleInputs('release')
  const viewModules = inputs.filter(path =>
    path.includes('@codemirror+view@') && path.endsWith('/@codemirror/view/dist/index.js')
  )

  Expect(viewModules).toHaveLength(1)
  Expect(inputs.some(path => path.includes('/react@19.2.3/'))).toBe(true)
  Expect(inputs.some(path => path.includes('/react@19.2.8/'))).toBe(false)
  Expect(inputs.some(path => path.endsWith('/studio-src/TaoStudioBrowser.tsx'))).toBe(true)
  Expect(inputs.some(path => path.endsWith('/_gen_tao-app/App.tsx'))).toBe(true)
  Expect(inputs.some(path => path.endsWith('/TaoStudioProductHost.files/TaoStudioProductHost.tsx'))).toBe(true)
  Expect(inputs.some(path => path.endsWith('/TaoStudioProductHost.files/client/StudioApp.ts'))).toBe(true)
  Expect(inputs.some(path => path.endsWith('/TaoStudioProductHost.files/client/StudioFileTree.ts'))).toBe(true)
})

Test('Studio ProductHost queues early Tao actions, rejects unsafe paths, and preserves Conflict failures', async () => {
  const calls: string[] = []
  let stateUpdates = 0
  const unsubscribeState = subscribeStudioProductHostState(() => stateUpdates += 1)
  const earlyOpen = requestStudioProductHostOpenFile('Queued.tao')
  const unregister = registerStudioProductHostActions({
    async applyInspectorAction(action, proposed) {
      calls.push(`inspector:${action.kind}:${proposed}`)
    },
    async applyActiveCellEnvironment(identity) {
      calls.push(`environment:${identity.cellId}:${identity.cellRevision}`)
      if (identity.cellId === 'stale') {
        throw new StudioApiError('stale preview', 409, { code: 'stale-cell' })
      }
    },
    changeActiveFile(content, selection) {
      calls.push(
        selection === undefined
          ? `change:${content}`
          : `change:${content}:${selection.anchor}:${selection.head}`,
      )
    },
    async createFile(path) {
      calls.push(`create:${path}`)
      throw new StudioApiError('server conflict', 409, { code: 'stale-source', path })
    },
    async deleteFile(path, sourceVersion) {
      calls.push(`delete:${path}:${sourceVersion}`)
    },
    insertComponent(component) {
      calls.push(`component:${component}`)
    },
    insertProjectView(viewName) {
      calls.push(`view:${viewName}`)
    },
    async moveGeneratedSource(path, sourceVersion, targetPackage) {
      calls.push(`move:${path}:${sourceVersion}:${targetPackage}`)
    },
    async openFile(path) {
      calls.push(`open:${path}`)
    },
    async openScreen(subjectId) {
      calls.push(`screen:${subjectId}`)
    },
    async openSource(path, sourceVersion, start) {
      calls.push(`source:${path}:${sourceVersion}:${start}`)
    },
    async productPanelAction(name, payload) {
      calls.push(`panel:${name}:${payload}`)
    },
    async renameFile(path, sourceVersion, targetPath) {
      calls.push(`rename:${path}:${sourceVersion}:${targetPath}`)
    },
    selectActiveFile(anchor, head) {
      calls.push(`select:${anchor}:${head}`)
    },
    async undoInspectorAction() {
      calls.push('inspector:undo')
    },
  })
  try {
    await earlyOpen
    await requestStudioProductHostMoveGeneratedSource('@/studio/View1.tao', 'version:1', '@views')
    await Expect(requestStudioProductHostCreateFile('Conflict.tao')).rejects.toMatchObject({
      caseName: 'Conflict',
      details: { code: 'stale-source', path: 'Conflict.tao' },
      message: 'This file changed under this edit.',
    })
    Expect(calls).toEqual([
      'open:Queued.tao',
      'move:@/studio/View1.tao:version:1:@views',
      'create:Conflict.tao',
    ])
    Expect(validStudioProductHostPath('Folder/File.tao')).toBe(true)
    Expect(validStudioProductHostPath('Folder\\File.tao')).toBe(false)
    await Expect(requestStudioProductHostOpenFile('../Outside.tao')).rejects.toThrow('project-relative Tao')
    await requestStudioProductHostPanelAction('run-tests', 'null')
    await requestStudioProductHostOpenSource('/project/Garden.tao', 'version:1', 14)
    await Expect(requestStudioProductHostPanelAction('', 'null')).rejects.toThrow('panel')
    await Expect(requestStudioProductHostPanelAction('run-tests', 'x'.repeat(1_000_001))).rejects.toThrow(
      'at most one megabyte',
    )
    await requestStudioProductHostApplyActiveCellEnvironment(
      { cellId: 'cell:1', cellRevision: 7 },
      {
        network: { latencyMs: 0, outcome: 'normal' },
        viewport: { height: 844, presetId: 'phone', width: 390 },
      },
    )
    await Expect(requestStudioProductHostApplyActiveCellEnvironment(
      { cellId: '', cellRevision: 7 },
      {
        network: { latencyMs: 0, outcome: 'normal' },
        viewport: { height: 844, presetId: 'phone', width: 390 },
      },
    )).rejects.toThrow('current cell identity and revision')
    await Expect(requestStudioProductHostApplyActiveCellEnvironment(
      { cellId: 'stale', cellRevision: 6 },
      {
        network: { latencyMs: 0, outcome: 'normal' },
        viewport: { height: 844, presetId: 'phone', width: 390 },
      },
    )).rejects.toMatchObject({
      caseName: 'Conflict',
      details: { code: 'stale-cell' },
      message: 'This preview changed while its environment was being edited.',
    })
    const previousRevision = studioProductHostState().revision
    const state = publishStudioProductHostState({
      activeFile: {
        content: 'view Main() { }',
        path: 'Main.tao',
        revealRevision: 2,
        saved: true,
        selectionAnchor: 4,
        selectionHead: 8,
        sourceVersion: 'version:1',
      },
      projectRoot: '/project',
    })
    Expect(state.revision).toBe(previousRevision + 1)
    Expect(Object.isFrozen(state)).toBe(true)
    Expect(Object.isFrozen(state.activeFile)).toBe(true)
    Expect(stateUpdates).toBe(1)
    requestStudioProductHostChangeActiveFile('changed', { anchor: 3, head: 3 })
    requestStudioProductHostSelectActiveFile(2, 5)
    Expect(calls.slice(-4)).toEqual([
      'environment:cell:1:7',
      'environment:stale:6',
      'change:changed:3:3',
      'select:2:5',
    ])
    Expect(calls).toContain('source:/project/Garden.tao:version:1:14')
  } finally {
    unsubscribeState()
    unregister()
  }
  const abandoned = requestStudioProductHostOpenFile('Abandoned.tao')
  const cancellation = new Error('host unmounted')
  cancellation.name = 'AbortError'
  rejectPendingStudioProductHostActions(cancellation)
  await Expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })
})

Test('Studio Tao scenario actions require exact typed cell-bound payloads', () => {
  Expect(parseScenarioPanelCommand(
    'scenario-save-arguments',
    JSON.stringify({
      appearance: 'dark',
      arguments: { Count: 3 },
      cellId: 'cell:states:default',
      cellRevision: 8,
    }),
  )).toEqual({
    appearance: 'dark',
    arguments: { Count: 3 },
    cellId: 'cell:states:default',
    cellRevision: 8,
    kind: 'scenario-save-arguments',
  })
  Expect(parseScenarioPanelCommand(
    'scenario-start-journey',
    JSON.stringify({
      captureSensitiveText: false,
      cellId: 'cell:states:default',
      cellRevision: 8,
    }),
  )).toEqual({
    captureSensitiveText: false,
    cellId: 'cell:states:default',
    cellRevision: 8,
    kind: 'scenario-start-journey',
  })
  Expect(parseScenarioPanelCommand(
    'scenario-save-journey',
    JSON.stringify({ cellId: 'cell:states:default', cellRevision: 8 }),
  )).toEqual({
    cellId: 'cell:states:default',
    cellRevision: 8,
    kind: 'scenario-save-journey',
  })
  Expect(parseScenarioPanelCommand(
    'scenario-replay-failure',
    JSON.stringify({
      cellId: 'cell:states:default',
      cellRevision: 8,
    }),
  )).toEqual({
    cellId: 'cell:states:default',
    cellRevision: 8,
    kind: 'scenario-replay-failure',
  })
  Expect(() => parseScenarioPanelCommand('scenario-save-arguments', '{}')).toThrow(
    'active cell identity and revision',
  )
  Expect(() => parseScenarioPanelCommand('scenario-save-arguments', '{')).toThrow('valid object payload')
  Expect(() =>
    parseScenarioPanelCommand(
      'scenario-save-arguments',
      JSON.stringify({
        appearance: 'system',
        arguments: { Count: 3 },
        cellId: 'cell:states:default',
        cellRevision: 8,
      }),
    )
  ).toThrow('resolved light or dark appearance')
  Expect(() =>
    parseScenarioPanelCommand(
      'scenario-save-arguments',
      JSON.stringify({ arguments: [], cellId: 'cell:states:default', cellRevision: 8 }),
    )
  ).toThrow('arguments require a JSON object')
  Expect(() =>
    parseScenarioPanelCommand(
      'scenario-start-journey',
      JSON.stringify({ cellId: 'cell:states:default', cellRevision: 8 }),
    )
  ).toThrow('sensitive-text choice')
  Expect(() =>
    parseScenarioPanelCommand(
      'scenario-unknown',
      JSON.stringify({
        cellId: 'cell:states:default',
        cellRevision: 8,
      }),
    )
  ).toThrow('Unsupported Tao Studio scenario action')
})

Test('Studio validates every serialized ProductHost panel payload before navigation or mutation', () => {
  Expect(StudioPanelPayloads.compileDiagnostic(JSON.stringify({
    filePath: 'Garden.tao',
    message: 'Broken',
    range: { end: { character: 5, line: 2 }, start: { character: 1, line: 2 } },
  }))).toMatchObject({ message: 'Broken' })
  Expect(StudioPanelPayloads.testFailure(JSON.stringify({
    filePath: 'Garden.test.tao',
    line: 4,
    message: 'Expected text',
    name: 'journey',
  }))).toMatchObject({ line: 4, name: 'journey' })
  Expect(StudioPanelPayloads.searchResult(JSON.stringify({
    detail: 'Text("Match")',
    kind: 'text',
    label: 'Garden.tao:3',
    path: 'Garden.tao',
    start: 12,
  }))).toMatchObject({ kind: 'text', start: 12 })
  Expect(StudioPanelPayloads.sourceAction(JSON.stringify({ kind: 'set-layout-entry' }))).toEqual({
    kind: 'set-layout-entry',
  })

  for (
    const parse of [
      StudioPanelPayloads.compileDiagnostic,
      StudioPanelPayloads.searchResult,
      StudioPanelPayloads.sourceAction,
      StudioPanelPayloads.testFailure,
    ]
  ) {
    Expect(() => parse('{')).toThrow('valid structured payload')
  }
  Expect(() => StudioPanelPayloads.compileDiagnostic(JSON.stringify({ message: 42 }))).toThrow(
    'valid structured payload',
  )
  Expect(() =>
    StudioPanelPayloads.testFailure(JSON.stringify({
      filePath: 'Garden.test.tao',
      line: -1,
      message: 'Broken',
      name: 'journey',
    }))
  ).toThrow('valid structured payload')
})

Test('an app without scenarios keeps its whole-app preview instead of an empty matrix', () => {
  Expect(previewMatrixPlan(3, false)).toBe('cells')
  Expect(previewMatrixPlan(0, true)).toBe('keep-whole-app')
  Expect(previewMatrixPlan(0, false)).toBe('create-whole-app')
})

Test('a failed compile explains itself in the preview, naming the file and line', () => {
  Expect(previewNoticeFor({ diagnostics: [], message: 'Compiled preview revision 2.', status: 'compiled' }))
    .toBeUndefined()
  Expect(previewNoticeFor({
    diagnostics: [{
      filePath: '/workspace/Apps/Garden/@ui/Beds.tao',
      message: 'Unknown view Bed.',
      range: { start: { line: 41 } },
    }],
    message: 'Compile failed.',
    status: 'error',
  })).toEqual({
    detail: 'Beds.tao:42 — Unknown view Bed.',
    heading: 'This preview is out of date: the project did not compile.',
  })
  Expect(previewNoticeFor({ diagnostics: [], message: 'Metro exited.', status: 'error' })?.detail)
    .toBe('Metro exited.')
})

Test('an app that never bundled says so, instead of leaving an empty preview unexplained', () => {
  Expect(previewBundleNoticeFor(undefined)).toBeUndefined()
  Expect(previewBundleNoticeFor({ status: 'ok' })).toBeUndefined()
  // A server that cannot name a preview URL knows nothing, which is not the same as a failure.
  Expect(previewBundleNoticeFor({ status: 'unknown' })).toBeUndefined()
  Expect(previewBundleNoticeFor({ message: 'Unable to resolve module ./App', status: 'failed' })).toEqual({
    detail: 'Unable to resolve module ./App — reload the preview, or restart Studio.',
    heading: 'This preview is empty: the project compiled, but the app bundle failed to build.',
  })
  Expect(previewBundleNoticeFor({ message: 'connection refused', status: 'unreachable' })?.heading)
    .toBe('This preview is empty: its app server did not answer.')
})

/**
 * Reading the bundle rebuilds the preview's own Metro graph, and one that lands ahead of Metro's
 * hot-update handler ends a retained preview's hot updates for good, so a preview that is running the
 * compile it was handed is never probed.
 */
Test(
  'asks the bundler about a preview only when it has not applied its compile',
  () =>
    withControlledTimeouts(timers => {
      const previousFetch = globalThis.fetch
      const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { location: { pathname: '/sessions/probe-1' } },
        writable: true,
      })
      const requests: string[] = []
      globalThis.fetch = (async (input: string | URL | Request) => {
        requests.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
        return Response.json({ status: 'ok' })
      }) as typeof fetch
      try {
        const preview = { appliedRevision: 2, expectedRevision: 2 } as StudioPreviewConnection
        const notice = new StudioPreviewNotice({
          compileState: () => ({
            appliedRevision: 2,
            compileRevision: 2,
            diagnostics: [],
            message: '',
            status: 'compiled',
          }),
          preview: { querySelector: () => null } as unknown as HTMLElement,
          previewUrl: 'http://127.0.0.1:1',
          previews: [preview],
          settleMs: 0,
          signal: undefined,
        })

        notice.checkBundle()
        timers.fire()
        Expect(requests).toEqual([])

        preview.expectedRevision = 3
        notice.checkBundle()
        timers.fire()
        Expect(requests).toHaveLength(1)
        Expect(requests[0]).toStartWith('/sessions/probe-1/')
      } finally {
        globalThis.fetch = previousFetch
        if (previousWindow === undefined) {
          Reflect.deleteProperty(globalThis, 'window')
        } else {
          Object.defineProperty(globalThis, 'window', previousWindow)
        }
      }
    }),
)

Test('Studio preview teardown releases observers and pending capture work', () => {
  let disconnected = 0
  let rejected = ''
  const preview = {
    iframe: { src: 'http://127.0.0.1:55102/' } as HTMLIFrameElement,
    interactionMode: 'edit',
    origin: 'http://127.0.0.1:55102',
    previewInstanceId: 'preview-1',
    journeyRecording: {
      captureSensitiveText: false,
      id: 'recording-1',
      sequence: 0,
      sourceIdentity: 'source-1',
      status: 'recording',
      steps: [],
    },
    runtimeCaptureRequest: {
      reject(error: Error) {
        rejected = error.message
      },
      requestId: 'capture-1',
      resolve() {},
      timeout: setTimeout(() => {}, 10_000),
    },
    visibilityObserver: {
      disconnect() {
        disconnected += 1
      },
    } as IntersectionObserver,
  } satisfies StudioPreviewConnection

  disconnectPreviews([preview], 'Studio host unmounted.')

  Expect(disconnected).toBe(1)
  Expect(rejected).toBe('Studio host unmounted.')
  Expect(preview.iframe.src).toBe('about:blank')
  Expect(preview.runtimeCaptureRequest).toBeUndefined()
  Expect(preview.visibilityObserver).toBeUndefined()
  Expect(preview.journeyRecording?.status).toBe('invalidated')
})

Test('Studio starts interactive, toggles editing, and retains the selected mode on iframe reload', () => {
  const iframe = new EventTarget() as HTMLIFrameElement
  const messages: unknown[] = []
  Object.defineProperty(iframe, 'contentWindow', {
    value: {
      postMessage(message: unknown) {
        messages.push(message)
      },
    },
  })
  const preview = { ...previewConnection('preview-journey', 'novel', iframe.contentWindow!), iframe }
  preview.journeyRecording = {
    captureSensitiveText: false,
    id: 'recording-1',
    sequence: 1,
    sourceIdentity: 'source-1',
    status: 'recording',
    steps: [{ kind: 'press', selector: 'tag', target: 'save' }],
  }
  const button = new EventTarget() as HTMLButtonElement
  Object.assign(button, { dataset: {}, textContent: '', title: '' })

  configureInteractionMode(
    button,
    [preview],
    { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake,
  )
  Expect(button.dataset['mode']).toBe('run')
  Expect(button.textContent).toBe('Mode: Run')
  Expect(preview.interactionMode).toBe('run')
  Expect(messages.at(-1)).toMatchObject({ mode: 'run', type: 'set-interaction-mode' })
  button.dispatchEvent(new Event('click'))
  Expect(preview.interactionMode).toBe('edit')
  Expect(button.textContent).toBe('Mode: Edit')
  iframe.dispatchEvent(new Event('load'))

  Expect(preview.journeyRecording.status).toBe('invalidated')
  Expect(messages.at(-1)).toMatchObject({ mode: 'edit', type: 'set-interaction-mode' })
  button.dispatchEvent(new Event('click'))
  Expect(preview.interactionMode).toBe('run')
})

Test('Studio advertises canvas gesture ownership explicitly per preview', () => {
  const messages: unknown[] = []
  const target = {
    postMessage(message: unknown) {
      messages.push(message)
    },
  }
  const preview = previewConnection('preview-design', 'design', target)
  const handshake = { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake

  postCanvasGestureOwnership(preview, handshake, true)
  postCanvasGestureOwnership(preview, handshake, false)

  Expect(messages).toMatchObject([{
    identity: {
      appName: 'Garden',
      cellId: 'design',
      previewInstanceId: 'preview-design',
      project: '/workspace',
    },
    owned: true,
    type: 'set-canvas-gestures',
  }, {
    owned: false,
    type: 'set-canvas-gestures',
  }])
})

Test(
  'Studio releases a toolbar render lock on blur, cancellation, timeout, unmount, and completed click',
  () =>
    withControlledTimeouts(timers => {
      const toolbar = new EventTarget() as HTMLElement
      const document = new EventTarget() as Document
      const view = new EventTarget()
      Object.defineProperty(document, 'defaultView', { value: view })
      const lifetime = new AbortController()
      let held = 0
      protectSketchToolbarPress(
        toolbar,
        document,
        {
          begin: () => {
            held += 1
          },
          end: () => {
            held -= 1
          },
        },
        lifetime.signal,
        10,
      )
      const pointer = (type: string) => Object.assign(new Event(type), { button: 0, isPrimary: true, pointerId: 1 })

      toolbar.dispatchEvent(pointer('pointerdown'))
      Expect(held).toBe(1)
      view.dispatchEvent(new Event('blur'))
      Expect(held).toBe(0)
      toolbar.dispatchEvent(pointer('pointerdown'))
      document.dispatchEvent(Object.assign(new Event('pointercancel'), { pointerId: 2 }))
      Expect(held).toBe(1)
      document.dispatchEvent(pointer('pointercancel'))
      Expect(held).toBe(0)
      toolbar.dispatchEvent(pointer('pointerdown'))
      document.dispatchEvent(pointer('pointerup'))
      Expect(held).toBe(1)
      timers.fire()
      Expect(held).toBe(0)
      toolbar.dispatchEvent(pointer('pointerdown'))
      lifetime.abort()
      Expect(held).toBe(0)
      const active = new AbortController()
      protectSketchToolbarPress(
        toolbar,
        document,
        {
          begin: () => {
            held += 1
          },
          end: () => {
            held -= 1
          },
        },
        active.signal,
        10,
      )
      toolbar.dispatchEvent(pointer('pointerdown'))
      Expect(held).toBe(1)
      timers.fire()
      Expect(held).toBe(0)
      active.abort()
    }),
)

Test(
  'Studio recovers a retained preview that misses publication and stops after an accepted acknowledgement',
  () =>
    withControlledTimeouts(timers => {
      const iframe = {} as HTMLIFrameElement
      let reloads = 0
      Object.defineProperty(iframe, 'src', {
        get: () => 'http://127.0.0.1:56102/',
        set: () => {
          reloads += 1
          StudioPreviewPublication.loaded(preview)
        },
      })
      const preview = { ...previewConnection('preview-stalled', 'novel', {}), iframe }
      const identity = { ...preview.cellIdentity!, compileRevision: 2, manifestRevision: 'manifest-2' }

      StudioPreviewPublication.expect(preview, identity, 10)
      timers.fire()
      Expect(reloads).toBe(1)
      StudioPreviewPublication.acknowledged(preview, identity, preview.previewInstanceId)
      Expect(timers.delays()).toEqual([])
      Expect(reloads).toBe(1)
      Expect(preview.pendingPublication).toBeUndefined()
    }),
)

Test(
  'Studio lets an intentional slow iframe navigation finish before retrying publication',
  () =>
    withControlledTimeouts(timers => {
      const iframe = {} as HTMLIFrameElement
      let reloads = 0
      Object.defineProperty(iframe, 'src', {
        get: () => 'http://127.0.0.1:56102/',
        set: () => {
          reloads += 1
        },
      })
      const preview = { ...previewConnection('preview-navigating', 'novel', {}), iframe }
      const identity = { ...preview.cellIdentity!, compileRevision: 2, manifestRevision: 'manifest-2' }
      StudioPreviewPublication.navigating(preview, 40)
      StudioPreviewPublication.expect(preview, identity, 10)
      Expect(timers.delays()).toEqual([40])
      Expect(reloads).toBe(0)
      StudioPreviewPublication.loaded(preview)
      Expect(timers.delays()).toEqual([10])
      timers.fire()
      Expect(reloads).toBe(1)
      StudioPreviewPublication.acknowledged(preview, identity, preview.previewInstanceId)
      Expect(preview.pendingPublication).toBeUndefined()
    }),
)

Test('Studio initial cell load restores the normal publication retry budget', () =>
  withControlledTimeouts(timers => {
    const iframe = new EventTarget() as HTMLIFrameElement
    Object.defineProperty(iframe, 'contentWindow', { value: null })
    const preview = { ...previewConnection('preview-initial-load', 'novel', {}), iframe, navigationPending: true }
    const identity = { ...preview.cellIdentity!, compileRevision: 2, manifestRevision: 'manifest-2' }
    watchCellPreviewLoad(preview, {} as StudioHandshake)
    StudioPreviewPublication.expect(preview, identity, 10)
    Expect(timers.delays()).toEqual([30_000])
    iframe.dispatchEvent(new Event('load'))
    Expect(preview.navigationPending).toBe(false)
    Expect(timers.delays()).toEqual([10])
    StudioPreviewPublication.cancel(preview)
  }))

Test(
  'Studio ignores stale acknowledgements and bounds preview publication recovery',
  () =>
    withControlledTimeouts(timers => {
      const iframe = {} as HTMLIFrameElement
      let reloads = 0
      Object.defineProperty(iframe, 'src', {
        get: () => 'http://127.0.0.1:56102/',
        set: () => {
          reloads += 1
          StudioPreviewPublication.loaded(preview)
        },
      })
      const frame = { dataset: {} } as HTMLElement
      const preview = { ...previewConnection('preview-stale', 'novel', {}), iframe, frame }
      const identity = { ...preview.cellIdentity!, compileRevision: 2, manifestRevision: 'manifest-2' }
      StudioPreviewPublication.expect(preview, identity, 10)
      StudioPreviewPublication.acknowledged(preview, preview.cellIdentity!, preview.previewInstanceId)
      timers.fire()
      timers.fire()
      timers.fire()

      Expect(reloads).toBe(2)
      Expect(frame.dataset['taoReviewStatus']).toBe('failed')
      Expect(preview.pendingPublication).toBeUndefined()
    }),
)

Test(
  'Studio pauses publication recovery while a preview is suspended and supersedes old revisions',
  () =>
    withControlledTimeouts(timers => {
      const iframe = {} as HTMLIFrameElement
      let reloads = 0
      Object.defineProperty(iframe, 'src', {
        get: () => 'http://127.0.0.1:56102/',
        set: () => {
          reloads += 1
          StudioPreviewPublication.loaded(preview)
        },
      })
      const preview = { ...previewConnection('preview-suspended', 'novel', {}), iframe }
      const older = { ...preview.cellIdentity!, compileRevision: 2, manifestRevision: 'manifest-2' }
      const newer = { ...older, compileRevision: 3, manifestRevision: 'manifest-3' }
      StudioPreviewPublication.expect(preview, older, 10)
      StudioPreviewPublication.pause(preview)
      preview.suspended = true
      Expect(timers.delays()).toEqual([])
      Expect(reloads).toBe(0)
      StudioPreviewPublication.expect(preview, newer, 10)
      StudioPreviewPublication.acknowledged(preview, older, preview.previewInstanceId)
      preview.suspended = false
      StudioPreviewPublication.resume(preview)
      timers.fire()
      Expect(reloads).toBe(1)
      StudioPreviewPublication.cancel(preview)
    }),
)

Test('Studio reloads previews only through the explicit toolbar action', () => {
  const iframe = new EventTarget() as HTMLIFrameElement
  let source = 'http://127.0.0.1:56102/'
  let reloads = 0
  Object.defineProperty(iframe, 'src', {
    get: () => source,
    set: value => {
      source = value as string
      reloads += 1
    },
  })
  const preview = { ...previewConnection('preview-manual-reload', 'novel', {}), iframe }
  const button = new EventTarget() as HTMLButtonElement
  const status = { textContent: '' } as HTMLElement
  let restored = 0
  mountStudioPreviewReload(button, status, [preview], () => {
    restored += 1
  })

  button.dispatchEvent(new Event('click'))

  Expect(reloads).toBe(1)
  Expect(iframe.src).toBe('http://127.0.0.1:56102/')
  Expect(status.textContent).toBe('Reloading preview…')
  iframe.dispatchEvent(new Event('load'))
  Expect(restored).toBe(1)
})

Test('Studio Tao fixture capture rejects its pending action when the active preview reports failure', async () => {
  const previewWindow = {}
  const preview = previewConnection('preview-capture', 'default', previewWindow)
  let rejected = ''
  let rejectedName = ''
  preview.capture = {
    fixtureName: 'CapturedState',
    identity: {
      appName: 'Garden',
      path: 'Garden.tao',
      previewInstanceId: preview.previewInstanceId,
      project: '/workspace',
      sourceVersion: 'source-1',
    },
    reject(error) {
      rejected = error.message
      rejectedName = error.constructor.name
    },
    requestId: 'capture-1',
    resolve() {},
    timeout: setTimeout(() => {}, 10_000),
  }
  await handlePreviewMessage(
    {
      data: {
        channel: studioProtocolChannel,
        error: 'Provider capture failed safely.',
        errorName: 'UserInputError',
        identity: {
          appName: 'Garden',
          previewInstanceId: preview.previewInstanceId,
          project: '/workspace',
        },
        protocolVersion: studioProtocolVersion,
        requestId: 'capture-1',
        type: 'preview-fixture-capture-failed',
      },
      origin: preview.origin,
      source: previewWindow,
    } as unknown as MessageEvent,
    preview,
    { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake,
    async () => undefined,
    { async applySourceAction() {}, inspect() {} },
  )

  Expect(rejected).toBe('Provider capture failed safely.')
  // The category survives the protocol: a capture that failed on the author's input must not reach
  // the client as a host-environment fault.
  Expect(rejectedName).toBe('UserInputError')
  Expect(preview.capture).toBeUndefined()
})

Test('Studio Tao fixture capture proposes the server diff, shows it, and applies only on confirm', async () => {
  const previousFetch = globalThis.fetch
  const previousConfirm = StudioDialog.confirm
  const restoreWindow = stubStudioSessionWindow('/sessions/window-capture')
  const fetched: Array<{ body: unknown; url: string }> = []
  const confirmed: unknown[] = []
  const applied: unknown[] = []
  let resolved: unknown
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    fetched.push({ body: init?.body === undefined ? undefined : JSON.parse(String(init.body)), url })
    return new Response(
      JSON.stringify({
        content: 'fixture-content-with-CapturedState',
        diff: '--- Garden.tao\n+++ Garden.tao (proposed)\n@@ -1,0 +2,1 @@\n+fixture CapturedState { }',
        edits: [],
        path: 'Garden.tao',
        proposedSourceVersion: 'source-2',
        requestId: 'capture-1',
        sourceVersion: 'source-1',
      }),
      { status: 200 },
    )
  }) as typeof fetch
  ;(StudioDialog as { confirm: typeof StudioDialog.confirm }).confirm = async options => {
    confirmed.push(options)
    return true
  }
  try {
    const previewWindow = {}
    const preview = previewConnection('preview-capture-confirm', 'default', previewWindow)
    preview.capture = {
      fixtureName: 'CapturedState',
      identity: {
        appName: 'Garden',
        path: 'Garden.tao',
        previewInstanceId: preview.previewInstanceId,
        project: '/workspace',
        sourceVersion: 'source-1',
      },
      reject(error) {
        resolved = error
      },
      requestId: 'capture-1',
      resolve(result) {
        resolved = result
      },
      timeout: setTimeout(() => {}, 10_000),
    }
    await handlePreviewMessage(
      {
        data: {
          channel: studioProtocolChannel,
          fixture: { accounts: [], creates: [] },
          identity: {
            appName: 'Garden',
            previewInstanceId: preview.previewInstanceId,
            project: '/workspace',
          },
          protocolVersion: studioProtocolVersion,
          requestId: 'capture-1',
          type: 'preview-fixture-captured',
        },
        origin: preview.origin,
        source: previewWindow,
      } as unknown as MessageEvent,
      preview,
      { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake,
      async () => undefined,
      {
        async applySourceAction(envelope) {
          applied.push(envelope)
        },
        inspect() {},
      },
    )

    Expect(fetched).toHaveLength(1)
    Expect(fetched[0]?.url.endsWith('/api/source-action/propose')).toBe(true)
    Expect((fetched[0]?.body as { action: { kind: string } }).action.kind).toBe('insert-captured-fixture')
    Expect(confirmed).toEqual([{
      confirmLabel: 'Save fixture',
      diff: '--- Garden.tao\n+++ Garden.tao (proposed)\n@@ -1,0 +2,1 @@\n+fixture CapturedState { }',
      title: 'Save this captured Tao fixture?',
    }])
    Expect(applied).toHaveLength(1)
    Expect((applied[0] as { action: { kind: string } }).action.kind).toBe('insert-captured-fixture')
    Expect(resolved).toBe('saved')
    Expect(preview.capture).toBeUndefined()
  } finally {
    globalThis.fetch = previousFetch
    ;(StudioDialog as { confirm: typeof StudioDialog.confirm }).confirm = previousConfirm
    restoreWindow()
  }
})

Test('Studio Tao fixture capture applies nothing when the confirmation dialog is cancelled', async () => {
  const previousFetch = globalThis.fetch
  const previousConfirm = StudioDialog.confirm
  const restoreWindow = stubStudioSessionWindow('/sessions/window-cancel')
  const applied: unknown[] = []
  let resolved: unknown
  globalThis.fetch = (async (_input: string | URL | Request) => {
    return new Response(
      JSON.stringify({
        content: 'fixture-content-with-CapturedState',
        diff: '--- Garden.tao\n+++ Garden.tao (proposed)\n@@ -1,0 +2,1 @@\n+fixture CapturedState { }',
        edits: [],
        path: 'Garden.tao',
        proposedSourceVersion: 'source-2',
        requestId: 'capture-2',
        sourceVersion: 'source-1',
      }),
      { status: 200 },
    )
  }) as typeof fetch
  ;(StudioDialog as { confirm: typeof StudioDialog.confirm }).confirm = async () => false
  try {
    const previewWindow = {}
    const preview = previewConnection('preview-capture-cancel', 'default', previewWindow)
    preview.capture = {
      fixtureName: 'CapturedState',
      identity: {
        appName: 'Garden',
        path: 'Garden.tao',
        previewInstanceId: preview.previewInstanceId,
        project: '/workspace',
        sourceVersion: 'source-1',
      },
      reject(error) {
        resolved = error
      },
      requestId: 'capture-2',
      resolve(result) {
        resolved = result
      },
      timeout: setTimeout(() => {}, 10_000),
    }
    await handlePreviewMessage(
      {
        data: {
          channel: studioProtocolChannel,
          fixture: { accounts: [], creates: [] },
          identity: {
            appName: 'Garden',
            previewInstanceId: preview.previewInstanceId,
            project: '/workspace',
          },
          protocolVersion: studioProtocolVersion,
          requestId: 'capture-2',
          type: 'preview-fixture-captured',
        },
        origin: preview.origin,
        source: previewWindow,
      } as unknown as MessageEvent,
      preview,
      { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake,
      async () => undefined,
      {
        async applySourceAction(envelope) {
          applied.push(envelope)
        },
        inspect() {},
      },
    )

    Expect(applied).toHaveLength(0)
    Expect(resolved).toBe('cancelled')
    Expect(preview.capture).toBeUndefined()
  } finally {
    globalThis.fetch = previousFetch
    ;(StudioDialog as { confirm: typeof StudioDialog.confirm }).confirm = previousConfirm
    restoreWindow()
  }
})

Test(
  'Studio Tao fixture capture applies nothing and never opens the dialog when the proposal request fails',
  async () => {
    const previousFetch = globalThis.fetch
    const previousConfirm = StudioDialog.confirm
    const restoreWindow = stubStudioSessionWindow('/sessions/window-propose-failed')
    const applied: unknown[] = []
    const confirmed: unknown[] = []
    let resolved: unknown
    globalThis.fetch = (async (_input: string | URL | Request) => {
      return new Response(
        JSON.stringify({ error: 'Studio source changed before the edit was applied.' }),
        { status: 409 },
      )
    }) as typeof fetch
    ;(StudioDialog as { confirm: typeof StudioDialog.confirm }).confirm = async options => {
      confirmed.push(options)
      return true
    }
    try {
      const previewWindow = {}
      const preview = previewConnection('preview-capture-propose-failed', 'default', previewWindow)
      preview.capture = {
        fixtureName: 'CapturedState',
        identity: {
          appName: 'Garden',
          path: 'Garden.tao',
          previewInstanceId: preview.previewInstanceId,
          project: '/workspace',
          sourceVersion: 'source-1',
        },
        reject(error) {
          resolved = error
        },
        requestId: 'capture-3',
        resolve(result) {
          resolved = result
        },
        timeout: setTimeout(() => {}, 10_000),
      }
      await handlePreviewMessage(
        {
          data: {
            channel: studioProtocolChannel,
            fixture: { accounts: [], creates: [] },
            identity: {
              appName: 'Garden',
              previewInstanceId: preview.previewInstanceId,
              project: '/workspace',
            },
            protocolVersion: studioProtocolVersion,
            requestId: 'capture-3',
            type: 'preview-fixture-captured',
          },
          origin: preview.origin,
          source: previewWindow,
        } as unknown as MessageEvent,
        preview,
        { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake,
        async () => undefined,
        {
          async applySourceAction(envelope) {
            applied.push(envelope)
          },
          inspect() {},
        },
      )

      Expect(confirmed).toHaveLength(0)
      Expect(applied).toHaveLength(0)
      Expect(resolved).toBeInstanceOf(Error)
      Expect((resolved as Error).message).toBe('Studio source changed before the edit was applied.')
      Expect(preview.capture).toBeUndefined()
    } finally {
      globalThis.fetch = previousFetch
      ;(StudioDialog as { confirm: typeof StudioDialog.confirm }).confirm = previousConfirm
      restoreWindow()
    }
  },
)

Test('a dragged divider collapses its pane past half the minimum and otherwise stays within its bounds', () => {
  Expect(studioDraggedPaneSize(130, 280, 900)).toBe(0)
  Expect(studioDraggedPaneSize(141, 280, 900)).toBe(280)
  Expect(studioDraggedPaneSize(500, 280, 900)).toBe(500)
  Expect(studioDraggedPaneSize(1400, 280, 900)).toBe(900)
  // A window too narrow for the floor still lets the pane keep its minimum rather than vanish.
  Expect(studioDraggedPaneSize(400, 280, 120)).toBe(280)
})

Test('Studio pane sizes load safe defaults and persist all divider dimensions', () => {
  let stored: string | null = '{"left":312,"right":296,"bottom":205,"preview":516}'
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value
    },
  }

  Expect(StudioPaneSizes.load(storage)).toEqual({ bottom: 205, left: 312, preview: 516, right: 296 })
  StudioPaneSizes.save(storage, { bottom: 164, left: 244, preview: 560, right: 320 })
  Expect(stored).toBe('{"bottom":164,"left":244,"preview":560,"right":320}')
  stored = '{"left":"wide","right":null}'
  Expect(StudioPaneSizes.load(storage)).toEqual({ bottom: 180, left: 360, preview: 440, right: 440 })
})

Test('Studio workbench state loads safe defaults and persists layout presets, rail panels, and drawer tabs', () => {
  const store = new Map<string, string>()
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
  }

  Expect(StudioWorkbenchState.loadLayoutPreset(storage)).toBe('run')
  StudioWorkbenchState.saveLayoutPreset(storage, 'code')
  Expect(StudioWorkbenchState.loadLayoutPreset(storage)).toBe('code')
  StudioWorkbenchState.saveLayoutPreset(storage, 'draw')
  Expect(StudioWorkbenchState.loadLayoutPreset(storage)).toBe('draw')
  store.set('tao-studio:layout-preset:v1', 'invalid')
  Expect(StudioWorkbenchState.loadLayoutPreset(storage)).toBe('run')

  Expect(StudioWorkbenchState.loadRailPanel(storage)).toBe('files')
  StudioWorkbenchState.saveRailPanel(storage, 'data')
  Expect(StudioWorkbenchState.loadRailPanel(storage)).toBe('data')
  store.set('tao-studio:rail-panel:v1', '')
  Expect(StudioWorkbenchState.loadRailPanel(storage)).toBe('files')
  store.set('tao-studio:rail-panel:v1', 'agent')
  Expect(StudioWorkbenchState.loadRailPanel(storage)).toBe('files')
  store.set('tao-studio:rail-panel:v1', 'search')
  Expect(StudioWorkbenchState.loadRailPanel(storage)).toBe('files')

  Expect(StudioWorkbenchState.loadDrawerTab(storage)).toBe('Problems')
  StudioWorkbenchState.saveDrawerTab(storage, 'Data')
  Expect(StudioWorkbenchState.loadDrawerTab(storage)).toBe('Data')
  store.set('tao-studio:drawer-tab:v1', 'InvalidTab')
  Expect(StudioWorkbenchState.loadDrawerTab(storage)).toBe('Problems')
})

Test('Embedded Studio keeps one Files portal target and every contextual rail panel', () => {
  const markup = studioShellMarkup()
  Expect(studioShellRailPanels.map(item => item.panel)).toEqual([
    'files',
    'components',
    'screens',
    'tokens',
    'data',
  ])
  Expect(markup.match(/class="studio-files"/g)).toHaveLength(1)
  Expect(markup.match(/class="studio-data"/g)).toHaveLength(1)
  for (const item of studioShellRailPanels) {
    Expect(markup).toContain(`data-panel="${item.panel}"`)
  }
  Expect(markup).toContain('data-studio-panel="agent"')
  Expect(markup).toContain('class="studio-agent-host"')
  Expect(markup).not.toContain('data-panel="search"')
})

Test('Studio search blur keeps results when the press is inside search and restores the rail otherwise', () => {
  Expect(studioSearchBlurIntent({ insideSearch: true, railPanel: undefined })).toBe('keep')
  Expect(studioSearchBlurIntent({ insideSearch: false, railPanel: 'components' })).toBe('hand-off-rail')
  Expect(studioSearchBlurIntent({ insideSearch: false, railPanel: 'agent' })).toBe('restore')
  Expect(studioSearchBlurIntent({ insideSearch: false, railPanel: undefined })).toBe('restore')
})

Test('Studio toolbar keeps project and app context compact', () => {
  Expect(StudioProjectContext.label('/projects/Garden', 'Fallback')).toBe('Garden')
  Expect(StudioProjectContext.label('/repo/Apps/WordFlower/1 - Current', 'WordFlower')).toBe('WordFlower')
  Expect(StudioProjectContext.label('/', 'Fallback')).toBe('Fallback')
  Expect(StudioProjectContext.choices(
    { appName: 'WordFlower', project: '/repo/Apps/WordFlower/1 - Current' },
    [
      { appName: 'WordFlower', project: '/repo/Apps/WordFlower/1 - Current' },
      { appName: 'Garden', project: '/projects/Garden' },
      { appName: 'Archive', project: '/archive/Garden' },
    ],
  )).toEqual([
    { appName: 'WordFlower', label: 'WordFlower', project: '/repo/Apps/WordFlower/1 - Current' },
    { appName: 'Garden', label: 'Garden — /projects/Garden', project: '/projects/Garden' },
    { appName: 'Archive', label: 'Garden — /archive/Garden', project: '/archive/Garden' },
  ])
})

Test('Studio global loading blocks transitions until success navigation or an error', () => {
  const heading = { textContent: '' }
  const detail = { textContent: '' }
  const overlayAttributes = new Map<string, string>()
  const shellAttributes = new Map<string, string>()
  const shell = {
    removeAttribute: (name: string) => shellAttributes.delete(name),
    setAttribute: (name: string, value: string) => shellAttributes.set(name, value),
  }
  const overlay = {
    closest: () => shell,
    hidden: true,
    querySelector: (selector: string) => selector === 'strong' ? heading : detail,
    removeAttribute: (name: string) => overlayAttributes.delete(name),
    setAttribute: (name: string, value: string) => overlayAttributes.set(name, value),
  } as unknown as HTMLElement

  StudioGlobalLoading.show(overlay, 'Opening Garden…', 'Preparing its preview.')
  Expect(overlay.hidden).toBe(false)
  Expect(heading.textContent).toBe('Opening Garden…')
  Expect(detail.textContent).toBe('Preparing its preview.')
  Expect(overlayAttributes.get('aria-busy')).toBe('true')
  Expect(shellAttributes.get('aria-busy')).toBe('true')

  StudioGlobalLoading.hide(overlay)
  Expect(overlay.hidden).toBe(true)
  Expect(overlayAttributes.has('aria-busy')).toBe(false)
  Expect(shellAttributes.has('aria-busy')).toBe(false)
})

Test('Studio editor tabs restore only available Tao paths and persist active order safely', () => {
  let stored = JSON.stringify({
    activePath: '../Outside.tao',
    paths: ['First.tao', '../Outside.tao', 'Notes.txt', 'Nested/Second.tao', 'First.tao'],
    version: 1,
  })
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value
    },
  }
  const tabs = new StudioEditorTabs({
    appName: 'Garden',
    availablePaths: ['First.tao', 'Nested/Second.tao', 'Third.tao'],
    project: '/projects/Garden',
    storage,
  })

  Expect(tabs.snapshot()).toEqual({ activePath: 'Nested/Second.tao', paths: ['First.tao', 'Nested/Second.tao'] })
  Expect(tabs.activate('First.tao')).toEqual({ activePath: 'First.tao', paths: ['First.tao', 'Nested/Second.tao'] })
  Expect(tabs.open('Third.tao')).toEqual({
    activePath: 'Third.tao',
    paths: ['First.tao', 'Nested/Second.tao', 'Third.tao'],
  })
  Expect(tabs.open('First.tao')).toEqual({
    activePath: 'First.tao',
    paths: ['First.tao', 'Nested/Second.tao', 'Third.tao'],
  })
  Expect(tabs.close('Third.tao')).toEqual({
    activePath: 'First.tao',
    paths: ['First.tao', 'Nested/Second.tao'],
  })
  Expect(() => tabs.open('../Outside.tao')).toThrow('not an available Tao file')
  Expect(JSON.parse(stored)).toEqual({
    activePath: 'First.tao',
    paths: ['First.tao', 'Nested/Second.tao'],
    version: 1,
  })
})

Test('Studio editor tabs follow rename/delete metadata and ignore corrupt device state', () => {
  let stored = '{bad json'
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value
    },
  }
  const tabs = new StudioEditorTabs({
    appName: 'Garden',
    availablePaths: ['First.tao', 'Second.tao'],
    project: '/projects/Garden',
    storage,
  })

  Expect(tabs.snapshot()).toEqual({ paths: [] })
  tabs.open('First.tao')
  tabs.open('Second.tao')
  Expect(tabs.rename('Second.tao', 'Renamed.tao')).toEqual({
    activePath: 'Renamed.tao',
    paths: ['First.tao', 'Renamed.tao'],
  })
  Expect(tabs.reconcile(['Renamed.tao'])).toEqual({ activePath: 'Renamed.tao', paths: ['Renamed.tao'] })
})

Test('Studio editor tabs rename onto an existing tab without corrupting order and expose safe eviction', () => {
  const paths = Array.from({ length: 22 }, (_, index) => `File${index}.tao`)
  const tabs = new StudioEditorTabs({
    appName: 'Garden',
    availablePaths: paths,
    project: '/projects/Garden',
    storage: { getItem: () => null, setItem() {} },
  })
  tabs.open('File0.tao')
  tabs.open('File1.tao')
  tabs.open('File2.tao')
  Expect(tabs.rename('File2.tao', 'File0.tao')).toEqual({
    activePath: 'File0.tao',
    paths: ['File1.tao', 'File0.tao'],
  })
  for (const path of paths.slice(3, 21)) {
    tabs.open(path)
  }
  Expect(tabs.evictionCandidate('File21.tao')).toBe('File1.tao')
  tabs.activate('File1.tao')
  Expect(tabs.evictionCandidate('File21.tao')).toBe('File0.tao')
  Expect(tabs.evictionCandidate('File0.tao')).toBe(undefined)
})

Test('Studio preview cells suspend outside the canvas viewport and resume on return', () => {
  Expect(StudioPreviewSuspension.transition(false, false)).toBe('suspend')
  Expect(StudioPreviewSuspension.transition(true, false)).toBe('unchanged')
  Expect(StudioPreviewSuspension.transition(true, true)).toBe('resume')
  Expect(StudioPreviewSuspension.transition(false, true)).toBe('unchanged')
})

Test('Studio live Data tables decode runtime datasource snapshots without provider access', () => {
  const snapshot = JSON.stringify({
    formatVersion: 1,
    nextId: 2,
    rows: { Notes: [{ Id: '1', Title: 'Hello' }], Tags: [] },
    schemaVersion: 1,
  })
  const tables = StudioRuntimeData.tables({
    capturedAt: 42,
    domains: [{
      domain: 'data',
      value: { entries: [{ key: JSON.stringify(['Notes:local', 0]), snapshot }] },
      version: 1,
    }],
    version: 1,
  })

  Expect(tables).toEqual([
    { datasource: 'Notes:local', entity: 'Notes', rows: [{ Id: '1', Title: 'Hello' }] },
    { datasource: 'Notes:local', entity: 'Tags', rows: [] },
  ])
})

Test('Studio runtime data names a captured datasource by its declared name, not its identity tuple', () => {
  const snapshot = JSON.stringify({
    rows: { Story: [{ Id: 'Story-1', Title: 'Show HN' }] },
    schemaVersion: 1,
  })
  // The runtime keys an entry by its schema identity — the canonical declaration tuple, the storage
  // key, and the schema name, JSON-encoded — plus the occurrence index.
  const canonical = JSON.stringify([
    'tao.declaration',
    1,
    'hnreader',
    '@workspace',
    'HNReader',
    'datasource',
    'StubSource',
  ])
  const identity = JSON.stringify([canonical, 'Data', 'Data'])
  const tables = StudioRuntimeData.tables({
    capturedAt: 42,
    domains: [{ domain: 'data', value: { entries: [{ key: JSON.stringify([identity, 0]), snapshot }] }, version: 1 }],
    version: 1,
  })

  Expect(tables).toEqual([{
    datasource: 'StubSource · Data',
    entity: 'Story',
    rows: [{ Id: 'Story-1', Title: 'Show HN' }],
  }])
})

Test('Studio cell ids read as group › entry with the manifest encoding undone', () => {
  Expect(studioCellLabel('/workspace/Garden.tao#scenario:rows:leading#cell')).toBe('rows › leading')
  Expect(studioCellLabel('/workspace/Garden.tao#scenario:Main%20group:Long%20titles')).toBe('Main group › Long titles')
  Expect(studioCellLabel('')).toBe('')
  Expect(studioCellLabel('not a cell id')).toBe('not a cell id')
})

Test('Studio Tao test output becomes structured results with navigable failures', () => {
  const result = StudioTestOutput.parse({
    durationMs: 1234,
    exitCode: 1,
    finishedAt: '2026-08-30T12:00:00.000Z',
    id: 'run-1',
    output: [
      '\u001b[31mFAIL expo-host-tests/tao-test-command.jest.tsx\u001b[0m',
      'Tao check failed: Notes > creates a note',
      'Source: /projects/My Notes/Notes.test.tao:12:7',
      'expect text "Saved" expected rendered text but found none.',
      'Tests:       1 failed, 2 passed, 3 total',
    ].join('\n'),
    signal: null,
  })

  Expect(result).toMatchObject({
    failed: 1,
    passed: 2,
    status: 'failed',
  })
  Expect(result.output).not.toContain('\u001b')
  Expect(result.failures).toEqual([{
    column: 7,
    filePath: '/projects/My Notes/Notes.test.tao',
    line: 12,
    message: 'expect text "Saved" expected rendered text but found none.',
    name: 'Notes > creates a note',
  }])
})

// The runner gives each Tao journey its own case, so a `.test.tao` file heads the group those cases
// sit in instead of naming a case. The panel lists the files the run covered, and never the
// generated Jest entrypoints — one per worker the run was allowed — that the cases were run from.
Test('Studio Tao test output lists the test files its journeys were grouped under', () => {
  const result = StudioTestOutput.parse({
    durationMs: 1234,
    exitCode: 1,
    finishedAt: '2026-08-30T12:00:00.000Z',
    id: 'run-2',
    output: [
      'PASS _gen_tao-app-test/tao-test-command/run-1-a/journeys/2/shard-1-of-2.jest.tsx',
      '  Tao test command',
      '    Notes.test.tao',
      '      ✓ Notes > reads a note (12 ms)',
      '      ✕ Notes > creates a note (7 ms)',
      '',
      'PASS _gen_tao-app-test/tao-test-command/run-1-a/journeys/2/shard-2-of-2.jest.tsx',
      '  Tao test command',
      '    Garden.test.tao',
      '      ✓ Garden > plants a row (3 ms)',
      '',
      '  ● Tao test command › Notes.test.tao › Notes > creates a note',
      '    Tao check failed: Notes > creates a note',
      '    Source: /projects/My Notes/Notes.test.tao',
      '    expect text "Saved" expected rendered text but found none.',
      'Tests:       1 failed, 2 passed, 3 total',
    ].join('\n'),
    signal: null,
  })

  Expect(result.testFiles).toEqual([
    'Notes.test.tao',
    'Garden.test.tao',
  ])
  Expect(result.failures).toEqual([{
    filePath: '/projects/My Notes/Notes.test.tao',
    message: 'expect text "Saved" expected rendered text but found none.',
    name: 'Notes > creates a note',
  }])
})

Test('Studio API routes bind every project window to one opaque session', () => {
  Expect(StudioApiRoutes.sessionPath('/sessions/window_one', '/api/protocol'))
    .toBe('/sessions/window_one/api/protocol')
  Expect(() => StudioApiRoutes.sessionPath('/', '/api/protocol')).toThrow(
    'Studio requests require a managed session window.',
  )
  Expect(() => StudioApiRoutes.sessionPath('/sessions/../project', '/api/protocol')).toThrow(
    'Studio requests require a managed session window.',
  )
  Expect(StudioApiRoutes.transitionUrl(
    { previewUrl: 'http://127.0.0.1:8082', url: '/sessions/window_two' },
    new URL('http://127.0.0.1:4276/sessions/window_one'),
  )).toBe('/sessions/window_two')
  Expect(StudioApiRoutes.transitionUrl(
    { previewUrl: 'http://127.0.0.1:8082', url: '/sessions/window_two' },
    new URL('http://127.0.0.1:4276/sessions/window_one?native-window=project'),
  )).toBe(
    '/sessions/window_two?native-window=project&native-preview-url=http%3A%2F%2F127.0.0.1%3A8082',
  )
  Expect(() =>
    StudioApiRoutes.transitionUrl(
      { url: 'https://example.com/sessions/window_two' },
      new URL('http://127.0.0.1:4276/sessions/window_one'),
    )
  ).toThrow('invalid managed session URL')
})

Test('Studio preview frames carry their managed session into cross-origin bootstrap requests', () => {
  const managed = new URL(StudioPreviewFrameUrl.create(
    'http://127.0.0.1:8081/?expo=true',
    'preview-one',
    { origin: 'http://127.0.0.1:4276', pathname: '/sessions/window_one' },
    true,
  ))
  Expect(managed.origin).toBe('http://127.0.0.1:8081')
  Expect(managed.searchParams.get('expo')).toBe('true')
  Expect(managed.searchParams.get('taoStudioCell')).toBe('1')
  Expect(managed.searchParams.get('taoStudioParentOrigin')).toBe('http://127.0.0.1:4276')
  Expect(managed.searchParams.get('taoStudioPreviewInstanceId')).toBe('preview-one')
  Expect(managed.searchParams.get('taoStudioSessionId')).toBe('window_one')

  const legacy = new URL(StudioPreviewFrameUrl.create(
    'http://127.0.0.1:8081',
    'preview-two',
    { origin: 'http://127.0.0.1:4276', pathname: '/' },
  ))
  Expect(legacy.searchParams.has('taoStudioCell')).toBe(false)
  Expect(legacy.searchParams.has('taoStudioSessionId')).toBe(false)
})

Test('Studio retained previews preserve independent cell revisions and safely fall back to a new base', async () => {
  const retainedCell = cell('novel')
  const manifest = {
    cells: [retainedCell],
    compileRevision: 2,
    manifestRevision: 'compile:2',
    project: { appName: 'Garden', entryPath: '/workspace/Garden.tao', root: '/workspace' },
  } as unknown as StudioPreviewManifestV2
  const previous = {
    appName: 'Garden',
    cellId: 'novel',
    cellRevision: 3,
    compileRevision: 1,
    manifestRevision: 'compile:1',
    project: '/workspace',
  }
  const identities = StudioRetainedPreview.registrationIdentities(manifest, retainedCell, previous)
  Expect(identities.map(identity => ({
    cellRevision: identity.cellRevision,
    compileRevision: identity.compileRevision,
    manifestRevision: identity.manifestRevision,
  }))).toEqual([
    { cellRevision: 3, compileRevision: 2, manifestRevision: 'compile:2' },
    { cellRevision: 0, compileRevision: 2, manifestRevision: 'compile:2' },
  ])

  const retainedAttempts: number[] = []
  const retained = await StudioRetainedPreview.register(identities, 'preview-retained', async identity => {
    retainedAttempts.push(identity.cellRevision)
    return { ...retainedCell, cellRevision: identity.cellRevision }
  })
  Expect(retainedAttempts).toEqual([3])
  Expect(retained.cellRevision).toBe(3)

  const fallbackAttempts: number[] = []
  const fallback = await StudioRetainedPreview.register(identities, 'preview-fallback', async identity => {
    fallbackAttempts.push(identity.cellRevision)
    if (identity.cellRevision === 3) {
      throw new StudioApiError('Studio cell targets a stale configuration revision.', 409)
    }
    return { ...retainedCell, cellRevision: identity.cellRevision }
  })
  Expect(fallbackAttempts).toEqual([3, 0])
  Expect(fallback.cellRevision).toBe(0)

  const failedAttempts: number[] = []
  await Expect(StudioRetainedPreview.register(identities, 'preview-offline', async identity => {
    failedAttempts.push(identity.cellRevision)
    throw new StudioApiError('Studio server is unavailable.', 503)
  })).rejects.toThrow('Studio server is unavailable.')
  Expect(failedAttempts).toEqual([3])
})

Test('Studio file tree rejects paths that leave the project or are not Tao sources', () => {
  Expect(StudioFileTreeModel.validatePath(' Features/Card.tao ')).toBe('Features/Card.tao')
  Expect(() => StudioFileTreeModel.validatePath('../Outside.tao')).toThrow('project-relative .tao')
  Expect(() => StudioFileTreeModel.validatePath('Notes.txt')).toThrow('project-relative .tao')
})

Test(
  'Studio file tree executes CRUD with prepared versions, publishes live lists, and transitions active files',
  async () => {
    const requests: Array<{ kind: string; request: Record<string, unknown> }> = []
    const published: string[][] = []
    const callbacks: string[] = []
    let files = [{
      diagnosticCount: 0,
      dirty: false,
      kind: 'file' as const,
      path: 'Garden.tao',
      sourceVersion: 'garden-1',
    }]
    const api = {
      async createFile(request: Record<string, unknown>) {
        requests.push({ kind: 'create', request })
        const file = {
          diagnosticCount: 0,
          dirty: false,
          kind: 'file' as const,
          path: request['path'] as string,
          sourceVersion: 'new-1',
        }
        files = [...files, file]
        return { file: { ...file, content: '' }, files } as never
      },
      async deleteFile(request: Record<string, unknown>) {
        requests.push({ kind: 'delete', request })
        const deleted = files.find(file => file.path === request['path'])!
        files = files.filter(file => file !== deleted)
        return { deleted, files } as never
      },
      async files() {
        return { files }
      },
      async renameFile(request: Record<string, unknown>) {
        requests.push({ kind: 'rename', request })
        const previousPath = request['path'] as string
        const file = {
          ...files.find(candidate => candidate.path === previousPath)!,
          path: request['targetPath'] as string,
          sourceVersion: request['sourceVersion'] as string,
        }
        files = files.map(candidate => candidate.path === previousPath ? file : candidate)
        return { file: { ...file, content: '' }, files, previousPath } as never
      },
    }
    const controller = new StudioFileTreeController({
      api: api as never,
      files,
      onCreated(result) {
        callbacks.push(`created:${result.file.path}`)
      },
      onDeleted(result) {
        callbacks.push(`deleted:${result.deleted.path}`)
      },
      onFiles: next => published.push(next.map(file => file.path)),
      onRenamed(result) {
        callbacks.push(`renamed:${result.previousPath}->${result.file.path}`)
      },
      prepareMutation: async file => ({ ...file, sourceVersion: 'prepared-version' }),
    })

    const created = await controller.create('New.tao')
    const renamed = await controller.rename(created.file, 'Nested/Renamed.tao')
    await controller.delete(renamed!.file)

    Expect(requests.map(({ kind, request }) => ({ kind, ...request }))).toEqual([
      { kind: 'create', path: 'New.tao', writeId: requests[0]!.request['writeId'] },
      {
        kind: 'rename',
        path: 'New.tao',
        sourceVersion: 'prepared-version',
        targetPath: 'Nested/Renamed.tao',
        writeId: requests[1]!.request['writeId'],
      },
      {
        kind: 'delete',
        path: 'Nested/Renamed.tao',
        sourceVersion: 'prepared-version',
        writeId: requests[2]!.request['writeId'],
      },
    ])
    Expect(published).toEqual([
      ['Garden.tao', 'New.tao'],
      ['Garden.tao', 'Nested/Renamed.tao'],
      ['Garden.tao'],
    ])
    Expect(callbacks).toEqual([
      'created:New.tao',
      'renamed:New.tao->Nested/Renamed.tao',
      'deleted:Nested/Renamed.tao',
    ])
    Expect(StudioFileTreeTransitions.afterCreate(created)).toBe('New.tao')
    Expect(StudioFileTreeTransitions.afterRename('New.tao', renamed!)).toBe('Nested/Renamed.tao')
    Expect(StudioFileTreeTransitions.afterDelete('Nested/Renamed.tao', 'Garden.tao', {
      deleted: renamed!.file,
    } as never)).toBe('Garden.tao')
  },
)

Test('Studio Data fills coalesce invalidation bursts into one latest follow-up', async () => {
  const fills = [Deferred<void>(), Deferred<void>()]
  const published: number[] = []
  let fillCount = 0
  const coordinator = new StudioDataFillCoordinator(async isLatest => {
    const fill = ++fillCount
    await fills[fill - 1]!.promise
    if (isLatest()) {
      published.push(fill)
    }
  })

  const initial = coordinator.request()
  const compile = coordinator.request()
  const file = coordinator.request()
  const manifest = coordinator.request()
  Expect(fillCount).toBe(1)

  fills[0]!.resolve()
  await Promise.resolve()
  await Promise.resolve()
  Expect(fillCount).toBe(2)
  Expect(published).toEqual([])

  fills[1]!.resolve()
  await Promise.all([initial, compile, file, manifest])
  Expect(fillCount).toBe(2)
  Expect(published).toEqual([2])
})

Test('Studio matrix groups cells by source order and diffs keyed reconciliation without page identity', () => {
  const scenarios = [
    scenario('novel', 'states', '/Garden.tao'),
    scenario('long', 'states', '/Garden.tao'),
    scenario('empty', 'empty states', '/Garden.tao'),
  ]
  const groups = StudioMatrixLayout.groups({
    cells: [cell('long'), cell('empty'), cell('novel')],
    scenarios,
  } as Pick<StudioPreviewManifestV2, 'cells' | 'scenarios'>)

  Expect(groups.map(group => ({ cells: group.cellIds, label: group.label }))).toEqual([
    { cells: ['novel', 'long'], label: 'states' },
    { cells: ['empty'], label: 'empty states' },
  ])
  Expect(StudioMatrixLayout.reconcile(['novel', 'removed'], ['novel', 'long'])).toEqual({
    added: ['long'],
    removed: ['removed'],
    retained: ['novel'],
  })
})

Test('Studio canvas mode focuses only a group whose every scenario renders one view', () => {
  const scenarios = [
    { ...scenario('novel', 'states', '/Garden.tao'), subjectId: 'view:StoryRow' },
    { ...scenario('long', 'states', '/Garden.tao'), subjectId: 'view:StoryRow' },
    { ...scenario('phone', 'devices', '/Garden.tao'), subjectId: 'app:Garden' },
    { ...scenario('mixed-a', 'mixed', '/Garden.tao'), subjectId: 'view:StoryRow' },
    { ...scenario('mixed-b', 'mixed', '/Garden.tao'), subjectId: 'view:CommentRow' },
  ]
  const manifest = {
    scenarios,
    subjects: [
      { appName: 'Garden', kind: 'app', subjectId: 'app:Garden' },
      { kind: 'view', source: { path: '/workspace/Rows.tao' }, subjectId: 'view:StoryRow', viewName: 'StoryRow' },
      { kind: 'view', source: { path: '/workspace/Rows.tao' }, subjectId: 'view:CommentRow', viewName: 'CommentRow' },
    ],
  } as unknown as Pick<StudioPreviewManifestV2, 'scenarios' | 'subjects'>
  const groupId = (group: string): string => StudioScenarioControls.groupId('/Garden.tao', group)

  Expect(StudioMatrixLayout.subjectView(manifest, groupId('states'))).toBe('StoryRow')
  Expect(StudioMatrixLayout.subjectViewId(manifest, groupId('states'))).toBe('view:StoryRow')
  Expect(StudioMatrixLayout.subjectView(manifest, groupId('devices'))).toBeUndefined()
  Expect(StudioMatrixLayout.subjectView(manifest, groupId('mixed'))).toBeUndefined()
  const groups = ['states', 'devices', 'mixed'].map(group => ({
    subjectViewId: StudioMatrixLayout.subjectViewId(manifest, groupId(group)),
  }))
  Expect(StudioMatrixLayout.focusable(groups, 'view:StoryRow')).toBe(true)
  Expect(StudioMatrixLayout.focusable(groups, 'view:CommentRow')).toBe(false)
  // A render rectangle can start from any view some scenario renders, whichever group holds it.
  Expect(StudioMatrixLayout.renderableViews(manifest, '/workspace')).toEqual(['CommentRow', 'StoryRow'])
})

Test('Studio render rectangles never start from another sketch generated under @/studio/', () => {
  const manifest = {
    scenarios: [
      { ...scenario('novel', 'states', '/workspace/Rows.tao'), subjectId: 'view:StoryRow' },
      { ...scenario('drawn', 'sketch', '/workspace/@/studio/Sketches.tao'), subjectId: 'view:View1' },
      { ...scenario('nested', 'sketch', '/workspace/@/studio/View2.tao'), subjectId: 'view:View2' },
    ],
    subjects: [
      { kind: 'view', source: { path: '/workspace/Rows.tao' }, subjectId: 'view:StoryRow', viewName: 'StoryRow' },
      { kind: 'view', source: { path: '/workspace/@/studio/View1.tao' }, subjectId: 'view:View1', viewName: 'View1' },
      { kind: 'view', source: { path: '/workspace/@/studio/View2.tao' }, subjectId: 'view:View2', viewName: 'View2' },
    ],
  } as unknown as Pick<StudioPreviewManifestV2, 'scenarios' | 'subjects'>

  Expect(StudioMatrixLayout.renderableViews(manifest, '/workspace')).toEqual(['StoryRow'])
  // Only the project's own generated tree is excluded; an `@/studio` directory elsewhere is not its.
  Expect(StudioMatrixLayout.renderableViews(manifest, '/other')).toEqual(['StoryRow', 'View1', 'View2'])
})

Test('Studio canvas Focus keeps same-named declarations distinct by canonical subject identity', () => {
  const shared = { kind: 'view' as const, viewName: 'Card' }
  const manifest = {
    scenarios: [
      { ...scenario('first', 'first', '/First.tao'), subjectId: '/First.tao#Card' },
      { ...scenario('second', 'second', '/Second.tao'), subjectId: '/Second.tao#Card' },
    ],
    subjects: [
      {
        ...shared,
        source: { kind: 'tao' as const, path: '/First.tao', range: { end: 10, start: 0 } },
        subjectId: '/First.tao#Card',
      },
      {
        ...shared,
        source: { kind: 'tao' as const, path: '/Second.tao', range: { end: 10, start: 0 } },
        subjectId: '/Second.tao#Card',
      },
    ],
  }
  const first = StudioMatrixLayout.subjectViewId(manifest, StudioScenarioControls.groupId('/First.tao', 'first'))
  const second = StudioMatrixLayout.subjectViewId(manifest, StudioScenarioControls.groupId('/Second.tao', 'second'))
  Expect(first).toBe('/First.tao#Card')
  Expect(second).toBe('/Second.tao#Card')
})

Test('Studio matrix maps generated sketch views to their source versions', () => {
  Expect(StudioMatrixLayout.sketchSourceVersions({
    scenarios: [
      { ...scenario('draft', 'sketch', '@/studio/View1.tao'), subjectId: 'view:View1' },
      { ...scenario('novel', 'states', '/Garden.tao'), subjectId: 'view:StoryRow' },
    ],
    sourceVersions: { '@/studio/View1.tao': 'view1-3', '/Garden.tao': 'garden-9' },
    subjects: [
      { kind: 'view', subjectId: 'view:View1', viewName: 'View1' },
      { kind: 'view', subjectId: 'view:StoryRow', viewName: 'StoryRow' },
    ],
  } as unknown as Pick<StudioPreviewManifestV2, 'scenarios' | 'sourceVersions' | 'subjects'>)).toEqual({
    View1: 'view1-3',
  })
})

Test('Studio review DOM publishes portable scenario identity and deterministic renderer metadata', () => {
  const reviewCell = cell('/workspace/Garden.tao#scenario:states:novel')
  const manifest = {
    cells: [reviewCell],
    compileRevision: 7,
    manifestRevision: 'manifest-7',
    project: { appName: 'Garden', entryPath: '/workspace/Garden.tao', root: '/workspace' },
    scenarios: [scenario(reviewCell.scenarioId, 'states', '/workspace/Garden.tao')],
    sourceVersions: {
      '/workspace/Z.tao': 'z-1',
      '/workspace/Garden.tao': 'garden-7',
      '/elsewhere/Private.tao': 'outside',
    },
  } as unknown as StudioPreviewManifestV2

  const environment = JSON.stringify({
    network: reviewCell.environment.network,
    scheme: reviewCell.environment.scheme,
    viewport: reviewCell.environment.viewport,
  })
  const renderInputs = JSON.stringify({
    arguments: {},
    fixtureId: 'fixture',
    prepare: [],
    stateLayers: [],
    steps: [],
  })
  Expect(StudioReviewDom.cell(manifest, reviewCell)).toEqual({
    environment,
    group: 'states',
    key: JSON.stringify(['Garden.tao', 'states', reviewCell.scenarioId, renderInputs, environment]),
    label: reviewCell.scenarioId,
    renderInputs,
  })
  const argumentVariant = StudioReviewDom.cell(manifest, { ...reviewCell, args: { State: 'error' } })
  const environmentVariant = StudioReviewDom.cell(manifest, {
    ...reviewCell,
    environment: {
      ...reviewCell.environment,
      viewport: { height: 1024, width: 768 },
    },
  })
  Expect(argumentVariant?.key).not.toBe(StudioReviewDom.cell(manifest, reviewCell)?.key)
  Expect(environmentVariant?.key).not.toBe(StudioReviewDom.cell(manifest, reviewCell)?.key)
  Expect(JSON.parse(StudioReviewDom.manifest(manifest))).toEqual({
    appName: 'Garden',
    compileRevision: 7,
    entryPath: 'Garden.tao',
    manifestRevision: 'manifest-7',
    sourceVersions: { 'Garden.tao': 'garden-7', 'Z.tao': 'z-1' },
  })
})

Test('Studio review DOM readiness clears stale failure details', () => {
  const frame = { dataset: {} } as unknown as HTMLElement
  StudioReviewDom.status(frame, 'failed', 'Could not render')
  Expect(frame.dataset['taoReviewStatus']).toBe('failed')
  Expect(frame.dataset['taoReviewError']).toBe('Could not render')

  StudioReviewDom.status(frame, 'pending')
  Expect(frame.dataset['taoReviewStatus']).toBe('pending')
  Expect(frame.dataset['taoReviewError']).toBeUndefined()
  Expect(StudioReviewDom.appliedReady(undefined)).toBe(true)
  Expect(StudioReviewDom.appliedReady('pending')).toBe(false)
  Expect(StudioReviewDom.appliedReady('failed')).toBe(false)
  Expect(StudioReviewDom.appliedReady('settled')).toBe(true)
})

Test('Studio journey recorder keeps semantic order, formats Tao, and fails closed on gaps', () => {
  const identity = {
    appName: 'Garden',
    cellId: 'novel',
    cellRevision: 0,
    compileRevision: 1,
    manifestRevision: 'manifest-1',
    previewInstanceId: 'preview-1',
    project: '/workspace',
  }
  const draft = {
    captureSensitiveText: false,
    id: 'recording-1',
    sequence: 0,
    sourceIdentity: 'source-1',
    status: 'recording' as const,
    steps: [],
  }
  const entered = StudioJourneyRecorder.receive(draft, {
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    recordingId: 'recording-1',
    sequence: 1,
    step: { kind: 'enter', redacted: false, selector: 'tag', target: 'title', value: 'Plan launch' },
    type: 'preview-journey-step-recorded',
  })
  Expect(entered.steps.map(StudioJourneyRecorder.formatStep)).toEqual([
    'enter "Plan launch" into #title',
  ])
  Expect(StudioJourneyRecorder.formatStep({
    action: 'press',
    kind: 'unresolved',
    reason: 'No unique Tao tag, accessibility label, placeholder, or visible text identifies this target.',
  })).toContain('press: unresolved')

  const duplicate = StudioJourneyRecorder.receive(entered, {
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    recordingId: 'recording-1',
    sequence: 1,
    step: { kind: 'press', selector: 'text', target: 'Save' },
    type: 'preview-journey-step-recorded',
  })
  Expect(duplicate).toBe(entered)

  const gap = StudioJourneyRecorder.receive(entered, {
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    recordingId: 'recording-1',
    sequence: 3,
    step: { kind: 'submit', selector: 'label', target: 'Task title' },
    type: 'preview-journey-step-recorded',
  })
  Expect(gap.status).toBe('invalidated')
})

Test('Studio journey recording waits for an exact ready preview and its acknowledgement', async () => {
  const preview = previewConnection('preview-journey-ready', 'novel', {})
  preview.appliedRevision = 1
  preview.expectedRevision = 1
  Expect(StudioJourneyRecorder.canStart(preview)).toBe(true)

  preview.journeyReplayStatus = 'pending'
  Expect(StudioJourneyRecorder.canStart(preview)).toBe(false)
  preview.journeyReplayStatus = 'settled'
  preview.suspended = true
  Expect(StudioJourneyRecorder.canStart(preview)).toBe(false)
  preview.suspended = false
  preview.appliedRevision = 0
  Expect(StudioJourneyRecorder.canStart(preview)).toBe(false)

  preview.appliedRevision = 1
  preview.journeyRecording = {
    captureSensitiveText: false,
    id: 'recording-ack',
    sequence: 0,
    sourceIdentity: 'source-1',
    status: 'starting',
    steps: [],
  }
  const acknowledged = StudioJourneyRecorder.receive(preview.journeyRecording, {
    channel: studioProtocolChannel,
    identity: { ...preview.cellIdentity!, previewInstanceId: preview.previewInstanceId },
    protocolVersion: studioProtocolVersion,
    recordingId: 'recording-ack',
    sequence: 0,
    status: 'recording',
    type: 'preview-journey-recording-state',
  })
  Expect(acknowledged.status).toBe('recording')

  preview.journeyRecording = { ...preview.journeyRecording, id: 'recording-timeout' }
  let changes = 0
  preview.changed = () => {
    changes += 1
  }
  awaitPreviewJourneyRecordingAcknowledgement(preview, 'recording-timeout', 1)
  await until(() => preview.journeyRecording?.status === 'invalidated', {
    description: 'the unacknowledged journey recording to invalidate',
    intervalMs: 0,
  })
  Expect(changes).toBe(1)
})

Test('Studio journey replies require the active exact cell identity', async () => {
  const contentWindow = {}
  const preview = previewConnection('preview-journey', 'novel', contentWindow)
  preview.journeyRecording = {
    captureSensitiveText: false,
    id: 'recording-1',
    sequence: 0,
    sourceIdentity: 'source-1',
    status: 'recording',
    steps: [],
  }
  let changes = 0
  await handlePreviewMessage(
    {
      data: {
        channel: studioProtocolChannel,
        identity: {
          ...preview.cellIdentity,
          cellRevision: preview.cellIdentity!.cellRevision + 1,
          previewInstanceId: preview.previewInstanceId,
        },
        protocolVersion: studioProtocolVersion,
        recordingId: 'recording-1',
        sequence: 1,
        step: { kind: 'press', selector: 'tag', target: 'save' },
        type: 'preview-journey-step-recorded',
      },
      origin: preview.origin,
      source: contentWindow,
    } as unknown as MessageEvent,
    preview,
    { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake,
    async () => undefined,
    {
      async applySourceAction() {},
      changed() {
        changes += 1
      },
      inspect() {},
    },
  )

  Expect(preview.journeyRecording.status).toBe('invalidated')
  Expect(preview.journeyRecording.steps).toEqual([])
  preview.journeyRecording = { ...preview.journeyRecording, status: 'recording' }
  await handlePreviewMessage(
    {
      data: {
        channel: studioProtocolChannel,
        identity: {
          ...preview.cellIdentity,
          compileRevision: preview.cellIdentity!.compileRevision + 1,
          previewInstanceId: preview.previewInstanceId,
        },
        protocolVersion: studioProtocolVersion,
        recordingId: 'recording-1',
        sequence: 0,
        status: 'stopped',
        type: 'preview-journey-recording-state',
      },
      origin: preview.origin,
      source: contentWindow,
    } as unknown as MessageEvent,
    preview,
    { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake,
    async () => undefined,
    {
      async applySourceAction() {},
      changed() {
        changes += 1
      },
      inspect() {},
    },
  )
  Expect(preview.journeyRecording.status).toBe('invalidated')
  Expect(changes).toBe(2)
})

Test('Studio review waits for authenticated journey replay settlement', async () => {
  const contentWindow = { postMessage() {} }
  const preview = previewConnection('preview-journey', 'novel', contentWindow)
  const frame = { dataset: {} } as unknown as HTMLElement
  preview.frame = frame
  preview.journeyReplayStatus = 'pending'
  StudioReviewDom.status(frame, 'pending')
  const identity = { ...preview.cellIdentity, previewInstanceId: preview.previewInstanceId }
  const actions = { async applySourceAction() {}, inspect() {} }
  const handshake = { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake
  const send = async (data: unknown): Promise<void> =>
    await handlePreviewMessage(
      { data, origin: preview.origin, source: contentWindow } as unknown as MessageEvent,
      preview,
      handshake,
      async () => undefined,
      actions,
    )

  Expect(frame.dataset['taoReviewStatus']).toBe('pending')

  await send({
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    type: 'preview-journey-replay-settled',
  })
  Expect(frame.dataset['taoReviewStatus']).toBe('ready')

  preview.journeyReplayStatus = 'pending'
  StudioReviewDom.status(frame, 'pending')
  await send({
    channel: studioProtocolChannel,
    error: 'Save was not found.',
    identity,
    protocolVersion: studioProtocolVersion,
    type: 'preview-journey-replay-failed',
  })
  Expect(frame.dataset['taoReviewStatus']).toBe('failed')
  Expect(frame.dataset['taoReviewError']).toBe('Save was not found.')
})

Test('Studio review keeps a replay outcome across a render for the revision the frame already replayed', async () => {
  // The frame replays each revision once. Rendering the cell again for that revision (a manifest
  // refresh that registers the same identity) used to reset it to pending, and no second settlement
  // ever arrived, so review waited on the cell until it timed out.
  const contentWindow = { postMessage() {} }
  const preview = previewConnection('preview-journey', 'novel', contentWindow)
  const manifest = { compileRevision: 1, manifestRevision: 'manifest-1' }
  Expect(StudioReviewDom.retainedJourneyReplay(preview, manifest)).toBeUndefined()
  await handlePreviewMessage(
    {
      data: {
        channel: studioProtocolChannel,
        identity: { ...preview.cellIdentity, previewInstanceId: preview.previewInstanceId },
        protocolVersion: studioProtocolVersion,
        type: 'preview-journey-replay-settled',
      },
      origin: preview.origin,
      source: contentWindow,
    } as unknown as MessageEvent,
    preview,
    { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake,
    async () => undefined,
    { async applySourceAction() {}, inspect() {} },
  )
  Expect(StudioReviewDom.retainedJourneyReplay(preview, manifest)?.status).toBe('settled')
  Expect(StudioReviewDom.retainedJourneyReplay(preview, { ...manifest, manifestRevision: 'manifest-2' }))
    .toBeUndefined()
  Expect(StudioReviewDom.retainedJourneyReplay({ ...preview, previewInstanceId: 'remounted' }, manifest))
    .toBeUndefined()
  Expect(StudioReviewDom.retainedJourneyReplay({
    ...preview,
    cellIdentity: { ...preview.cellIdentity!, cellRevision: 1 },
  }, manifest)).toBeUndefined()
})

Test('Studio review keeps a cell ready across a render for the revision its frame already applied', () => {
  // A cell without a journey is ready once its frame acknowledges applying it, which the frame does
  // once per revision; a render that reset it to pending left review waiting on it for good.
  const preview = previewConnection('preview-applied', 'novel', { postMessage() {} })
  const identity = preview.cellIdentity!
  const manifest = { compileRevision: identity.compileRevision, manifestRevision: identity.manifestRevision }
  Expect(StudioReviewDom.retainedApplied(preview, manifest)).toBe(false)
  preview.appliedIdentity = { identity, previewInstanceId: preview.previewInstanceId }
  Expect(StudioReviewDom.retainedApplied(preview, manifest)).toBe(true)
  Expect(StudioReviewDom.retainedApplied(preview, { ...manifest, manifestRevision: 'newer' })).toBe(false)
  Expect(StudioReviewDom.retainedApplied({ ...preview, previewInstanceId: 'remounted' }, manifest)).toBe(false)
  Expect(StudioReviewDom.retainedApplied({
    ...preview,
    cellIdentity: { ...identity, cellRevision: identity.cellRevision + 1 },
  }, manifest)).toBe(false)
})

Test('Studio command palette indexes files, views, grouped scenarios, commands, and insertions', () => {
  const manifest = {
    project: { appName: 'Garden', entryPath: 'Garden.tao', root: '/workspace' },
    scenarios: [scenario('novel', 'states', '/workspace/Garden.tao')],
    subjects: [{
      kind: 'view',
      source: { kind: 'tao', path: '/workspace/Card.tao', range: { end: 10, start: 0 } },
      subjectId: 'card',
      viewName: 'Card',
    }],
  } as unknown as StudioPreviewManifestV2
  const items = StudioCommandPalette.items({
    files: [{ diagnosticCount: 0, dirty: false, kind: 'file', path: 'Garden.tao', sourceVersion: 'source-1' }],
    manifest,
    projectViews: [{
      label: 'Card',
      snippet: { placeholders: [], text: 'Card()' },
      sourcePath: '/workspace/Card.tao',
      viewName: 'Card',
    }],
  })

  Expect(new Set(items.map(item => item.category))).toEqual(
    new Set([
      'Command',
      'File',
      'Insertion',
      'Scenario',
      'View',
    ]),
  )
  Expect(StudioCommandPalette.filter(items, 'states novel').map(item => item.id)).toEqual(['scenario:novel'])
  // "Show Problems" also matches "compile" through its "compile diagnostics" detail, and is
  // declared first, so without label-priority ranking it buries the command actually named.
  Expect(StudioCommandPalette.filter(items, 'show compile').map(item => item.id)[0]).toBe('command:compile')
  Expect(StudioCommandPalette.filter(items, 'insert card').map(item => item.id)).toContain(
    'insert-view:/workspace/Card.tao:Card',
  )
})

Test('Studio product panel models bound retained data, logs, and test output', () => {
  const data = Array.from({ length: StudioPanelBounds.dataRowsPerTable + 1 }, (_, Id) => ({ Id }))
  const logs = Array.from({ length: StudioPanelBounds.logs + 5 }, (_, timestamp) => ({
    arguments: [timestamp],
    level: 'log' as const,
    timestamp,
  }))
  const output = `first:${'x'.repeat(StudioPanelBounds.testOutputCharacters)}:last`

  Expect(StudioPanelModels.dataRows(data)).toHaveLength(StudioPanelBounds.dataRowsPerTable)
  Expect(StudioPanelModels.logs(logs)).toHaveLength(StudioPanelBounds.logs)
  Expect(StudioPanelModels.logs(logs)[0]?.timestamp).toBe(5)
  Expect(StudioPanelModels.testOutput(output)).toStartWith('first:')
  Expect(StudioPanelModels.testOutput(output)).toContain('characters omitted')
  Expect(StudioPanelModels.testOutput(output)).toEndWith(':last')
})

Test('Studio Screens and Search rails derive navigable manifest and project matches', () => {
  const manifest = {
    subjects: [{
      kind: 'view',
      source: { kind: 'tao', path: '/workspace/Card.tao', range: { end: 20, start: 8 } },
      subjectId: 'card',
      viewName: 'Card',
    }],
  } as unknown as StudioPreviewManifestV2

  Expect(StudioRailPanels.screens(manifest)).toEqual([{
    id: 'card',
    kind: 'view',
    label: 'Card',
    path: '/workspace/Card.tao',
    start: 8,
  }])
  Expect(StudioRailPanels.search(
    [{ content: 'view Card() {\n   Text("Novel")\n}', path: 'Card.tao', sourceVersion: 'card-2' }],
    [{ filePath: '/workspace/Garden.tao', message: 'Novel warning' }],
    'novel',
    { '/workspace/Garden.tao': 'garden-4' },
  )).toEqual([
    {
      detail: 'Novel warning',
      kind: 'diagnostic',
      label: 'Problem · Garden.tao',
      path: '/workspace/Garden.tao',
      sourceVersion: 'garden-4',
    },
    {
      detail: 'Text("Novel")',
      end: 28,
      kind: 'text',
      label: 'Card.tao:2',
      path: 'Card.tao',
      range: {
        end: { character: 14, line: 1 },
        start: { character: 9, line: 1 },
      },
      sourceVersion: 'card-2',
      start: 23,
    },
  ])
})

Test('Studio selection from a second scenario group makes that cell active for the next visual edit', async () => {
  const groups = StudioMatrixLayout.groups({
    cells: [cell('first'), cell('second')],
    scenarios: [
      scenario('first', 'first group', '/workspace/Garden.tao'),
      scenario(
        'second',
        'second group',
        '/workspace/Garden.tao',
      ),
    ],
  } as Pick<StudioPreviewManifestV2, 'cells' | 'scenarios'>)
  Expect(groups.map(group => group.cellIds)).toEqual([['first'], ['second']])

  const firstWindow = {}
  const secondWindow = {}
  const previews = [
    previewConnection('preview-first', 'first', firstWindow),
    previewConnection('preview-second', 'second', secondWindow),
  ]
  const active = new StudioActivePreview(previews)
  const handshake = { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake
  let selected: unknown
  let dispatches = 0
  let reveals = 0
  const event = {
    data: {
      channel: studioProtocolChannel,
      identity: {
        ...previews[1]!.cellIdentity,
        occurrence: { nodeKind: 'render', renderOwner: 'Main' },
        path: '/workspace/Garden.tao',
        previewInstanceId: 'preview-second',
        sourceVersion: 'source-2',
      },
      protocolVersion: studioProtocolVersion,
      range: { end: 12, start: 4 },
      type: 'preview-select-source',
    },
    origin: 'http://127.0.0.1:56102',
    source: secondWindow,
  } as MessageEvent
  const actions = {
    activate: () => active.activate(previews[1]!),
    async applySourceAction() {},
    inspect(selection: unknown) {
      selected = selection
    },
    reveal() {
      reveals += 1
    },
  }
  const openFile = async () => ({
    editor: {
      dispatch() {
        dispatches += 1
      },
      focus() {},
      state: { doc: { length: 40 } },
    } as unknown as EditorView,
    file: { content: 'view Main() {}', path: 'Garden.tao', sourceVersion: 'source-2' },
  })
  await handlePreviewMessage(
    event,
    previews[1]!,
    handshake,
    openFile,
    actions,
  )
  await handlePreviewMessage(event, previews[1]!, handshake, openFile, actions)

  Expect(selected).toMatchObject({
    identity: {
      occurrence: { nodeKind: 'render', renderOwner: 'Main' },
      scenarioId: 'second',
    },
  })
  Expect(dispatches).toBe(2)
  Expect(reveals).toBe(2)
  Expect(active.current()).toBe(previews[1])
  Expect(currentSourceIdentity(handshake, active.current(), {
    content: 'view Main() {}',
    path: 'Garden.tao',
    sourceVersion: 'source-2',
  })).toMatchObject({
    cellId: 'second',
    path: '/workspace/Garden.tao',
    previewInstanceId: 'preview-second',
    scenarioId: 'second',
    sourceVersion: 'source-2',
  })
  Expect(currentSourceIdentity(handshake, { ...active.current()!, cell: undefined }, {
    content: 'view Main() {}',
    path: 'Garden.tao',
    sourceVersion: 'source-2',
  })).toBeUndefined()
})

const previewMeasurementsSlot = testOverrideSlot({
  read: () => StudioApiClient.previewLayoutMeasurements,
  write: value => {
    ;(StudioApiClient as { previewLayoutMeasurements: typeof value }).previewLayoutMeasurements = value
  },
})

Test('Studio retains current layout identity before publication and rejects stale geometry', async () => {
  const contentWindow = {}
  const preview = previewConnection('preview-layout', 'default', contentWindow)
  const handshake = { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake
  const snapshots: unknown[] = []
  const restore = previewMeasurementsSlot.install(async () => {
    snapshots.push(preview.layoutMeasurements)
  })
  const data = {
    channel: studioProtocolChannel,
    identity: { ...preview.cellIdentity, previewInstanceId: preview.previewInstanceId },
    measurements: [{ elementName: 'Text', renderId: 'selected', rect: { height: 20, width: 40, x: 10, y: 30 } }],
    protocolVersion: studioProtocolVersion,
    type: 'preview-layout-measurements',
  }
  const actions = { async applySourceAction() {}, inspect() {} }
  const receive = (message: unknown) =>
    handlePreviewMessage(
      {
        data: message,
        origin: preview.origin,
        source: contentWindow,
      } as MessageEvent,
      preview,
      handshake,
      async () => undefined,
      actions,
    )
  try {
    await receive(data)
    Expect(snapshots).toEqual([data])
    for (const field of ['cellRevision', 'compileRevision', 'manifestRevision'] as const) {
      await receive({ ...data, identity: { ...data.identity, [field]: field === 'manifestRevision' ? 'stale' : 0 } })
    }
    Expect(preview.layoutMeasurements).toEqual(data)
    Expect(snapshots).toEqual([data, data, data, data])
    await receive({
      ...data,
      measurements: [{ ...data.measurements[0], rect: { height: 20, width: -1, x: 10, y: 30 } }],
    })
    Expect(snapshots).toHaveLength(4)
    Expect(preview.layoutMeasurements).toEqual(data)
  } finally {
    restore()
  }
})

Test('Studio canvas shortcuts reach only the authenticated preview bridge', async () => {
  const contentWindow = {}
  const preview = previewConnection('preview-shortcuts', 'default', contentWindow)
  const handshake = { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake
  const commands: string[] = []
  const actions = {
    async applySourceAction() {},
    canvasShortcut: (message: { command: string }) => commands.push(message.command),
    inspect() {},
  }
  const data = {
    channel: studioProtocolChannel,
    command: 'fit',
    identity: { ...preview.cellIdentity, previewInstanceId: preview.previewInstanceId },
    protocolVersion: studioProtocolVersion,
    type: 'preview-canvas-shortcut',
  }
  const event = { data, origin: preview.origin, source: contentWindow } as unknown as MessageEvent
  for (const command of ['fit', 'reset', 'zoom-in', 'zoom-out']) {
    await handlePreviewMessage(
      { ...event, data: { ...data, command } } as MessageEvent,
      preview,
      handshake,
      async () => undefined,
      actions,
    )
  }
  Expect(commands).toEqual(['fit', 'reset', 'zoom-in', 'zoom-out'])
  for (
    const invalid of [
      { ...event, source: {} },
      { ...event, origin: 'https://untrusted.example' },
      { ...event, data: { ...data, command: 'reload' } },
      { ...event, data: { ...data, identity: { ...data.identity, previewInstanceId: 'stale' } } },
      { ...event, data: { ...data, identity: { ...data.identity, project: '/other' } } },
    ]
  ) {
    await handlePreviewMessage(invalid as MessageEvent, preview, handshake, async () => undefined, actions)
  }
  Expect(commands).toEqual(['fit', 'reset', 'zoom-in', 'zoom-out'])
})

const previewAppliedSlot = testOverrideSlot({
  read: () => StudioApiClient.previewApplied,
  write: value => {
    ;(StudioApiClient as { previewApplied: typeof value }).previewApplied = value
  },
})

Test('Studio restores current canvas ownership when a preview bridge mounts after iframe load', async () => {
  const messages: unknown[] = []
  const contentWindow = { postMessage: (message: unknown) => messages.push(message) }
  const preview = previewConnection('preview-late', 'late', contentWindow)
  let owned = true
  let applied = 0
  const restore = previewAppliedSlot.install(async () => {
    applied += 1
  })
  const listener = studioPreviewMessageListener({
    canvasGesturesOwned: () => owned,
    handshake: { identity: { appName: 'Garden', project: '/workspace' } },
    previews: [preview],
  } as never)
  const event = {
    data: {
      appliedRevision: 1,
      channel: studioProtocolChannel,
      compileRevision: 1,
      identity: { ...preview.cellIdentity, previewInstanceId: preview.previewInstanceId },
      protocolVersion: studioProtocolVersion,
      type: 'preview-applied',
    },
    origin: preview.origin,
    source: contentWindow,
  } as unknown as MessageEvent
  try {
    // The receiver missed load-time publication. Its mounted acknowledgement must recover it.
    listener({ ...event, origin: 'https://untrusted.example' } as MessageEvent)
    Expect(messages).toEqual([])
    listener(event)
    await until(() => applied === 1)
    Expect(messages).toContainEqual({
      channel: studioProtocolChannel,
      identity: event.data.identity,
      owned: true,
      protocolVersion: studioProtocolVersion,
      type: 'set-canvas-gestures',
    })
    messages.length = 0
    owned = false
    // A later bridge remount must receive the current layout, not the initial Design state.
    listener(event)
    await until(() => applied === 2)
    Expect(messages).toContainEqual({
      channel: studioProtocolChannel,
      identity: event.data.identity,
      owned: false,
      protocolVersion: studioProtocolVersion,
      type: 'set-canvas-gestures',
    })
  } finally {
    restore()
  }
})

Test('Studio wires a canvas shortcut to the iframe that sent it', () => {
  const first = previewConnection('preview-first', 'first', {})
  const second = previewConnection('preview-second', 'second', {})
  const received: { command: string; iframe: HTMLIFrameElement }[] = []
  const listener = studioPreviewMessageListener({
    activePreview: new StudioActivePreview([first, second]),
    handshake: { identity: { appName: 'Garden', project: '/workspace' } },
    onCanvasShortcut: (command: string, iframe: HTMLIFrameElement) => received.push({ command, iframe }),
    previews: [first, second],
  } as never)
  const event = {
    data: {
      channel: studioProtocolChannel,
      command: 'zoom-in',
      identity: { ...second.cellIdentity, previewInstanceId: second.previewInstanceId },
      protocolVersion: studioProtocolVersion,
      type: 'preview-canvas-shortcut',
    },
    origin: second.origin,
    source: second.iframe.contentWindow,
  } as MessageEvent
  listener({ ...event, source: {} } as MessageEvent)
  Expect(received).toEqual([])
  listener(event)
  Expect(received).toEqual([{ command: 'zoom-in', iframe: second.iframe }])
})

Test('Studio preview message wiring dispatches one editor selection per incoming source pick', async () => {
  const contentWindow = {}
  const preview = previewConnection('preview-wiring', 'default', contentWindow)
  const handshake = { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake
  let dispatches = 0
  let inspections = 0
  const listener = studioPreviewMessageListener({
    activePreview: new StudioActivePreview([preview]),
    canvasGesturesOwned: () => false,
    drawer: { loadDataIfVisible() {}, renderIfLogs() {} },
    handshake,
    inspection: {
      highlightOnDevice: async () => {},
      inspect: async () => {},
      select() {
        inspections += 1
      },
      selected: () => undefined,
      // Reintroducing the old second selection path records another editor dispatch here.
      selectSourceInEditor() {
        dispatches += 1
      },
    },
    mutations: { submitPreview: async () => {} },
    onInspected() {},
    onReveal() {},
    preview: {} as HTMLElement,
    previews: [preview],
    publish() {},
    session: {
      openFile: async () => ({
        editor: {
          dispatch() {
            dispatches += 1
          },
          focus() {},
          state: { doc: { length: 40 } },
        } as unknown as EditorView,
        file: { content: 'view Main() {}', path: 'Garden.tao', sourceVersion: 'source-2' },
      }),
    },
    status: {} as HTMLElement,
  } as never)

  listener({
    data: {
      channel: studioProtocolChannel,
      identity: {
        appName: 'Garden',
        path: '/workspace/Garden.tao',
        previewInstanceId: preview.previewInstanceId,
        project: '/workspace',
        sourceVersion: 'source-2',
      },
      protocolVersion: studioProtocolVersion,
      range: { end: 12, start: 4 },
      type: 'preview-select-source',
    },
    origin: preview.origin,
    source: contentWindow,
  } as MessageEvent)

  await until(() => inspections === 1)
  Expect(dispatches).toBe(1)
})

Test('Studio clears other cells on a fresh preview pick and leaves the canvas focused in Design and Draw', async () => {
  const pickedWindow = {}
  const cleared: unknown[] = []
  const otherWindow = { postMessage: (message: unknown) => cleared.push(message) }
  const picked = previewConnection('preview-picked', 'first', pickedWindow)
  const other = previewConnection('preview-other', 'second', otherWindow)
  const handshake = { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake
  let joins = false
  let canvasOwnsInput = true
  let focuses = 0
  let inspections = 0
  const listener = studioPreviewMessageListener({
    activePreview: new StudioActivePreview([picked, other]),
    canvasGesturesOwned: () => false,
    canvasOwnsInput: () => canvasOwnsInput,
    drawer: { loadDataIfVisible() {}, renderIfLogs() {} },
    handshake,
    inspection: {
      highlightOnDevice: async () => {},
      inspect: async () => {},
      select() {
        inspections += 1
        return joins
      },
      selected: () => undefined,
    },
    mutations: { submitPreview: async () => {} },
    onInspected() {},
    onReveal() {},
    preview: {} as HTMLElement,
    previews: [picked, other],
    publish() {},
    session: {
      openFile: async () => ({
        editor: {
          dispatch() {},
          focus() {
            focuses += 1
          },
          state: { doc: { length: 40 } },
        } as unknown as EditorView,
        file: { content: 'view Main() {}', path: 'Garden.tao', sourceVersion: 'source-2' },
      }),
    },
    status: {} as HTMLElement,
  } as never)
  const pick = (additive?: true) =>
    listener({
      data: {
        ...(additive === undefined ? {} : { additive }),
        channel: studioProtocolChannel,
        identity: {
          ...picked.cellIdentity,
          path: '/workspace/Garden.tao',
          previewInstanceId: picked.previewInstanceId,
          sourceVersion: 'source-2',
        },
        protocolVersion: studioProtocolVersion,
        range: { end: 12, start: 4 },
        type: 'preview-select-source',
      },
      origin: picked.origin,
      source: pickedWindow,
    } as MessageEvent)

  // A pick that starts a selection tells every other cell to drop its outlines, and the editor follows
  // it without taking the keyboard from the canvas.
  pick()
  await until(() => inspections === 1)
  Expect(cleared).toEqual([{
    channel: studioProtocolChannel,
    identity: { ...other.cellIdentity, previewInstanceId: 'preview-other' },
    protocolVersion: studioProtocolVersion,
    type: 'clear-selection',
  }])
  Expect(focuses).toBe(0)

  // A shift-click that joins this cell's selection leaves the others alone.
  joins = true
  pick(true)
  await until(() => inspections === 2)
  Expect(cleared).toHaveLength(1)

  // Code has no canvas, so the editor takes focus there.
  canvasOwnsInput = false
  pick()
  await until(() => focuses === 1)
})

Test('Studio attaches the active cell scenario to preview-originated source actions', async () => {
  const contentWindow = {}
  const preview = previewConnection('preview-second', 'second', contentWindow)
  const handshake = { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake
  let applied: unknown

  await handlePreviewMessage(
    {
      data: {
        action: {
          beforeId: '/workspace/Garden.tao:30:40',
          draggedId: '/workspace/Garden.tao:10:20',
          kind: 'move-render',
        },
        channel: studioProtocolChannel,
        checkpoint: { id: 'move-1', phase: 'single' },
        identity: {
          ...preview.cellIdentity,
          occurrence: { nodeKind: 'render', renderOwner: 'Main' },
          path: '/workspace/Garden.tao',
          previewInstanceId: preview.previewInstanceId,
          sourceVersion: 'source-2',
        },
        protocolVersion: studioProtocolVersion,
        requestId: 'move-request-1',
        sourceActionVersion: studioSourceActionVersion,
        type: 'source-action',
      },
      origin: preview.origin,
      source: contentWindow,
    } as MessageEvent,
    preview,
    handshake,
    async () => undefined,
    {
      async applySourceAction(envelope) {
        applied = envelope
      },
      inspect() {},
    },
  )

  Expect(applied).toMatchObject({ identity: { scenarioId: 'second' } })
})

Test('Studio passive preview startup and console messages do not steal the active canvas cell', async () => {
  const firstWindow = {}
  const secondWindow = {}
  const previews = [
    previewConnection('preview-first', 'first', firstWindow),
    previewConnection('preview-second', 'second', secondWindow),
  ]
  const active = new StudioActivePreview(previews)
  const handshake = { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake
  let activations = 0
  const actions = {
    activate() {
      activations += 1
      active.activate(previews[1]!)
    },
    async applySourceAction() {},
    inspect() {},
  }
  const identity = {
    ...previews[1]!.cellIdentity,
    previewInstanceId: previews[1]!.previewInstanceId,
  }

  for (
    const data of [{
      channel: studioProtocolChannel,
      identity,
      protocolVersion: studioProtocolVersion,
      type: 'preview-applied',
    }, {
      arguments: ['mounted'],
      channel: studioProtocolChannel,
      identity,
      level: 'log',
      protocolVersion: studioProtocolVersion,
      timestamp: 1_788_100_000_000,
      type: 'preview-console',
    }] as const
  ) {
    await handlePreviewMessage(
      { data, origin: previews[1]!.origin, source: secondWindow } as MessageEvent,
      previews[1]!,
      handshake,
      async () => undefined,
      actions,
    )
  }

  Expect(activations).toBe(0)
  Expect(active.current()).toBe(previews[0])
  Expect(previews[1]!.runtimeLogs?.map(log => log.arguments)).toEqual([['mounted']])
})

Test('Studio active preview rewires added cells and falls back when the active cell is removed', () => {
  const first = previewConnection('preview-first', 'first', {})
  const second = previewConnection('preview-second', 'second', {})
  const previews = [first, second]
  const active = new StudioActivePreview(previews)
  let changes = 0
  active.subscribe(() => {
    changes += 1
  })
  active.activate(second)

  const replacement = previewConnection('preview-second-next', 'second', {})
  previews.splice(0, previews.length, first, replacement)
  active.reconcile()
  Expect(active.current()).toBe(replacement)

  const added = previewConnection('preview-added', 'added', {})
  previews.splice(0, previews.length, first, added)
  const wired: string[] = []
  active.reconcile(preview => wired.push(preview.cell!.cellId))

  Expect(active.current()).toBe(first)
  Expect(wired).toEqual(['first', 'added'])
  added.activate?.()
  Expect(active.current()).toBe(added)
  Expect(changes).toBe(4)

  // A manifest refresh replaces the active inspector controls on retained connections and notifies its subscriber.
  added.scenarioControls = {} as HTMLFormElement
  active.reconcile()
  Expect(changes).toBe(4)
  active.reconcile(() => {})
  Expect(changes).toBe(5)
})

Test('Studio active preview restores initial cell id and notifies on activate', () => {
  const first = previewConnection('preview-first', 'first', {})
  const second = previewConnection('preview-second', 'second', {})
  const previews = [first, second]

  let activatedId: string | undefined
  const active = new StudioActivePreview(previews, {
    initialCellId: 'second',
    onActivate: preview => {
      activatedId = preview.cell?.cellId
    },
  })

  Expect(active.current()).toBe(second)
  active.activate(first)
  Expect(active.current()).toBe(first)
  Expect(activatedId).toBe('first')
})

Test('Studio source identity synchronizes immediately, after preview reloads, and stops on disconnect', () => {
  const iframe = new EventTarget() as HTMLIFrameElement
  const messages: Array<{ message: unknown; origin: string }> = []
  Object.defineProperty(iframe, 'contentWindow', {
    value: {
      postMessage(message: unknown, origin: string) {
        messages.push({ message, origin })
      },
    },
  })
  const preview = { ...previewConnection('preview-source', 'first', iframe.contentWindow!), iframe }
  const content = 'view Main() { Text("Hello") }'
  const editor = {
    state: {
      doc: { toString: () => content },
      selection: { main: { from: 14, to: 27 } },
    },
  } as EditorView
  const handshake = { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake
  const synchronize = (): void =>
    postEditorSelection(
      preview,
      handshake,
      { content, path: 'Garden.tao', sourceVersion: 'source-2' },
      editor,
    )

  StudioPreviewSourceSync.connect(preview, synchronize)
  Expect(messages).toEqual([{
    message: {
      channel: studioProtocolChannel,
      identity: {
        appName: 'Garden',
        path: '/workspace/Garden.tao',
        previewInstanceId: 'preview-source',
        project: '/workspace',
        sourceVersion: 'source-2',
      },
      protocolVersion: studioProtocolVersion,
      range: { end: 27, start: 14 },
      type: 'highlight-source',
    },
    origin: 'http://127.0.0.1:56102',
  }])
  iframe.dispatchEvent(new Event('load'))
  Expect(messages).toHaveLength(2)

  disconnectPreviews([preview])
  iframe.dispatchEvent(new Event('load'))
  Expect(messages).toHaveLength(2)
})

Test('Studio runtime failures retain a replay with Studio environment state', async () => {
  const previewWindow = {}
  const preview = previewConnection('preview-failure', 'first', previewWindow)
  preview.cell = cell('first')
  const handshake = {
    files: [{ path: 'Garden.tao', sourceVersion: 'source-2' }],
    identity: { appName: 'Garden', project: '/workspace' },
  } as unknown as StudioHandshake
  const capture = {
    capturedAt: 1_788_100_000_000,
    domains: [{ domain: 'data', value: { snapshots: {} }, version: 1 }],
    failure: {
      boundaryId: 'screen:Garden',
      error: { message: 'Garden failed', name: 'Error' },
      frame: {
        boundary: 'screen' as const,
        declaration: 'Garden',
        source: { end: 12, path: '/workspace/Garden.tao', start: 4 },
      },
      retryEligible: true,
      stopper: false,
      timestamp: 1_788_100_000_000,
    },
    version: 1 as const,
  }

  await handlePreviewMessage(
    {
      data: {
        capture,
        channel: studioProtocolChannel,
        identity: { ...preview.cellIdentity, previewInstanceId: preview.previewInstanceId },
        protocolVersion: studioProtocolVersion,
        type: 'preview-runtime-failure',
      },
      origin: preview.origin,
      source: previewWindow,
    } as MessageEvent,
    preview,
    handshake,
    async () => undefined,
    {
      activate() {},
      async applySourceAction() {},
      inspect() {},
    },
  )

  Expect(preview.runtimeFailure?.domains.map(domain => domain.domain)).toEqual(['data', 'environment'])
  Expect(preview.runtimeFailure?.domains.find(domain => domain.domain === 'environment')?.value)
    .toEqual(preview.cell.environment)
  Expect(runtimeCaptureWithEnvironment(preview.runtimeFailure!, preview.cell.environment).domains)
    .toHaveLength(2)
  const devEnvironment = {
    ...capture,
    domains: [...capture.domains, { domain: 'environment', value: { platform: 'ios' }, version: 1 }],
  }
  const configured = studioReplayConfiguration(devEnvironment, preview.cell.environment)
  Expect(configured.replay).toBe(devEnvironment)
  Expect(configured.environment).toEqual(preview.cell.environment)

  const capturedDark = {
    ...capture,
    domains: [
      ...capture.domains,
      {
        domain: 'scheme',
        value: {
          capability: 'reactive-browser',
          requested: 'system',
          resolved: 'dark',
          source: 'system',
        },
        version: 1,
      },
    ],
  }
  const darkReplay = studioReplayConfiguration(capturedDark, preview.cell.environment)
  Expect(darkReplay.environment.scheme).toEqual({
    capability: 'reactive-browser',
    requested: 'system',
    resolved: 'dark',
    source: 'system',
  })
})

Test('Studio host document update preserves the explicit caret through a replacement', () => {
  const source = 'view Card() {\n   Text("Hello")\n}\n'
  const cut = 'view Card() {\n}\n'
  const caret = 'view Card() {\n'.length
  const kept = EditorState.create({
    doc: source,
    selection: { anchor: caret, head: caret },
  }).update(studioHostDocumentUpdate(source.length, cut, { anchor: caret, head: caret })).state
  Expect(kept.doc.toString()).toBe(cut)
  Expect(kept.selection.main.anchor).toBe(14)
  Expect(kept.selection.main.head).toBe(14)
})

Test('Studio editor Mod-/ binding toggles Tao line comments for selected lines', () => {
  const source = 'view Card() {\n   Text("Hello")\n}\n'
  let state = EditorState.create({
    doc: source,
    extensions: StudioCodeEditor.extension,
    selection: { anchor: 0, head: source.indexOf('\n}') },
  })
  const commentBinding = state.facet(keymap).flat()
    .find(binding => binding.key === 'Mod-/' && binding.run !== undefined)
  if (commentBinding?.run === undefined) {
    Errors.throwUnexpected('CodeMirror basic setup did not install the Mod-/ comment binding.')
  }

  state = runEditorCommand(state, commentBinding.run)
  Expect(state.doc.toString()).toBe('// view Card() {\n//    Text("Hello")\n}\n')
  state = runEditorCommand(state, commentBinding.run)
  Expect(state.doc.toString()).toBe(source)
})

Test('Studio file-open lifecycle invalidates an older async navigation before it can activate', async () => {
  const lifecycle = new StudioOpenFileLifecycle()
  const firstLoaded = Deferred<string>()
  let activePath: string | undefined

  const open = async (path: string, loaded: Promise<string>): Promise<void> => {
    const attempt = lifecycle.begin()
    const result = await loaded
    if (attempt.isCurrent()) {
      activePath = `${path}:${result}`
    }
  }

  const first = open('First.tao', firstLoaded.promise)
  await open('Second.tao', Promise.resolve('second'))
  firstLoaded.resolve('first')
  await first

  Expect(activePath).toBe('Second.tao:second')
})

Test('Studio diagnostic navigation converts compiler lines into a bounded CodeMirror selection', () => {
  const state = EditorState.create({ doc: 'first\nsecond line\nthird\n' })

  Expect(StudioDiagnosticNavigation.selection(state.doc, {
    end: { character: 50, line: 1 },
    start: { character: 2, line: 1 },
  })).toEqual({
    anchor: state.doc.line(2).from + 2,
    head: state.doc.line(2).to,
  })
})

Test('Studio definition navigation selects the complete declaration line from a source offset', () => {
  const state = EditorState.create({ doc: 'first\n   view Main() {\n      Text("Hello")\n   }\n' })
  const line = state.doc.line(2)

  Expect(StudioDefinitionNavigation.selection(state.doc, line.from + 7)).toEqual({
    anchor: line.from,
    head: line.to,
  })
})

Test('Studio inspector derives canonical render identity, manifest views, and one-operation checkpoints', () => {
  const message = {
    channel: studioProtocolChannel,
    identity: {
      appName: 'Garden',
      occurrence: { nodeKind: 'render', renderOwner: 'Main' },
      path: '/workspace/Garden.tao',
      previewInstanceId: 'preview-1',
      project: '/workspace',
      sourceVersion: 'source-1',
    },
    protocolVersion: studioProtocolVersion,
    range: { end: 42, start: 20 },
    type: 'preview-select-source',
  } as const
  const selected = StudioInspector.selection(message)
  const action = StudioInspector.singleAction({
    action: { entry: ['gap', 16], kind: 'set-layout-entry', renderId: selected.renderId },
    checkpointId: 'checkpoint-1',
    identity: selected.identity,
    requestId: 'request-1',
  })

  Expect(selected.renderId).toBe('/workspace/Garden.tao:20:42')
  Expect(action.checkpoint).toEqual({ id: 'checkpoint-1', phase: 'single' })
  const manifest = {
    parametersBySubject: {
      card: [],
      form: [{ label: 'Value', parameterId: 'Value', required: true, type: { kind: 'text' } }],
    },
    project: { appName: 'Garden', entryPath: 'Garden.tao', root: '/workspace' },
    subjects: [
      {
        kind: 'view',
        source: { kind: 'tao', path: '/workspace/Card.tao', range: { end: 10, start: 0 } },
        subjectId: 'card',
        viewName: 'Card',
      },
      {
        kind: 'view',
        source: { kind: 'tao', path: '/workspace/Form.tao', range: { end: 20, start: 11 } },
        subjectId: 'form',
        viewName: 'Form',
      },
    ],
  } as unknown as StudioPreviewManifestV2
  Expect(StudioInspector.projectViews(manifest).map(view => [view.viewName, view.snippet.text]))
    .toEqual([['Card', 'Card()'], ['Form', 'Form(Value: "text")']])
})

Test('Studio inspector models the complete parsed layout vocabulary without inventing defaults', () => {
  const inspection = {
    explorations: [],
    layoutEntries: [
      ['gap', 8],
      ['pad', 'horizontal', 12, 'vertical', 6],
      ['margin', 4],
      ['width', 'max', 720],
      ['height', 'fill'],
      ['fill'],
      ['claim', 2],
      ['hug'],
      ['compress'],
      ['rigid'],
      ['aligned', 'left'],
      ['centered'],
      ['content', 'spread-balanced', 'stretch'],
    ],
    renderId: '/workspace/Garden.tao:20:42',
    styleEntries: [],
    styleProvenance: [],
  } as StudioRenderInspection

  Expect(StudioInspector.layout(inspection)).toEqual({
    alignment: { mode: 'centered' },
    content: ['spread-balanced', 'stretch'],
    gap: 8,
    growth: { mode: 'hug' },
    height: { mode: 'fill' },
    margin: ['margin', 4],
    padding: ['pad', 'horizontal', 12, 'vertical', 6],
    shrink: 'rigid',
    width: { mode: 'unset' },
    widthCap: 720,
  })
  Expect(StudioInspector.layout({ ...inspection, layoutEntries: [] })).toEqual({
    alignment: { mode: 'unset' },
    gap: undefined,
    growth: { mode: 'unset' },
    height: { mode: 'unset' },
    margin: undefined,
    padding: undefined,
    shrink: 'unset',
    width: { mode: 'unset' },
    widthCap: undefined,
  })
  Expect(StudioInspector.layout({
    ...inspection,
    layoutEntries: [
      ['gap', 'spacing.compact'],
      ['pad', 'horizontal', 'spacing.gutter', 'vertical', 'spacing.compact'],
      ['height', 'surface.row'],
      ['width', 'surface.card'],
      ['width', 'max', 'surface.readable'],
    ],
  })).toMatchObject({
    gap: 'spacing.compact',
    height: { mode: 'fixed', value: 'surface.row' },
    padding: ['pad', 'horizontal', 'spacing.gutter', 'vertical', 'spacing.compact'],
    width: { mode: 'fixed', value: 'surface.card' },
    widthCap: 'surface.readable',
  })
})

Test('Studio inspector keeps invalid numeric, spacing, and content drafts out of source actions', () => {
  Expect(StudioInspector.positiveNumberDraft('12.5')).toBe(12.5)
  for (const invalid of ['', '0', '-1', 'NaN', 'Infinity']) {
    Expect(StudioInspector.positiveNumberDraft(invalid)).toBeUndefined()
  }
  Expect(StudioInspector.layoutSizeDraft('spacing.compact')).toBe('spacing.compact')
  Expect(StudioInspector.layoutSizeDraft('spacing..compact')).toBeUndefined()
  Expect(StudioInspector.spacingEntryDraft('pad', '8')).toEqual(['pad', 8])
  Expect(StudioInspector.spacingEntryDraft('pad', 'spacing.panel')).toEqual(['pad', 'spacing.panel'])
  Expect(StudioInspector.spacingEntryDraft('margin', 'horizontal spacing.gutter top spacing.compact')).toEqual([
    'margin',
    'horizontal',
    'spacing.gutter',
    'top',
    'spacing.compact',
  ])
  Expect(StudioInspector.spacingEntryDraft('margin', 'horizontal 8 top 4 bottom 6')).toEqual([
    'margin',
    'horizontal',
    8,
    'top',
    4,
    'bottom',
    6,
  ])
  Expect(StudioInspector.spacingEntryDraft('pad', '')).toBeUndefined()
  Expect(StudioInspector.spacingEntryDraft('pad', 'horizontal 8 left 4')).toBeUndefined()
  Expect(StudioInspector.spacingEntryDraft('pad', 'top nope..bad')).toBeUndefined()
  Expect(StudioInspector.contentEntry(['spread', 'stretch'])).toEqual(['content', 'spread', 'stretch'])
  Expect(StudioInspector.contentEntry(['left', 'right'])).toBeUndefined()
  Expect(StudioInspector.styleEntryDraft('background', '#f6f7f3')).toEqual(['background', '#f6f7f3'])
  Expect(StudioInspector.styleEntryDraft('ink', 'ink')).toEqual(['ink', 'ink'])
  Expect(StudioInspector.styleEntryDraft('background', 'ember.20')).toEqual(['background', 'ember.20'])
  Expect(StudioInspector.styleEntryDraft('background', 'ember..20')).toBeUndefined()
  Expect(StudioInspector.styleEntryDraft('size', '16')).toEqual(['size', 16])
  Expect(StudioInspector.styleEntryDraft('size', 'md')).toEqual(['size', 'md'])
  Expect(StudioInspector.styleEntryDraft('line', 'rhythm.body')).toEqual(['line', 'rhythm.body'])
  Expect(StudioInspector.styleEntryDraft('weight', '600')).toEqual(['weight', 600])
  Expect(StudioInspector.styleEntryDraft('weight', 'semibold')).toEqual(['weight', 'semibold'])
  Expect(StudioInspector.styleEntryDraft('weight', '650')).toBeUndefined()
  Expect(StudioInspector.styleEntryDraft('radius', '')).toBeUndefined()
  Expect(StudioInspector.styleEntryDraft('unknown', '12')).toBeUndefined()

  Expect(StudioInspector.layoutAction('render-1', ['claim', 2])).toEqual({
    entry: ['claim', 2],
    kind: 'set-layout-entry',
    renderId: 'render-1',
  })
  Expect(StudioInspector.styleAction({
    entry: ['fg', '#112233'],
    landing: { bundleName: 'body', kind: 'style-bundle', mode: 'fork' },
    renderId: 'render-1',
  })).toEqual({
    entry: ['fg', '#112233'],
    kind: 'set-style-entry',
    landing: { bundleName: 'body', kind: 'style-bundle', mode: 'fork' },
    renderId: 'render-1',
  })
})

Test('Studio editor insertion preserves indentation and selects the first required placeholder', () => {
  const document = EditorState.create({ doc: 'view Main() {\n   \n}\n' }).doc
  const position = document.line(2).to
  const transaction = StudioEditorInsertion.transaction(document, {
    placeholders: [{ end: 18, start: 12 }],
    text: 'Card(Title: "text")',
  }, position)

  Expect(transaction.changes.insert).toBe('Card(Title: "text")')
  Expect(transaction.selection).toEqual({ anchor: position + 12, head: position + 18 })
})

Test('Studio draft sync writes only explicit saves and advances the optimistic version serially', async () => {
  const firstWrite = Deferred<StudioDraftSyncResult>()
  const writes: StudioDraftSyncRequest[] = []
  const sync = new StudioDraftSync({
    content: 'before',
    path: 'Garden.tao',
    sourceVersion: 'source-1',
  }, {
    async write(request) {
      writes.push(request)
      if (writes.length === 1) {
        return await firstWrite.promise
      }
      return saved(request, 'source-3')
    },
  })

  sync.update('draft-a')
  sync.update('draft-b')
  await Promise.resolve()
  Expect(writes).toHaveLength(0)
  const firstSave = sync.save()
  await until(() => writes.length === 1, { description: 'the queued Studio draft write', intervalMs: 0 })
  sync.update('draft-c')
  firstWrite.resolve(saved(writes[0]!, 'source-2'))
  await firstSave
  Expect(writes).toHaveLength(1)
  await sync.save()

  Expect(writes.map(write => write.content)).toEqual(['draft-b', 'draft-c'])
  Expect(writes.map(write => write.sourceVersion)).toEqual(['source-1', 'source-2'])
})

Test('Studio save responses preserve completed and newer compile status', () => {
  const result: StudioDraftSyncResult = {
    compile: {
      causes: ['studio-write'],
      changes: [{ path: 'Garden.tao' }],
      compileRevision: 2,
      diagnostics: [],
      message: 'Compiled Garden revision 2.',
      status: 'compiled',
    },
    diagnostics: [],
    file: { content: 'after', path: 'Garden.tao', sourceVersion: 'source-2' },
    saved: true,
  }
  const completed = StudioDraftStatus.completedCompile(result, {
    appliedRevision: 1,
    compileRevision: 2,
    diagnostics: [],
    message: 'Compiling Garden revision 2.',
    status: 'compiling',
  })

  Expect(completed).toEqual({
    appliedRevision: 1,
    compileRevision: 2,
    diagnostics: [],
    message: 'Compiled Garden revision 2.',
    status: 'compiled',
  })
  const newer = {
    appliedRevision: 2,
    compileRevision: 3,
    diagnostics: [],
    message: 'Compiling Garden revision 3.',
    status: 'compiling' as const,
  }
  Expect(StudioDraftStatus.completedCompile(result, newer)).toBe(newer)
})

Test('Studio draft sync keeps the last saved version after an invalid draft', async () => {
  const writes: StudioDraftSyncRequest[] = []
  const results: StudioDraftSyncResult[] = []
  const sync = new StudioDraftSync({
    content: 'before',
    path: 'Garden.tao',
    sourceVersion: 'source-1',
  }, {
    onResult: result => results.push(result),
    async write(request) {
      writes.push(request)
      return writes.length === 1
        ? {
          diagnostics: ['Expected a closing brace.'],
          file: { content: 'before', path: request.path, sourceVersion: 'source-1' },
          saved: false,
        }
        : saved(request, 'source-2')
    },
  })

  sync.update('invalid')
  Expect((await sync.save())?.saved).toBe(false)
  Expect((await sync.save())?.saved).toBe(true)

  Expect(writes.map(write => write.sourceVersion)).toEqual(['source-1', 'source-1'])
  Expect(writes.map(write => write.content)).toEqual(['invalid', 'invalid'])
  Expect(results.map(result => result.saved)).toEqual([false, true])
})

Test('Studio draft sync restores a rejected save without overwriting newer editor content', async () => {
  const firstWrite = Deferred<StudioDraftSyncResult>()
  const writes: StudioDraftSyncRequest[] = []
  const sync = new StudioDraftSync({
    content: 'before',
    path: 'Garden.tao',
    sourceVersion: 'source-1',
  }, {
    async write(request) {
      writes.push(request)
      if (writes.length === 1) {
        return await firstWrite.promise
      }
      return saved(request, 'source-2')
    },
  })

  sync.update('first draft')
  const firstSave = sync.save()
  await until(() => writes.length === 1, { description: 'the queued Studio draft write', intervalMs: 0 })
  sync.update('newer draft')
  firstWrite.reject(new Error('Connection closed.'))
  await Expect(firstSave).rejects.toThrow('Connection closed.')
  await sync.save()

  Expect(writes.map(write => write.content)).toEqual(['first draft', 'newer draft'])
})

Test('Studio recognizes command and control save without consuming modified shortcuts', () => {
  Expect(isStudioSaveShortcut({ altKey: false, ctrlKey: false, key: 's', metaKey: true })).toBe(true)
  Expect(isStudioSaveShortcut({ altKey: false, ctrlKey: true, key: 'S', metaKey: false })).toBe(true)
  Expect(isStudioSaveShortcut({ altKey: true, ctrlKey: false, key: 's', metaKey: true })).toBe(false)
  Expect(isStudioSaveShortcut({ altKey: false, ctrlKey: false, key: 's', metaKey: false })).toBe(false)
})

Test('Studio source mutations share one envelope and bind undo to the file the edit landed in', async () => {
  const previousFetch = globalThis.fetch
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { pathname: '/sessions/window-7' } },
    writable: true,
  })
  const replies: Array<() => Response> = []
  const requests: string[] = []
  const requestBodies: unknown[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestBodies.push(init?.body === undefined ? undefined : JSON.parse(String(init.body)))
    requests.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    const reply = replies.shift()
    if (reply === undefined) {
      Errors.throwUnexpected('No reply was queued for this request.')
    }
    return reply()
  }) as typeof fetch
  try {
    const selected = StudioInspector.selection({
      channel: studioProtocolChannel,
      identity: {
        appName: 'Garden',
        occurrence: { nodeKind: 'render', renderOwner: 'Main' },
        path: '/workspace/Garden.tao',
        previewInstanceId: 'preview-1',
        project: '/workspace',
        sourceVersion: 'source-1',
      },
      protocolVersion: studioProtocolVersion,
      range: { end: 42, start: 20 },
      type: 'preview-select-source',
    })
    const envelope = StudioInspector.singleAction({
      action: { entry: ['gap', 16], kind: 'set-layout-entry', renderId: selected.renderId },
      checkpointId: 'checkpoint-1',
      identity: selected.identity,
      requestId: 'request-1',
    })
    const compile = {
      causes: [],
      changes: [],
      compileRevision: 2,
      diagnostics: [],
      message: 'compiled',
      status: 'compiled' as const,
    }
    const result = (checkpointId: string, path = 'Garden.tao'): Response =>
      Response.json({
        checkpoint: { id: checkpointId, status: 'committed' },
        compile,
        content: 'view Main',
        edits: [],
        path,
      })
    const status = { dataset: {} as Record<string, string | undefined>, textContent: '' } as unknown as HTMLElement
    const events: string[] = []
    let activePath: string | undefined = 'Garden.tao'
    const mutations = new StudioSourceMutations({
      activeFile: () => ({ content: 'view Main', path: 'Garden.tao', sourceVersion: 'source-1' }),
      activePath: () => activePath,
      clearInspection: () => events.push('clear'),
      completeCompile: completion => events.push(`compile:${completion.compileRevision}`),
      currentIdentity: () => selected.identity,
      editor: () => undefined,
      focusEditor: () => {},
      inspected: () => selected,
      openFile: async (path, refresh) => {
        events.push(`open:${path}:${refresh}`)
      },
      project: '/workspace',
      publish: () => events.push(`publish:${mutations.busy() ? 'busy' : 'idle'}`),
      renderInspector: () => events.push('inspector'),
      requireActiveDraftSaved: () => true,
      status,
    })

    // One envelope: busy while pending, then clear the selection, reopen the rewritten file, fold in the compile.
    replies.push(() => result('checkpoint-1'))
    Expect(await mutations.apply(envelope)).toBe(true)
    Expect(requests.at(-1)).toBe('/sessions/window-7/api/source-action')
    Expect(status.textContent).toBe('Applying set layout entry…')
    Expect(events).toEqual([
      'publish:busy',
      'inspector',
      'clear',
      'publish:busy',
      'open:Garden.tao:true',
      'compile:2',
      'publish:idle',
      'inspector',
    ])
    Expect(mutations.canUndo()).toBe(true)
    Expect(mutations.edits()).toMatchObject([{
      id: 'checkpoint-1',
      label: 'Gap 16',
      path: 'Garden.tao',
      undoable: true,
    }])
    activePath = 'Other.tao'
    Expect(mutations.canUndo()).toBe(false)
    Expect(mutations.edits()).toMatchObject([{ undoable: false }])
    activePath = 'Garden.tao'

    // A refused mutation reports in the status line and leaves the undo stack and busy flag alone.
    replies.push(() => Response.json({ error: 'That render moved.' }, { status: 409 }))
    events.length = 0
    Expect(await mutations.apply(envelope)).toBe(false)
    Expect(status.dataset['state']).toBe('error')
    Expect(status.textContent).toBe('That render moved.')
    Expect(mutations.busy()).toBe(false)
    Expect(mutations.canUndo()).toBe(true)
    Expect(events).toEqual(['publish:busy', 'inspector', 'publish:idle', 'inspector'])

    // The same checkpoint id lands once; one undo then empties the stack through the same envelope.
    replies.push(() => result('checkpoint-1'))
    Expect(await mutations.apply(envelope)).toBe(true)
    replies.push(() =>
      Response.json({
        checkpoint: { id: 'checkpoint-1', status: 'undone' },
        compile,
        content: 'view Main',
        path: 'Garden.tao',
      })
    )
    events.length = 0
    await mutations.undoLatest()
    Expect(requests.at(-1)).toBe('/sessions/window-7/api/source-action/undo')
    Expect(events).toEqual([
      'publish:busy',
      'inspector',
      'clear',
      'publish:busy',
      'open:Garden.tao:true',
      'compile:2',
      'publish:idle',
      'inspector',
    ])
    Expect(mutations.canUndo()).toBe(false)
    Expect(replies).toHaveLength(0)

    // An undo the server refuses because the file changed since says so once and retires every edit in
    // that file, so the refused one never stays on top of the stack for the next ⌘Z.
    replies.push(() => result('checkpoint-2'))
    Expect(await mutations.submitLocal(envelope.action, selected.identity)).toBe(true)
    replies.push(() => result('checkpoint-3'))
    Expect(await mutations.submitLocal(envelope.action, selected.identity)).toBe(true)
    replies.push(() =>
      Response.json(
        { details: { code: 'stale-source', path: 'Garden.tao' }, error: 'Garden.tao changed.' },
        { status: 409 },
      )
    )
    await mutations.undoLatest()
    Expect(status.dataset['state']).toBe('error')
    Expect(status.textContent).toBe(
      'Garden.tao changed after “Gap 16”, so its visual edits can no longer be undone.',
    )
    Expect(mutations.canUndo()).toBe(false)
    Expect(mutations.edits().map(edit => [edit.id, edit.undoable])).toEqual([
      ['checkpoint-3', false],
      ['checkpoint-2', false],
    ])
    const undoRequests = requests.length
    await mutations.undoLatest()
    Expect(requests).toHaveLength(undoRequests)

    // Saving the file from the code editor retires its visual edits the same way.
    replies.push(() => result('checkpoint-4'))
    Expect(await mutations.submitLocal(envelope.action, selected.identity)).toBe(true)
    Expect(mutations.canUndo()).toBe(true)
    mutations.retirePath('Other.tao')
    Expect(mutations.canUndo()).toBe(true)
    mutations.retirePath('Garden.tao')
    Expect(mutations.canUndo()).toBe(false)

    // Undo walks back the open file's newest edit, even when another file was edited since.
    replies.push(() => result('checkpoint-5'))
    Expect(await mutations.submitLocal(envelope.action, selected.identity)).toBe(true)
    replies.push(() => result('checkpoint-6', 'Other.tao'))
    Expect(await mutations.apply(envelope)).toBe(true)
    Expect(mutations.canUndo()).toBe(true)
    Expect(mutations.edits().map(edit => [edit.id, edit.undoable])).toEqual([
      ['checkpoint-6', false],
      ['checkpoint-5', true],
      ['checkpoint-4', false],
      ['checkpoint-3', false],
      ['checkpoint-2', false],
    ])
    mutations.retirePath('Garden.tao')
    mutations.retirePath('Other.tao')

    // submitLocal answers whether the edit landed: a stale render is refused before any request.
    Expect(await mutations.submitLocal(envelope.action, { ...selected.identity, sourceVersion: 'source-0' })).toBe(
      false,
    )
    Expect(status.textContent).toBe('Wait for the refreshed preview before editing this render.')
    replies.push(() => Response.json({ error: 'That render moved.' }, { status: 409 }))
    Expect(await mutations.submitLocal(envelope.action, selected.identity)).toBe(false)
    Expect(replies).toHaveLength(0)

    // Imported parameterized views use the selected source gap even when no editor is mounted.
    replies.push(() => result('checkpoint-imported-view'))
    mutations.insertProjectView({
      label: 'View1',
      snippet: { placeholders: [{ start: 16, end: 24 }], text: 'View1(Playlist: Playlist)' },
      sourcePath: '/workspace/@/studio/View1.tao',
      viewName: 'View1',
    })
    await until(() => !mutations.busy(), { description: 'the imported view insertion', intervalMs: 0 })
    Expect(requestBodies.at(-1)).toMatchObject({
      action: {
        beforeId: selected.renderId,
        kind: 'insert-project-view',
        viewName: 'View1',
        viewSourcePath: '/workspace/@/studio/View1.tao',
      },
    })
    Expect(replies).toHaveLength(0)
  } finally {
    globalThis.fetch = previousFetch
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window
    } else {
      Object.defineProperty(globalThis, 'window', previousWindow)
    }
  }
})

function saved(request: StudioDraftSyncRequest, sourceVersion: string): StudioDraftSyncResult {
  return {
    diagnostics: [],
    file: { content: request.content, path: request.path, sourceVersion },
    saved: true,
  }
}

function runEditorCommand(state: EditorState, command: Command): EditorState {
  let next = state
  const target = {
    state,
    dispatch(transaction: Transaction) {
      next = transaction.state
    },
  }
  const handled = command(target as EditorView)
  Expect(handled).toBe(true)
  return next
}

Test('Studio canvas zoom steps land on round percentages and stop at the ends of the ladder', () => {
  Expect(nextStop(1.2, 1)).toBe(1.5)
  Expect(nextStop(1.2, -1)).toBe(1)
  // A scale already sitting on a stop moves off it rather than returning itself.
  Expect(nextStop(0.5, 1)).toBe(0.75)
  Expect(nextStop(0.5, -1)).toBe(0.25)
  // The ladder is bounded: zooming past either end clamps instead of running away.
  Expect(nextStop(4, 1)).toBe(4)
  Expect(nextStop(0.1, -1)).toBe(0.1)
})

Test('Studio canvas reveal pans the transformed plane without scrolling its clipped host', () => {
  const host = { bottom: 600, left: 100, right: 900, top: 100 }
  Expect(canvasRevealDelta(host, { bottom: 300, left: 950, right: 1150, top: 150 })).toEqual({ x: -274, y: 0 })
  Expect(canvasRevealDelta(host, { bottom: 50, left: 150, right: 250, top: -50 })).toEqual({ x: 0, y: 174 })
  Expect(canvasRevealDelta(host, { bottom: 300, left: 200, right: 400, top: 150 })).toEqual({ x: 0, y: 0 })
})

Test('Studio forwarded gestures use iframe geometry rather than the differently positioned cell frame', () => {
  const hostRect = { left: 100, top: 50 }
  const frame = { getBoundingClientRect: () => ({ left: 120, top: 80 }) } as unknown as HTMLElement
  const iframe = { getBoundingClientRect: () => ({ left: 200, top: 150 }) } as unknown as HTMLIFrameElement
  let anchor: Readonly<{ x: number; y: number }> | undefined
  const gesture = {
    channel: 'tao-studio',
    clientX: 10,
    clientY: 20,
    deltaX: 0,
    deltaY: 4,
    identity: { appName: 'Demo', previewInstanceId: 'preview-1', project: '/project' },
    protocolVersion: 1,
    type: 'preview-canvas-gesture',
    zoom: false,
  } as const

  forwardPreviewCanvasGesture(
    {
      iframeWheel: (forwarded, target) => {
        anchor = canvasIframeGestureAnchor(hostRect, target.getBoundingClientRect(), forwarded)
      },
    },
    { frame, iframe } as StudioPreviewConnection,
    gesture,
  )

  Expect(anchor).toEqual({ x: 110, y: 120 })
})

Test('Studio Design split recomputes from each current host width', () => {
  Expect(studioDesignPreviewSize(1_400, 320)).toBe(700)
  Expect(studioDesignPreviewSize(1_000, 320)).toBe(432)
  Expect(studioDesignPreviewSize(700, 320)).toBe(280)
})

Test('Studio pane collapse hides the code column in Draw and never the dissolved inspector aside', () => {
  const open = { bottom: 180, left: 360, preview: 440, right: 440 }
  const none = {
    bottom: false,
    editor: false,
    environment: false,
    left: false,
    preview: false,
    right: false,
    visual: false,
  }
  for (const preset of ['design', 'code', 'run', 'draw', undefined]) {
    Expect(studioPaneVisibility(preset, open)).toEqual(none)
  }
  // Elsewhere each divider hides its own pane.
  Expect(studioPaneVisibility('code', { ...open, preview: 0, right: 0 })).toEqual({
    ...none,
    preview: true,
    right: true,
  })
  // Draw's preview divider sizes the code column, and the aside is `display: contents` there, so
  // hiding it would take both inspector panes; the right divider hides only the selection pane.
  Expect(studioPaneVisibility('draw', { ...open, preview: 0, right: 0 })).toEqual({
    ...none,
    editor: true,
    environment: true,
    visual: true,
  })
  // Run shows nothing but the preview, so a collapsed preview size never blanks it.
  Expect(studioPaneVisibility('run', { ...open, preview: 0 })).toEqual(none)
  Expect(studioPaneVisibility('design', { ...open, bottom: 0, left: 0 })).toEqual({ ...none, bottom: true, left: true })
})

Test('Studio canvas gesture ownership is exclusive to Design layout', () => {
  Expect(studioLayoutOwnsCanvasGestures('design')).toBe(true)
  Expect(studioLayoutOwnsCanvasGestures('run')).toBe(false)
  Expect(studioLayoutOwnsCanvasGestures(undefined)).toBe(false)
})

Test('Studio inspection carries the selecting cell identity needed for owner geometry', () => {
  const identity = {
    appName: 'Garden',
    cellId: 'phone',
    cellRevision: 2,
    compileRevision: 3,
    manifestRevision: 'manifest-3',
    occurrence: { nodeKind: 'render', renderOwner: 'Card' },
    path: '/project/Card.tao',
    previewInstanceId: 'preview-3',
    project: '/project',
    sourceVersion: 'source-3',
  }
  Expect(studioInspectionRequest('/project', {
    identity,
    range: { end: 20, start: 10 },
    renderId: '/project/Card.tao:10:20',
  })).toEqual({ identity, path: 'Card.tao', renderId: '/project/Card.tao:10:20', sourceVersion: 'source-3' })
})

Test('Studio Focus serializes a late enter before leave restoration', async () => {
  const enter = Deferred<void>()
  const order: string[] = []
  const lane = new StudioCanvasFocusLane(error => {
    throw error
  })
  lane.enqueue(async () => {
    order.push('enter:start')
    await enter.promise
    order.push('enter:end')
  })
  lane.enqueue(async () => {
    order.push('leave')
  })
  await Promise.resolve()
  Expect(order).toEqual(['enter:start'])
  enter.resolve()
  await lane.settled()
  Expect(order).toEqual(['enter:start', 'enter:end', 'leave'])
})

Test('Studio Focus frames a view it entered before the owning cell reported a rectangle', async () => {
  const owner = { id: '/project/Late.tao#Card', name: 'Card' }
  const frame = {} as HTMLElement
  const row = {
    contains: (candidate: unknown) => candidate === frame,
    dataset: { taoStudioGroupViewId: owner.id },
  } as unknown as HTMLElement
  const preview = { querySelectorAll: () => [row] } as unknown as HTMLElement
  let click: (() => void) | undefined
  const button = {
    addEventListener: (_type: string, listener: () => void) => {
      click = listener
    },
    dataset: {} as Record<string, string>,
    hidden: true,
    removeEventListener() {},
    textContent: '',
  } as unknown as HTMLButtonElement
  let focused: string | undefined
  const matrix = {
    focusedView: () => focused,
    focusView: (_parent: HTMLElement, viewId: string | undefined) => {
      focused = viewId
    },
  }
  const connection = { ...previewConnection('only-preview', 'only', {}), frame }
  const viewports: Array<{ height: number; width: number }> = []
  connection.reconfigureEnvironment = async environment => {
    viewports.push(environment.viewport)
  }
  // No measurement yet: entering focus can frame nothing.
  let measured: { height: number; width: number; x: number; y: number } | undefined
  const shown: string[] = []
  const focus = mountStudioCanvasFocus({
    button,
    matrix,
    onError: error => {
      throw error
    },
    onFocused: viewId => shown.push(viewId),
    ownerFrame: viewId => viewId === owner.id ? measured : undefined,
    preview,
    previews: () => [connection],
    selectedOwner: () => owner,
    status: { dataset: {}, textContent: '' } as unknown as HTMLElement,
  })

  click?.()
  await until(() => focused === owner.id)
  Expect(viewports).toEqual([])
  // Focusing a view also brings its declaration into the code pane.
  Expect(shown).toEqual([owner.id])

  // The cell reports its rectangle afterwards, and the next inspection applies it.
  measured = { height: 120.2, width: 240.1, x: 0, y: 0 }
  focus.update()
  await until(() => viewports.length === 1)

  Expect(viewports).toEqual([{ height: 121, width: 241 }])
})

Test('Studio Focus restores only successful reframes after Back, in serialized request order', async () => {
  const owner = { id: '/project/A"B.tao#Card', name: 'Card' }
  const firstFrame = {} as HTMLElement
  const secondFrame = {} as HTMLElement
  const row = {
    contains: (candidate: unknown) => candidate === firstFrame || candidate === secondFrame,
    dataset: { taoStudioGroupViewId: owner.id },
  } as unknown as HTMLElement
  const preview = {
    querySelectorAll: () => [row],
  } as unknown as HTMLElement
  let click: (() => void) | undefined
  const button = {
    addEventListener: (_type: string, listener: () => void) => {
      click = listener
    },
    dataset: {} as Record<string, string>,
    hidden: true,
    removeEventListener() {},
    textContent: '',
  } as unknown as HTMLButtonElement
  let focused: string | undefined
  const matrix = {
    focusedView: () => focused,
    focusView: (_parent: HTMLElement, viewId: string | undefined) => {
      focused = viewId
    },
  }
  const firstGate = Deferred<void>()
  const first = { ...previewConnection('first-preview', 'first', {}), frame: firstFrame }
  const second = { ...previewConnection('second-preview', 'second', {}), frame: secondFrame }
  const firstViewports: Array<{ height: number; width: number }> = []
  const secondViewports: Array<{ height: number; width: number }> = []
  first.reconfigureEnvironment = async environment => {
    firstViewports.push(environment.viewport)
    if (firstViewports.length === 1) {
      await firstGate.promise
    }
  }
  second.reconfigureEnvironment = async environment => {
    secondViewports.push(environment.viewport)
    Errors.throwUnexpected('second reframe rejected')
  }
  const errors: unknown[] = []
  mountStudioCanvasFocus({
    button,
    matrix,
    onError: error => errors.push(error),
    ownerFrame: viewId => viewId === owner.id ? { height: 120.2, width: 240.1, x: 0, y: 0 } : undefined,
    preview,
    previews: () => [first, second],
    selectedOwner: () => owner,
    status: { dataset: {}, textContent: '' } as unknown as HTMLElement,
  })

  click?.()
  click?.()
  await Promise.resolve()
  Expect(firstViewports).toEqual([{ height: 121, width: 241 }])
  Expect(secondViewports).toEqual([])
  firstGate.resolve()
  await until(() => errors.length === 1 && firstViewports.length === 2)
  Expect(firstViewports).toEqual([{ height: 121, width: 241 }, cell('first').environment.viewport])
  Expect(secondViewports).toEqual([{ height: 121, width: 241 }])
  Expect(focused).toBeUndefined()
})

function scenario(scenarioId: string, group: string, path: string): StudioPreviewManifestV2['scenarios'][number] {
  return {
    args: {},
    fixtureId: 'fixture',
    group,
    label: scenarioId,
    prepare: [],
    scenarioId,
    source: { kind: 'tao', path, range: { end: 1, start: 0 } },
    stateLayers: [],
    subjectId: 'subject',
  }
}

function cell(cellId: string): StudioPreviewManifestV2['cells'][number] {
  return {
    args: {},
    cellId,
    cellRevision: 0,
    environment: cellEnvironment(),
    scenarioId: cellId,
    stateLayers: [],
  }
}

/** Stubs the managed-session `window.location` the API client reads its request paths from. */
function stubStudioSessionWindow(pathname: string): () => void {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { pathname } },
    writable: true,
  })
  return () => {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window
    } else {
      Object.defineProperty(globalThis, 'window', previousWindow)
    }
  }
}

Test('Lens transport retains only samples from the exact preview cell and coalesces refresh', async () => {
  const previewWindow = {}
  const preview = previewConnection('preview-lens', 'default', previewWindow)
  let changed = 0
  const message = (cellRevision: number): MessageEvent =>
    ({
      data: {
        channel: studioProtocolChannel,
        identity: { ...preview.cellIdentity, cellRevision, previewInstanceId: preview.previewInstanceId },
        protocolVersion: studioProtocolVersion,
        sample: {
          actualDurationMs: 22,
          causes: [{ kind: 'state' }],
          identity: { end: 30, kind: 'render', sourcePath: '/workspace/Garden.tao', start: 10 },
          instanceId: 'row-1',
          phase: 'update',
          sourceVersion: 'source-1',
          timestamp: 1_788_100_000_000,
        },
        type: 'preview-lens-render',
      },
      origin: preview.origin,
      source: previewWindow,
    }) as MessageEvent
  const actions = {
    async applySourceAction() {},
    changed: () => {
      changed += 1
    },
    inspect() {},
  }
  const handshake = { identity: { appName: 'Garden', project: '/workspace' } } as StudioHandshake
  await Promise.all([
    handlePreviewMessage(message(0), preview, handshake, async () => undefined, actions),
    handlePreviewMessage(message(0), preview, handshake, async () => undefined, actions),
  ])
  await handlePreviewMessage(message(1), preview, handshake, async () => undefined, actions)
  await Promise.resolve()
  Expect(preview.lensSamples).toHaveLength(2)
  Expect(changed).toBe(1)
})

function previewConnection(
  previewInstanceId: string,
  cellId: string,
  contentWindow: object,
): StudioPreviewConnection {
  return {
    cell: cell(cellId),
    cellIdentity: {
      appName: 'Garden',
      cellId,
      cellRevision: 0,
      compileRevision: 1,
      manifestRevision: 'manifest-1',
      project: '/workspace',
    },
    iframe: { contentWindow } as HTMLIFrameElement,
    interactionMode: 'edit',
    origin: 'http://127.0.0.1:56102',
    previewInstanceId,
  }
}
