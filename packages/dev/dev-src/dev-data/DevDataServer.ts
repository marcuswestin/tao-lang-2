import { Errors, FS } from '@shared'
import { DevDataProtocol } from './DevDataBootstrap'

/**
 * The dev data server behind the `Dev` datasource: one WebSocket stream per (app, storage key),
 * holding that stream's latest full snapshot in memory and in one file under the root directory,
 * and pushing every accepted write to every socket on the stream — the writer included, whose
 * runtime recognises its own snapshot. `tao dev` and Studio each host one for their process;
 * storage keyed by app lets several apps develop side by side without touching each other.
 *
 * The wire contract is `tao-dev-data-v1`, defined beside the client in
 * `packages/stdlib/@tao/data/providers/dev/Dev.ts`; this file mirrors its message shapes.
 */

export type DevDataServerOptions = {
  hostname?: string
  log?: (line: string) => void
  port?: number
  /** Where streams persist: `<rootDir>/<app>/<encoded storage key>.json`. */
  rootDir: string
}

type ClientMessage =
  | { seq: number; snapshot: string; type: 'save' }
  | { seq: number; type: 'reset' }
  | { seq: number; type: 'load' }

type ServerMessage =
  | { revision: number; snapshot: string | null; type: 'snapshot' }
  | { revision: number; seq: number; type: 'ack' }
  | { message: string; seq: number; type: 'rejected' }

type SocketData = { app: string; key: string; topic: string }
type Socket = Bun.ServerWebSocket<SocketData>

type Stream = {
  queue: Promise<unknown>
  revision: number
  snapshot: string | undefined
}

const appNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const maxSnapshotBytes = 64 * 1024 * 1024

export class DevDataServer {
  readonly port: number
  readonly rootDir: string
  readonly #log: (line: string) => void
  readonly #server: Bun.Server<SocketData>
  readonly #streams = new Map<string, Stream>()

  private constructor(options: DevDataServerOptions) {
    this.rootDir = options.rootDir
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
  }

  static async start(options: DevDataServerOptions): Promise<DevDataServer> {
    await FS.mkdir(options.rootDir)
    return new DevDataServer(options)
  }

  /**
   * stop cuts every socket and stops; streams stay on disk for the next server. The cut is forced
   * rather than a close handshake: a client that reconnects on close would otherwise keep the
   * handshake, and this stop, waiting on each other.
   */
  async stop(): Promise<void> {
    await this.#server.stop(true)
  }

  #fetch(request: Request, server: Bun.Server<SocketData>): Response | undefined {
    const url = new URL(request.url)
    if (url.pathname === DevDataProtocol.probePath && request.method === 'GET') {
      return jsonResponse({ protocol: DevDataProtocol.name })
    }
    if (url.pathname === DevDataProtocol.path) {
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

  #open(socket: Socket): void {
    socket.subscribe(socket.data.topic)
    void this.#enqueue(socket.data, async stream => {
      send(socket, { revision: stream.revision, snapshot: stream.snapshot ?? null, type: 'snapshot' })
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
          // The answer precedes the ack on this one socket, so the client reads it in order.
          send(socket, { revision: stream.revision, snapshot: stream.snapshot ?? null, type: 'snapshot' })
          send(socket, { revision: stream.revision, seq: message.seq, type: 'ack' })
          return
        }
        if (message.type === 'save') {
          await writeAtomically(this.#pathFor(socket.data), message.snapshot)
          stream.snapshot = message.snapshot
        } else {
          await FS.remove(this.#pathFor(socket.data))
          stream.snapshot = undefined
        }
        stream.revision += 1
        this.#server.publish(
          socket.data.topic,
          JSON.stringify({ revision: stream.revision, snapshot: stream.snapshot ?? null, type: 'snapshot' }),
        )
        send(socket, { revision: stream.revision, seq: message.seq, type: 'ack' })
        this.#log(`${socket.data.app} ${socket.data.key}: ${message.type} r${stream.revision}`)
      } catch (error) {
        send(socket, { message: Errors.formatForUser(error), seq: message.seq, type: 'rejected' })
        this.#log(`${socket.data.app} ${socket.data.key}: ${message.type} failed: ${Errors.formatForLog(error)}`)
      }
    })
  }

  /** enqueue runs one stream's work in order, loading the stream from disk the first time it is named. */
  #enqueue(data: SocketData, work: (stream: Stream) => Promise<void>): Promise<void> {
    let stream = this.#streams.get(data.topic)
    if (stream === undefined) {
      const created: Stream = { queue: Promise.resolve(), revision: 0, snapshot: undefined }
      created.queue = this.#load(data).then(snapshot => {
        created.snapshot = snapshot
        created.revision = 1
      })
      this.#streams.set(data.topic, created)
      stream = created
    }
    const current = stream
    const run = current.queue.then(() => work(current), () => work(current))
    const settled: Promise<void> = run.catch(error => {
      this.#log(`${data.app} ${data.key}: ${Errors.formatForLog(error)}`)
    })
    current.queue = settled
    return settled
  }

  async #load(data: SocketData): Promise<string | undefined> {
    const path = this.#pathFor(data)
    if (!await FS.isFile(path)) {
      return undefined
    }
    try {
      return await FS.readText(path)
    } catch (error) {
      this.#log(`${data.app} ${data.key}: could not read ${path}: ${Errors.formatForLog(error)}`)
      return undefined
    }
  }

  #pathFor(data: SocketData): string {
    return FS.resolvePath(`${data.app}/${encodeURIComponent(data.key)}.json`, this.rootDir)
  }
}

/** writeAtomically lands a snapshot through a rename, so a reader never sees a half-written file. */
async function writeAtomically(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`
  try {
    await FS.writeText(temporaryPath, content)
    await FS.move(temporaryPath, path)
  } finally {
    await FS.remove(temporaryPath)
  }
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
  if (record['type'] === 'save' && typeof record['snapshot'] === 'string') {
    return { seq, snapshot: record['snapshot'], type: 'save' }
  }
  if (record['type'] === 'reset' || record['type'] === 'load') {
    return { seq, type: record['type'] }
  }
  return undefined
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status })
}
