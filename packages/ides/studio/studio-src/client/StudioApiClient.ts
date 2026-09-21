import type { Transport } from '@codemirror/lsp-client'
import { Errors, Switch } from '@shared/core'
import type { StudioRenderInspection } from '@source-actions'
import type { StudioDeviceLaunchInfo, StudioDeviceLaunchOpenResult } from '../device/StudioDeviceLauncher'
import type { StudioDeviceStatus } from '../device/StudioDeviceStatus'
import type { StudioCompileSnapshot, StudioWriteAcknowledgement } from '../StudioCompileCoordinator'
import type { StudioDraftFile, StudioDraftSyncRequest, StudioDraftSyncResult } from '../StudioDraftSync'
import type { StudioCellIdentity, StudioPreviewCell, StudioPreviewManifestV2 } from '../StudioPreviewManifest'
import {
  type StudioCheckpointSummary,
  type StudioCreateFileRequest,
  type StudioCreateFileResult,
  type StudioDataInvalidatedEvent,
  type StudioDeleteFileRequest,
  type StudioDeleteFileResult,
  type StudioFixturePlan,
  type StudioInspectRenderRequest,
  type StudioMoveGeneratedSourceRequest,
  type StudioMoveGeneratedSourceResult,
  type StudioProjectFile,
  type StudioRenameFileRequest,
  type StudioRenameFileResult,
  type StudioRoute,
  StudioRoutes,
  type StudioSessionHandshake,
  StudioSessionPath,
  type StudioSessionSocketEvent,
  type StudioSketchActionResult,
  type StudioSketchFlowActionRequest,
  type StudioSketchSnapApplyResult,
  type StudioSketchSnapProposalResult,
  type StudioSketchSnapRequest,
  type StudioSketchSnapUndoRequest,
  type StudioSketchSnapUndoResult,
  type StudioSketchUnsnapRequest,
  type StudioSourceActionEnvelope,
  type StudioSourceActionProposal,
  type StudioSourceActionResult,
  type StudioSourceActionUndoResult,
  StudioTransport,
} from '../StudioProtocol'
import type { StudioProjectOpenRequest, StudioSessionListing } from '../StudioSessionManager'
import type {
  StudioSketchCatalogRequest,
  StudioSketchCatalogSnapshot,
} from '../StudioSketchCatalog'
import type { StudioLanguageAnalysis } from '../StudioSyntaxLens'
import type { StudioTestRun, StudioTestStatus } from '../StudioTestRunner'

export type { StudioCompileDiagnostic, StudioDiagnosticRange } from '../StudioCompileCoordinator'

/** The slice of the compile snapshot the browser renders; the wire carries the whole `StudioCompileSnapshot`. */
export type StudioCompileState = Pick<
  StudioCompileSnapshot,
  'appliedRevision' | 'compileRevision' | 'diagnostics' | 'message' | 'status'
>

export type StudioFile = StudioProjectFile

/** The handshake as the browser reads it: the server's, with `compile` narrowed to the slice it renders. */
export type StudioHandshake = Omit<StudioSessionHandshake, 'compile'> & { compile: StudioCompileState }

export type StudioLspTransport = Transport & Readonly<{ close: () => void }>

export type StudioCellRuntimeResponse = {
  cell: StudioPreviewCell
  identity: StudioCellIdentity
}

export type StudioAIAvailability = {
  reason?: string
  status: 'available' | 'unavailable'
}

export type StudioBetaShipResult = {
  appName: string
  message: string
}

export type StudioGeneratedFixtureResult =
  | { fixture: StudioFixturePlan; status: 'ready' }
  | { code: string; error: string; issues?: readonly string[]; status: 'failed' }

