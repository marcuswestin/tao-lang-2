import { AppleOnDeviceGenerationProvider, type GenerationProvider } from '@generation'
import { Errors } from '@shared'
import { StudioClientAssets } from './StudioClientAssets'
import { StudioFixtureGeneration } from './StudioFixtureGeneration'
import { StudioHighlight } from './StudioHighlight'
import { StudioLsp, type StudioLspSession } from './StudioLsp'
import { StudioMatrixConflictError } from './StudioMatrixSession'
import {
  type StudioDraftWriteRequest,
  StudioProjectSession,
  type StudioSessionEvent,
  StudioSourceConflictError,
} from './StudioProjectSession'

export type StudioServerOptions = {
  allowedOrigins?: readonly string[]
  compileOnStart?: boolean
  generationProvider?: GenerationProvider
  hostname?: string
  port?: number
  previewUrl?: string
}

export type StartedStudioServer = {
  hostname: string
  port: number
  stop: () => void
  url: string
}

type StudioSocketData =
  | { kind: 'events' }
  | { kind: 'lsp'; session?: StudioLspSession }

type StudioSocket = Bun.ServerWebSocket<StudioSocketData>

/** startStudioServer exposes one StudioProjectSession over HTTP and raw WebSockets. */
export async function startStudioServer(
  session: StudioProjectSession,
  options: StudioServerOptions = {},
): Promise<StartedStudioServer> {
  if (options.compileOnStart !== false) {
    await session.compileInitial()
  }

  const fixtureGeneration = new StudioFixtureGeneration(
    options.generationProvider ?? new AppleOnDeviceGenerationProvider(),
  )

  const eventClients = new Set<StudioSocket>()
  const server = Bun.serve<StudioSocketData>({
    fetch: async (request, bunServer) => {
      const url = new URL(request.url)
      const boundOrigin = serverOrigin(
        url.protocol,
        bunServer.hostname ?? options.hostname ?? '127.0.0.1',
        bunServer.port ?? options.port ?? 0,
      )
      if (!requestAllowed(request, url, boundOrigin, options.allowedOrigins)) {
        return forbiddenResponse('Studio host or origin is not allowed.')
      }
      if (request.method === 'OPTIONS') {
        return response(request, url, options, null, 204)
      }
      if (url.pathname === '/events' || url.pathname === '/api/language/lsp') {
        const upgraded = bunServer.upgrade(request, {
          data: { kind: url.pathname === '/events' ? 'events' : 'lsp' },
        })
        return upgraded ? undefined : response(request, url, options, { error: 'WebSocket upgrade failed.' }, 400)
      }
      try {
        return await handleRequest(session, fixtureGeneration, request, url, options)
      } catch (error) {
        return errorResponse(request, url, options, error)
      }
    },
    hostname: options.hostname ?? '127.0.0.1',
    port: options.port ?? 0,
    websocket: {
      close(socket) {
        if (socket.data.kind === 'events') {
          eventClients.delete(socket)
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
        if (socket.data.kind === 'events') {
          eventClients.add(socket)
          void session.handshake().then(handshake => socket.send(JSON.stringify(handshake)))
        } else {
          socket.data.session = StudioLsp.createSession(session.projectRoot, socket)
        }
      },
    },
  })
  const unsubscribe = session.subscribe(event => broadcast(eventClients, event))
  const hostname = server.hostname ?? options.hostname ?? '127.0.0.1'
  const port = server.port ?? options.port ?? 0
  const url = `http://${hostname.includes(':') ? `[${hostname}]` : hostname}:${port}`
  return {
    hostname,
    port,
    stop() {
      unsubscribe()
      for (const client of eventClients) {
        client.close(1001, 'Studio server stopped')
      }
      eventClients.clear()
      server.stop(true)
    },
    url,
  }
}

async function handleRequest(
  session: StudioProjectSession,
  fixtureGeneration: StudioFixtureGeneration,
  request: Request,
  url: URL,
  options: StudioServerOptions,
): Promise<Response> {
  if (request.method === 'GET' && url.pathname === '/') {
    return htmlResponse(StudioClientAssets.html({ previewUrl: options.previewUrl }))
  }
  if (request.method === 'GET' && url.pathname === '/studio.js') {
    return javascriptResponse(await StudioClientAssets.bundle())
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
  if (request.method === 'POST' && url.pathname === '/api/file/draft') {
    return response(request, url, options, await session.syncDraft(draftWriteRequest(await request.json())))
  }
  if (request.method === 'POST' && url.pathname === '/api/language/highlight') {
    return response(request, url, options, await StudioHighlight.highlight(await request.json()))
  }
  if (request.method === 'POST' && url.pathname === '/api/source-action') {
    return response(request, url, options, await session.applySourceAction(await request.json()))
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

function htmlResponse(html: string): Response {
  return new Response(html, {
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

function serverOrigin(protocol: string, hostname: string, port: number): string {
  const host = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname
  return `${protocol}//${host}:${port}`
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
  handleRequest,
  requestAllowed,
  serverOrigin,
} as const

function broadcast(clients: Set<StudioSocket>, event: StudioSessionEvent): void {
  const payload = JSON.stringify(event)
  for (const client of clients) {
    client.send(payload)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
