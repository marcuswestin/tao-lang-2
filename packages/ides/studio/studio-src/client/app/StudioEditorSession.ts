import { EditorView } from 'codemirror'
import { type StudioDraftFile, StudioDraftSync } from '../../StudioDraftSync'
import { StudioTextMateLanguage } from '../../StudioTextMateLanguage'
import { StudioApiClient, type StudioCompileState, type StudioFile } from '../StudioApiClient'
import { StudioCodeEditor, studioHostDocumentUpdate, StudioOpenFileLifecycle } from '../StudioEditor'
import { StudioEditorTabs } from '../StudioEditorTabs'
import { showOpenFile, type StudioClientView } from '../StudioShell'
import { showSourceActionError } from '../StudioVisualEditing'
import { type StudioOpenDiagnostic, StudioStatusLine } from './StudioCompileEvents'
import { StudioPhoneSaveGate } from './StudioPhoneSaveGate'

export type StudioOpenFile = {
  editor: EditorView
  file: StudioDraftFile
}

export type StudioActiveEditor = StudioOpenFile & { path: string }

type StudioOpenEditorTab = StudioOpenFile & {
  dirty: boolean
  draft: StudioDraftSync
  stale: boolean
}

/** What a project-search pass reads for one open tab: the live text, and whether it is still what was saved. */
export type StudioOpenDocument = Readonly<{ content: string; saved: boolean }>

export type StudioEditorSessionDeps = Readonly<{
  compileState: () => StudioCompileState
  identity: Readonly<{ appName: string; project: string }>
  /** A document edit: the search panel re-runs when it has a query. */
  onDocumentChanged: () => void
  openCompileDiagnostic: StudioOpenDiagnostic
  /** Tells the active preview which source the editor now shows or selects. */
  postSelection: (file: StudioDraftFile, editor: EditorView) => void
  publish: () => void
  renderInspector: () => void
  signal: AbortSignal | undefined
  view: StudioClientView
}>

/**
 * The open editor tabs and the one that is active. Each tab's EditorView is a document and selection
 * model; the editor a person sees is the one Tao mounts into `.studio-editor`, so none of these is
 * ever attached to the DOM.
 */
export class StudioEditorSession {
  readonly #deps: StudioEditorSessionDeps
  readonly #lifecycle = new StudioOpenFileLifecycle()
  readonly #order: StudioEditorTabs
  readonly #phoneSaveGate: StudioPhoneSaveGate
  readonly #tabs = new Map<string, StudioOpenEditorTab>()
  #activePath: string | undefined
  #highlightRevision = 0
  #highlightTimer: ReturnType<typeof setTimeout> | undefined
  #preparedActiveMutationPath: string | undefined
  #preparedOpenMutationPath: string | undefined
  /** The tab strip marks a tab the server reports dirty on disk, so it keeps the current listing. */
  #projectFiles: readonly StudioFile[]

