import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { ContentionRetry } from '../dev-src/repository-tests/ContentionRetry'
import { MachineLanes } from '../dev-src/repository-tests/MachineLanes'
import { RunArtifacts } from '../dev-src/repository-tests/RunArtifacts'
import { buildSummary, classifyFailure } from '../dev-src/repository-tests/RunSummary'
import { WorkGraph, type WorkState } from '../dev-src/repository-tests/WorkGraph'

/**
 * The retry exists to answer one question — was that timeout the machine or the code — so every
 * test here checks that the answer it gives is the one the run actually earned. A retry is never a
 * way to turn red into green: a node that recovers is reported as having failed and recovered, and
 * a node that fails again is reported as failed on its own merits.
 */

const contended = MachineLanes.contentionReport({ cpuCount: 8, peakLanes: 3, peakLoadAverage: 30 })
const quiet = MachineLanes.contentionReport({ cpuCount: 8, peakLanes: 1, peakLoadAverage: 2 })

function failedState(name: string, output: string): WorkState {
  return {
    ...WorkGraph.createState({ name, run: { args: [], command: 'true' } }),
    elapsedMs: 5_000,
    exitCode: 1,
    fullOutput: output,
    status: 'failed',
  }
}

async function runRetry(
  states: WorkState[],
  contention = contended,
  passing: readonly string[] = [],
  retryFailureOutput = 'timed out after 5000ms again',
) {
  const root = await mkTestDir('tao-contention-retry-')
  const location = RunArtifacts.locate({ lane: 'verify', repositoryRoot: root })
  await RunArtifacts.assignLogPaths(states, location)
  const machineLane = await MachineLanes.acquire({
    cpuCount: 8,
    lane: 'verify',
    registryRoot: FS.resolvePath('registry', root),
    repositoryRoot: root,
  })
  const attempted: string[] = []
  try {
    const outcome = await ContentionRetry.confirmContendedFailures({
      contention,
      location,
      machineLane,
      runNode: async state => {
        attempted.push(state.name)
        return passing.includes(state.name)
          ? { exitCode: 0, output: 'ok on its own' }
          : { exitCode: 1, output: retryFailureOutput }
      },
      states,
    })
    return { attempted, outcome }
  } finally {
    await machineLane.release()
  }
}

Describe('contended failure confirmation', () => {
  Test('a suite that only timed out because the machine was busy is re-run and recovers', async () => {
    const state = failedState('_test', 'error: Test "renders" timed out after 5000ms')

    const { attempted, outcome } = await runRetry([state], contended, ['_test'])

    Expect(attempted).toEqual(['_test'])
    Expect(outcome.recovered).toEqual(['_test'])
    Expect(state.status).toBe('passed')
    Expect(state.retried).toBe(true)
    // The run really did fail the first time. A pass that does not say so is a pass nobody can use
    // to find a real flake.
    Expect(state.reason).toBe('timed out under machine contention; passed on an isolated retry')
    Expect(state.fullOutput).toBe('ok on its own')
    Expect(state.attempts?.[0]?.fullOutput).toContain('timed out after 5000ms')
    Expect(state.attempts?.[1]?.fullOutput).toBe('ok on its own')
  })

  Test('a suite that times out again on its own stays failed and says the retry confirmed it', async () => {
    const state = failedState('_test', 'Timed out after 2000ms waiting for the language server.')

    const { outcome } = await runRetry([state])

    Expect(outcome.confirmed).toEqual(['_test'])
    Expect(state.status).toBe('failed')
    Expect(state.retried).toBe(true)
    Expect(state.reason).toBe('timed out under machine contention and failed again on an isolated retry')
  })

  Test('an ordinary assertion failure is never re-run, however busy the machine was', async () => {
    const state = failedState('_test', 'expect(received).toBe(expected)\n\nExpected: 3\nReceived: 4')

    const { attempted, outcome } = await runRetry([state])

    Expect(attempted).toEqual([])
    Expect(outcome).toEqual({ confirmed: [], recovered: [], unconfirmed: [] })
    Expect(state.status).toBe('failed')
    Expect(state.retried).toBeUndefined()
  })

  Test('a timeout on a machine this run had to itself is a repository failure and stays one', async () => {
    const state = failedState('_test', 'error: Test "renders" timed out after 5000ms')

    const { attempted } = await runRetry([state], quiet, ['_test'])

    Expect(attempted).toEqual([])
    Expect(state.status).toBe('failed')
    Expect(classifyFailure(state.fullOutput, { contention: quiet })).toBe('repository')
  })

  Test('does not claim isolation when no machine-wide exclusive lease is available', async () => {
    const state = failedState('_test', 'timed out after 5000ms')
    const location = RunArtifacts.locate({ lane: 'verify', repositoryRoot: await mkTestDir('tao-retry-unconfirmed-') })

    const outcome = await ContentionRetry.confirmContendedFailures({ contention: contended, location, states: [state] })

    Expect(outcome.unconfirmed).toEqual(['_test'])
    Expect(state.retried).toBeUndefined()
    Expect(state.status).toBe('failed')
    Expect(state.reason).toContain('failure is unconfirmed')
    Expect(state.reason).not.toContain('isolated')
  })

  Test('stops after a few nodes, because a lane full of timeouts is not a flake', async () => {
    const states = ['a', 'b', 'c', 'd', 'e'].map(name => failedState(name, 'timed out after 1000ms'))

    const { attempted } = await runRetry(states)

    Expect(attempted).toHaveLength(ContentionRetry.MAX_RETRIES)
    Expect(states.slice(ContentionRetry.MAX_RETRIES).every(state => state.retried === undefined)).toBe(true)
  })

  Test('classifies a deterministic retry failure without retaining the original timeout', async () => {
    const state = failedState('_test', 'timed out after 5000ms')

    await runRetry([state], contended, [], 'Expected: 3\nReceived: 4')
    const summary = buildSummary({
      contention: contended,
      elapsedMs: 1_000,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [state],
    })

    Expect(state.attempts?.[0]?.fullOutput).toContain('timed out')
    Expect(state.fullOutput).not.toContain('timed out')
    Expect(summary.gates[0]?.failureKind).toBe('repository')
  })

  Test('the summary names contention, the recoveries, and what never recovered', async () => {
    const recovered = failedState('_test', 'timed out after 5000ms')
    const stuck = failedState('_tao-check', 'timed out after 5000ms')
    await runRetry([recovered, stuck], contended, ['_test'])

    const summary = buildSummary({
      contention: contended,
      elapsedMs: 1_000,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [recovered, stuck],
    })

    Expect(summary.contention?.contended).toBe(true)
    Expect(summary.gates[0]?.retried).toBe(true)
    Expect(summary.gates[1]?.failureKind).toBe('machine-contention')
    Expect(summary.warnings[0]).toContain('3 Tao lanes ran at once')
    Expect(summary.warnings.some(warning => warning.includes('passed only on an isolated retry'))).toBe(true)
    Expect(summary.warnings.some(warning => warning.includes('failed again on an isolated retry'))).toBe(true)
  })
})
