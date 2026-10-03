import { Errors, FS, Platform, TaoHome } from '@shared'

type AgentManifest = Readonly<{ protocolVersion: 1; appId: string; appName: string; buildId: string }>
type AgentSession = AgentManifest & {
  capability: string
  instanceId: string
  launcherPid: number
  pid: number
  url: string
}
type AgentRequest = { version: 1; id: string; method: string; params?: unknown }
export type AgentReply = { ok: true; result: unknown } | {
  ok: false
  error: { code: string; message: string; details?: unknown }
}
export type AgentRenderer = {
  status(): 'absent' | 'starting' | 'ready' | 'failed'
  request(method: 'commands' | 'run', params: unknown): Promise<AgentReply>
  drain(): Promise<void>
}

/** The packaged app owns this endpoint and its store; the CLI only sends requests. */
export async function startDesktopAgentHost(options: {
  manifest: AgentManifest
  siteRoot?: string
  renderer?: AgentRenderer
  shutdown(): Promise<void> | void
}): Promise<{
  origin: string
  close(): Promise<void>
  environmentError(message: string): Error
  reportError(error: unknown): void
}> {
  const { manifest } = options
  if (!/^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/u.test(manifest.appId)) {
    Errors.throwUserInput('The app has an invalid background service identifier.')
  }
  const baseRoot = Platform.runtimeProcess.env['TAO_AGENT_STATE_ROOT']
  const stateRoot = baseRoot === undefined
    ? await TaoHome.prepareAgentState(manifest.appId)
    : FS.resolvePath(manifest.appId, baseRoot)
  await FS.mkdir(stateRoot)
  await FS.chmod(stateRoot, 0o700)
  const sessionPath = FS.resolvePath('session.json', stateRoot)
  const originPath = FS.resolvePath('origin.json', stateRoot)
  const instanceId = Platform.randomUUID()
  let closing = false
  let closed = false
  let draining = false
  const active = new Set<Promise<AgentReply>>()
  let server: ReturnType<typeof Bun.serve>
  let session: AgentSession
  const removeSignalListeners: (() => void)[] = []

  async function atomicJson(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${instanceId}.tmp`
    try {
      await FS.writeJson(temporary, value, { mode: 0o600 })
      await FS.move(temporary, path)
    } finally {
      await FS.remove(temporary)
    }
  }

  async function close(): Promise<void> {
    if (closed) {
      return
    }
    closed = true
    closing = true
    for (const remove of removeSignalListeners) {
      remove()
    }
    await FS.withFileMutationLock(sessionPath, stateRoot, async () => {
      const current = await readSession(sessionPath)
      if (current?.instanceId === instanceId) {
        await FS.remove(sessionPath)
      }
      server.stop(true)
    })
  }

  function reply(id: string, result: unknown): Response {
    return Response.json({ version: 1, id, ok: true, result })
  }

  function failure(id: string, code: string, message: string, status = 400): Response {
    return Response.json({ version: 1, id, ok: false, error: { code, message } }, { status })
  }

  async function control(request: Request): Promise<Response> {
    if (
      request.headers.has('origin') || !Platform.secretsEqual(
        request.headers.get('authorization') ?? '',
        `Bearer ${session.capability}`,
      )
    ) {
      return failure('', 'unauthorized', 'This request does not have the app session capability.', 403)
    }
    let value: unknown
    try {
      value = await request.json()
    } catch {
      return failure('', 'invalid_request', 'The request must be JSON.')
    }
    if (!isRequest(value)) {
      return failure('', 'invalid_request', 'Expected a versioned request with an id and method.')
    }
    if (value.version !== 1) {
      return failure(value.id, 'protocol_mismatch', 'The app requires protocol version 1.')
    }
    if (closing) {
      return failure(value.id, 'shutting_down', 'The app is shutting down.', 409)
    }
    const handlers: Record<string, () => Response | Promise<Response>> = {
      ping: () =>
        reply(value.id, {
          message: 'pong',
          appId: manifest.appId,
          buildId: manifest.buildId,
          instanceId,
          pid: session.pid,
          launcherPid: session.launcherPid,
          renderer: options.renderer?.status() ?? 'absent',
        }),
      commands: () => rendererRequest(value, 'commands'),
      run: () => rendererRequest(value, 'run'),
      shutdown: async () => {
        if (draining) {
          return failure(value.id, 'busy', 'A shutdown request is already waiting for the app.', 409)
        }
        draining = true
        try {
          await deadline(
            (async () => {
              await Promise.allSettled([...active])
              await options.renderer?.drain()
            })(),
            5_000,
          )
        } catch {
          draining = false
          return failure(value.id, 'busy', 'Execution or persistence has not settled; the app remains running.', 409)
        }
        closing = true
        // Allow the HTTP response to leave before retiring the listener and app process.
        setTimeout(() =>
          void close().then(options.shutdown).catch(error => {
            Platform.runtimeConsole.error(Errors.messageOf(error))
            Platform.runtimeProcess.setExitCode(1)
          }), 100)
        return reply(value.id, { status: 'stopping', instanceId })
      },
    }
    return Object.hasOwn(handlers, value.method)
      ? await handlers[value.method]!()
      : failure(value.id, 'unknown_method', `Unknown app method '${value.method}'.`)
  }

  async function rendererRequest(value: AgentRequest, method: 'commands' | 'run'): Promise<Response> {
    if (draining) {
      return failure(value.id, 'busy', 'The app is waiting for execution and persistence before shutdown.', 409)
    }
    if (!options.renderer) {
      return failure(value.id, 'app_unavailable', 'This app has no command renderer.', 503)
    }
    const request = options.renderer.request(method, value.params)
    active.add(request)
    try {
      const response = await request
      if (response.ok) {
        return reply(value.id, response.result)
      }
      return Response.json({ version: 1, id: value.id, ...response }, { status: 400 })
    } catch (error) {
      return failure(value.id, method === 'run' ? 'outcome_unknown' : 'app_unavailable', Errors.messageOf(error), 503)
    } finally {
      active.delete(request)
    }
  }

  await FS.withFileMutationLock(sessionPath, stateRoot, async () => {
    const previous = await readSession(sessionPath)
    if (previous && Platform.processIsAlive(previous.pid)) {
      Errors.throwHostEnvironment('This app already has a running instance; stop it before launching another build.')
    }
    let port = 0
    if (await FS.exists(originPath)) {
      const origin = await FS.readJson<{ port: number }>(originPath)
      if (!Number.isInteger(origin.port) || origin.port < 1 || origin.port > 65535) {
        Errors.throwHostEnvironment('The saved desktop app origin has an invalid port.')
      }
      port = origin.port
    }
    server = Bun.serve({
      hostname: '127.0.0.1',
      port,
      maxRequestBodySize: 64 * 1024,
      idleTimeout: 255,
      fetch: async request => {
        const url = new URL(request.url)
        if (url.hostname !== '127.0.0.1') {
          return new Response('Invalid host', { status: 403 })
        }
        if (url.pathname === '/tao-agent') {
          return request.method === 'POST' ? await control(request) : new Response('POST required', { status: 405 })
        }
        return await staticResponse(request, options.siteRoot)
      },
    })
    const origin = `http://127.0.0.1:${server.port}`
    session = {
      ...manifest,
      instanceId,
      pid: Platform.runtimeProcess.pid,
      launcherPid: Number(Platform.runtimeProcess.env['ELECTROBUN_LAUNCHER_PID'] ?? Platform.runtimeProcess.pid),
      url: `${origin}/tao-agent`,
      capability: Platform.randomUUID() + Platform.randomUUID(),
    }
    try {
      await atomicJson(originPath, { port: server.port })
      await atomicJson(sessionPath, session)
    } catch (error) {
      server.stop(true)
      throw error
    }
  })
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    removeSignalListeners.push(
      Platform.onProcessSignal(signal, () =>
        void close().then(options.shutdown).catch(error => {
          Platform.runtimeConsole.error(Errors.messageOf(error))
          Platform.runtimeProcess.setExitCode(1)
        })),
    )
  }
  return {
    origin: new URL(session!.url).origin,
    close,
    // The generated shell uses the same error and output policy as the bundled host.
    environmentError: message => new Errors.HostEnvironmentError(message),
    reportError: error => Platform.runtimeConsole.error(Errors.messageOf(error)),
  }
}

