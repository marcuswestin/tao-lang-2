import { CLI, Errors, Platform, ProcessTree, Time } from '@shared'
import type { TrackedProcess } from '@shared/ProcessTree'

export type AppiumPortReservation = Readonly<{
  port: number
  release: () => Promise<void>
}>

/** AppiumPortReservations lets each caller reserve a loopback port before starting its owned server. */
export type AppiumPortReservations = Readonly<{
  reserve: () => Promise<AppiumPortReservation>
}>

export type AppiumServer = Readonly<{
  close: () => Promise<void>
  logs: () => string
  url: string
}>

type AppiumFetch = (input: string, init?: RequestInit) => Promise<Response>

export type StartAppiumServerOptions = Readonly<{
  command?: string
  environment?: Record<string, string | undefined>
  fetch?: AppiumFetch
  pollIntervalMs?: number
  quiet?: boolean
  reservations: AppiumPortReservations
  shutdownTimeoutMs?: number
  start?: typeof CLI.start
  startupTimeoutMs?: number
  onStarted?: (process: CLI.StartedCommand) => Promise<void>
  onStartAttempt?: () => void
  onStartupCleanup?: (proved: boolean) => void
  detached?: boolean
  signal?: AbortSignal
  processIsAlive?: (pid: number) => boolean
  processTree?: Pick<
    typeof ProcessTree,
    'descendants' | 'identities' | 'processGroupOf' | 'signalTracked' | 'groupMembers' | 'isGroupAlive'
  >
}>

const DEFAULT_POLL_INTERVAL_MS = 100
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000
const LOG_LIMIT = 64 * 1024

/**
 * startAppiumServer starts one Appium child on a held loopback port and retains that reservation
 * until the owned process has stopped. The caller supplies the reservation implementation because
 * port allocation belongs to the host integration, not an iOS, Android, or Mac2 driver policy.
 */
