import { type GenerationProvider, UnavailableGenerationProvider } from '@generation'
import { Assert, CLI, Errors, Json, Repo, Switch } from '@shared'
import type { AgentChatProvider } from './agent-chat/AgentChatProvider'
import { AgentChat, streamTurn } from './agent-chat/AgentChatServer'
import type { StudioDeviceGateway } from './device/StudioDeviceGateway'
import type { StudioDeviceLauncher } from './device/StudioDeviceLauncher'
import type { StudioDeviceStateEvent } from './device/StudioDeviceStatus'
import type { StudioCanvasViewportStore } from './StudioCanvasViewportStore'
import { type StudioClientAssetProvider, StudioClientAssets } from './StudioClientAssets'
import { StudioFixtureGeneration } from './StudioFixtureGeneration'
import { StudioHighlight } from './StudioHighlight'
import { StudioLsp, type StudioLspSession } from './StudioLsp'
import { StudioMatrixConflictError } from './StudioMatrixSession'
import {
  StudioProjectSession,
  StudioSourceActionConflictError,
  StudioSourceConflictError,
} from './StudioProjectSession'
import {
  type StudioCreateFileRequest,
  type StudioDeleteFileRequest,
  type StudioDraftWriteRequest,
  type StudioInspectRenderRequest,
  type StudioMoveGeneratedSourceRequest,
  StudioProtocol,
  studioProtocolChannel,
  studioProtocolVersion,
  type StudioRenameFileRequest,
  type StudioRoute,
  StudioRoutes,
  StudioSessionPath,
  type StudioSessionSocketEvent,
} from './StudioProtocol'
import { StudioServerDatasource, type StudioServerFillRequest } from './StudioServerDatasource'
import {
  type StudioCurrentSession,
  type StudioProjectOpenRequest,
  type StudioSessionManager,
  type StudioSessionResource,
} from './StudioSessionManager'
import { StudioSketchCatalogConflictError } from './StudioSketchCatalog'
import { type StudioLanguageAnalysis, StudioSyntaxLens } from './StudioSyntaxLens'
import type { StudioTestRunner } from './StudioTestRunner'
import { StudioWelcome } from './StudioWelcome'

/** The gateway surface the loopback routes and `device-state` events need; the real gateway satisfies it. */
export type StudioServerDeviceGateway = Pick<
  StudioDeviceGateway,
  | 'captureRuntime'
  | 'confirmPairing'
  | 'declinePairing'
  | 'detachSession'
  | 'highlightSource'
  | 'openPairing'
  | 'requestReconnect'
  | 'revoke'
  | 'selectCell'
  | 'status'
  | 'subscribe'
>

export type StudioServerOptions = {
  /** Injected only by deterministic hosts that must exercise the real agent HTTP and browser path without egress. */
  agentProvider?: AgentChatProvider
  /**
   * Secrets the agent chat may use, handed over as a value rather than exported into the environment. Studio
   * spawns a bundler, a preview runtime and a Swift helper, and every one of them inherits an environment.
   */
  agentSecrets?: Readonly<Record<string, string>>
  allowedOrigins?: readonly string[]
  canvasViewportStore?: StudioCanvasViewportStore
  clientAssets?: StudioClientAssetProvider
  clientReloadRevision?: () => number
  compileOnStart?: boolean
  deviceGateway?: StudioServerDeviceGateway
  deviceLauncher?: StudioDeviceLauncher
  generationProvider?: GenerationProvider
  hostname?: string
  openBrowser?: (url: string) => Promise<void>
  port?: number
  previewUrl?: string
  shipBeta?: StudioBetaShip
}

export type StudioBetaShipRequest = Readonly<{
  appName: string
  entryPath: string
  projectRoot: string
}>

export type StudioBetaShip = (request: StudioBetaShipRequest) => Promise<void>

const runningBetaShips = new Map<string, Promise<void>>()

export type StartedStudioServer = {
  hostname: string
  manager: StudioSessionManager
  port: number
  stop: () => void | Promise<void>
  url: string
}

type StudioSocketData =
  | { kind: 'events'; sessionId: string }
  | { kind: 'lsp'; session?: StudioLspSession; sessionId: string }

type StudioSocket = Bun.ServerWebSocket<StudioSocketData>

const routes = StudioRoutes.session

/** at says whether the request is exactly this route: same method, same path. */
function at(request: Request, pathname: string, route: StudioRoute): boolean {
  return StudioRoutes.matchesRequest(route, request.method, pathname)
}

/** What a route handler answers with; `renderReply` is the one place any of them becomes a `Response`. */
type StudioReply =
  | Readonly<{ html: string; kind: 'html'; status: number }>
  | Readonly<{ javascript: string; kind: 'javascript' }>
  | Readonly<{ kind: 'json'; status: number; value: unknown }>
  | Readonly<{ kind: 'stream'; stream: ReadableStream<Uint8Array> }>

function jsonReply(value: unknown, status = 200): StudioReply {
  return { kind: 'json', status, value }
}

function htmlReply(html: string, status = 200): StudioReply {
  return { html, kind: 'html', status }
}

function renderReply(request: Request, url: URL, options: StudioServerOptions, reply: StudioReply): Response {
  return Switch.on(reply, 'kind', {
    html: rendered => htmlResponse(rendered.html, rendered.status),
    javascript: rendered => javascriptResponse(rendered.javascript),
    json: rendered => response(request, url, options, rendered.value, rendered.status),
    stream: rendered => streamResponse(request, url, options, rendered.stream),
  })
}

/** One route and the handler that answers it; a dispatcher tries the entries in table order. */
type StudioRouteEntry<HandlerT> = readonly [StudioRoute, HandlerT]

/** routeEntries pairs handlers keyed by route name with the routes of that name they answer. */
function routeEntries<KeyT extends string, HandlerT>(
  table: Readonly<Record<KeyT, StudioRoute>>,
  handlers: Readonly<Record<KeyT, HandlerT>>,
): readonly StudioRouteEntry<HandlerT>[] {
  return (Object.entries(handlers) as [KeyT, HandlerT][]).map(([key, handler]) => [table[key], handler])
}

/**
 * dispatch answers the request from one table, and returns undefined when no route in it is the request,
 * so the caller can try the next table. Paths never repeat within a table, so table order does not matter.
 */
