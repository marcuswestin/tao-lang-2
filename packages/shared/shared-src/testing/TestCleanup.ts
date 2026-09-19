import { asError, formatForLog, messageOf, throwUnexpected, UnexpectedBehaviorError } from '../core/Errors'
import { logProcessError } from '../HCI'

/**
 * A journey acquires browsers, servers, preview sessions, and temporary directories, and every one
 * of them must be released whether the journey passed or failed. Releasing them in a `finally` one
 * statement at a time gets the first failure only: a disposer that throws skips every disposer
 * after it, and when the journey itself already failed, that cleanup error replaces the failure
 * worth reading. Collecting the work here runs all of it and keeps the primary failure primary.
 */
export type TestCleanup = {
  label: string
  run: () => unknown | Promise<unknown>
}

/** RunCleanupsOptions names the journey in the failure message and on the log channel. */
export type RunCleanupsOptions = {
  /** The log channel the default reporter writes to, such as `studio-smoke-cleanup`. */
  channel: string
  /** What is being cleaned up, as it reads mid-sentence: `2 <subject> cleanup operations failed`. */
  subject: string
  /** Where a cleanup failure goes when the journey already failed. Tests substitute this. */
  reportCleanupFailure?: (error: unknown) => void
}

/**
 * runCleanups runs every disposer, then reports what failed.
 *
 * With no primary failure, a failed disposer is the failure and is thrown. With one, the primary
 * failure is what the test reports and the cleanup failures are logged beside it — a test that
 * failed for a real reason must not be re-attributed to a browser that would not close.
 */
export async function runCleanups(
  primaryFailure: unknown,
  cleanups: readonly TestCleanup[],
  options: RunCleanupsOptions,
): Promise<void> {
  const failures: { error: unknown; label: string }[] = []
  for (const cleanup of cleanups) {
    try {
      await cleanup.run()
    } catch (error) {
      failures.push({ error, label: cleanup.label })
    }
  }
  if (failures.length === 0) {
    return
  }
  const message = `${failures.length} ${options.subject} cleanup operations failed:\n${
    failures.map(failure => `- ${failure.label}: ${messageOf(failure.error)}`).join('\n')
  }`
  const cause = failures.map(failure => ({
    error: formatForLog(failure.error),
    label: failure.label,
  }))
  if (primaryFailure === undefined) {
    throwUnexpected(message, { cause })
  }
  const report = options.reportCleanupFailure
    ?? (error =>
      logProcessError(
        options.channel,
        `Cleanup also failed after the primary journey failure: ${formatForLog(asError(error))}`,
      ))
  report(new UnexpectedBehaviorError(message, { cause }))
}
