import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { RunArtifacts } from '../verification-src/RunArtifacts'
import { RunTimings } from '../verification-src/RunTimings'
import { WorkGraph, type WorkState } from '../verification-src/WorkGraph'

async function withRepository(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkTestDir('tao-run-artifacts-')
  try {
    await run(root)
  } finally {
    await FS.remove(root)
  }
}

/** finishedState is a passed node with a chosen execution window, for the concurrency arithmetic. */
function finishedState(name: string, options: { elapsedMs: number; startedAt: number }): WorkState {
  const state = WorkGraph.createState({ name, run: { args: [], command: 'true' } })
  state.status = 'passed'
  state.startedAt = options.startedAt
  state.elapsedMs = options.elapsedMs
  return state
}

Describe('run artifacts timings', () => {
  Test("records each node's wall time and how many siblings overlapped its execution window", async () => {
    await withRepository(async root => {
      const location = RunArtifacts.locate({
        lane: 'test',
        logRoot: '.artifacts/logs/test/only',
        repositoryRoot: root,
        stamp: 'only',
      })
      // a and b overlap (0-1000 and 500-1500); c starts only once both have finished.
      const states = [
        finishedState('a', { elapsedMs: 1_000, startedAt: 0 }),
        finishedState('b', { elapsedMs: 1_000, startedAt: 500 }),
        finishedState('c', { elapsedMs: 500, startedAt: 2_000 }),
      ]

      await RunArtifacts.finishRun({ location, states, summary: { ok: true } })

      const store = await RunTimings.load({ repositoryRoot: root })
      Expect(store.nodes['a']?.lastWallMs).toBe(1_000)
      Expect(store.nodes['a']?.lastConcurrency).toBe(2)
      Expect(store.nodes['b']?.lastConcurrency).toBe(2)
      Expect(store.nodes['c']?.lastConcurrency).toBe(1)
      // These `WorkState`s are hand-built rather than run through `WorkGraph`'s real process runner,
      // so nothing ever sets their `cpuMs` — see the test below for a node that actually ran.
      Expect(store.nodes['a']?.source).toBe('wall')
      Expect(store.nodes['a']?.lastCpuMs).toBeUndefined()
    })
  })

  Test("records a real node's CPU accounting independently of scheduling delays", async () => {
    await withRepository(async root => {
      const location = RunArtifacts.locate({
        lane: 'test',
        logRoot: '.artifacts/logs/test/only',
        repositoryRoot: root,
        stamp: 'only',
      })
      const state = WorkGraph.createState({
        name: 'cpu-burner',
        run: {
          args: ['-e', 'let x = 0; for (let i = 0; i < 5e7; i++) { x += i } if (x < 0) throw x'],
          command: process.execPath,
        },
      })

      await WorkGraph.run([state], { watchInterrupt: () => () => {} })
      Expect(state.status).toBe('passed')
      Expect(Number.isFinite(state.cpuMs)).toBe(true)
      Expect(state.cpuMs).toBeGreaterThan(0)

      await RunArtifacts.finishRun({ location, states: [state], summary: { ok: true } })

      const store = await RunTimings.load({ repositoryRoot: root })
      // Contention can stretch elapsed time without adding CPU time. Preserve the real accounting;
      // fixed samples below prove duration selection without assuming a share of the host CPU.
      Expect(store.nodes['cpu-burner']?.lastCpuMs).toBe(state.cpuMs)
      Expect(store.nodes['cpu-burner']?.lastWallMs).toBe(state.elapsedMs)
    })
  })

  Test('selects CPU duration at the plausibility floor and wall duration below it', async () => {
    await withRepository(async root => {
      const location = RunArtifacts.locate({ lane: 'test', repositoryRoot: root, stamp: 'threshold' })
      const atFloor = finishedState('at-floor', { elapsedMs: 10_000, startedAt: 0 })
      const belowFloor = finishedState('below-floor', { elapsedMs: 10_000, startedAt: 0 })
      atFloor.cpuMs = 2_000
      belowFloor.cpuMs = 1_999

      await RunArtifacts.finishRun({ location, states: [atFloor, belowFloor], summary: { ok: true } })

      const store = await RunTimings.load({ repositoryRoot: root })
      Expect(store.nodes['at-floor']?.source).toBe('cpu')
      Expect(store.nodes['at-floor']?.emaMs).toBe(2_000)
      Expect(store.nodes['at-floor']?.lastCpuMs).toBe(2_000)
      Expect(store.nodes['below-floor']?.source).toBe('wall')
      Expect(store.nodes['below-floor']?.emaMs).toBe(10_000)
      Expect(store.nodes['below-floor']?.lastCpuMs).toBe(1_999)
    })
  })

  Test('a contended lane forwards only credible CPU samples to the timing store', async () => {
    await withRepository(async root => {
      const location = RunArtifacts.locate({ lane: 'verify', repositoryRoot: root, stamp: 'busy' })
      const cpu = finishedState('cpu', { elapsedMs: 10_000, startedAt: 0 })
      const waiting = finishedState('waiting', { elapsedMs: 10_000, startedAt: 0 })
      cpu.cpuMs = 7_000
      waiting.cpuMs = 100

      await RunArtifacts.finishRun({ cpuOnly: true, location, states: [cpu, waiting], summary: { ok: true } })

      const store = await RunTimings.load({ repositoryRoot: root })
      Expect(store.nodes['cpu']?.emaMs).toBe(7_000)
      Expect(store.nodes['waiting']).toBeUndefined()
    })
  })
})
