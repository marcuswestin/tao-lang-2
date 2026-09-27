import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import net from 'node:net'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const executable = process.argv[2]
assert(executable, 'Usage: node run.mjs /absolute/path/to/proxy-client')
const certificatePath = fileURLToPath(new URL('origin-cert.pem', import.meta.url))
const cert = await readFile(certificatePath)
const key = await readFile(new URL('origin-key.pem', import.meta.url))
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })

async function check({ name, trust = 'trusted', host = 'origin.test', mode = 'tls', success = false }) {
  const sockets = new Set()
  const traffic = { connects: 0, plaintext: 0, clientHellos: 0, requests: 0, tlsConnections: 0 }
  const violations = []
  const track = (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => {}) // Rejected handshakes deliberately reset sockets.
    socket.setTimeout(30_000, () => socket.destroy())
    return socket
  }
  const origin = mode === 'broken-tls'
    ? net.createServer((socket) => {
      track(socket).once('data', () => socket.end('This is not a TLS response\r\n'))
    })
    : tls.createServer({ key, cert }, (socket) => {
      track(socket)
      traffic.tlsConnections++
      let pending = ''
      socket.on('data', (chunk) => {
        pending += chunk.toString('ascii')
        let boundary
        while ((boundary = pending.indexOf('\r\n\r\n')) >= 0) {
          const header = pending.slice(0, boundary)
          pending = pending.slice(boundary + 4)
          if (!header.startsWith('GET /probe HTTP/1.1\r\n')) {
            violations.push(header)
          }
          traffic.requests++
          socket.write('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok')
        }
      })
    })
  origin.on('connection', track)
  origin.on('tlsClientError', () => {})
  let proxy
  try {
    const originPort = await listen(origin)
    proxy = net.createServer((socket) => {
      track(socket)
      let pending = Buffer.alloc(0)
      const receiveHead = (chunk) => {
        pending = Buffer.concat([pending, chunk])
        const boundary = pending.indexOf('\r\n\r\n')
        if (boundary < 0) {
          return
        }
        socket.off('data', receiveHead)
        const header = pending.subarray(0, boundary).toString('ascii')
        if (!header.startsWith(`CONNECT ${host}:${originPort} HTTP/1.1\r\n`)) {
          traffic.plaintext++
          socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok')
          return
        }
        traffic.connects++
        if (mode === 'reject-connect') {
          socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
          return
        }
        const destination = track(net.connect(originPort, '127.0.0.1'))
        let first = true
        const forward = (bytes) => {
          if (first) {
            first = false
            if (bytes[0] === 0x16) {
              traffic.clientHellos++
            } else {
              traffic.plaintext++
            }
          }
          destination.write(bytes)
        }
        destination.once('connect', () => {
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
          socket.on('data', forward)
          destination.pipe(socket)
          socket.once('end', () => destination.end())
          socket.once('close', () => destination.destroy())
          const remaining = pending.subarray(boundary + 4)
          if (remaining.length) {
            forward(remaining)
          }
        })
      }
      socket.on('data', receiveHead)
    })
    const proxyPort = await listen(proxy)
    const result = await run(executable, [
      String(proxyPort),
      `https://${host}:${originPort}/probe`,
      certificatePath,
      trust,
      success ? 'success' : 'failure',
    ], { timeout: 60_000, maxBuffer: 64 * 1024 })
    assert.equal(result.stderr, '', `${name}: unexpected client diagnostics`)
    assert.deepEqual(violations, [], `${name}: unexpected origin HTTP request`)
    assert.equal(traffic.plaintext, 0, `${name}: plaintext sent on an HTTPS route`)
    assert.equal(traffic.connects, mode === 'reject-connect' || success ? 1 : 2, name)
    assert.equal(traffic.clientHellos, mode === 'reject-connect' ? 0 : traffic.connects, name)
    assert.equal(traffic.requests, success ? 2 : 0, `${name}: wrong number of encrypted GETs`)
    if (success) {
      assert.equal(traffic.tlsConnections, 1, `${name}: TLS connection not reused`)
    }
    console.log(`PASS ${name}`)
  } finally {
    for (const socket of sockets) {
      socket.destroy()
    }
    await Promise.all(
      [origin, proxy].filter((server) => server?.listening).map(
        (server) => new Promise((resolve) => server.close(resolve)),
      ),
    )
  }
}

await check({ name: 'trusted origin and pooled reuse', success: true })
await check({ name: 'untrusted origin rejected', trust: 'untrusted' })
await check({ name: 'trusted certificate with wrong hostname rejected', host: 'wrong.test' })
await check({ name: 'CONNECT rejection cannot fall back to plaintext', mode: 'reject-connect' })
await check({ name: 'failed TLS sends no GET', mode: 'broken-tls' })
