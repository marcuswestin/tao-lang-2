import { type GenerationProvider, UnavailableGenerationProvider } from '@generation'
import { Errors } from '@shared'
import { type StudioClientAssetProvider, StudioClientAssets } from './StudioClientAssets'
import { StudioFixtureGeneration } from './StudioFixtureGeneration'
import { StudioHighlight } from './StudioHighlight'
import { StudioLsp, type StudioLspSession } from './StudioLsp'
import { StudioMatrixConflictError } from './StudioMatrixSession'
import {
  type StudioCreateFileRequest,
  type StudioDeleteFileRequest,
  type StudioDraftWriteRequest,
  StudioProjectSession,
  type StudioRenameFileRequest,
  type StudioSessionEvent,
  StudioSourceConflictError,
} from './StudioProjectSession'
import {
  StudioServerDatasource,
  type StudioServerFillRequest,
  type StudioServerInvalidation,
} from './StudioServerDatasource'
import {
  type StudioProjectOpenRequest,
  StudioSessionManager,
  type StudioSessionResource,
} from './StudioSessionManager'
import { StudioWelcome } from './StudioWelcome'

export type StudioServerOptions = {
  allowedOrigins?: readonly string[]
  clientAssets?: StudioClientAssetProvider
  clientReloadRevision?: () => number
  compileOnStart?: boolean
  generationProvider?: GenerationProvider
  hostname?: string
  port?: number
  previewUrl?: string
}

export type StartedStudioServer = {
  hostname: string
  manager: StudioSessionManager
  port: number
  sessionId?: string
  stop: () => void
  url: string
}

type StudioSocketData =
  | { kind: 'events'; sessionId: string }
  | { kind: 'lsp'; session?: StudioLspSession; sessionId: string }

type StudioSocket = Bun.ServerWebSocket<StudioSocketData>

/** Compatibility entrypoint exposing one session at the historical root URLs. */
export async function startStudioServer(
  session: StudioProjectSession,
  options: StudioServerOptions = {},
): Promise<StartedStudioServer> {
  const manager = new StudioSessionManager()
  const opened = manager.add({ session })
  return await startManagedStudioServer(manager, options, opened.sessionId)
}

/** Starts the multi-session server whose root is the Welcome surface. */
export async function startStudioSessionServer(
  manager: StudioSessionManager,
  options: StudioServerOptions = {},
): Promise<StartedStudioServer> {
  return await startManagedStudioServer(manager, options)
}

