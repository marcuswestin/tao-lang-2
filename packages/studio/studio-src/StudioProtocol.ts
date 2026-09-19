import type { TaoSchemeCapability } from '@runtime/TR-scheme'
import { TaoStudioProtocolVersions } from '@runtime/TR-studio-protocol'
import { Assert } from '@shared/core'
import type { StudioDeviceStateEvent } from './device/StudioDeviceStatus'
import type {
  StudioCompileCompletion,
  StudioCompileSnapshot,
  StudioWatchResult,
} from './StudioCompileCoordinator'
import type { StudioPreviewManifestV2 } from './StudioPreviewManifest'
import type { StudioServerInvalidation } from './StudioServerDatasource'
import type {
  studioSketchCatalogFormatVersion,
  StudioSketchCatalogResult,
  StudioSketchCatalogSnapshot,
} from './StudioSketchCatalog'
import type { StudioSketchSnapTree } from './StudioSketchSnap'

/**
 * The capability a browser cell reports: it follows the page's color scheme as it changes. Mirrors
 * `reactiveBrowserSchemeCapability` in packages/runtime/TaoRuntime-src/TR-scheme.ts; a runtime value
 * import here would pull React Native into the packaged Studio service bundle.
 */
export const reactiveBrowserSchemeCapability = 'reactive-browser' satisfies TaoSchemeCapability

/*
 * StudioProtocol is the one wire contract between the Studio server, the browser client, the Tao-side
 * foreign actions, and the preview iframe. Every DTO, route, and event either side sends is declared
 * here once, so a shape or path only exists in one place and a mismatch fails to typecheck rather
 * than at runtime.
 */

export const studioProtocolVersion = TaoStudioProtocolVersions.protocolVersion
export const studioProtocolChannel = TaoStudioProtocolVersions.channel
export const studioSourceActionVersion = TaoStudioProtocolVersions.sourceActionVersion

// ---- Session identity and window paths

/** The grammar of one opaque window/session id; anything else in a path never reaches a session. */
const sessionIdGrammar = '[A-Za-z0-9_-]{1,128}'
const sessionIdPattern = new RegExp(`^${sessionIdGrammar}$`)
const sessionWindowPattern = new RegExp(`^/sessions/(${sessionIdGrammar})(/.*)?$`)
const sessionWindowRootPattern = new RegExp(`^/sessions/${sessionIdGrammar}$`)

/** Every Studio page is served under `/sessions/<id>`, and every session endpoint hangs off that window path. */
export const StudioSessionPath = {
  /** endpoint scopes one session route under the window that owns it. */
  endpoint(sessionId: string, path: string): string {
    return `${this.window(sessionId)}${path}`
  },
  isValidSessionId(value: string): boolean {
    return sessionIdPattern.test(value)
  },
  /** isWindowRoot accepts exactly `/sessions/<id>`, the URL a session transition may land on. */
  isWindowRoot(pathname: string): boolean {
    return sessionWindowRootPattern.test(pathname)
  },
  /** route splits a request path into the window's session id and the path the session sees. */
  route(pathname: string): { pathname: string; sessionId: string } | undefined {
    const matched = pathname.match(sessionWindowPattern)
    return matched === null ? undefined : { pathname: matched[2] ?? '/', sessionId: matched[1]! }
  },
  /** sessionIdOf reads the session id a page location is scoped to, if any. */
  sessionIdOf(pathname: string): string | undefined {
    return this.route(pathname)?.sessionId
  },
  window(sessionId: string): string {
    return `/sessions/${encodeURIComponent(sessionId)}`
  },
} as const

// ---- Route table

type StudioRouteMethod = 'GET' | 'POST' | 'WS'

/** One HTTP or WebSocket route; a `:name` segment is a parameter, and `:sessionId` must satisfy the id grammar. */
export type StudioRoute = Readonly<{ method: StudioRouteMethod; path: string }>

/** Routes served at the server root: the Welcome surface and session management. */
const managerRoutes = {
  closeAllSessions: { method: 'POST', path: '/api/sessions/close-all' },
  closeSession: { method: 'POST', path: '/api/sessions/:sessionId/close' },
  openSession: { method: 'POST', path: '/api/sessions/open' },
  root: { method: 'GET', path: '/' },
  sessions: { method: 'GET', path: '/api/sessions' },
  switchSession: { method: 'POST', path: '/api/sessions/:sessionId/switch' },
  welcome: { method: 'GET', path: '/welcome' },
} as const satisfies Record<string, StudioRoute>

/** Routes served under one session window; the handshake advertises this table as `endpoints`. */
const sessionRoutes = {
  agentChat: { method: 'POST', path: '/api/agent-chat/:command' },
  agentChatStream: { method: 'POST', path: '/api/agent-chat/stream/:command' },
  aiAvailability: { method: 'GET', path: '/api/ai/availability' },
  aiFixture: { method: 'POST', path: '/api/ai/fixture' },
  dataFill: { method: 'POST', path: '/api/data/fill' },
  deviceCapture: { method: 'POST', path: '/api/device/capture' },
  deviceHighlight: { method: 'POST', path: '/api/device/highlight' },
  deviceLaunch: { method: 'GET', path: '/api/device/launch' },
  deviceLaunchOpen: { method: 'POST', path: '/api/device/launch/open' },
  devicePairingConfirm: { method: 'POST', path: '/api/device/pairing/confirm' },
  devicePairingDecline: { method: 'POST', path: '/api/device/pairing/decline' },
  devicePairingOpen: { method: 'POST', path: '/api/device/pairing/open' },
  deviceReconnect: { method: 'POST', path: '/api/device/reconnect' },
  deviceRevoke: { method: 'POST', path: '/api/device/revoke' },
  deviceSelectCell: { method: 'POST', path: '/api/device/select-cell' },
  deviceStatus: { method: 'GET', path: '/api/device/status' },
  events: { method: 'WS', path: '/events' },
  file: { method: 'GET', path: '/api/file' },
  fileCreate: { method: 'POST', path: '/api/file/create' },
  fileDelete: { method: 'POST', path: '/api/file/delete' },
  fileDraft: { method: 'POST', path: '/api/file/draft' },
  fileMoveGenerated: { method: 'POST', path: '/api/file/move-generated' },
  fileRename: { method: 'POST', path: '/api/file/rename' },
  files: { method: 'GET', path: '/api/files' },
  languageHighlight: { method: 'POST', path: '/api/language/highlight' },
  languageLsp: { method: 'WS', path: '/api/language/lsp' },
  previewApplied: { method: 'POST', path: '/api/preview/applied' },
  previewCell: { method: 'GET', path: '/api/preview/cell' },
  previewCellBootstrap: { method: 'GET', path: '/api/preview/cell/bootstrap' },
  previewCellInstance: { method: 'POST', path: '/api/preview/cell/instance' },
  previewCellReconfigure: { method: 'POST', path: '/api/preview/cell/reconfigure' },
  previewDiagnosis: { method: 'GET', path: '/api/preview/diagnosis' },
  previewInstance: { method: 'POST', path: '/api/preview/instance' },
  previewLayoutMeasurements: { method: 'POST', path: '/api/preview/layout-measurements' },
  previewManifest: { method: 'GET', path: '/api/preview/manifest' },
  protocol: { method: 'GET', path: '/api/protocol' },
  shipBeta: { method: 'POST', path: '/api/ship/beta' },
  sketchAction: { method: 'POST', path: '/api/sketches/action' },
  sketchFlowAction: { method: 'POST', path: '/api/sketches/flow/action' },
  sketchSnapApply: { method: 'POST', path: '/api/sketches/snap/apply' },
  sketchSnapPropose: { method: 'POST', path: '/api/sketches/snap/propose' },
  sketchSnapUndo: { method: 'POST', path: '/api/sketches/snap/undo' },
  sketchUnsnapApply: { method: 'POST', path: '/api/sketches/unsnap/apply' },
  sketches: { method: 'GET', path: '/api/sketches' },
  sourceAction: { method: 'POST', path: '/api/source-action' },
  sourceActionInspect: { method: 'POST', path: '/api/source-action/inspect' },
  sourceActionPropose: { method: 'POST', path: '/api/source-action/propose' },
  sourceActionUndo: { method: 'POST', path: '/api/source-action/undo' },
  testsRun: { method: 'POST', path: '/api/tests/run' },
  testsStatus: { method: 'GET', path: '/api/tests/status' },
} as const satisfies Record<string, StudioRoute>

