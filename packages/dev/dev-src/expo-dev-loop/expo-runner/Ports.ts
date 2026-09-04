import { CLI, Errors, Time } from '@shared'
import { createServer } from 'node:net'
import { DevLoopTUI } from '../DevLoopTUI'

const RELEASE_TIMEOUT_MS = 5_000
const RELEASE_POLL_MS = 250

/** Listener describes one process listening on a TCP port. */
type Listener = {
  command: string
  name?: string
  pid: number
}

type LsofListenerResult = Pick<CLI.CommandResult, 'error' | 'exitCode' | 'stderr' | 'stdout'>
type PortProbe = (port: number) => Promise<number | undefined>

export type PortReservation = {
  port: number
  release: () => Promise<void>
}

/** Ports groups TCP port inspection and release helpers. */
export const Ports = {
  ensureFree,
  findAvailable,
  formatKillCommand,
  formatListeners,
  formatLsofListeners,
  normalizeReservationError,
  reserveAvailable,
  selectAvailable,
}

/** findAvailable returns the preferred port when possible, then asks the OS for a free port. */
async function findAvailable(preferredPort: number): Promise<number> {
  const reservation = await reserveAvailable(preferredPort)
  await reservation.release()
  return reservation.port
}

/** selectAvailable contains the preferred-then-ephemeral policy independently of TCP probing. */
async function selectAvailable(preferredPort: number, probe: PortProbe): Promise<number> {
  return await probe(preferredPort) ?? await requireEphemeralPort(probe)
}

/** reserveAvailable holds the selected port until its caller is ready to start the owning server. */
async function reserveAvailable(preferredPort: number): Promise<PortReservation> {
  return await reservePort(preferredPort) ?? await requireEphemeralReservation()
}

async function reservePort(port: number): Promise<PortReservation | undefined> {
  return await new Promise<PortReservation | undefined>((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', error => {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        resolve(undefined)
      } else {
        reject(normalizeReservationError(error))
      }
    })
    // Expo checks the wildcard host before starting Metro. Binding only 127.0.0.1 can
    // miss an existing IPv6 wildcard listener and incorrectly select its occupied port.
    server.listen({ exclusive: true, port }, () => {
      const address = server.address()
      const availablePort = typeof address === 'object' && address !== null ? address.port : undefined
      if (availablePort === undefined) {
        server.close(error => error ? reject(error) : resolve(undefined))
        return
      }
      let released = false
      resolve({
        port: availablePort,
        async release() {
          if (released) {
            return
          }
          released = true
          await new Promise<void>((resolveClose, rejectClose) => {
            server.close(error => error ? rejectClose(error) : resolveClose())
          })
        },
      })
    })
  })
}

/** normalizeReservationError explains host policies that prohibit local development servers. */
function normalizeReservationError(error: Error): Error {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EACCES' || code === 'EPERM') {
    return new Errors.UserInputError(
      'This environment does not allow a local development server to bind a TCP port. '
        + 'Run it in a terminal or development environment that permits local TCP listeners.',
    )
  }
  return error
}

async function requireEphemeralReservation(): Promise<PortReservation> {
  const reservation = await reservePort(0)
  if (reservation === undefined) {
    throw new Errors.UserInputError('Could not reserve a free Expo Metro port.')
  }
  return reservation
}

async function requireEphemeralPort(probe: PortProbe): Promise<number> {
  const port = await probe(0)
  if (port === undefined) {
    throw new Errors.UserInputError('Could not allocate a free Expo Metro port.')
  }
  return port
}

/**
 * ensureFree inspects a TCP port and offers to terminate listening processes.
 * Returns `true` when the port is free, `false` when inspection is unavailable,
 * and throws when a listener is found but cannot or should not be terminated.
 */
async function ensureFree(port: number): Promise<boolean> {
  const listeners = await findListeners(port)
  if (listeners === undefined) {
    return false
  }
  if (listeners.length === 0) {
    return true
  }

  DevLoopTUI.logDevLoop('dev', `Port ${port} is already in use by ${formatListeners(listeners)}.`, 'warn')
  const shouldKill = await DevLoopTUI.askConfirm({
    defaultValue: false,
    message: 'Kill it?',
  })
  if (!shouldKill) {
    throw new Errors.UserInputError(
      `Port ${port} is already in use by ${formatListeners(listeners)}. To kill it, run: ${
        formatKillCommand(listeners)
      }`,
    )
  }

  await terminateListeners(listeners)
  await waitForRelease(port)
  DevLoopTUI.logDevLoop('dev', `Port ${port} is free.`)
  return true
}

