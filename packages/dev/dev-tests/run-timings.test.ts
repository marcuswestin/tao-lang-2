import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { type NodeSample, RunTimings } from '../dev-src/repository-tests/RunTimings'

async function withRepository(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkTestDir('tao-run-timings-')
  try {
    await run(root)
  } finally {
    await FS.remove(root)
  }
}

/** sample fills in `wallMs` alone unless a test needs `cpuMs` or `concurrency` too. */
function sample(wallMs: number, extra: Partial<NodeSample> = {}): NodeSample {
  return { wallMs, ...extra }
}

Describe('run timings store', () => {
  Test('a missing store is a cold start, not an error', async () => {
    await withRepository(async root => {
      const store = await RunTimings.load({ repositoryRoot: root })

      Expect(store.nodes).toEqual({})
      Expect(RunTimings.expectedMs(store, '_typecheck')).toBeUndefined()
    })
  })

  Test('an unreadable store is a cold start too, so a bad file never fails a lane', async () => {
    await withRepository(async root => {
      await FS.writeText(FS.resolvePath(RunTimings.DURATIONS_PATH, root), '{ this is not json')

      Expect((await RunTimings.load({ repositoryRoot: root })).nodes).toEqual({})
    })
  })

  Test('a wall-only sample moves the average toward the newest run without being rewritten by it', async () => {
    await withRepository(async root => {
      const record = async (wallMs: number, stamp: string) =>
        await RunTimings.record({
          durations: new Map([['_typecheck', sample(wallMs)]]),
          lane: 'verify',
          repositoryRoot: root,
          stamp,
        })

      await record(1_000, 'first')
      Expect(RunTimings.expectedMs(await RunTimings.load({ repositoryRoot: root }), '_typecheck')).toBe(1_000)

      await record(2_000, 'second')
      const store = await RunTimings.load({ repositoryRoot: root })
      // 0.3 of the new sample plus 0.7 of the old average — the wall-time EMA weight, unchanged.
      Expect(RunTimings.expectedMs(store, '_typecheck')).toBe(1_300)
      Expect(store.nodes['_typecheck']?.lastMs).toBe(2_000)
      Expect(store.nodes['_typecheck']?.lastWallMs).toBe(2_000)
      Expect(store.nodes['_typecheck']?.lastCpuMs).toBeUndefined()
      Expect(store.nodes['_typecheck']?.source).toBe('wall')
      Expect(store.nodes['_typecheck']?.samples).toBe(2)
    })
  })

  Test('prefers a plausible cpu sample over wall time, at the faster cpu weight', async () => {
    await withRepository(async root => {
      // 950/1_000 clears the plausibility floor: this child did almost all its own work.
      await RunTimings.record({
        durations: new Map([['_test', sample(1_000, { concurrency: 1, cpuMs: 950 })]]),
        lane: 'verify',
        repositoryRoot: root,
        stamp: 'first',
      })
      const first = await RunTimings.load({ repositoryRoot: root })
      Expect(RunTimings.expectedMs(first, '_test')).toBe(950)
      Expect(first.nodes['_test']?.source).toBe('cpu')
      Expect(first.nodes['_test']?.lastConcurrency).toBe(1)

      await RunTimings.record({
        durations: new Map([['_test', sample(2_000, { cpuMs: 1_950 })]]),
        lane: 'verify',
        repositoryRoot: root,
        stamp: 'second',
      })
      const second = await RunTimings.load({ repositoryRoot: root })
      // 0.5 of the new sample plus 0.5 of the old average — the faster cpu-sourced weight, because a
      // cpu sample is not the number machine contention corrupts.
      Expect(RunTimings.expectedMs(second, '_test')).toBe(1_450)
    })
  })

  Test('falls back to wall time when the cpu share of wall is too low to trust', async () => {
    await withRepository(async root => {
      // A suite that mostly blocks on a spawned subprocess: 100ms of the direct child's own cpu
      // against a 6_000ms wall is a ratio resourceUsage() cannot tell apart from a real subprocess
      // suite, so it must not be trusted as the node's duration.
      await RunTimings.record({
        durations: new Map([['tao-cli', sample(6_000, { cpuMs: 100 })]]),
        lane: 'verify',
        repositoryRoot: root,
        stamp: 'only',
      })
      const store = await RunTimings.load({ repositoryRoot: root })

      Expect(RunTimings.expectedMs(store, 'tao-cli')).toBe(6_000)
      Expect(store.nodes['tao-cli']?.source).toBe('wall')
      Expect(store.nodes['tao-cli']?.lastCpuMs).toBe(100)
      Expect(store.nodes['tao-cli']?.lastWallMs).toBe(6_000)
    })
  })

  Test('every run appends one history line naming its lane and node samples', async () => {
    await withRepository(async root => {
      await RunTimings.record({
        durations: new Map([
          ['_typecheck', sample(1_000, { concurrency: 3 })],
          ['_test', sample(2_500, { cpuMs: 2_400, concurrency: 2 })],
        ]),
        lane: 'verify',
        repositoryRoot: root,
        stamp: '2026-09-01T00-00-00-000Z',
      })
      await RunTimings.record({
        durations: new Map([['doctor', sample(200)]]),
        lane: 'verify-full',
        repositoryRoot: root,
        stamp: '2026-09-01T00-01-00-000Z',
      })

      const lines = (await FS.readText(FS.resolvePath(RunTimings.HISTORY_PATH, root))).trim().split('\n')
      Expect(lines.length).toBe(2)
      Expect(JSON.parse(lines[0]!)).toEqual({
        lane: 'verify',
        nodes: {
          _test: { concurrency: 2, cpuMs: 2_400, wallMs: 2_500 },
          _typecheck: { concurrency: 3, wallMs: 1_000 },
        },
        stamp: '2026-09-01T00-00-00-000Z',
      })
      Expect(JSON.parse(lines[1]!).lane).toBe('verify-full')
    })
  })

  Test('a run with nothing measured leaves the store alone', async () => {
    await withRepository(async root => {
      await RunTimings.record({ durations: new Map(), lane: 'verify', repositoryRoot: root, stamp: 'empty' })

      Expect(await FS.exists(FS.resolvePath(RunTimings.HISTORY_PATH, root))).toBe(false)
    })
  })
})
