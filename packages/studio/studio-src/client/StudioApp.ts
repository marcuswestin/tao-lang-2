import { Assert, Errors } from '@shared/core'
import type { StudioRenderInspection } from '@source-actions'
import { EditorView } from 'codemirror'
import { mountStudioAgentPanel } from '../agent-chat/StudioAgentPanel'
import type { StudioDeviceStatus } from '../device/StudioDeviceStatus'
import type { StudioCompileCompletion } from '../StudioCompileCoordinator'
import { type StudioDraftFile, StudioDraftSync, type StudioDraftSyncResult } from '../StudioDraftSync'
import {
  StudioInspector,
  type StudioInspectorSelection,
  studioPaletteComponents,
} from '../StudioInspector'
import { StudioPanelPayloads } from '../StudioPanelPayloads'
import type { StudioPreviewManifestV2 } from '../StudioPreviewManifest'
import {
  publishStudioProductHostState,
  registerStudioProductHostActions,
} from '../StudioProductHostProtocol'
import {
  type StudioCanonicalSourceAction,
  type StudioJsonObject,
  type StudioSourceActionEnvelope,
  type StudioSourceActionIdentity,
} from '../StudioProtocol'
import type { StudioTestFailure, StudioTestStatus } from '../StudioTestRunner'
import { StudioTextMateLanguage } from '../StudioTextMateLanguage'
import {
  StudioApiClient,
  StudioApiError,
  StudioApiRoutes,
  type StudioCompileDiagnostic,
  type StudioCompileState,
  type StudioFile,
} from './StudioApiClient'
import { createStudioDevicePanel, StudioDevicePanelModel } from './StudioDevicePanel'
import {
  absoluteSourcePath,
  isStudioSaveShortcut,
  projectRelativePath,
  StudioCodeEditor,
  StudioDiagnosticNavigation,
  StudioEditorInsertion,
  StudioOpenFileLifecycle,
  StudioSourceNavigation,
} from './StudioEditor'
import { StudioEditorTabs } from './StudioEditorTabs'
import { mountStudioFileTree, StudioFileTreeTransitions } from './StudioFileTree'
import {
  configureInteractionMode,
  connectPreviews,
  currentSourceIdentity,
  disconnectPreviews,
  handlePreviewMessage,
  postEditorSelection,
  previewBundleNoticeFor,
  previewNoticeFor,
  refreshCellPreviews,
  requestRuntimeCapture,
  StudioActivePreview,
  studioPreviewNotice,
  StudioPreviewSourceSync,
  StudioRuntimeData,
  type StudioRuntimeDataTable,
} from './StudioMatrixView'
import { StudioPanelProjection } from './StudioPanelProjection'
import {
  renderCommandResults,
  type StudioCommandItem,
  StudioCommandPalette,
  type StudioDrawerTab,
} from './StudioProductPanels'
import {
  StudioRailPanels,
  type StudioScreenItem,
  type StudioSearchResult,
} from './StudioRailPanels'
import { StudioScenarioControls } from './StudioScenarioControls'
import {
  createStudioShell,
  showOpenFile,
  type StudioClientConfig,
} from './StudioShell'
import {
  showSourceActionError,
  sourceActionLabel,
  studioPaletteMime,
  StudioPaletteTransfer,
} from './StudioVisualEditing'

type StudioOpenFile = {
  editor: EditorView
  file: StudioDraftFile
}

type StudioOpenEditorTab = StudioOpenFile & {
  dirty: boolean
  draft: StudioDraftSync
  stale: boolean
}

declare global {
  interface Window {
    TaoStudioConfig?: StudioClientConfig
  }
}

/** Coalesces a burst of invalidations into one current fill after any in-flight fill. */
export class StudioDataFillCoordinator {
  #completedRevision = 0
  #requestedRevision = 0
  #running: Promise<void> | undefined
  readonly #fill: (isLatest: () => boolean) => Promise<void>

  constructor(fill: (isLatest: () => boolean) => Promise<void>) {
    this.#fill = fill
  }

  request(): Promise<void> {
    this.#requestedRevision += 1
    this.#running ??= this.#drain()
    return this.#running
  }