export async function startAppiumServer(options: StartAppiumServerOptions): Promise<AppiumServer> {
  if (options.signal?.aborted) {
    Errors.throwHostEnvironment('Appium server startup was cancelled before allocation.')
  }
  const reservation = await options.reservations.reserve()
  assertPort(reservation.port)
  const command = options.command ?? 'appium'
  const start = options.start ?? CLI.start
  const fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
  const tree = options.processTree ?? ProcessTree
  const processIsAlive = options.processIsAlive ?? ((pid: number) => Platform.signalProcess(pid, 0))
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    Errors.throwUserInput('Appium server pollIntervalMs must be greater than zero.')
  }
  if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs <= 0) {
    Errors.throwUserInput('Appium server startupTimeoutMs must be greater than zero.')
  }
  if (!Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
    Errors.throwUserInput('Appium server shutdownTimeoutMs must be greater than zero.')
  }

  const logs = new OutputLog()
  const url = `http://127.0.0.1:${reservation.port}`
  let process: ReturnType<typeof CLI.start>
  try {
    if (options.signal?.aborted) {
      Errors.throwHostEnvironment('Appium server startup was cancelled before spawn.')
    }
    options.onStartAttempt?.()
    process = start(command, {
      args: ['server', '--address', '127.0.0.1', '--port', String(reservation.port)],
      env: options.environment,
      // Auth journeys must not echo or retain WebDriver request bodies.
      onOutput: options.quiet === true ? undefined : (_stream, chunk) => logs.append(chunk.toString('utf8')),
      prefixedOutput: options.quiet === true ? undefined : { processName: `appium-${reservation.port}` },
      processPolicy: 'server',
      detached: options.detached,
      stdio: options.quiet === true ? 'ignore' : 'pipe',
    })
  } catch (error) {
    await reservation.release()
    throw error
  }
  // The direct child is the only root that grants descendant capture authority later.
  const spawnRoot = options.detached && process.pid !== undefined
    ? tree.identities([process.pid]).get(process.pid)
    : undefined
  if (options.detached && spawnRoot === undefined) {
    options.onStartupCleanup?.(false)
    Errors.throwHostEnvironment(
      'Appium server kernel identity was not captured after spawn; its port remains retained.',
    )
  }
  let released = false
  let closePromise: Promise<void> | undefined
  let captured: {
    root: TrackedProcess | undefined
    descendants: TrackedProcess[]
    groups: Set<number>
  } | undefined
  const releaseReservation = async () => {
    if (!released) {
      await reservation.release()
      released = true
    }
  }
  const stop = async () => {
    if (closePromise !== undefined) {
      return await closePromise
    }
    closePromise = stopOwnedProcess()
    try {
      await closePromise
    } catch (error) {
      closePromise = undefined
      throw error
    }
  }
  const stopOwnedProcess = async () => {
    if (options.detached && process.pid !== undefined && captured === undefined) {
      const before = tree.identities([process.pid]).get(process.pid)
      if (spawnRoot === undefined || !ProcessTree.sameProcess(before, spawnRoot)) {
        Errors.throwHostEnvironment(
          'Appium server identity changed before descendant capture; its port remains retained.',
        )
      }
      const descendants = tree.descendants(process.pid)
      const groups = new Set([process.pid])
      for (const child of descendants) {
        const current = tree.identities([child.pid]).get(child.pid)
        if (current !== undefined && !ProcessTree.sameProcess(current, child)) {
          Errors.throwHostEnvironment('Appium descendant changed identity during capture; its port remains retained.')
        }
        if (current === undefined && processIsAlive(child.pid)) {
          Errors.throwHostEnvironment(
            'Appium descendant identity is unreadable during capture; its port remains retained.',
          )
        }
        const group = tree.processGroupOf(child.pid)
        if (group === undefined) {
          Errors.throwHostEnvironment('Appium descendant group identity is unproved; its ports remain retained.')
        }
        groups.add(group)
      }
      const root = tree.identities([process.pid]).get(process.pid)
      if (!ProcessTree.sameProcess(root, spawnRoot)) {
        Errors.throwHostEnvironment(
          'Appium server identity changed during descendant capture; its port remains retained.',
        )
      }
      captured = { root, descendants, groups }
    }
    const closure = (transientUnreadableIsPending = false) => {
      if (captured === undefined) {
        return true
      }
      let closed = true
      if (process.pid !== undefined && captured.root !== undefined) {
        const root = tree.identities([process.pid]).get(process.pid)
        if (root !== undefined && !ProcessTree.sameProcess(root, captured.root)) {
          Errors.throwHostEnvironment('Appium server PID has a different kernel identity; its ports remain retained.')
        }
        if (root === undefined && processIsAlive(process.pid)) {
          if (!transientUnreadableIsPending) {
            Errors.throwHostEnvironment('Appium server identity is unreadable; its ports remain retained.')
          }
          closed = false
        }
      }
      const tracked = captured.descendants
      const live = tree.identities(tracked.map(child => child.pid))
      for (const child of tracked) {
        const identity = live.get(child.pid)
        if (identity === undefined && processIsAlive(child.pid)) {
          if (!transientUnreadableIsPending) {
            Errors.throwHostEnvironment('Appium descendant identity is unreadable; its ports remain retained.')
          }
          closed = false
        }
        if (identity !== undefined && !ProcessTree.sameProcess(identity, child)) {
          Errors.throwHostEnvironment(
            'Appium descendant PID has a different kernel identity; its ports remain retained.',
          )
        }
        closed &&= identity === undefined
      }
      for (const group of captured.groups) {
        const members = tree.groupMembers(group)
        for (const member of members) {
          if (
            !(member.pid === process.pid && captured.root !== undefined
              && ProcessTree.sameProcess(member, captured.root))
            && !tracked.some(child => child.pid === member.pid && ProcessTree.sameProcess(child, member))
          ) {
            Errors.throwHostEnvironment(
              'Appium process group contains an unrecorded member; its ports remain retained.',
            )
          }
        }
        closed &&= members.length === 0 && !tree.isGroupAlive(group)
      }
      return closed
    }
    // Validate membership before either signal. Never signal an entire process group.
    closure()
    if (captured !== undefined) {
      tree.signalTracked(captured.descendants, 'SIGTERM')
    }
    process.kill('SIGTERM')
    const rootStopped = await waitForCloseWithin(process, shutdownTimeoutMs)
    const descendantsStopped = rootStopped && await Time.pollUntil(
          () => closure(true) ? true : undefined,
          { timeoutMs: shutdownTimeoutMs, intervalMs: 50 },
        ) === true
    if (!rootStopped || !descendantsStopped) {
      closure()
      if (captured !== undefined) {
        tree.signalTracked(captured.descendants, 'SIGKILL')
      }
      if (!rootStopped) {
        process.kill('SIGKILL')
      }
      if (
        !await waitForCloseWithin(process, shutdownTimeoutMs)
        || await Time.pollUntil(() => closure(true) ? true : undefined, {
            timeoutMs: shutdownTimeoutMs,
            intervalMs: 50,
          }) !== true
      ) {
        Errors.throwHostEnvironment(
          'Appium did not stop after bounded SIGTERM and SIGKILL attempts; retaining its port reservation.',
          { details: { logs: logs.value(), url } },
        )
      }
    }
    await boundedOperation(process.closeOutput(), shutdownTimeoutMs)
    closure()
    process.dispose()
    await releaseReservation()
  }
  try {
    await boundedOperation(Promise.resolve(options.onStarted?.(process)), startupTimeoutMs, options.signal)
    await waitUntilReady({ fetcher, logs, pollIntervalMs, process, startupTimeoutMs, url, signal: options.signal })
  } catch (error) {
    try {
      await stop()
    } catch (stopError) {
      options.onStartupCleanup?.(false)
      Errors.throwHostEnvironment('Appium did not become ready and its owned server could not be stopped.', {
        cause: stopError,
        details: { startupError: Errors.messageOf(error) },
      })
    }
    options.onStartupCleanup?.(true)
    throw error
  }
  return { close: stop, logs: () => logs.value(), url }
}

