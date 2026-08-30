import { languageServerExtensions, LSPClient, type Transport } from '@codemirror/lsp-client'
import { EditorState, type Extension } from '@codemirror/state'
import { basicSetup, EditorView } from 'codemirror'
import { type StudioDraftFile, StudioDraftSync, type StudioDraftSyncResult } from './StudioDraftSync'
import type { StudioLanguageHighlight } from './StudioHighlight'
import {
  StudioInspector,
  studioInspectorLayoutActions,
  type StudioInspectorSelection,
  studioPaletteComponents,
} from './StudioInspector'
import type {
  StudioCellEnvironment,
  StudioCellIdentity,
  StudioParameterSchema,
  StudioPreviewCell,
  StudioPreviewManifestV1,
} from './StudioPreviewManifest'
import {
  type StudioCanonicalSourceAction,
  type StudioFixturePlan,
  type StudioFixtureValue,
  type StudioJsonObject,
  type StudioJsonValue,
  type StudioPreviewSourceIdentity,
  StudioProtocol,
  studioProtocolChannel,
  studioProtocolVersion,
  type StudioSourceActionEnvelope,
} from './StudioProtocol'
import { StudioTextMateLanguage } from './StudioTextMateLanguage'

type StudioClientConfig = {
  previewUrl?: string
}

type StudioCompileState = {
  appliedRevision: number
  compileRevision: number
  diagnostics?: readonly StudioCompileDiagnostic[]
  message: string
  status: 'idle' | 'compiling' | 'compiled' | 'error'
}

type StudioCompileDiagnostic = {
  filePath?: string
  message: string
  range?: StudioDiagnosticRange
}

type StudioDiagnosticRange = {
  end: { character: number; line: number }
  start: { character: number; line: number }
}

type StudioHandshake = {
  compile: StudioCompileState
  entryPath: string
  files: readonly StudioFile[]
  identity: { appName: string; project: string }
  previewManifest?: StudioPreviewManifestV1
}

type StudioFile = {
  path: string
  sourceVersion: string
}

type StudioEvent =
  | { state: StudioCompileState; type: 'compile-state' }
  | { file: StudioFile; type: 'file-changed' }
  | { manifest: StudioPreviewManifestV1; type: 'preview-manifest-changed' }
  | { type: 'studio-writes-acknowledged' }

type StudioPreviewConnection = {
  capture?: {
    button: HTMLButtonElement
    fixtureName: string
    identity: StudioPreviewSourceIdentity
    requestId: string
    status: HTMLElement
    timeout: ReturnType<typeof setTimeout>
  }
  cell?: StudioPreviewCell
  cellIdentity?: StudioCellIdentity
  frame?: HTMLElement
  iframe: HTMLIFrameElement
  interactionMode: StudioInteractionMode
  origin: string
  previewInstanceId: string
  refresh?: Promise<void>
  scenarioDetailsOpen?: boolean
}

type StudioInteractionMode = 'edit' | 'run'

type StudioCellRuntimeResponse = {
  cell: StudioPreviewCell
  identity: StudioCellIdentity
}

type StudioOpenFile = {
  editor: EditorView
  file: StudioDraftFile
}

type StudioSourceActionResult = {
  checkpoint: { id: string; status: 'committed' | 'open' }
  content: string
  path: string
  sourceVersion: string
}

type StudioSourceActionUndoResult = {
  checkpoint: { id: string; status: 'undone' }
  content: string
  path: string
  sourceVersion: string
}

type StudioClientView = {
  components: HTMLElement
  editor: HTMLElement
  files: HTMLElement
  inspector: HTMLElement
  interactionMode: HTMLButtonElement
  preview: HTMLElement
  project: HTMLElement
  projectViews: HTMLElement
  reload: HTMLButtonElement
  status: HTMLElement
}

declare global {
  interface Window {
    TaoStudioConfig?: StudioClientConfig
  }
}

export type StudioOpenFileAttempt = {
  isCurrent: () => boolean
}

/** CodeMirror's standard keymap plus the Tao syntax data its commands require. */
export const StudioCodeEditor = {
  extension: [
    basicSetup,
    EditorState.languageData.of(() => [{ commentTokens: { line: '//' } }]),
  ] as Extension,
} as const

/** Invalidates async file opens as soon as a newer navigation begins. */
export class StudioOpenFileLifecycle {
  #revision = 0