  async #drain(): Promise<void> {
    try {
      while (this.#completedRevision < this.#requestedRevision) {
        const revision = this.#requestedRevision
        await this.#fill(() => revision === this.#requestedRevision)
        this.#completedRevision = revision
      }
    } finally {
      this.#running = undefined
    }
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
  const partialOpenTabs = new Map<string, StudioOpenEditorTab>()
  let partialPreviews: Awaited<ReturnType<typeof connectPreviews>> = []
  let partialDevicePanel: ReturnType<typeof createStudioDevicePanel> | undefined
  try {
    throwIfMountAborted(options.signal)
    const handshake = await StudioApiClient.handshake(options.signal)
    throwIfMountAborted(options.signal)
    view.project.textContent = StudioProjectContext.label(handshake.identity.project, handshake.identity.appName)
    updateStatus(view.status, handshake.compile, diagnostic => void openCompileDiagnostic(diagnostic))
    const previews = await connectPreviews(view.preview, config.previewUrl, handshake, options.signal)
    partialPreviews = previews
    throwIfMountAborted(options.signal)
    const activePreview = new StudioActivePreview(previews)
    configureInteractionMode(view.interactionMode, previews, handshake)
    const devicePanel = createStudioDevicePanel({
      api: StudioApiClient,
      button: view.device,
      handshake,
      popover: view.devicePopover,
    })
    partialDevicePanel = devicePanel
    void StudioApiClient.deviceStatus(options.signal).then(status => devicePanel.setStatus(status)).catch(error => {
      if (!isAbortError(error)) {
        devicePanel.setGatewayUnavailable(StudioDevicePanelModel.gatewayUnavailableMessage(error))
      }
    })

    let editor: EditorView | undefined
    let compileState = handshake.compile
    let dataError: string | undefined
    let dataLoading = false
    let dataResult: readonly StudioRuntimeDataTable[] = []
    let dataTimer: ReturnType<typeof setInterval> | undefined
    let drawerTab: StudioDrawerTab = 'Problems'
    let highlightRequestRevision = 0
    let highlightTimer: ReturnType<typeof setTimeout> | undefined
    let activeFile: StudioDraftFile | undefined
    let activePath: string | undefined
    let projectFiles: readonly StudioFile[] = handshake.files
    let fileTree: ReturnType<typeof mountStudioFileTree> | undefined
    let inspected: StudioInspectorSelection | undefined
    let inspection: StudioRenderInspection | undefined
    let inspectorRequestRevision = 0
    let previewManifest = handshake.previewManifest
    const searchDocuments = new Map<string, { content: string; sourceVersion: string }>()
    let searchResults: readonly StudioSearchResult[] = []
    let searchRevision = 0
    let searchTimer: ReturnType<typeof setTimeout> | undefined
    let sourceActionBusy = false
    let shipActive = false
    let testError: string | undefined
    let testStatus: StudioTestStatus | undefined
    let testWatch = false
    const undoCheckpoints: Array<{ id: string; identity: StudioSourceActionIdentity; path: string }> = []
    const openFileLifecycle = new StudioOpenFileLifecycle()
    const openTabs = partialOpenTabs
    const editorTabs = new StudioEditorTabs({
      appName: handshake.identity.appName,
      availablePaths: projectFiles.map(file => file.path),
      project: handshake.identity.project,
      storage: window.localStorage,
    })
    let preparedActiveMutationPath: string | undefined
    let preparedOpenMutationPath: string | undefined

    /**
     * renderPreviewNotice explains a preview that cannot show the app. A failed compile leaves the last good
     * frame on screen, which otherwise looks like the change simply did nothing.
     */
    let previewBundleNotice: { detail: string; heading: string } | undefined
    function renderPreviewNotice(): void {
      studioPreviewNotice(view.preview, previewNoticeFor(compileState) ?? previewBundleNotice)
    }

    /**
     * checkPreviewBundle asks the server whether the preview's bundler can build the app. A bundler failure
     * leaves an empty frame and reports nothing to the problems panel, so without this a person sees a blank
     * preview and no reason for it. The probe reads the same bundle the preview asked for, so it is a warm
     * read whenever the preview did start.
     */
    function checkPreviewBundle(): void {
      if (config.previewUrl === undefined) {
        return
      }
      void StudioApiClient.previewDiagnosis(options.signal).then(diagnosis => {
        previewBundleNotice = previewBundleNoticeFor(diagnosis)
        renderPreviewNotice()
      }).catch(() => {
        // A probe that cannot run says nothing; the compile notice still covers the failures it knows.
      })
    }

    function publishProductHostState(): void {
      const preview = activePreview.current()
      const selection = editor?.state.selection.main
      publishStudioProductHostState({
        activeCell: preview?.cell === undefined
          ? undefined
          : {
            cellId: preview.cell.cellId,
            cellRevision: preview.cell.cellRevision,
            networkErrorMessage: preview.cell.environment.network.error?.message,
            networkErrorStatus: preview.cell.environment.network.error?.status,
            networkLatencyMs: preview.cell.environment.network.latencyMs,
            networkOutcome: preview.cell.environment.network.outcome,
            scenarioModel: JSON.stringify(preview.scenarioModel ?? null),
            scenarioId: preview.cell.scenarioId,
            schemeCapability: preview.cell.environment.scheme.capability,
            schemeRequested: preview.cell.environment.scheme.requested,
            schemeResolved: preview.cell.environment.scheme.resolved,
            schemeSource: preview.cell.environment.scheme.source,
            viewportHeight: preview.cell.environment.viewport.height,
            viewportPresetId: preview.cell.environment.viewport.presetId,
            viewportWidth: preview.cell.environment.viewport.width,
          },
        activeFile: activeFile === undefined || editor === undefined
          ? undefined
          : {
            content: editor.state.doc.toString(),
            path: activeFile.path,
            selectionAnchor: selection?.anchor ?? 0,
            selectionHead: selection?.head ?? selection?.anchor ?? 0,
            sourceVersion: activeFile.sourceVersion,
          },
        projectRoot: handshake.identity.project,
        inspector: {
          busy: sourceActionBusy,
          canUndo: undoCheckpoints.at(-1)?.path === activePath,
          currentSourceVersion: activeFile?.sourceVersion,
          inspection,
          selection: inspected,
        },
        panels: StudioPanelProjection.project({
          compile: compileState,
          data: dataResult,
          dataError,
          dataLoading,
          dataSource: preview?.cell === undefined
            ? undefined
            : { cellId: preview.cell.cellId, cellRevision: preview.cell.cellRevision },
          logs: preview?.runtimeLogs ?? [],
          logSource: preview?.cell === undefined
            ? undefined
            : { cellId: preview.cell.cellId, cellRevision: preview.cell.cellRevision },
          search: searchResults,
          sourceVersions: Object.fromEntries(projectFiles.flatMap(file => [
            [file.path, file.sourceVersion],
            [absoluteSourcePath(handshake.identity.project, file.path), file.sourceVersion],
          ])),
          tab: drawerTab,
          testError,
          testStatus,
          testWatch,
        }),
        selectedRender: inspected === undefined
          ? undefined
          : {
            path: inspected.identity.path,
            renderId: inspected.renderId,
            sourceVersion: inspected.identity.sourceVersion,
          },
      })
    }

    async function openFile(path: string, refresh = false): Promise<StudioOpenFile | undefined> {
      if (path === activePath && !refresh) {
        return { editor: editor!, file: activeFile! }
      }
      const attempt = openFileLifecycle.begin()
      if (!refresh) {
        const evictionPath = editorTabs.evictionCandidate(path)
        const eviction = evictionPath === undefined ? undefined : openTabs.get(evictionPath)
        if (evictionPath !== undefined && eviction !== undefined && evictionPath !== activePath) {
          if (eviction.dirty || eviction.editor.state.doc.toString() !== eviction.file.content) {
            editorTabs.activate(evictionPath)
            activateEditorTab(evictionPath)
            view.status.dataset['state'] = 'error'
            view.status.textContent = 'Save this file with ⌘S before opening another tab.'
            return eviction
          }
        }
        const existing = openTabs.get(path)
        if (existing !== undefined && !existing.stale) {
          editorTabs.activate(path)
          activateEditorTab(path)
          return existing
        }
      }
      const file = await StudioApiClient.file(path, options.signal)
      if (!attempt.isCurrent()) {
        return undefined
      }
      const fileDraftSync = new StudioDraftSync(file, {
        onResult(result) {
          const current = openTabs.get(path)
          if (current?.draft !== fileDraftSync) {
            return
          }
          if (result.saved) {
            current.file = result.file
            current.dirty = current.editor.state.doc.toString() !== result.file.content
            if (activePath === path) {
              activeFile = result.file
              postEditorSelection(activePreview.current(), handshake, activeFile, current.editor)
              publishProductHostState()
            }
          } else {
            current.dirty = true
          }
          renderEditorTabs()
          showDraftResult(view.status, result, compileState, diagnostic => void openCompileDiagnostic(diagnostic))
        },
        write: StudioApiClient.draft,
      })
      let fileEditor!: EditorView
      let fileTab!: StudioOpenEditorTab
      // This view is the controller's document/selection model. The Tao ProductHost owns the only
      // editor mounted in `.studio-editor`; mounting this model there creates a second, invisible
      // CodeMirror that steals focus, selection messages, and DOM behavior from the visible editor.
      fileEditor = new EditorView({
        doc: file.content,
        extensions: [
          StudioCodeEditor.extension,
          StudioTextMateLanguage.extension,
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              const content = update.state.doc.toString()
              fileTab.dirty = true
              fileDraftSync.update(content)
              renderEditorTabs()
              view.status.dataset['state'] = 'idle'
              view.status.textContent = 'Unsaved changes — press ⌘S to save.'
              scheduleHighlight(update.view, content)
              if (view.searchInput.value.trim() !== '') {
                scheduleSearch()
              }
            }
            if (editor === update.view && update.selectionSet && !update.docChanged) {
              postEditorSelection(activePreview.current(), handshake, activeFile, update.view)
            }
            if (editor === update.view && (update.docChanged || update.selectionSet)) {
              publishProductHostState()
            }
          }),
          EditorView.theme({
            '&': { backgroundColor: '#171918', color: '#e8e7e3' },
            '.cm-content': { caretColor: '#f8fafc' },
            '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#f8fafc', borderLeftWidth: '2px' },
            '.cm-gutters': { backgroundColor: '#202321', border: 'none', color: '#6f786f' },
            '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#252a26' },
          }, { dark: true }),
        ],
      })
      fileTab = { dirty: false, draft: fileDraftSync, editor: fileEditor, file, stale: false }
      openTabs.get(path)?.editor.destroy()
      openTabs.set(path, fileTab)
      const snapshot = editorTabs.open(path)
      for (const [candidatePath, candidate] of openTabs) {
        if (!snapshot.paths.includes(candidatePath)) {
          candidate.editor.destroy()
          openTabs.delete(candidatePath)
        }
      }
      activateEditorTab(path)
      return fileTab
    }

    function activateEditorTab(path: string): void {
      const tab = openTabs.get(path)
      if (tab === undefined) {
        return
      }
      highlightRequestRevision += 1
      clearTimeout(highlightTimer)
      activeFile = tab.file
      activePath = path
      editor = tab.editor
      showOpenFile(view, path)
      renderEditorTabs()
      scheduleHighlight(tab.editor, tab.editor.state.doc.toString(), 0)
      postEditorSelection(activePreview.current(), handshake, activeFile, tab.editor)
      renderInspector()
      publishProductHostState()
    }

    function renderEditorTabs(): void {
      const metadata = new Map(projectFiles.map(file => [file.path, file]))
      const items = editorTabs.snapshot().paths.flatMap(path => {
        const tab = openTabs.get(path)
        if (tab === undefined) {
          return []
        }
        const item = document.createElement('span')
        item.className = 'studio-editor-tab-item'
        if (path === activePath) {
          item.setAttribute('aria-current', 'page')
        }
        const activate = document.createElement('button')
        activate.className = 'studio-editor-tab'
        activate.type = 'button'
        activate.title = path
        const label = path.split('/').at(-1) ?? path
        activate.textContent = `${tab.dirty || metadata.get(path)?.dirty === true ? '● ' : ''}${label}`
        activate.addEventListener('click', () => void openFile(path))
        const close = document.createElement('button')
        close.className = 'studio-editor-tab-close'
        close.type = 'button'
        close.title = `Close ${path}`
        close.setAttribute('aria-label', `Close ${path}`)
        close.textContent = '×'
        close.addEventListener('click', () => void closeEditorTab(path))
        item.append(activate, close)
        return [item]
      })
      view.editorTabs.replaceChildren(...items)
    }

    async function closeEditorTab(path: string): Promise<void> {
      const tab = openTabs.get(path)
      if (tab === undefined) {
        return
      }
      if (tab.dirty || tab.editor.state.doc.toString() !== tab.file.content) {
        editorTabs.activate(path)
        activateEditorTab(path)
        view.status.dataset['state'] = 'error'
        view.status.textContent = 'Save this file with ⌘S before closing its tab.'
        return
      }
      const wasActive = path === activePath
      const snapshot = editorTabs.close(path)
      openTabs.delete(path)
      tab.editor.destroy()
      if (wasActive) {
        editor = undefined
        activeFile = undefined
        activePath = undefined
        if (snapshot.activePath !== undefined) {
          activateEditorTab(snapshot.activePath)
        } else {
          view.breadcrumbs.replaceChildren()
          renderInspector()
          publishProductHostState()
        }
      }
      renderEditorTabs()
    }

    function requireAllTabsSaved(message: string): boolean {
      for (const path of editorTabs.snapshot().paths) {
        const tab = openTabs.get(path)
        if (tab === undefined) {
          continue
        }
        if (tab.dirty || tab.editor.state.doc.toString() !== tab.file.content) {
          editorTabs.activate(path)
          activateEditorTab(path)
          view.status.dataset['state'] = 'error'
          view.status.textContent = message
          return false
        }
      }
      return true
    }

    function configureProjectAndAppPickers(): void {
      const currentSessionId = StudioApiRoutes.currentSessionId(window.location.pathname)
      view.project.disabled = currentSessionId === undefined
      view.project.title = currentSessionId === undefined
        ? 'Project selection requires a managed Studio window.'
        : 'Choose another project'
      view.project.addEventListener('click', () => void selectProject())

      const duplicateNames = new Set(
        handshake.apps.filter((app, index) =>
          handshake.apps.some((candidate, candidateIndex) =>
            candidateIndex !== index && candidate.appName === app.appName
          )
        ).map(app => app.appName),
      )
      view.appPicker.replaceChildren(...handshake.apps.map((app, index) => {
        const option = document.createElement('option')
        option.value = String(index)
        option.textContent = duplicateNames.has(app.appName)
          ? `app ${app.appName} — ${app.entryPath}`
          : `app ${app.appName}`
        option.selected = app.appName === handshake.identity.appName && app.entryPath === handshake.entryPath
        return option
      }))
      view.appPicker.disabled = currentSessionId === undefined || handshake.apps.length < 2
      view.appPicker.addEventListener('change', () => void selectAppVariant())
    }

    const betaShipListener = (): void => {
      if (shipActive || !requireAllTabsSaved('Save or revert unsaved files before beta shipping.')) {
        return
      }
      shipActive = true
      view.betaShip.disabled = true
      view.shipOverlay.hidden = false
      view.shipOverlay.setAttribute('aria-busy', 'true')
      const heading = view.shipOverlay.querySelector<HTMLElement>('strong')
      if (heading !== null) {
        heading.textContent = `Beta shipping ${handshake.identity.appName}…`
      }
      view.status.dataset['state'] = 'compiling'
      view.status.textContent = `Beta shipping ${handshake.identity.appName}…`
      void StudioApiClient.betaShip().then(result => {
        view.status.dataset['state'] = 'compiled'
        view.status.textContent = result.message
      }).catch(error => {
        showSourceActionError(view.status, error)
      }).finally(() => {
        shipActive = false
        view.betaShip.disabled = false
        view.shipOverlay.hidden = true
        view.shipOverlay.removeAttribute('aria-busy')
      })
    }
    view.betaShip.addEventListener('click', betaShipListener)

    let chatNames: readonly string[] = []
    // Both agents share one floating panel; see packages/studio/studio-src/agent-chat/StudioAgentPanel.
    mountStudioAgentPanel(root, {
      chat: {
        knownNames: () => chatNames,
        openDeclaration: async name => {
          const found = await StudioApiClient.agentChat<{ found: boolean; path?: string; line?: number }>('locate', {
            name,
          })
          if (found.found && found.path !== undefined) {
            await openFile(found.path, true)
          }
        },
      },
      poc: {
        activeScenario: () => activePreview.current()?.cell?.scenarioId,
        identityFor: file => currentSourceIdentity(handshake, activePreview.current(), { content: '', ...file }),
        openFile: async path => {
          const known = projectFiles.find(file =>
            file.path === path || file.path === `/${path}` || file.path.endsWith(`/${path}`)
          )
          await openFile(known?.path ?? path, true)
        },
        selection: () => inspected,
      },
    })
    void (async () => {
      try {
        chatNames = (await StudioApiClient.agentChat<{ names: string[] }>('names', {})).names
      } catch {
        chatNames = []
      }
    })()

    async function selectProject(): Promise<void> {
      if (!requireAllTabsSaved('Save or revert unsaved files before choosing another project.')) {
        return
      }
      view.project.disabled = true
      try {
        await StudioApiClient.closeCurrentSession()
        const welcome = new URL('/welcome', window.location.origin)
        if (window.location.search.includes('native-window=project')) {
          welcome.searchParams.set('native-window', 'welcome')
        }
        window.location.assign(`${welcome.pathname}${welcome.search}`)
      } catch (error) {
        view.project.disabled = false
        showSourceActionError(view.status, error)
      }
    }

    async function selectAppVariant(): Promise<void> {
      const selected = handshake.apps[Number(view.appPicker.value)]
      const currentIndex = handshake.apps.findIndex(app =>
        app.appName === handshake.identity.appName && app.entryPath === handshake.entryPath
      )
      if (
        selected === undefined || (
          selected.appName === handshake.identity.appName && selected.entryPath === handshake.entryPath
        )
      ) {
        return
      }
      if (!requireAllTabsSaved('Save or revert unsaved files before switching app variants.')) {
        view.appPicker.value = String(currentIndex)
        return
      }
      view.appPicker.disabled = true
      view.status.dataset['state'] = 'compiling'
      view.status.textContent = `Opening ${selected.appName}…`
      const loadingTimer = setTimeout(() => {
        const heading = view.globalLoading.querySelector<HTMLElement>('strong')
        if (heading !== null) {
          heading.textContent = `Switching to ${selected.appName}…`
        }
        view.globalLoading.hidden = false
      }, 300)
      try {
        const transition = await StudioApiClient.switchApp({
          appName: selected.appName,
          entryPath: selected.entryPath,
          projectPath: handshake.identity.project,
        })
        window.location.assign(StudioApiRoutes.transitionUrl(transition, new URL(window.location.href)))
      } catch (error) {
        clearTimeout(loadingTimer)
        view.globalLoading.hidden = true
        view.appPicker.disabled = false
        view.appPicker.value = String(currentIndex)
        showSourceActionError(view.status, error)
      }
    }

    /**
     * Opens what a person tapped on the phone.
     *
     * The status snapshot is re-sent whenever anything about the connection changes, so acting on
     * every one of them would yank the editor around while someone is typing; the sequence advances
     * only on a real tap. `openAndSelect` does the rest of the refusing — a device running an older
     * bundle carries an older `sourceVersion`, and selecting its range in newer text would land on
     * whatever now occupies those offsets.
     */
    let lastDeviceSelection = 0
    async function revealDeviceSelection(selection: StudioDeviceStatus['selection']): Promise<void> {
      if (selection === undefined || selection.sequence <= lastDeviceSelection) {
        return
      }
      lastDeviceSelection = selection.sequence
      const opened = await StudioSourceNavigation.openAndSelect({
        identity: { path: selection.sourcePath, sourceVersion: selection.sourceVersion },
        openFile: async path => await openFile(path),
        project: handshake.identity.project,
        range: { end: selection.end, start: selection.start },
      })
      if (opened === undefined) {
        view.status.dataset['state'] = 'error'
        view.status.textContent =
          `The device selected ${selection.sourcePath}, which has changed on the Mac since the device loaded it.`
      }
    }

    /**
     * Outlines on the phone what was just selected in the browser canvas — the other half of
     * selecting both ways. It is best-effort: with no device connected the gateway answers that
     * nothing was delivered, and a failure here must never interrupt selecting on the Mac.
     */
    async function highlightOnDevice(selection: StudioInspectorSelection): Promise<void> {
      try {
        await StudioApiClient.deviceHighlight({
          occurrence: {
            end: selection.range.end,
            ...(selection.identity.occurrence?.renderOwner === undefined
              ? {}
              : { ownerName: selection.identity.occurrence.renderOwner }),
            sourcePath: selection.identity.path,
            sourceVersion: selection.identity.sourceVersion,
            start: selection.range.start,
          },
        })
      } catch {
        // A device that is not connected is the normal case, not an error worth showing.
      }
    }

    async function openCompileDiagnostic(diagnostic: StudioCompileDiagnostic): Promise<void> {
      if (diagnostic.filePath === undefined) {
        return
      }
      const path = projectRelativePath(handshake.identity.project, diagnostic.filePath)
      if (path === undefined) {
        return
      }
      const opened = await openFile(path)
      if (opened === undefined || diagnostic.range === undefined) {
        return
      }
      const selection = StudioDiagnosticNavigation.selection(opened.editor.state.doc, diagnostic.range)
      opened.editor.dispatch({
        effects: EditorView.scrollIntoView(selection.anchor, { y: 'center' }),
        selection,
      })
      opened.editor.focus()
    }

    async function openScreen(item: StudioScreenItem): Promise<void> {
      const scenarioIds = new Set(
        (previewManifest?.scenarios ?? []).filter(scenario => scenario.subjectId === item.id)
          .map(scenario => scenario.scenarioId),
      )
      const preview = previews.find(candidate =>
        candidate.cell !== undefined && scenarioIds.has(candidate.cell.scenarioId)
      )
      if (preview !== undefined) {
        activePreview.activate(preview)
        preview.frame?.scrollIntoView({ block: 'center' })
      }
      const path = projectRelativePath(handshake.identity.project, item.path) ?? item.path
      const opened = await openFile(path)
      if (opened === undefined) {
        return
      }
      const offset = Math.min(item.start, opened.editor.state.doc.length)
      opened.editor.dispatch({
        effects: EditorView.scrollIntoView(offset, { y: 'center' }),
        selection: { anchor: offset },
      })
      opened.editor.focus()
    }

    async function openSearchResult(result: StudioSearchResult): Promise<void> {
      const path = projectRelativePath(handshake.identity.project, result.path) ?? result.path
      const current = projectFiles.find(file => file.path === path)
      if (result.sourceVersion !== undefined && current?.sourceVersion !== result.sourceVersion) {
        view.status.dataset['state'] = 'error'
        view.status.textContent = 'This search result is stale; refreshing project search.'
        scheduleSearch(0)
        return
      }
      const opened = await openFile(path)
      if (opened === undefined) {
        return
      }
      const selection = result.kind === 'diagnostic' && result.range !== undefined
        ? StudioDiagnosticNavigation.selection(opened.editor.state.doc, result.range)
        : {
          anchor: Math.min(result.start ?? 0, opened.editor.state.doc.length),
          head: Math.min(result.end ?? result.start ?? 0, opened.editor.state.doc.length),
        }
      opened.editor.dispatch({
        effects: EditorView.scrollIntoView(selection.anchor, { y: 'center' }),
        selection,
      })
      opened.editor.focus()
    }

    async function searchProject(): Promise<void> {
      const revision = ++searchRevision
      const query = view.searchInput.value
      if (query.trim() === '') {
        searchResults = []
        publishProductHostState()
        return
      }
      let documents: Array<{ content: string; path: string; sourceVersion?: string }>
      try {
        documents = await Promise.all(projectFiles.map(async file => {
          const opened = openTabs.get(file.path)
          const content = opened?.editor.state.doc.toString() ?? await cachedSearchDocument(file)
          return {
            content,
            path: file.path,
            ...(opened !== undefined && content !== opened.file.content ? {} : { sourceVersion: file.sourceVersion }),
          }
        }))
      } catch (error) {
        if (revision === searchRevision) {
          showSourceActionError(view.status, error)
        }
        return
      }
      if (revision !== searchRevision) {
        return
      }
      searchResults = StudioRailPanels.search(
        documents,
        compileState.diagnostics ?? [],
        query,
        Object.fromEntries(projectFiles.flatMap(file => [
          [file.path, file.sourceVersion],
          [absoluteSourcePath(handshake.identity.project, file.path), file.sourceVersion],
        ])),
      )
      publishProductHostState()
    }

    async function cachedSearchDocument(file: StudioFile): Promise<string> {
      const cached = searchDocuments.get(file.path)
      if (cached?.sourceVersion === file.sourceVersion) {
        return cached.content
      }
      const opened = await StudioApiClient.file(file.path, options.signal)
      searchDocuments.set(file.path, { content: opened.content, sourceVersion: opened.sourceVersion })
      return opened.content
    }

    function scheduleSearch(delayMs = 150): void {
      clearTimeout(searchTimer)
      searchTimer = setTimeout(() => void searchProject(), delayMs)
    }

    function scheduleHighlight(target: EditorView, content: string, delayMs = 60): void {
      const revision = ++highlightRequestRevision
      clearTimeout(highlightTimer)
      highlightTimer = setTimeout(() => {
        void StudioApiClient.highlight(content).then(highlight => {
          if (
            revision === highlightRequestRevision
            && editor === target
            && target.state.doc.toString() === content
          ) {
            target.dispatch({ effects: StudioTextMateLanguage.setHighlight(highlight) })
          }
        }).catch(() => {
          // Highlighting is presentation-only; LSP editing and preview compilation remain available.
        })
      }, delayMs)
    }

    // The Tao product host portals React trees into `.studio-scenario-inspector-content`,
    // `.studio-inspector-tao-context`, and `.studio-drawer-content`. Emptying those containers here
    // detached React's own children behind its back, so React's next portal update called
    // removeChild on a node that was no longer a child and the boundary tore the client down. The
    // shell never fills these containers, so publishing state is the whole job.
    function renderInspector(): void {
      publishProductHostState()
    }

    function renderDrawer(): void {
      publishProductHostState()
    }

    function selectDrawer(tab: StudioDrawerTab): void {
      drawerTab = tab
      for (const button of view.drawerTabs.querySelectorAll<HTMLButtonElement>('[data-drawer-tab]')) {
        if (button.dataset['drawerTab'] === tab) {
          button.setAttribute('aria-current', 'true')
        } else {
          button.removeAttribute('aria-current')
        }
      }
      renderDrawer()
      if (tab === 'Data') {
        void loadData()
        dataTimer ??= setInterval(() => void loadData(), 2_000)
      } else if (dataTimer !== undefined) {
        clearInterval(dataTimer)
        dataTimer = undefined
      }
    }

    const dataFill = new StudioDataFillCoordinator(async isLatest => {
      dataLoading = true
      dataError = undefined
      renderDrawer()
      try {
        const preview = activePreview.current()
        Assert.input(preview, 'Select a connected preview cell to inspect live app data.')
        const capture = await requestRuntimeCapture(preview, handshake)
        if (isLatest() && preview === activePreview.current()) {
          dataResult = StudioRuntimeData.tables(capture)
          dataLoading = false
          renderDrawer()
        }
      } catch (error) {
        if (isLatest()) {
          dataLoading = false
          dataError = Errors.messageOf(error)
          renderDrawer()
        }
      }
    })

    async function loadData(): Promise<void> {
      await dataFill.request()
    }

    async function loadTestStatus(): Promise<void> {
      try {
        testStatus = await StudioApiClient.testStatus()
        testError = undefined
      } catch (error) {
        testError = Errors.messageOf(error)
      }
      if (drawerTab === 'Tests') {
        renderDrawer()
      }
    }

    async function runTests(): Promise<void> {
      if (testStatus?.running === true) {
        return
      }
      testError = undefined
      testStatus = { ...(testStatus ?? { available: true }), available: true, running: true }
      if (drawerTab === 'Tests') {
        renderDrawer()
      }
      try {
        const lastRun = await StudioApiClient.testRun()
        testStatus = { available: true, lastRun, running: false }
      } catch (error) {
        testError = Errors.messageOf(error)
        testStatus = { ...(testStatus ?? { available: true }), running: false }
      }
      if (drawerTab === 'Tests') {
        renderDrawer()
      }
    }

    async function openTestFailure(failure: StudioTestFailure): Promise<void> {
      const path = projectRelativePath(handshake.identity.project, failure.filePath) ?? failure.filePath
      const opened = await openFile(path)
      if (opened === undefined || failure.line === undefined) {
        return
      }
      const line = opened.editor.state.doc.line(Math.min(failure.line, opened.editor.state.doc.lines))
      const position = Math.min(line.to, line.from + Math.max(0, (failure.column ?? 1) - 1))
      opened.editor.dispatch({
        effects: EditorView.scrollIntoView(position, { y: 'center' }),
        selection: { anchor: position },
      })
      opened.editor.focus()
    }

    void loadTestStatus()

    function focusCaptureFixture(): void {
      const preview = activePreview.current()
      const input = preview?.scenarioControls?.querySelector<HTMLInputElement>('.studio-preview-fixture-name')
      if (preview === undefined || input === null || input === undefined) {
        view.status.dataset['state'] = 'error'
        view.status.textContent = 'The active preview cell does not expose fixture capture controls.'
        return
      }
      preview.frame?.scrollIntoView({ block: 'center' })
      input.focus()
    }

    async function inspectSelection(selection: StudioInspectorSelection): Promise<void> {
      const revision = ++inspectorRequestRevision
      inspection = undefined
      renderInspector()
      const path = projectRelativePath(handshake.identity.project, selection.identity.path) ?? selection.identity.path
      try {
        const result = await StudioApiClient.inspectRender({
          path,
          renderId: selection.renderId,
          sourceVersion: selection.identity.sourceVersion,
        })
        if (revision === inspectorRequestRevision && inspected?.renderId === selection.renderId) {
          inspection = result
          renderInspector()
        }
      } catch (error) {
        if (revision === inspectorRequestRevision) {
          showSourceActionError(view.status, error)
        }
      }
    }

    function insertEditorSnippet(
      target: EditorView,
      snippet: Parameters<typeof StudioEditorInsertion.transaction>[1],
      position: number,
    ): void {
      target.dispatch(StudioEditorInsertion.transaction(target.state.doc, snippet, position))
    }

    function insertProjectView(projectView: ReturnType<typeof StudioInspector.projectViews>[number]): void {
      const activeSourcePath = activeFile === undefined
        ? undefined
        : `${handshake.identity.project.replace(/\/$/, '')}/${activeFile.path.replace(/^\//, '')}`
      if (
        editor !== undefined
        && (projectView.snippet.placeholders.length > 0 || projectView.sourcePath !== activeSourcePath)
      ) {
        insertEditorSnippet(editor, projectView.snippet, editor.state.selection.main.head)
        editor.focus()
        return
      }
      const identity = currentSourceIdentity(handshake, activePreview.current(), activeFile)
      if (identity !== undefined) {
        void submitLocalAction({
          ...(inspected === undefined ? {} : { beforeId: inspected.renderId }),
          kind: 'insert-project-view',
          viewName: projectView.viewName,
        }, identity)
      }
    }

    function setSourceActionBusy(busy: boolean): void {
      sourceActionBusy = busy
      publishProductHostState()
      renderInspector()
    }

    async function applySourceAction(envelope: StudioSourceActionEnvelope): Promise<void> {
      setSourceActionBusy(true)
      view.status.dataset['state'] = 'compiling'
      view.status.textContent = `Applying ${sourceActionLabel(envelope.action)}…`
      try {
        const result = await StudioApiClient.sourceAction(envelope)
        if (result.checkpoint.status === 'committed' && undoCheckpoints.at(-1)?.id !== result.checkpoint.id) {
          undoCheckpoints.push({ id: result.checkpoint.id, identity: envelope.identity, path: result.path })
        }
        inspected = undefined
        inspection = undefined
        publishProductHostState()
        await openFile(result.path, true)
        updateStatus(
          view.status,
          StudioCompileStatus.completed(result.compile, compileState),
          diagnostic => void openCompileDiagnostic(diagnostic),
        )
      } catch (error) {
        showSourceActionError(view.status, error)
      } finally {
        setSourceActionBusy(false)
      }
    }

    async function submitLocalAction(
      action: StudioCanonicalSourceAction,
      identity: StudioSourceActionIdentity,
    ): Promise<void> {
      if (sourceActionBusy || !requireVisualEditDraftSaved()) {
        return
      }
      if (activeFile === undefined || identity.sourceVersion !== activeFile.sourceVersion) {
        view.status.dataset['state'] = 'error'
        view.status.textContent = 'Wait for the refreshed preview before editing this render.'
        return
      }
      await applySourceAction(localActionEnvelope(action, identity))
    }

    async function submitProposedLocalAction(
      action: StudioCanonicalSourceAction,
      identity: StudioSourceActionIdentity,
    ): Promise<void> {
      if (sourceActionBusy || !requireVisualEditDraftSaved()) {
        return
      }
      if (activeFile === undefined || identity.sourceVersion !== activeFile.sourceVersion) {
        view.status.dataset['state'] = 'error'
        view.status.textContent = 'Wait for the refreshed preview before editing this render.'
        return
      }
      const envelope = localActionEnvelope(action, identity)
      setSourceActionBusy(true)
      view.status.dataset['state'] = 'compiling'
      view.status.textContent = 'Preparing a canonical source proposal…'
      try {
        const proposal = await StudioApiClient.sourceActionProposal(envelope)
        if (!window.confirm(`Apply this shared style edit?\n\n${proposal.diff}`)) {
          view.status.dataset['state'] = 'idle'
          view.status.textContent = 'Style edit was not applied.'
          return
        }
      } catch (error) {
        showSourceActionError(view.status, error)
        return
      } finally {
        setSourceActionBusy(false)
      }
      await applySourceAction(envelope)
    }

    function localActionEnvelope(
      action: StudioCanonicalSourceAction,
      identity: StudioSourceActionIdentity,
    ): StudioSourceActionEnvelope {
      const operationId = crypto.randomUUID()
      const occurrence = sourceActionUsesRenderOccurrence(action)
        ? identity.occurrence ?? inspected?.identity.occurrence
        : undefined
      return StudioInspector.singleAction({
        action,
        checkpointId: `checkpoint:${operationId}`,
        identity: {
          ...identity,
          ...(occurrence === undefined ? {} : { occurrence }),
        },
        requestId: `request:${operationId}`,
      })
    }

    async function submitPreviewAction(envelope: StudioSourceActionEnvelope): Promise<void> {
      if (sourceActionBusy || !requireVisualEditDraftSaved()) {
        return
      }
      const path = projectRelativePath(handshake.identity.project, envelope.identity.path)
      if (
        path === undefined
        || (path === activePath && envelope.identity.sourceVersion !== activeFile?.sourceVersion)
      ) {
        view.status.dataset['state'] = 'error'
        view.status.textContent = 'Wait for the refreshed preview before editing this render.'
        return
      }
      await applySourceAction(envelope)
    }

    async function undoLatestSourceAction(): Promise<void> {
      const checkpoint = undoCheckpoints.at(-1)
      if (
        checkpoint === undefined
        || checkpoint.path !== activePath
        || sourceActionBusy
        || !requireVisualEditDraftSaved()
      ) {
        return
      }
      const currentIdentity = currentSourceIdentity(handshake, activePreview.current(), activeFile)
      if (currentIdentity === undefined) {
        return
      }
      const identity: StudioSourceActionIdentity = {
        ...currentIdentity,
        ...(checkpoint.identity.occurrence === undefined ? {} : { occurrence: checkpoint.identity.occurrence }),
      }
      setSourceActionBusy(true)
      view.status.dataset['state'] = 'compiling'
      view.status.textContent = 'Undoing visual source edit…'
      try {
        const result = await StudioApiClient.undoSourceAction(StudioInspector.undo({
          checkpointId: checkpoint.id,
          identity,
          requestId: `undo:${crypto.randomUUID()}`,
        }))
        undoCheckpoints.pop()
        inspected = undefined
        inspection = undefined
        publishProductHostState()
        await openFile(result.path, true)
        updateStatus(
          view.status,
          StudioCompileStatus.completed(result.compile, compileState),
          diagnostic => void openCompileDiagnostic(diagnostic),
        )
      } catch (error) {
        showSourceActionError(view.status, error)
      } finally {
        setSourceActionBusy(false)
      }
    }

    function requireVisualEditDraftSaved(): boolean {
      if (activeFile !== undefined && editor?.state.doc.toString() === activeFile.content) {
        return true
      }
      view.status.dataset['state'] = 'error'
      view.status.textContent = 'Save this file with ⌘S before applying a visual source edit.'
      return false
    }

    function insertComponent(component: (typeof studioPaletteComponents)[number]): void {
      const identity = currentSourceIdentity(handshake, activePreview.current(), activeFile)
      if (identity !== undefined) {
        void submitLocalAction({
          ...(inspected === undefined ? {} : { beforeId: inspected.renderId }),
          component: component.component,
          kind: 'insert-component',
        }, identity)
      }
    }

    function publishProjectFiles(files: readonly StudioFile[]): void {
      const previousFiles = projectFiles
      projectFiles = files
      const available = new Set(files.map(file => file.path))
      if (preparedOpenMutationPath !== undefined && !available.has(preparedOpenMutationPath)) {
        const previousPaths = new Set(previousFiles.map(file => file.path))
        const added = files.filter(file => !previousPaths.has(file.path))
        if (added.length === 1) {
          editorTabs.rename(preparedOpenMutationPath, added[0]!.path)
        }
      }
      for (const [path, cached] of searchDocuments) {
        const file = files.find(candidate => candidate.path === path)
        if (file === undefined || file.sourceVersion !== cached.sourceVersion) {
          searchDocuments.delete(path)
        }
      }
      const snapshot = editorTabs.reconcile([...available])
      let activeWasRemoved = false
      for (const [path, tab] of openTabs) {
        if (!available.has(path)) {
          activeWasRemoved ||= path === activePath
          tab.editor.destroy()
          openTabs.delete(path)
          continue
        }
        const metadata = files.find(file => file.path === path)
        if (
          metadata !== undefined
          && metadata.sourceVersion !== tab.file.sourceVersion
          && !tab.dirty
          && path !== activePath
        ) {
          tab.stale = true
        }
      }
      if (activeWasRemoved) {
        editor = undefined
        activeFile = undefined
        activePath = undefined
        publishProductHostState()
        if (snapshot.activePath !== undefined && openTabs.has(snapshot.activePath)) {
          activateEditorTab(snapshot.activePath)
        } else {
          view.breadcrumbs.replaceChildren()
        }
      }
      renderEditorTabs()
      renderCommands()
      if (view.searchInput.value.trim() !== '') {
        scheduleSearch()
      }
      if (drawerTab === 'Data') {
        void loadData()
      }
    }

    async function prepareFileMutation(file: StudioFile): Promise<StudioFile | undefined> {
      preparedActiveMutationPath = activePath
      const tab = openTabs.get(file.path)
      preparedOpenMutationPath = tab === undefined ? undefined : file.path
      if (tab === undefined) {
        return projectFiles.find(candidate => candidate.path === file.path)
      }
      if (tab.dirty || tab.editor.state.doc.toString() !== tab.file.content) {
        editorTabs.activate(file.path)
        activateEditorTab(file.path)
        view.status.dataset['state'] = 'error'
        view.status.textContent = 'Save this file with ⌘S before changing it.'
        return undefined
      }
      await fileTree?.refresh()
      return projectFiles.find(candidate => candidate.path === file.path)
    }

    const wirePreview = (preview: (typeof previews)[number]): void => {
      StudioPreviewSourceSync.connect(preview, () => {
        if (preview === activePreview.current() && activeFile !== undefined && editor !== undefined) {
          postEditorSelection(preview, handshake, activeFile, editor)
        }
      })
      preview.applySourceAction = async envelope => {
        Assert.input(!sourceActionBusy, 'Wait for the current Studio source action to finish.')
        Assert.input(
          requireVisualEditDraftSaved(),
          'Save the active draft before changing Tao source through Studio.',
        )
        await applySourceAction(envelope)
      }
      preview.changed = () => {
        if (preview === activePreview.current()) {
          publishProductHostState()
          renderInspector()
          if (drawerTab === 'Data') {
            void loadData()
          } else if (drawerTab === 'Logs') {
            renderDrawer()
          }
        }
      }
    }
    activePreview.subscribe(() => {
      dataResult = []
      const preview = activePreview.current()
      if (preview !== undefined && activeFile !== undefined && editor !== undefined) {
        postEditorSelection(preview, handshake, activeFile, editor)
      }
      publishProductHostState()
      renderInspector()
      renderDrawer()
      if (drawerTab === 'Data') {
        void loadData()
      }
    })
    activePreview.reconcile(wirePreview)
    publishProductHostState()
    view.searchInput.addEventListener('input', () => scheduleSearch())
    view.preview.addEventListener('dragover', event => {
      if (event.dataTransfer?.types.includes(studioPaletteMime)) {
        event.preventDefault()
      }
    })
    view.preview.addEventListener('drop', event => {
      const item = StudioPaletteTransfer.parse(event.dataTransfer?.getData(studioPaletteMime) ?? '')
      const identity = currentSourceIdentity(handshake, activePreview.current(), activeFile)
      if (item === undefined) {
        view.status.dataset['state'] = 'error'
        view.status.textContent = 'Studio could not read the dropped palette item.'
        return
      }
      event.preventDefault()
      if (identity === undefined) {
        view.status.dataset['state'] = 'error'
        view.status.textContent = 'Wait for the active preview before dropping a component.'
        return
      }
      if (inspected === undefined) {
        view.status.dataset['state'] = 'error'
        view.status.textContent = 'Select a rendered element before dropping a component into the preview.'
        return
      }
      const gap = { beforeId: inspected.renderId }
      void submitLocalAction(
        item.kind === 'component'
          ? { ...gap, component: item.component, kind: 'insert-component' }
          : { ...gap, kind: 'insert-project-view', viewName: item.viewName },
        identity,
      )
    })

    for (const button of view.drawerTabs.querySelectorAll<HTMLButtonElement>('[data-drawer-tab]')) {
      button.addEventListener('click', () => selectDrawer(button.dataset['drawerTab'] as StudioDrawerTab))
    }
    view.rail.addEventListener('click', event => {
      const panel = (event.target as HTMLElement).closest<HTMLElement>('[data-panel]')?.dataset['panel']
      if (panel === 'data') {
        selectDrawer('Data')
      } else if (panel === 'search') {
        view.searchInput.focus()
      }
    })
    selectDrawer('Problems')

    fileTree = mountStudioFileTree({
      files: projectFiles,
      onCreated: async result => {
        await openFile(StudioFileTreeTransitions.afterCreate(result))
      },
      onDeleted: async result => {
        const previousActivePath = preparedActiveMutationPath
        preparedActiveMutationPath = undefined
        preparedOpenMutationPath = undefined
        const nextPath = StudioFileTreeTransitions.afterDelete(previousActivePath, handshake.entryPath, result)
        if (previousActivePath === result.deleted.path && nextPath !== undefined) {
          await openFile(nextPath)
        }
      },
      onFiles: publishProjectFiles,
      onRenamed: async result => {
        const previousActivePath = preparedActiveMutationPath
        const wasOpen = preparedOpenMutationPath === result.previousPath
        preparedActiveMutationPath = undefined
        preparedOpenMutationPath = undefined
        const nextPath = StudioFileTreeTransitions.afterRename(previousActivePath, result)
        if (wasOpen) {
          await openFile(result.file.path)
          if (nextPath !== undefined && nextPath !== result.file.path) {
            await openFile(nextPath)
          }
        }
      },
      prepareMutation: prepareFileMutation,
    })
    configureProjectAndAppPickers()
    const restoredTabs = editorTabs.snapshot()
    const restoredPaths = restoredTabs.paths.length === 0 ? [handshake.entryPath] : restoredTabs.paths
    for (const path of restoredPaths) {
      await openFile(path)
      throwIfMountAborted(options.signal)
    }
    if (restoredTabs.activePath !== undefined && restoredTabs.activePath !== activePath) {
      await openFile(restoredTabs.activePath)
      throwIfMountAborted(options.signal)
    }
    throwIfMountAborted(options.signal)
    const disconnectEvents = connectEvents(view.status, diagnostic => void openCompileDiagnostic(diagnostic), {
      onCompile(state) {
        compileState = state
        renderPreviewNotice()
        devicePanel.setCompileState(state)
        renderDrawer()
        if (view.searchInput.value.trim() !== '') {
          scheduleSearch()
        }
        if (state.status !== 'compiling') {
          void fileTree?.refresh().catch(error => showSourceActionError(view.status, error))
        }
        if (drawerTab === 'Data') {
          void loadData()
        }
        if (testWatch && state.status === 'compiled') {
          void runTests()
        }
      },
      onFile(file) {
        const found = projectFiles.some(candidate => candidate.path === file.path)
        fileTree?.setFiles(
          found
            ? projectFiles.map(candidate => candidate.path === file.path ? file : candidate)
            : [...projectFiles, file],
        )
        const tab = openTabs.get(file.path)
        if (tab !== undefined && file.sourceVersion !== tab.file.sourceVersion) {
          if (tab.editor.state.doc.toString() === tab.file.content) {
            tab.stale = true
          }
          if (file.path === activePath && tab.stale) {
            void openFile(file.path, true)
          } else if (file.path === activePath) {
            view.status.dataset['state'] = 'error'
            view.status.textContent = 'This file changed on disk while the editor has an unsaved draft.'
          }
        }
        if (drawerTab === 'Data') {
          void loadData()
        }
      },
      onDeviceState(status) {
        devicePanel.setStatus(status)
        void revealDeviceSelection(status.selection)
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
            renderPreviewNotice()
            checkPreviewBundle()
          }).catch(error => {
            view.status.dataset['state'] = 'error'
            view.status.textContent = Errors.messageOf(error)
          })
        }
        renderCommands()
        if (drawerTab === 'Data') {
          void loadData()
        }
      },
    })
    view.reload.addEventListener('click', () => {
      if (previews.length > 0) {
        for (const connection of previews) {
          connection.iframe.src = connection.iframe.src
        }
        view.status.textContent = 'Reloading preview…'
      }
    })
    let previewMessageListener: ((event: MessageEvent) => void) | undefined
    if (previews.length > 0) {
      previewMessageListener = event => {
        const connection = previews.find(candidate => candidate.iframe.contentWindow === event.source)
        if (connection === undefined) {
          return
        }
        void handlePreviewMessage(event, connection, handshake, openFile, {
          activate: () => activePreview.activate(connection),
          applySourceAction: submitPreviewAction,
          changed() {
            if (drawerTab === 'Logs') {
              renderDrawer()
            }
            if (drawerTab === 'Data') {
              void loadData()
            }
          },
          inspect(selection) {
            inspected = selection
            publishProductHostState()
            void inspectSelection(selection)
            void highlightOnDevice(selection)
          },
        })
      }
      window.addEventListener('message', previewMessageListener)
    }
    function commandItems(): readonly StudioCommandItem[] {
      return StudioCommandPalette.items({
        files: projectFiles,
        manifest: previewManifest,
        projectViews: StudioInspector.projectViews(previewManifest),
      })
    }

    function renderCommands(): void {
      renderCommandResults(
        view.commandResults,
        StudioCommandPalette.filter(commandItems(), view.commandInput.value),
        executeCommand,
      )
    }

    function closeCommands(): void {
      view.commandOverlay.hidden = true
    }

    function executeCommand(item: StudioCommandItem): void {
      closeCommands()
      const target = item.target
      if (target.kind === 'file') {
        void openFile(target.path)
      } else if (target.kind === 'view') {
        const path = projectRelativePath(handshake.identity.project, target.path)
        if (path !== undefined) {
          void openFile(path)
        }
      } else if (target.kind === 'scenario') {
        const preview = previews.find(candidate => candidate.cell?.scenarioId === target.scenarioId)
        if (preview !== undefined) {
          activePreview.activate(preview)
          if (drawerTab === 'Data') {
            void loadData()
          }
          if (drawerTab === 'Logs') {
            renderDrawer()
          }
          preview.frame?.scrollIntoView({ block: 'center' })
          preview.iframe.focus()
        }
      } else if (target.kind === 'insert-component') {
        insertComponent(target.component)
      } else if (target.kind === 'insert-view') {
        insertProjectView(target.view)
      } else if (target.command === 'reload') {
        view.reload.click()
      } else if (target.command === 'toggle-mode') {
        view.interactionMode.click()
      } else {
        selectDrawer(target.command === 'compile' ? 'Compile' : target.command === 'data' ? 'Data' : 'Problems')
      }
    }

    const toggleCommands = (): void => {
      view.commandOverlay.hidden = !view.commandOverlay.hidden
      if (!view.commandOverlay.hidden) {
        view.commandInput.value = ''
        renderCommands()
        view.commandInput.focus()
      }
    }
    view.commandButton.addEventListener('click', toggleCommands)
    view.commandInput.addEventListener('input', renderCommands)
    view.commandInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        view.commandResults.querySelector<HTMLButtonElement>('button')?.click()
      }
    })
    const saveActiveFile = async (): Promise<void> => {
      const tab = activePath === undefined ? undefined : openTabs.get(activePath)
      if (tab === undefined || !tab.dirty) {
        view.status.dataset['state'] = 'idle'
        view.status.textContent = 'No unsaved changes.'
        return
      }
      try {
        await tab.draft.save()
      } catch (error) {
        showSourceActionError(view.status, error)
      }
    }
    const keydownListener = (event: KeyboardEvent): void => {
      if (isStudioSaveShortcut(event)) {
        event.preventDefault()
        void saveActiveFile()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        toggleCommands()
      } else if (event.key === 'Escape' && !view.commandOverlay.hidden) {
        closeCommands()
      }
    }
    window.addEventListener('keydown', keydownListener, { capture: true })
    const beforeUnloadListener = (event: BeforeUnloadEvent): void => {
      if (shipActive || [...openTabs.values()].some(tab => tab.dirty)) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnloadListener)
    const unregisterProductHost = registerStudioProductHostActions({
      async applyInspectorAction(action, proposed) {
        Assert.input(inspected, 'Select a rendered element before editing its source.')
        if (proposed) {
          await submitProposedLocalAction(action, inspected.identity)
        } else {
          await submitLocalAction(action, inspected.identity)
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
      changeActiveFile(content) {
        if (editor === undefined || editor.state.doc.toString() === content) {
          return
        }
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } })
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
        insertComponent(component)
      },
      insertProjectView(viewName) {
        const projectView = StudioInspector.projectViews(previewManifest).find(candidate =>
          candidate.viewName === viewName
        )
        Assert.input(projectView, `Tao Studio project view is no longer available: ${viewName}`)
        insertProjectView(projectView)
      },
      async openFile(path) {
        Assert.input(
          projectFiles.some(file => file.path === path),
          `Tao Studio file is no longer available: ${path}`,
        )
        await openFile(path)
      },
      async openScreen(subjectId) {
        const screen = StudioRailPanels.screens(previewManifest).find(candidate => candidate.id === subjectId)
        Assert.input(screen, `Tao Studio screen is no longer available: ${subjectId}`)
        await openScreen(screen)
      },
      async productPanelAction(name, payload) {
        if (name.startsWith('scenario-')) {
          const command = parseScenarioPanelCommand(name, payload)
          const preview = activePreview.current()
          const model = preview?.scenarioModel
          if (
            preview?.cell === undefined
            || model === undefined
            || preview.cell.cellId !== command.cellId
            || preview.cell.cellRevision !== command.cellRevision
          ) {
            throw new StudioApiError('The selected Studio preview changed while its scenario was being edited.', 409, {
              actualCellId: preview?.cell?.cellId,
              actualCellRevision: preview?.cell?.cellRevision,
              code: 'stale-cell',
              expectedCellId: command.cellId,
              expectedCellRevision: command.cellRevision,
            })
          }
          if (command.kind === 'scenario-apply-arguments') {
            const checked = StudioScenarioControls.validateArguments(model, command.arguments)
            if (!checked.ok) {
              Errors.throwUserInput(checked.issues.join(' '))
            }
            Assert.input(
              preview.reconfigureArguments,
              'The active scenario cannot currently remount arguments.',
            )
            await preview.reconfigureArguments(checked.value)
            return
          }
          if (command.kind === 'scenario-save-arguments') {
            const action = StudioScenarioControls.saveArgumentsAction(
              model,
              command.arguments,
              crypto.randomUUID(),
              command.appearance,
            )
            if (!action.ok) {
              Errors.throwUserInput(action.issues.join(' '))
            }
            if (sourceActionBusy || !requireVisualEditDraftSaved()) {
              return
            }
            await applySourceAction(action.value)
            return
          }
          if (command.kind === 'scenario-capture-fixture') {
            Assert.input(preview.captureFixture, 'The active scenario cannot currently capture a fixture.')
            await preview.captureFixture(command.fixtureName)
            return
          }
          const replay = StudioScenarioControls.replay(
            model,
            command.kind === 'scenario-replay-failure' ? undefined : command.capture,
          )
          if (!replay.ok) {
            Errors.throwUserInput(replay.issues.join(' '))
          }
          Assert.input(
            preview.replayRuntimeCapture,
            'The active scenario cannot currently replay captured state.',
          )
          await preview.replayRuntimeCapture(replay.value)
          return
        }
        if (name === 'capture-fixture') {
          focusCaptureFixture()
          return
        }
        if (name === 'clear-logs') {
          const preview = activePreview.current()
          if (preview !== undefined) {
            preview.runtimeLogs = []
          }
          renderDrawer()
          return
        }
        if (name === 'open-diagnostic') {
          await openCompileDiagnostic(StudioPanelPayloads.compileDiagnostic(payload))
          return
        }
        if (name === 'refresh-data') {
          await loadData()
          return
        }
        if (name === 'run-tests') {
          await runTests()
          return
        }
        if (name === 'open-test-failure') {
          await openTestFailure(StudioPanelPayloads.testFailure(payload))
          return
        }
        if (name === 'test-watch') {
          const watch = JSON.parse(payload) as unknown
          if (typeof watch !== 'boolean') {
            Errors.throwUserInput('Tao Studio test-watch actions require a boolean payload.')
          }
          testWatch = watch
          renderDrawer()
          if (watch) {
            await runTests()
          }
          return
        }
        if (name === 'open-search-result') {
          await openSearchResult(StudioPanelPayloads.searchResult(payload))
          return
        }
        Errors.throwUserInput(`Unsupported Tao Studio panel action: ${name}`)
      },
      async renameFile(path, sourceVersion, targetPath) {
        await fileTree!.rename(path, sourceVersion, targetPath)
      },
      selectActiveFile(anchor, head) {
        if (editor === undefined) {
          return
        }
        const safeAnchor = Math.min(anchor, editor.state.doc.length)
        const safeHead = Math.min(head, editor.state.doc.length)
        if (editor.state.selection.main.anchor !== safeAnchor || editor.state.selection.main.head !== safeHead) {
          editor.dispatch({ selection: { anchor: safeAnchor, head: safeHead } })
        }
        postEditorSelection(activePreview.current(), handshake, activeFile, editor)
      },
      async undoInspectorAction() {
        await undoLatestSourceAction()
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
      view.betaShip.removeEventListener('click', betaShipListener)
      devicePanel.dispose()
      if (previewMessageListener !== undefined) {
        window.removeEventListener('message', previewMessageListener)
      }
      clearTimeout(highlightTimer)
      clearTimeout(searchTimer)
      if (dataTimer !== undefined) {
        clearInterval(dataTimer)
      }
      for (const tab of openTabs.values()) {
        tab.editor.destroy()
      }
      disconnectPreviews(previews)
    }
    return cleanup
  } catch (error) {
    for (const tab of partialOpenTabs.values()) {
      tab.editor.destroy()
    }
    partialDevicePanel?.dispose()
    disconnectPreviews(partialPreviews)
    if (!isAbortError(error)) {
      view.status.dataset['state'] = 'error'
      view.status.textContent = Errors.messageOf(error)
    }
    throw error
  }
}

function throwIfMountAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error('Tao Studio product host mount was cancelled.')
    error.name = 'AbortError'
    throw error
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function connectEvents(
  status: HTMLElement,
  openDiagnostic: (diagnostic: StudioCompileDiagnostic) => void,
  handlers: {
    onCompile: (state: StudioCompileState) => void
    onDeviceState: (status: StudioDeviceStatus) => void
    onFile: (file: StudioFile) => void
    onFiles: (files: readonly StudioFile[]) => void
    onManifest: (manifest: StudioPreviewManifestV2) => void
  },
): () => void {
  const initialReconnectDelayMs = 500
  const maximumReconnectDelayMs = 10_000
  let reconnectDelayMs = initialReconnectDelayMs
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let socket: WebSocket | undefined
  let stopped = false
  const connect = (): void => {
    socket = StudioApiClient.connectEvents({
      onConnect() {
        status.dataset['state'] = 'idle'
        status.textContent = 'Studio server connected; synchronizing…'
      },
      onCompile: state => {
        updateStatus(status, state, openDiagnostic)
        handlers.onCompile(state)
      },
      onDisconnect() {
        if (stopped) {
          return
        }
        status.dataset['state'] = 'error'
        status.textContent = 'Studio server disconnected; reconnecting…'
        reconnectTimer = setTimeout(connect, reconnectDelayMs)
        reconnectDelayMs = Math.min(maximumReconnectDelayMs, reconnectDelayMs * 2)
      },
      onDeviceState: handlers.onDeviceState,
      onFile: handlers.onFile,
      onFiles: handlers.onFiles,
      onHandshake(handshake) {
        reconnectDelayMs = initialReconnectDelayMs
        updateStatus(status, handshake.compile, openDiagnostic)
        handlers.onCompile(handshake.compile)
        handlers.onFiles(handshake.files)
        if (handshake.previewManifest !== undefined) {
          handlers.onManifest(handshake.previewManifest)
        }
      },
      onManifest: handlers.onManifest,
    })
  }
  connect()
  return () => {
    stopped = true
    clearTimeout(reconnectTimer)
    socket?.close()
  }
}

