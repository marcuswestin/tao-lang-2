import { CLI, Errors, Time } from '@shared'

/** Wait for an installed CLI child to publish its ready marker while preserving startup failures. */
export async function waitForStandaloneReadiness(
  child: Pick<CLI.StartedCommand, 'error' | 'exitCode' | 'signalCode'>,
  readiness: () => boolean | Promise<boolean>,
  output: () => string,
  description: string,
  timeoutMs: number,
  timing: {
    intervalMs?: number
    now?: () => number
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<void> {
  const result = await Time.pollUntil(async () => {
    const failure = childFailure(child)
    if (failure !== undefined) {
      return { failure }
    }
    const ready = await readiness()
    const afterReadiness = childFailure(child)
    return afterReadiness !== undefined ? { failure: afterReadiness } : ready ? { ready: true as const } : undefined
  }, { intervalMs: timing.intervalMs ?? 250, timeoutMs, ...timing })

  if (result !== undefined && 'failure' in result) {
    Errors.throwHostEnvironment(`${description} failed to start (${result.failure}):\n${startupOutput(output())}`)
  }
  if (result === undefined) {
    Errors.throwHostEnvironment(
      `${description} did not become ready within ${timeoutMs} ms:\n${startupOutput(output())}`,
    )
  }
}

/** Keep the first startup diagnostic and recent output without flooding the failure report. */
function startupOutput(output: string): string {
  return output.length <= 12_000
    ? output
    : `${output.slice(0, 2_000)}\n... startup output omitted ...\n${output.slice(-10_000)}`
}

function childFailure(child: Pick<CLI.StartedCommand, 'error' | 'exitCode' | 'signalCode'>): string | undefined {
  if (child.error !== undefined) {
    return `spawn error: ${child.error.message}`
  }
  if (child.signalCode !== null) {
    return `signal ${child.signalCode}`
  }
  if (child.exitCode !== null) {
    return `exit ${child.exitCode}`
  }
  return undefined
}