const routePatterns = new Map<StudioRoute, RegExp>()

/** StudioRoutes is the one route table the server dispatcher, the handshake, and every client consume. */
export const StudioRoutes = {
  /** The browser client page of one session window. */
  client: { method: 'GET', path: '/' },
  /** The client bundle, served at the root and under any session window alike. */
  clientBundle: { method: 'GET', path: '/studio.js' },
  /** Development servers answer their bundle revision here so an open client can reload itself. */
  devRevision: { method: 'GET', path: '/studio-dev/revision' },
  manager: managerRoutes,
  session: sessionRoutes,

  /** match returns the route's parameters when `pathname` is that route, and undefined otherwise. */
  match(route: StudioRoute, pathname: string): Readonly<Record<string, string>> | undefined {
    if (!route.path.includes(':')) {
      return pathname === route.path ? {} : undefined
    }
    const groups = pathname.match(routePattern(route))?.groups
    if (groups === undefined) {
      return undefined
    }
    try {
      return Object.fromEntries(Object.entries(groups).map(([name, value]) => [name, decodeURIComponent(value)]))
    } catch {
      return undefined
    }
  },
  /** matchesRequest is `match` plus the method check the HTTP dispatcher applies. */
  matchesRequest(route: StudioRoute, method: string, pathname: string): boolean {
    return route.method === method && this.match(route, pathname) !== undefined
  },
  /** path fills the route's parameters, so a caller never spells a parameterised path by hand. */
  path(route: StudioRoute, parameters: Readonly<Record<string, string>> = {}): string {
    return route.path.replaceAll(/:([A-Za-z]+)/g, (_segment, name: string): string => {
      const value: string | undefined = parameters[name]
      Assert.defined(value, `a ${name} for the Studio route ${route.path}`)
      return encodeURIComponent(value)
    })
  },
} as const

function routePattern(route: StudioRoute): RegExp {
  const cached = routePatterns.get(route)
  if (cached !== undefined) {
    return cached
  }
  const source = route.path
    .split('/')
    .map(segment =>
      segment === ':sessionId'
        ? `(?<sessionId>${sessionIdGrammar})`
        : segment.startsWith(':')
        ? `(?<${segment.slice(1)}>[^/]+)`
        : segment.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
    )
    .join('/')
  const pattern = new RegExp(`^${source}$`)
  routePatterns.set(route, pattern)
  return pattern
}

/** Every session-scoped route, in the shape the handshake advertises. */
export const studioSessionEndpoints: readonly StudioRoute[] = Object.values(sessionRoutes)

// ---- Transport

export type StudioJsonPostInit = Readonly<{
  body: string
  headers: Readonly<{ 'content-type': 'application/json' }>
  method: 'POST'
}>

/** One Studio JSON reply, unwrapped: the typed body on success, or the `{ error, details }` failure shape. */
export type StudioJsonReply<Result> =
  | Readonly<{ body: Result; ok: true; status: number }>
  | Readonly<{ details?: Readonly<Record<string, unknown>>; error?: string; ok: false; status: number }>