/** One handler per message the event socket can send; the ones the workbench has no use for are optional. */
export type StudioApiEventHandlers = {
  onConnect?: () => void
  onCellReconfigured?: (cellId: string) => void
  onCheckpoint?: (checkpoint: Pick<StudioCheckpointSummary, 'id' | 'status'>) => void
  onCompile: (state: StudioCompileState) => void
  onDataInvalidated?: (invalidation: Omit<StudioDataInvalidatedEvent, 'type'>) => void
  onDeviceState?: (status: StudioDeviceStatus) => void
  onFile: (file: StudioFile) => void
  onFiles?: (files: readonly StudioFile[]) => void
  onManifest: (manifest: StudioPreviewManifestV2) => void
  onSketchCatalog?: (catalog: StudioSketchCatalogSnapshot) => void
  onHandshake?: (handshake: StudioHandshake) => void
  onWritesAcknowledged?: (acknowledgements: readonly StudioWriteAcknowledgement[]) => void
  onDisconnect: () => void
}

export const StudioApiRoutes = {
  currentSessionId(locationPath: string): string | undefined {
    return StudioSessionPath.sessionIdOf(locationPath)
  },
  /** Every Studio page is served under its own window ID, so an unscoped location is never routable. */
  sessionPath(locationPath: string, endpoint: string): string {
    const sessionId = this.currentSessionId(locationPath)
    if (sessionId === undefined) {
      Errors.throwUnexpected('Studio requests require a managed session window.')
    }
    return StudioSessionPath.endpoint(sessionId, endpoint)
  },
  transitionUrl(
    transition: Pick<StudioSessionTransition, 'previewUrl' | 'url'>,
    current: URL,
  ): string {
    const target = new URL(transition.url, current.origin)
    if (target.origin !== current.origin || !StudioSessionPath.isWindowRoot(target.pathname)) {
      Errors.throwUnexpected('Studio returned an invalid managed session URL.')
    }
    if (current.searchParams.get('native-window') === 'project') {
      target.searchParams.set('native-window', 'project')
      if (transition.previewUrl !== undefined) {
        target.searchParams.set('native-preview-url', transition.previewUrl)
      }
    }
    return `${target.pathname}${target.search}`
  },
} as const

export type StudioSessionTransition = Readonly<{
  previewUrl?: string
  session: Readonly<{ appName: string; project: string; sessionId: string }>
  url: string
}>

export class StudioApiError extends Error {
  override readonly name = 'StudioApiError'

  constructor(
    message: string,
    readonly status: number,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
  }
}

export const StudioApiEventStream = {
  /** dispatch routes one socket message to its handler; a server event with no branch here is a type error. */
  dispatch(message: StudioHandshake | StudioSessionSocketEvent, handlers: StudioApiEventHandlers): void {
    Switch.on(message, 'type', {
      'cell-reconfigured': event => handlers.onCellReconfigured?.(event.cellId),
      'checkpoint-changed': event => handlers.onCheckpoint?.(event.checkpoint),
      'compile-state': event => handlers.onCompile(event.state),
      'data-invalidated': event => handlers.onDataInvalidated?.({ entities: event.entities, revision: event.revision }),
      'device-state': event => handlers.onDeviceState?.(event.status),
      'file-changed': event => handlers.onFile(event.file),
      'files-changed': event => handlers.onFiles?.(event.files),
      handshake: event => handlers.onHandshake?.(event),
      'preview-manifest-changed': event => handlers.onManifest(event.manifest),
      'sketch-catalog-changed': event => handlers.onSketchCatalog?.(event.catalog),
      'studio-writes-acknowledged': event => handlers.onWritesAcknowledged?.(event.acknowledgements),
    })
  },
}

const routes = StudioRoutes.session
const manager = StudioRoutes.manager