  constructor(deps: StudioEditorSessionDeps, projectFiles: readonly StudioFile[]) {
    this.#deps = deps
    this.#projectFiles = projectFiles
    this.#phoneSaveGate = new StudioPhoneSaveGate({
      onUnsynced: revision => {
        deps.view.status.dataset['state'] = 'idle'
        deps.view.status.dataset['phoneUnsyncedRevision'] = String(revision)
        deps.view.status.title = `The paired phone has not applied preview revision ${revision}.`
        deps.view.status.textContent =
          `Phone did not apply revision ${revision}; continuing browser-only. The phone is unsynced.`
      },
      onWaiting: revision => {
        deps.view.status.dataset['state'] = 'compiling'
        deps.view.status.textContent = `Save queued; waiting for the phone to apply revision ${revision}…`
      },
      status: async () => await StudioApiClient.deviceStatus(AbortSignal.timeout(1_000)),
    })
    this.#order = new StudioEditorTabs({
      appName: deps.identity.appName,
      availablePaths: projectFiles.map(file => file.path),
      project: deps.identity.project,
      storage: window.localStorage,
    })
  }

  active(): StudioActiveEditor | undefined {
    const path = this.#activePath
    const tab = path === undefined ? undefined : this.#tabs.get(path)
    return tab === undefined || path === undefined ? undefined : { editor: tab.editor, file: tab.file, path }
  }

  activeFile(): StudioDraftFile | undefined {
    return this.active()?.file
  }

  activePath(): string | undefined {
    return this.#activePath
  }

  editor(): EditorView | undefined {
    return this.active()?.editor
  }

  /** The live text of an open tab, for search; `saved` is false once it differs from the file on disk. */
  document(path: string): StudioOpenDocument | undefined {
    const tab = this.#tabs.get(path)
    if (tab === undefined) {
      return undefined
    }
    const content = tab.editor.state.doc.toString()
    return { content, saved: content === tab.file.content }
  }

  hasDirtyTabs(): boolean {
    return [...this.#tabs.values()].some(tab => tab.dirty)
  }

  async openFile(path: string, refresh = false): Promise<StudioOpenFile | undefined> {
    const { view } = this.#deps
    if (path === this.#activePath && !refresh) {
      const active = this.active()!
      return { editor: active.editor, file: active.file }
    }
    const attempt = this.#lifecycle.begin()
    if (!refresh) {
      const evictionPath = this.#order.evictionCandidate(path)
      const eviction = evictionPath === undefined ? undefined : this.#tabs.get(evictionPath)
      if (evictionPath !== undefined && eviction !== undefined && evictionPath !== this.#activePath) {
        if (this.#isUnsaved(eviction)) {
          this.#activateWithStatus(evictionPath, 'Save this file with ⌘S before opening another tab.')
          return eviction
        }
      }
      const existing = this.#tabs.get(path)
      if (existing !== undefined && !existing.stale) {
        this.#order.activate(path)
        this.activate(path)
        return existing
      }
    }
    const file = await StudioApiClient.file(path, this.#deps.signal)
    if (!attempt.isCurrent()) {
      return undefined
    }
    const fileDraftSync = new StudioDraftSync(file, {
      onResult: result => {
        const current = this.#tabs.get(path)
        if (current?.draft !== fileDraftSync) {
          return
        }
        if (result.saved) {
          current.file = result.file
          current.dirty = current.editor.state.doc.toString() !== result.file.content
          if (this.#activePath === path) {
            this.#deps.postSelection(result.file, current.editor)
            this.#deps.publish()
          }
        } else {
          current.dirty = true
        }
        this.#renderTabs()
        StudioStatusLine.draftResult(view.status, result, this.#deps.compileState(), this.#deps.openCompileDiagnostic)
      },
      write: async request => await this.#phoneSaveGate.run(async () => await StudioApiClient.draft(request)),
    })
    let fileTab!: StudioOpenEditorTab
    const fileEditor = new EditorView({
      doc: file.content,
      extensions: [
        StudioCodeEditor.extension,
        StudioTextMateLanguage.extension,
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            const content = update.state.doc.toString()
            fileTab.dirty = true
            fileDraftSync.update(content)
            this.#renderTabs()
            view.status.dataset['state'] = 'idle'
            view.status.textContent = 'Unsaved changes — press ⌘S to save.'
            this.#scheduleHighlight(update.view, content)
            this.#deps.onDocumentChanged()
          }
          const isActive = this.editor() === update.view
          if (isActive && update.selectionSet && !update.docChanged) {
            this.#deps.postSelection(fileTab.file, update.view)
          }
          if (isActive && (update.docChanged || update.selectionSet)) {
            this.#deps.publish()
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
    this.#tabs.get(path)?.editor.destroy()
    this.#tabs.set(path, fileTab)
    const snapshot = this.#order.open(path)
    for (const [candidatePath, candidate] of this.#tabs) {
      if (!snapshot.paths.includes(candidatePath)) {
        candidate.editor.destroy()
        this.#tabs.delete(candidatePath)
      }
    }
    this.activate(path)
    return fileTab
  }

  activate(path: string): void {
    const tab = this.#tabs.get(path)
    if (tab === undefined) {
      return
    }
    this.#highlightRevision += 1
    clearTimeout(this.#highlightTimer)
    this.#activePath = path
    showOpenFile(this.#deps.view, path)
    this.#renderTabs()
    this.#scheduleHighlight(tab.editor, tab.editor.state.doc.toString(), 0)
    this.#deps.postSelection(tab.file, tab.editor)
    this.#deps.renderInspector()
    this.#deps.publish()
  }

  async close(path: string): Promise<void> {
    const tab = this.#tabs.get(path)
    if (tab === undefined) {
      return
    }
    if (this.#isUnsaved(tab)) {
      this.#activateWithStatus(path, 'Save this file with ⌘S before closing its tab.')
      return
    }
    const wasActive = path === this.#activePath
    const snapshot = this.#order.close(path)
    this.#tabs.delete(path)
    tab.editor.destroy()
    if (wasActive) {
      this.#activePath = undefined
      if (snapshot.activePath !== undefined) {
        this.activate(snapshot.activePath)
      } else {
        this.#deps.view.breadcrumbs.replaceChildren()
        this.#deps.renderInspector()
        this.#deps.publish()
      }
    }
    this.#renderTabs()
  }

  /** Refuses with `message` in the status line, showing the first unsaved tab, when any tab is unsaved. */
  requireAllSaved(message: string): boolean {
    for (const path of this.#order.snapshot().paths) {
      const tab = this.#tabs.get(path)
      if (tab !== undefined && this.#isUnsaved(tab)) {
        this.#activateWithStatus(path, message)
        return false
      }
    }
    return true
  }

  /** A visual source edit lands on the saved file, so the active draft must match it first. */
  requireActiveDraftSaved(): boolean {
    const active = this.active()
    if (active !== undefined && active.editor.state.doc.toString() === active.file.content) {
      return true
    }
    this.#deps.view.status.dataset['state'] = 'error'
    this.#deps.view.status.textContent = 'Save this file with ⌘S before applying a visual source edit.'
    return false
  }

  async saveActive(): Promise<void> {
    const tab = this.#activePath === undefined ? undefined : this.#tabs.get(this.#activePath)
    if (tab === undefined || !tab.dirty) {
      this.#deps.view.status.dataset['state'] = 'idle'
      this.#deps.view.status.textContent = 'No unsaved changes.'
      return
    }
    try {
      await tab.draft.save()
    } catch (error) {
      showSourceActionError(this.#deps.view.status, error)
    }
  }

  /** Replaces the active document wholesale; the product host's editor pushes its text through here. */
  replaceActiveContent(content: string, selection?: Readonly<{ anchor: number; head: number }>): void {
    const editor = this.editor()
    if (editor === undefined) {
      return
    }
    const current = editor.state.doc.toString()
    if (selection === undefined) {
      if (current === content) {
        return
      }
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } })
      return
    }
    const next = studioHostDocumentUpdate(editor.state.doc.length, content, selection)
    if (
      current === content
      && editor.state.selection.main.anchor === next.selection.anchor
      && editor.state.selection.main.head === next.selection.head
    ) {
      return
    }
    editor.dispatch(current === content ? { selection: next.selection } : next)
  }

  /** Reopens the tabs the last session left open, falling back to the entry file. */
  async restore(entryPath: string, throwIfAborted: () => void): Promise<void> {
    const restored = this.#order.snapshot()
    const paths = restored.paths.length === 0 ? [entryPath] : restored.paths
    for (const path of paths) {
      await this.openFile(path)
      throwIfAborted()
    }
    if (restored.activePath !== undefined && restored.activePath !== this.#activePath) {
      await this.openFile(restored.activePath)
      throwIfAborted()
    }
  }

  /**
   * Prepares a file-tree mutation (rename, delete, move) of `file`: remembers which tab it touches so
   * the transition after the server answers can reopen the right path, and refuses while it is unsaved.
   */
  async prepareMutation(
    file: StudioFile,
    projectFiles: () => readonly StudioFile[],
    refreshTree: () => Promise<void>,
  ): Promise<StudioFile | undefined> {
    this.#preparedActiveMutationPath = this.#activePath
    const tab = this.#tabs.get(file.path)
    this.#preparedOpenMutationPath = tab === undefined ? undefined : file.path
    if (tab === undefined) {
      return projectFiles().find(candidate => candidate.path === file.path)
    }
    if (this.#isUnsaved(tab)) {
      this.#activateWithStatus(file.path, 'Save this file with ⌘S before changing it.')
      return undefined
    }
    await refreshTree()
    return projectFiles().find(candidate => candidate.path === file.path)
  }

  /** The paths `prepareMutation` recorded, cleared so the next mutation starts clean. */
  consumePreparedMutation(): Readonly<{ activePath: string | undefined; openPath: string | undefined }> {
    const prepared = { activePath: this.#preparedActiveMutationPath, openPath: this.#preparedOpenMutationPath }
    this.#preparedActiveMutationPath = undefined
    this.#preparedOpenMutationPath = undefined
    return prepared
  }

  /** Follows a new project listing: renames the prepared tab, drops removed tabs, marks changed ones stale. */
  reconcileFiles(previousFiles: readonly StudioFile[], files: readonly StudioFile[]): void {
    this.#projectFiles = files
    const available = new Set(files.map(file => file.path))
    if (this.#preparedOpenMutationPath !== undefined && !available.has(this.#preparedOpenMutationPath)) {
      const previousPaths = new Set(previousFiles.map(file => file.path))
      const added = files.filter(file => !previousPaths.has(file.path))
      if (added.length === 1) {
        this.#order.rename(this.#preparedOpenMutationPath, added[0]!.path)
      }
    }
    const snapshot = this.#order.reconcile([...available])
    let activeWasRemoved = false
    for (const [path, tab] of this.#tabs) {
      if (!available.has(path)) {
        activeWasRemoved ||= path === this.#activePath
        tab.editor.destroy()
        this.#tabs.delete(path)
        continue
      }
      const metadata = files.find(file => file.path === path)
      if (
        metadata !== undefined
        && metadata.sourceVersion !== tab.file.sourceVersion
        && !tab.dirty
        && path !== this.#activePath
      ) {
        tab.stale = true
      }
    }
    if (activeWasRemoved) {
      this.#activePath = undefined
      this.#deps.publish()
      if (snapshot.activePath !== undefined && this.#tabs.has(snapshot.activePath)) {
        this.activate(snapshot.activePath)
      } else {
        this.#deps.view.breadcrumbs.replaceChildren()
      }
    }
    this.#renderTabs()
  }

  /** A file changed on disk: a clean tab goes stale (and the active one reloads); a dirty one is warned. */
  applyFileEvent(file: StudioFile): void {
    const tab = this.#tabs.get(file.path)
    if (tab === undefined || file.sourceVersion === tab.file.sourceVersion) {
      return
    }
    if (tab.editor.state.doc.toString() === tab.file.content) {
      tab.stale = true
    }
    if (file.path === this.#activePath && tab.stale) {
      void this.openFile(file.path, true)
    } else if (file.path === this.#activePath) {
      this.#deps.view.status.dataset['state'] = 'error'
      this.#deps.view.status.textContent = 'This file changed on disk while the editor has an unsaved draft.'
    }
  }

  dispose(): void {
    clearTimeout(this.#highlightTimer)
    for (const tab of this.#tabs.values()) {
      tab.editor.destroy()
    }
  }

  #isUnsaved(tab: StudioOpenEditorTab): boolean {
    return tab.dirty || tab.editor.state.doc.toString() !== tab.file.content
  }

  #activateWithStatus(path: string, message: string): void {
    this.#order.activate(path)
    this.activate(path)
    this.#deps.view.status.dataset['state'] = 'error'
    this.#deps.view.status.textContent = message
  }

  #renderTabs(): void {
    const metadata = new Map(this.#projectFiles.map(file => [file.path, file]))
    const items = this.#order.snapshot().paths.flatMap(path => {
      const tab = this.#tabs.get(path)
      if (tab === undefined) {
        return []
      }
      const item = document.createElement('span')
      item.className = 'studio-editor-tab-item'
      if (path === this.#activePath) {
        item.setAttribute('aria-current', 'page')
      }
      const activate = document.createElement('button')
      activate.className = 'studio-editor-tab'
      activate.type = 'button'
      activate.title = path
      const label = path.split('/').at(-1) ?? path
      activate.textContent = `${tab.dirty || metadata.get(path)?.dirty === true ? '● ' : ''}${label}`
      activate.addEventListener('click', () => void this.openFile(path))
      const close = document.createElement('button')
      close.className = 'studio-editor-tab-close'
      close.type = 'button'
      close.title = `Close ${path}`
      close.setAttribute('aria-label', `Close ${path}`)
      close.textContent = '×'
      close.addEventListener('click', () => void this.close(path))
      item.append(activate, close)
      return [item]
    })
    this.#deps.view.editorTabs.replaceChildren(...items)
  }

  #scheduleHighlight(target: EditorView, content: string, delayMs = 60): void {
    const revision = ++this.#highlightRevision
    clearTimeout(this.#highlightTimer)
    this.#highlightTimer = setTimeout(() => {
      void StudioApiClient.highlight(content).then(highlight => {
        if (
          revision === this.#highlightRevision
          && this.editor() === target
          && target.state.doc.toString() === content
        ) {
          target.dispatch({ effects: StudioTextMateLanguage.setHighlight(highlight) })
        }
      }).catch(() => {
        // Highlighting is presentation-only; LSP editing and preview compilation remain available.
      })
    }, delayMs)
  }
}
