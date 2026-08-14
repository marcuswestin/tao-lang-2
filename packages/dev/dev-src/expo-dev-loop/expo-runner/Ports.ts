import { CLI, Errors, HCI, Time } from '@shared'
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

/** Ports groups TCP port inspection and release helpers. */
export const Ports = {
  ensureFree,
  formatListeners,
  formatLsofListeners,
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
  const shouldKill = await HCI.askConfirm({
    defaultValue: true,
    message: `Kill ${formatListenerSubject(listeners)} and continue`,
  })
  if (!shouldKill) {
    throw new Errors.UserInputError(
      `Port ${port} is already in use by ${formatListeners(listeners)}. Stop ${
        formatListenerSubject(listeners)
      } before starting ./dev.`,
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