/** Typed boundary around Studio's HTTP and WebSocket endpoints. */
export const StudioApiClient = {
  agentChat: async <Result>(command: string, body: unknown): Promise<Result> =>
    await request(StudioRoutes.path(routes.agentChat, { command }), body),

  /**
   * Runs one chat turn, reporting each newline-delimited event as it arrives and resolving with the final
   * turn. Waiting for the whole response before printing anything makes a working agent look like a hung one.
   */
  agentChatStream: async <Result>(
    command: string,
    body: unknown,
    onEvent: (event: { type: string; text?: string; name?: string }) => void,
  ): Promise<Result> => {
    const response = await fetch(
      studioSessionPath(StudioRoutes.path(routes.agentChatStream, { command })),
      StudioTransport.jsonPostInit(body),
    )
    if (!response.ok || response.body === null) {
      Errors.throwHostEnvironment(`Studio returned ${response.status} for the chat stream.`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffered = ''
    let turn: Result | undefined
    const consume = (line: string) => {
      if (line.trim() === '') {
        return
      }
      const event = JSON.parse(line) as { type: string; turn?: Result }
      if (event.type === 'done') {
        turn = event.turn
      } else {
        onEvent(event as { type: string; text?: string; name?: string })
      }
    }
    while (true) {
      const { done, value } = await reader.read()
      buffered += decoder.decode(value, { stream: !done })
      let newline = buffered.indexOf('\n')
      while (newline >= 0) {
        consume(buffered.slice(0, newline))
        buffered = buffered.slice(newline + 1)
        newline = buffered.indexOf('\n')
      }
      if (done) {
        break
      }
    }
    consume(buffered)
    if (turn === undefined) {
      Errors.throwHostEnvironment('The chat stream ended without a result.')
    }
    return turn
  },

  aiAvailability: async (): Promise<StudioAIAvailability> => await get(routes.aiAvailability),
  betaShip: async (): Promise<StudioBetaShipResult> => await request(routes.shipBeta, {}),
  captureFixture: async <Result>(body: unknown): Promise<Result> => await request(routes.sourceAction, body),
  cellInstance: async (body: unknown, signal?: AbortSignal): Promise<unknown> =>
    await request(routes.previewCellInstance, body, signal),
  connectEvents,
  createFile: async (body: StudioCreateFileRequest): Promise<StudioCreateFileResult> =>
    await request(routes.fileCreate, body),
  draft: async (body: StudioDraftSyncRequest): Promise<StudioDraftSyncResult> => await request(routes.fileDraft, body),
  deleteFile: async (body: StudioDeleteFileRequest): Promise<StudioDeleteFileResult> =>
    await request(routes.fileDelete, body),
  deviceHighlight: async (
    body: {
      occurrence?: { end: number; ownerName?: string; sourcePath: string; sourceVersion: string; start: number }
    },
  ): Promise<{ delivered: boolean }> => await request(routes.deviceHighlight, body),
  deviceConfirmPairing: async (devicePublicKey: string): Promise<{ accepted: boolean }> =>
    await request(routes.devicePairingConfirm, { devicePublicKey }),
  deviceDeclinePairing: async (devicePublicKey: string): Promise<{ declined: boolean }> =>
    await request(routes.devicePairingDecline, { devicePublicKey }),
  deviceLaunch: async (): Promise<StudioDeviceLaunchInfo> => await get(routes.deviceLaunch),
  deviceLaunchOpen: async (hostId: string, route: 'auto' | 'cable' = 'auto'): Promise<StudioDeviceLaunchOpenResult> =>
    await request(routes.deviceLaunchOpen, { hostId, route }),
  deviceOpenPairing: async (): Promise<{ expiresAt: string }> => await request(routes.devicePairingOpen, {}),
  deviceReconnect: async (): Promise<{ requested: boolean }> => await request(routes.deviceReconnect, {}),
  deviceRevoke: async (devicePublicKey: string): Promise<{ revoked: boolean }> =>
    await request(routes.deviceRevoke, { devicePublicKey }),
  deviceSelectCell: async (cellId: string): Promise<{ requested: boolean }> =>
    await request(routes.deviceSelectCell, { cellId }),
  deviceStatus: async (signal?: AbortSignal): Promise<StudioDeviceStatus> => await get(routes.deviceStatus, signal),
  file: async (path: string, signal?: AbortSignal): Promise<StudioDraftFile> =>
    await get(`${routes.file.path}?path=${encodeURIComponent(path)}`, signal),
  files: async (): Promise<{ files: readonly StudioFile[] }> => await get(routes.files),
  moveGeneratedSource: async (body: StudioMoveGeneratedSourceRequest): Promise<StudioMoveGeneratedSourceResult> =>
    await request(routes.fileMoveGenerated, body),
  generateFixture: async (scenarioId: string): Promise<StudioGeneratedFixtureResult> =>
    await request(routes.aiFixture, { scenarioId }),
  handshake: async (signal?: AbortSignal): Promise<StudioHandshake> => await get(routes.protocol, signal),
  highlight: async (content: string): Promise<StudioLanguageAnalysis> =>
    await request(routes.languageHighlight, { content }),
  inspectRender: async (
    body: StudioInspectRenderRequest,
  ): Promise<StudioRenderInspection> => await request(routes.sourceActionInspect, body),
  lspTransport: async (signal?: AbortSignal): Promise<StudioLspTransport> =>
    await webSocketTransport(webSocketUrl(studioSessionPath(routes.languageLsp.path)), signal),
  previewApplied: async (body: unknown): Promise<unknown> => await request(routes.previewApplied, body),
  previewLayoutMeasurements: async (body: unknown): Promise<unknown> =>
    await request(routes.previewLayoutMeasurements, body),
  previewDiagnosis: async (signal?: AbortSignal): Promise<{ message?: string; status: string }> =>
    await get(routes.previewDiagnosis, signal),
  previewInstance: async (body: unknown, signal?: AbortSignal): Promise<unknown> =>
    await request(routes.previewInstance, body, signal),
  reconfigureCell: async (body: unknown): Promise<StudioCellRuntimeResponse> =>
    await request(routes.previewCellReconfigure, body),
  renameFile: async (body: StudioRenameFileRequest): Promise<StudioRenameFileResult> =>
    await request(routes.fileRename, body),
  sketchAction: async (body: StudioSketchCatalogRequest): Promise<StudioSketchActionResult> =>
    await request(routes.sketchAction, body),
  sketchFlowAction: async (body: StudioSketchFlowActionRequest): Promise<StudioSketchSnapApplyResult> =>
    await request(routes.sketchFlowAction, body),
  sketchSnapApply: async (body: StudioSketchSnapRequest): Promise<StudioSketchSnapApplyResult> =>
    await request(routes.sketchSnapApply, body),
  sketchSnapProposal: async (body: StudioSketchSnapRequest): Promise<StudioSketchSnapProposalResult> =>
    await request(routes.sketchSnapPropose, body),
  sketchUnsnapApply: async (body: StudioSketchUnsnapRequest): Promise<StudioSketchSnapApplyResult> =>
    await request(routes.sketchUnsnapApply, body),
  sketches: async (): Promise<StudioSketchCatalogSnapshot> => await get(routes.sketches),
  sessions: async (signal?: AbortSignal): Promise<StudioSessionListing> => await rootGet(manager.sessions.path, signal),
  closeCurrentSession: async (): Promise<void> => {
    const sessionId = StudioApiRoutes.currentSessionId(window.location.pathname)
    if (sessionId === undefined) {
      Errors.throwUnexpected('Project selection requires a managed Studio session.')
    }
    await rootRequest(StudioRoutes.path(manager.closeSession, { sessionId }), {})
  },
  sourceAction: async (body: StudioSourceActionEnvelope | unknown): Promise<StudioSourceActionResult> =>
    await request(routes.sourceAction, body),
  sourceActionProposal: async (body: StudioSourceActionEnvelope | unknown): Promise<StudioSourceActionProposal> =>
    await request(routes.sourceActionPropose, body),
  switchSession: async (body: StudioProjectOpenRequest): Promise<StudioSessionTransition> => {
    const sessionId = StudioApiRoutes.currentSessionId(window.location.pathname)
    if (sessionId === undefined) {
      Errors.throwUnexpected('Project and app switching require a managed Studio session.')
    }
    return await rootRequest(StudioRoutes.path(manager.switchSession, { sessionId }), body)
  },
  testRun: async (): Promise<StudioTestRun> => await request(routes.testsRun, {}),
  testStatus: async (): Promise<StudioTestStatus> => await get(routes.testsStatus),
  undoSourceAction: async (body: unknown): Promise<StudioSourceActionUndoResult> =>
    await request(routes.sourceActionUndo, body),
  undoSketchSnap: async (body: StudioSketchSnapUndoRequest): Promise<StudioSketchSnapUndoResult> =>
    await request(routes.sketchSnapUndo, body),
} as const

async function get<Result>(route: StudioRoute | string, signal?: AbortSignal): Promise<Result> {
  return await response<Result>(await fetch(studioSessionPath(pathOf(route)), { signal }))
}

async function request<Result>(route: StudioRoute | string, body: unknown, signal?: AbortSignal): Promise<Result> {
  return await response<Result>(
    await fetch(studioSessionPath(pathOf(route)), { ...StudioTransport.jsonPostInit(body), signal }),
  )
}

async function rootRequest<Result>(path: string, body: unknown): Promise<Result> {
  return await response<Result>(await fetch(path, StudioTransport.jsonPostInit(body)))
}

async function rootGet<Result>(path: string, signal?: AbortSignal): Promise<Result> {
  return await response<Result>(await fetch(path, { signal }))
}

/** A route stands for its path; a string is a path that already carries its query or parameters. */
function pathOf(route: StudioRoute | string): string {
  return typeof route === 'string' ? route : route.path
}

async function response<Result>(value: Response): Promise<Result> {
  const reply = await StudioTransport.readJsonReply<Result>(value)
  if (!reply.ok) {
    throw new StudioApiError(reply.error ?? `Tao Studio request failed (${reply.status}).`, reply.status, reply.details)
  }
  return reply.body
}

function connectEvents(handlers: StudioApiEventHandlers): WebSocket {
  const socket = new WebSocket(webSocketUrl(studioSessionPath(routes.events.path)))
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)) as StudioHandshake | StudioSessionSocketEvent
    StudioApiEventStream.dispatch(message, handlers)
  })
  socket.addEventListener('open', () => handlers.onConnect?.())
  socket.addEventListener('close', handlers.onDisconnect)
  return socket
}

function webSocketTransport(url: string, signal?: AbortSignal): Promise<StudioLspTransport> {
  return new Promise((resolve, reject) => {
    const handlers = new Set<(value: string) => void>()
    const socket = new WebSocket(url)
    let settled = false
    const close = (): void => {
      signal?.removeEventListener('abort', abort)
      socket.close()
    }
    const abort = (): void => {
      close()
      if (!settled) {
        reject(Errors.abortError('Tao language server connection was cancelled.'))
      }
    }
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    socket.addEventListener('open', () => {
      settled = true
      resolve({
        close,
        send(message) {
          socket.send(message)
        },
        subscribe(handler) {
          handlers.add(handler)
        },
        unsubscribe(handler) {
          handlers.delete(handler)
        },
      })
    })
    socket.addEventListener('message', event => {
      for (const handler of handlers) {
        handler(String(event.data))
      }
    })
    socket.addEventListener('error', () => {
      close()
      reject(new Errors.HostEnvironmentError('Could not connect to the Tao language server.'))
    })
  })
}

function studioSessionPath(path: string): string {
  return StudioApiRoutes.sessionPath(window.location.pathname, path)
}

function webSocketUrl(path: string): string {
  return StudioTransport.webSocketUrl(path, window.location.href)
}
