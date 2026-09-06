import { EditorState, type Transaction } from '@codemirror/state'
import { type Command, type EditorView, keymap } from '@codemirror/view'
import { Errors } from '@shared'
import { Deferred, Expect, Test, until } from '@shared/test'
import type { StudioRenderInspection } from '@source-actions'
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
import {
  isStudioSaveShortcut,
  studioCellLabel,
  StudioCodeEditor,
  StudioDefinitionNavigation,
  StudioDiagnosticNavigation,
  StudioEditorInsertion,
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
  type StudioPreviewConnection,
  StudioPreviewFrameUrl,
  StudioPreviewSourceSync,
  StudioPreviewSuspension,
  studioReplayConfiguration,
  StudioRetainedPreview,
  StudioReviewDom,
  StudioRuntimeData,
} from '../studio-src/client/StudioMatrixView'
import {
  StudioCommandPalette,
  StudioPanelBounds,
  StudioPanelModels,
} from '../studio-src/client/StudioProductPanels'
import { StudioRailPanels } from '../studio-src/client/StudioRailPanels'
import { StudioScenarioControls } from '../studio-src/client/StudioScenarioControls'
import {
  StudioGlobalLoading,
  StudioPaneMinimums,
  StudioPaneSizes,
  studioShellMarkup,
  studioShellRailPanels,
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

Test('Studio browser assets produce a self-contained CodeMirror client and escape injected config', async () => {
  const bundle = await StudioClientAssets.bundle({ validationMode: 'release' })
  const moduleInputs = await StudioClientAssets.testing.moduleInputs('release')
  const html = StudioClientAssets.html({
    previewUrl: 'http://127.0.0.1:55102/?value=</script><script>bad()</script>',
  })
  Expect(html).toContain('overscroll-behavior-x: contain')
  Expect(html).toContain('flex: none')

  Expect(bundle).toContain('Tao Studio root is missing')
  Expect(bundle).toContain('/api/language/lsp')
  Expect(bundle).toContain('/api/language/highlight')
  Expect(bundle).not.toContain('createHighlighterCore')
  Expect(bundle).toContain('/api/file/draft')
  Expect(bundle).toContain('/api/file/create')
  Expect(bundle).toContain('/api/file/rename')
  Expect(bundle).toContain('/api/file/delete')
  Expect(bundle).toContain('New Tao file')
  Expect(bundle).toContain('/api/source-action/undo')
  Expect(bundle).toContain('/api/source-action/propose')
  Expect(bundle).toContain('Validating canonical Tao source')
  Expect(bundle).toContain('/api/data/fill')
  Expect(bundle).toContain('Loading Studio files')
  Expect(bundle).toContain('tao-studio-product-host')
  Expect(bundle).toContain('/api/ai/availability')
  Expect(bundle).toContain('/api/ai/fixture')
  Expect(bundle).toContain('/api/tests/status')
  Expect(bundle).toContain('/api/tests/run')
  Expect(bundle).toContain('capture-runtime')
  Expect(bundle).toContain('No console messages from the active preview.')
  Expect(bundle).toContain('Refresh data')
  Expect(bundle).toContain('Capture fixture')
  Expect(bundle).toContain('Run tests')
  Expect(bundle).toContain('Enable compile watch')
  Expect(bundle).toContain('Clear logs')
  Expect(bundle).toContain('No search results.')
  Expect(bundle).not.toContain('StudioDrawerPanelSurface')
  Expect(bundle).not.toContain('StudioSearchPanelSurface')
  Expect(moduleInputs.some(path => path.includes('/react@19.1.0/'))).toBe(true)
  Expect(moduleInputs.some(path => path.includes('/react@19.2.8/'))).toBe(false)
  Expect(bundle).toContain('Reload preview')
  Expect(bundle).toContain('Mode: Edit')
  Expect(bundle).toContain('Mode: Run')
  Expect(bundle).toContain('Design tokens')
  Expect(bundle).toContain('Layout presets')
  Expect(bundle).toContain('Editor breadcrumbs')
  Expect(bundle).toContain('Bottom drawer')
  Expect(bundle).toContain('Control+K')
  Expect(bundle).toContain('Refreshing live app data')
  Expect(bundle).toContain('Collapse inspector')
  Expect(bundle).toContain('Recent projects')
  Expect(bundle).toContain('Please wait while Studio loads the project and prepares its preview.')
  Expect(bundle).toContain('Please wait while Studio loads the app and prepares its preview.')
  Expect(bundle).toContain('studio-global-loading-spinner')
  Expect(bundle).toContain('studio-inspector-accordion')
  Expect(bundle).toContain('Collapse bottom drawer')
  Expect(bundle).toContain('tao-studio:pane-sizes:v4')
  Expect(bundle).toContain('tao-studio:editor-tabs:v1')
  Expect(bundle).toContain('/switch')
  Expect(bundle).toContain('Save or revert unsaved files before switching app variants.')
  Expect(bundle).toContain('Unsaved changes — press ⌘S to save.')
  Expect(bundle).toContain('set-interaction-mode')
  Expect(bundle).toContain('Undo visual edit')
  Expect(bundle).toContain('/api/preview/cell/reconfigure')
  Expect(bundle).toContain('/api/preview/cell/instance')
  Expect(bundle).toContain('Apply & remount')
  Expect(bundle).not.toContain('Scenario details')
  Expect(bundle).toContain('Select a scenario preview cell')
  Expect(bundle).toContain('Search project')
  Expect(bundle).toContain('Loading compiled screens…')
  Expect(bundle).not.toContain('No manifest screens are available yet.')
  Expect(bundle).toContain('Save to scenario')
  Expect(bundle).toContain('Generate fixture')
  Expect(bundle).toContain('Generating a realistic fixture')
  Expect(bundle).toContain('The Tao source changed while generation was running; its result was ignored.')
  Expect(bundle).toContain('Load failure capture')
  Expect(bundle).toContain('Paste failure capture')
  Expect(bundle).toContain('Replay captured state')
  Expect(bundle).toContain('Record journey')
  Expect(bundle).toContain('Retain sensitive text')
  Expect(bundle).toContain('Save steps to scenario')
  Expect(bundle).toContain('scenario-start-journey')
  Expect(bundle).toContain('Open failing source')
  Expect(bundle).toContain('set-scenario-arguments')
  Expect(bundle).toContain('scenarioGroupName')
  Expect(bundle).toContain('/api/source-action/inspect')
  Expect(bundle).toContain('set-style-entry')
  Expect(bundle).toContain('Fork style')
  Expect(bundle).toContain('Promote to color token')
  Expect(bundle).not.toContain('window.location.reload')
  Expect(bundle).toContain('No editable arguments')
  Expect(bundle).toContain('Injected Studio network failure')
  Expect(bundle).toContain('Scenario appearance is authored in Tao')
  Expect(bundle).not.toContain('Scheme support is not available yet')
  Expect(bundle).toContain('taoStudioPreviewInstanceId')
  Expect(bundle).toContain('taoStudioSessionId')
  Expect(bundle).not.toContain('taoStudioArgs')
  Expect(bundle).not.toContain('taoStudioState')
  Expect(bundle).not.toContain('sourceMappingURL=data:')
  Expect(html).toContain('--studio-accent: #ff6a1f')
  Expect(html).toContain('.studio-segmented')
  Expect(html).toContain('.studio-button[data-variant="primary"]')
  Expect(html).not.toMatch(/#5b8def|#315fbb|#2196f3/i)
  Expect(html).toContain('<div id="tao-studio-viewport"></div>')
  Expect(html).toContain('position: fixed !important')
  Expect(html).toContain('height: auto !important')
  Expect(html).toContain('.studio-editor[data-tao-editor-mounted="true"] > .cm-editor { display: none !important; }')
  Expect(html).toContain('overflow: clip')
  Expect(html).toContain('min-height: 0; min-width: 0; position: fixed; width: 100%')
  Expect(html).toContain('@media (max-width: 1400px)')
  Expect(html).toContain('@media (max-width: 760px)')
  Expect(html).toContain('grid-column: 4;')
  Expect(html).toContain('grid-template-columns: 0 0 0 0 minmax(0, 1fr)')
  Expect(html).toContain('--studio-preview-size')
  Expect(html).toContain('.tao-studio-product-host[data-layout-preset="code"]')
  Expect(html).not.toContain('#tao-studio-root[data-layout-preset=')
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

Test('Studio API client addresses every loopback device route with the contract bodies', async () => {
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
    await StudioApiClient.deviceStatus()
    await StudioApiClient.deviceOpenPairing()
    await StudioApiClient.deviceConfirmPairing('key-1')
    await StudioApiClient.deviceDeclinePairing('key-2')
    await StudioApiClient.deviceRevoke('key-3')
    await StudioApiClient.deviceReconnect()
    await StudioApiClient.deviceSelectCell('cell-home')
    await StudioApiClient.deviceLaunchOpen('host-1')
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
      { body: undefined, method: 'GET', url: '/sessions/window-7/api/device/status' },
      { body: {}, method: 'POST', url: '/sessions/window-7/api/device/pairing/open' },
      { body: { devicePublicKey: 'key-1' }, method: 'POST', url: '/sessions/window-7/api/device/pairing/confirm' },
      { body: { devicePublicKey: 'key-2' }, method: 'POST', url: '/sessions/window-7/api/device/pairing/decline' },
      { body: { devicePublicKey: 'key-3' }, method: 'POST', url: '/sessions/window-7/api/device/revoke' },
      { body: {}, method: 'POST', url: '/sessions/window-7/api/device/reconnect' },
      { body: { cellId: 'cell-home' }, method: 'POST', url: '/sessions/window-7/api/device/select-cell' },
      { body: { hostId: 'host-1' }, method: 'POST', url: '/sessions/window-7/api/device/launch/open' },
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
})

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
    changeActiveFile(content) {
      calls.push(`change:${content}`)
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
    requestStudioProductHostChangeActiveFile('changed')
    requestStudioProductHostSelectActiveFile(2, 5)
    Expect(calls.slice(-4)).toEqual([
      'environment:cell:1:7',
      'environment:stale:6',
      'change:changed',
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

Test('Studio invalidates a browser-local recording when its iframe reloads', () => {
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
  iframe.dispatchEvent(new Event('load'))

  Expect(preview.journeyRecording.status).toBe('invalidated')
  Expect(messages.at(-1)).toMatchObject({ type: 'set-interaction-mode' })
})

Test('Studio Tao fixture capture rejects its pending action when the active preview reports failure', async () => {
  const previewWindow = {}
  const preview = previewConnection('preview-capture', 'default', previewWindow)
  let rejected = ''
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
  Expect(preview.capture).toBeUndefined()
})

Test('Studio pane sizes load safe defaults and persist all divider dimensions', () => {
  Expect(StudioPaneMinimums).toEqual({ bottom: 96, left: 180, preview: 280, right: 320 })
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

Test('Embedded Studio keeps one Files portal target and every contextual rail panel', () => {
  const markup = studioShellMarkup()
  Expect(studioShellRailPanels.map(item => item.panel)).toEqual([
    'files',
    'components',
    'screens',
    'tokens',
    'data',
    'search',
  ])
  Expect(markup.match(/class="studio-files"/g)).toHaveLength(1)
  Expect(markup.match(/class="studio-data"/g)).toHaveLength(1)
  Expect(markup).not.toContain('Live entity tables and refresh controls are in the Data drawer.')
  for (const item of studioShellRailPanels) {
    Expect(markup).toContain(`data-panel="${item.panel}"`)
  }
  Expect(markup).toContain('data-panel="agent"')
  Expect(markup).toContain('data-studio-panel="agent"')
  Expect(markup).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
  Expect(markup.match(/<svg class="studio-icon"/g)?.length ?? 0).toBeGreaterThanOrEqual(
    studioShellRailPanels.length + 1,
  )
  Expect(markup).toContain('studio-inspector-tao-environment')
  Expect(markup.indexOf('studio-scenario-inspector-content')).toBeLessThan(
    markup.indexOf('studio-inspector-tao-environment'),
  )
  Expect(markup.indexOf('studio-inspector-tao-environment')).toBeLessThan(
    markup.indexOf('studio-inspector-tao-context'),
  )
  Expect(markup).toContain('studio-toolbar-context')
  Expect(markup).toContain('studio-toolbar-mode')
  Expect(markup).toContain('studio-toolbar-actions')
  Expect(markup).toContain('studio-window-controls')
  Expect(markup).toContain('<select class="studio-project studio-picker"')
  Expect(markup).not.toContain('<button class="studio-project studio-picker"')
  Expect(markup).toContain('aria-label="Environment and scenario"')
  Expect(markup).toContain('aria-label="Layout, style, data, and actions"')
  Expect(markup).toContain('studio-scenario-inspector-content')
  Expect(markup).toContain('studio-global-loading')
  Expect(markup).toContain('class="studio-beta-ship"')
  Expect(markup).toContain('class="studio-ship-overlay"')
  Expect(markup).toContain('aria-label="Beta ship progress"')
  Expect(markup).toContain('data-drawer-tab="Problems"')
  Expect(markup).toContain('aria-label="Collapse inspector"')
  Expect(markup).toContain('aria-label="Collapse bottom drawer"')
  Expect(markup).toContain('aria-label="Resize code and preview"')
  Expect(markup.indexOf('studio-inspector studio-pane-right')).toBeLessThan(markup.indexOf('studio-editor-pane'))
  Expect(markup.indexOf('studio-editor-pane')).toBeLessThan(markup.indexOf('studio-preview'))
  Expect(markup.indexOf('studio-editor-pane')).toBeLessThan(markup.indexOf('studio-divider-preview'))
  Expect(markup.indexOf('studio-divider-preview')).toBeLessThan(markup.indexOf('studio-preview'))
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
      '\u001b[31mFAIL runtime-toolchain-tests/tao-test-command.jest.tsx\u001b[0m',
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
      { kind: 'view', subjectId: 'view:StoryRow', viewName: 'StoryRow' },
      { kind: 'view', subjectId: 'view:CommentRow', viewName: 'CommentRow' },
    ],
  } as unknown as Pick<StudioPreviewManifestV2, 'scenarios' | 'subjects'>
  const groupId = (group: string): string => StudioScenarioControls.groupId('/Garden.tao', group)

  Expect(StudioMatrixLayout.subjectView(manifest, groupId('states'))).toBe('StoryRow')
  Expect(StudioMatrixLayout.subjectView(manifest, groupId('devices'))).toBeUndefined()
  Expect(StudioMatrixLayout.subjectView(manifest, groupId('mixed'))).toBeUndefined()
  const groups = ['states', 'devices', 'mixed'].map(group => ({
    subjectView: StudioMatrixLayout.subjectView(manifest, groupId(group)),
  }))
  Expect(StudioMatrixLayout.focusable(groups, 'StoryRow')).toBe(true)
  Expect(StudioMatrixLayout.focusable(groups, 'CommentRow')).toBe(false)
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
  await handlePreviewMessage(
    {
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
    } as MessageEvent,
    previews[1]!,
    handshake,
    async () => ({
      editor: {
        dispatch() {},
        focus() {},
        state: { doc: { length: 40 } },
      } as unknown as EditorView,
      file: { content: 'view Main() {}', path: 'Garden.tao', sourceVersion: 'source-2' },
    }),
    {
      activate: () => active.activate(previews[1]!),
      async applySourceAction() {},
      inspect(selection) {
        selected = selection
      },
    },
  )

  Expect(selected).toMatchObject({
    identity: {
      occurrence: { nodeKind: 'render', renderOwner: 'Main' },
      scenarioId: 'second',
    },
  })
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

Test('Studio runtime failures activate their cell and retain a replay with Studio environment state', async () => {
  const previewWindow = {}
  const preview = previewConnection('preview-failure', 'first', previewWindow)
  preview.cell = cell('first')
  const active = new StudioActivePreview([preview])
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
      activate: () => active.activate(preview),
      async applySourceAction() {},
      inspect() {},
    },
  )

  Expect(active.current()).toBe(preview)
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