async function startManagedStudioServer(
  manager: StudioSessionManager,
  options: StudioServerOptions,
  defaultSessionId?: string,
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
  const dataSourceSubscriptions = new Map<string, () => void>()
  const sessionSubscriptions = new Map<string, () => void>()
  const subscribeSession = (sessionId: string): void => {
    if (sessionSubscriptions.has(sessionId)) {
      return
    }
    const resource = manager.require(sessionId)
    const datasource = new StudioServerDatasource(resource.session)
    dataSources.set(sessionId, datasource)
    dataSourceSubscriptions.set(
      sessionId,
      datasource.subscribe(invalidation => {
        broadcast(eventClients.get(sessionId) ?? new Set(), { ...invalidation, type: 'data-invalidated' })
      }),
    )
    sessionSubscriptions.set(
      sessionId,
      resource.session.subscribe(event => {
        const clients = eventClients.get(sessionId) ?? new Set()
        broadcast(clients, event)
      }),
    )
  }
  for (const item of manager.list().current) {
    subscribeSession(item.sessionId)
  }
  const detachSession = (sessionId: string): void => {
    const clients = eventClients.get(sessionId)
    if (clients !== undefined) {
      for (const client of clients) {
        client.close(1001, 'Studio session closed')
      }
      eventClients.delete(sessionId)
    }
    sessionSubscriptions.get(sessionId)?.()
    sessionSubscriptions.delete(sessionId)
    dataSourceSubscriptions.get(sessionId)?.()
    dataSourceSubscriptions.delete(sessionId)
    dataSources.get(sessionId)?.close()
    dataSources.delete(sessionId)
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
      const managerRoute = managerRequestPath(url.pathname, defaultSessionId === undefined)
      const route = managerRoute ? undefined : studioSessionRoute(url.pathname, defaultSessionId)
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
        if (
          request.method === 'GET'
          && url.pathname === '/studio-dev/revision'
          && options.clientReloadRevision !== undefined
        ) {
          return response(request, url, requestOptions, { revision: options.clientReloadRevision() })
        }
        const managerResponse = await handleManagerRequest(
          manager,
          request,
          url,
          requestOptions,
          defaultSessionId === undefined,
          subscribeSession,
          closeSession,
        )
        if (managerResponse !== undefined) {
          return managerResponse
        }
        if (request.method === 'GET' && url.pathname === '/studio.js') {
          return javascriptResponse(await clientAssets.bundle())
        }
        if (route === undefined) {
          return response(request, url, requestOptions, { error: 'Studio endpoint not found.' }, 404)
        }
        const resource = manager.get(route.sessionId)
        if (resource === undefined) {
          if (request.method === 'GET' && url.searchParams.get('native-window') === 'project') {
            return htmlResponse(StudioWelcome.sessionUnavailable(), 404)
          }
          return response(request, url, requestOptions, { error: 'Studio session not found.' }, 404)
        }
        subscribeSession(route.sessionId)
        const testResponse = await handleTestRequest(resource, request, url, requestOptions, route.pathname)
        if (testResponse !== undefined) {
          return testResponse
        }
        if (route.pathname === '/events' || route.pathname === '/api/language/lsp') {
          const upgraded = bunServer.upgrade(request, {
            data: {
              kind: route.pathname === '/events' ? 'events' : 'lsp',
              sessionId: route.sessionId,
            },
          })
          return upgraded
            ? undefined
            : response(request, url, requestOptions, { error: 'WebSocket upgrade failed.' }, 400)
        }
        const sessionUrl = new URL(url)
        sessionUrl.pathname = route.pathname
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
        )
      } catch (error) {
        return errorResponse(request, url, requestOptions, error)
      }
    },
    hostname: options.hostname ?? '127.0.0.1',
    port: options.port ?? 0,
    websocket: {
      close(socket) {
        if (socket.data.kind === 'events') {
          eventClients.get(socket.data.sessionId)?.delete(socket)
        } else {
          socket.data.session?.close()
        }
      },
      message(socket, message) {
        if (socket.data.kind === 'lsp') {
          socket.data.session?.accept(message)
        }
      },
      open(socket) {
        const resource = manager.get(socket.data.sessionId)
        if (resource === undefined) {
          socket.close(1008, 'Studio session is not open')
          return
        }
        if (socket.data.kind === 'events') {
          const clients = eventClients.get(socket.data.sessionId) ?? new Set<StudioSocket>()
          clients.add(socket)
          eventClients.set(socket.data.sessionId, clients)
          void initializeEventSocket(socket, resource.session)
        } else {
          socket.data.session = StudioLsp.createSession(resource.session.projectRoot, socket)
        }
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
    sessionId: defaultSessionId,
    stop() {
      unsubscribeManager()
      for (const unsubscribe of sessionSubscriptions.values()) {
        unsubscribe()
      }
      sessionSubscriptions.clear()
      for (const unsubscribe of dataSourceSubscriptions.values()) {
        unsubscribe()
      }
      dataSourceSubscriptions.clear()
      for (const datasource of dataSources.values()) {
        datasource.close()
      }
      dataSources.clear()
      for (const clients of eventClients.values()) {
        for (const client of clients) {
          client.close(1001, 'Studio server stopped')
        }
      }
      eventClients.clear()
      server.stop(true)
    },
    url,
  }
}

async function initializeEventSocket(
  socket: Pick<StudioSocket, 'close' | 'send'>,
  session: Pick<StudioProjectSession, 'handshake'>,
): Promise<void> {
  try {
    socket.send(JSON.stringify(await session.handshake()))
  } catch {
    socket.close(1011, 'Could not initialize Studio events')
  }
}