function updateStatus(
  element: HTMLElement,
  state: StudioCompileState,
  openDiagnostic?: (diagnostic: StudioCompileDiagnostic) => void,
): void {
  element.dataset['state'] = state.status
  const revisions = state.status === 'compiled'
    ? `compiled ${state.compileRevision} · applied ${state.appliedRevision}`
    : state.status
  const text = `${revisions} — ${state.message}`
  const diagnostic = state.status === 'error' ? state.diagnostics?.find(item => item.filePath !== undefined) : undefined
  if (diagnostic === undefined || openDiagnostic === undefined) {
    element.textContent = text
    return
  }
  const button = document.createElement('button')
  button.className = 'studio-status-diagnostic'
  button.textContent = text
  button.type = 'button'
  const location = diagnostic.range === undefined ? '' : `:${diagnostic.range.start.line + 1}`
  button.title = `Open ${diagnostic.filePath}${location}`
  button.addEventListener('click', () => openDiagnostic(diagnostic))
  element.replaceChildren(button)
}

function showDraftResult(
  element: HTMLElement,
  result: StudioDraftSyncResult,
  currentCompile: StudioCompileState,
  openDiagnostic?: (diagnostic: StudioCompileDiagnostic) => void,
): void {
  if (result.saved) {
    const completed = StudioDraftStatus.completedCompile(result, currentCompile)
    if (completed !== undefined) {
      updateStatus(element, completed, openDiagnostic)
      return
    }
    element.dataset['state'] = 'compiling'
    element.textContent = 'Saved; compiling preview…'
    return
  }
  element.dataset['state'] = 'error'
  element.textContent = result.diagnostics[0] ?? 'Draft is not valid Tao yet; preview kept the last good source.'
}