  begin(): StudioOpenFileAttempt {
    const revision = ++this.#revision
    return { isCurrent: () => revision === this.#revision }
  }
}

/** Converts a zero-based compiler range into a bounded CodeMirror selection. */
export const StudioDiagnosticNavigation = {
  selection(
    document: { line(number: number): { from: number; to: number }; lines: number },
    range: StudioDiagnosticRange,
  ): { anchor: number; head: number } {
    const startLine = document.line(Math.min(document.lines, Math.max(1, range.start.line + 1)))
    const endLine = document.line(Math.min(document.lines, Math.max(1, range.end.line + 1)))
    const anchor = Math.min(startLine.to, startLine.from + Math.max(0, range.start.character))
    const head = Math.max(anchor, Math.min(endLine.to, endLine.from + Math.max(0, range.end.character)))
    return { anchor, head }
  },
} as const

if (typeof document !== 'undefined') {
  void mountStudio()
}

async function mountStudio(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#tao-studio-root')
  if (root === null) {
    throw new Error('Tao Studio root is missing.')
  }

  const config = window.TaoStudioConfig ?? {}
  const view = createShell(root, config)
  try {
    const handshake = await request<StudioHandshake>('/api/protocol')
    view.project.textContent = `${handshake.identity.appName} — ${handshake.identity.project}`
    updateStatus(view.status, handshake.compile, diagnostic => void openCompileDiagnostic(diagnostic))
    const previews = await connectPreviews(view.preview, config.previewUrl, handshake)
    const preview = previews[0]
    configureInteractionMode(view.interactionMode, previews, handshake)

    const transport = await webSocketTransport(webSocketUrl('/api/language/lsp'))
    const languageClient = new LSPClient({
      extensions: languageServerExtensions(),
      rootUri: fileUri(handshake.identity.project),
      sanitizeHTML: sanitizeLspHtml,
      timeout: 10_000,
    }).connect(transport)
    await languageClient.initializing

    let editor: EditorView | undefined
    let draftSync: StudioDraftSync | undefined
    let highlightRequestRevision = 0
    let highlightTimer: ReturnType<typeof setTimeout> | undefined
    let activeFile: StudioDraftFile | undefined
    let activePath: string | undefined
    let inspected: StudioInspectorSelection | undefined
    let sourceActionBusy = false
    const undoCheckpoints: Array<{ id: string; path: string }> = []
    const openFileLifecycle = new StudioOpenFileLifecycle()

    async function openFile(path: string, refresh = false): Promise<StudioOpenFile | undefined> {
      if (path === activePath && !refresh) {
        return { editor: editor!, file: activeFile! }
      }
      const attempt = openFileLifecycle.begin()
      if (!refresh) {
        const result = await draftSync?.flush()
        if (!attempt.isCurrent()) {
          return undefined
        }
        if (result?.saved === false) {
          view.status.dataset['state'] = 'error'
          view.status.textContent = 'Fix or revert the invalid Tao draft before switching files.'
          return { editor: editor!, file: activeFile! }
        }
      }
      const file = await request<StudioDraftFile>(`/api/file?path=${encodeURIComponent(path)}`)
      if (!attempt.isCurrent()) {
        return undefined
      }
      highlightRequestRevision += 1
      clearTimeout(highlightTimer)
      activeFile = file
      activePath = path
      markActiveFile(view.files, path)
      renderProjectViews(view.projectViews, file.content, viewName => {
        const identity = currentSourceIdentity(handshake, preview, activeFile)
        if (identity !== undefined) {
          void submitLocalAction({ kind: 'insert-project-view', viewName }, identity)
        }
      })
      const fileDraftSync = new StudioDraftSync(file, {
        onResult(result) {
          if (draftSync !== fileDraftSync) {
            return
          }
          if (result.saved) {
            activeFile = result.file
            if (editor === fileEditor) {
              postEditorSelection(preview, handshake, activeFile, editor)
            }
          }
          showDraftResult(view.status, result)
        },
        write: async draft =>
          await request<StudioDraftSyncResult>('/api/file/draft', {
            body: JSON.stringify(draft),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          }),
      })
      const previousEditor = editor
      let fileEditor!: EditorView
      fileEditor = new EditorView({
        doc: file.content,
        extensions: [
          StudioCodeEditor.extension,
          StudioTextMateLanguage.extension,
          languageClient.plugin(fileUri(handshake.identity.project, path), 'tao'),
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              const content = update.state.doc.toString()
              fileDraftSync.update(content)
              scheduleHighlight(update.view, content)
            }
            if (editor === update.view && update.selectionSet && !update.docChanged) {
              postEditorSelection(preview, handshake, activeFile, update.view)
            }
          }),
          EditorView.theme({
            '&': { backgroundColor: '#171918', color: '#e8e7e3' },
            '.cm-content': { caretColor: '#f3c969' },
            '.cm-gutters': { backgroundColor: '#202321', border: 'none', color: '#6f786f' },
            '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#252a26' },
          }, { dark: true }),
        ],
        parent: view.editor,
      })
      draftSync = fileDraftSync
      editor = fileEditor
      previousEditor?.destroy()
      scheduleHighlight(fileEditor, file.content, 0)
      renderInspector()
      return { editor: fileEditor, file }
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

    function scheduleHighlight(target: EditorView, content: string, delayMs = 60): void {
      const revision = ++highlightRequestRevision
      clearTimeout(highlightTimer)
      highlightTimer = setTimeout(() => {
        void request<StudioLanguageHighlight>('/api/language/highlight', {
          body: JSON.stringify({ content }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }).then(highlight => {
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
      renderInspectorPanel(view.inspector, {
        busy: sourceActionBusy,
        canUndo: undoCheckpoints.at(-1)?.path === activePath,
        currentSourceVersion: activeFile?.sourceVersion,
        onAction: action => {
          if (inspected !== undefined) {
            void submitLocalAction(action, inspected.identity)
          }
        },
        onUndo: () => void undoLatestSourceAction(),
        selection: inspected,
      })
    }

    async function applySourceAction(envelope: StudioSourceActionEnvelope): Promise<void> {
      sourceActionBusy = true
      renderInspector()
      view.status.dataset['state'] = 'compiling'
      view.status.textContent = `Applying ${sourceActionLabel(envelope.action)}…`
      try {
        const result = await request<StudioSourceActionResult>('/api/source-action', {
          body: JSON.stringify(envelope),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        })
        if (result.checkpoint.status === 'committed' && undoCheckpoints.at(-1)?.id !== result.checkpoint.id) {
          undoCheckpoints.push({ id: result.checkpoint.id, path: result.path })
        }
        inspected = undefined
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
      if (sourceActionBusy || !await flushVisualEditDraft()) {
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
      if (sourceActionBusy || !await flushVisualEditDraft()) {
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
        checkpoint === undefined || checkpoint.path !== activePath || sourceActionBusy || !await flushVisualEditDraft()
      ) {
        return
      }
      const identity = currentSourceIdentity(handshake, preview, activeFile)
      if (identity === undefined) {
        return
      }
      sourceActionBusy = true
      renderInspector()
      try {
        const result = await request<StudioSourceActionUndoResult>('/api/source-action/undo', {
          body: JSON.stringify(StudioInspector.undo({
            checkpointId: checkpoint.id,
            identity,
            requestId: `undo:${crypto.randomUUID()}`,
          })),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        })
        undoCheckpoints.pop()
        inspected = undefined
        await openFile(result.path, true)
        view.status.textContent = 'Visual source edit undone; compiling preview…'
      } catch (error) {
        showSourceActionError(view.status, error)
      } finally {
        sourceActionBusy = false
        renderInspector()
      }
    }

    async function flushVisualEditDraft(): Promise<boolean> {
      await draftSync?.flush()
      if (activeFile !== undefined && editor?.state.doc.toString() === activeFile.content) {
        return true
      }
      view.status.dataset['state'] = 'error'
      view.status.textContent = 'Finish the invalid Tao draft before applying a visual source edit.'
      return false
    }

    renderComponentPalette(view.components, component => {
      const identity = currentSourceIdentity(handshake, preview, activeFile)
      if (identity !== undefined) {
        void submitLocalAction({ component: component.component, kind: 'insert-component' }, identity)
      }
    })

    renderFiles(view.files, handshake.files, handshake.entryPath, path => void openFile(path))
    await openFile(handshake.entryPath)
    connectEvents(view.status, diagnostic => void openCompileDiagnostic(diagnostic), {
      onFile(file) {
        if (file.path !== activePath || file.sourceVersion === activeFile?.sourceVersion) {
          return
        }
        if (editor?.state.doc.toString() === activeFile?.content) {
          void openFile(file.path, true)
        } else {
          view.status.dataset['state'] = 'error'
          view.status.textContent = 'This file changed on disk while the editor has an unsaved draft.'
        }
      },
      onManifest(manifest) {
        if (config.previewUrl !== undefined) {
          void refreshCellPreviews(previews, config.previewUrl, manifest).catch(error => {
            view.status.dataset['state'] = 'error'
            view.status.textContent = error instanceof Error ? error.message : String(error)
          })
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
    if (previews.length > 0) {
      window.addEventListener('message', event => {
        const connection = previews.find(candidate => candidate.iframe.contentWindow === event.source)
        if (connection === undefined) {
          return
        }
        void handlePreviewMessage(event, connection, handshake, openFile, {
          applySourceAction: submitPreviewAction,
          inspect(selection) {
            inspected = selection
            renderInspector()
          },
        })
      })
    }
    window.addEventListener('beforeunload', () => {
      clearTimeout(highlightTimer)
      editor?.destroy()
      languageClient.disconnect()
    })
  } catch (error) {
    view.status.dataset['state'] = 'error'
    view.status.textContent = error instanceof Error ? error.message : String(error)
  }
}

function createShell(root: HTMLElement, config: StudioClientConfig): StudioClientView {
  root.innerHTML = `
    <section class="studio-shell">
      <header class="studio-toolbar">
        <span class="studio-wordmark">Tao Studio</span>
        <span class="studio-project"></span>
        <button class="studio-interaction-mode" type="button">Mode: Edit</button>
        <button class="studio-reload" type="button">Reload preview</button>
        <span class="studio-status" role="status">Connecting…</span>
      </header>
      <section class="studio-main">
        <aside class="studio-sidebar">
          <nav class="studio-files" aria-label="Project files"></nav>
          <section class="studio-palette" aria-label="Component palette">
            <h2>Components</h2>
            <div class="studio-components"></div>
            <h2>Project views</h2>
            <div class="studio-project-views"></div>
          </section>
        </aside>
        <section class="studio-editor" aria-label="Tao source editor"></section>
        <section class="studio-preview" aria-label="Live preview"></section>
        <aside class="studio-inspector" aria-label="Inspector"></aside>
      </section>
    </section>
  `
  const preview = requiredElement(root, '.studio-preview')
  preview.innerHTML = config.previewUrl === undefined
    ? '<div class="studio-empty">Preview host is not connected.</div>'
    : '<div class="studio-empty">Connecting preview…</div>'
  return {
    components: requiredElement(root, '.studio-components'),
    editor: requiredElement(root, '.studio-editor'),
    files: requiredElement(root, '.studio-files'),
    inspector: requiredElement(root, '.studio-inspector'),
    interactionMode: requiredButton(root, '.studio-interaction-mode'),
    project: requiredElement(root, '.studio-project'),
    projectViews: requiredElement(root, '.studio-project-views'),
    preview,
    reload: requiredButton(root, '.studio-reload'),
    status: requiredElement(root, '.studio-status'),
  }
}

function renderFiles(
  parent: HTMLElement,
  files: readonly StudioFile[],
  activePath: string,
  open: (path: string) => void,
): void {
  parent.replaceChildren(...files.map(file => {
    const button = document.createElement('button')
    button.className = 'studio-file'
    button.dataset['path'] = file.path
    button.textContent = file.path
    button.type = 'button'
    button.addEventListener('click', () => open(file.path))
    if (file.path === activePath) {
      button.setAttribute('aria-current', 'true')
    }
    return button
  }))
}

async function connectPreviews(
  parent: HTMLElement,
  previewUrl: string | undefined,
  handshake: StudioHandshake,
): Promise<StudioPreviewConnection[]> {
  if (previewUrl === undefined) {
    return []
  }
  const origin = StudioProtocol.messageOrigin(previewUrl)
  if (origin === undefined) {
    throw new Error('Tao Studio preview URL must be an absolute HTTP or HTTPS URL.')
  }
  const manifest = handshake.previewManifest
  if (manifest !== undefined && manifest.cells.length > 0) {
    const connections = await Promise.all(manifest.cells.map(cell =>
      connectCellPreview(
        previewUrl,
        origin,
        handshake,
        manifest,
        cell,
      )
    ))
    const grid = document.createElement('div')
    grid.className = 'studio-preview-grid'
    for (const connection of connections) {
      const frame = document.createElement('section')
      frame.className = 'studio-preview-cell'
      connection.frame = frame
      renderCellPreview(frame, connection, previewUrl, manifest)
      grid.append(frame)
    }
    parent.replaceChildren(grid)
    return connections
  }
  const previewInstanceId = crypto.randomUUID()
  await request('/api/preview/instance', {
    body: JSON.stringify({ previewInstanceId }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  const url = new URL(previewUrl)
  url.searchParams.set('taoStudioParentOrigin', window.location.origin)
  url.searchParams.set('taoStudioPreviewInstanceId', previewInstanceId)
  const iframe = document.createElement('iframe')
  iframe.src = url.toString()
  iframe.title = `${handshake.identity.appName} live preview`
  parent.replaceChildren(iframe)
  return [{ iframe, interactionMode: 'edit', origin, previewInstanceId }]
}

async function connectCellPreview(
  previewUrl: string,
  origin: string,
  handshake: StudioHandshake,
  manifest: StudioPreviewManifestV1,
  cell: StudioPreviewCell,
): Promise<StudioPreviewConnection> {
  const previewInstanceId = crypto.randomUUID()
  const cellIdentity: StudioCellIdentity = {
    appName: handshake.identity.appName,
    cellId: cell.cellId,
    cellRevision: cell.cellRevision,
    compileRevision: manifest.compileRevision,
    manifestRevision: manifest.manifestRevision,
    project: handshake.identity.project,
  }
  await request('/api/preview/cell/instance', {
    body: JSON.stringify({ ...cellIdentity, previewInstanceId }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  const iframe = document.createElement('iframe')
  iframe.src = cellPreviewUrl(previewUrl, previewInstanceId)
  iframe.title = `${cell.scenarioId} live preview`
  return { cell, cellIdentity, iframe, interactionMode: 'edit', origin, previewInstanceId }
}

function configureInteractionMode(
  button: HTMLButtonElement,
  previews: readonly StudioPreviewConnection[],
  handshake: StudioHandshake,
): void {
  const render = (mode: StudioInteractionMode): void => {
    button.dataset['mode'] = mode
    button.textContent = mode === 'edit' ? 'Mode: Edit' : 'Mode: Run'
    button.title = mode === 'edit'
      ? 'Studio owns clicks and drags for selection and visual editing.'
      : 'The app receives clicks, presses, scrolling, and other interaction normally.'
  }
  const setMode = (mode: StudioInteractionMode): void => {
    render(mode)
    for (const preview of previews) {
      preview.interactionMode = mode
      postInteractionMode(preview, handshake)
    }
  }
  for (const preview of previews) {
    preview.iframe.addEventListener('load', () => postInteractionMode(preview, handshake))
  }
  button.addEventListener('click', () => setMode(button.dataset['mode'] === 'edit' ? 'run' : 'edit'))
  setMode('edit')
}

function postInteractionMode(preview: StudioPreviewConnection, handshake: StudioHandshake): void {
  const target = preview.iframe.contentWindow
  if (target === null) {
    return
  }
  target.postMessage({
    channel: studioProtocolChannel,
    identity: {
      ...(preview.cellIdentity ?? handshake.identity),
      previewInstanceId: preview.previewInstanceId,
    },
    mode: preview.interactionMode,
    protocolVersion: studioProtocolVersion,
    type: 'set-interaction-mode',
  }, preview.origin)
}

function renderCellPreview(
  frame: HTMLElement,
  connection: StudioPreviewConnection,
  previewUrl: string,
  manifest: StudioPreviewManifestV1,
): void {
  const cell = connection.cell!
  frame.style.width = `${Math.max(320, cell.environment.viewport.width)}px`
  const scenario = manifest.scenarios.find(candidate => candidate.scenarioId === cell.scenarioId)
  const subjectParameters = manifest.parametersBySubject[scenario?.subjectId ?? ''] ?? []
  const label = document.createElement('header')
  label.className = 'studio-preview-cell-label'
  label.textContent = scenario?.label ?? cell.scenarioId

  const details = document.createElement('span')
  details.className = 'studio-preview-cell-details'
  details.textContent = `${cell.environment.viewport.width}×${cell.environment.viewport.height} · ${
    networkLabel(cell.environment)
  }`
  label.append(details)

  const form = document.createElement('form')
  form.className = 'studio-preview-cell-controls'
  form.dataset['taoStudioCellControls'] = cell.cellId
  const argumentControls = renderArgumentControls(subjectParameters, cell.args)
  const viewportControls = renderViewportControls(cell.environment)
  const networkControls = renderNetworkControls(cell.environment)
  const schemeControls = renderSchemeControls(cell.environment)
  const actions = document.createElement('div')
  actions.className = 'studio-preview-cell-actions'
  const apply = document.createElement('button')
  apply.className = 'studio-preview-cell-apply'
  apply.textContent = 'Apply & remount'
  apply.type = 'submit'
  const promote = document.createElement('button')
  promote.className = 'studio-preview-cell-promote'
  promote.textContent = 'Save to scenario'
  promote.type = 'button'
  promote.disabled = scenario === undefined || subjectParameters.length === 0
  const fixtureName = document.createElement('input')
  fixtureName.className = 'studio-preview-fixture-name'
  fixtureName.placeholder = 'CapturedState'
  fixtureName.setAttribute('aria-label', 'Captured fixture name')
  fixtureName.value = 'CapturedState'
  const capture = document.createElement('button')
  capture.className = 'studio-preview-cell-capture'
  capture.textContent = 'Capture fixture'
  capture.type = 'button'
  capture.disabled = scenario === undefined
  const status = document.createElement('span')
  status.className = 'studio-preview-cell-status'
  status.setAttribute('role', 'status')
  actions.append(apply, promote, fixtureName, capture, status)
  form.append(argumentControls.element, viewportControls.element, networkControls.element, schemeControls, actions)

  const disclosure = document.createElement('details')
  disclosure.className = 'studio-preview-cell-disclosure'
  disclosure.open = connection.scenarioDetailsOpen ?? false
  disclosure.addEventListener('toggle', () => {
    connection.scenarioDetailsOpen = disclosure.open
  })
  const disclosureSummary = document.createElement('summary')
  disclosureSummary.className = 'studio-preview-cell-disclosure-summary'
  disclosureSummary.textContent = 'Scenario details'
  disclosure.append(disclosureSummary, form)

  const viewport = document.createElement('div')
  viewport.className = 'studio-preview-cell-viewport'
  viewport.style.height = `${cell.environment.viewport.height}px`
  viewport.style.width = `${cell.environment.viewport.width}px`
  connection.iframe.style.height = '100%'
  connection.iframe.style.width = '100%'
  viewport.append(connection.iframe)

  form.addEventListener('submit', event => {
    event.preventDefault()
    if (connection.cellIdentity === undefined) {
      return
    }
    apply.disabled = true
    status.dataset['state'] = 'busy'
    status.textContent = 'Remounting…'
    void (async () => {
      try {
        const runtime = await request<StudioCellRuntimeResponse>('/api/preview/cell/reconfigure', {
          body: JSON.stringify({
            ...connection.cellIdentity,
            args: argumentControls.read(),
            environment: {
              network: networkControls.read(),
              scheme: cell.environment.scheme,
              viewport: viewportControls.read(),
            },
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        })
        connection.cell = runtime.cell
        connection.cellIdentity = runtime.identity
        const previewInstanceId = crypto.randomUUID()
        await request('/api/preview/cell/instance', {
          body: JSON.stringify({ ...runtime.identity, previewInstanceId }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        })
        connection.previewInstanceId = previewInstanceId
        connection.iframe.src = cellPreviewUrl(previewUrl, previewInstanceId)
        renderCellPreview(frame, connection, previewUrl, manifest)
      } catch (error) {
        apply.disabled = false
        status.dataset['state'] = 'error'
        status.textContent = error instanceof Error ? error.message : String(error)
      }
    })()
  })
  promote.addEventListener('click', () => {
    if (scenario === undefined || connection.cellIdentity === undefined) {
      return
    }
    promote.disabled = true
    status.dataset['state'] = 'busy'
    status.textContent = 'Saving Tao scenario…'
    void promoteScenarioArguments(connection, manifest, scenario, argumentControls.read()).then(
      () => window.location.reload(),
      error => {
        promote.disabled = false
        status.dataset['state'] = 'error'
        status.textContent = error instanceof Error ? error.message : String(error)
      },
    )
  })
  capture.addEventListener('click', () => {
    if (scenario === undefined || connection.cellIdentity === undefined) {
      return
    }
    const name = fixtureName.value.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      status.dataset['state'] = 'error'
      status.textContent = 'Fixture name must be a Tao identifier.'
      return
    }
    const sourceVersion = manifest.sourceVersions[scenario.source.path]
    const sourcePath = projectRelativePath(manifest.project.root, scenario.source.path)
    const target = connection.iframe.contentWindow
    if (sourceVersion === undefined || sourcePath === undefined || target === null) {
      status.dataset['state'] = 'error'
      status.textContent = 'Fixture capture source identity is unavailable.'
      return
    }
    const requestId = crypto.randomUUID()
    const identity: StudioPreviewSourceIdentity = {
      ...connection.cellIdentity,
      path: sourcePath,
      previewInstanceId: connection.previewInstanceId,
      sourceVersion,
    }
    const timeout = setTimeout(() => {
      if (connection.capture?.requestId !== requestId) {
        return
      }
      connection.capture = undefined
      capture.disabled = false
      status.dataset['state'] = 'error'
      status.textContent = 'Fixture capture timed out; retry after the preview is ready.'
    }, 10_000)
    connection.capture = { button: capture, fixtureName: name, identity, requestId, status, timeout }
    capture.disabled = true
    status.dataset['state'] = 'busy'
    status.textContent = 'Capturing isolated provider state…'
    target.postMessage({
      channel: studioProtocolChannel,
      identity: {
        ...connection.cellIdentity,
        previewInstanceId: connection.previewInstanceId,
      },
      protocolVersion: studioProtocolVersion,
      requestId,
      type: 'capture-fixture',
    }, connection.origin)
  })

  frame.replaceChildren(label, disclosure, viewport)
}

async function promoteScenarioArguments(
  connection: StudioPreviewConnection,
  manifest: StudioPreviewManifestV1,
  scenario: StudioPreviewManifestV1['scenarios'][number],
  args: StudioJsonObject,
): Promise<void> {
  const identity = connection.cellIdentity
  if (identity === undefined) {
    throw new Error('Studio cell identity is unavailable.')
  }
  const sourceVersion = manifest.sourceVersions[scenario.source.path]
  if (sourceVersion === undefined) {
    throw new Error('Studio scenario source version is unavailable.')
  }
  const requestId = crypto.randomUUID()
  await request('/api/source-action', {
    body: JSON.stringify({
      action: {
        arguments: args,
        kind: 'set-scenario-arguments',
        scenarioName: scenario.label,
      },
      channel: studioProtocolChannel,
      checkpoint: { id: `scenario-arguments:${requestId}`, phase: 'single' },
      identity: {
        ...identity,
        path: projectRelativePath(manifest.project.root, scenario.source.path),
        previewInstanceId: connection.previewInstanceId,
        sourceVersion,
      },
      protocolVersion: studioProtocolVersion,
      requestId,
      sourceActionVersion: 1,
      type: 'source-action',
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
}

function renderArgumentControls(
  parameters: readonly StudioParameterSchema[],
  args: StudioJsonObject,
): { element: HTMLElement; read: () => StudioJsonObject } {
  const group = controlGroup('Arguments')
  const readers: Array<readonly [string, () => StudioJsonValue | undefined]> = []
  if (parameters.length === 0) {
    group.fields.append(controlNote('No editable arguments'))
  }
  for (const parameter of parameters) {
    const current = args[parameter.parameterId] ?? parameter.defaultValue
    const control = parameterControl(parameter, current)
    group.fields.append(control.element)
    readers.push([parameter.parameterId, control.read])
  }
  return {
    element: group.element,
    read: () =>
      Object.fromEntries(readers.flatMap(([id, read]) => {
        const value = read()
        return value === undefined ? [] : [[id, value]]
      })),
  }
}

function parameterControl(
  parameter: StudioParameterSchema,
  value: StudioJsonValue | undefined,
): { element: HTMLElement; read: () => StudioJsonValue | undefined } {
  const field = controlField(parameter.label)
  const type = parameter.type
  if (type.kind === 'boolean') {
    const input = document.createElement('input')
    input.checked = value === true
    input.type = 'checkbox'
    field.control.append(input)
    return { element: field.element, read: () => input.checked }
  }
  if (type.kind === 'choice') {
    const select = document.createElement('select')
    for (const choice of type.values) {
      const option = document.createElement('option')
      option.value = JSON.stringify(choice)
      option.textContent = String(choice)
      option.selected = Object.is(choice, value)
      select.append(option)
    }
    field.control.append(select)
    return { element: field.element, read: () => JSON.parse(select.value) as StudioJsonValue }
  }
  if (type.kind === 'json') {
    const input = document.createElement('textarea')
    input.rows = 2
    input.value = value === undefined ? '' : JSON.stringify(value)
    field.control.append(input)
    return {
      element: field.element,
      read: () => input.value.trim() === '' ? undefined : JSON.parse(input.value) as StudioJsonValue,
    }
  }
  const input = document.createElement('input')
  input.required = parameter.required
  if (type.kind === 'number') {
    input.type = 'number'
    if (type.minimum !== undefined) {
      input.min = String(type.minimum)
    }
    if (type.maximum !== undefined) {
      input.max = String(type.maximum)
    }
    if (type.step !== undefined) {
      input.step = String(type.step)
    }
    if (typeof value === 'number') {
      input.value = String(value)
    }
    field.control.append(input)
    return {
      element: field.element,
      read: () => input.value === '' ? undefined : requiredFiniteNumber(input, parameter.label),
    }
  }
  input.type = 'text'
  if (type.kind === 'time') {
    input.placeholder = 'Time'
  }
  if (typeof value === 'string') {
    input.value = value
  }
  field.control.append(input)
  return { element: field.element, read: () => input.value === '' && !parameter.required ? undefined : input.value }
}

function renderViewportControls(environment: StudioCellEnvironment): {
  element: HTMLElement
  read: () => StudioCellEnvironment['viewport']
} {
  const group = controlGroup('Viewport')
  const preset = document.createElement('select')
  const presets = [
    { height: 844, label: 'Phone', presetId: 'phone', width: 390 },
    { height: 1180, label: 'Tablet', presetId: 'tablet', width: 820 },
    { height: 900, label: 'Laptop', presetId: 'laptop', width: 1440 },
  ] as const
  for (const item of presets) {
    const option = document.createElement('option')
    option.value = item.presetId
    option.textContent = item.label
    preset.append(option)
  }
  if (
    environment.viewport.presetId !== undefined
    && !presets.some(item => item.presetId === environment.viewport.presetId)
  ) {
    const authored = document.createElement('option')
    authored.value = environment.viewport.presetId
    authored.textContent = environment.viewport.presetId
    preset.append(authored)
  }
  const custom = document.createElement('option')
  custom.value = 'custom'
  custom.textContent = 'Custom'
  preset.append(custom)
  preset.value = environment.viewport.presetId ?? 'custom'

  const width = dimensionInput(environment.viewport.width, 'Width')
  const height = dimensionInput(environment.viewport.height, 'Height')
  preset.addEventListener('change', () => {
    const selected = presets.find(item => item.presetId === preset.value)
    if (selected !== undefined) {
      width.value = String(selected.width)
      height.value = String(selected.height)
    }
  })
  width.addEventListener('input', () => {
    preset.value = 'custom'
  })
  height.addEventListener('input', () => {
    preset.value = 'custom'
  })
  group.fields.append(labelControl('Device', preset), labelControl('Width', width), labelControl('Height', height))
  return {
    element: group.element,
    read: () => ({
      ...(preset.value === 'custom' ? {} : { presetId: preset.value }),
      height: requiredFiniteNumber(height, 'Viewport height'),
      width: requiredFiniteNumber(width, 'Viewport width'),
    }),
  }
}

function renderNetworkControls(environment: StudioCellEnvironment): {
  element: HTMLElement
  read: () => StudioCellEnvironment['network']
} {
  const group = controlGroup('Network')
  const outcome = document.createElement('select')
  for (const value of ['normal', 'offline', 'error'] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value[0]!.toUpperCase() + value.slice(1)
    outcome.append(option)
  }
  outcome.value = environment.network.outcome
  const latency = dimensionInput(environment.network.latencyMs, 'Latency')
  latency.min = '0'
  const message = document.createElement('input')
  message.type = 'text'
  message.value = environment.network.error?.message ?? 'Injected Studio network failure'
  const status = dimensionInput(environment.network.error?.status ?? 503, 'Status')
  status.min = '100'
  status.max = '599'
  const errorFields = [labelControl('Error', message), labelControl('Status', status)]
  const updateErrorVisibility = (): void => {
    for (const field of errorFields) {
      field.hidden = outcome.value !== 'error'
    }
  }
  outcome.addEventListener('change', updateErrorVisibility)
  updateErrorVisibility()
  group.fields.append(labelControl('Mode', outcome), labelControl('Latency ms', latency), ...errorFields)
  return {
    element: group.element,
    read: () => ({
      ...(outcome.value === 'error'
        ? {
          error: {
            message: message.value.trim() || 'Injected Studio network failure',
            status: requiredFiniteNumber(status, 'Network error status'),
          },
        }
        : {}),
      latencyMs: requiredFiniteNumber(latency, 'Network latency'),
      outcome: outcome.value as StudioCellEnvironment['network']['outcome'],
    }),
  }
}

function renderSchemeControls(environment: StudioCellEnvironment): HTMLElement {
  const group = controlGroup('Scheme')
  const select = document.createElement('select')
  select.disabled = true
  select.title = 'Scheme is intentionally inert until reactive Scheme support exists.'
  for (const value of ['light', 'dark'] as const) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value[0]!.toUpperCase() + value.slice(1)
    option.selected = value === environment.scheme.requested
    select.append(option)
  }
  group.fields.append(
    labelControl('Requested', select),
    controlNote('Inert — runtime Scheme support is not available yet.'),
  )
  return group.element
}

function controlGroup(title: string): { element: HTMLElement; fields: HTMLElement } {
  const element = document.createElement('fieldset')
  element.className = 'studio-preview-control-group'
  const legend = document.createElement('legend')
  legend.textContent = title
  const fields = document.createElement('div')
  fields.className = 'studio-preview-control-fields'
  element.append(legend, fields)
  return { element, fields }
}

function controlField(label: string): { control: HTMLElement; element: HTMLLabelElement } {
  const element = document.createElement('label')
  element.className = 'studio-preview-control-field'
  const caption = document.createElement('span')
  caption.textContent = label
  const control = document.createElement('span')
  control.className = 'studio-preview-control-input'
  element.append(caption, control)
  return { control, element }
}

function labelControl(label: string, control: HTMLElement): HTMLLabelElement {
  const field = controlField(label)
  field.control.append(control)
  return field.element
}

function controlNote(text: string): HTMLElement {
  const note = document.createElement('span')
  note.className = 'studio-preview-control-note'
  note.textContent = text
  return note
}

function dimensionInput(value: number, label: string): HTMLInputElement {
  const input = document.createElement('input')
  input.setAttribute('aria-label', label)
  input.min = '1'
  input.step = '1'
  input.type = 'number'
  input.value = String(value)
  return input
}

function requiredFiniteNumber(input: HTMLInputElement, label: string): number {
  const value = input.valueAsNumber
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a number.`)
  }
  return value
}

function networkLabel(environment: StudioCellEnvironment): string {
  const latency = environment.network.latencyMs === 0 ? '' : ` +${environment.network.latencyMs}ms`
  return `${environment.network.outcome}${latency} · Scheme ${environment.scheme.status}`
}

function cellPreviewUrl(previewUrl: string, previewInstanceId: string): string {
  const url = new URL(previewUrl)
  url.searchParams.set('taoStudioCell', '1')
  url.searchParams.set('taoStudioParentOrigin', window.location.origin)
  url.searchParams.set('taoStudioPreviewInstanceId', previewInstanceId)
  return url.toString()
}

async function handlePreviewMessage(
  event: MessageEvent,
  preview: StudioPreviewConnection,
  handshake: StudioHandshake,
  openFile: (path: string) => Promise<StudioOpenFile | undefined>,
  actions: {
    applySourceAction: (envelope: StudioSourceActionEnvelope) => Promise<void>
    inspect: (selection: StudioInspectorSelection) => void
  },
): Promise<void> {
  const message = StudioProtocol.parseWindowMessage(event, {
    ...handshake.identity,
    origin: preview.origin,
    previewInstanceId: preview.previewInstanceId,
    source: preview.iframe.contentWindow,
  })
  if (message === undefined) {
    return
  }
  if (message.type === 'preview-applied') {
    postInteractionMode(preview, handshake)
    if (preview.cellIdentity !== undefined) {
      return
    }
    await request('/api/preview/applied', {
      body: JSON.stringify(message),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    return
  }
  if (message.type === 'source-action') {
    await actions.applySourceAction(message)
    return
  }
  if (
    message.type === 'preview-fixture-captured'
    || message.type === 'preview-fixture-capture-failed'
  ) {
    const capture = preview.capture
    if (capture === undefined || capture.requestId !== message.requestId) {
      return
    }
    clearTimeout(capture.timeout)
    preview.capture = undefined
    if (message.type === 'preview-fixture-capture-failed') {
      capture.button.disabled = false
      capture.status.dataset['state'] = 'error'
      capture.status.textContent = message.error
      return
    }
    const proposal = fixtureProposalSource(capture.fixtureName, message.fixture)
    if (!window.confirm(`Save this captured Tao fixture?\n\n${proposal}`)) {
      capture.button.disabled = false
      capture.status.dataset['state'] = 'idle'
      capture.status.textContent = 'Captured fixture was not saved.'
      return
    }
    capture.status.textContent = 'Saving captured state as Tao source…'
    await actions.applySourceAction(StudioInspector.singleAction({
      action: {
        fixtureName: capture.fixtureName,
        kind: 'insert-captured-fixture',
        plan: message.fixture,
      },
      checkpointId: `captured-fixture:${capture.requestId}`,
      identity: capture.identity,
      requestId: capture.requestId,
    }))
    window.location.reload()
    return
  }
  if (message.type !== 'preview-select-source') {
    return
  }
  const path = projectRelativePath(handshake.identity.project, message.identity.path)
  if (path === undefined) {
    return
  }
  const opened = await openFile(path)
  if (opened === undefined) {
    return
  }
  const { editor, file } = opened
  if (
    file.path !== path
    || message.identity.sourceVersion !== file.sourceVersion
    || message.range.end > editor.state.doc.length
  ) {
    return
  }
  actions.inspect(StudioInspector.selection(message))
  editor.dispatch({
    effects: EditorView.scrollIntoView(message.range.start, { y: 'center' }),
    selection: { anchor: message.range.start, head: message.range.end },
  })
  editor.focus()
}

function fixtureProposalSource(name: string, plan: StudioFixturePlan): string {
  const entries = [
    ...plan.accounts.map(account => `   account ${account.name} { ${fixtureProposalFields(account.fields)} }`),
    ...plan.creates.map(create =>
      `   ${create.name} = create ${create.entity} { ${fixtureProposalFields(create.fields)} }`
    ),
  ]
  return `fixture ${name} {\n${entries.join('\n')}\n}`
}

function fixtureProposalFields(fields: Readonly<Record<string, StudioFixtureValue>>): string {
  return Object.entries(fields).map(([name, value]) => `${name}: ${fixtureProposalValue(value)}`).join(', ')
}

function fixtureProposalValue(value: StudioFixtureValue): string {
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return value.kind === 'now' ? 'now' : value.handle
}

function renderComponentPalette(
  parent: HTMLElement,
  insert: (component: (typeof studioPaletteComponents)[number]) => void,
): void {
  parent.replaceChildren(...studioPaletteComponents.map(component => {
    const button = document.createElement('button')
    button.className = 'studio-palette-button'
    button.dataset['taoStudioComponent'] = component.label
    button.textContent = component.label
    button.title = `Insert ${component.label}`
    button.type = 'button'
    button.addEventListener('click', () => insert(component))
    return button
  }))
}

function renderProjectViews(parent: HTMLElement, content: string, insert: (viewName: string) => void): void {
  const views = StudioInspector.projectViews(content)
  if (views.length === 0) {
    const empty = document.createElement('span')
    empty.className = 'studio-palette-empty'
    empty.textContent = 'No zero-argument views'
    parent.replaceChildren(empty)
    return
  }
  parent.replaceChildren(...views.map(viewName => {
    const button = document.createElement('button')
    button.className = 'studio-palette-button'
    button.dataset['taoStudioProjectView'] = viewName
    button.textContent = viewName
    button.title = `Insert ${viewName}()`
    button.type = 'button'
    button.addEventListener('click', () => insert(viewName))
    return button
  }))
}

function renderInspectorPanel(parent: HTMLElement, options: {
  busy: boolean
  canUndo: boolean
  currentSourceVersion?: string
  onAction: (action: StudioCanonicalSourceAction) => void
  onUndo: () => void
  selection?: StudioInspectorSelection
}): void {
  const heading = document.createElement('h2')
  heading.textContent = 'Inspector'
  const undo = document.createElement('button')
  undo.className = 'studio-inspector-button studio-undo'
  undo.dataset['taoStudioUndo'] = 'true'
  undo.disabled = options.busy || !options.canUndo
  undo.textContent = 'Undo visual edit'
  undo.type = 'button'
  undo.addEventListener('click', options.onUndo)
  const selection = options.selection
  if (selection === undefined) {
    const empty = document.createElement('p')
    empty.className = 'studio-inspector-empty'
    empty.textContent = 'Select a rendered element in the preview.'
    parent.replaceChildren(heading, undo, empty)
    return
  }
  const current = selection.identity.sourceVersion === options.currentSourceVersion
  const summary = document.createElement('dl')
  summary.className = 'studio-inspector-summary'
  appendInspectorRow(summary, 'Source', projectPathLabel(selection.identity.path))
  appendInspectorRow(summary, 'Range', `${selection.range.start}–${selection.range.end}`)
  appendInspectorRow(summary, 'Version', current ? 'Current' : 'Waiting for refreshed preview')
  const controls = document.createElement('div')
  controls.className = 'studio-inspector-controls'
  const wrap = inspectorActionButton(
    'Wrap Stack',
    'wrap-stack',
    options.busy || !current,
    () => options.onAction({ kind: 'wrap-render', renderId: selection.renderId, wrapper: 'Stack' }),
  )
  controls.append(wrap)
  for (const action of studioInspectorLayoutActions) {
    controls.append(
      inspectorActionButton(
        action.label,
        action.id,
        options.busy || !current,
        () => options.onAction({ entry: action.entry, kind: 'set-layout-entry', renderId: selection.renderId }),
      ),
    )
  }
  parent.replaceChildren(heading, undo, summary, controls)
}

function inspectorActionButton(
  label: string,
  action: string,
  disabled: boolean,
  apply: () => void,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'studio-inspector-button'
  button.dataset['taoStudioInspectorAction'] = action
  button.disabled = disabled
  button.textContent = label
  button.type = 'button'
  button.addEventListener('click', apply)
  return button
}

function appendInspectorRow(parent: HTMLElement, term: string, value: string): void {
  const dt = document.createElement('dt')
  const dd = document.createElement('dd')
  dt.textContent = term
  dd.textContent = value
  parent.append(dt, dd)
}

function currentSourceIdentity(
  handshake: StudioHandshake,
  preview: StudioPreviewConnection | undefined,
  file: StudioDraftFile | undefined,
): StudioPreviewSourceIdentity | undefined {
  return preview === undefined || file === undefined
    ? undefined
    : {
      ...handshake.identity,
      ...(preview.cellIdentity ?? {}),
      path: absoluteSourcePath(handshake.identity.project, file.path),
      previewInstanceId: preview.previewInstanceId,
      sourceVersion: file.sourceVersion,
    }
}

function projectPathLabel(path: string): string {
  return path.split('/').at(-1) ?? path
}

function sourceActionLabel(action: StudioCanonicalSourceAction): string {
  return action.kind.replaceAll('-', ' ')
}

function showSourceActionError(element: HTMLElement, error: unknown): void {
  element.dataset['state'] = 'error'
  element.textContent = error instanceof Error ? error.message : String(error)
}

function postEditorSelection(
  preview: StudioPreviewConnection | undefined,
  handshake: StudioHandshake,
  activeFile: StudioDraftFile | undefined,
  editor: EditorView,
): void {
  if (
    preview === undefined
    || activeFile === undefined
    || activeFile.content !== editor.state.doc.toString()
    || preview.iframe.contentWindow === null
  ) {
    return
  }
  const selection = editor.state.selection.main
  preview.iframe.contentWindow.postMessage({
    channel: studioProtocolChannel,
    identity: {
      ...handshake.identity,
      path: absoluteSourcePath(handshake.identity.project, activeFile.path),
      previewInstanceId: preview.previewInstanceId,
      sourceVersion: activeFile.sourceVersion,
    },
    protocolVersion: studioProtocolVersion,
    range: { end: selection.to, start: selection.from },
    type: 'highlight-source',
  }, preview.origin)
}

function markActiveFile(parent: HTMLElement, path: string): void {
  for (const button of parent.querySelectorAll<HTMLElement>('.studio-file')) {
    if (button.dataset['path'] === path) {
      button.setAttribute('aria-current', 'true')
    } else {
      button.removeAttribute('aria-current')
    }
  }
}

async function refreshCellPreviews(
  previews: readonly StudioPreviewConnection[],
  previewUrl: string,
  manifest: StudioPreviewManifestV1,
): Promise<void> {
  const matrixPreviews = previews.filter(preview => preview.cell !== undefined)
  const cellsById = new Map(manifest.cells.map(cell => [cell.cellId, cell]))
  if (
    matrixPreviews.length !== previews.length
    || matrixPreviews.length !== manifest.cells.length
    || matrixPreviews.some(preview => !cellsById.has(preview.cell!.cellId))
  ) {
    window.location.reload()
    return
  }
  await Promise.all(matrixPreviews.map(async preview => {
    const cell = cellsById.get(preview.cell!.cellId)!
    const identity = cellIdentity(manifest, cell)
    preview.cellIdentity = identity
    const refresh = async (): Promise<void> => {
      const previewInstanceId = crypto.randomUUID()
      await request('/api/preview/cell/instance', {
        body: JSON.stringify({ ...identity, previewInstanceId }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (preview.cellIdentity !== identity) {
        return
      }
      if (preview.capture !== undefined) {
        clearTimeout(preview.capture.timeout)
        preview.capture = undefined
      }
      preview.cell = cell
      preview.previewInstanceId = previewInstanceId
      preview.iframe.title = `${cell.scenarioId} live preview`
      preview.iframe.src = cellPreviewUrl(previewUrl, previewInstanceId)
      if (preview.frame !== undefined) {
        renderCellPreview(preview.frame, preview, previewUrl, manifest)
      }
    }
    preview.refresh = (preview.refresh ?? Promise.resolve()).catch(() => {}).then(refresh)
    await preview.refresh
  }))
}

function cellIdentity(manifest: StudioPreviewManifestV1, cell: StudioPreviewCell): StudioCellIdentity {
  return {
    appName: manifest.project.appName,
    cellId: cell.cellId,
    cellRevision: cell.cellRevision,
    compileRevision: manifest.compileRevision,
    manifestRevision: manifest.manifestRevision,
    project: manifest.project.root,
  }
}

function connectEvents(
  status: HTMLElement,
  openDiagnostic: (diagnostic: StudioCompileDiagnostic) => void,
  handlers: {
    onFile: (file: StudioFile) => void
    onManifest: (manifest: StudioPreviewManifestV1) => void
  },
): WebSocket {
  const socket = new WebSocket(webSocketUrl('/events'))
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)) as StudioHandshake | StudioEvent
    if ('type' in message && message.type === 'compile-state') {
      updateStatus(status, message.state, openDiagnostic)
    } else if ('type' in message && message.type === 'file-changed') {
      handlers.onFile(message.file)
    } else if ('type' in message && message.type === 'preview-manifest-changed') {
      handlers.onManifest(message.manifest)
    }
  })
  socket.addEventListener('close', () => {
    status.dataset['state'] = 'error'
    status.textContent = 'Studio server disconnected; reconnecting…'
    setTimeout(() => connectEvents(status, openDiagnostic, handlers), 500)
  })
  return socket
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
    element.textContent = 'Saved; compiling preview…'
    return
  }
  element.dataset['state'] = 'error'
  element.textContent = result.diagnostics[0] ?? 'Draft is not valid Tao yet; preview kept the last good source.'
}

async function request<Result>(path: string, options?: RequestInit): Promise<Result> {
  const response = await fetch(path, options)
  const body = await response.json() as Result | { error?: string }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined
    throw new Error(message ?? `Tao Studio request failed (${response.status}).`)
  }
  return body as Result
}

function webSocketTransport(url: string): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const handlers = new Set<(value: string) => void>()
    const socket = new WebSocket(url)
    socket.addEventListener('open', () =>
      resolve({
        send(message) {
          socket.send(message)
        },
        subscribe(handler) {
          handlers.add(handler)
        },
        unsubscribe(handler) {
          handlers.delete(handler)
        },
      }))
    socket.addEventListener('message', event => {
      for (const handler of handlers) {
        handler(String(event.data))
      }
    })
    socket.addEventListener('error', () => reject(new Error('Could not connect to the Tao language server.')))
  })
}

function fileUri(project: string, path?: string): string {
  const absolutePath = path === undefined ? project : absoluteSourcePath(project, path)
  return `file://${
    absolutePath.split('/').map((part, index) => index === 0 ? part : encodeURIComponent(part)).join('/')
  }`
}

function absoluteSourcePath(project: string, path: string): string {
  return `${project.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

function projectRelativePath(project: string, sourcePath: string): string | undefined {
  const prefix = `${project.replace(/\/$/, '')}/`
  return sourcePath.startsWith(prefix) ? sourcePath.slice(prefix.length) : undefined
}

function webSocketUrl(path: string): string {
  const url = new URL(path, window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function sanitizeLspHtml(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  for (const unsafe of template.content.querySelectorAll('script, style, iframe, object, embed, link, meta, base')) {
    unsafe.remove()
  }
  for (const element of template.content.querySelectorAll<HTMLElement>('*')) {
    for (const attribute of [...element.attributes]) {
      const value = attribute.value.trim().toLowerCase()
      if (attribute.name.toLowerCase().startsWith('on') || value.startsWith('javascript:')) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  return template.innerHTML
}

function requiredElement(parent: ParentNode, selector: string): HTMLElement {
  const element = parent.querySelector<HTMLElement>(selector)
  if (element === null) {
    throw new Error(`Tao Studio element is missing: ${selector}`)
  }
  return element
}

function requiredButton(parent: ParentNode, selector: string): HTMLButtonElement {
  const button = parent.querySelector<HTMLButtonElement>(selector)
  if (button === null) {
    throw new Error(`Tao Studio button is missing: ${selector}`)
  }
  return button
}