async function handleTestRequest(
  resource: StudioSessionResource,
  request: Request,
  url: URL,
  options: StudioServerOptions,
  pathname: string,
): Promise<Response | undefined> {
  if (request.method === 'GET' && pathname === '/api/tests/status') {
    return response(
      request,
      url,
      options,
      resource.tests?.status() ?? {
        available: false,
        reason: 'This Studio service does not include the Tao test runtime.',
        running: false,
      },
    )
  }
  if (request.method === 'POST' && pathname === '/api/tests/run') {
    if (resource.tests === undefined) {
      return response(request, url, options, {
        error: 'This Studio service does not include the Tao test runtime.',
      }, 501)
    }
    return response(request, url, options, await resource.tests.run())
  }
  return undefined
}

async function handleManagerRequest(
  manager: StudioSessionManager,
  request: Request,
  url: URL,
  options: StudioServerOptions,
  welcomeAtRoot: boolean,
  subscribeSession: (sessionId: string) => void,
  closeSession: (sessionId: string) => Promise<boolean>,
): Promise<Response | undefined> {
  if (request.method === 'GET' && (url.pathname === '/welcome' || (welcomeAtRoot && url.pathname === '/'))) {
    return htmlResponse(StudioWelcome.html(manager.list()))
  }
  if (request.method === 'GET' && url.pathname === '/api/sessions') {
    return response(request, url, options, manager.list())
  }
  if (request.method === 'POST' && url.pathname === '/api/sessions/open') {
    const opened = await manager.open(projectOpenRequest(await request.json()))
    subscribeSession(opened.sessionId)
    const resource = manager.require(opened.sessionId)
    return response(request, url, options, {
      previewUrl: resource.previewUrl,
      session: opened,
      url: `/sessions/${encodeURIComponent(opened.sessionId)}`,
    }, 201)
  }
  const replacement = url.pathname.match(/^\/api\/sessions\/([A-Za-z0-9_-]{1,128})\/switch$/)
  if (request.method === 'POST' && replacement !== null) {
    const opened = await manager.replace(replacement[1]!, projectOpenRequest(await request.json()))
    subscribeSession(opened.sessionId)
    const resource = manager.require(opened.sessionId)
    return response(request, url, options, {
      previewUrl: resource.previewUrl,
      session: opened,
      url: `/sessions/${encodeURIComponent(opened.sessionId)}`,
    }, 201)
  }
  if (request.method === 'POST' && url.pathname === '/api/sessions/close-all') {
    const ids = manager.list().current.map(item => item.sessionId)
    await Promise.all(ids.map(closeSession))
    return response(request, url, options, { closed: ids })
  }
  const close = url.pathname.match(/^\/api\/sessions\/([A-Za-z0-9_-]{1,128})\/close$/)
  if (request.method === 'POST' && close !== null) {
    const sessionId = close[1]!
    const closed = await closeSession(sessionId)
    return response(request, url, options, { closed, sessionId }, closed ? 200 : 404)
  }
  return undefined
}

function managerRequestPath(pathname: string, welcomeAtRoot: boolean): boolean {
  return pathname === '/welcome'
    || (welcomeAtRoot && pathname === '/')
    || pathname === '/api/sessions'
    || pathname === '/api/sessions/open'
    || pathname === '/api/sessions/close-all'
    || /^\/api\/sessions\/[A-Za-z0-9_-]{1,128}\/switch$/.test(pathname)
    || /^\/api\/sessions\/[A-Za-z0-9_-]{1,128}\/close$/.test(pathname)
}

function studioSessionRoute(
  pathname: string,
  defaultSessionId: string | undefined,
): { pathname: string; sessionId: string } | undefined {
  const matched = pathname.match(/^\/sessions\/([A-Za-z0-9_-]{1,128})(\/.*)?$/)
  if (matched !== null) {
    return { pathname: matched[2] ?? '/', sessionId: matched[1]! }
  }
  return defaultSessionId === undefined ? undefined : { pathname, sessionId: defaultSessionId }
}

