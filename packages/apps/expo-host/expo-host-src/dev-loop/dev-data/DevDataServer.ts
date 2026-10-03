import { CLI, Errors, FS, Json, Platform, ProjectLocal, Time } from '@shared'
import { devDataAppKey, DevDataProtocol, devDataSafeAppName } from './DevDataBootstrap'

/** The capability-authenticated, filesystem-serialized authority behind the `Dev` datasource. */
export type DevDataServerOptions = {
  capability?: string
  hostname?: string
  legacyRootDirs?: readonly string[]
  log?: (line: string) => void
  port?: number
  rootDir: string
}

type ClientMessage =
  | { expectedRevision: number; seq: number; snapshot: string; type: 'save' }
  | { expectedRevision: number; seq: number; type: 'reset' }
  | { seq: number; type: 'load' }
type ServerMessage =
  | { revision: number; snapshot: string | null; type: 'snapshot' }
  | { revision: number; seq: number; type: 'ack' }
  | { message: string; seq: number; type: 'rejected' }
type SocketData = { app: string; key: string; topic: string }
type Socket = Bun.ServerWebSocket<SocketData>
type DurableStream = { revision: number; snapshot: string | undefined }
type Stream = DurableStream & { data: SocketData; queue: Promise<unknown> }
type ProjectStorage = { dataDir: string; lockDir: string; temporaryDir: string }

const appNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const capabilityPattern = /^[A-Za-z0-9_-]{32,256}$/
const maxSnapshotBytes = 64 * 1024 * 1024
const externalRefreshMs = 100
const lockWaitMs = 5_000
const stateFormat = 'tao-dev-data-state-v1'

export class DevDataServer {
  readonly capability: string
  readonly port: number
  readonly rootDir: string
  readonly #log: (line: string) => void
  readonly #legacyRootDirs: readonly string[]
  readonly #server: Bun.Server<SocketData>
  readonly #streams = new Map<string, Stream>()
  readonly #projects = new Map<string, ProjectStorage>()
  readonly #refreshTimer: ReturnType<typeof setInterval>