/** StudioDraftStatus prevents an older save response from obscuring a completed or newer compile event. */
export const StudioDraftStatus = {
  completedCompile(
    result: StudioDraftSyncResult,
    current: StudioCompileState,
  ): StudioCompileState | undefined {
    if (!result.saved || result.compile === undefined) {
      return undefined
    }
    return StudioCompileStatus.completed(result.compile, current)
  },
}

/** Keeps a completed request from overwriting an equal or newer event-stream compile state. */
const StudioCompileStatus = {
  completed(
    completion: StudioCompileCompletion,
    current: StudioCompileState,
  ): StudioCompileState {
    if (current.compileRevision > completion.compileRevision) {
      return current
    }
    return {
      appliedRevision: current.appliedRevision,
      compileRevision: completion.compileRevision,
      diagnostics: completion.diagnostics,
      message: completion.message,
      status: completion.status,
    }
  },
}

export const StudioProjectContext = {
  label(projectPath: string, fallback: string): string {
    const segments = projectPath.split('/').filter(Boolean)
    const leaf = segments.at(-1)
    if (leaf === undefined) {
      return fallback
    }
    return /^\d+\s*-\s*/.test(leaf) ? segments.at(-2) ?? fallback : leaf
  },
} as const

function sourceActionUsesRenderOccurrence(action: StudioCanonicalSourceAction): boolean {
  return action.kind === 'move-render'
    || action.kind === 'set-layout-entry'
    || action.kind === 'set-style-entry'
    || action.kind === 'wrap-render'
    || (action.kind === 'insert-component' || action.kind === 'insert-project-view')
      && (typeof action['beforeId'] === 'string' || typeof action['afterId'] === 'string')
}