function projectOpenRequest(value: unknown): StudioProjectOpenRequest {
  if (!isRecord(value) || typeof value['projectPath'] !== 'string') {
    throw new Errors.UserInputError('Expected a project path and optional app name.')
  }
  if (
    (value['appName'] !== undefined && typeof value['appName'] !== 'string')
    || (value['entryPath'] !== undefined && typeof value['entryPath'] !== 'string')
  ) {
    throw new Errors.UserInputError('Expected a project path and optional app name.')
  }
  return {
    ...(value['appName'] === undefined ? {} : { appName: value['appName'] }),
    ...(value['entryPath'] === undefined ? {} : { entryPath: value['entryPath'] }),
    projectPath: value['projectPath'],
  }
}

async function handleRequest(
  session: StudioProjectSession,
  datasource: StudioServerDatasource,
  fixtureGeneration: StudioFixtureGeneration,
  request: Request,
  url: URL,
  options: StudioServerOptions,
): Promise<Response> {
  if (request.method === 'GET' && url.pathname === '/') {
    return htmlResponse(studioClientHtml(options))
  }
  if (request.method === 'GET' && url.pathname === '/studio.js') {
    return javascriptResponse(await (options.clientAssets ?? StudioClientAssets).bundle())
  }
  if (request.method === 'GET' && url.pathname === '/api/protocol') {
    return response(request, url, options, await session.handshake())
  }
  if (request.method === 'GET' && url.pathname === '/api/files') {
    return response(request, url, options, { files: await session.files() })
  }
  if (request.method === 'GET' && url.pathname === '/api/file') {
    return response(request, url, options, await session.readFile(requiredPath(url)))
  }
  if (request.method === 'POST' && url.pathname === '/api/file/create') {
    return response(request, url, options, await session.createFile(createFileRequest(await request.json())), 201)
  }
  if (request.method === 'POST' && url.pathname === '/api/file/rename') {
    return response(request, url, options, await session.renameFile(renameFileRequest(await request.json())))
  }
  if (request.method === 'POST' && url.pathname === '/api/file/delete') {
    return response(request, url, options, await session.deleteFile(deleteFileRequest(await request.json())))
  }
  if (request.method === 'POST' && url.pathname === '/api/file/draft') {
    return response(request, url, options, await session.syncDraft(draftWriteRequest(await request.json())))
  }
  if (request.method === 'POST' && url.pathname === '/api/data/fill') {
    return response(request, url, options, await datasource.fill(dataFillRequest(await request.json())))
  }
  if (request.method === 'POST' && url.pathname === '/api/design') {
    return response(request, url, options, await session.inspectDesign(designRequest(await request.json())))
  }
  if (request.method === 'POST' && url.pathname === '/api/language/highlight') {
    return response(request, url, options, await StudioHighlight.highlight(await request.json()))
  }
  if (request.method === 'POST' && url.pathname === '/api/source-action') {
    return response(request, url, options, await session.applySourceAction(await request.json()))
  }
  if (request.method === 'POST' && url.pathname === '/api/source-action/inspect') {
    return response(request, url, options, await session.inspectRender(inspectRenderRequest(await request.json())))
  }
  if (request.method === 'POST' && url.pathname === '/api/source-action/propose') {
    return response(request, url, options, await session.proposeSourceAction(await request.json()))
  }
  if (request.method === 'POST' && url.pathname === '/api/source-action/undo') {
    return response(request, url, options, await session.undoSourceAction(await request.json()))
  }
  if (request.method === 'GET' && url.pathname === '/api/ai/availability') {
    return response(request, url, options, await fixtureGeneration.availability())
  }
  if (request.method === 'POST' && url.pathname === '/api/ai/fixture') {
    const manifest = session.previewManifest()
    if (manifest === undefined) {
      return response(request, url, options, { error: 'Studio preview manifest is not available yet.' }, 404)
    }
    return response(request, url, options, await fixtureGeneration.generate(manifest, await request.json()))
  }
  if (request.method === 'POST' && url.pathname === '/api/preview/instance') {
    return response(request, url, options, session.registerPreview(await request.json()))
  }
  if (request.method === 'POST' && url.pathname === '/api/preview/applied') {
    return response(request, url, options, { accepted: session.acknowledgePreview(await request.json()) })
  }
  if (request.method === 'GET' && url.pathname === '/api/preview/manifest') {
    const manifest = session.previewManifest()
    return manifest === undefined
      ? response(request, url, options, { error: 'Studio preview manifest is not available yet.' }, 404)
      : response(request, url, options, manifest)
  }
  if (request.method === 'GET' && url.pathname === '/api/preview/cell') {
    return response(request, url, options, session.previewCell(requiredCellId(url)))
  }
  if (request.method === 'GET' && url.pathname === '/api/preview/cell/bootstrap') {
    return response(request, url, options, session.previewCellInstance(requiredPreviewInstanceId(url)))
  }
  if (request.method === 'POST' && url.pathname === '/api/preview/cell/instance') {
    return response(request, url, options, session.registerCellPreview(await request.json()))
  }
  if (request.method === 'POST' && url.pathname === '/api/preview/cell/reconfigure') {
    return response(request, url, options, session.reconfigureCell(await request.json()))
  }
  return response(request, url, options, { error: 'Studio endpoint not found.' }, 404)
}