  private constructor(options: DevDataServerOptions) {
    this.rootDir = options.rootDir
    this.#legacyRootDirs = [options.rootDir, ...(options.legacyRootDirs ?? [])]
    this.capability = options.capability
      ?? `${Platform.randomUUID().replaceAll('-', '')}${Platform.randomUUID().replaceAll('-', '')}`
    if (!capabilityPattern.test(this.capability)) {
      Errors.throwUnexpected('The dev data authority capability is malformed.')
    }
    this.#log = options.log ?? (() => {})
    this.#server = Bun.serve<SocketData>({
      fetch: (request, server) => this.#fetch(request, server),
      hostname: options.hostname ?? '0.0.0.0',
      port: options.port ?? 0,
      websocket: {
        close: socket => {
          socket.unsubscribe(socket.data.topic)
        },
        maxPayloadLength: maxSnapshotBytes,
        message: (socket, message) => this.#message(socket, message),
        open: socket => this.#open(socket),
      },
    })
    this.port = this.#server.port ?? options.port ?? 0
    this.#refreshTimer = setInterval(() => {
      void this.#refreshExternalChanges().catch(error => {
        this.#log(`external refresh failed: ${Errors.formatForLog(error)}`)
      })
    }, externalRefreshMs)
  }

  static async start(options: DevDataServerOptions): Promise<DevDataServer> {
    await FS.mkdir(options.rootDir)
    return new DevDataServer(options)
  }

  /** Register an app before publishing its manifest; its files then stay in that project's .tao. */
  async registerProject(projectRoot: string, appName: string): Promise<string> {
    await ProjectLocal.prepare(projectRoot)
    const app = devDataAppKey(projectRoot, appName)
    const safeName = devDataSafeAppName(appName)
    const storage = {
      dataDir: ProjectLocal.localResolve(`dev-data/${safeName}`, projectRoot),
      lockDir: ProjectLocal.cacheResolve(`dev-data/locks/${safeName}`, projectRoot),
      temporaryDir: ProjectLocal.cacheResolve(`dev-data/tmp/${safeName}`, projectRoot),
    }
    await Promise.all([FS.mkdir(storage.dataDir), FS.mkdir(storage.lockDir), FS.mkdir(storage.temporaryDir)])
    await this.#migrateLegacyApp(app, storage)
    this.#projects.set(app, storage)
    return app
  }

  async #migrateLegacyApp(app: string, storage: ProjectStorage): Promise<void> {
    for (const root of this.#legacyRootDirs) {
      const oldAppDir = FS.resolvePath(app, root)
      if (!await FS.isDirectory(oldAppDir) || await FS.isSymbolicLink(oldAppDir)) {
        continue
      }
      for (const entry of await FS.listDir(oldAppDir)) {
        if (!entry.endsWith('.json') || entry === '.json') {
          continue
        }
        const source = FS.resolvePath(entry, oldAppDir)
        if (!await FS.isFile(source) || await FS.isSymbolicLink(source)) {
          continue
        }
        const destination = FS.resolvePath(entry, storage.dataDir)
        const destinationLock = FS.resolvePath(`${entry}.lock`, storage.lockDir)
        const sourceLock = `${source}.lock`
        await withFileLock(destinationLock, async () => {
          await withFileLock(sourceLock, async () => {
            if (
              await FS.isFile(source) && !await FS.isSymbolicLink(source)
              && !await FS.exists(destination) && !await FS.isSymbolicLink(destination)
            ) {
              await FS.move(source, destination)
            }
          })
        })
      }
    }
  }

  async stop(): Promise<void> {
    clearInterval(this.#refreshTimer)
    await this.#server.stop(true)
    await Promise.all([...this.#streams.values()].map(stream => stream.queue.catch(() => undefined)))
  }

  #fetch(request: Request, server: Bun.Server<SocketData>): Response | undefined {
    const url = new URL(request.url)
    if (url.pathname === DevDataProtocol.probePath && request.method === 'GET') {
      return this.#authorized(request, url)
        ? jsonResponse({ protocol: DevDataProtocol.name })
        : jsonResponse({ error: 'Unauthorized.' }, 401)
    }
    if (url.pathname === DevDataProtocol.path) {
      if (!this.#authorized(request, url)) {
        return jsonResponse({ error: 'Unauthorized.' }, 401)
      }
      const app = url.searchParams.get('app') ?? ''
      const key = url.searchParams.get('key') ?? ''
      if (!appNamePattern.test(app)) {
        return jsonResponse({ error: `Expected an app key matching ${appNamePattern.source}.` }, 400)
      }
      if (key === '' || key === '.' || key === '..' || key.length > 256) {
        return jsonResponse({ error: 'Expected a storage key.' }, 400)
      }
      const data: SocketData = { app, key, topic: `${app}/${encodeURIComponent(key)}` }
      return server.upgrade(request, { data })
        ? undefined
        : jsonResponse({ error: 'Expected a WebSocket upgrade.' }, 426)
    }
    return jsonResponse({ error: 'Not found.' }, 404)
  }

  #authorized(request: Request, url: URL): boolean {
    return url.searchParams.get('capability') === this.capability
      || request.headers.get('authorization') === `Bearer ${this.capability}`
  }

  #open(socket: Socket): void {
    socket.subscribe(socket.data.topic)
    void this.#enqueue(socket.data, async stream => {
      await this.#refresh(stream)
      send(socket, snapshotMessage(stream))
    })
  }

  #message(socket: Socket, raw: string | Buffer): void {
    const message = parseClientMessage(raw)
    if (message === undefined) {
      socket.close(1003, 'Expected a tao-dev-data-v1 message.')
      return
    }
    void this.#enqueue(socket.data, async stream => {
      try {
        if (message.type === 'load') {
          await this.#refresh(stream)
          send(socket, snapshotMessage(stream))
          send(socket, { revision: stream.revision, seq: message.seq, type: 'ack' })
          return
        }
        const durable = await this.#transact(
          socket.data,
          message.expectedRevision,
          message.type === 'save' ? message.snapshot : undefined,
        )
        stream.revision = durable.revision
        stream.snapshot = durable.snapshot
        this.#publish(stream)
        send(socket, { revision: stream.revision, seq: message.seq, type: 'ack' })
        this.#log(`${socket.data.app} ${socket.data.key}: ${message.type} r${stream.revision}`)
      } catch (error) {
        await this.#refresh(stream)
        send(socket, snapshotMessage(stream))
        send(socket, { message: Errors.formatForUser(error), seq: message.seq, type: 'rejected' })
        this.#log(`${socket.data.app} ${socket.data.key}: ${message.type} failed: ${Errors.formatForLog(error)}`)
      }
    })
  }

  #enqueue(data: SocketData, work: (stream: Stream) => Promise<void>): Promise<void> {
    let stream = this.#streams.get(data.topic)
    if (stream === undefined) {
      stream = { data, queue: Promise.resolve(), revision: -1, snapshot: undefined }
      this.#streams.set(data.topic, stream)
    }
    const current = stream
    const run = current.queue.then(() => work(current), () => work(current))
    const settled = run.catch(error => this.#log(`${data.app} ${data.key}: ${Errors.formatForLog(error)}`))
    current.queue = settled
    return settled
  }

  async #refreshExternalChanges(): Promise<void> {
    await Promise.all([...this.#streams.values()].map(stream =>
      this.#enqueue(stream.data, async current => {
        const before = current.revision
        await this.#refresh(current)
        if (current.revision !== before) {
          this.#publish(current)
        }
      })
    ))
  }

  async #refresh(stream: Stream): Promise<void> {
    const durable = await withFileLock(this.#lockPath(stream.data), () => this.#read(stream.data))
    stream.revision = durable.revision
    stream.snapshot = durable.snapshot
  }

  async #transact(data: SocketData, expectedRevision: number, snapshot: string | undefined): Promise<DurableStream> {
    return await withFileLock(this.#lockPath(data), async () => {
      const current = await this.#read(data)
      if (current.revision !== expectedRevision) {
        Errors.throwHostEnvironment(
          `Dev data changed concurrently (expected revision ${expectedRevision}, found ${current.revision}); reload and retry.`,
        )
      }
      const next = { revision: current.revision + 1, snapshot }
      await writeAtomically(
        this.#pathFor(data),
        this.#temporaryPath(data),
        JSON.stringify({
          format: stateFormat,
          revision: next.revision,
          snapshot: next.snapshot ?? null,
        }),
      )
      return next
    })
  }

  async #read(data: SocketData): Promise<DurableStream> {
    const path = this.#pathFor(data)
    if (!await FS.isFile(path)) {
      return { revision: 0, snapshot: undefined }
    }
    const content = await FS.readText(path)
    let parsed: { format?: unknown; revision?: unknown; snapshot?: unknown }
    try {
      parsed = JSON.parse(content) as { format?: unknown; revision?: unknown; snapshot?: unknown }
    } catch {
      Errors.throwHostEnvironment(`Dev data authority state is invalid: ${FS.displayPath(path)}.`)
    }
    if (parsed.format !== stateFormat) {
      // tao-dev-data-v1 originally persisted snapshot bytes directly. The first mutation migrates
      // that legacy record into the explicitly tagged authority envelope atomically. Checking the
      // tag, rather than field names such as `revision`, keeps arbitrary app JSON unambiguous.
      return { revision: 1, snapshot: content }
    }
    if (
      !Number.isSafeInteger(parsed.revision) || (parsed.revision as number) < 0
      || !(typeof parsed.snapshot === 'string' || parsed.snapshot === null)
    ) {
      Errors.throwHostEnvironment(`Dev data authority state is invalid: ${FS.displayPath(path)}.`)
    }
    return { revision: parsed.revision as number, snapshot: parsed.snapshot ?? undefined }
  }

  #publish(stream: Stream): void {
    this.#server.publish(stream.data.topic, JSON.stringify(snapshotMessage(stream)))
  }

  #pathFor(data: SocketData): string {
    const filename = `${encodeURIComponent(data.key)}.json`
    const project = this.#projects.get(data.app)
    return project === undefined
      ? FS.resolvePath(`${data.app}/${filename}`, this.rootDir)
      : FS.resolvePath(filename, project.dataDir)
  }

  #lockPath(data: SocketData): string {
    const project = this.#projects.get(data.app)
    return project === undefined
      ? `${this.#pathFor(data)}.lock`
      : FS.resolvePath(`${encodeURIComponent(data.key)}.json.lock`, project.lockDir)
  }

  #temporaryPath(data: SocketData): string {
    const project = this.#projects.get(data.app)
    const filename = `${encodeURIComponent(data.key)}.json.${Platform.randomUUID()}.tmp`
    return project === undefined
      ? FS.resolvePath(filename, FS.dirname(this.#pathFor(data)))
      : FS.resolvePath(filename, project.temporaryDir)
  }
}

