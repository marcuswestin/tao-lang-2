import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { RunArtifacts } from '../dev-src/repository-tests/RunArtifacts'
import { RunTimings } from '../dev-src/repository-tests/RunTimings'
import { WorkGraph, type WorkState } from '../dev-src/repository-tests/WorkGraph'

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

  Test("records a real node's own CPU time as its duration, once it clears the plausibility floor", async () => {
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

      await RunArtifacts.finishRun({ location, states: [state], summary: { ok: true } })

      const store = await RunTimings.load({ repositoryRoot: root })
      // A tight in-process loop spends nearly all of its wall time on CPU, so the sample clears
      // `CPU_PLAUSIBILITY_MIN_RATIO` and `record` prefers it over wall time for this node's duration.
      Expect(store.nodes['cpu-burner']?.source).toBe('cpu')
      Expect(store.nodes['cpu-burner']?.lastCpuMs).toBe(state.cpuMs)
    })
  })

  Test('learns only from successful work, so a failed or interrupted node teaches the store nothing', async () => {
    await withRepository(async root => {
      const location = RunArtifacts.locate({
        lane: 'test',
        logRoot: '.artifacts/logs/test/only',
        repositoryRoot: root,
        stamp: 'only',
      })
      const failed = finishedState('broken', { elapsedMs: 900, startedAt: 0 })
      failed.status = 'failed'

      await RunArtifacts.finishRun({ location, states: [failed], summary: { ok: false } })

      Expect(await FS.exists(FS.resolvePath(RunTimings.HISTORY_PATH, root))).toBe(false)
    })
  })
})
