import type { StudioDeviceStatus } from '../../device/StudioDeviceStatus'
import type { StudioCompileCompletion } from '../../StudioCompileCoordinator'
import type { StudioDraftSyncResult } from '../../StudioDraftSync'
import type { StudioPreviewManifestV2 } from '../../StudioPreviewManifest'
import type { StudioSketchCatalogSnapshot } from '../../StudioSketchCatalog'
import {
  StudioApiClient,
  type StudioCompileDiagnostic,
  type StudioCompileState,
  type StudioFile,
} from '../StudioApiClient'

export type StudioOpenDiagnostic = (diagnostic: StudioCompileDiagnostic) => void

export type StudioEventHandlers = {
  onCompile: (state: StudioCompileState) => void
  onDeviceState: (status: StudioDeviceStatus) => void
  onFile: (file: StudioFile) => void
  onFiles: (files: readonly StudioFile[]) => void
  onManifest: (manifest: StudioPreviewManifestV2) => void
  onSketchCatalog: (catalog: StudioSketchCatalogSnapshot) => void
}

/**
 * The event stream with reconnection: each disconnect doubles the retry delay up to ten seconds,
 * and a fresh handshake resets it and replays the current compile, files, manifest, and sketches.
 */
export function connectStudioEvents(
  status: HTMLElement,
  openDiagnostic: StudioOpenDiagnostic,
  handlers: StudioEventHandlers,
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
        StudioStatusLine.update(status, state, openDiagnostic)
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
      onDeviceState(device) {
        const unsyncedRevision = Number(status.dataset['phoneUnsyncedRevision'])
        if (unsyncedRevision > 0 && (device.connection?.appliedRevision ?? 0) >= unsyncedRevision) {
          delete status.dataset['phoneUnsyncedRevision']
          status.removeAttribute('title')
          if (status.textContent?.startsWith(`Phone did not apply revision ${unsyncedRevision};`)) {
            status.textContent = `Phone caught up to revision ${unsyncedRevision}.`
          }
        }
        handlers.onDeviceState(device)
      },
      onFile: handlers.onFile,
      onFiles: handlers.onFiles,
      onHandshake(handshake) {
        reconnectDelayMs = initialReconnectDelayMs
        StudioStatusLine.update(status, handshake.compile, openDiagnostic)
        handlers.onCompile(handshake.compile)
        handlers.onFiles(handshake.files)
        if (handshake.previewManifest !== undefined) {
          handlers.onManifest(handshake.previewManifest)
        }
        handlers.onSketchCatalog(handshake.sketchCatalog)
      },
      onManifest: handlers.onManifest,
      onSketchCatalog: handlers.onSketchCatalog,
    })
  }
  connect()
  return () => {
    stopped = true
    clearTimeout(reconnectTimer)
    socket?.close()
  }
}

/** The status line under the toolbar: compile state, or the outcome of the last draft save. */
export const StudioStatusLine = {
  draftResult(
    element: HTMLElement,
    result: StudioDraftSyncResult,
    currentCompile: StudioCompileState,
    openDiagnostic?: StudioOpenDiagnostic,
  ): void {
    if (result.saved) {
      const completed = StudioDraftStatus.completedCompile(result, currentCompile)
      if (completed !== undefined) {
        StudioStatusLine.update(element, completed, openDiagnostic)
        return
      }
      element.dataset['state'] = 'compiling'
      element.textContent = 'Saved; compiling preview…'
      return
    }
    element.dataset['state'] = 'error'
    element.textContent = result.diagnostics[0] ?? 'Draft is not valid Tao yet; preview kept the last good source.'
  },

  update(
    element: HTMLElement,
    state: StudioCompileState,
    openDiagnostic?: StudioOpenDiagnostic,
  ): void {
    element.dataset['state'] = state.status
    const revisions = state.status === 'compiled'
      ? `compiled ${state.compileRevision} · applied ${state.appliedRevision}`
      : state.status
    const text = `${revisions} — ${state.message}`
    const diagnostic = state.status === 'error'
      ? state.diagnostics?.find(item => item.filePath !== undefined)
      : undefined
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
  },
} as const

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
export const StudioCompileStatus = {
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
      ...(completion.publishedRevision === undefined ? {} : { publishedRevision: completion.publishedRevision }),
      status: completion.status,
    }
  },
}
