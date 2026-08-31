import { languageServerExtensions, LSPClient } from '@codemirror/lsp-client'
import type { StudioRenderInspection } from '@source-actions'
import { EditorView } from 'codemirror'
import { type StudioDraftFile, StudioDraftSync, type StudioDraftSyncResult } from '../StudioDraftSync'
import {
  StudioInspector,
  type StudioInspectorSelection,
  studioPaletteComponents,
} from '../StudioInspector'
import type { StudioPreviewManifestV2 } from '../StudioPreviewManifest'
import {
  publishStudioProductHostState,
  registerStudioProductHostActions,
} from '../StudioProductHostProtocol'
import type { StudioDesignValue } from '../StudioProjectSession'
import {
  type StudioCanonicalSourceAction,
  type StudioPreviewSourceIdentity,
  type StudioSourceActionEnvelope,
} from '../StudioProtocol'
import type { StudioTestFailure, StudioTestStatus } from '../StudioTestRunner'
import { StudioTextMateLanguage } from '../StudioTextMateLanguage'
import {
  StudioApiClient,
  StudioApiRoutes,
  type StudioCompileDiagnostic,
  type StudioCompileState,
  type StudioFile,
  type StudioLspTransport,
} from './StudioApiClient'
import {
  fileUri,
  isStudioSaveShortcut,
  projectRelativePath,
  sanitizeLspHtml,
  StudioCodeEditor,
  StudioDiagnosticNavigation,
  StudioEditorInsertion,
  StudioOpenFileLifecycle,
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
  refreshCellPreviews,
  renderScenarioInspector,
  requestRuntimeCapture,
  StudioActivePreview,
  StudioRuntimeData,
  type StudioRuntimeDataTable,
} from './StudioMatrixView'
import {
  renderCommandResults,
  renderDesignValues,
  renderDrawerContent,
  type StudioCommandItem,
  StudioCommandPalette,
  type StudioDrawerTab,
} from './StudioProductPanels'
import {
  renderScreens,
  renderSearchResults,
  StudioRailPanels,
  type StudioScreenItem,
  type StudioSearchResult,
} from './StudioRailPanels'
import {
  createStudioShell,
  showOpenFile,
  type StudioClientConfig,
} from './StudioShell'
import {
  renderComponentPalette,
  renderInspectorAccordions,
  renderProjectViews,
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

export type StudioMountOptions = Readonly<{ embedded?: boolean; root?: HTMLElement; signal?: AbortSignal }>

export async function mountStudio(options: StudioMountOptions = {}): Promise<() => void> {
  const root = options.root ?? document.querySelector<HTMLElement>('#tao-studio-root')
  if (root === null) {
    throw new Error('Tao Studio root is missing.')
  }

  const config = window.TaoStudioConfig ?? {}
  const view = createStudioShell(root, config, { embedded: options.embedded })
  const partialOpenTabs = new Map<string, StudioOpenEditorTab>()
  let partialPreviews: Awaited<ReturnType<typeof connectPreviews>> = []
  let partialLanguageClient: LSPClient | undefined
  let partialTransport: StudioLspTransport | undefined
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

    const transport = await StudioApiClient.lspTransport(options.signal)
    partialTransport = transport
    throwIfMountAborted(options.signal)
    const languageClient = new LSPClient({
      extensions: languageServerExtensions(),
      rootUri: fileUri(handshake.identity.project),
      sanitizeHTML: sanitizeLspHtml,
      timeout: 10_000,
    }).connect(transport)
    partialLanguageClient = languageClient
    await languageClient.initializing
    throwIfMountAborted(options.signal)

    let editor: EditorView | undefined
    let compileState = handshake.compile
    let dataError: string | undefined
    let dataLoading = false
    let dataResult: readonly StudioRuntimeDataTable[] = []
    let dataTimer: ReturnType<typeof setInterval> | undefined
    let designRequestRevision = 0
    let designValues: readonly StudioDesignValue[] = []
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
    let searchRevision = 0
    let searchTimer: ReturnType<typeof setTimeout> | undefined
    let sourceActionBusy = false
    let testError: string | undefined
    let testStatus: StudioTestStatus | undefined
    let testWatch = false
    const undoCheckpoints: Array<{ id: string; path: string }> = []
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
            scenarioId: preview.cell.scenarioId,
            schemeRequested: preview.cell.environment.scheme.requested,
            schemeStatus: preview.cell.environment.scheme.status,
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
          showDraftResult(view.status, result)
        },
        write: StudioApiClient.draft,
      })
      let fileEditor!: EditorView
      let fileTab!: StudioOpenEditorTab
      fileEditor = new EditorView({
        doc: file.content,
        extensions: [
          StudioCodeEditor.extension,
          StudioTextMateLanguage.extension,
          languageClient.plugin(fileUri(handshake.identity.project, path), 'tao'),
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              const content = update.state.doc.toString()
              fileTab.dirty = true
              fileDraftSync.update(content)
              renderEditorTabs()
              view.status.dataset['state'] = 'idle'
              view.status.textContent = 'Unsaved changes — press ⌘S to save.'
              scheduleHighlight(update.view, content)
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
        parent: view.editor,
      })
      configurePaletteEditorDrop(fileEditor)
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
      for (const candidate of openTabs.values()) {
        candidate.editor.dom.hidden = candidate !== tab
      }
      activeFile = tab.file
      activePath = path
      editor = tab.editor
      designValues = []
      fileTree?.render()
      showOpenFile(view, path)
      renderEditorTabs()
      renderProjectViews(view.projectViews, previewManifest, insertProjectView)
      scheduleHighlight(tab.editor, tab.editor.state.doc.toString(), 0)
      renderInspector()
      publishProductHostState()
      const designRevision = ++designRequestRevision
      void StudioApiClient.design({ path: tab.file.path, sourceVersion: tab.file.sourceVersion }).then(values => {
        if (designRevision === designRequestRevision && activeFile?.sourceVersion === tab.file.sourceVersion) {
          designValues = values
          renderDesignEditor()
        }
      }).catch(error => {
        if (designRevision === designRequestRevision) {
          designValues = []
          view.status.dataset['state'] = 'error'
          view.status.textContent = error instanceof Error ? error.message : String(error)
          renderDesignEditor()
        }
      })
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
          fileTree?.render()
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
        renderSearchResults(view.searchResults, [], result => void openSearchResult(result))
        return
      }
      let documents: Array<{ content: string; path: string }>
      try {
        documents = await Promise.all(projectFiles.map(async file => ({
          content: openTabs.get(file.path)?.editor.state.doc.toString()
            ?? await cachedSearchDocument(file),
          path: file.path,
        })))
      } catch (error) {
        if (revision === searchRevision) {
          showSourceActionError(view.status, error)
        }
        return
      }
      if (revision !== searchRevision) {
        return
      }
      renderSearchResults(
        view.searchResults,
        StudioRailPanels.search(documents, compileState.diagnostics ?? [], query),
        result => void openSearchResult(result),
      )
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

    function renderInspector(): void {
      const scenarioPanel = document.createElement('section')
      scenarioPanel.className = 'studio-scenario-inspector'
      renderScenarioInspector(scenarioPanel, activePreview.current())
      view.scenarioInspector.replaceChildren(scenarioPanel)
      const sourcePanel = document.createElement('section')
      renderInspectorAccordions(sourcePanel, {
        busy: sourceActionBusy,
        canUndo: undoCheckpoints.at(-1)?.path === activePath,
        currentSourceVersion: activeFile?.sourceVersion,
        inspection,
        onAction: action => {
          if (inspected !== undefined) {
            void submitLocalAction(action, inspected.identity)
          }
        },
        onUndo: () => void undoLatestSourceAction(),
        selection: inspected,
      })
      view.inspector.replaceChildren(sourcePanel)
      renderDesignEditor()
    }

    function renderDesignEditor(): void {
      renderDesignValues(view.designValues, {
        busy: sourceActionBusy,
        currentSourceVersion: activeFile?.sourceVersion,
        design: designValues,
        onAction: action => {
          if (inspected !== undefined) {
            void submitLocalAction(action, inspected.identity)
          }
        },
        renderId: inspected?.renderId,
        selectedSourceVersion: inspected?.identity.sourceVersion,
      })
    }

    function renderDrawer(): void {
      renderDrawerContent(view.drawerContent, drawerTab, {
        compile: compileState,
        data: dataResult,
        dataError,
        dataLoading,
        logs: activePreview.current()?.runtimeLogs ?? [],
        onCaptureFixture: focusCaptureFixture,
        onClearLogs() {
          const preview = activePreview.current()
          if (preview !== undefined) {
            preview.runtimeLogs = []
          }
          renderDrawer()
        },
        onDiagnostic: diagnostic => void openCompileDiagnostic(diagnostic),
        onRefreshData: () => void loadData(),
        onRunTests: () => void runTests(),
        onTestFailure: failure => void openTestFailure(failure),
        onTestWatch(watch) {
          testWatch = watch
          if (watch) {
            void runTests()
          }
        },
        testError,
        testStatus,
        testWatch,
      })
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
        if (preview === undefined) {
          throw new Error('Select a connected preview cell to inspect live app data.')
        }
        const capture = await requestRuntimeCapture(preview, handshake)
        if (isLatest() && preview === activePreview.current()) {
          dataResult = StudioRuntimeData.tables(capture)
          dataLoading = false
          renderDrawer()
        }
      } catch (error) {
        if (isLatest()) {
          dataLoading = false
          dataError = error instanceof Error ? error.message : String(error)
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
        testError = error instanceof Error ? error.message : String(error)
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
        testError = error instanceof Error ? error.message : String(error)
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

    function configurePaletteEditorDrop(target: EditorView): void {
      target.dom.addEventListener('dragover', event => {
        if (event.dataTransfer?.types.includes(studioPaletteMime)) {
          event.preventDefault()
        }
      })
      target.dom.addEventListener('drop', event => {
        const item = StudioPaletteTransfer.parse(event.dataTransfer?.getData(studioPaletteMime) ?? '')
        if (item === undefined) {
          return
        }
        event.preventDefault()
        const position = target.posAtCoords({ x: event.clientX, y: event.clientY }) ?? target.state.selection.main.head
        insertEditorSnippet(target, item.snippet, position)
        target.focus()
      })
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

    async function applySourceAction(envelope: StudioSourceActionEnvelope): Promise<void> {
      sourceActionBusy = true
      renderInspector()
      view.status.dataset['state'] = 'compiling'
      view.status.textContent = `Applying ${sourceActionLabel(envelope.action)}…`
      try {
        const result = await StudioApiClient.sourceAction(envelope)
        if (result.checkpoint.status === 'committed' && undoCheckpoints.at(-1)?.id !== result.checkpoint.id) {
          undoCheckpoints.push({ id: result.checkpoint.id, path: result.path })
        }
        inspected = undefined
        inspection = undefined
        publishProductHostState()
        await openFile(result.path, true)
        view.status.textContent = 'Source action applied; compiling preview…'
      } catch (error) {
        showSourceActionError(view.status, error)
      } finally {
        sourceActionBusy = false
        renderInspector()
      }
    }

    async function submitLocalAction(
      action: StudioCanonicalSourceAction,
      identity: StudioPreviewSourceIdentity,
    ): Promise<void> {
      if (sourceActionBusy || !requireVisualEditDraftSaved()) {
        return
      }
      if (activeFile === undefined || identity.sourceVersion !== activeFile.sourceVersion) {
        view.status.dataset['state'] = 'error'
        view.status.textContent = 'Wait for the refreshed preview before editing this render.'
        return
      }
      const operationId = crypto.randomUUID()
      await applySourceAction(StudioInspector.singleAction({
        action,
        checkpointId: `checkpoint:${operationId}`,
        identity,
        requestId: `request:${operationId}`,
      }))
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
      const identity = currentSourceIdentity(handshake, activePreview.current(), activeFile)
      if (identity === undefined) {
        return
      }
      sourceActionBusy = true
      renderInspector()
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
        view.status.textContent = 'Visual source edit undone; compiling preview…'
      } catch (error) {
        showSourceActionError(view.status, error)
      } finally {
        sourceActionBusy = false
        renderInspector()
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
      publishProductHostState()
      renderInspector()
      renderDrawer()
      if (drawerTab === 'Data') {
        void loadData()
      }
    })
    activePreview.reconcile(wirePreview)
    renderScreens(view.screens, previewManifest, item => void openScreen(item))
    renderSearchResults(view.searchResults, [], result => void openSearchResult(result))
    view.searchInput.addEventListener('input', () => scheduleSearch())

    renderComponentPalette(view.components, insertComponent)
    view.preview.addEventListener('dragover', event => {
      if (event.dataTransfer?.types.includes(studioPaletteMime)) {
        event.preventDefault()
      }
    })
    view.preview.addEventListener('drop', event => {
      const item = StudioPaletteTransfer.parse(event.dataTransfer?.getData(studioPaletteMime) ?? '')
      const identity = currentSourceIdentity(handshake, activePreview.current(), activeFile)
      if (item === undefined || identity === undefined || inspected === undefined) {
        return
      }
      event.preventDefault()
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

    fileTree = mountStudioFileTree(view.files, {
      activePath: () => activePath,
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
      onError: error => showSourceActionError(view.status, error),
      onFiles: publishProjectFiles,
      onOpen: file => void openFile(file.path),
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
      protectedPath: handshake.entryPath,
      renderDom: options.embedded !== true,
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
      onFiles(files) {
        fileTree?.setFiles(files)
      },
      onManifest(manifest) {
        previewManifest = manifest
        renderProjectViews(view.projectViews, manifest, insertProjectView)
        renderScreens(view.screens, manifest, item => void openScreen(item))
        if (config.previewUrl !== undefined) {
          void refreshCellPreviews(view.preview, previews, config.previewUrl, manifest, handshake).then(() => {
            activePreview.reconcile(wirePreview)
          }).catch(error => {
            view.status.dataset['state'] = 'error'
            view.status.textContent = error instanceof Error ? error.message : String(error)
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
      if ([...openTabs.values()].some(tab => tab.dirty)) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnloadListener)
    const unregisterProductHost = registerStudioProductHostActions({
      async applyActiveCellEnvironment(environment) {
        const preview = activePreview.current()
        if (preview?.cell === undefined || preview.reconfigureEnvironment === undefined) {
          throw new Error('Select a Studio scenario cell before changing its environment.')
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
      async openFile(path) {
        if (!projectFiles.some(file => file.path === path)) {
          throw new Error(`Tao Studio file is no longer available: ${path}`)
        }
        await openFile(path)
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
      languageClient.disconnect()
      transport.close()
    }
    return cleanup
  } catch (error) {
    for (const tab of partialOpenTabs.values()) {
      tab.editor.destroy()
    }
    disconnectPreviews(partialPreviews)
    partialLanguageClient?.disconnect()
    partialTransport?.close()
    if (!isAbortError(error)) {
      view.status.dataset['state'] = 'error'
      view.status.textContent = error instanceof Error ? error.message : String(error)
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

function showDraftResult(element: HTMLElement, result: StudioDraftSyncResult): void {
  if (result.saved) {
    element.dataset['state'] = 'compiling'
    element.textContent = 'Saved; compiling preview…'
    return
  }
  element.dataset['state'] = 'error'
  element.textContent = result.diagnostics[0] ?? 'Draft is not valid Tao yet; preview kept the last good source.'
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