async function dispatch<ContextT>(
  entries: readonly StudioRouteEntry<StudioHandler<ContextT>>[],
  request: Request,
  url: URL,
  options: StudioServerOptions,
  pathname: string,
  context: (parameters: Readonly<Record<string, string>>) => ContextT,
): Promise<Response | undefined> {
  for (const [route, handler] of entries) {
    const parameters = route.method === request.method ? StudioRoutes.match(route, pathname) : undefined
    if (parameters !== undefined) {
      return renderReply(request, url, options, await handler(context(parameters)))
    }
  }
  return undefined
}

/** Session routes use the handler tables below, except the browser launch that reads its session resource directly. */
type StudioLaunchRouteKey = 'deviceLaunch' | 'deviceLaunchOpen'
type StudioDeviceRouteKey = Exclude<Extract<keyof typeof routes, `device${string}`>, StudioLaunchRouteKey>
type StudioTestRouteKey = Extract<keyof typeof routes, `tests${string}`>
type StudioSocketRouteKey = 'events' | 'languageLsp'
type StudioSessionRouteKey = Exclude<
  keyof typeof routes,
  StudioDeviceRouteKey | StudioLaunchRouteKey | StudioSocketRouteKey | StudioTestRouteKey | 'browserOpen'
>
type StudioManagerRouteKey = keyof typeof StudioRoutes.manager

/** A handler reads what its table's dispatcher hands it and answers with a reply to render. */
type StudioHandler<ContextT> = (context: ContextT) => StudioReply | Promise<StudioReply>

const endpointNotFound = 'Studio endpoint not found.'
const previewManifestUnavailable = 'Studio preview manifest is not available yet.'
const testRuntimeUnavailable = 'This Studio service does not include the Tao test runtime.'

/** Starts the multi-session server whose root is the Welcome surface. */
export async function startStudioSessionServer(
  manager: StudioSessionManager,
  options: StudioServerOptions = {},
): Promise<StartedStudioServer> {
  if (options.compileOnStart !== false) {
    await Promise.all(
      manager.list().current.map(async item => await manager.require(item.sessionId).session.compileInitial()),
    )
  }

  const fixtureGeneration = new StudioFixtureGeneration(
    options.generationProvider
      ?? new UnavailableGenerationProvider('Apple Foundation Models is not configured for this Studio server.'),
  )
  const clientAssets = options.clientAssets ?? StudioClientAssets

  const eventClients = new Map<string, Set<StudioSocket>>()
  const dataSources = new Map<string, StudioServerDatasource>()
  /** Everything one session subscribed to, unwound together when that session detaches or the server stops. */
  const sessionSubscriptions = new Map<string, readonly (() => void)[]>()
  const deviceGateway = options.deviceGateway
  const publish = (sessionId: string, event: StudioSessionSocketEvent): void => {
    broadcast(eventClients.get(sessionId) ?? new Set(), event)
  }
  const subscribeSession = (sessionId: string): void => {
    if (sessionSubscriptions.has(sessionId)) {
      return
    }
    const resource = manager.require(sessionId)
    if (options.canvasViewportStore !== undefined) {
      resource.session.setCanvasViewportStore(options.canvasViewportStore)
    }
    const datasource = new StudioServerDatasource(resource.session)
    dataSources.set(sessionId, datasource)
    sessionSubscriptions.set(sessionId, [
      datasource.subscribe(invalidation => publish(sessionId, { ...invalidation, type: 'data-invalidated' })),
      resource.session.subscribe(event => publish(sessionId, event)),
      ...(deviceGateway === undefined
        ? []
        : [deviceGateway.subscribe(sessionId, status => publish(sessionId, deviceStateEvent(status)))]),
    ])
  }
  for (const item of manager.list().current) {
    subscribeSession(item.sessionId)
  }
  const detachSession = (sessionId: string): void => {
    closeClients(eventClients.get(sessionId), 'Studio session closed')
    eventClients.delete(sessionId)
    for (const unsubscribe of sessionSubscriptions.get(sessionId) ?? []) {
      unsubscribe()
    }
    sessionSubscriptions.delete(sessionId)
    dataSources.get(sessionId)?.close()
    dataSources.delete(sessionId)
    deviceGateway?.detachSession(sessionId)
  }
  const unsubscribeManager = manager.subscribe(event => {
    if (event.type === 'opened') {
      subscribeSession(event.sessionId)
    } else {
      detachSession(event.sessionId)
    }
  })
  const closeSession = async (sessionId: string): Promise<boolean> => await manager.close(sessionId)
  const authorization = originAuthorization(manager, options.allowedOrigins)
  const server = Bun.serve<StudioSocketData>({
    fetch: async (request, bunServer) => {
      const url = new URL(request.url)
      const boundOrigin = serverOrigin(
        url.protocol,
        bunServer.hostname ?? options.hostname ?? '127.0.0.1',
        bunServer.port ?? options.port ?? 0,
      )
      const route = managerRequestPath(url.pathname) ? undefined : StudioSessionPath.route(url.pathname)
      const requestOptions = {
        ...options,
        allowedOrigins: route === undefined ? [] : authorization.allowedOrigins(route.sessionId, route.pathname),
      }
      if (!requestAllowed(request, url, boundOrigin, requestOptions.allowedOrigins)) {
        return forbiddenResponse('Studio host or origin is not allowed.')
      }
      if (request.method === 'OPTIONS') {
        return response(request, url, requestOptions, null, 204)
      }
      try {
        if (at(request, url.pathname, StudioRoutes.devRevision) && options.clientReloadRevision !== undefined) {
          return response(request, url, requestOptions, { revision: options.clientReloadRevision() })
        }
        const managed = await handleManagerRequest(
          manager,
          request,
          url,
          requestOptions,
          subscribeSession,
          closeSession,
        )
        if (managed !== undefined) {
          return managed
        }
        // The bundle is one asset whether the page asked for it at the root or under its own window.
        if (at(request, route?.pathname ?? url.pathname, StudioRoutes.clientBundle)) {
          return javascriptResponse(await clientAssets.bundle())
        }
        if (route === undefined) {
          return response(request, url, requestOptions, { error: endpointNotFound }, 404)
        }
        const resource = manager.get(route.sessionId)
        if (resource === undefined) {
          if (request.method === 'GET' && url.searchParams.get('native-window') === 'project') {
            return htmlResponse(StudioWelcome.sessionUnavailable(), 404)
          }
          return response(request, url, requestOptions, { error: 'Studio session not found.' }, 404)
        }
        subscribeSession(route.sessionId)
        if (at(request, route.pathname, routes.browserOpen)) {
          return renderReply(request, url, requestOptions, await openBrowser(resource.previewUrl, options.openBrowser))
        }
        // Each of these answers only the routes it owns, and hands the rest on in the order they are tried.
        const scoped = await handleTestRequest(resource, request, url, requestOptions, route.pathname)
          ?? await handleDeviceRequest(route.sessionId, resource, request, url, requestOptions, route.pathname)
        if (scoped !== undefined) {
          return scoped
        }
        if (route.pathname === routes.events.path || route.pathname === routes.languageLsp.path) {
          const upgraded = bunServer.upgrade(request, {
            data: {
              kind: route.pathname === routes.events.path ? 'events' : 'lsp',
              sessionId: route.sessionId,
            },
          })
          return upgraded
            ? undefined
            : response(request, url, requestOptions, { error: 'WebSocket upgrade failed.' }, 400)
        }
        configureRequestLifetime(request, bunServer, route.pathname)
        const sessionUrl = new URL(`${route.pathname}${url.search}${url.hash}`, url.origin)
        return await handleRequest(
          resource.session,
          dataSources.get(route.sessionId)!,
          fixtureGeneration,
          request,
          sessionUrl,
          {
            ...requestOptions,
            previewUrl: resource.previewUrl ?? requestOptions.previewUrl,
          },
          resource.tests,
        )
      } catch (error) {
        return errorResponse(request, url, requestOptions, error)
      }
    },
    hostname: options.hostname ?? '127.0.0.1',
    port: options.port ?? 0,
    websocket: {
      close(socket) {
        Switch.kind<StudioSocketData, void>(socket.data, {
          events: events => void eventClients.get(events.sessionId)?.delete(socket),
          lsp: lsp => lsp.session?.close(),
        })
      },
      message(socket, message) {
        Switch.kind<StudioSocketData, void>(socket.data, {
          // An event socket is one-way: Studio publishes, the browser never writes back.
          events: Switch.nothing,
          lsp: lsp => lsp.session?.accept(message),
        })
      },
      open(socket) {
        const resource = manager.get(socket.data.sessionId)
        if (resource === undefined) {
          socket.close(1008, 'Studio session is not open')
          return
        }
        Switch.kind<StudioSocketData, void>(socket.data, {
          events: events => {
            const clients = eventClients.get(events.sessionId) ?? new Set<StudioSocket>()
            clients.add(socket)
            eventClients.set(events.sessionId, clients)
            const sessionId = events.sessionId
            void initializeEventSocket(
              socket,
              resource.session,
              deviceGateway === undefined ? undefined : () => deviceStateEvent(deviceGateway.status(sessionId)),
            )
          },
          lsp: lsp => {
            lsp.session = StudioLsp.createSession(resource.session.projectRoot, socket)
          },
        })
      },
    },
  })
  const hostname = server.hostname ?? options.hostname ?? '127.0.0.1'
  const port = server.port ?? options.port ?? 0
  const url = `http://${hostname.includes(':') ? `[${hostname}]` : hostname}:${port}`
  return {
    hostname,
    manager,
    port,
    async stop() {
      unsubscribeManager()
      for (const subscriptions of sessionSubscriptions.values()) {
        for (const unsubscribe of subscriptions) {
          unsubscribe()
        }
      }
      sessionSubscriptions.clear()
      for (const datasource of dataSources.values()) {
        datasource.close()
      }
      dataSources.clear()
      for (const clients of eventClients.values()) {
        closeClients(clients, 'Studio server stopped')
      }
      eventClients.clear()
      await server.stop(true)
      await options.canvasViewportStore?.flush()
    },
    url,
  }
}

