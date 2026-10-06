import { throwUnexpected } from '../core/Errors'
import * as Time from '../core/Time'
import * as VerificationTimeouts from '../VerificationTimeouts'

const DEFAULT_POLL_INTERVAL_MS = 10

/*
 * A wall-clock budget in a test is for a busy host, not for a slow condition: this repo runs under
 * host load averages of 20-85, where a two-second budget around real work (a process spawn, a file
 * read, a lock) fails on a loaded machine for reasons that have nothing to do with the code under
 * test. `until` polls for at most thirty seconds by default so that variance, not the condition
 * itself, has to be extreme before a wait fails. A condition that is genuinely hung still fails —
 * 28 seconds later than it would have — and still reports the caller's own description rather than
 * the runner's anonymous test timeout. Waits that need longer still — a language server handshake, a
 * launched Studio process — pass an explicit `timeoutMs`.
 */
const DEFAULT_TIMEOUT_MS = 30_000

/** exhausted marks a read that the remaining budget ran out on rather than one that returned a value. */
const exhausted = Symbol('until budget exhausted')

/** Deferred is a promise plus the controls that settle it, for holding work pending until a test releases it. */
export type Deferred<T = void> = {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T | PromiseLike<T>) => void
}

/** UntilOptions tunes how long `until` waits, how often it re-reads, and what its timeout message names. */
export type UntilOptions = {
  /** What the caller is waiting for, quoted in the timeout message. */
  description?: string
  /** Delay between reads; `0` re-reads on the next event-loop turn. Defaults to 10ms. */
  intervalMs?: number
  /** Wall-clock budget before the wait fails. Defaults to 30000ms. */
  timeoutMs?: number
  /** Keep deliberate timeout-contract fixtures bounded during diagnostic verification. */
  timeoutPolicy?: VerificationTimeouts.Policy
}

/** Deferred creates a promise a test settles by hand, so the code under test can be observed while it is still pending. */
export function Deferred<T = void>(): Deferred<T> {
  let reject!: (reason?: unknown) => void
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    reject = promiseReject
    resolve = promiseResolve
  })

  return { promise, reject, resolve }
}

/**
 * settle yields to the host event loop so already-queued microtasks and zero-delay timers run before the
 * test asserts. Each turn is one macrotask, which drains every microtask queued ahead of it.
 */
export async function settle(turns = 1): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await Time.sleep(0)
  }
}

/**
 * until re-reads a condition until it holds and returns what it read, so a wait fails with a named timeout
 * instead of hanging. A condition holds once it returns anything other than `false`, `undefined`, or `null`,
 * which lets one helper serve both `() => boolean` checks and `() => Value | undefined` reads.
 *
 * Each read races the budget that is left, so an async condition whose promise never settles fails with the
 * caller's own description too. Awaiting the read first and checking the clock afterwards would hand a stuck
 * read to the runner's anonymous per-test timeout, which is exactly the report this helper exists to replace.
 */
export async function until<T>(
  condition: () => T | Promise<T>,
  options: UntilOptions = {},
): Promise<Exclude<Awaited<T>, false | null | undefined>> {
  const {
    description = 'a test condition',
    intervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options
  // Preserve exhausted or malformed budgets' existing immediate failure in diagnostic mode too.
  const executionTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? VerificationTimeouts.resolve(timeoutMs, options.timeoutPolicy)
    : timeoutMs
  const deadline = executionTimeoutMs === undefined ? undefined : Time.nowMs() + executionTimeoutMs

  for (
    let remainingMs = executionTimeoutMs;
    remainingMs === undefined || remainingMs > 0;
    remainingMs = deadline === undefined ? undefined : deadline - Time.nowMs()
  ) {
    const value = await readWithin(condition, remainingMs)

    if (value === exhausted) {
      break
    }
    if (value !== false && value !== undefined && value !== null) {
      return value as Exclude<Awaited<T>, false | null | undefined>
    }
    await Time.sleep(deadline === undefined ? intervalMs : Math.min(intervalMs, Math.max(0, deadline - Time.nowMs())))
  }
  throwUnexpected(`Timed out after ${timeoutMs}ms waiting for ${description}.`)
}

/**
 * readWithin resolves to what one read returned, or to `exhausted` once `remainingMs` has passed. A read that
 * loses the race is abandoned rather than cancelled — nothing can cancel an arbitrary promise — but the race
 * stays subscribed to it, so a read that rejects long afterwards is still handled and never surfaces as an
 * unhandled rejection in whatever test happens to be running by then.
 */
async function readWithin<T>(
  condition: () => T | Promise<T>,
  remainingMs: number | undefined,
): Promise<Awaited<T> | typeof exhausted> {
  if (remainingMs === undefined) {
    return await condition()
  }
  let budget: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(condition()),
      new Promise<typeof exhausted>(resolve => {
        budget = setTimeout(() => resolve(exhausted), remainingMs)
      }),
    ])
  } finally {
    if (budget !== undefined) {
      clearTimeout(budget)
    }
  }
}
