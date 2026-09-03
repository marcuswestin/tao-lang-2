import { FS } from '@shared'
import type { ContentionReport } from './MachineLanes'
import type { RunLocation } from './RunArtifacts'
import { describesTimeout } from './RunSummary'
import { WorkGraph, type WorkRunOptions, type WorkState } from './WorkGraph'

/**
 * A node that ran out of time while another worktree was using the same machine has told you
 * nothing about the repository. Re-running it on its own is the cheapest way to find out which it
 * was, and it is exactly what a person does by hand before believing a red lane.
 *
 * So the lane does it once, itself, and says so. The retry is deliberately narrow: only nodes whose
 * output says a clock ran out, only when the run measured contention, only a few of them, and one
 * at a time so the retry itself is not contended. A node that passes on retry is reported as
 * `retried`, never as a plain pass — the run really did fail the first time, and a lane that hides
 * that is a lane nobody can use to find a real flake.
 */

/** RetryOptions describes the finished run whose contended timeouts are being confirmed. */
export type RetryOptions = {
  contention: ContentionReport
  location: RunLocation
  /** Live states from the finished run; those that recover are updated in place. */
  states: readonly WorkState[]
  /** Injected so tests observe the retry without starting real processes. */
  runNode?: WorkRunOptions['runNode']
}

/** RetryOutcome names what the confirmation pass found. */
export type RetryOutcome = {
  /** Nodes that failed again on their own, so the failure was never about the machine. */
  confirmed: readonly string[]
  /** Nodes that passed once they had the machine to themselves. */
  recovered: readonly string[]
}

/**
 * At most this many nodes are re-run. A lane where more than a few nodes time out at once is not
 * suffering a flake; something is wrong, and spending another full lane's wall time proving it
 * helps nobody.
 */
const MAX_RETRIES = 3

/** candidates names the failed nodes whose failure a busy machine can plausibly explain. */
function candidates(states: readonly WorkState[], contention: ContentionReport): WorkState[] {
  if (!contention.contended) {
    return []
  }
  return states
    .filter(state => state.status === 'failed' && state.retried !== true && describesTimeout(state.fullOutput))
    .slice(0, MAX_RETRIES)
}

/**
 * confirmContendedFailures re-runs the contended timeouts one at a time and folds the result back
 * into the states the summary is built from.
 */
async function confirmContendedFailures(options: RetryOptions): Promise<RetryOutcome> {
  const retrying = candidates(options.states, options.contention)
  if (retrying.length === 0) {
    return { confirmed: [], recovered: [] }
  }

  const attempts = retrying.map(state => WorkGraph.createState(state.node))
  for (const attempt of attempts) {
    attempt.logPath = FS.resolvePath(`${WorkGraph.nodeLabel(attempt.node)}.retry.log`, options.location.logRoot)
  }
  // One at a time: a retry that shares the lane with the rest of a retry batch reproduces the very
  // condition it exists to rule out.
  await WorkGraph.run(attempts, { jobs: 1, runNode: options.runNode, watchInterrupt: () => () => {} })

  const confirmed: string[] = []
  const recovered: string[] = []
  for (const [index, attempt] of attempts.entries()) {
    const original = retrying[index]!
    await writeRetryLog(attempt)
    adoptRetry(original, attempt)
    ;(attempt.status === 'passed' ? recovered : confirmed).push(original.name)
  }
  return { confirmed, recovered }
}

/** adoptRetry replaces a contended failure with what the node did when it had the machine to itself. */
function adoptRetry(original: WorkState, attempt: WorkState): void {
  original.retried = true
  original.fullOutput += `\n--- isolated retry after machine contention ---\n${attempt.fullOutput}`
  if (attempt.status === 'passed') {
    original.status = 'passed'
    original.exitCode = attempt.exitCode
    original.elapsedMs += attempt.elapsedMs
    original.reason = 'timed out under machine contention; passed on an isolated retry'
    return
  }
  original.reason = 'timed out under machine contention and failed again on an isolated retry'
}

async function writeRetryLog(attempt: WorkState): Promise<void> {
  if (attempt.logPath === undefined) {
    return
  }
  await FS.writeText(attempt.logPath, attempt.fullOutput).catch(() => {})
}

/** ContentionRetry owns the one confirmation pass a contended lane makes before reporting red. */
export const ContentionRetry = {
  MAX_RETRIES,
  candidates,
  confirmContendedFailures,
} as const
