import type { Transport } from '@codemirror/lsp-client'
import { Errors } from '@shared/core'
import type { StudioRenderInspection } from '@source-actions'
import type { StudioDeviceLaunchInfo, StudioDeviceLaunchOpenResult } from '../device/StudioDeviceLauncher'
import type { StudioDeviceStateEvent, StudioDeviceStatus } from '../device/StudioDeviceStatus'
import type { StudioCompileCompletion } from '../StudioCompileCoordinator'
import type { StudioDraftFile, StudioDraftSyncRequest, StudioDraftSyncResult } from '../StudioDraftSync'
import type { StudioLanguageHighlight } from '../StudioHighlight'
import type { StudioCellIdentity, StudioPreviewCell, StudioPreviewManifestV2 } from '../StudioPreviewManifest'
import type {
  StudioAppVariant,
  StudioCreateFileRequest,
  StudioCreateFileResult,
  StudioDeleteFileRequest,
  StudioDeleteFileResult,
  StudioMoveGeneratedSourceRequest,
  StudioMoveGeneratedSourceResult,
  StudioRenameFileRequest,
  StudioRenameFileResult,
  StudioSessionHandshake,
  StudioSketchActionResult,
  StudioSketchFlowActionRequest,
  StudioSketchSnapApplyResult,
  StudioSketchSnapProposalResult,
  StudioSketchSnapRequest,
  StudioSketchSnapUndoRequest,
  StudioSketchSnapUndoResult,
  StudioSketchUnsnapRequest,
} from '../StudioProjectSession'
import type { StudioFixturePlan, StudioSourceActionEnvelope } from '../StudioProtocol'
import type { StudioProjectOpenRequest, StudioSessionListing } from '../StudioSessionManager'
import type {
  StudioSketchCatalogRequest,
  StudioSketchCatalogSnapshot,
} from '../StudioSketchCatalog'
import type { StudioTestRun, StudioTestStatus } from '../StudioTestRunner'

export type StudioCompileDiagnostic = {
  filePath?: string
  message: string
  range?: StudioDiagnosticRange
}

export type StudioCompileState = {
  appliedRevision: number
  compileRevision: number
  diagnostics?: readonly StudioCompileDiagnostic[]
  message: string
  status: 'idle' | 'compiling' | 'compiled' | 'error'
}

export type StudioDiagnosticRange = {
  end: { character: number; line: number }
  start: { character: number; line: number }
}

export type StudioFile = {
  diagnosticCount: number
  dirty: boolean
  path: string
  sourceVersion: string
}

export type StudioHandshake = {
  apps: readonly StudioAppVariant[]
  capabilities: StudioSessionHandshake['capabilities']
  compile: StudioCompileState
  entryPath: string
  files: readonly StudioFile[]
  identity: { appName: string; project: string }
  previewManifest?: StudioPreviewManifestV2
  sketchCatalog: StudioSketchCatalogSnapshot
  type: 'handshake'
}

export type StudioLspTransport = Transport & Readonly<{ close: () => void }>

export type StudioEvent =
  | StudioDeviceStateEvent
  | { state: StudioCompileState; type: 'compile-state' }
  | { file: StudioFile; type: 'file-changed' }
  | { files: readonly StudioFile[]; type: 'files-changed' }
  | { manifest: StudioPreviewManifestV2; type: 'preview-manifest-changed' }
  | { catalog: StudioSketchCatalogSnapshot; type: 'sketch-catalog-changed' }
  | { type: 'studio-writes-acknowledged' }

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

export type StudioSourceActionResult = {
  checkpoint: { id: string; status: 'committed' | 'open' }
  compile: StudioCompileCompletion
  content: string
  path: string
  sourceVersion: string
}

export type StudioSourceActionProposal = {
  content: string
  diff: string
  edits: readonly { end: number; replacement: string; start: number }[]
  path: string
  proposedSourceVersion: string
  requestId: string
  sourceVersion: string
}

export type StudioSourceActionUndoResult = {
  checkpoint: { id: string; status: 'undone' }
  compile: StudioCompileCompletion
  content: string
  path: string
  sourceVersion: string
}

export type StudioApiEventHandlers = {
  onConnect?: () => void
  onCompile: (state: StudioCompileState) => void
  onDeviceState?: (status: StudioDeviceStatus) => void
  onFile: (file: StudioFile) => void
  onFiles?: (files: readonly StudioFile[]) => void
  onManifest: (manifest: StudioPreviewManifestV2) => void
  onSketchCatalog?: (catalog: StudioSketchCatalogSnapshot) => void
  onHandshake?: (handshake: StudioHandshake) => void
  onDisconnect: () => void
}