/** Shipping can be quiet for minutes while Apple processes a build; Bun otherwise resets it after ten seconds. */
function configureRequestLifetime(
  request: Request,
  server: Pick<Bun.Server<StudioSocketData>, 'timeout'>,
  pathname: string,
): void {
  if (at(request, pathname, routes.shipBeta)) {
    server.timeout(request, 0)
  }
}

async function initializeEventSocket(
  socket: Pick<StudioSocket, 'close' | 'send'>,
  session: Pick<StudioProjectSession, 'handshake'>,
  deviceState?: () => StudioDeviceStateEvent,
): Promise<void> {
  try {
    socket.send(JSON.stringify(await session.handshake()))
    if (deviceState !== undefined) {
      socket.send(JSON.stringify(deviceState()))
    }
  } catch {
    socket.close(1011, 'Could not initialize Studio events')
  }
}

function deviceStateEvent(status: StudioDeviceStateEvent['status']): StudioDeviceStateEvent {
  return { channel: studioProtocolChannel, protocolVersion: studioProtocolVersion, status, type: 'device-state' }
}

/** Launch only the session's standalone app URL; request bodies and the server-wide preview fallback cannot select it. */
async function openBrowser(
  previewUrl: string | undefined,
  open: StudioServerOptions['openBrowser'],
): Promise<StudioReply> {
  if (open === undefined) {
    return jsonReply({ error: 'This Studio service does not include browser launch tooling.' }, 501)
  }
  const url = previewUrl === undefined ? null : URL.parse(previewUrl)
  if (url === null || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return jsonReply({ error: 'This project has no web preview available to open in a browser.' }, 503)
  }
  try {
    await open(url.href)
    return jsonReply({ opened: true, url: url.href })
  } catch {
    return jsonReply({ error: 'Could not open the app in a browser. Try again.' }, 502)
  }
}

/** Every device route shares this prefix, and an unknown path under it is still the gateway's to refuse. */
const deviceRoutePrefix = '/api/device/'

type StudioDeviceContext = Readonly<{ gateway: StudioServerDeviceGateway; request: Request; sessionId: string }>

