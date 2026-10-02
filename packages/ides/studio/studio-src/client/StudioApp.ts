import { applyCanvasViewport, isStudioTypingTarget } from './matrix/StudioCanvasViewport'
import { StudioDrawLiveCells } from './matrix/StudioDrawLiveCells'
import { mountFeedDropOverlay } from './matrix/StudioFeedDropOverlays'
import { StudioMatrixSketches } from './matrix/StudioMatrixSketches'
import { mountPreviewActivation } from './matrix/StudioPreviewActivation'
import { StudioFeedController } from './StudioFeedController'
/**
 * StudioApp mounts the imperative workbench shell and wires its parts together. Each part under
 * `./app/` owns its own state behind an explicit dependency object; this file is the one place that
 * knows how they connect, which is also why the Tao product host's action table lives here.
 */
import { Assert, Errors } from '@shared/core'
import type { StudioDeviceLog, StudioDeviceStatus } from '../device/StudioDeviceStatus'
import { StudioInspector, studioPaletteComponents } from '../StudioInspector'
import { StudioPanelPayloads } from '../StudioPanelPayloads'
import {
  publishStudioProductHostState,
  registerStudioProductHostActions,
} from '../StudioProductHostProtocol'
import type {
  StudioDebugCommandMessage,
  StudioPreviewCanvasGestureMessage,
  StudioPreviewCanvasPanKeyMessage,
} from '../StudioProtocol'
import { mountStudioAgentChat } from './app/StudioAgentPanelWiring'
import { StudioAppNavigation } from './app/StudioAppNavigation'
import { mountStudioBetaShip } from './app/StudioBetaShip'
import { mountStudioCanvasFocus } from './app/StudioCanvasFocus'
import { StudioCanvasPersistence } from './app/StudioCanvasPersistence'
import { studioCanvasSelectionBounds } from './app/StudioCanvasTargets'
import { isStudioCommandPaletteShortcut, mountStudioCommandPalette } from './app/StudioCommandPaletteWiring'
import { connectStudioEvents, StudioCompileStatus, StudioStatusLine } from './app/StudioCompileEvents'
import { StudioDrawerPanels } from './app/StudioDrawerPanels'
import { mountStudioEditLog } from './app/StudioEditLog'
import { StudioEditorSession } from './app/StudioEditorSession'
import { StudioInspection } from './app/StudioInspection'
import { StudioMountLifetime } from './app/StudioMountLifetime'
import { StudioMountSignal } from './app/StudioMountSignal'
import { mountStudioBrowserLaunch, mountStudioPreviewReload, StudioPreviewNotice } from './app/StudioPreviewStatus'
import {
  connectStudioPreviewMessages,
  forwardPreviewCanvasGesture,
  wireStudioPreviews,
} from './app/StudioPreviewWiring'
import { publishStudioHostSnapshot } from './app/StudioProductHostState'
import { StudioProjectSearch } from './app/StudioProjectSearch'
import { StudioScenarioActions } from './app/StudioScenarioActions'
import { createStudioSelectionCarry } from './app/StudioSelectionCarry'
import {
  isStudioSelectionCommand,
  studioCanvasCommandAllowed,
  studioCanvasKeyCommand,
  studioNameNewView,
  studioSelectionAction,
  type StudioSelectionCommand,
} from './app/StudioSelectionGrouping'
import { mountStudioSelectionHud } from './app/StudioSelectionHud'
import { configureStudioSessionPickers } from './app/StudioSessionPickers'
import { StudioSourceMutations } from './app/StudioSourceMutations'
import {
  StudioApiClient,
  StudioApiError,
  type StudioCompileDiagnostic,
  type StudioFile,
} from './StudioApiClient'
import { createStudioDevicePanel, StudioDevicePanelModel } from './StudioDevicePanel'
import { StudioDialog } from './StudioDialog'
import { isStudioSaveShortcut } from './StudioEditor'
import { mountStudioFileTree, StudioFileTreeTransitions } from './StudioFileTree'
import {
  configureInteractionMode,
  connectPreviews,
  currentSourceIdentity,
  disconnectPreviews,
  mountCanvasViewport,
  postCanvasGestureOwnership,
  postDebugCommand,
  postEditorSelection,
  refreshCellPreviews,
  StudioActivePreview,
  StudioDebugEvents,
  StudioFastDraw,
  StudioMatrixView,
} from './StudioMatrixView'
import type { StudioDrawerTab } from './StudioProductPanels'
import { StudioRailPanels } from './StudioRailPanels'
import {
  createStudioShell,
  type StudioClientConfig,
  studioLayoutOwnsCanvasGestures,
  studioLayoutPresetChangedEvent,
  StudioWorkbenchState,
} from './StudioShell'
import { showSourceActionError } from './StudioVisualEditing'

export { StudioDraftStatus } from './app/StudioCompileEvents'
export { StudioDataFillCoordinator } from './app/StudioDataFillCoordinator'
export { StudioProjectContext } from './app/StudioProjectContext'
export { parseScenarioPanelCommand } from './app/StudioScenarioPanelCommand'

declare global {
  interface Window {
    TaoStudioConfig?: StudioClientConfig
  }
}

