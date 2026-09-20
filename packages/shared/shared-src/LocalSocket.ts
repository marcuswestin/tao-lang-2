import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { Errors } from './core/shared-core'

const MAX_MESSAGE_BYTES = 256 * 1024

/** LocalSocketServer is a newline-delimited JSON server bound to one Unix-domain socket. */
type LocalSocketServer = {
  close: () => Promise<void>
}

/** request sends one JSON value and reads one JSON response from a Unix-domain socket. */
export async function request<ResponseT>(
  socketPath: string,
  value: unknown,
  timeoutMs = 2_000,
): Promise<ResponseT> {
  return await new Promise<ResponseT>((resolve, reject) => {
    const socket = createConnection(socketPath)
    let settled = false
    let source = ''
    const timer = setTimeout(() =>
      finish(
        new Errors.HostEnvironmentError(
          `The local service at ${socketPath} did not answer within ${timeoutMs}ms.`,
        ),
      ), timeoutMs)

    const finish = (error?: Error, response?: ResponseT) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error !== undefined) {
        reject(error)
      } else {
        resolve(response as ResponseT)
      }
    }

    socket.setEncoding('utf8')
    socket.once('error', error => finish(Errors.asError(error)))
    socket.once('connect', () => socket.end(`${JSON.stringify(value)}\n`))
    socket.on('data', chunk => {
      source += chunk
      if (Buffer.byteLength(source) > MAX_MESSAGE_BYTES) {
        finish(new Errors.HostEnvironmentError(`The local service at ${socketPath} returned an oversized response.`))
        return
      }
      const newline = source.indexOf('\n')
      if (newline < 0) {
        return
      }
      try {
        finish(undefined, JSON.parse(source.slice(0, newline)) as ResponseT)
      } catch (error) {
        finish(
          new Errors.HostEnvironmentError(`The local service at ${socketPath} returned invalid JSON.`, {
            cause: Errors.asError(error),
          }),
        )
      }
    })
    socket.once('end', () => {
      if (!settled) {
        finish(new Errors.HostEnvironmentError(`The local service at ${socketPath} closed without a response.`))
      }
    })
  })
}

/** serve accepts one newline-delimited JSON request per connection and writes one response. */
export async function serve<RequestT, ResponseT>(
  socketPath: string,
  handle: (request: RequestT) => Promise<ResponseT>,
): Promise<LocalSocketServer> {
  const server = createServer(socket => handleSocket(socket, handle))
  await new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => reject(error)
    server.once('error', fail)
    server.listen(socketPath, () => {
      server.off('error', fail)
      resolve()
    })
  })
  return { close: async () => await closeServer(server) }
}

function handleSocket<RequestT, ResponseT>(
  socket: Socket,
  handle: (request: RequestT) => Promise<ResponseT>,
): void {
  socket.setEncoding('utf8')
  let source = ''
  let handled = false
  socket.on('data', chunk => {
    if (handled) {
      return
    }
    source += chunk
    if (Buffer.byteLength(source) > MAX_MESSAGE_BYTES) {
      handled = true
      socket.end(`${JSON.stringify({ error: 'Request is too large.', ok: false })}\n`)
      return
    }
    const newline = source.indexOf('\n')
    if (newline < 0) {
      return
    }
    handled = true
    let request: RequestT
    try {
      request = JSON.parse(source.slice(0, newline)) as RequestT
    } catch {
      socket.end(`${JSON.stringify({ error: 'Request is not valid JSON.', ok: false })}\n`)
      return
    }
    void handle(request).then(
      response => socket.end(`${JSON.stringify(response)}\n`),
      error => socket.end(`${JSON.stringify({ error: Errors.asError(error).message, ok: false })}\n`),
    )
  })
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
}