/** gatewayTo answers a device route from the gateway, handing it the request body only when one is read. */
function gatewayTo(
  act: (gateway: StudioServerDeviceGateway, sessionId: string, body: () => Promise<unknown>) => unknown,
): StudioHandler<StudioDeviceContext> {
  return async ({ gateway, request, sessionId }) =>
    jsonReply(await act(gateway, sessionId, async () => await request.json()))
}

const deviceHandlers: Readonly<Record<StudioDeviceRouteKey, StudioHandler<StudioDeviceContext>>> = {
  deviceCapture: gatewayTo((gateway, sessionId) => gateway.captureRuntime(sessionId)),
  deviceHighlight: gatewayTo(async (gateway, sessionId, body) =>
    gateway.highlightSource(sessionId, deviceHighlightRequest(await body()))
  ),
  devicePairingConfirm: gatewayTo(async (gateway, sessionId, body) =>
    await gateway.confirmPairing(sessionId, devicePublicKey(await body()))
  ),
  devicePairingDecline: gatewayTo(async (gateway, sessionId, body) =>
    gateway.declinePairing(sessionId, devicePublicKey(await body()))
  ),
  devicePairingOpen: gatewayTo((gateway, sessionId) => gateway.openPairing(sessionId)),
  deviceReconnect: gatewayTo((gateway, sessionId) => gateway.requestReconnect(sessionId)),
  deviceRevoke: gatewayTo(async (gateway, sessionId, body) =>
    await gateway.revoke(sessionId, devicePublicKey(await body()))
  ),
  deviceSelectCell: gatewayTo(async (gateway, sessionId, body) =>
    gateway.selectCell(sessionId, requiredField(await body(), 'cellId', 'Expected a Studio cell id.'))
  ),
  deviceStatus: gatewayTo((gateway, sessionId) => gateway.status(sessionId)),
}

const deviceEntries = routeEntries<StudioDeviceRouteKey, StudioHandler<StudioDeviceContext>>(routes, deviceHandlers)

/** Device routes answer 501 without a gateway; launch routes also need the host-tooling launcher. */
async function handleDeviceRequest(
  sessionId: string,
  resource: StudioSessionResource,
  request: Request,
  url: URL,
  options: StudioServerOptions,
  pathname: string,
): Promise<Response | undefined> {
  if (!pathname.startsWith(deviceRoutePrefix)) {
    return undefined
  }
  const render = (reply: StudioReply): Response => renderReply(request, url, options, reply)
  const gateway = options.deviceGateway
  if (gateway === undefined) {
    return render(jsonReply({ error: 'This Studio service does not include the device gateway.' }, 501))
  }
  // Launch tooling is refused by path, before the method, so a launch call without it never reads as unknown.
  if (pathname === routes.deviceLaunch.path || pathname === routes.deviceLaunchOpen.path) {
    const launcher = options.deviceLauncher
    if (launcher === undefined) {
      return render(jsonReply({ error: 'This Studio service does not include physical-device launch tooling.' }, 501))
    }
    const metroOrigin = resource.previewUrl
    if (metroOrigin === undefined) {
      return render(jsonReply({ error: 'This project has no Metro preview to launch on a device.' }, 501))
    }
    if (at(request, pathname, routes.deviceLaunch)) {
      return render(jsonReply(await launcher.describe({ metroOrigin })))
    }
    if (at(request, pathname, routes.deviceLaunchOpen)) {
      const { hostId, route } = deviceLaunchOpenRequest(await request.json())
      return render(jsonReply(await launcher.open({ hostId, metroOrigin, route })))
    }
  }
  return await dispatch(deviceEntries, request, url, options, pathname, () => ({ gateway, request, sessionId }))
    ?? render(jsonReply({ error: endpointNotFound }, 404))
}

function devicePublicKey(value: unknown): string {
  return requiredField(value, 'devicePublicKey', 'Expected the device public key.')
}

/** A highlight with no occurrence clears the device's outline, so an empty body is a valid request. */
function deviceHighlightRequest(
  value: unknown,
): { end: number; ownerName?: string; sourcePath: string; sourceVersion: string; start: number } | undefined {
  if (!Json.isRecord(value) || value['occurrence'] === undefined) {
    return undefined
  }
  const occurrence = value['occurrence']
  if (
    !Json.isRecord(occurrence)
    || typeof occurrence['sourcePath'] !== 'string'
    || occurrence['sourcePath'].trim() === ''
    || typeof occurrence['sourceVersion'] !== 'string'
    || occurrence['sourceVersion'].trim() === ''
    || !Number.isSafeInteger(occurrence['start'])
    || !Number.isSafeInteger(occurrence['end'])
  ) {
    Errors.throwUserInput('Expected a Tao source occurrence to highlight.')
  }
  return {
    end: occurrence['end'] as number,
    ...(typeof occurrence['ownerName'] === 'string' ? { ownerName: occurrence['ownerName'] } : {}),
    sourcePath: occurrence['sourcePath'],
    sourceVersion: occurrence['sourceVersion'],
    start: occurrence['start'] as number,
  }
}

function deviceLaunchOpenRequest(value: unknown): { hostId: string; route: 'auto' | 'cable' } {
  const hostId = requiredField(value, 'hostId', 'Expected the host id of the device to launch on.')
  const route = Json.isRecord(value) ? value['route'] : undefined
  if (route !== undefined && route !== 'auto' && route !== 'cable') {
    Errors.throwUserInput("Expected the launch route to be 'auto' or 'cable'.")
  }
  return { hostId, route: route ?? 'auto' }
}

type StudioTestContext = StudioTestRunner | undefined

const testHandlers: Readonly<Record<StudioTestRouteKey, StudioHandler<StudioTestContext>>> = {
  testsRun: async tests =>
    tests === undefined ? jsonReply({ error: testRuntimeUnavailable }, 501) : jsonReply(await tests.run()),
  testsStatus: tests =>
    jsonReply(tests?.status() ?? { available: false, reason: testRuntimeUnavailable, running: false }),
}

const testEntries = routeEntries<StudioTestRouteKey, StudioHandler<StudioTestContext>>(routes, testHandlers)

async function handleTestRequest(
  resource: StudioSessionResource,
  request: Request,
  url: URL,
  options: StudioServerOptions,
  pathname: string,
): Promise<Response | undefined> {
  return await dispatch(testEntries, request, url, options, pathname, () => resource.tests)
}

