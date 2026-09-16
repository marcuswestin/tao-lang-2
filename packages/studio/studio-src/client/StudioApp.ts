/**
 * StudioApp mounts the imperative workbench shell and wires its parts together. Each part under
 * `./app/` owns its own state behind an explicit dependency object; this file is the one place that
 * knows how they connect, which is also why the Tao product host's action table lives here.
 */
import { Assert, Errors } from '@shared/core'
import { StudioInspector, studioPaletteComponents } from '../StudioInspector'
import { StudioPanelPayloads } from '../StudioPanelPayloads'
import {
  publishStudioProductHostState,
  registerStudioProductHostActions,
} from '../StudioProductHostProtocol'
import type { StudioDebugCommandMessage } from '../StudioProtocol'
import { mountStudioAgentChat } from './app/StudioAgentPanelWiring'
import { StudioAppNavigation } from './app/StudioAppNavigation'
import { mountStudioBetaShip } from './app/StudioBetaShip'
import { mountStudioCanvasFocus } from './app/StudioCanvasFocus'
import { mountStudioCommandPalette } from './app/StudioCommandPaletteWiring'
import { connectStudioEvents, StudioCompileStatus, StudioStatusLine } from './app/StudioCompileEvents'
import { StudioDrawerPanels } from './app/StudioDrawerPanels'
import { StudioEditorSession } from './app/StudioEditorSession'
import { StudioInspection } from './app/StudioInspection'
import { StudioMountSignal } from './app/StudioMountSignal'
import { mountStudioPreviewReload, StudioPreviewNotice } from './app/StudioPreviewStatus'
import { connectStudioPreviewMessages, wireStudioPreviews } from './app/StudioPreviewWiring'
import { publishStudioHostSnapshot } from './app/StudioProductHostState'
import { StudioProjectSearch } from './app/StudioProjectSearch'
import { StudioScenarioActions } from './app/StudioScenarioActions'
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
  postDebugCommand,
  postEditorSelection,
  refreshCellPreviews,
  StudioActivePreview,
  StudioDebugEvents,
  StudioMatrixView,
} from './StudioMatrixView'
import type { StudioDrawerTab } from './StudioProductPanels'
import { StudioRailPanels } from './StudioRailPanels'
import { createStudioShell, type StudioClientConfig, StudioWorkbenchState } from './StudioShell'
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
  const { signal } = options
  // The tabs' EditorViews are document models; the editor a person sees is the one Tao mounts.
  const focusVisibleEditor = (): void => root.querySelector<HTMLElement>('.studio-editor .cm-content')?.focus()
  let partialSession: StudioEditorSession | undefined
  let partialPreviews: Awaited<ReturnType<typeof connectPreviews>> = []
  let partialDevicePanel: ReturnType<typeof createStudioDevicePanel> | undefined
  try {
    StudioMountSignal.throwIfAborted(signal)
    const handshake = await StudioApiClient.handshake(signal)
    StudioMountSignal.throwIfAborted(signal)
    const openCompileDiagnostic = (diagnostic: StudioCompileDiagnostic): void =>
      void navigation.openCompileDiagnostic(diagnostic)
    StudioStatusLine.update(view.status, handshake.compile, openCompileDiagnostic)
    const previews = await connectPreviews(view.preview, config.previewUrl, handshake, signal)
    partialPreviews = previews
    StudioMountSignal.throwIfAborted(signal)
    const cellStorageKey = `tao-studio:active-cell:${handshake.identity.project}:${handshake.identity.appName}`
    let initialCellId: string | undefined
    try {
      initialCellId = window.localStorage.getItem(cellStorageKey) ?? undefined
    } catch {}
    const activePreview = new StudioActivePreview(previews, {
      initialCellId,
      onActivate: preview => {
        const id = preview.cell?.cellId ?? preview.cellIdentity?.cellId
        if (id !== undefined) {
          try {
            window.localStorage.setItem(cellStorageKey, id)
          } catch {}
        }
      },
    })
    configureInteractionMode(view.interactionMode, previews, handshake)
    const devicePanel = createStudioDevicePanel({
      api: StudioApiClient,
      button: view.device,
      handshake,
      popover: view.devicePopover,
    })
    partialDevicePanel = devicePanel
    void StudioApiClient.deviceStatus(signal).then(status => devicePanel.setStatus(status)).catch(error => {
      if (!StudioMountSignal.isAbortError(error)) {
        devicePanel.setGatewayUnavailable(StudioDevicePanelModel.gatewayUnavailableMessage(error))
      }
    })

    const project = handshake.identity.project
    let compileState = handshake.compile
    let projectFiles: readonly StudioFile[] = handshake.files
    let previewManifest = handshake.previewManifest
    let fileTree: ReturnType<typeof mountStudioFileTree> | undefined

    const publish = (): void =>
      publishStudioHostSnapshot({
        activeFile: session.activeFile(),
        activePath: session.activePath(),
        canUndo: mutations.canUndo(),
        compile: compileState,
        data: drawer.data(),
        drawerTab: drawer.tab(),
        editor: session.editor(),
        inspected: inspection.selected(),
        inspection: inspection.inspection(),
        journeyBusy: preview => scenarios.journeyBusy(preview),
        preview: activePreview.current(),
        project,
        projectFiles,
        searchResults: search.results(),
        sourceActionBusy: mutations.busy(),
        tests: drawer.tests(),
      })
    const renderInspector = (): void => inspection.render()

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
      onDocumentChanged: () => search.scheduleIfActive(),
      openCompileDiagnostic,
      postSelection: (file, editor) => postEditorSelection(activePreview.current(), handshake, file, editor),
      publish,
      renderInspector,
      signal,
      view,
    }, projectFiles)
    partialSession = session
    const inspection = new StudioInspection({ active: () => session.active(), project, publish, view })
    const drawer = new StudioDrawerPanels({ activePreview, handshake, render: publish, tabs: view.drawerTabs })
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
      previewManifest: () => previewManifest,
      previews,
      project,
      projectFiles: () => projectFiles,
      refreshSearch: () => search.schedule(0),
      status: view.status,
    })
    const requireAllTabsSaved = (message: string): boolean => session.requireAllSaved(message)

    const betaShip = mountStudioBetaShip({ appName: handshake.identity.appName, requireAllTabsSaved, view })
    mountStudioAgentChat(root, (path, refresh) => session.openFile(path, refresh))
    void drawer.loadTestStatus()

    const previewWiring = {
      activePreview,
      drawer,
      handshake,
      inspection,
      mutations,
      preview: view.preview,
      previews,
      publish,
      session,
      status: view.status,
    }
    const wirePreview = wireStudioPreviews(previewWiring)
    publish()
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
        devicePanel.setStatus(status)
        void navigation.revealDeviceSelection(status.selection)
      },
      onFiles(files) {
        fileTree?.setFiles(files)
      },
      onManifest(manifest) {
        previewManifest = manifest
        devicePanel.setManifest(manifest)
        if (config.previewUrl !== undefined) {
          void refreshCellPreviews(view.preview, previews, config.previewUrl, manifest, handshake).then(() => {
            activePreview.reconcile(wirePreview)
            previewNotice.render()
            previewNotice.checkBundle()
          }).catch(error => {
            view.status.dataset['state'] = 'error'
            view.status.textContent = Errors.messageOf(error)
          })
        }
        commands.render()
        drawer.loadDataIfVisible()
      },
      onSketchCatalog(catalog) {
        StudioMatrixView.renderSketches(view.preview, project, catalog)
      },
    })
    // The preview area is a canvas before it is a list: zoom and pan come up before anything is
    // selected, so the whole app can be seen at once and one view brought close.
    mountCanvasViewport({ host: view.preview })
    const canvasFocus = mountStudioCanvasFocus({
      button: view.canvasFocus,
      onError: error => showSourceActionError(view.status, error),
      ownerFrame: candidate => {
        const owner = inspection.inspection()?.owner
        return owner?.view === candidate ? owner.rect : undefined
      },
      preview: view.preview,
      previews: () => previews,
      selectedOwner: () => inspection.selectedOwner(),
      status: view.status,
    })
    mountStudioPreviewReload(
      view.reload,
      view.status,
      previews,
      () => StudioStatusLine.update(view.status, compileState, openCompileDiagnostic),
    )
    const disconnectPreviewMessages = connectStudioPreviewMessages({
      ...previewWiring,
      onInspected: () => canvasFocus.update(),
    })
    const keydownListener = (event: KeyboardEvent): void => {
      if (isStudioSaveShortcut(event)) {
        event.preventDefault()
        void session.saveActive()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        commands.toggle()
      } else if (event.key === 'Escape' && !view.commandOverlay.hidden) {
        commands.close()
      }
    }
    window.addEventListener('keydown', keydownListener, { capture: true })
    const beforeUnloadListener = (event: BeforeUnloadEvent): void => {
      if (betaShip.active() || session.hasDirtyTabs()) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnloadListener)
    const unregisterProductHost = registerStudioProductHostActions({
      async applyInspectorAction(action, proposed) {
        const inspected = inspection.selected()
        Assert.input(inspected, 'Select a rendered element before editing its source.')
        if (proposed) {
          await mutations.submitProposedLocal(action, inspected.identity)
        } else {
          await mutations.submitLocal(action, inspected.identity)
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
      async moveGeneratedSource(path, sourceVersion, initialTargetPackage) {
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
        if (name.startsWith('scenario-')) {
          await scenarios.execute(name, payload)
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
    let disposed = false
    const cleanup = (): void => {
      if (disposed) {
        return
      }
      disposed = true
      unregisterProductHost()
      publishStudioProductHostState({})
      disconnectEvents()
      window.removeEventListener('keydown', keydownListener, { capture: true })
      window.removeEventListener('beforeunload', beforeUnloadListener)
      betaShip.dispose()
      devicePanel.dispose()
      disconnectPreviewMessages()
      search.dispose()
      drawer.dispose()
      session.dispose()
      disconnectPreviews(previews)
    }
    return cleanup
  } catch (error) {
    partialSession?.dispose()
    partialDevicePanel?.dispose()
    disconnectPreviews(partialPreviews)
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
