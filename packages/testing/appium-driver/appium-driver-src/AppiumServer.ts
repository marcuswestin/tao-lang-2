import { CLI, Errors, Time } from '@shared'

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
  const reservation = await options.reservations.reserve()
  assertPort(reservation.port)
  const command = options.command ?? 'appium'
  const start = options.start ?? CLI.start
  const fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
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
    process = start(command, {
      args: ['server', '--address', '127.0.0.1', '--port', String(reservation.port)],
      env: options.environment,
      // Auth journeys must not echo or retain WebDriver request bodies.
      onOutput: options.quiet === true ? undefined : (_stream, chunk) => logs.append(chunk.toString('utf8')),
      prefixedOutput: options.quiet === true ? undefined : { processName: `appium-${reservation.port}` },
      processPolicy: 'server',
      stdio: options.quiet === true ? 'ignore' : 'pipe',
    })
  } catch (error) {
    await reservation.release()
    throw error
  }
  let released = false
  let closePromise: Promise<void> | undefined
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
    process.kill('SIGTERM')
    if (!await waitForCloseWithin(process, shutdownTimeoutMs)) {
      process.kill('SIGKILL')
      if (!await waitForCloseWithin(process, shutdownTimeoutMs)) {
        Errors.throwHostEnvironment(
          'Appium did not stop after bounded SIGTERM and SIGKILL attempts; retaining its port reservation.',
          {
            details: { logs: logs.value(), url },
          },
        )
      }
    }
    await process.closeOutput()
    process.dispose()
    await releaseReservation()
  }
  try {
    await waitUntilReady({ fetcher, logs, pollIntervalMs, process, startupTimeoutMs, url })
  } catch (error) {
    try {
      await stop()
    } catch (stopError) {
      Errors.throwHostEnvironment('Appium did not become ready and its owned server could not be stopped.', {
        cause: stopError,
        details: { startupError: Errors.messageOf(error) },
      })
    }
    throw error
  }
  return { close: stop, logs: () => logs.value(), url }
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
  }>,
): Promise<void> {
  const deadline = Time.nowMs() + options.startupTimeoutMs
  let lastFailure = 'Appium did not answer its status endpoint.'
  while (Time.nowMs() < deadline) {
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

async function requestWithin(fetcher: AppiumFetch, url: string, timeoutMs: number): Promise<Response> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fetcher(url),
      new Promise<Response>((_resolve, reject) => {
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
