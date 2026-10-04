import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { MachineLanes } from '../verification-src/MachineLanes'
import { RunHistory } from '../verification-src/RunHistory'

/**
 * The history is what survives a reclaimed worktree, and its overlap report is the one claim about a
 * run's isolation that does not depend on how often the machine was sampled. Each test is about a
 * lane another one could not have seen by sampling alone.
 */

Describe('run history', () => {
  Test('a lane that came and went inside a run is an overlap; one wholly before it is not', async () => {
    const registryRoot = await mkTestDir('tao-run-history-')
    const before = await MachineLanes.acquire({ cpuCount: 4, lane: 'test-file', registryRoot, repositoryRoot: '/a' })
    await before.release()
    const run = await MachineLanes.acquire({ cpuCount: 4, lane: 'verify-full', registryRoot, repositoryRoot: '/b' })
    // Registered and gone well inside one load-sampling interval, so only the lane log can know.
    const brief = await MachineLanes.acquire({ cpuCount: 4, lane: 'test-file', registryRoot, repositoryRoot: '/c' })
    await brief.release()
    await run.release()

    const overlap = await run.overlap()

    Expect(overlap.known).toBe(true)
    Expect(overlap.solo).toBe(false)
    Expect(overlap.lanes.map(lane => [lane.lane, lane.repositoryRoot])).toEqual([['test-file', '/c']])
    Expect(overlap.lanes[0]!.endedAt).toBeDefined()
  })

  Test('a run alone on the machine reports solo, and a lane still running after it does not', async () => {
    const registryRoot = await mkTestDir('tao-run-history-')
    const alone = await MachineLanes.acquire({ cpuCount: 4, lane: 'verify-full', registryRoot, repositoryRoot: '/a' })
    await alone.release()
    Expect((await alone.overlap()).solo).toBe(true)

    const run = await MachineLanes.acquire({ cpuCount: 4, lane: 'verify-full', registryRoot, repositoryRoot: '/a' })
    const outlasting = await MachineLanes.acquire({
      cpuCount: 4,
      lane: 'test-file',
      registryRoot,
      repositoryRoot: '/b',
    })
    await run.release()
    const overlap = await run.overlap()
    await outlasting.release()

    Expect(overlap.solo).toBe(false)
    Expect(overlap.lanes.map(lane => lane.repositoryRoot)).toEqual(['/b'])
  })

  Test("a lane registered from inside a run's own node is that run's work, not a neighbour", async () => {
    const registryRoot = await mkTestDir('tao-run-history-')
    const own = { endedAt: '2026-10-04T12:10:00.000Z', id: 'outer', startedAt: '2026-10-04T12:00:00.000Z' }
    await RunHistory.recordLaneInterval(registryRoot, {
      endedAt: '2026-10-04T12:05:00.000Z',
      id: 'child',
      lane: 'dev-test',
      parentLaneId: 'outer',
      pid: 2,
      repositoryRoot: '/a',
      startedAt: '2026-10-04T12:01:00.000Z',
    })
    await RunHistory.recordLaneInterval(registryRoot, {
      endedAt: '2026-10-04T12:00:30.000Z',
      id: 'neighbour',
      lane: 'verify-changed',
      pid: 3,
      repositoryRoot: '/b',
      startedAt: '2026-10-04T11:59:00.000Z',
    })

    const overlap = await RunHistory.overlap({ live: [], loadAverageAtStart: 12.34, own, registryRoot, seen: [] })

    Expect(overlap.lanes.map(lane => lane.id)).toEqual(['neighbour'])
    Expect(overlap.loadAverageAtStart).toBe(12.3)
  })

  Test('a failed run is recorded with its first failing gate and the line that says why', async () => {
    const registryRoot = await mkTestDir('tao-run-history-')
    const record = RunHistory.runRecord({
      elapsedMs: 222_336.4,
      firstFailure: {
        name: '_typecheck',
        output: "\n\nsrc/a.ts(3,28): error TS6133: 'x' is declared but its value is never read.\nmore\n",
      },
      gates: [
        { name: '_typecheck', status: 'failed' },
        { name: 'parser', status: 'passed' },
        { name: 'studio', status: 'skipped' },
      ],
      interrupted: false,
      lane: 'verify-full',
      landing: true,
      logRoot: '/a/.artifacts/logs/verify-full/stamp',
      repositoryRoot: '/a',
      startedAtMs: Date.parse('2026-10-04T17:08:49.542Z'),
      status: 'failed',
    })

    Expect(await RunHistory.recordRun(record, registryRoot)).toBe(true)
    const [recorded] = await RunHistory.readRuns(registryRoot)

    Expect(recorded).toMatchObject({
      elapsedMs: 222_336,
      endedAt: '2026-10-04T17:12:31.878Z',
      failedGates: ['_typecheck'],
      failure: {
        gate: '_typecheck',
        line: "src/a.ts(3,28): error TS6133: 'x' is declared but its value is never read.",
      },
      gates: { failed: 1, passed: 1, skipped: 1 },
      landing: true,
      status: 'failed',
    })
  })

  Test("a test runner's failed-test line beats an assertion diff that quotes the word error", () => {
    const output = [
      'error: expect(received).toEqual(expected)',
      '+     "severity": "error",',
      '(fail) Tao app TypeScript modules > typechecks in-repo app sidecars [12731.39ms]',
    ].join('\n')

    const record = RunHistory.runRecord({
      elapsedMs: 1,
      firstFailure: { name: 'cli/tao-cli#3', output },
      gates: [{ name: 'cli/tao-cli#3', status: 'failed' }],
      interrupted: false,
      lane: 'verify-changed',
      landing: false,
      logRoot: '/a',
      repositoryRoot: '/a',
      startedAtMs: 0,
      status: 'failed',
    })

    Expect(record.failure?.line).toBe(
      '(fail) Tao app TypeScript modules > typechecks in-repo app sidecars [12731.39ms]',
    )
  })

  Test('a landing is recorded with its outcome', async () => {
    const registryRoot = await mkTestDir('tao-run-history-')
    await RunHistory.recordLanding({
      branch: 'feat/x',
      elapsedMs: 386_000,
      endedAt: '2026-09-29T01:59:13.000Z',
      kind: 'landing',
      phases: [{ endedAt: '2026-09-29T01:58:00.000Z', name: 'verify', startedAt: '2026-09-29T01:53:00.000Z' }],
      repositoryRoot: '/a',
      startedAt: '2026-09-29T01:52:47.000Z',
      status: 'passed',
    }, registryRoot)

    Expect((await RunHistory.readLandings(registryRoot)).map(landing => [landing.branch, landing.status])).toEqual([
      ['feat/x', 'passed'],
    ])
  })
})