async function withFileLock<Value>(lockPath: string, work: () => Promise<Value>): Promise<Value> {
  const ownerFile = `${lockPath}.owner-${Platform.randomUUID()}`
  await FS.writeJson(ownerFile, { pid: Platform.runtimeProcess.pid, startedAt: Date.now() }, { mode: 0o600 })
  const ownerPath = await FS.realPath(ownerFile)
  const deadline = Date.now() + lockWaitMs
  try {
    while (true) {
      try {
        await FS.symlink(ownerPath, lockPath)
        break
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') {
          throw error
        }
        await reclaimStaleLock(lockPath)
        if (Date.now() >= deadline) {
          Errors.throwHostEnvironment(`Timed out waiting for the dev data authority lock ${FS.displayPath(lockPath)}.`)
        }
        await Time.sleep(10)
      }
    }
    return await work()
  } finally {
    try {
      if (await lockTarget(lockPath) === ownerPath) {
        await FS.remove(lockPath)
      }
    } catch {
      // A missing lock means this authority is already released; never remove another owner's lock.
    }
    await FS.remove(ownerFile)
  }
}

function errorCode(error: unknown): string | undefined {
  return Json.isRecord(error) && 'code' in error ? String(error['code']) : undefined
}

async function reclaimStaleLock(lockPath: string): Promise<void> {
  const ownerPath = await lockTarget(lockPath)
  if (ownerPath === undefined) {
    return
  }
  if (await FS.isFile(ownerPath)) {
    const owner = await FS.readJson<{ pid?: unknown }>(ownerPath).catch(() => undefined)
    if (owner !== undefined && typeof owner.pid === 'number' && Platform.processIsAlive(owner.pid)) {
      return
    }
  }
  const root = FS.dirname(lockPath)
  const targetKey = FS.basename(ownerPath).replaceAll(/[^a-zA-Z0-9._-]/g, '_')
  const claimPrefix = `.dev-data-reclaim-${targetKey}-`
  const claimPath = FS.resolvePath(
    `${claimPrefix}${String(Date.now()).padStart(16, '0')}-${Platform.runtimeProcess.pid}-${Platform.randomUUID()}`,
    root,
  )
  await FS.writeJson(claimPath, { pid: Platform.runtimeProcess.pid })
  try {
    await Time.sleep(10)
    const claims: string[] = []
    for (const entry of await FS.listDir(root)) {
      if (!entry.startsWith(claimPrefix)) {
        continue
      }
      const path = FS.resolvePath(entry, root)
      const claim = await FS.readJson<{ pid?: unknown }>(path).catch(() => undefined)
      if (claim === undefined || typeof claim.pid !== 'number' || !Platform.processIsAlive(claim.pid)) {
        await FS.remove(path).catch(() => {})
        continue
      }
      claims.push(path)
    }
    if (claims.toSorted()[0] === claimPath && await lockTarget(lockPath) === ownerPath) {
      await FS.remove(lockPath)
      await FS.remove(ownerPath).catch(() => {})
    }
  } finally {
    await FS.remove(claimPath).catch(() => {})
  }
}