type StudioManagerContext = Readonly<{
  closeSession: (sessionId: string) => Promise<boolean>
  manager: StudioSessionManager
  parameters: Readonly<Record<string, string>>
  request: Request
  subscribeSession: (sessionId: string) => void
}>

const managerHandlers: Readonly<Record<StudioManagerRouteKey, StudioHandler<StudioManagerContext>>> = {
  closeAllSessions: async ({ closeSession, manager }) => {
    const ids = manager.list().current.map(item => item.sessionId)
    await Promise.all(ids.map(closeSession))
    return jsonReply({ closed: ids })
  },
  closeSession: async ({ closeSession, parameters }) => {
    const sessionId = parameters['sessionId']!
    const closed = await closeSession(sessionId)
    return jsonReply({ closed, sessionId }, closed ? 200 : 404)
  },
  openSession: async context =>
    openedSessionReply(context, await context.manager.open(projectOpenRequest(await context.request.json()))),
  root: ({ manager }) => htmlReply(StudioWelcome.html(manager.list())),
  sessions: ({ manager }) => jsonReply(manager.list()),
  switchSession: async context =>
    openedSessionReply(
      context,
      await context.manager.replace(context.parameters['sessionId']!, projectOpenRequest(await context.request.json())),
    ),
  welcome: ({ manager }) => htmlReply(StudioWelcome.html(manager.list())),
}

/** Manager paths never overlap, so the table answers them in whatever order the record lists them. */
const managerEntries = routeEntries<StudioManagerRouteKey, StudioHandler<StudioManagerContext>>(
  StudioRoutes.manager,
  managerHandlers,
)

/** Opening and switching answer alike: the session that is now current, and the window that shows it. */
function openedSessionReply(context: StudioManagerContext, opened: StudioCurrentSession): StudioReply {
  context.subscribeSession(opened.sessionId)
  const { previewUrl } = context.manager.require(opened.sessionId)
  return jsonReply({ previewUrl, session: opened, url: StudioSessionPath.window(opened.sessionId) }, 201)
}

async function handleManagerRequest(
  manager: StudioSessionManager,
  request: Request,
  url: URL,
  options: StudioServerOptions,
  subscribeSession: (sessionId: string) => void,
  closeSession: (sessionId: string) => Promise<boolean>,
): Promise<Response | undefined> {
  return await dispatch(managerEntries, request, url, options, url.pathname, parameters => ({
    closeSession,
    manager,
    parameters,
    request,
    subscribeSession,
  }))
}

/** A manager path is never a session path, whatever its method, so the two tables cannot shadow each other. */
function managerRequestPath(pathname: string): boolean {
  return Object.values(StudioRoutes.manager).some(route => StudioRoutes.match(route, pathname) !== undefined)
}

function projectOpenRequest(value: unknown): StudioProjectOpenRequest {
  if (
    !Json.isRecord(value)
    || typeof value['projectPath'] !== 'string'
    || (value['appName'] !== undefined && typeof value['appName'] !== 'string')
    || (value['entryPath'] !== undefined && typeof value['entryPath'] !== 'string')
  ) {
    Errors.throwUserInput('Expected a project path and optional app name.')
  }
  return {
    ...(value['appName'] === undefined ? {} : { appName: value['appName'] }),
    ...(value['entryPath'] === undefined ? {} : { entryPath: value['entryPath'] }),
    projectPath: value['projectPath'],
  }
}

/** StudioPreviewDiagnosis says whether the preview's bundler can currently build the app. */
type StudioPreviewDiagnosis = {
  status: 'ok' | 'failed' | 'unreachable' | 'unknown'
  message?: string
}

/** The parameters Expo's web runtime asks for, so the probe reads the bundle the preview itself requested. */
const PREVIEW_BUNDLE_QUERY =
  'platform=web&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable'

/**
 * previewDiagnosis asks the preview's own bundler whether it can build the app. A project whose Tao compiles
 * can still fail here, because the bundler resolves the generated TypeScript rather than the Tao source, and
 * that failure otherwise reaches a person only as a blank preview.
 */
async function previewDiagnosis(previewUrl: string | undefined): Promise<StudioPreviewDiagnosis> {
  if (previewUrl === undefined) {
    return { status: 'unknown' }
  }
  try {
    const bundle = new URL(`/index.ts.bundle?${PREVIEW_BUNDLE_QUERY}`, previewUrl)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      // Bun and DOM publish structurally different AbortSignal declarations; the runtime object is shared.
      const signal = controller.signal as unknown as RequestInit['signal']
      const bundleResponse = await fetch(bundle.toString(), { signal })
      if (bundleResponse.ok) {
        return { status: 'ok' }
      }
      return { message: bundlerMessage(await bundleResponse.text()), status: 'failed' }
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    return { message: Errors.messageOf(error), status: 'unreachable' }
  }
}

