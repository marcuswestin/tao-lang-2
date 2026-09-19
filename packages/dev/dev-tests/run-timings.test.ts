import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { RunTimings } from '../dev-src/repository-tests/RunTimings'

async function withRepository(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkTestDir('tao-run-timings-')
  try {
    await run(root)
  } finally {
    await FS.remove(root)
  }
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

  Test('the average moves toward the newest run without being rewritten by it', async () => {
    await withRepository(async root => {
      const record = async (durationMs: number, stamp: string) =>
        await RunTimings.record({
          durations: new Map([['_typecheck', durationMs]]),
          lane: 'verify',
          repositoryRoot: root,
          stamp,
        })

      await record(1_000, 'first')
      Expect(RunTimings.expectedMs(await RunTimings.load({ repositoryRoot: root }), '_typecheck')).toBe(1_000)

      await record(2_000, 'second')
      const store = await RunTimings.load({ repositoryRoot: root })
      // 0.3 of the new sample plus 0.7 of the old average.
      Expect(RunTimings.expectedMs(store, '_typecheck')).toBe(1_300)
      Expect(store.nodes['_typecheck']?.lastMs).toBe(2_000)
      Expect(store.nodes['_typecheck']?.samples).toBe(2)
    })
  })

  Test('every run appends one history line naming its lane and node durations', async () => {
    await withRepository(async root => {
      await RunTimings.record({
        durations: new Map([['_typecheck', 1_000], ['_test', 2_500]]),
        lane: 'verify',
        repositoryRoot: root,
        stamp: '2026-09-01T00-00-00-000Z',
      })
      await RunTimings.record({
        durations: new Map([['doctor', 200]]),
        lane: 'verify-full',
        repositoryRoot: root,
        stamp: '2026-09-01T00-01-00-000Z',
      })

      const lines = (await FS.readText(FS.resolvePath(RunTimings.HISTORY_PATH, root))).trim().split('\n')
      Expect(lines.length).toBe(2)
      Expect(JSON.parse(lines[0]!)).toEqual({
        lane: 'verify',
        nodes: { _test: 2_500, _typecheck: 1_000 },
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
