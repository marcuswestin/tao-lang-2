import type { TaoEvaluable } from './TR-action-values'
import { TaoActionFailure } from './TR-errors'

const MAX_TIMER_DELAY_MS = 2 ** 31 - 1
const MAX_TIMER_DELAY_SECONDS = MAX_TIMER_DELAY_MS / 1000

/** A checked reader authenticates the supplied value and returns canonical seconds. */
export type TaoDurationReader<Value extends TaoEvaluable<unknown>> = (
  value: Value,
) => Readonly<{ canonical: number }>

/** Schedule a host timer and return the operation that cancels it. */
export type TaoWaitScheduler = (callback: () => void, delayMilliseconds: number) => () => void

const hostScheduler: TaoWaitScheduler = (callback, delayMilliseconds) => {
  const timer = setTimeout(callback, delayMilliseconds)
  return () => clearTimeout(timer)
}

/** Wait suspends for a checked Duration expressed in canonical seconds. */
export async function wait<Value extends TaoEvaluable<unknown>>(
  readDuration: TaoDurationReader<Value>,
  duration: Value,
  signal?: AbortSignal,
  schedule: TaoWaitScheduler = hostScheduler,
): Promise<void> {
  const { canonical: seconds } = readDuration(duration)
  if (signal?.aborted) {
    throw cancelledFailure(signal)
  }
  if (seconds <= 0) {
    return
  }

  let remainingSeconds = seconds
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let cancelTimer: (() => void) | undefined

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      const cancel = cancelTimer
      cancelTimer = undefined
      cancel?.()
    }

    const finish = (error?: unknown, failed = false) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      if (failed) {
        reject(error)
      } else {
        resolve()
      }
    }

    const onAbort = () => finish(cancelledFailure(signal), true)

    const scheduleNext = () => {
      if (settled) {
        return
      }
      const delayMilliseconds = remainingSeconds >= MAX_TIMER_DELAY_SECONDS
        ? MAX_TIMER_DELAY_MS
        : Math.max(1, Math.ceil(remainingSeconds * 1000))
      try {
        const cancel = schedule(() => {
          if (settled) {
            return
          }
          cancelTimer = undefined
          remainingSeconds -= delayMilliseconds / 1000
          if (remainingSeconds <= 0) {
            finish()
          } else {
            scheduleNext()
          }
        }, delayMilliseconds)
        if (settled) {
          cancel()
        } else {
          cancelTimer = cancel
        }
      } catch (error) {
        finish(error, true)
      }
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    scheduleNext()
  })
}

function cancelledFailure(signal?: AbortSignal): TaoActionFailure {
  if (signal?.reason instanceof TaoActionFailure) {
    return signal.reason
  }
  return new TaoActionFailure('cancelled', 'The action was cancelled while waiting.')
}
