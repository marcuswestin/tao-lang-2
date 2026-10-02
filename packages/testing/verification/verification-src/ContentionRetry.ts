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
  /** Preserve the original lane's scoped test consent, no-cache and admission environment. */
  env?: WorkRunOptions['env']
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

  const confirmed: string[] = []
  const recovered: string[] = []
  const unconfirmed: string[] = []
  for (const original of retrying) {
    // Isolation belongs to one confirmation, not the whole serial retry batch. Releasing between
    // nodes lets peer worktrees use the machine while this lane prepares its next confirmation.
    const isolation = await options.machineLane?.acquireExclusive()
    if (isolation === undefined) {
      original.reason =
        'timed out under machine contention; exclusive confirmation was not obtained, so the failure is unconfirmed'
      unconfirmed.push(original.name)
      continue
    }
    const attempt = WorkGraph.createState(original.node)
    attempt.logPath = FS.resolvePath(`${WorkGraph.nodeLabel(attempt.node)}.retry.log`, options.location.logRoot)
    try {
      await WorkGraph.run([attempt], {
        env: options.env,
        jobs: 1,
        runNode: options.runNode,
        slotBroker: options.machineLane,
        watchInterrupt: () => () => {},
      })
    } finally {
      await isolation.release()
    }
    await writeRetryLog(attempt)
    adoptRetry(original, attempt)
    ;(attempt.status === 'passed' ? recovered : confirmed).push(original.name)
  }

  if (recovered.length > 0) {
    const resumable = resumableDependents(options.states)
    const attempts = resumable.map(state => WorkGraph.createState(state.node))
    for (const attempt of attempts) {
      attempt.logPath = FS.resolvePath(`${WorkGraph.nodeLabel(attempt.node)}.resume.log`, options.location.logRoot)
    }
    await WorkGraph.run(attempts, {
      env: options.env,
      jobs: options.machineLane?.ceiling ?? 1,
      runNode: options.runNode,
      slotBroker: options.machineLane,
      watchInterrupt: () => () => {},
    })
    for (const [index, attempt] of attempts.entries()) {
      const original = resumable[index]!
      await writeRetryLog(attempt)
      adoptResumed(original, attempt)
    }
  }
  return { confirmed, recovered, unconfirmed }
}

/** resumableDependents finds the skipped dependency closure made runnable by recovered gates. */
function resumableDependents(states: readonly WorkState[]): WorkState[] {
  const byName = new Map(states.map(state => [state.name, state]))
  const selected = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const state of states) {
      if (
        state.status !== 'skipped'
        || !state.reason?.startsWith('dependency failed:')
        || selected.has(state.name)
      ) {
        continue
      }
      const dependenciesReady = (state.node.needs ?? []).every(name => {
        const dependency = byName.get(name)
        return dependency === undefined || dependency.status === 'passed' || selected.has(name)
      })
      if (dependenciesReady) {
        selected.add(state.name)
        changed = true
      }
    }
  }
  return states.filter(state => selected.has(state.name))
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

/** adoptResumed records work that did not run until its recovered dependency had passed. */
function adoptResumed(original: WorkState, attempt: WorkState): void {
  original.fullOutput = attempt.fullOutput
  original.lines = [...attempt.lines]
  original.failure = attempt.failure
  original.exitCode = attempt.exitCode
  original.elapsedMs += attempt.elapsedMs
  original.status = attempt.status
  original.reason = attempt.reason
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