/** lockTarget identifies a symlink target even after its owner file vanished. */
async function lockTarget(lockPath: string): Promise<string | undefined> {
  const result = await CLI.run('/usr/bin/readlink', { args: [lockPath], stdio: 'pipe' })
  const target = result.stdout.trim()
  return result.error === undefined && result.exitCode === 0 && target !== ''
    ? FS.resolvePath(target, FS.dirname(lockPath))
    : undefined
}

async function writeAtomically(path: string, temporaryPath: string, content: string): Promise<void> {
  try {
    await FS.writeText(temporaryPath, content)
    await FS.move(temporaryPath, path)
  } finally {
    await FS.remove(temporaryPath)
  }
}

function snapshotMessage(stream: DurableStream): ServerMessage {
  return { revision: stream.revision, snapshot: stream.snapshot ?? null, type: 'snapshot' }
}

function send(socket: Socket, message: ServerMessage): void {
  socket.send(JSON.stringify(message))
}

function parseClientMessage(raw: string | Buffer): ClientMessage | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined
  }
  const record = parsed as Record<string, unknown>
  const seq = record['seq']
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq)) {
    return undefined
  }
  if (record['type'] === 'load') {
    return { seq, type: record['type'] }
  }
  const expectedRevision = record['expectedRevision']
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) {
    return undefined
  }
  if (record['type'] === 'save' && typeof record['snapshot'] === 'string') {
    return { expectedRevision: expectedRevision as number, seq, snapshot: record['snapshot'], type: 'save' }
  }
  if (record['type'] === 'reset') {
    return { expectedRevision: expectedRevision as number, seq, type: record['type'] }
  }
  return undefined
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status })
}
