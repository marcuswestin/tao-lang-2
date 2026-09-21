import { CLI, Errors, type ProcessListener as Listener, ProcessListeners, Time } from '@shared'
import { createServer } from 'node:net'
import { DevLoopOutput } from '../DevLoopOutput'

const RELEASE_TIMEOUT_MS = 5_000
const RELEASE_POLL_MS = 250

type PortProbe = (port: number) => Promise<number | undefined>

export type PortReservation = {
  port: number
  release: () => Promise<void>
}

/** Ports groups TCP port inspection and release helpers. */
export const Ports = {
  ensureFree,
  findAvailable,
  formatKillCommand: ProcessListeners.formatKillCommand,
  formatListeners: ProcessListeners.formatListeners,
  formatLsofListeners: ProcessListeners.formatLsofListeners,
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
    Errors.throwUserInput('Could not reserve a free Expo Metro port.')
  }
  return reservation
}

async function requireEphemeralPort(probe: PortProbe): Promise<number> {
  const port = await probe(0)
  if (port === undefined) {
    Errors.throwUserInput('Could not allocate a free Expo Metro port.')
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

  DevLoopOutput.logDevLoop(
    'dev',
    `Port ${port} is already in use by ${ProcessListeners.formatListeners(listeners)}.`,
    'warn',
  )
  // Several worktrees of this repository share one machine, and they all reach for the same
  // conventional ports. The holder is as likely to be another checkout's dev loop as a leftover of
  // this one, so the question names that before the answer kills anything.
  DevLoopOutput.logDevLoop(
    'dev',
    'It may belong to another worktree on this machine; killing it stops that dev loop too.',
    'warn',
  )
  const shouldKill = await DevLoopOutput.askConfirm({
    defaultValue: false,
    message: 'Kill it?',
  })
  if (!shouldKill) {
    Errors.throwUserInput(
      `Port ${port} is already in use by ${ProcessListeners.formatListeners(listeners)}. To kill it, run: ${
        ProcessListeners.formatKillCommand(listeners)
      }`,
    )
  }

  await terminateListeners(listeners)
  await waitForRelease(port)
  DevLoopOutput.logDevLoop('dev', `Port ${port} is free.`)
  return true
}

async function findListeners(port: number): Promise<Listener[] | undefined> {
  const result = await CLI.run('lsof', {
    args: ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'pcn'],
  })
  const listeners = ProcessListeners.formatLsofListeners(result)

  if (listeners !== undefined) {
    return listeners
  }
  if (result.error !== undefined) {
    DevLoopOutput.logDevLoop('dev', `Could not inspect port ${port}: ${result.error.message}`, 'warn')
  } else {
    DevLoopOutput.logDevLoop('dev', `Could not inspect port ${port}: ${result.stderr.trim() || 'lsof failed'}`, 'warn')
  }
  return undefined
}

async function terminateListeners(listeners: readonly Listener[]): Promise<void> {
  const pids = listeners.map(listener => String(listener.pid))
  const result = await CLI.run('kill', { args: ['-TERM', ...pids] })
  if (result.exitCode === 0 && result.error === undefined) {
    DevLoopOutput.logDevLoop('dev', `Sent SIGTERM to ${formatListenerSubject(listeners)}.`)
    return
  }
  if (await listenersHaveExited(listeners)) {
    DevLoopOutput.logDevLoop('dev', `${formatListenerSubject(listeners)} already exited.`)
    return
  }

  Errors.throwUserInput(
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
      Errors.throwUserInput(`Sent SIGTERM, but could not verify that port ${port} is free.`)
    }
    remaining = listeners
    if (remaining.length === 0) {
      return
    }
  } while (Date.now() < deadline)

  Errors.throwUserInput(
    `Port ${port} is still in use by ${ProcessListeners.formatListeners(remaining)} after SIGTERM.`,
  )
}

async function listenersHaveExited(listeners: readonly Listener[]): Promise<boolean> {
  const results = await Promise.all(
    listeners.map(listener => CLI.run('kill', { args: ['-0', String(listener.pid)] })),
  )
  return results.every(result => result.exitCode !== 0 || result.error !== undefined)
}

function formatListenerSubject(listeners: readonly Listener[]): string {
  return listeners.length === 1 ? 'this process' : 'these processes'
}