function inspectRenderRequest(value: unknown): { path: string; renderId: string; sourceVersion: string } {
  if (
    !isRecord(value)
    || typeof value['path'] !== 'string'
    || typeof value['renderId'] !== 'string'
    || typeof value['sourceVersion'] !== 'string'
  ) {
    throw new Errors.UserInputError('Expected a source path, version, and render id to inspect.')
  }
  return { path: value['path'], renderId: value['renderId'], sourceVersion: value['sourceVersion'] }
}

function designRequest(value: unknown): { path: string; sourceVersion: string } {
  if (!isRecord(value) || typeof value['path'] !== 'string' || typeof value['sourceVersion'] !== 'string') {
    throw new Errors.UserInputError('Expected a source path and version to inspect Studio design values.')
  }
  return { path: value['path'], sourceVersion: value['sourceVersion'] }
}

function dataFillRequest(value: unknown): StudioServerFillRequest {
  const entities = new Set(['Checkpoints', 'Files', 'Scenarios', 'Screens', 'Views'])
  if (!isRecord(value) || typeof value['entity'] !== 'string' || !entities.has(value['entity'])) {
    throw new Errors.UserInputError('Expected a valid StudioServer entity fill request.')
  }
  const where = value['where']
  if (
    where !== undefined
    && (!isRecord(where) || Object.values(where).some(item => !['boolean', 'number', 'string'].includes(typeof item)))
  ) {
    throw new Errors.UserInputError('StudioServer fill filters must contain scalar values.')
  }
  return {
    entity: value['entity'] as StudioServerFillRequest['entity'],
    ...(where === undefined ? {} : { where: where as StudioServerFillRequest['where'] }),
  }
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  })
}

function javascriptResponse(javascript: string): Response {
  return new Response(javascript, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  })
}

function requiredPath(url: URL): string {
  const path = url.searchParams.get('path')
  if (path === null || path.trim().length === 0) {
    throw new Errors.UserInputError('Missing Studio file path.')
  }
  return path
}

function requiredCellId(url: URL): string {
  const cellId = url.searchParams.get('cellId')
  if (cellId === null || cellId.trim().length === 0) {
    throw new Errors.UserInputError('Missing Studio cell id.')
  }
  return cellId
}

function requiredPreviewInstanceId(url: URL): string {
  const previewInstanceId = url.searchParams.get('previewInstanceId')
  if (previewInstanceId === null || previewInstanceId.trim().length === 0) {
    throw new Errors.UserInputError('Missing Studio preview instance id.')
  }
  return previewInstanceId
}

function draftWriteRequest(value: unknown): StudioDraftWriteRequest {
  if (
    !isRecord(value)
    || typeof value['path'] !== 'string'
    || typeof value['content'] !== 'string'
    || typeof value['sourceVersion'] !== 'string'
    || typeof value['writeId'] !== 'string'
  ) {
    throw new Errors.UserInputError('Expected path, content, sourceVersion, and writeId for a Studio draft.')
  }
  return {
    content: value['content'],
    path: value['path'],
    sourceVersion: value['sourceVersion'],
    writeId: value['writeId'],
  }
}

