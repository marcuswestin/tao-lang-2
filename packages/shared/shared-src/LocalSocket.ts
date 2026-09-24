import { createConnection } from 'node:net'
import { Errors } from './core/shared-core'

const MAX_MESSAGE_BYTES = 256 * 1024

type LocalSocketEndpoint = string | { host: string; port: number }

/** request sends one JSON value and reads one JSON response from a Unix-domain socket. */
export async function request<ResponseT>(
  endpoint: LocalSocketEndpoint,
  value: unknown,
  timeoutMs = 2_000,
): Promise<ResponseT> {
  return await new Promise<ResponseT>((resolve, reject) => {
    const socket = typeof endpoint === 'string' ? createConnection(endpoint) : createConnection(endpoint)
    const description = describeEndpoint(endpoint)
    let settled = false
    let source = ''
    const timer = setTimeout(() =>
      finish(
        new Errors.HostEnvironmentError(
          `The local service at ${description} did not answer within ${timeoutMs}ms.`,
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
    socket.once('connect', () => socket.write(`${JSON.stringify(value)}\n`))
    socket.on('data', chunk => {
      source += chunk
      if (Buffer.byteLength(source) > MAX_MESSAGE_BYTES) {
        finish(new Errors.HostEnvironmentError(`The local service at ${description} returned an oversized response.`))
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
          new Errors.HostEnvironmentError(`The local service at ${description} returned invalid JSON.`, {
            cause: Errors.asError(error),
          }),
        )
      }
    })
    socket.once('end', () => {
      if (!settled) {
        finish(new Errors.HostEnvironmentError(`The local service at ${description} closed without a response.`))
      }
    })
  })
}

function describeEndpoint(endpoint: LocalSocketEndpoint): string {
  return typeof endpoint === 'string' ? endpoint : `${endpoint.host}:${endpoint.port}`
}