async function boundedOperation<T>(operation: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        const fail = () =>
          reject(
            new Errors.HostEnvironmentError('Appium lifecycle operation was cancelled or exceeded its finite budget.'),
          )
        timer = setTimeout(fail, timeoutMs)
        abort = fail
        if (signal?.aborted) {
          fail()
        } else {
          signal?.addEventListener('abort', fail, { once: true })
        }
      }),
    ])
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    if (abort !== undefined) {
      signal?.removeEventListener('abort', abort)
    }
  }
}

async function waitForCloseWithin(process: ReturnType<typeof CLI.start>, timeoutMs: number): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      process.waitForClose().then(() => true),
      new Promise<boolean>(resolve => {
        timeout = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout)
    }
  }
}

async function waitUntilReady(
  options: Readonly<{
    fetcher: AppiumFetch
    logs: OutputLog
    pollIntervalMs: number
    process: ReturnType<typeof CLI.start>
    startupTimeoutMs: number
    url: string
    signal?: AbortSignal
  }>,
): Promise<void> {
  const deadline = Time.nowMs() + options.startupTimeoutMs
  let lastFailure = 'Appium did not answer its status endpoint.'
  while (Time.nowMs() < deadline) {
    if (options.signal?.aborted) {
      Errors.throwHostEnvironment('Appium server startup was cancelled.')
    }
    if (options.process.error !== undefined) {
      Errors.throwHostEnvironment(`Could not start Appium: ${options.process.error.message}`, {
        details: { logs: options.logs.value() },
      })
    }
    if (options.process.exitCode !== null || options.process.signalCode !== null) {
      Errors.throwHostEnvironment('Appium exited before its status endpoint became ready.', {
        details: { logs: options.logs.value() },
      })
    }
    try {
      const response = await requestWithin(
        options.fetcher,
        `${options.url}/status`,
        Math.max(1, deadline - Time.nowMs()),
        options.signal,
      )
      if (response.ok) {
        return
      }
      lastFailure = `Appium status endpoint returned HTTP ${response.status}.`
    } catch (error) {
      lastFailure = Errors.messageOf(error)
    }
    await Time.sleep(Math.min(options.pollIntervalMs, Math.max(1, deadline - Time.nowMs())))
  }
  Errors.throwHostEnvironment(`Timed out waiting for Appium at ${options.url}/status: ${lastFailure}`, {
    details: { logs: options.logs.value() },
  })
}

async function requestWithin(
  fetcher: AppiumFetch,
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      fetcher(url),
      new Promise<Response>((_resolve, reject) => {
        abort = () => reject(new Errors.HostEnvironmentError('Appium status request was cancelled.'))
        if (signal?.aborted) {
          abort()
        } else {
          signal?.addEventListener('abort', abort, { once: true })
        }
        timeout = setTimeout(
          () => reject(new Errors.HostEnvironmentError(`Appium status endpoint did not answer within ${timeoutMs}ms.`)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout)
    }
    if (abort !== undefined) {
      signal?.removeEventListener('abort', abort)
    }
  }
}

function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    Errors.throwUserInput('Appium server reservations must provide a TCP port number.')
  }
}

class OutputLog {
  #value = ''

  append(value: string): void {
    this.#value = (this.#value + value).slice(-LOG_LIMIT)
  }

  value(): string {
    return this.#value
  }
}