async function deadline<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Errors.HostEnvironmentError('The app did not settle before the shutdown deadline.')),
          milliseconds,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}

async function readSession(path: string): Promise<AgentSession | undefined> {
  if (!await FS.exists(path)) {
    return undefined
  }
  const value = await FS.readJson<AgentSession>(path)
  if (!Number.isInteger(value.pid) || value.pid < 1 || typeof value.instanceId !== 'string') {
    Errors.throwHostEnvironment('The app session record is invalid; refusing to replace an unknown owner.')
  }
  return value
}

function isRequest(value: unknown): value is AgentRequest {
  return typeof value === 'object' && value !== null
    && 'version' in value && typeof value.version === 'number'
    && 'id' in value && typeof value.id === 'string' && value.id.length > 0
    && 'method' in value && typeof value.method === 'string'
}

async function staticResponse(request: Request, root?: string): Promise<Response> {
  if (root === undefined || request.method !== 'GET') {
    return new Response('Not found', { status: 404 })
  }
  let path: string
  try {
    path = decodeURIComponent(new URL(request.url).pathname)
  } catch {
    return new Response('Bad path', { status: 400 })
  }
  if (path.includes('\0') || path.split('/').includes('..')) {
    return new Response('Bad path', { status: 400 })
  }
  if (path.endsWith('/')) {
    path += 'index.html'
  }
  const filePath = FS.resolvePath(`.${path}`, root)
  if (!FS.pathIsWithin(filePath, root)) {
    return new Response('Bad path', { status: 400 })
  }
  const candidate = Bun.file(filePath)
  if (await candidate.exists()) {
    return new Response(candidate)
  }
  const fallback = Bun.file(FS.resolvePath('index.html', root))
  return await fallback.exists() ? new Response(fallback) : new Response('Not found', { status: 404 })
}