export const StudioApiRoutes = {
  currentSessionId(locationPath: string): string | undefined {
    return locationPath.match(/^\/sessions\/([A-Za-z0-9_-]{1,128})(?:\/|$)/)?.[1]
  },
  /** Every Studio page is served under its own window ID, so an unscoped location is never routable. */
  sessionPath(locationPath: string, endpoint: string): string {
    const sessionId = this.currentSessionId(locationPath)
    if (sessionId === undefined) {
      Errors.throwUnexpected('Studio requests require a managed session window.')
    }
    return `/sessions/${sessionId}${endpoint}`
  },
  transitionUrl(
    transition: Pick<StudioSessionTransition, 'previewUrl' | 'url'>,
    current: URL,
  ): string {
    const target = new URL(transition.url, current.origin)
    if (target.origin !== current.origin || !/^\/sessions\/[A-Za-z0-9_-]{1,128}$/.test(target.pathname)) {
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
  dispatch(message: StudioHandshake | StudioEvent, handlers: StudioApiEventHandlers): void {
    if (message.type === 'handshake') {
      handlers.onHandshake?.(message)
    } else if (message.type === 'compile-state') {
      handlers.onCompile(message.state)
    } else if (message.type === 'file-changed') {
      handlers.onFile(message.file)
    } else if (message.type === 'files-changed') {
      handlers.onFiles?.(message.files)
    } else if (message.type === 'preview-manifest-changed') {
      handlers.onManifest(message.manifest)
    } else if (message.type === 'sketch-catalog-changed') {
      handlers.onSketchCatalog?.(message.catalog)
    } else if (message.type === 'device-state') {
      handlers.onDeviceState?.(message.status)
    }
  },
}

/** Typed boundary around Studio's HTTP and WebSocket endpoints. */
export const StudioApiClient = {
  aiAvailability: async (): Promise<StudioAIAvailability> => await get('/api/ai/availability'),
  betaShip: async (): Promise<StudioBetaShipResult> => await request('/api/ship/beta', {}),
  captureFixture: async <Result>(body: unknown): Promise<Result> => await request('/api/source-action', body),
  cellInstance: async (body: unknown, signal?: AbortSignal): Promise<unknown> =>
    await request('/api/preview/cell/instance', body, signal),
  connectEvents,
  createFile: async (body: StudioCreateFileRequest): Promise<StudioCreateFileResult> =>
    await request('/api/file/create', body),
  draft: async (body: StudioDraftSyncRequest): Promise<StudioDraftSyncResult> => await request('/api/file/draft', body),
  deleteFile: async (body: StudioDeleteFileRequest): Promise<StudioDeleteFileResult> =>
    await request('/api/file/delete', body),
  deviceHighlight: async (
    body: {
      occurrence?: { end: number; ownerName?: string; sourcePath: string; sourceVersion: string; start: number }
    },
  ): Promise<{ delivered: boolean }> => await request('/api/device/highlight', body),
  deviceConfirmPairing: async (devicePublicKey: string): Promise<{ accepted: boolean }> =>
    await request('/api/device/pairing/confirm', { devicePublicKey }),
  deviceDeclinePairing: async (devicePublicKey: string): Promise<{ declined: boolean }> =>
    await request('/api/device/pairing/decline', { devicePublicKey }),
  deviceLaunch: async (): Promise<StudioDeviceLaunchInfo> => await get('/api/device/launch'),
  deviceLaunchOpen: async (hostId: string): Promise<StudioDeviceLaunchOpenResult> =>
    await request('/api/device/launch/open', { hostId }),
  deviceOpenPairing: async (): Promise<{ expiresAt: string }> => await request('/api/device/pairing/open', {}),
  deviceReconnect: async (): Promise<{ requested: boolean }> => await request('/api/device/reconnect', {}),
  deviceRevoke: async (devicePublicKey: string): Promise<{ revoked: boolean }> =>
    await request('/api/device/revoke', { devicePublicKey }),
  deviceSelectCell: async (cellId: string): Promise<{ requested: boolean }> =>
    await request('/api/device/select-cell', { cellId }),
  deviceStatus: async (signal?: AbortSignal): Promise<StudioDeviceStatus> => await get('/api/device/status', signal),
  file: async (path: string, signal?: AbortSignal): Promise<StudioDraftFile> =>
    await get(`/api/file?path=${encodeURIComponent(path)}`, signal),
  files: async (): Promise<{ files: readonly StudioFile[] }> => await get('/api/files'),
  moveGeneratedSource: async (body: StudioMoveGeneratedSourceRequest): Promise<StudioMoveGeneratedSourceResult> =>
    await request('/api/file/move-generated', body),
  generateFixture: async (scenarioId: string): Promise<StudioGeneratedFixtureResult> =>
    await request('/api/ai/fixture', { scenarioId }),
  handshake: async (signal?: AbortSignal): Promise<StudioHandshake> => await get('/api/protocol', signal),
  highlight: async (content: string): Promise<StudioLanguageHighlight> =>
    await request('/api/language/highlight', { content }),
  inspectRender: async (
    body: { path: string; renderId: string; sourceVersion: string },
  ): Promise<StudioRenderInspection> => await request('/api/source-action/inspect', body),
  lspTransport: async (signal?: AbortSignal): Promise<StudioLspTransport> =>
    await webSocketTransport(webSocketUrl(studioSessionPath('/api/language/lsp')), signal),
  previewApplied: async (body: unknown): Promise<unknown> => await request('/api/preview/applied', body),
  previewLayoutMeasurements: async (body: unknown): Promise<unknown> =>
    await request('/api/preview/layout-measurements', body),
  previewInstance: async (body: unknown, signal?: AbortSignal): Promise<unknown> =>
    await request('/api/preview/instance', body, signal),
  reconfigureCell: async (body: unknown): Promise<StudioCellRuntimeResponse> =>
    await request('/api/preview/cell/reconfigure', body),
  renameFile: async (body: StudioRenameFileRequest): Promise<StudioRenameFileResult> =>
    await request('/api/file/rename', body),
  sketchAction: async (body: StudioSketchCatalogRequest): Promise<StudioSketchActionResult> =>
    await request('/api/sketches/action', body),
  sketchFlowAction: async (body: StudioSketchFlowActionRequest): Promise<StudioSketchSnapApplyResult> =>
    await request('/api/sketches/flow/action', body),
  sketchSnapApply: async (body: StudioSketchSnapRequest): Promise<StudioSketchSnapApplyResult> =>
    await request('/api/sketches/snap/apply', body),
  sketchSnapProposal: async (body: StudioSketchSnapRequest): Promise<StudioSketchSnapProposalResult> =>
    await request('/api/sketches/snap/propose', body),
  sketchUnsnapApply: async (body: StudioSketchUnsnapRequest): Promise<StudioSketchSnapApplyResult> =>
    await request('/api/sketches/unsnap/apply', body),
  sketches: async (): Promise<StudioSketchCatalogSnapshot> => await get('/api/sketches'),
  sessions: async (signal?: AbortSignal): Promise<StudioSessionListing> => await rootGet('/api/sessions', signal),
  closeCurrentSession: async (): Promise<void> => {
    const sessionId = StudioApiRoutes.currentSessionId(window.location.pathname)
    if (sessionId === undefined) {
      Errors.throwUnexpected('Project selection requires a managed Studio session.')
    }
    await rootRequest(`/api/sessions/${encodeURIComponent(sessionId)}/close`, {})
  },
  sourceAction: async (body: StudioSourceActionEnvelope | unknown): Promise<StudioSourceActionResult> =>
    await request('/api/source-action', body),
  sourceActionProposal: async (body: StudioSourceActionEnvelope | unknown): Promise<StudioSourceActionProposal> =>
    await request('/api/source-action/propose', body),
  switchSession: async (body: StudioProjectOpenRequest): Promise<StudioSessionTransition> => {
    const sessionId = StudioApiRoutes.currentSessionId(window.location.pathname)
    if (sessionId === undefined) {
      Errors.throwUnexpected('Project and app switching require a managed Studio session.')
    }
    return await rootRequest(`/api/sessions/${encodeURIComponent(sessionId)}/switch`, body)
  },
  testRun: async (): Promise<StudioTestRun> => await request('/api/tests/run', {}),
  testStatus: async (): Promise<StudioTestStatus> => await get('/api/tests/status'),
  undoSourceAction: async (body: unknown): Promise<StudioSourceActionUndoResult> =>
    await request('/api/source-action/undo', body),
  undoSketchSnap: async (body: StudioSketchSnapUndoRequest): Promise<StudioSketchSnapUndoResult> =>
    await request('/api/sketches/snap/undo', body),
} as const

async function get<Result>(path: string, signal?: AbortSignal): Promise<Result> {
  return await response<Result>(await fetch(studioSessionPath(path), { signal }))
}

async function request<Result>(path: string, body: unknown, signal?: AbortSignal): Promise<Result> {
  return await response<Result>(
    await fetch(studioSessionPath(path), {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal,
    }),
  )
}

async function rootRequest<Result>(path: string, body: unknown): Promise<Result> {
  return await response<Result>(
    await fetch(path, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  )
}

async function rootGet<Result>(path: string, signal?: AbortSignal): Promise<Result> {
  return await response<Result>(await fetch(path, { signal }))
}

async function response<Result>(value: Response): Promise<Result> {
  const body = await value.json() as Result | { details?: unknown; error?: string }
  if (!value.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined
    const details = typeof body === 'object'
        && body !== null
        && 'details' in body
        && typeof body.details === 'object'
        && body.details !== null
      ? body.details as Readonly<Record<string, unknown>>
      : undefined
    throw new StudioApiError(message ?? `Tao Studio request failed (${value.status}).`, value.status, details)
  }
  return body as Result
}

function connectEvents(handlers: StudioApiEventHandlers): WebSocket {
  const socket = new WebSocket(webSocketUrl(studioSessionPath('/events')))
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)) as StudioHandshake | StudioEvent
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
        const error = new Error('Tao language server connection was cancelled.')
        error.name = 'AbortError'
        reject(error)
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
      reject(new Error('Could not connect to the Tao language server.'))
    })
  })
}

function studioSessionPath(path: string): string {
  return StudioApiRoutes.sessionPath(window.location.pathname, path)
}

function webSocketUrl(path: string): string {
  const url = new URL(path, window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