/** bundlerMessage reduces a Metro error payload to the one line that says what could not be built. */
export function bundlerMessage(body: string): string {
  let text = body
  try {
    const parsed = JSON.parse(body) as { message?: unknown }
    if (typeof parsed.message === 'string') {
      text = parsed.message
    }
  } catch {
    // Metro can answer with plain text; the body is then already the message.
  }
  const lines = text.replaceAll(/\u001B\[[0-9;]*m/g, '').split('\n').map(line => line.trim()).filter(line =>
    line !== ''
  )
  return lines[0] ?? 'The bundler reported no detail.'
}

type StudioSessionContext = Readonly<{
  datasource: StudioServerDatasource
  fixtureGeneration: StudioFixtureGeneration
  options: StudioServerOptions
  parameters: Readonly<Record<string, string>>
  request: Request
  session: StudioProjectSession
  tests: StudioTestRunner | undefined
  url: URL
}>

/** Most session routes are one session call: `sessionTo` reads nothing more, `bodyTo` also reads the body. */
type StudioSessionHandler = StudioHandler<StudioSessionContext>

function sessionTo(act: (session: StudioProjectSession) => unknown, status?: number): StudioSessionHandler {
  return async ({ session }) => jsonReply(await act(session), status)
}

function bodyTo(act: (session: StudioProjectSession, body: unknown) => unknown, status?: number): StudioSessionHandler {
  return async ({ request, session }) => jsonReply(await act(session, await request.json()), status)
}

/** Both chat routes run the same turn; only whether the panel streams it or awaits it differs. */
async function chatTurn(
  { options, parameters, request, session, tests }: StudioSessionContext,
): Promise<Parameters<typeof streamTurn>> {
  const body = (await request.json()) as Record<string, unknown>
  return [session, parameters['command']!, body, tests, options.agentSecrets, options.agentProvider]
}

const sessionHandlers: Readonly<Record<StudioSessionRouteKey, StudioSessionHandler>> = {
  agentChat: async context => jsonReply(await AgentChat.handle(...await chatTurn(context))),
  // A turn is streamed rather than awaited: the panel prints the answer as the model produces it.
  agentChatStream: async context => ({ kind: 'stream', stream: streamTurn(...await chatTurn(context)) }),
  aiAvailability: async ({ fixtureGeneration }) => jsonReply(await fixtureGeneration.availability()),
  aiFixture: async ({ fixtureGeneration, request, session }) => {
    const manifest = session.previewManifest()
    return manifest === undefined
      ? jsonReply({ error: previewManifestUnavailable }, 404)
      : jsonReply(await fixtureGeneration.generate(manifest, await request.json()))
  },
  dataFill: async ({ datasource, request }) => jsonReply(await datasource.fill(dataFillRequest(await request.json()))),
  canvasViewport: bodyTo((session, body) => session.saveCanvasViewport(body)),
  feedBrowse: bodyTo((session, body) => session.browseFeed(body)),
  feedAction: bodyTo((session, body) => session.applyFeedAction(body)),
  file: async ({ session, url }) =>
    jsonReply(await session.readFile(requiredQuery(url, 'path', 'Missing Studio file path.'))),
  fileCreate: bodyTo((session, body) => session.createFile(createFileRequest(body)), 201),
  fileDelete: bodyTo((session, body) => session.deleteFile(deleteFileRequest(body))),
  fileDraft: bodyTo((session, body) => session.syncDraft(draftWriteRequest(body))),
  fileMoveGenerated: bodyTo((session, body) => session.moveGeneratedSource(moveGeneratedSourceRequest(body))),
  fileRename: bodyTo((session, body) => session.renameFile(renameFileRequest(body))),
  files: sessionTo(async session => ({ files: await session.files() })),
  languageHighlight: async ({ request }) => {
    const input: unknown = await request.json()
    const [highlight, lens] = await Promise.all([StudioHighlight.highlight(input), StudioSyntaxLens.classify(input)])
    const analysis: StudioLanguageAnalysis = { ...highlight, lens }
    return jsonReply(analysis)
  },
  previewApplied: bodyTo((session, body) => ({ accepted: session.acknowledgePreview(body) })),
  previewCell: ({ session, url }) =>
    jsonReply(session.previewCell(requiredQuery(url, 'cellId', 'Missing Studio cell id.'))),
  previewCellBootstrap: ({ session, url }) =>
    jsonReply(
      session.previewCellInstance(requiredQuery(url, 'previewInstanceId', 'Missing Studio preview instance id.')),
    ),
  previewCellInstance: bodyTo((session, body) => session.registerCellPreview(body)),
  previewCellReconfigure: bodyTo((session, body) => session.reconfigureCell(body)),
  previewDiagnosis: async ({ options }) => jsonReply(await previewDiagnosis(options.previewUrl)),
  previewInstance: bodyTo((session, body) => session.registerPreview(body)),
  previewLayoutMeasurements: bodyTo((session, body) => session.recordPreviewLayoutMeasurements(body)),
  previewManifest: ({ session }) => {
    const manifest = session.previewManifest()
    return manifest === undefined ? jsonReply({ error: previewManifestUnavailable }, 404) : jsonReply(manifest)
  },
  protocol: sessionTo(session => session.handshake()),
  shipBeta: async ({ options, session }) => {
    await shipBeta(session, options.shipBeta ?? runBetaShip)
    return jsonReply({
      appName: session.appName,
      message: `${session.appName} was uploaded and distributed through TestFlight.`,
    })
  },
  sketchAction: bodyTo((session, body) => session.applySketchAction(body)),
  sketchFlowAction: bodyTo((session, body) => session.applySketchFlowAction(body)),
  sketchSnapApply: bodyTo((session, body) => session.applySketchSnap(body)),
  sketchSnapPropose: bodyTo((session, body) => session.proposeSketchSnap(body)),
  sketchSnapUndo: bodyTo((session, body) => session.undoSketchSnap(body)),
  sketchUnsnapApply: bodyTo((session, body) => session.applySketchUnsnap(body)),
  sketches: sessionTo(session => session.sketchCatalog()),
  sourceAction: bodyTo((session, body) => session.applySourceAction(body)),
  sourceActionInspect: bodyTo((session, body) => session.inspectRender(inspectRenderRequest(body))),
  sourceActionPropose: bodyTo((session, body) => session.proposeSourceAction(body)),
  sourceActionUndo: bodyTo((session, body) => session.undoSourceAction(body)),
}

/** The client page and its bundle answer by path alone, inside a session window as well as at the root. */
const sessionEntries: readonly StudioRouteEntry<StudioSessionHandler>[] = [
  [StudioRoutes.client, ({ options }) => htmlReply(studioClientHtml(options))],
  [StudioRoutes.clientBundle, async ({ options }) => ({
    javascript: await (options.clientAssets ?? StudioClientAssets).bundle(),
    kind: 'javascript',
  })],
  ...routeEntries<StudioSessionRouteKey, StudioSessionHandler>(routes, sessionHandlers),
]

async function handleRequest(
  session: StudioProjectSession,
  datasource: StudioServerDatasource,
  fixtureGeneration: StudioFixtureGeneration,
  request: Request,
  url: URL,
  options: StudioServerOptions,
  tests?: StudioTestRunner,
): Promise<Response> {
  return await dispatch(sessionEntries, request, url, options, url.pathname, parameters => ({
    datasource,
    fixtureGeneration,
    options,
    parameters,
    request,
    session,
    tests,
    url,
  })) ?? renderReply(request, url, options, jsonReply({ error: endpointNotFound }, 404))
}

async function shipBeta(session: StudioProjectSession, ship: StudioBetaShip): Promise<void> {
  const key = `${session.projectRoot}\n${session.appName}`
  if (runningBetaShips.has(key)) {
    Errors.throwUserInput(`A beta ship is already running for ${session.appName}.`)
  }
  const running = ship({
    appName: session.appName,
    entryPath: session.entryPath,
    projectRoot: session.projectRoot,
  })
  runningBetaShips.set(key, running)
  try {
    await running
  } finally {
    runningBetaShips.delete(key)
  }
}

/** betaShipArguments passes --ignore-git because Studio ships the edits in the session, not a committed tree. */
function betaShipArguments(request: StudioBetaShipRequest): string[] {
  return ['ship', request.entryPath, '--app', request.appName, '--beta', '--yes', '--ignore-git']
}

async function runBetaShip(request: StudioBetaShipRequest): Promise<void> {
  const repositoryRoot = Repo.getRoot(request.projectRoot)
  await CLI.mustRun(Repo.resolvePath('tao', repositoryRoot), {
    args: betaShipArguments(request),
    cwd: repositoryRoot,
    prefixedOutput: { processName: `ship ${request.appName}` },
  })
}

function inspectRenderRequest(value: unknown): StudioInspectRenderRequest {
  const fields = requiredStrings(
    value,
    ['path', 'renderId', 'sourceVersion'],
    'Expected a source path, version, and render id to inspect.',
  )
  const declared = Json.isRecord(value) ? value['identity'] : undefined
  const identity = declared === undefined ? undefined : StudioProtocol.parseSourceActionIdentity(declared)
  return { ...(identity === undefined ? {} : { identity }), ...fields }
}

const fillEntities = new Set(['Checkpoints', 'DesignTokens', 'Files', 'Problems', 'Scenarios', 'Screens', 'Views'])

function dataFillRequest(value: unknown): StudioServerFillRequest {
  if (!Json.isRecord(value) || typeof value['entity'] !== 'string' || !fillEntities.has(value['entity'])) {
    Errors.throwUserInput('Expected a valid StudioServer entity fill request.')
  }
  const where = value['where']
  if (
    where !== undefined
    && (!Json.isRecord(where)
      || Object.values(where).some(item => !['boolean', 'number', 'string'].includes(typeof item)))
  ) {
    Errors.throwUserInput('StudioServer fill filters must contain scalar values.')
  }
  return {
    entity: value['entity'] as StudioServerFillRequest['entity'],
    ...(where === undefined ? {} : { where: where as StudioServerFillRequest['where'] }),
  }
}

/** A page or a bundle is served as its own type and never sniffed into another one. */
function assetResponse(body: string, contentType: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType, 'x-content-type-options': 'nosniff' },
  })
}

