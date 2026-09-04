import { FS } from '@shared'
import type { ContentionReport, MachineLane } from './MachineLanes'
import type { RunLocation } from './RunArtifacts'
import { describesTimeout } from './RunSummary'
import { WorkGraph, type WorkRunOptions, type WorkState } from './WorkGraph'

/**
 * A node that ran out of time while another worktree was using the same machine has told you
 * nothing about the repository. Re-running it on its own is the cheapest way to find out which it
 * was, and it is exactly what a person does by hand before believing a red lane.
 *
 * So the lane does it once, itself, and says so. The retry is deliberately narrow: only nodes whose
 * structured state or test-runner output says a clock ran out, only when the run measured
 * contention, and only a few of them. An exclusive machine lease drains other work before the
 * confirmation. A node that passes on retry is reported as
 * `retried`, never as a plain pass. A successful exclusive confirmation is valid gate evidence,
 * while its retained attempts and warning keep the first timeout visible for flake diagnosis.
 */

/** RetryOptions describes the finished run whose contended timeouts are being confirmed. */
export type RetryOptions = {
  contention: ContentionReport
  location: RunLocation
  /** The original top-level lane, used to stop new admissions and drain peer reservations. */
  machineLane?: MachineLane
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
  /** Candidates that could not obtain a genuinely exclusive machine confirmation. */
  unconfirmed: readonly string[]
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
    .filter(state =>
      state.status === 'failed'
      && state.retried !== true
      && (
        state.failure?.kind === 'timeout'
        || (
          (state.failure === undefined || state.failure.kind === 'nonzero-exit')
          && (describesTimeout(state.reason ?? '') || describesTimeout(state.fullOutput))
        )
      )
    )
    .slice(0, MAX_RETRIES)
}

/**
 * confirmContendedFailures re-runs the contended timeouts one at a time and folds the result back
 * into the states the summary is built from.
 */
async function confirmContendedFailures(options: RetryOptions): Promise<RetryOutcome> {
  const retrying = candidates(options.states, options.contention)
  if (retrying.length === 0) {
    return { confirmed: [], recovered: [], unconfirmed: [] }
  }

  const isolation = await options.machineLane?.acquireExclusive()
  if (isolation === undefined) {
    for (const state of retrying) {
      state.reason =
        'timed out under machine contention; exclusive confirmation was not obtained, so the failure is unconfirmed'
    }
    return { confirmed: [], recovered: [], unconfirmed: retrying.map(state => state.name) }
  }

  try {
    const attempts = retrying.map(state => WorkGraph.createState(state.node))
    for (const attempt of attempts) {
      attempt.logPath = FS.resolvePath(`${WorkGraph.nodeLabel(attempt.node)}.retry.log`, options.location.logRoot)
    }
    // The exclusive lease blocks other lanes from admitting new nodes and was granted only after
    // their existing reservations drained. jobs=1 additionally serializes this confirmation batch.
    await WorkGraph.run(attempts, {
      jobs: 1,
      runNode: options.runNode,
      slotBroker: options.machineLane,
      watchInterrupt: () => () => {},
    })

    const confirmed: string[] = []
    const recovered: string[] = []
    for (const [index, attempt] of attempts.entries()) {
      const original = retrying[index]!
      await writeRetryLog(attempt)
      adoptRetry(original, attempt)
      ;(attempt.status === 'passed' ? recovered : confirmed).push(original.name)
    }
    return { confirmed, recovered, unconfirmed: [] }
  } finally {
    await isolation.release()
  }
}

/** adoptRetry replaces a contended failure with what the node did when it had the machine to itself. */
function adoptRetry(original: WorkState, attempt: WorkState): void {
  const firstAttempt = snapshotAttempt(original)
  original.retried = true
  original.attempts = [...(original.attempts ?? [firstAttempt]), snapshotAttempt(attempt)]
  // The live state is the effective result. Keeping the first attempt only in `attempts` prevents
  // its timeout text from poisoning classification of a deterministic retry failure.
  original.fullOutput = attempt.fullOutput
  original.lines = [...attempt.lines]
  original.failure = attempt.failure
  original.exitCode = attempt.exitCode
  original.elapsedMs += attempt.elapsedMs
  if (attempt.status === 'passed') {
    original.status = 'passed'
    original.reason = 'timed out under machine contention; passed on an isolated retry'
    return
  }
  original.status = attempt.status
  original.reason = 'timed out under machine contention and failed again on an isolated retry'
}

function snapshotAttempt(state: WorkState) {
  return {
    elapsedMs: state.elapsedMs,
    exitCode: state.exitCode,
    failure: state.failure,
    fullOutput: state.fullOutput,
    status: state.status,
  } as const
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