function createFileRequest(value: unknown): StudioCreateFileRequest {
  if (!isRecord(value) || typeof value['path'] !== 'string' || typeof value['writeId'] !== 'string') {
    throw new Errors.UserInputError('Expected path and writeId to create a Studio file.')
  }
  return { path: value['path'], writeId: value['writeId'] }
}

function renameFileRequest(value: unknown): StudioRenameFileRequest {
  if (
    !isRecord(value)
    || typeof value['path'] !== 'string'
    || typeof value['sourceVersion'] !== 'string'
    || typeof value['targetPath'] !== 'string'
    || typeof value['writeId'] !== 'string'
  ) {
    throw new Errors.UserInputError('Expected path, targetPath, sourceVersion, and writeId to rename a Studio file.')
  }
  return {
    path: value['path'],
    sourceVersion: value['sourceVersion'],
    targetPath: value['targetPath'],
    writeId: value['writeId'],
  }
}

function deleteFileRequest(value: unknown): StudioDeleteFileRequest {
  if (
    !isRecord(value)
    || typeof value['path'] !== 'string'
    || typeof value['sourceVersion'] !== 'string'
    || typeof value['writeId'] !== 'string'
  ) {
    throw new Errors.UserInputError('Expected path, sourceVersion, and writeId to delete a Studio file.')
  }
  return { path: value['path'], sourceVersion: value['sourceVersion'], writeId: value['writeId'] }
}

function response(
  request: Request,
  requestUrl: URL,
  options: StudioServerOptions,
  value: unknown,
  status = 200,
): Response {
  const origin = request.headers.get('origin')
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'vary': 'origin',
  })
  if (origin !== null && originAllowed(request, requestUrl, options.allowedOrigins)) {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-headers', 'content-type')
    headers.set('access-control-allow-methods', 'GET, POST, OPTIONS')
  }
  return new Response(status === 204 ? null : JSON.stringify(value), { headers, status })
}

function errorResponse(
  request: Request,
  url: URL,
  options: StudioServerOptions,
  error: unknown,
): Response {
  const status = error instanceof StudioSourceConflictError || error instanceof StudioMatrixConflictError
    ? 409
    : error instanceof Errors.UserInputError || error instanceof SyntaxError
    ? 400
    : 500
  const message = error instanceof Error ? error.message : String(error)
  const details = error instanceof StudioSourceConflictError
    ? {
      actualSourceVersion: error.actualSourceVersion,
      expectedSourceVersion: error.expectedSourceVersion,
      path: error.path,
    }
    : undefined
  return response(request, url, options, { details, error: message }, status)
}

function originAllowed(request: Request, requestUrl: URL, allowedOrigins: readonly string[] | undefined): boolean {
  const origin = request.headers.get('origin')
  return origin === null || origin === requestUrl.origin || allowedOrigins?.includes(origin) === true
}

function requestAllowed(
  request: Request,
  requestUrl: URL,
  boundOrigin: string,
  allowedOrigins: readonly string[] | undefined,
): boolean {
  if (requestUrl.origin !== boundOrigin) {
    return false
  }
  const origin = request.headers.get('origin')
  return origin === null || origin === boundOrigin || allowedOrigins?.includes(origin) === true
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

function previewOriginPath(pathname: string): boolean {
  return pathname === '/api/preview/instance'
    || pathname === '/api/preview/applied'
    || pathname === '/api/preview/cell'
    || pathname === '/api/preview/cell/bootstrap'
    || pathname === '/api/preview/cell/instance'
    || pathname === '/api/preview/cell/reconfigure'
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
  handleRequest: handleRequestForTesting,
  handleTestRequest,
  initializeEventSocket,
  managerRequestPath,
  originAuthorization,
  previewOriginPath,
  requestAllowed,
  serverOrigin,
  studioClientHtml,
  studioSessionRoute,
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
      const response = await fetch('/studio-dev/revision', { cache: 'no-store' })
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

function broadcast(
  clients: Set<StudioSocket>,
  event: StudioSessionEvent | (StudioServerInvalidation & { type: 'data-invalidated' }),
): void {
  const payload = JSON.stringify(event)
  for (const client of clients) {
    client.send(payload)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