function htmlResponse(html: string, status = 200): Response {
  return assetResponse(html, 'text/html; charset=utf-8', status)
}

function javascriptResponse(javascript: string): Response {
  return assetResponse(javascript, 'text/javascript; charset=utf-8')
}

/** requiredQuery reads a query parameter the route it belongs to cannot be answered without. */
function requiredQuery(url: URL, name: string, message: string): string {
  const value = url.searchParams.get(name)
  if (value === null || value.trim().length === 0) {
    Errors.throwUserInput(message)
  }
  return value
}

/** Every Studio write request is a record of required string fields, so one reader validates them all. */
function requiredStrings<FieldT extends string>(
  value: unknown,
  fields: readonly FieldT[],
  message: string,
): Record<FieldT, string> {
  if (!Json.isRecord(value) || fields.some(field => typeof value[field] !== 'string')) {
    Errors.throwUserInput(message)
  }
  return Object.fromEntries(fields.map(field => [field, value[field]])) as Record<FieldT, string>
}

/** requiredField reads the one non-empty string a small request body carries. */
function requiredField(value: unknown, field: string, message: string): string {
  const text = Json.isRecord(value) ? value[field] : undefined
  if (typeof text !== 'string' || text.trim() === '') {
    Errors.throwUserInput(message)
  }
  return text
}

function draftWriteRequest(value: unknown): StudioDraftWriteRequest {
  return requiredStrings(
    value,
    ['content', 'path', 'sourceVersion', 'writeId'],
    'Expected path, content, sourceVersion, and writeId for a Studio draft.',
  )
}

function createFileRequest(value: unknown): StudioCreateFileRequest {
  return requiredStrings(value, ['path', 'writeId'], 'Expected path and writeId to create a Studio file.')
}

function renameFileRequest(value: unknown): StudioRenameFileRequest {
  return requiredStrings(
    value,
    ['path', 'sourceVersion', 'targetPath', 'writeId'],
    'Expected path, targetPath, sourceVersion, and writeId to rename a Studio file.',
  )
}

function moveGeneratedSourceRequest(value: unknown): StudioMoveGeneratedSourceRequest {
  const request = requiredStrings(
    value,
    ['path', 'sourceVersion', 'targetPackage', 'writeId'],
    'Expected path, targetPackage, sourceVersion, and writeId to move generated source.',
  )
  const relocateScenarios = (value as Record<string, unknown>)['relocateScenarios']
  Assert.input(
    relocateScenarios === undefined || typeof relocateScenarios === 'boolean',
    'Expected a boolean scenario relocation choice.',
  )
  return { ...request, ...(relocateScenarios === undefined ? {} : { relocateScenarios }) }
}

function deleteFileRequest(value: unknown): StudioDeleteFileRequest {
  return requiredStrings(
    value,
    ['path', 'sourceVersion', 'writeId'],
    'Expected path, sourceVersion, and writeId to delete a Studio file.',
  )
}

function response(
  request: Request,
  requestUrl: URL,
  options: StudioServerOptions,
  value: unknown,
  status = 200,
): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'vary': 'origin',
  })
  allowRequestOrigin(headers, request, requestUrl, options)
  return new Response(status === 204 ? null : JSON.stringify(value), { headers, status })
}

/** A reply carries the cross-origin headers only for an origin the request boundary already accepted. */
function allowRequestOrigin(headers: Headers, request: Request, url: URL, options: StudioServerOptions): void {
  const origin = request.headers.get('origin')
  if (origin !== null && originAllowed(request, url, options.allowedOrigins)) {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-headers', 'content-type')
    headers.set('access-control-allow-methods', 'GET, POST, OPTIONS')
  }
}

