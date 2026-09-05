/** sleep waits for the specified number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** nowMs returns a monotonic millisecond reading, for measuring how long work took. */
export function nowMs(): number {
  return performance.now()
}

/** PollUntilOptions bounds a `pollUntil` wait; `now` and `sleep` are injectable so tests can drive the clock. */
export type PollUntilOptions = {
  intervalMs: number
  timeoutMs: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  /** stop ends the wait early with `undefined`, for a caller whose user may cancel. */
  stop?: () => boolean
}

/**
 * pollUntil re-reads a condition until it yields something other than `false`, `undefined`, or `null`,
 * and returns that value; once the budget is spent it returns `undefined` instead, so the caller words
 * its own timeout. A read that throws ends the wait with that error.
 */
export async function pollUntil<T>(
  read: () => T | Promise<T>,
  options: PollUntilOptions,
): Promise<Exclude<Awaited<T>, false | null | undefined> | undefined> {
  const now = options.now ?? nowMs
  const wait = options.sleep ?? sleep
  const deadline = now() + options.timeoutMs
  while (options.stop?.() !== true && now() < deadline) {
    const value = await read()
    if (value !== false && value !== undefined && value !== null) {
      return value as Exclude<Awaited<T>, false | null | undefined>
    }
    await wait(Math.min(options.intervalMs, Math.max(0, deadline - now())))
  }
  return undefined
}