/** StudioTransport is what every HTTP or WebSocket caller of the session routes shares. */
export const StudioTransport = {
  jsonPostInit(body: unknown): StudioJsonPostInit {
    return { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST' }
  },
  async readJsonReply<Result>(response: Pick<Response, 'json' | 'ok' | 'status'>): Promise<StudioJsonReply<Result>> {
    const body = await response.json() as unknown
    if (response.ok) {
      return { body: body as Result, ok: true, status: response.status }
    }
    const failure = typeof body === 'object' && body !== null ? body as Readonly<Record<string, unknown>> : {}
    const details = failure['details']
    return {
      ...(typeof details === 'object' && details !== null
        ? { details: details as Readonly<Record<string, unknown>> }
        : {}),
      ...(typeof failure['error'] === 'string' ? { error: failure['error'] } : {}),
      ok: false,
      status: response.status,
    }
  },
  /** webSocketUrl resolves a path against the page or server URL and swaps in the matching socket scheme. */
  webSocketUrl(path: string, base: string): string {
    const url = new URL(path, base)
    const socketProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${socketProtocol}${url.toString().slice(url.protocol.length)}`
  },
} as const

// ---- Session DTOs

export type StudioProjectFile = {
  diagnosticCount: number
  dirty: boolean
  kind: 'file'
  path: string
  sourceVersion: string
}

export type StudioProjectFileContent = StudioProjectFile & {
  content: string
}

export type StudioAppVariant = Readonly<{
  appName: string
  entryPath: string
}>

export type StudioDraftWriteRequest = {
  content: string
  path: string
  sourceVersion: string
  writeId: string
}

export type StudioDraftWriteResult = {
  compile?: StudioCompileCompletion
  diagnostics: readonly string[]
  file: StudioProjectFileContent
  saved: boolean
}

export type StudioCreateFileRequest = {
  path: string
  writeId: string
}

export type StudioRenameFileRequest = {
  path: string
  sourceVersion: string
  targetPath: string
  writeId: string
}

export type StudioDeleteFileRequest = {
  path: string
  sourceVersion: string
  writeId: string
}

export type StudioMoveGeneratedSourceRequest = {
  path: string
  sourceVersion: string
  targetPackage: string
  writeId: string
}

export type StudioCreateFileResult = {
  compile: StudioCompileCompletion
  file: StudioProjectFileContent
  files: readonly StudioProjectFile[]
}

export type StudioRenameFileResult = StudioCreateFileResult & {
  previousPath: string
}

export type StudioDeleteFileResult = {
  compile: StudioCompileCompletion
  deleted: StudioProjectFile
  files: readonly StudioProjectFile[]
}

export type StudioMoveGeneratedSourceResult =
  | {
    conflicts: readonly string[]
    name: string
    status: 'confirmation-required'
    targetPackage: string
  }
  | {
    compile: StudioCompileCompletion
    file: StudioProjectFileContent
    files: readonly StudioProjectFile[]
    previousPath: string
    rewritten: readonly StudioProjectFileContent[]
    status: 'moved'
  }

export type StudioCheckpointSummary = {
  afterSourceVersion: string
  beforeSourceVersion: string
  id: string
  path: string
  status: 'committed' | 'open' | 'undone'
}

export type StudioInspectRenderRequest = {
  /** The selecting cell instance; with it the owner's root render is reported with its measured rectangle. */
  identity?: StudioSourceActionIdentity
  path: string
  renderId: string
  sourceVersion: string
}

export type StudioSourceActionResult = {
  checkpoint: {
    id: string
    status: 'committed' | 'open'
  }
  compile: StudioCompileCompletion
  content: string
  edits: readonly {
    end: number
    replacement: string
    start: number
  }[]
  path: string
  requestId: string
  sourceVersion: string
}

export type StudioSourceActionProposal = {
  content: string
  diff: string
  edits: readonly {
    end: number
    replacement: string
    start: number
  }[]
  path: string
  proposedSourceVersion: string
  requestId: string
  sourceVersion: string
}

export type StudioSourceActionUndoResult = {
  checkpoint: {
    id: string
    status: 'undone'
  }
  compile: StudioCompileCompletion
  content: string
  path: string
  requestId: string
  sourceVersion: string
}

export type StudioSketchActionResult =
  & StudioSketchCatalogResult
  & Readonly<{
    compile?: StudioCompileCompletion
    generatedFile?: StudioProjectFileContent
  }>

export type StudioSketchSnapRequest = Readonly<{
  checkpointId: string
  confirmedProposalVersion?: string
  expectedCatalogRevision: number
  rectIds: readonly string[]
  requestId: string
  sketchId: string
  sourceVersion: string
}>

export type StudioSketchUnsnapRequest = Readonly<
  Omit<StudioSketchSnapRequest, 'confirmedProposalVersion'>
>

export type StudioSketchFlowAction =
  | Readonly<{ kind: 'toggle-direction'; rectId: string }>
  | Readonly<{ afterRectId: string; beforeRectId?: string; kind: 'insert-separator' }>
  | Readonly<{
    afterRectId: string
    beforeRectId: string
    kind: 'insert-spacer'
    ratio: readonly [number, number]
  }>

/** Browser-safe flow intent; render identities remain a server/catalog implementation detail. */
export type StudioSketchFlowActionRequest = Readonly<{
  action: StudioSketchFlowAction
  checkpointId: string
  expectedCatalogRevision: number
  requestId: string
  sketchId: string
  sourceVersion: string
}>

export type StudioSketchSnapProposalResult = Readonly<{
  content: string
  diff: string
  needsConfirmation: boolean
  path: string
  projectedRectIds: readonly string[]
  proposedSourceVersion: string
  requestId: string
  sourceVersion: string
  tree: StudioSketchSnapTree
}>

export type StudioSketchSnapApplyResult = Readonly<{
  catalog: StudioSketchCatalogSnapshot
  checkpoint: { id: string; status: 'committed' }
  compile: StudioCompileCompletion
  file: StudioProjectFileContent
  projectedRectIds: readonly string[]
  requestId: string
}>

export type StudioSketchSnapUndoRequest = Readonly<{
  checkpointId: string
  expectedCatalogRevision: number
  requestId: string
  sourceVersion: string
}>

export type StudioSketchSnapUndoResult = Readonly<{
  catalog: StudioSketchCatalogSnapshot
  checkpoint: { id: string; status: 'undone' }
  compile: StudioCompileCompletion
  file: StudioProjectFileContent
  requestId: string
}>

/** The first message on the session event socket, and the body of `GET /api/protocol`. */
export type StudioSessionHandshake = {
  apps: readonly StudioAppVariant[]
  capabilities: {
    drafts: 'disk-synced-parsable'
    language: readonly string[]
    sourceActions: {
      canonicalEnvelope: true
      checkpoints: true
      proposals: true
      undo: true
      version: typeof studioSourceActionVersion
    }
    matrix: {
      concurrentCells: true
      scheme: 'reactive-browser-fixed-light-native'
      version: 2
    }
    sketches: {
      catalogVersion: typeof studioSketchCatalogFormatVersion
      freeGeometry: true
    }
  }
  channel: typeof studioProtocolChannel
  compile: StudioCompileSnapshot
  endpoints: readonly StudioRoute[]
  entryPath: string
  files: readonly StudioProjectFile[]
  identity: StudioProjectIdentity
  previewManifest?: StudioPreviewManifestV2
  sketchCatalog: StudioSketchCatalogSnapshot
  protocolVersion: typeof studioProtocolVersion
  type: 'handshake'
}

/** Events one project session publishes; the server relays each to that session's event sockets. */
export type StudioSessionEvent =
  | {
    channel: typeof studioProtocolChannel
    protocolVersion: typeof studioProtocolVersion
    state: StudioCompileSnapshot
    type: 'compile-state'
  }
  | {
    channel: typeof studioProtocolChannel
    file: StudioProjectFile
    protocolVersion: typeof studioProtocolVersion
    type: 'file-changed'
  }
  | {
    channel: typeof studioProtocolChannel
    files: readonly StudioProjectFile[]
    protocolVersion: typeof studioProtocolVersion
    type: 'files-changed'
  }
  | {
    acknowledgements: StudioWatchResult['acknowledgements']
    channel: typeof studioProtocolChannel
    protocolVersion: typeof studioProtocolVersion
    type: 'studio-writes-acknowledged'
  }
  | {
    channel: typeof studioProtocolChannel
    manifest: StudioPreviewManifestV2
    protocolVersion: typeof studioProtocolVersion
    type: 'preview-manifest-changed'
  }
  | {
    channel: typeof studioProtocolChannel
    checkpoint: Pick<StudioCheckpointSummary, 'id' | 'status'>
    protocolVersion: typeof studioProtocolVersion
    type: 'checkpoint-changed'
  }
  | {
    catalog: StudioSketchCatalogSnapshot
    channel: typeof studioProtocolChannel
    protocolVersion: typeof studioProtocolVersion
    type: 'sketch-catalog-changed'
  }
  /**
   * One cell was reconfigured — new arguments, environment, state layers, or a replayed capture.
   * Reconfiguring invalidates every live instance of that cell, so a canvas rendering it holds an
   * instance the session will refuse from that moment on. The browser learns this by driving the
   * reconfigure itself; anything else rendering the same cell has to be told.
   */
  | {
    cellId: string
    channel: typeof studioProtocolChannel
    protocolVersion: typeof studioProtocolVersion
    type: 'cell-reconfigured'
  }

/** The server-side datasource's query families went stale; Tao panels mirroring them refetch. */
export type StudioDataInvalidatedEvent = StudioServerInvalidation & { type: 'data-invalidated' }

/** Everything the session event socket sends after its handshake. */
export type StudioSessionSocketEvent = StudioDataInvalidatedEvent | StudioDeviceStateEvent | StudioSessionEvent

// ---- Preview protocol

export type StudioJsonObject = { readonly [key: string]: StudioJsonValue }

export type StudioJsonValue =
  | boolean
  | null
  | number
  | readonly StudioJsonValue[]
  | string
  | StudioJsonObject

/** StudioProjectIdentity keeps one server/session scoped to a specific Tao app in a project. */
export type StudioProjectIdentity = {
  appName: string
  project: string
}

/** StudioSourceIdentity identifies the exact source text a preview or source action observed. */
export type StudioSourceIdentity = {
  path: string
  sourceVersion: string
}

/** StudioSourceOccurrenceIdentity is the compiler-owned semantic precondition for one source occurrence. */
type StudioSourceOccurrenceIdentity = {
  nodeKind: string
  renderOwner?: string
}

/** StudioPreviewIdentity distinguishes a replaced/reloaded preview from the prior iframe instance. */
export type StudioPreviewIdentity = StudioProjectIdentity & {
  cellId?: string
  cellRevision?: number
  compileRevision?: number
  manifestRevision?: string
  previewInstanceId: string
}

/** StudioPreviewSourceIdentity correlates a rendered node with the exact preview and source text that produced it. */
export type StudioPreviewSourceIdentity = StudioPreviewIdentity & StudioSourceIdentity & {
  occurrence?: StudioSourceOccurrenceIdentity
}

/** StudioSourceActionIdentity adds action-only scenario identity without making source ranges durable IDs. */
export type StudioSourceActionIdentity = StudioPreviewSourceIdentity & {
  scenarioId?: string
}

export type StudioSourceRange = {
  end: number
  start: number
}

/**
 * StudioCanonicalSourceAction is deliberately extensible while source-action kinds are re-landed.
 * Every action is JSON data with a discriminating kind; no executable or hidden visual state crosses the bus.
 */
export type StudioCanonicalSourceAction = StudioJsonObject & {
  kind: string
}

/** StudioSourceActionCheckpoint groups one direct-manipulation gesture into one undoable source operation. */
export type StudioSourceActionCheckpoint = {
  id: string
  phase: 'begin' | 'commit' | 'single' | 'update'
}

/** StudioSourceActionEnvelope is the one canonical, versioned request shape for semantic visual edits. */
export type StudioSourceActionEnvelope = {
  action: StudioCanonicalSourceAction
  channel: typeof studioProtocolChannel
  checkpoint: StudioSourceActionCheckpoint
  identity: StudioSourceActionIdentity
  protocolVersion: typeof studioProtocolVersion
  requestId: string
  sourceActionVersion: typeof studioSourceActionVersion
  type: 'source-action'
}

/** StudioSourceActionUndoEnvelope restores the source snapshot captured at a committed checkpoint. */
export type StudioSourceActionUndoEnvelope = {
  channel: typeof studioProtocolChannel
  checkpointId: string
  identity: StudioSourceActionIdentity
  protocolVersion: typeof studioProtocolVersion
  requestId: string
  sourceActionVersion: typeof studioSourceActionVersion
  type: 'source-action-undo'
}

export type StudioPreviewAppliedMessage = {
  appliedRevision: number
  channel: typeof studioProtocolChannel
  compileRevision: number
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  type: 'preview-applied'
}

/** Parent-to-preview publication of the runtime state paired with one compiled generated module revision. */
export type StudioPreviewRuntimeUpdateMessage<Runtime = StudioJsonObject> = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  runtime: Runtime
  type: 'preview-runtime-update'
}

export type StudioPreviewSourceMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewSourceIdentity
  protocolVersion: typeof studioProtocolVersion
  range: StudioSourceRange
  type: 'preview-hover-source' | 'preview-select-source'
}

export type StudioHighlightSourceMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewSourceIdentity
  protocolVersion: typeof studioProtocolVersion
  range?: StudioSourceRange
  type: 'highlight-source'
}

export type StudioFixtureValue =
  | boolean
  | number
  | string
  | Readonly<{ kind: 'now' }>
  | Readonly<{ handle: string; kind: 'fixture-reference' }>

export type StudioFixturePlan = Readonly<{
  accounts: readonly Readonly<{ fields: Readonly<Record<string, StudioFixtureValue>>; name: string }>[]
  creates: readonly Readonly<{
    entity: string
    fields: Readonly<Record<string, StudioFixtureValue>>
    name: string
  }>[]
}>

type StudioPreviewFixtureCapturedMessage = {
  channel: typeof studioProtocolChannel
  fixture: StudioFixturePlan
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  requestId: string
  type: 'preview-fixture-captured'
}

type StudioPreviewFixtureCaptureFailedMessage = {
  channel: typeof studioProtocolChannel
  error: string
  errorName: StudioRuntimeCaptureErrorName
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  requestId: string
  type: 'preview-fixture-capture-failed'
}

/** StudioRuntimeCaptureArtifact mirrors the runtime-owned, JSON-only capture transport. */
export type StudioRuntimeCaptureDomain = Readonly<{
  domain: string
  value: StudioJsonValue
  version: number
}>

export type StudioRuntimeFailureFrame = Readonly<{
  arguments?: StudioJsonValue
  boundary: 'app' | 'item' | 'screen'
  componentStack?: string
  declaration?: string
  source?: Readonly<{ end: number; path: string; start: number }>
}>

export type StudioRuntimeFailure = Readonly<{
  boundaryId: string
  error: Readonly<{ message: string; name: string; stack?: string }>
  frame: StudioRuntimeFailureFrame
  retryEligible: boolean
  stopper: boolean
  timestamp: number
}>

export type StudioRuntimeCaptureArtifact = Readonly<{
  capturedAt: number
  domains: readonly StudioRuntimeCaptureDomain[]
  failure?: StudioRuntimeFailure
  version: 1
}>

export type StudioPreviewRuntimeFailureMessage = {
  capture: StudioRuntimeCaptureArtifact
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  type: 'preview-runtime-failure'
}

type StudioPreviewRuntimeCapturedMessage = {
  capture: StudioRuntimeCaptureArtifact
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  requestId: string
  type: 'preview-runtime-captured'
}

type StudioRuntimeCaptureErrorName =
  | 'HostEnvironmentError'
  | 'UnexpectedBehaviorError'
  | 'UserInputError'

type StudioPreviewRuntimeCaptureFailedMessage = {
  channel: typeof studioProtocolChannel
  error: string
  errorName: StudioRuntimeCaptureErrorName
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  requestId: string
  type: 'preview-runtime-capture-failed'
}

type StudioPreviewLogMessage = {
  arguments: readonly StudioJsonValue[]
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  level: 'debug' | 'error' | 'info' | 'log' | 'warn'
  protocolVersion: typeof studioProtocolVersion
  timestamp: number
  type: 'preview-console'
}

/** StudioDebugCommandMessage drives the preview's debugger: breakpoints, continue, and stepping. */
type StudioDebugStep = {
  action: string
  declaration?: string
  path: string
  statement?: string
}

export type StudioDebugCommandMessage = {
  actions?: readonly string[]
  channel: typeof studioProtocolChannel
  command: 'break' | 'configure' | 'continue' | 'step-over' | 'step-into' | 'step-out'
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  steps?: readonly StudioDebugStep[]
  type: 'debug-command'
}

/** StudioPreviewDebugMessage carries one debugger event: a journal entry, a pause, or a resume. */
type StudioPreviewDebugMessage = {
  channel: typeof studioProtocolChannel
  event: StudioJsonValue
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  type: 'preview-debug'
}

type StudioPreviewSchemeMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  scheme: Readonly<{
    capability: 'fixed-light-native' | typeof reactiveBrowserSchemeCapability
    requested: 'dark' | 'light' | 'system'
    resolved: 'dark' | 'light'
    source: 'native-fixed' | 'preference' | 'scenario' | 'system'
  }>
  type: 'preview-scheme-changed'
}

export type StudioPreviewLayoutMeasurement = {
  elementName: string
  rect: Readonly<{ height: number; width: number; x: number; y: number }>
  renderId: string
  studioRectId?: string
}

export type StudioPreviewLayoutMeasurementsMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  measurements: readonly StudioPreviewLayoutMeasurement[]
  protocolVersion: typeof studioProtocolVersion
  type: 'preview-layout-measurements'
}

/** Wheel gestures inside a cross-origin preview iframe are forwarded to the surrounding Design canvas. */
export type StudioPreviewCanvasGestureMessage = {
  channel: typeof studioProtocolChannel
  clientX: number
  clientY: number
  deltaX: number
  deltaY: number
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  type: 'preview-canvas-gesture'
  zoom: boolean
}

/** Parent-owned mode state tells a preview synchronously whether its wheel gestures belong to Canvas. */
type StudioCanvasGestureOwnershipMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  owned: boolean
  protocolVersion: typeof studioProtocolVersion
  type: 'set-canvas-gestures'
}

type StudioRecordedJourneySelector = 'label' | 'placeholder' | 'tag' | 'text'

export type StudioRecordedJourneyStep =
  | Readonly<{
    kind: 'press' | 'submit'
    selector: StudioRecordedJourneySelector
    target: string
  }>
  | Readonly<{
    kind: 'enter'
    redacted: boolean
    selector: StudioRecordedJourneySelector
    target: string
    value: string
  }>
  | Readonly<{
    action: 'enter' | 'press' | 'submit'
    kind: 'unresolved'
    reason: 'No unique Tao tag, accessibility label, placeholder, or visible text identifies this target.'
  }>

/** Exact-cell command for starting or stopping a browser-local semantic journey recording. */
export type StudioJourneyRecordingControlMessage = {
  active: boolean
  captureSensitiveText?: boolean
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  recordingId: string
  type: 'set-journey-recording'
}

export type StudioPreviewJourneyStepRecordedMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  recordingId: string
  sequence: number
  step: StudioRecordedJourneyStep
  type: 'preview-journey-step-recorded'
}

export type StudioPreviewJourneyRecordingStateMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  recordingId: string
  sequence: number
  status: 'invalidated' | 'recording' | 'stopped'
  type: 'preview-journey-recording-state'
}

/** Runtime-owned completion signals keep visual review from capturing before a journey settles. */
type StudioPreviewJourneyReplaySettledMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  type: 'preview-journey-replay-settled'
}

type StudioPreviewJourneyReplayFailedMessage = {
  channel: typeof studioProtocolChannel
  error: string
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  type: 'preview-journey-replay-failed'
}

export type StudioWindowMessage =
  | StudioHighlightSourceMessage
  | StudioCanvasGestureOwnershipMessage
  | StudioJourneyRecordingControlMessage
  | StudioPreviewAppliedMessage
  | StudioPreviewFixtureCapturedMessage
  | StudioPreviewFixtureCaptureFailedMessage
  | StudioPreviewLogMessage
  | StudioPreviewDebugMessage
  | StudioPreviewCanvasGestureMessage
  | StudioDebugCommandMessage
  | StudioPreviewLayoutMeasurementsMessage
  | StudioPreviewJourneyRecordingStateMessage
  | StudioPreviewJourneyReplayFailedMessage
  | StudioPreviewJourneyReplaySettledMessage
  | StudioPreviewJourneyStepRecordedMessage
  | StudioPreviewRuntimeCapturedMessage
  | StudioPreviewRuntimeCaptureFailedMessage
  | StudioPreviewRuntimeFailureMessage
  | StudioPreviewSchemeMessage
  | StudioPreviewSourceMessage
  | StudioSourceActionEnvelope
  | StudioSourceActionUndoEnvelope

export type StudioMessageEvent = {
  data: unknown
  origin: string
  source?: unknown
}

export type StudioMessageExpectation = StudioProjectIdentity & {
  origin: string
  previewInstanceId?: string
  source: unknown
}

/** StudioProtocol owns v1 DTO validation at every untrusted transport boundary. */
export const StudioProtocol = {
  messageOrigin,
  parseCanonicalSourceAction,
  parseMessage: parseMessageData,
  parseRuntimeCapture,
  parseSourceActionEnvelope,
  parseSourceActionIdentity,
  parseSourceActionUndoEnvelope,
  parseWindowMessage,
} as const

/** messageOrigin returns the exact target/check origin to use with window.postMessage. */
function messageOrigin(url: string): string | undefined {
  try {
    const origin = new URL(url).origin
    return origin === 'null' ? undefined : origin
  } catch {
    return undefined
  }
}

/**
 * parseWindowMessage validates the browser-provided origin, optional WindowProxy identity, protocol identity,
 * and the complete message payload. Callers must not inspect event.data before this boundary.
 */
function parseWindowMessage(
  event: StudioMessageEvent,
  expected: StudioMessageExpectation,
): StudioWindowMessage | undefined {
  if (event.origin !== expected.origin || event.source !== expected.source) {
    return undefined
  }
  const message = parseMessageData(event.data)
  if (message === undefined || !matchesProject(message.identity, expected)) {
    return undefined
  }
  if (
    expected.previewInstanceId !== undefined
    && message.identity.previewInstanceId !== expected.previewInstanceId
  ) {
    return undefined
  }
  return message
}

function parseMessageData(value: unknown): StudioWindowMessage | undefined {
  if (
    !isObject(value)
    || value['channel'] !== studioProtocolChannel
    || value['protocolVersion'] !== studioProtocolVersion
  ) {
    return undefined
  }
  if (value['type'] === 'preview-applied') {
    return parsePreviewApplied(value)
  }
  if (value['type'] === 'preview-hover-source' || value['type'] === 'preview-select-source') {
    return parsePreviewSource(value)
  }
  if (value['type'] === 'highlight-source') {
    return parseHighlightSource(value)
  }
  if (value['type'] === 'preview-fixture-captured') {
    return parsePreviewFixtureCaptured(value)
  }
  if (value['type'] === 'preview-fixture-capture-failed') {
    return parsePreviewFixtureCaptureFailed(value)
  }
  if (value['type'] === 'preview-runtime-failure') {
    return parsePreviewRuntimeFailure(value)
  }
  if (value['type'] === 'preview-runtime-captured') {
    return parsePreviewRuntimeCaptured(value)
  }
  if (value['type'] === 'preview-runtime-capture-failed') {
    return parsePreviewRuntimeCaptureFailed(value)
  }
  if (value['type'] === 'preview-console') {
    return parsePreviewLog(value)
  }
  if (value['type'] === 'preview-debug') {
    return parsePreviewDebug(value)
  }
  if (value['type'] === 'debug-command') {
    return parseDebugCommand(value)
  }
  if (value['type'] === 'preview-scheme-changed') {
    return parsePreviewScheme(value)
  }
  if (value['type'] === 'preview-layout-measurements') {
    return parsePreviewLayoutMeasurements(value)
  }
  if (value['type'] === 'preview-canvas-gesture') {
    return parsePreviewCanvasGesture(value)
  }
  if (value['type'] === 'set-canvas-gestures') {
    return parseCanvasGestureOwnership(value)
  }
  if (value['type'] === 'set-journey-recording') {
    return parseJourneyRecordingControl(value)
  }
  if (value['type'] === 'preview-journey-step-recorded') {
    return parsePreviewJourneyStepRecorded(value)
  }
  if (value['type'] === 'preview-journey-recording-state') {
    return parsePreviewJourneyRecordingState(value)
  }
  if (value['type'] === 'preview-journey-replay-settled') {
    return parsePreviewJourneyReplaySettled(value)
  }
  if (value['type'] === 'preview-journey-replay-failed') {
    return parsePreviewJourneyReplayFailed(value)
  }
  if (value['type'] === 'source-action') {
    return parseSourceActionEnvelope(value)
  }
  if (value['type'] === 'source-action-undo') {
    return parseSourceActionUndoEnvelope(value)
  }
  return undefined
}

function parseJourneyRecordingControl(value: StudioJsonObject): StudioJourneyRecordingControlMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  if (
    identity === undefined
    || identity.cellId === undefined
    || typeof value['active'] !== 'boolean'
    || !boundedText(value['recordingId'], 256)
    || (value['captureSensitiveText'] !== undefined && typeof value['captureSensitiveText'] !== 'boolean')
  ) {
    return undefined
  }
  return {
    active: value['active'],
    ...(value['captureSensitiveText'] === undefined
      ? {}
      : { captureSensitiveText: value['captureSensitiveText'] as boolean }),
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    recordingId: value['recordingId'],
    type: 'set-journey-recording',
  }
}

function parsePreviewJourneyStepRecorded(
  value: StudioJsonObject,
): StudioPreviewJourneyStepRecordedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const sequence = nonNegativeInteger(value['sequence'])
  const step = parseRecordedJourneyStep(value['step'])
  if (
    identity === undefined || identity.cellId === undefined || sequence === undefined || sequence === 0
    || step === undefined
    || !boundedText(value['recordingId'], 256)
  ) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    recordingId: value['recordingId'],
    sequence,
    step,
    type: 'preview-journey-step-recorded',
  }
}

function parsePreviewJourneyRecordingState(
  value: StudioJsonObject,
): StudioPreviewJourneyRecordingStateMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const sequence = nonNegativeInteger(value['sequence'])
  const status = value['status']
  if (
    identity === undefined
    || identity.cellId === undefined
    || sequence === undefined
    || !boundedText(value['recordingId'], 256)
    || (status !== 'invalidated' && status !== 'recording' && status !== 'stopped')
  ) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    recordingId: value['recordingId'],
    sequence,
    status,
    type: 'preview-journey-recording-state',
  }
}

function parsePreviewJourneyReplaySettled(
  value: StudioJsonObject,
): StudioPreviewJourneyReplaySettledMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  return identity?.cellId === undefined
    ? undefined
    : {
      channel: studioProtocolChannel,
      identity,
      protocolVersion: studioProtocolVersion,
      type: 'preview-journey-replay-settled',
    }
}

function parsePreviewJourneyReplayFailed(
  value: StudioJsonObject,
): StudioPreviewJourneyReplayFailedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  return identity?.cellId === undefined || !boundedText(value['error'], 4_096)
    ? undefined
    : {
      channel: studioProtocolChannel,
      error: value['error'],
      identity,
      protocolVersion: studioProtocolVersion,
      type: 'preview-journey-replay-failed',
    }
}

function parseRecordedJourneyStep(value: unknown): StudioRecordedJourneyStep | undefined {
  if (!isObject(value)) {
    return undefined
  }
  if (value['kind'] === 'unresolved') {
    const action = value['action']
    const reason = value['reason']
    return (action === 'enter' || action === 'press' || action === 'submit')
        && reason === 'No unique Tao tag, accessibility label, placeholder, or visible text identifies this target.'
        && Object.keys(value).length === 3
      ? { action, kind: 'unresolved', reason }
      : undefined
  }
  if (!boundedText(value['target'], 1_024)) {
    return undefined
  }
  const selector = value['selector']
  if (selector !== 'label' && selector !== 'placeholder' && selector !== 'tag' && selector !== 'text') {
    return undefined
  }
  if (value['kind'] === 'press' || value['kind'] === 'submit') {
    return Object.keys(value).length === 3
      ? { kind: value['kind'], selector, target: value['target'] }
      : undefined
  }
  return value['kind'] === 'enter'
      && typeof value['value'] === 'string'
      && value['value'].length <= 16_384
      && typeof value['redacted'] === 'boolean'
      && Object.keys(value).length === 5
    ? { kind: 'enter', redacted: value['redacted'], selector, target: value['target'], value: value['value'] }
    : undefined
}

function parsePreviewLayoutMeasurements(
  value: StudioJsonObject,
): StudioPreviewLayoutMeasurementsMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const rawMeasurements = value['measurements']
  if (identity === undefined || !Array.isArray(rawMeasurements)) {
    return undefined
  }
  const measurements: StudioPreviewLayoutMeasurement[] = []
  const renderIds = new Set<string>()
  for (const raw of rawMeasurements) {
    if (!isObject(raw) || !nonEmptyString(raw['renderId']) || !nonEmptyString(raw['elementName'])) {
      return undefined
    }
    if (raw['studioRectId'] !== undefined && !nonEmptyString(raw['studioRectId'])) {
      return undefined
    }
    const rect = raw['rect']
    if (!isObject(rect)) {
      return undefined
    }
    const coordinates = ['height', 'width', 'x', 'y'] as const
    if (
      coordinates.some(coordinate =>
        typeof rect[coordinate] !== 'number' || !Number.isFinite(rect[coordinate]) || rect[coordinate] < 0
      ) || renderIds.has(raw['renderId'])
    ) {
      return undefined
    }
    renderIds.add(raw['renderId'])
    const height = rect['height'] as number
    const width = rect['width'] as number
    const x = rect['x'] as number
    const y = rect['y'] as number
    measurements.push({
      elementName: raw['elementName'],
      rect: { height, width, x, y },
      renderId: raw['renderId'],
      ...(raw['studioRectId'] === undefined ? {} : { studioRectId: raw['studioRectId'] }),
    })
  }
  return {
    channel: studioProtocolChannel,
    identity,
    measurements,
    protocolVersion: studioProtocolVersion,
    type: 'preview-layout-measurements',
  }
}

function parsePreviewCanvasGesture(value: StudioJsonObject): StudioPreviewCanvasGestureMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const numbers = ['clientX', 'clientY', 'deltaX', 'deltaY'] as const
  if (
    identity === undefined
    || numbers.some(name => typeof value[name] !== 'number' || !Number.isFinite(value[name]))
    || typeof value['zoom'] !== 'boolean'
  ) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    clientX: value['clientX'] as number,
    clientY: value['clientY'] as number,
    deltaX: value['deltaX'] as number,
    deltaY: value['deltaY'] as number,
    identity,
    protocolVersion: studioProtocolVersion,
    type: 'preview-canvas-gesture',
    zoom: value['zoom'],
  }
}

function parseCanvasGestureOwnership(value: StudioJsonObject): StudioCanvasGestureOwnershipMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  return identity === undefined || typeof value['owned'] !== 'boolean'
    ? undefined
    : {
      channel: studioProtocolChannel,
      identity,
      owned: value['owned'],
      protocolVersion: studioProtocolVersion,
      type: 'set-canvas-gestures',
    }
}

function parsePreviewScheme(value: StudioJsonObject): StudioPreviewSchemeMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const scheme = value['scheme']
  if (
    identity === undefined
    || !isObject(scheme)
    || !['fixed-light-native', reactiveBrowserSchemeCapability].includes(String(scheme['capability']))
    || !['dark', 'light', 'system'].includes(String(scheme['requested']))
    || !['dark', 'light'].includes(String(scheme['resolved']))
    || !['native-fixed', 'preference', 'scenario', 'system'].includes(String(scheme['source']))
    || (scheme['source'] === 'system' && scheme['requested'] !== 'system')
    || (scheme['source'] === 'preference' && scheme['requested'] === 'system')
    || (scheme['source'] === 'scenario' && scheme['requested'] === 'system')
    || (scheme['source'] === 'native-fixed' && scheme['capability'] !== 'fixed-light-native')
    || (scheme['capability'] === 'fixed-light-native'
      && (scheme['resolved'] !== 'light' || scheme['source'] !== 'native-fixed'))
  ) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    scheme: {
      capability: scheme['capability'] as StudioPreviewSchemeMessage['scheme']['capability'],
      requested: scheme['requested'] as StudioPreviewSchemeMessage['scheme']['requested'],
      resolved: scheme['resolved'] as StudioPreviewSchemeMessage['scheme']['resolved'],
      source: scheme['source'] as StudioPreviewSchemeMessage['scheme']['source'],
    },
    type: 'preview-scheme-changed',
  }
}

function parsePreviewRuntimeCaptured(value: StudioJsonObject): StudioPreviewRuntimeCapturedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const capture = parseRuntimeCapture(value['capture'])
  if (identity === undefined || capture === undefined || !nonEmptyString(value['requestId'])) {
    return undefined
  }
  return {
    capture,
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    requestId: value['requestId'],
    type: 'preview-runtime-captured',
  }
}

function parsePreviewRuntimeCaptureFailed(
  value: StudioJsonObject,
): StudioPreviewRuntimeCaptureFailedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  if (
    identity === undefined
    || !nonEmptyString(value['requestId'])
    || !nonEmptyString(value['error'])
    || !runtimeCaptureErrorName(value['errorName'])
  ) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    error: value['error'],
    errorName: value['errorName'],
    identity,
    protocolVersion: studioProtocolVersion,
    requestId: value['requestId'],
    type: 'preview-runtime-capture-failed',
  }
}

function runtimeCaptureErrorName(value: unknown): value is StudioRuntimeCaptureErrorName {
  return value === 'HostEnvironmentError' || value === 'UnexpectedBehaviorError' || value === 'UserInputError'
}

const debugCommands = ['break', 'configure', 'continue', 'step-over', 'step-into', 'step-out'] as const

function parseDebugCommand(value: StudioJsonObject): StudioDebugCommandMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const command = debugCommands.find(candidate => candidate === value['command'])
  if (identity === undefined || command === undefined) {
    return undefined
  }
  const steps = value['steps']
  const actions = value['actions']
  if (
    (steps !== undefined && (!Array.isArray(steps) || !steps.every(isDebugStep)))
    || (actions !== undefined && (!Array.isArray(actions) || !actions.every(entry => typeof entry === 'string')))
  ) {
    return undefined
  }
  return {
    ...(actions === undefined ? {} : { actions: actions as readonly string[] }),
    channel: studioProtocolChannel,
    command,
    identity,
    protocolVersion: studioProtocolVersion,
    ...(steps === undefined ? {} : { steps: steps as readonly StudioDebugStep[] }),
    type: 'debug-command',
  }
}

function isDebugStep(value: unknown): value is StudioDebugStep {
  if (!isObject(value) || typeof value['action'] !== 'string' || typeof value['path'] !== 'string') {
    return false
  }
  const declaration = value['declaration']
  const statement = value['statement']
  return (declaration === undefined && statement === undefined)
    || (typeof declaration === 'string' && typeof statement === 'string')
}

function parsePreviewDebug(value: StudioJsonObject): StudioPreviewDebugMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const event = value['event']
  if (identity === undefined || !isJsonValue(event)) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    event,
    identity,
    protocolVersion: studioProtocolVersion,
    type: 'preview-debug',
  }
}

function parsePreviewLog(value: StudioJsonObject): StudioPreviewLogMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const timestamp = nonNegativeInteger(value['timestamp'])
  const arguments_ = value['arguments']
  if (
    identity === undefined
    || timestamp === undefined
    || !['debug', 'error', 'info', 'log', 'warn'].includes(String(value['level']))
    || !Array.isArray(arguments_)
    || !arguments_.every(isJsonValue)
  ) {
    return undefined
  }
  return {
    arguments: arguments_,
    channel: studioProtocolChannel,
    identity,
    level: value['level'] as StudioPreviewLogMessage['level'],
    protocolVersion: studioProtocolVersion,
    timestamp,
    type: 'preview-console',
  }
}

function parsePreviewRuntimeFailure(value: StudioJsonObject): StudioPreviewRuntimeFailureMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const capture = parseRuntimeCapture(value['capture'])
  if (identity === undefined || capture === undefined || capture.failure === undefined) {
    return undefined
  }
  return {
    capture,
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    type: 'preview-runtime-failure',
  }
}

function parseRuntimeCapture(value: unknown): StudioRuntimeCaptureArtifact | undefined {
  const capturedAt = isObject(value) ? nonNegativeInteger(value['capturedAt']) : undefined
  if (
    !isObject(value)
    || value['version'] !== 1
    || capturedAt === undefined
    || !Array.isArray(value['domains'])
  ) {
    return undefined
  }
  const domains = value['domains'].map(parseRuntimeCaptureDomain)
  if (!domains.every(isDefined)) {
    return undefined
  }
  const domainNames = domains.map(domain => domain.domain)
  if (new Set(domainNames).size !== domainNames.length) {
    return undefined
  }
  const rawFailure = value['failure']
  const failure = rawFailure === undefined ? undefined : parseRuntimeFailure(rawFailure)
  if (rawFailure !== undefined && failure === undefined) {
    return undefined
  }
  return {
    capturedAt,
    domains,
    ...(failure === undefined ? {} : { failure }),
    version: 1,
  }
}

function parseRuntimeCaptureDomain(value: unknown): StudioRuntimeCaptureDomain | undefined {
  if (!isObject(value) || !nonEmptyString(value['domain']) || !positiveInteger(value['version'])) {
    return undefined
  }
  const domainValue = value['value']
  return isJsonValue(domainValue)
    ? { domain: value['domain'], value: domainValue, version: value['version'] }
    : undefined
}

function parseRuntimeFailure(value: unknown): StudioRuntimeFailure | undefined {
  const timestamp = isObject(value) ? nonNegativeInteger(value['timestamp']) : undefined
  if (
    !isObject(value)
    || !nonEmptyString(value['boundaryId'])
    || typeof value['retryEligible'] !== 'boolean'
    || typeof value['stopper'] !== 'boolean'
    || timestamp === undefined
    || !isObject(value['error'])
    || !nonEmptyString(value['error']['name'])
    || !nonEmptyString(value['error']['message'])
    || !optionalString(value['error']['stack'])
  ) {
    return undefined
  }
  const frame = parseRuntimeFailureFrame(value['frame'])
  if (frame === undefined) {
    return undefined
  }
  return {
    boundaryId: value['boundaryId'],
    error: {
      message: value['error']['message'],
      name: value['error']['name'],
      ...(value['error']['stack'] === undefined ? {} : { stack: value['error']['stack'] }),
    },
    frame,
    retryEligible: value['retryEligible'],
    stopper: value['stopper'],
    timestamp,
  }
}

function parseRuntimeFailureFrame(value: unknown): StudioRuntimeFailureFrame | undefined {
  if (!isObject(value) || !['app', 'item', 'screen'].includes(String(value['boundary']))) {
    return undefined
  }
  if (!optionalString(value['componentStack']) || !optionalString(value['declaration'])) {
    return undefined
  }
  const arguments_ = value['arguments']
  if (arguments_ !== undefined && !isJsonValue(arguments_)) {
    return undefined
  }
  const rawSource = value['source']
  const source = rawSource === undefined ? undefined : parseRuntimeFailureSource(rawSource)
  if (rawSource !== undefined && source === undefined) {
    return undefined
  }
  return {
    ...(arguments_ === undefined ? {} : { arguments: arguments_ }),
    boundary: value['boundary'] as StudioRuntimeFailureFrame['boundary'],
    ...(value['componentStack'] === undefined ? {} : { componentStack: value['componentStack'] }),
    ...(value['declaration'] === undefined ? {} : { declaration: value['declaration'] }),
    ...(source === undefined ? {} : { source }),
  }
}

function parseRuntimeFailureSource(value: unknown): { end: number; path: string; start: number } | undefined {
  if (!isObject(value) || !nonEmptyString(value['path'])) {
    return undefined
  }
  const range = parseSourceRange(value)
  return range === undefined ? undefined : { ...range, path: value['path'] }
}

function parsePreviewFixtureCaptured(value: StudioJsonObject): StudioPreviewFixtureCapturedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const fixture = parseFixturePlan(value['fixture'])
  if (identity === undefined || fixture === undefined || !nonEmptyString(value['requestId'])) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    fixture,
    identity,
    protocolVersion: studioProtocolVersion,
    requestId: value['requestId'],
    type: 'preview-fixture-captured',
  }
}

function parsePreviewFixtureCaptureFailed(
  value: StudioJsonObject,
): StudioPreviewFixtureCaptureFailedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  if (identity === undefined || !nonEmptyString(value['requestId']) || !nonEmptyString(value['error'])) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    error: value['error'],
    // A preview running older code sends no category. Defaulting keeps its failure readable instead
    // of rejecting the whole message, and matches how such a failure was reported before.
    errorName: runtimeCaptureErrorName(value['errorName']) ? value['errorName'] : 'HostEnvironmentError',
    identity,
    protocolVersion: studioProtocolVersion,
    requestId: value['requestId'],
    type: 'preview-fixture-capture-failed',
  }
}

function parseFixturePlan(value: unknown): StudioFixturePlan | undefined {
  if (!isObject(value) || !Array.isArray(value['accounts']) || !Array.isArray(value['creates'])) {
    return undefined
  }
  const accounts = value['accounts'].map(parseFixtureAccount)
  const creates = value['creates'].map(parseFixtureCreate)
  return accounts.every(isDefined) && creates.every(isDefined)
    ? { accounts, creates }
    : undefined
}

function parseFixtureAccount(value: unknown): StudioFixturePlan['accounts'][number] | undefined {
  if (!isObject(value) || !nonEmptyString(value['name'])) {
    return undefined
  }
  const fields = parseFixtureFields(value['fields'])
  return fields === undefined ? undefined : { fields, name: value['name'] }
}

function parseFixtureCreate(value: unknown): StudioFixturePlan['creates'][number] | undefined {
  if (!isObject(value) || !nonEmptyString(value['entity']) || !nonEmptyString(value['name'])) {
    return undefined
  }
  const fields = parseFixtureFields(value['fields'])
  return fields === undefined ? undefined : { entity: value['entity'], fields, name: value['name'] }
}

function parseFixtureFields(value: unknown): Readonly<Record<string, StudioFixtureValue>> | undefined {
  if (!isObject(value) || !Object.values(value).every(isFixtureValue)) {
    return undefined
  }
  return value as Readonly<Record<string, StudioFixtureValue>>
}

function isFixtureValue(value: unknown): value is StudioFixtureValue {
  return typeof value === 'boolean'
    || typeof value === 'string'
    || typeof value === 'number' && Number.isFinite(value)
    || isObject(value) && value['kind'] === 'now' && Object.keys(value).length === 1
    || isObject(value)
      && value['kind'] === 'fixture-reference'
      && nonEmptyString(value['handle'])
      && Object.keys(value).length === 2
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

function parsePreviewApplied(value: StudioJsonObject): StudioPreviewAppliedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const compileRevision = nonNegativeInteger(value['compileRevision'])
  const appliedRevision = nonNegativeInteger(value['appliedRevision'])
  if (identity === undefined || compileRevision === undefined || appliedRevision === undefined) {
    return undefined
  }
  if (appliedRevision !== compileRevision) {
    return undefined
  }
  return {
    appliedRevision,
    channel: studioProtocolChannel,
    compileRevision,
    identity,
    protocolVersion: studioProtocolVersion,
    type: 'preview-applied',
  }
}

function parsePreviewSource(value: StudioJsonObject): StudioPreviewSourceMessage | undefined {
  const identity = parsePreviewSourceIdentity(value['identity'])
  const range = parseSourceRange(value['range'])
  const type = value['type']
  if (
    identity === undefined
    || range === undefined
    || (type !== 'preview-hover-source' && type !== 'preview-select-source')
  ) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    range,
    type,
  }
}

function parseHighlightSource(value: StudioJsonObject): StudioHighlightSourceMessage | undefined {
  const identity = parsePreviewSourceIdentity(value['identity'])
  const rawRange = value['range']
  const range = rawRange === undefined ? undefined : parseSourceRange(rawRange)
  if (identity === undefined || (rawRange !== undefined && range === undefined)) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    range,
    type: 'highlight-source',
  }
}

function parseSourceActionEnvelope(value: unknown): StudioSourceActionEnvelope | undefined {
  if (
    !isObject(value)
    || value['channel'] !== studioProtocolChannel
    || value['protocolVersion'] !== studioProtocolVersion
    || value['sourceActionVersion'] !== studioSourceActionVersion
    || value['type'] !== 'source-action'
    || !nonEmptyString(value['requestId'])
  ) {
    return undefined
  }
  const identity = parseSourceActionIdentity(value['identity'])
  const action = parseCanonicalSourceAction(value['action'])
  const checkpoint = parseSourceActionCheckpoint(value['checkpoint'])
  if (identity === undefined || action === undefined || checkpoint === undefined) {
    return undefined
  }
  return {
    action,
    channel: studioProtocolChannel,
    checkpoint,
    identity,
    protocolVersion: studioProtocolVersion,
    requestId: value['requestId'],
    sourceActionVersion: studioSourceActionVersion,
    type: 'source-action',
  }
}

function parseSourceActionUndoEnvelope(value: unknown): StudioSourceActionUndoEnvelope | undefined {
  if (
    !isObject(value)
    || value['channel'] !== studioProtocolChannel
    || !nonEmptyString(value['checkpointId'])
    || value['protocolVersion'] !== studioProtocolVersion
    || !nonEmptyString(value['requestId'])
    || value['sourceActionVersion'] !== studioSourceActionVersion
    || value['type'] !== 'source-action-undo'
  ) {
    return undefined
  }
  const identity = parseSourceActionIdentity(value['identity'])
  if (identity === undefined) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    checkpointId: value['checkpointId'],
    identity,
    protocolVersion: studioProtocolVersion,
    requestId: value['requestId'],
    sourceActionVersion: studioSourceActionVersion,
    type: 'source-action-undo',
  }
}

function parseSourceActionCheckpoint(value: unknown): StudioSourceActionCheckpoint | undefined {
  if (!isObject(value) || !nonEmptyString(value['id'])) {
    return undefined
  }
  const phase = value['phase']
  return phase === 'begin' || phase === 'commit' || phase === 'single' || phase === 'update'
    ? { id: value['id'], phase }
    : undefined
}

function parseCanonicalSourceAction(value: unknown): StudioCanonicalSourceAction | undefined {
  return isObject(value) && nonEmptyString(value['kind']) && isJsonValue(value)
    ? value as StudioCanonicalSourceAction
    : undefined
}

function parsePreviewIdentity(value: unknown): StudioPreviewIdentity | undefined {
  if (
    !isObject(value)
    || !nonEmptyString(value['project'])
    || !nonEmptyString(value['appName'])
    || !nonEmptyString(value['previewInstanceId'])
  ) {
    return undefined
  }
  const rawCellIdentity = [
    value['cellId'],
    value['cellRevision'],
    value['compileRevision'],
    value['manifestRevision'],
  ]
  const hasCellIdentity = rawCellIdentity.some(field => field !== undefined)
  const cellRevision = nonNegativeInteger(value['cellRevision'])
  const compileRevision = nonNegativeInteger(value['compileRevision'])
  if (
    hasCellIdentity
    && (
      !nonEmptyString(value['cellId'])
      || cellRevision === undefined
      || compileRevision === undefined
      || !nonEmptyString(value['manifestRevision'])
    )
  ) {
    return undefined
  }
  return {
    appName: value['appName'],
    ...(hasCellIdentity
      ? {
        cellId: value['cellId'] as string,
        cellRevision: cellRevision!,
        compileRevision: compileRevision!,
        manifestRevision: value['manifestRevision'] as string,
      }
      : {}),
    previewInstanceId: value['previewInstanceId'],
    project: value['project'],
  }
}

function parsePreviewSourceIdentity(value: unknown): StudioPreviewSourceIdentity | undefined {
  const preview = parsePreviewIdentity(value)
  const rawOccurrence = isObject(value) ? value['occurrence'] : undefined
  const occurrence = rawOccurrence === undefined ? undefined : parseSourceOccurrenceIdentity(rawOccurrence)
  if (
    preview === undefined
    || !isObject(value)
    || !nonEmptyString(value['path'])
    || !nonEmptyString(value['sourceVersion'])
    || (rawOccurrence !== undefined && occurrence === undefined)
  ) {
    return undefined
  }
  return {
    ...preview,
    ...(occurrence === undefined ? {} : { occurrence }),
    path: value['path'],
    sourceVersion: value['sourceVersion'],
  }
}

function parseSourceActionIdentity(value: unknown): StudioSourceActionIdentity | undefined {
  const source = parsePreviewSourceIdentity(value)
  if (source === undefined || !isObject(value)) {
    return undefined
  }
  const scenarioId = value['scenarioId']
  return scenarioId === undefined
    ? source
    : nonEmptyString(scenarioId)
    ? { ...source, scenarioId }
    : undefined
}

function parseSourceOccurrenceIdentity(value: unknown): StudioSourceOccurrenceIdentity | undefined {
  if (!isObject(value) || !nonEmptyString(value['nodeKind'])) {
    return undefined
  }
  const renderOwner = value['renderOwner']
  return renderOwner === undefined
    ? { nodeKind: value['nodeKind'] }
    : nonEmptyString(renderOwner)
    ? { nodeKind: value['nodeKind'], renderOwner }
    : undefined
}

function parseSourceRange(value: unknown): StudioSourceRange | undefined {
  if (!isObject(value)) {
    return undefined
  }
  const start = nonNegativeInteger(value['start'])
  const end = nonNegativeInteger(value['end'])
  return start !== undefined && end !== undefined && start <= end ? { end, start } : undefined
}

function matchesProject(identity: StudioPreviewIdentity, expected: StudioProjectIdentity): boolean {
  return identity.project === expected.project && identity.appName === expected.appName
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function boundedText(value: unknown, maximumLength: number): value is string {
  return nonEmptyString(value) && value.length <= maximumLength
}

function isObject(value: unknown): value is StudioJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isJsonValue(value: unknown): value is StudioJsonValue {
  if (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }
  return isObject(value) && Object.values(value).every(isJsonValue)
}