/** streamResponse sends newline-delimited JSON as it is produced, with the same origin rules as `response`. */
function streamResponse(
  request: Request,
  requestUrl: URL,
  options: StudioServerOptions,
  stream: ReadableStream<Uint8Array>,
): Response {
  const headers = new Headers({
    // No buffering anywhere in between, or the stream arrives as one block and there was no point.
    'cache-control': 'no-store, no-transform',
    'content-type': 'application/x-ndjson; charset=utf-8',
    'vary': 'origin',
    'x-accel-buffering': 'no',
  })
  allowRequestOrigin(headers, request, requestUrl, options)
  return new Response(stream, { headers, status: 200 })
}

function errorResponse(
  request: Request,
  url: URL,
  options: StudioServerOptions,
  error: unknown,
): Response {
  const status = error instanceof StudioSourceActionConflictError
      || error instanceof StudioMatrixConflictError
      || error instanceof StudioSketchCatalogConflictError
    ? 409
    : error instanceof Errors.UserInputError || error instanceof SyntaxError
    ? 400
    : 500
  return response(request, url, options, { details: conflictDetails(error), error: Errors.messageOf(error) }, status)
}

/** A conflict carries what the client needs to reconcile; anything else answers with its message alone. */
function conflictDetails(error: unknown): Readonly<Record<string, unknown>> | undefined {
  if (error instanceof StudioSourceActionConflictError) {
    return {
      code: error.code,
      ...error.details,
      ...(error instanceof StudioSourceConflictError
        ? { actualSourceVersion: error.actualSourceVersion, expectedSourceVersion: error.expectedSourceVersion }
        : {}),
    }
  }
  if (error instanceof StudioSketchCatalogConflictError) {
    return { actualRevision: error.actualRevision, code: error.code, expectedRevision: error.expectedRevision }
  }
  return error instanceof StudioMatrixConflictError ? { code: error.code } : undefined
}

function originAllowed(request: Request, requestUrl: URL, allowedOrigins: readonly string[] | undefined): boolean {
  const origin = request.headers.get('origin')
  return origin === null || origin === requestUrl.origin || allowedOrigins?.includes(origin) === true
}

/** The request must have reached the origin Studio bound, and only then may its own Origin be weighed. */
function requestAllowed(
  request: Request,
  requestUrl: URL,
  boundOrigin: string,
  allowedOrigins: readonly string[] | undefined,
): boolean {
  return requestUrl.origin === boundOrigin && originAllowed(request, requestUrl, allowedOrigins)
}

function originAuthorization(
  manager: StudioSessionManager,
  staticOrigins: readonly string[] | undefined,
): { allowedOrigins: (sessionId: string, pathname?: string) => readonly string[] } {
  return {
    allowedOrigins(sessionId, pathname) {
      const origins = new Set(staticOrigins)
      if (pathname === undefined || !previewOriginPath(pathname)) {
        return [...origins]
      }
      const previewUrl = manager.get(sessionId)?.previewUrl
      if (previewUrl !== undefined) {
        try {
          const url = new URL(previewUrl)
          if (url.protocol === 'http:' || url.protocol === 'https:') {
            origins.add(url.origin)
          }
        } catch {
          // Invalid preview URLs are rejected by the preview client; they grant no server origin.
        }
      }
      return [...origins]
    },
  }
}

/** The routes a preview iframe calls from its own origin; every other route is same-origin only. */
const previewOriginRoutes: readonly StudioRoute[] = [
  routes.previewInstance,
  routes.previewApplied,
  routes.previewLayoutMeasurements,
  routes.previewCell,
  routes.previewCellBootstrap,
  routes.previewCellInstance,
  routes.previewCellReconfigure,
]

function previewOriginPath(pathname: string): boolean {
  return previewOriginRoutes.some(route => route.path === pathname)
}

function serverOrigin(protocol: string, hostname: string, port: number): string {
  const host = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname
  const defaultPort = (protocol === 'http:' && port === 80) || (protocol === 'https:' && port === 443)
  return `${protocol}//${host}${defaultPort ? '' : `:${port}`}`
}

function forbiddenResponse(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'vary': 'origin',
    },
    status: 403,
  })
}

export const StudioServerTesting = {
  betaShipArguments,
  configureRequestLifetime,
  errorResponse,
  handleDeviceRequest,
  handleRequest: handleRequestForTesting,
  handleTestRequest,
  initializeEventSocket,
  managerRequestPath,
  originAuthorization,
  previewOriginPath,
  requestAllowed,
  serverOrigin,
  studioClientHtml,
  studioSessionRoute: StudioSessionPath.route,
} as const

function studioClientHtml(options: StudioServerOptions): string {
  const source = (options.clientAssets ?? StudioClientAssets).html({ previewUrl: options.previewUrl })
  const revision = options.clientReloadRevision?.()
  if (revision === undefined) {
    return source
  }
  const reload = `<script>
(() => {
  let revision = ${JSON.stringify(revision)}
  const poll = async () => {
    try {
      const response = await fetch('${StudioRoutes.devRevision.path}', { cache: 'no-store' })
      if (response.ok) {
        const next = await response.json()
        if (next.revision !== revision) {
          window.location.reload()
          return
        }
      }
    } catch {}
    window.setTimeout(poll, 250)
  }
  window.setTimeout(poll, 250)
})()
</script>`
  return source.replace('</body>', `${reload}\n</body>`)
}

async function handleRequestForTesting(
  session: StudioProjectSession,
  fixtureGeneration: StudioFixtureGeneration,
  request: Request,
  url: URL,
  options: StudioServerOptions,
): Promise<Response> {
  const datasource = new StudioServerDatasource(session)
  try {
    return await handleRequest(session, datasource, fixtureGeneration, request, url, options)
  } finally {
    datasource.close()
  }
}

function broadcast(clients: Set<StudioSocket>, event: StudioSessionSocketEvent): void {
  const payload = JSON.stringify(event)
  for (const client of clients) {
    client.send(payload)
  }
}

function closeClients(clients: Set<StudioSocket> | undefined, reason: string): void {
  for (const client of clients ?? []) {
    client.close(1001, reason)
  }
}
