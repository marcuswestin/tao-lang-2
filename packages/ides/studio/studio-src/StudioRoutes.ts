import { Assert } from '@shared/core'

/*
 * The addressable surface of a Studio server: which window a request belongs to, which route it is,
 * and how a JSON or WebSocket call over that route is framed. `StudioProtocol` owns what travels on
 * it. Both the server dispatcher and every client read this table, so a path exists in one place.
 */

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
  canvasViewport: { method: 'POST', path: '/api/canvas/viewport' },
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