/** formatLsofListeners reads port listeners from a completed `lsof` invocation. */
function formatLsofListeners(result: LsofListenerResult): Listener[] | undefined {
  const listeners = parseLsofListeners(result.stdout)
  if (listeners.length > 0) {
    return listeners
  }
  if (result.error !== undefined) {
    return undefined
  }
  if (result.exitCode !== 0 && result.stdout.trim() === '' && result.stderr.trim() === '') {
    return []
  }
  if (result.exitCode !== 0) {
    return undefined
  }
  return listeners
}

/** formatListeners formats listening processes for terminal output. */
function formatListeners(listeners: readonly Listener[]): string {
  return listeners.map(formatListener).join(', ')
}

/** formatKillCommand returns the copy-pasteable graceful termination command for listeners. */
function formatKillCommand(listeners: readonly Listener[]): string {
  return `kill -TERM ${listeners.map(listener => listener.pid).join(' ')}`
}

function parseLsofListeners(output: string): Listener[] {
  const listeners: Listener[] = []
  let current: Partial<Listener> = {}
  const flush = () => {
    if (current.pid !== undefined) {
      listeners.push({
        command: current.command ?? 'unknown',
        name: current.name,
        pid: current.pid,
      })
    }
    current = {}
  }

  for (const line of output.split(/\r?\n/)) {
    if (line.length < 2) {
      continue
    }
    const field = line[0]
    const value = line.slice(1)
    if (field === 'p') {
      flush()
      const pid = Number(value)
      current = Number.isInteger(pid) ? { pid } : {}
    } else if (field === 'c') {
      current.command = value
    } else if (field === 'n') {
      current.name ??= value
    }
  }
  flush()

  return dedupeListeners(listeners)
}

async function findListeners(port: number): Promise<Listener[] | undefined> {
  const result = await CLI.run('lsof', {
    args: ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pcn'],
  })
  const listeners = formatLsofListeners(result)

  if (listeners !== undefined) {
    return listeners
  }
  if (result.error !== undefined) {
    DevLoopTUI.logDevLoop('dev', `Could not inspect port ${port}: ${result.error.message}`, 'warn')
  } else {
    DevLoopTUI.logDevLoop('dev', `Could not inspect port ${port}: ${result.stderr.trim() || 'lsof failed'}`, 'warn')
  }
  return undefined
}

async function terminateListeners(listeners: readonly Listener[]): Promise<void> {
  const pids = listeners.map(listener => String(listener.pid))
  const result = await CLI.run('kill', { args: ['-TERM', ...pids] })
  if (result.exitCode === 0 && result.error === undefined) {
    DevLoopTUI.logDevLoop('dev', `Sent SIGTERM to ${formatListenerSubject(listeners)}.`)
    return
  }
  if (await listenersHaveExited(listeners)) {
    DevLoopTUI.logDevLoop('dev', `${formatListenerSubject(listeners)} already exited.`)
    return
  }

  throw new Errors.UserInputError(
    `Could not kill ${formatListenerSubject(listeners)}: ${
      result.stderr.trim() || result.error?.message || 'kill failed'
    }`,
  )
}

async function waitForRelease(port: number): Promise<void> {
  const deadline = Date.now() + RELEASE_TIMEOUT_MS
  let remaining: readonly Listener[] = []
  do {
    await Time.sleep(RELEASE_POLL_MS)
    const listeners = await findListeners(port)
    if (listeners === undefined) {
      throw new Errors.UserInputError(`Sent SIGTERM, but could not verify that port ${port} is free.`)
    }
    remaining = listeners
    if (remaining.length === 0) {
      return
    }
  } while (Date.now() < deadline)

  throw new Errors.UserInputError(
    `Port ${port} is still in use by ${formatListeners(remaining)} after SIGTERM.`,
  )
}

async function listenersHaveExited(listeners: readonly Listener[]): Promise<boolean> {
  const results = await Promise.all(
    listeners.map(listener => CLI.run('kill', { args: ['-0', String(listener.pid)] })),
  )
  return results.every(result => result.exitCode !== 0 || result.error !== undefined)
}

function dedupeListeners(listeners: readonly Listener[]): Listener[] {
  const byPid = new Map<number, Listener>()
  for (const listener of listeners) {
    byPid.set(listener.pid, listener)
  }
  return [...byPid.values()]
}

function formatListener(listener: Listener): string {
  return `${listener.command} pid ${listener.pid}${listener.name ? ` (${listener.name})` : ''}`
}

function formatListenerSubject(listeners: readonly Listener[]): string {
  return listeners.length === 1 ? 'this process' : 'these processes'
}