export type StudioMountOptions = Readonly<{ root?: HTMLElement; signal?: AbortSignal }>

export async function mountStudio(options: StudioMountOptions = {}): Promise<() => void> {
  const root = options.root ?? document.querySelector<HTMLElement>('#tao-studio-root')
  if (root === null) {
    Errors.throwUnexpected('Tao Studio root is missing.')
  }

  const config = window.TaoStudioConfig ?? {}
  const view = createStudioShell(root, config)
  const lifetime = new StudioMountLifetime(options.signal)
  const { signal } = lifetime
  lifetime.add(() => view.dispose())
  lifetime.add(StudioDialog.mount({ container: root, signal }))
  // The tabs' EditorViews are document models; the editor a person sees is the one Tao mounts.
  const focusVisibleEditor = (): void => root.querySelector<HTMLElement>('.studio-editor .cm-content')?.focus()
  try {
    StudioMountSignal.throwIfAborted(signal)
    const handshake = await StudioApiClient.handshake(signal)
    StudioMountSignal.throwIfAborted(signal)
    const openCompileDiagnostic = (diagnostic: StudioCompileDiagnostic): void =>
      void navigation.openCompileDiagnostic(diagnostic)
    StudioStatusLine.update(view.status, handshake.compile, openCompileDiagnostic)
    const previews = await connectPreviews(view.preview, config.previewUrl, handshake, signal)
    lifetime.add(() => disconnectPreviews(previews))
    StudioMountSignal.throwIfAborted(signal)
    const cellStorageKey = `tao-studio:active-cell:${handshake.identity.project}:${handshake.identity.appName}`
    let initialCellId: string | undefined
    try {
      initialCellId = window.localStorage.getItem(cellStorageKey) ?? undefined
    } catch {}
    let refreshFeed = (): void => {}
    const activePreview = new StudioActivePreview(previews, {
      initialCellId,
      onActivate: preview => {
        refreshFeed()
        const id = preview.cell?.cellId ?? preview.cellIdentity?.cellId
        if (id !== undefined) {
          try {
            window.localStorage.setItem(cellStorageKey, id)
          } catch {}
        }
      },
    })
    const previewActivation = mountPreviewActivation(view.preview, previews)
    lifetime.add(() => previewActivation.dispose())
    configureInteractionMode(view.interactionMode, previews, handshake)
    let deviceLogs: readonly StudioDeviceLog[] = []
    let deviceLensSamples: NonNullable<StudioDeviceStatus['lensSamples']> = []
    let clearedDeviceSequence = 0
    const receiveDeviceStatus = (status: StudioDeviceStatus): void => {
      if (signal.aborted) {
        return
      }
      const incoming = (status.logs ?? []).filter(log => log.sequence > clearedDeviceSequence)
      if ((incoming.at(-1)?.sequence ?? 0) >= (deviceLogs.at(-1)?.sequence ?? 0)) {
        deviceLogs = incoming
      }
      deviceLensSamples = status.lensSamples ?? []
      devicePanel.setStatus(status)
      drawer.renderIfLogs()
      publish()
    }
    const devicePanel = createStudioDevicePanel({
      api: StudioApiClient,
      button: view.device,
      handshake,
      popover: view.devicePopover,
    })
    lifetime.add(() => devicePanel.dispose())
    void StudioApiClient.deviceStatus(signal).then(receiveDeviceStatus).catch(error => {
      if (!StudioMountSignal.isAbortError(error)) {
        devicePanel.setGatewayUnavailable(StudioDevicePanelModel.gatewayUnavailableMessage(error))
      }
    })

    const project = handshake.identity.project
    let compileState = handshake.compile
    let projectFiles: readonly StudioFile[] = handshake.files
    let previewManifest = handshake.previewManifest
    let fileTree: ReturnType<typeof mountStudioFileTree> | undefined
    let editorRevealRevision = 0
    let editLog: ReturnType<typeof mountStudioEditLog> | undefined
    let selectionHud: ReturnType<typeof mountStudioSelectionHud> | undefined

    const publish = (): void => {
      if (signal.aborted) {
        return
      }
      editLog?.render()
      selectionHud?.render()
      feed.liveChanged()
      StudioMatrixSketches.examples(
        view.preview,
        feed.examples(previewManifest, activePreview.current()?.cell?.scenarioId),
      )
      publishStudioHostSnapshot({
        activeFile: session.activeFile(),
        activePath: session.activePath(),
        canUndo: mutations.canUndo(),
        compile: compileState,
        data: drawer.data(),
        deviceLensSamples,
        deviceLogs,
        drawerTab: drawer.tab(),
        feed: feed.panel(),
        editor: session.editor(),
        inspected: inspection.selected(),
        inspection: inspection.inspection(),
        journeyBusy: preview => scenarios.journeyBusy(preview),
        preview: activePreview.current(),
        project,
        projectFiles,
        revealRevision: editorRevealRevision,
        searchResults: search.results(),
        sourceActionBusy: mutations.busy(),
        tests: drawer.tests(),
      })
    }
    const renderInspector = (): void => inspection.render()
    const advanceEditorReveal = (): void => {
      editorRevealRevision += 1
    }

    const previewNotice = new StudioPreviewNotice({
      compileState: () => compileState,
      preview: view.preview,
      previewUrl: config.previewUrl,
      previews,
      signal,
    })
    const session = new StudioEditorSession({
      compileState: () => compileState,
      identity: handshake.identity,
      onDocumentChanged: () => {
        search.scheduleIfActive()
        // Typing in the code editor supersedes the element a visual edit meant to keep selected.
        selectionCarry.forget()
      },
      onSaved: path => {
        // The file now holds source no visual edit produced, so its edits can no longer walk back.
        mutations.retirePath(path)
        selectionCarry.forget()
        publish()
      },
      openCompileDiagnostic,
      postSelection: (file, editor) => postEditorSelection(activePreview.current(), handshake, file, editor),
      publish,
      renderInspector,
      signal,
      view,
    }, projectFiles)
    lifetime.add(() => session.dispose())
    const inspection = new StudioInspection({ active: () => session.active(), project, publish, view })
    const drawer = new StudioDrawerPanels({ activePreview, handshake, render: publish, tabs: view.drawerTabs })
    lifetime.add(() => drawer.dispose())
    const search = new StudioProjectSearch({
      diagnostics: () => compileState.diagnostics ?? [],
      input: view.searchInput,
      openDocument: path => session.document(path),
      project,
      projectFiles: () => projectFiles,
      publish,
      signal,
      status: view.status,
    })
    lifetime.add(() => search.dispose())
    const mutations = new StudioSourceMutations({
      activeFile: () => session.activeFile(),
      activePath: () => session.activePath(),
      clearInspection: () => inspection.clear(),
      completeCompile: completion =>
        StudioStatusLine.update(
          view.status,
          StudioCompileStatus.completed(completion, compileState),
          openCompileDiagnostic,
        ),
      currentIdentity: () => currentSourceIdentity(handshake, activePreview.current(), session.activeFile()),
      editor: () => session.editor(),
      focusEditor: focusVisibleEditor,
      inspected: () => inspection.selected(),
      openFile: (path, refresh) => session.openFile(path, refresh),
      project,
      publish,
      renderInspector,
      requireActiveDraftSaved: () => session.requireActiveDraftSaved(),
      status: view.status,
    })
    lifetime.add(() => editLog?.dispose())
    editLog = mountStudioEditLog({
      edits: () => mutations.edits(),
      host: view.preview,
      undo: () => void mutations.undoLatest(),
    })
    const feed = new StudioFeedController({
      browse: request => StudioMatrixSketches.runFeed(view.preview, () => StudioApiClient.feedBrowse(request), signal),
      mutate: request =>
        StudioMatrixSketches.runFeed(view.preview, revision => StudioApiClient.feedAction(request(revision)), signal),
      context: () => {
        const cell = activePreview.current()?.cell
        const scenario = previewManifest?.scenarios.find(item => item.scenarioId === cell?.scenarioId)
        const subject = previewManifest?.subjects.find(item => item.subjectId === scenario?.subjectId)
        return {
          activeScenarioId: cell?.scenarioId,
          cellId: cell?.cellId,
          sketchId: subject?.kind === 'view'
            ? StudioMatrixSketches.sketchForView(view.preview, subject.viewName)
            : undefined,
          liveRows: Object.fromEntries(
            drawer.data().result.map(
              table => [table.entity, table.rows.map((fields, index) => ({ fields, key: String(index) }))],
            ),
          ),
        }
      },
      canMutate: () => mutations.canMutate(),
      publish,
      receive: state => {
        for (const file of state.files ?? []) {
          session.applyFileEvent(file)
        }
      },
      requestId: () => crypto.randomUUID(),
    })
    lifetime.add(() => {
      refreshFeed = () => {}
      feed.dispose()
    })
    refreshFeed = () => {
      void feed.refresh()
    }
    const disconnectFeed = StudioMatrixSketches.connectFeed(
      view.preview,
      (payload, sketchId, rectId) => feed.drop(payload, sketchId, rectId),
    )
    lifetime.add(disconnectFeed)
    lifetime.add(StudioMatrixSketches.connectEdits(view.preview, edit => mutations.recordSketchEdit(edit)))
    lifetime.add(StudioDrawLiveCells.connect(view.preview))
    lifetime.add(StudioMatrixSketches.connectInsert(view.preview, async request => {
      // A frame dropped onto a running view renders inside it: the edit names that view's cell and
      // the file and version the cell compiled, whichever file the editor has open.
      const preview = previews.find(candidate => candidate.cell?.cellId === request.cellId)
      if (preview?.cell === undefined || request.source === undefined) {
        view.status.dataset['state'] = 'error'
        view.status.textContent = `Wait for ${request.targetView} to finish compiling, then drop again.`
        return
      }
      // The target cell becomes the active preview, as any cell a visual edit comes from does, so the
      // edit's ⌘Z walks back under that same cell's identity.
      activePreview.activate(preview)
      await mutations.submitPreviewAction(
        { kind: 'insert-project-view', viewName: request.viewName, viewSourcePath: request.viewSourcePath },
        {
          ...handshake.identity,
          ...(preview.cellIdentity ?? {}),
          path: request.source.path,
          previewInstanceId: preview.previewInstanceId,
          scenarioId: preview.cell.scenarioId,
          sourceVersion: request.source.version,
        },
      )
    }))
    const scenarios = new StudioScenarioActions({
      activePreview,
      apply: envelope => mutations.apply(envelope),
      canMutate: () => mutations.canMutate(),
      publish,
      status: view.status,
    })
    const navigation = new StudioAppNavigation({
      activePreview,
      focusEditor: focusVisibleEditor,
      openFile: path => session.openFile(path),
      onReveal: advanceEditorReveal,
      previewManifest: () => previewManifest,
      previews,
      project,
      projectFiles: () => projectFiles,
      refreshSearch: () => search.schedule(0),
      status: view.status,
    })
    const requireAllTabsSaved = (message: string): boolean => session.requireAllSaved(message)

    const betaShip = mountStudioBetaShip({ appName: handshake.identity.appName, requireAllTabsSaved, view })
    lifetime.add(() => betaShip.dispose())
    mountStudioAgentChat(root, (path, refresh) => session.openFile(path, refresh))
    void drawer.loadTestStatus()

    let canvasViewport: ReturnType<typeof mountCanvasViewport> | undefined
    const canvasGesturesOwned = (): boolean => studioLayoutOwnsCanvasGestures(root.dataset['layoutPreset'])
    /** Design and Draw put the canvas first: the keyboard stays there and ⌘Z walks back the edit log. */
    const canvasOwnsInput = (): boolean =>
      root.dataset['layoutPreset'] === 'design' || root.dataset['layoutPreset'] === 'draw'
    /** ⌘G and ⌥⌘G turn the preview selection into a view or a group; a lone element is a group of one. */
    const applySelectionCommand = async (command: StudioSelectionCommand): Promise<void> => {
      const inspected = inspection.selected()
      if (inspected === undefined) {
        view.status.dataset['state'] = 'error'
        view.status.textContent = 'Select elements in the preview before grouping them.'
        return
      }
      const group = inspection.selectedGroup()
      const action = studioSelectionAction(
        command,
        group,
        selection => studioCanvasSelectionBounds(view.preview, selection, previews),
      )
      const named = action.kind === 'extract-view' ? await studioNameNewView(group.length) : action
      if (named === undefined) {
        return
      }
      await mutations.submitLocal(action.kind === 'extract-view' ? { ...action, ...named } : action, inspected.identity)
    }
    const selectionCarry = createStudioSelectionCarry({
      editorTyping: () => document.activeElement?.closest('.studio-editor .cm-content') != null,
      openFile: path => session.openFile(path),
      previews,
      project,
      select: selection => {
        inspection.select(selection)
        publish()
        void inspection.inspect(selection)
      },
    })
    lifetime.add(() => selectionHud?.dispose())
    selectionHud = mountStudioSelectionHud({
      apply: action => {
        const inspected = inspection.selected()
        if (inspected !== undefined) {
          void selectionCarry.track(inspected, action, mutations.submitLocal(action, inspected.identity))
        }
      },
      bounds: () => studioCanvasSelectionBounds(view.preview, inspection.selected(), previews),
      busy: () => mutations.busy(),
      command: command => void applySelectionCommand(command),
      // Edit mode is a request to edit what is clicked, whichever layout frames the canvas.
      enabled: () => canvasOwnsInput() || view.interactionMode.dataset['mode'] === 'edit',
      groupSize: () => inspection.selectedGroup().length,
      host: view.preview,
      inspection: () => inspection.inspection(),
      selectedRenderId: () => inspection.selected()?.renderId,
    })
    const disposeFeedDropOverlay = mountFeedDropOverlay(view.preview, previews, canvasGesturesOwned)
    lifetime.add(disposeFeedDropOverlay)
    const previewWiring = {
      activePreview,
      canvasGesturesOwned,
      drawer,
      handshake,
      inspection,
      mutations,
      onReveal: advanceEditorReveal,
      onCanvasGesture: (preview: (typeof previews)[number], gesture: StudioPreviewCanvasGestureMessage) =>
        forwardPreviewCanvasGesture(canvasViewport, preview, gesture),
      onCanvasPanKey: (preview: (typeof previews)[number], message: StudioPreviewCanvasPanKeyMessage) =>
        canvasViewport?.iframePanKey(message.held, preview.iframe),
      onCanvasShortcut: (
        command: import('../StudioProtocol').StudioPreviewCanvasShortcutMessage['command'],
        iframe: HTMLIFrameElement,
      ) => {
        // A preview in Run or Code still forwards its keys; only the canvas presets act on them.
        if (command === 'undo' || isStudioSelectionCommand(command)) {
          if (!studioCanvasCommandAllowed(command, root.dataset['layoutPreset'])) {
            return
          }
          if (command === 'undo') {
            void mutations.undoLatest()
          } else {
            void applySelectionCommand(command)
          }
          return
        }
        canvasViewport?.iframeShortcut(command, iframe)
      },
      onLayoutMeasured: () => {
        selectionHud?.place()
        void selectionCarry.restore()
      },
      onFeedDrop: async (message: import('../StudioProtocol').StudioPreviewFeedDropMessage) => {
        const target = StudioMatrixSketches.feedTarget(view.preview, message)
        await feed.drop(message.drop, target.sketchId, target.rectId, message.identity.cellId)
      },
      preview: view.preview,
      previews,
      publish,
      session,
      status: view.status,
    }
    const wirePreview = wireStudioPreviews(previewWiring)
    const publishCanvasGestureOwnership = (): void => {
      canvasViewport?.cancelPan()
      previewActivation.clear()
      view.preview.dataset['canvasWorkspace'] = root.dataset['layoutPreset'] === 'draw' ? 'draw' : 'preview'
      applyCanvasViewport(view.preview)
      for (const preview of previews) {
        postCanvasGestureOwnership(preview, handshake, canvasGesturesOwned())
      }
      selectionHud?.render()
    }
    const renderSelectionHud = (): void => selectionHud?.render()
    view.interactionMode.addEventListener('click', renderSelectionHud)
    lifetime.add(() => view.interactionMode.removeEventListener('click', renderSelectionHud))
    root.addEventListener(studioLayoutPresetChangedEvent, publishCanvasGestureOwnership)
    lifetime.add(() => root.removeEventListener(studioLayoutPresetChangedEvent, publishCanvasGestureOwnership))
    // Connects the cells the manifest and the Fast draw switch call for, and drops the rest.
    function replanPreviews(manifest: NonNullable<typeof previewManifest>): void {
      if (config.previewUrl === undefined) {
        return
      }
      void refreshCellPreviews(view.preview, previews, config.previewUrl, manifest, handshake).then(() => {
        activePreview.reconcile(wirePreview)
        previewActivation.reconcile()
        previewNotice.render()
        previewNotice.checkBundle()
      }).catch(error => {
        view.status.dataset['state'] = 'error'
        view.status.textContent = Errors.messageOf(error)
      })
    }
    const renderFastDraw = (): void => {
      view.fastDraw.setAttribute('aria-pressed', String(StudioFastDraw.enabled()))
    }
    const toggleFastDraw = (): void => {
      StudioFastDraw.set(!StudioFastDraw.enabled())
      renderFastDraw()
      if (previewManifest !== undefined) {
        replanPreviews(previewManifest)
      }
    }
    renderFastDraw()
    view.fastDraw.addEventListener('click', toggleFastDraw)
    lifetime.add(() => view.fastDraw.removeEventListener('click', toggleFastDraw))
    publish()
    void feed.refresh()
    view.searchInput.addEventListener('input', () => search.schedule())
    for (const button of view.drawerTabs.querySelectorAll<HTMLButtonElement>('[data-drawer-tab]')) {
      button.addEventListener('click', () => {
        const tab = button.dataset['drawerTab'] as StudioDrawerTab
        drawer.select(tab)
        StudioWorkbenchState.saveDrawerTab(window.localStorage, tab)
      })
    }
    view.rail.addEventListener('click', event => {
      const panel = (event.target as HTMLElement).closest<HTMLElement>('[data-panel]')?.dataset['panel']
      if (panel !== 'agent') {
        drawer.selectRail(panel)
      }
    })
    const activeRailButton = view.rail.querySelector<HTMLButtonElement>('.studio-rail-button[aria-current="true"]')
    if (activeRailButton?.dataset['panel'] !== undefined) {
      drawer.selectRail(activeRailButton.dataset['panel'])
    }
    const initialDrawerTab = StudioWorkbenchState.loadDrawerTab(window.localStorage)
    drawer.select(initialDrawerTab)

    const commands = mountStudioCommandPalette({
      activePreview,
      insertComponent: component => mutations.insertComponent(component),
      insertProjectView: projectView => mutations.insertProjectView(projectView),
      onScenarioActivated: () => {
        drawer.loadDataIfVisible()
        drawer.renderIfLogs()
      },
      openFile: path => session.openFile(path),
      previewManifest: () => previewManifest,
      previews,
      project,
      projectFiles: () => projectFiles,
      selectDrawer: tab => {
        drawer.select(tab)
        StudioWorkbenchState.saveDrawerTab(window.localStorage, tab)
      },
      view,
    })

    function publishProjectFiles(files: readonly StudioFile[]): void {
      const previousFiles = projectFiles
      projectFiles = files
      search.invalidate(files)
      session.reconcileFiles(previousFiles, files)
      commands.render()
      search.scheduleIfActive()
      drawer.loadDataIfVisible()
    }

    fileTree = mountStudioFileTree({
      files: projectFiles,
      onCreated: async result => {
        await session.openFile(StudioFileTreeTransitions.afterCreate(result))
      },
      onDeleted: async result => {
        const { activePath: previousActivePath } = session.consumePreparedMutation()
        const nextPath = StudioFileTreeTransitions.afterDelete(previousActivePath, handshake.entryPath, result)
        if (previousActivePath === result.deleted.path && nextPath !== undefined) {
          await session.openFile(nextPath)
        }
      },
      onFiles: publishProjectFiles,
      onRenamed: async result => {
        const prepared = session.consumePreparedMutation()
        const wasOpen = prepared.openPath === result.previousPath
        const nextPath = StudioFileTreeTransitions.afterRename(prepared.activePath, result)
        if (wasOpen) {
          await session.openFile(result.file.path)
          if (nextPath !== undefined && nextPath !== result.file.path) {
            await session.openFile(nextPath)
          }
        }
      },
      prepareMutation: file =>
        session.prepareMutation(file, () => projectFiles, async () => {
          await fileTree?.refresh()
        }),
    })
    await configureStudioSessionPickers({ handshake, requireAllTabsSaved, signal, view })
    StudioMountSignal.throwIfAborted(signal)
    await session.restore(handshake.entryPath, () => StudioMountSignal.throwIfAborted(signal))
    StudioMountSignal.throwIfAborted(signal)
    const disconnectEvents = connectStudioEvents(view.status, openCompileDiagnostic, {
      onCompile(state) {
        compileState = state
        previewNotice.render()
        devicePanel.setCompileState(state)
        publish()
        search.scheduleIfActive()
        if (state.status !== 'compiling') {
          void fileTree?.refresh().catch(error => showSourceActionError(view.status, error))
        }
        drawer.loadDataIfVisible()
        if (drawer.testWatch() && state.status === 'compiled') {
          void drawer.runTests()
        }
      },
      onFile(file) {
        const found = projectFiles.some(candidate => candidate.path === file.path)
        fileTree?.setFiles(
          found
            ? projectFiles.map(candidate => candidate.path === file.path ? file : candidate)
            : [...projectFiles, file],
        )
        session.applyFileEvent(file)
        drawer.loadDataIfVisible()
      },
      onDeviceState(status) {
        receiveDeviceStatus(status)
        void navigation.revealDeviceSelection(status.selection)
      },
      onFiles(files) {
        fileTree?.setFiles(files)
      },
      onManifest(manifest) {
        const previousCompileRevision = previewManifest?.compileRevision
        previewManifest = manifest
        if (previousCompileRevision !== manifest.compileRevision) {
          void feed.refresh()
        }
        publish()
        devicePanel.setManifest(manifest)
        // A render card whose scenario entry left the manifest is marked broken on the next catalog read.
        void StudioMatrixView.refreshSketches(view.preview, project).catch(error => {
          view.status.dataset['state'] = 'error'
          view.status.textContent = Errors.messageOf(error)
        })
        replanPreviews(manifest)
        commands.render()
        drawer.loadDataIfVisible()
      },
      onSketchCatalog(catalog) {
        StudioMatrixView.renderSketches(view.preview, project, catalog)
      },
    })
    lifetime.add(disconnectEvents)
    // The preview area is a canvas before it is a list: zoom and pan come up before anything is
    // selected, so the whole app can be seen at once and one view brought close.
    const canvasPersistence = new StudioCanvasPersistence({
      clientId: crypto.randomUUID(),
      save: (request, keepalive) => StudioApiClient.saveCanvasViewport(request, keepalive),
      onError: error => showSourceActionError(view.status, error),
    })
    lifetime.add(() => canvasPersistence.dispose())
    const flushCanvas = (): void => {
      void canvasPersistence.flush(true)
    }
    const onCanvasVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        flushCanvas()
      }
    }
    window.addEventListener('pagehide', flushCanvas)
    lifetime.add(() => window.removeEventListener('pagehide', flushCanvas))
    document.addEventListener('visibilitychange', onCanvasVisibility)
    lifetime.add(() => document.removeEventListener('visibilitychange', onCanvasVisibility))
    canvasViewport = mountCanvasViewport({
      enabled: canvasOwnsInput,
      canPanWithoutSpace: event =>
        root.dataset['layoutPreset'] === 'design'
        && previewActivation.canPanWithoutSpace(event),
      host: view.preview,
      initialState: handshake.canvasViewport,
      onChange: next => {
        canvasPersistence.changed(next)
        selectionHud?.place()
      },
      onGestureEnd: () => {
        void canvasPersistence.flush()
      },
      selectionBounds: () => studioCanvasSelectionBounds(view.preview, inspection.selected(), previews),
      focusedBounds: () => {
        const focused = StudioMatrixView.focusedView(view.preview)
        return focused === undefined
          ? undefined
          : [...view.preview.querySelectorAll<HTMLElement>('[data-tao-studio-group-view-id]')]
            .find(group => group.dataset['taoStudioGroupViewId'] === focused)?.getBoundingClientRect()
      },
    })
    lifetime.add(() => canvasViewport?.dispose())
    publishCanvasGestureOwnership()
    const canvasFocus = mountStudioCanvasFocus({
      button: view.canvasFocus,
      onError: error => showSourceActionError(view.status, error),
      onFocused: viewId => void navigation.showView(viewId).catch(error => showSourceActionError(view.status, error)),
      ownerFrame: candidate => {
        const owner = inspection.inspection()?.owner
        return inspection.selectedOwnerIdentity()?.id === candidate ? owner?.rect : undefined
      },
      preview: view.preview,
      previews: () => previews,
      selectedOwner: () => inspection.selectedOwnerIdentity(),
      status: view.status,
    })
    lifetime.add(() => canvasFocus.dispose())
    const disposeBrowserLaunch = mountStudioBrowserLaunch({
      available: config.previewUrl !== undefined,
      button: view.browser,
      onError: error => showSourceActionError(view.status, error),
      open: () => StudioApiClient.browserOpen(),
      status: view.status,
    })
    lifetime.add(disposeBrowserLaunch)
    mountStudioPreviewReload(
      view.reload,
      view.status,
      previews,
      () => StudioStatusLine.update(view.status, compileState, openCompileDiagnostic),
    )
    const disconnectPreviewMessages = connectStudioPreviewMessages({
      ...previewWiring,
      canvasOwnsInput,
      onInspected: () => {
        selectionCarry.forget()
        canvasFocus.update()
      },
    })
    lifetime.add(disconnectPreviewMessages)
    const keydownListener = (event: KeyboardEvent): void => {
      if (isStudioSaveShortcut(event)) {
        event.preventDefault()
        void session.saveActive()
      } else if (isStudioCommandPaletteShortcut(event)) {
        event.preventDefault()
        commands.toggle()
      } else if (event.key === 'Escape' && !view.commandOverlay.hidden) {
        commands.close()
      } else {
        const command = studioCanvasKeyCommand(event, {
          canUndo: mutations.canUndo(),
          hasSelection: inspection.selected() !== undefined,
          preset: root.dataset['layoutPreset'],
          typing: isStudioTypingTarget(event.target),
        })
        if (command !== undefined) {
          event.preventDefault()
          if (command === 'undo') {
            void mutations.undoLatest()
          } else {
            void applySelectionCommand(command)
          }
        }
      }
    }
    window.addEventListener('keydown', keydownListener, { capture: true })
    lifetime.add(() => window.removeEventListener('keydown', keydownListener, { capture: true }))
    const beforeUnloadListener = (event: BeforeUnloadEvent): void => {
      if (betaShip.active() || session.hasDirtyTabs()) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnloadListener)
    lifetime.add(() => window.removeEventListener('beforeunload', beforeUnloadListener))
    const unregisterProductHost = registerStudioProductHostActions({
      async applyInspectorAction(requested, proposed) {
        const inspected = inspection.selected()
        Assert.input(inspected, 'Select a rendered element before editing its source.')
        // Make view acts on everything shift-selected, not just the element the inspector shows.
        const group = inspection.selectedGroup()
        const named = requested.kind === 'extract-view' && requested['name'] === undefined
          ? await studioNameNewView(group.length)
          : {}
        if (named === undefined) {
          return
        }
        const action = requested.kind === 'extract-view'
          ? { ...requested, ...named, renderIds: group.map(selection => selection.renderId) }
          : requested
        if (proposed) {
          await mutations.submitProposedLocal(action, inspected.identity)
        } else {
          const applied = mutations.submitLocal(action, inspected.identity)
          void selectionCarry.track(inspected, action, applied)
          await applied
        }
      },
      async applyActiveCellEnvironment(identity, environment) {
        const preview = activePreview.current()
        if (preview?.cell === undefined || preview.reconfigureEnvironment === undefined) {
          Errors.throwUserInput('Select a Studio scenario cell before changing its environment.')
        }
        if (preview.cell.cellId !== identity.cellId || preview.cell.cellRevision !== identity.cellRevision) {
          throw new StudioApiError('The selected Studio preview changed while its environment was being edited.', 409, {
            actualCellId: preview.cell.cellId,
            actualCellRevision: preview.cell.cellRevision,
            code: 'stale-cell',
            expectedCellId: identity.cellId,
            expectedCellRevision: identity.cellRevision,
          })
        }
        await preview.reconfigureEnvironment({
          network: environment.network,
          scheme: preview.cell.environment.scheme,
          viewport: environment.viewport,
        })
      },
      changeActiveFile(content, selection) {
        session.replaceActiveContent(content, selection)
      },
      async createFile(path) {
        await fileTree!.create(path)
      },
      async deleteFile(path, sourceVersion) {
        await fileTree!.delete(path, sourceVersion)
      },
      insertComponent(componentName) {
        const component = studioPaletteComponents.find(candidate => candidate.component === componentName)
        Assert.input(component, `Tao Studio does not expose the component ${componentName}.`)
        mutations.insertComponent(component)
      },
      insertProjectView(viewName) {
        const projectView = StudioInspector.projectViews(previewManifest).find(candidate =>
          candidate.viewName === viewName
        )
        Assert.input(projectView, `Tao Studio project view is no longer available: ${viewName}`)
        mutations.insertProjectView(projectView)
      },
      async moveGeneratedSource(path, sourceVersion, initialTargetPackage, relocateScenarios = true) {
        const selected = projectFiles.find(file => file.path === path && file.sourceVersion === sourceVersion)
        Assert.input(selected, `Tao Studio generated source is no longer current: ${path}`)
        const current = await session.prepareMutation(selected, () => projectFiles, async () => {
          await fileTree?.refresh()
        })
        if (current === undefined) {
          return
        }
        let targetPackage = initialTargetPackage
        while (true) {
          const result = await StudioApiClient.moveGeneratedSource({
            path: current.path,
            sourceVersion: current.sourceVersion,
            targetPackage,
            relocateScenarios,
            writeId: `move-generated-${crypto.randomUUID()}`,
          })
          if (result.status === 'confirmation-required') {
            const replacement = await StudioDialog.prompt({
              confirmLabel: 'Move',
              detail: `${result.targetPackage} already declares ${result.name} in ${result.conflicts.join(', ')}.`,
              initialValue: targetPackage,
              placeholder: '@views',
              title: 'Choose a different package',
            })
            if (replacement === undefined) {
              return
            }
            targetPackage = replacement
            continue
          }
          const wasOpen = session.consumePreparedMutation().openPath === result.previousPath
          fileTree!.setFiles(result.files)
          if (wasOpen) {
            await session.openFile(result.file.path)
          }
          return
        }
      },
      async openFile(path) {
        Assert.input(
          projectFiles.some(file => file.path === path),
          `Tao Studio file is no longer available: ${path}`,
        )
        await session.openFile(path)
      },
      async openScreen(subjectId) {
        const screen = StudioRailPanels.screens(previewManifest).find(candidate => candidate.id === subjectId)
        Assert.input(screen, `Tao Studio screen is no longer available: ${subjectId}`)
        await navigation.openScreen(screen)
      },
      async openSource(path, sourceVersion, start) {
        await navigation.openSource(path, sourceVersion, start)
      },
      async productPanelAction(name, payload) {
        if (name === 'feed-action') {
          await feed.execute(payload)
          return
        }
        if (name.startsWith('scenario-')) {
          await scenarios.execute(name, payload)
          await feed.refresh()
          return
        }
        if (name === 'capture-fixture') {
          scenarios.focusCaptureFixture()
          return
        }
        if (name.startsWith('debug-')) {
          const preview = activePreview.current()
          if (preview === undefined) {
            Errors.throwUserInput('Select a connected preview cell before using the debugger.')
          }
          if (name === 'debug-clear') {
            preview.debug = StudioDebugEvents.empty()
            publish()
            return
          }
          postDebugCommand(preview, handshake, debugCommandOf(name))
          return
        }
        if (name === 'clear-logs') {
          const preview = activePreview.current()
          if (preview !== undefined) {
            preview.runtimeLogs = []
          }
          clearedDeviceSequence = Math.max(clearedDeviceSequence, ...deviceLogs.map(log => log.sequence))
          deviceLogs = []
          publish()
          return
        }
        if (name === 'open-diagnostic') {
          await navigation.openCompileDiagnostic(StudioPanelPayloads.compileDiagnostic(payload))
          return
        }
        if (name === 'refresh-data') {
          await drawer.loadData()
          return
        }
        if (name === 'run-tests') {
          await drawer.runTests()
          return
        }
        if (name === 'open-test-failure') {
          await navigation.openTestFailure(StudioPanelPayloads.testFailure(payload))
          return
        }
        if (name === 'test-watch') {
          const watch = JSON.parse(payload) as unknown
          if (typeof watch !== 'boolean') {
            Errors.throwUserInput('Tao Studio test-watch actions require a boolean payload.')
          }
          await drawer.setTestWatch(watch)
          return
        }
        if (name === 'open-search-result') {
          await navigation.openSearchResult(StudioPanelPayloads.searchResult(payload))
          return
        }
        Errors.throwUserInput(`Unsupported Tao Studio panel action: ${name}`)
      },
      async renameFile(path, sourceVersion, targetPath) {
        await fileTree!.rename(path, sourceVersion, targetPath)
      },
      selectActiveFile(anchor, head) {
        const active = session.active()
        if (active === undefined) {
          return
        }
        const { editor } = active
        const safeAnchor = Math.min(anchor, editor.state.doc.length)
        const safeHead = Math.min(head, editor.state.doc.length)
        if (editor.state.selection.main.anchor !== safeAnchor || editor.state.selection.main.head !== safeHead) {
          editor.dispatch({ selection: { anchor: safeAnchor, head: safeHead } })
        }
        postEditorSelection(activePreview.current(), handshake, active.file, editor)
      },
      async undoInspectorAction() {
        await mutations.undoLatest()
      },
    })
    lifetime.add(() => {
      unregisterProductHost()
      publishStudioProductHostState({})
    })
    return lifetime.dispose
  } catch (error) {
    lifetime.dispose()
    if (!StudioMountSignal.isAbortError(error)) {
      view.status.dataset['state'] = 'error'
      view.status.textContent = Errors.messageOf(error)
    }
    throw error
  }
}

/** The Debug panel names its buttons in panel-action spelling; the preview knows protocol spelling. */
function debugCommandOf(name: string): StudioDebugCommandMessage['command'] {
  const commands: Record<string, StudioDebugCommandMessage['command']> = {
    'debug-break': 'break',
    'debug-continue': 'continue',
    'debug-step-into': 'step-into',
    'debug-step-out': 'step-out',
    'debug-step-over': 'step-over',
  }
  const command = commands[name]
  if (command === undefined) {
    Errors.throwUserInput(`Unsupported Tao Studio debugger action: ${name}`)
  }
  return command
}
