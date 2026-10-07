import type { StartedCommand } from './CLI'
import { Errors, Time } from './core/shared-core'

/** Wait for readiness while observing child failure and aborting unfinished probes on return. */
export async function waitForProcessReadiness(
  child: Pick<StartedCommand, 'error' | 'exitCode' | 'signalCode'> | undefined,
  readiness: (signal: AbortSignal) => boolean | Promise<boolean>,
  output: () => string,
  description: string,
  timeoutMs: number,
  timing: {
    intervalMs?: number
    now?: () => number
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<void> {
  const controller = new AbortController()
  let probePending = false
  let probeResult: { ready: boolean } | { error: unknown } | undefined
  try {
    const result = await Time.pollUntil(() => {
      const failure = child === undefined ? undefined : childFailure(child)
      if (failure !== undefined) {
        return { failure }
      }
      if (probeResult !== undefined) {
        const completed = probeResult
        probeResult = undefined
        if ('error' in completed) {
          throw completed.error
        }
        if (completed.ready) {
          return { ready: true as const }
        }
      }
      if (!probePending) {
        probePending = true
        // An HTTP probe can stay pending while its child exits. Keep polling process state and the
        // deadline independently; both continuations handle late settlement without retaining a timer.
        void Promise.resolve().then(() => controller.signal.aborted ? false : readiness(controller.signal)).then(
          ready => {
            if (controller.signal.aborted) {
              return
            }
            probePending = false
            probeResult = { ready }
          },
          error => {
            if (controller.signal.aborted) {
              return
            }
            probePending = false
            probeResult = { error }
          },
        )
      }
      return undefined
    }, { intervalMs: timing.intervalMs ?? 250, timeoutMs, ...timing })

    if (result !== undefined && 'failure' in result) {
      Errors.throwHostEnvironment(`${description} failed to start (${result.failure}):\n${startupOutput(output())}`)
    }
    if (result === undefined) {
      Errors.throwHostEnvironment(
        `${description} did not become ready within ${timeoutMs} ms:\n${startupOutput(output())}`,
      )
    }
  } finally {
    controller.abort()
  }
}

/** Keep the first startup diagnostic and recent output without flooding the failure report. */
function startupOutput(output: string): string {
  return output.length <= 12_000
    ? output
    : `${output.slice(0, 2_000)}\n... startup output omitted ...\n${output.slice(-10_000)}`
}

function childFailure(child: Pick<StartedCommand, 'error' | 'exitCode' | 'signalCode'>): string | undefined {
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