type StudioScenarioPanelCommand =
  | Readonly<{
    arguments: StudioJsonObject
    cellId: string
    cellRevision: number
    kind: 'scenario-apply-arguments'
  }>
  | Readonly<{
    appearance: 'dark' | 'light'
    arguments: StudioJsonObject
    cellId: string
    cellRevision: number
    kind: 'scenario-save-arguments'
  }>
  | Readonly<{
    cellId: string
    cellRevision: number
    fixtureName: string
    kind: 'scenario-capture-fixture'
  }>
  | Readonly<{
    cellId: string
    cellRevision: number
    kind: 'scenario-replay-failure'
  }>
  | Readonly<{
    capture: unknown
    cellId: string
    cellRevision: number
    kind: 'scenario-replay-capture'
  }>

export function parseScenarioPanelCommand(name: string, payload: string): StudioScenarioPanelCommand {
  let value: unknown
  try {
    value = JSON.parse(payload) as unknown
  } catch {
    Errors.throwUserInput('Tao Studio scenario actions require a valid object payload.')
  }
  Assert.input(
    value !== null && typeof value === 'object',
    'Tao Studio scenario actions require an object payload.',
  )
  const input = value as Record<string, unknown>
  if (
    typeof input['cellId'] !== 'string'
    || input['cellId'].trim() === ''
    || !Number.isInteger(input['cellRevision'])
    || (input['cellRevision'] as number) < 0
  ) {
    Errors.throwUserInput('Tao Studio scenario actions require the active cell identity and revision.')
  }
  const identity = { cellId: input['cellId'], cellRevision: input['cellRevision'] as number }
  if (name === 'scenario-apply-arguments' || name === 'scenario-save-arguments') {
    if (!studioJsonObject(input['arguments'])) {
      Errors.throwUserInput('Tao Studio scenario arguments require a JSON object payload.')
    }
    const appearance = input['appearance']
    if (name === 'scenario-save-arguments' && appearance !== 'dark' && appearance !== 'light') {
      Errors.throwUserInput('Tao Studio scenario saves require a resolved light or dark appearance.')
    }
    return {
      ...identity,
      ...(name === 'scenario-save-arguments' ? { appearance } : {}),
      arguments: input['arguments'],
      kind: name,
    } as StudioScenarioPanelCommand
  }
  if (name === 'scenario-capture-fixture') {
    if (typeof input['fixtureName'] !== 'string') {
      Errors.throwUserInput('Tao Studio fixture capture requires a fixture name.')
    }
    return { ...identity, fixtureName: input['fixtureName'], kind: name }
  }
  if (name === 'scenario-replay-failure') {
    return { ...identity, kind: name }
  }
  if (name === 'scenario-replay-capture') {
    return { ...identity, capture: input['capture'], kind: name }
  }
  Errors.throwUserInput(`Unsupported Tao Studio scenario action: ${name}`)
}

function studioJsonObject(value: unknown): value is StudioJsonObject {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value).every(studioJsonValue)
}

function studioJsonValue(value: unknown): value is StudioJsonObject[keyof StudioJsonObject] {
  return value === null
    || typeof value === 'boolean'
    || typeof value === 'number' && Number.isFinite(value)
    || typeof value === 'string'
    || Array.isArray(value) && value.every(studioJsonValue)
    || studioJsonObject(value)
}
