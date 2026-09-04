import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { TestAdvisory } from '../dev-src/repository-tests/TestAdvisory'
import { TestLedger, type TestObservation } from '../dev-src/repository-tests/TestLedger'
import { TestReport } from '../dev-src/repository-tests/TestReport'

async function withRepository(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkTestDir('tao-test-ledger-')
  try {
    await run(root)
  } finally {
    await FS.remove(root)
  }
}

async function writeTestFile(root: string, file = 'packages/example/example-tests/example.test.ts'): Promise<string> {
  await FS.writeText(FS.resolvePath(file, root), 'Test("example", () => {})\n')
  return file
}

function observation(file: string, outcome: TestObservation['outcome'], name = 'group > example'): TestObservation {
  return { durationMs: 10, file, name, outcome, suite: 'example' }
}

Describe('per-test ledger', () => {
  Test('missing and corrupt stores are cold starts', async () => {
    await withRepository(async root => {
      Expect(await TestLedger.load(root)).toEqual({ tests: {}, version: 1 })
      await FS.writeText(FS.resolvePath(TestLedger.LEDGER_PATH, root), '{broken')
      Expect(await TestLedger.load(root)).toEqual({ tests: {}, version: 1 })
    })
  })

  Test('a red full run retries failures and unrecorded files but skips green tests', async () => {
    await withRepository(async root => {
      const passedFile = await writeTestFile(root, 'packages/example/example-tests/passed.test.ts')
      const failedFile = await writeTestFile(root, 'packages/example/example-tests/failed.test.ts')
      const newFile = await writeTestFile(root, 'packages/example/example-tests/new.test.ts')
      await TestLedger.recordRun({
        fullRun: true,
        observations: [observation(passedFile, 'passed'), observation(failedFile, 'failed')],
        repositoryRoot: root,
        startedAt: Date.now() - 1_000,
      })

      const selection = await TestLedger.selectRetryFiles([
        { file: passedFile, suite: 'example' },
        { file: failedFile, suite: 'example' },
        { file: newFile, suite: 'example' },
      ], root)

      Expect(selection.files.map(file => file.file)).toEqual([failedFile, newFile])
      Expect(selection.greenTestCount).toBe(1)
    })
  })

  Test('a green full run settles every current test', async () => {
    await withRepository(async root => {
      const first = await writeTestFile(root, 'packages/example/example-tests/first.test.ts')
      const second = await writeTestFile(root, 'packages/example/example-tests/second.test.ts')
      await TestLedger.recordRun({
        fullRun: true,
        observations: [observation(first, 'passed'), observation(second, 'passed')],
        repositoryRoot: root,
        startedAt: Date.now() - 1_000,
      })

      const selection = await TestLedger.selectRetryFiles([
        { file: first, suite: 'example' },
        { file: second, suite: 'example' },
      ], root)
      Expect(selection.files).toEqual([])
      Expect(selection.greenTestCount).toBe(2)
    })
  })

  Test('changing a settled test file selects the whole file again', async () => {
    await withRepository(async root => {
      const file = await writeTestFile(root)
      await TestLedger.recordRun({
        fullRun: true,
        observations: [observation(file, 'passed')],
        repositoryRoot: root,
        startedAt: Date.now() - 1_000,
      })
      await FS.writeText(FS.resolvePath(file, root), 'Test("new test", () => {})\n')

      Expect((await TestLedger.selectRetryFiles([{ file, suite: 'example' }], root)).files)
        .toEqual([{ file, suite: 'example' }])
    })
  })

  Test('records unchanged-file outcome reversals and rolling slow-test durations', async () => {
    await withRepository(async root => {
      const file = await writeTestFile(root)
      await TestLedger.recordRun({
        fullRun: false,
        observations: [{ ...observation(file, 'passed'), durationMs: 100 }],
        repositoryRoot: root,
        startedAt: 1,
      })
      await TestLedger.recordRun({
        fullRun: false,
        observations: [{ ...observation(file, 'failed'), durationMs: 200 }],
        repositoryRoot: root,
        startedAt: 2,
      })

      Expect((await TestLedger.flakes(root))[0]?.reversals).toBe(1)
      Expect((await TestLedger.slowest(root))[0]?.durationMs).toBe(125)
      Expect((await FS.readText(FS.resolvePath(TestLedger.HISTORY_PATH, root))).trim().split('\n').length).toBe(2)
    })
  })

  Test('compacts long histories while retaining recent unchanged-file reversals', async () => {
    await withRepository(async root => {
      const file = await writeTestFile(root)
      const largeName = `group > ${'long-name-'.repeat(2_500)}`
      for (let index = 0; index < 30; index += 1) {
        await TestLedger.recordRun({
          fullRun: false,
          observations: [observation(file, index % 2 === 0 ? 'passed' : 'failed', largeName)],
          repositoryRoot: root,
          startedAt: index,
        })
      }

      const history = await FS.readFile(FS.resolvePath(TestLedger.HISTORY_PATH, root))
      Expect(history.byteLength).toBeLessThanOrEqual(1_000_000)
      Expect((await TestLedger.flakes(root))[0]?.reversals).toBeGreaterThan(0)
    })
  })
})

Describe('native test result reports', () => {
  Test('parses Bun JUnit into full-path names and outcomes', () => {
    const observations = TestReport.parseBunJunit(
      `
      <testsuites><testsuite name="file">
        <testcase name="passes &amp; reports" classname="outer &gt; inner" time="0.125" file="packages/x/x-tests/x.test.ts" />
        <testcase name="fails" classname="outer" time="0.5" file="packages/x/x-tests/x.test.ts"><failure /></testcase>
      </testsuite></testsuites>
    `,
      'x',
    )

    Expect(observations).toEqual([
      {
        durationMs: 125,
        file: 'packages/x/x-tests/x.test.ts',
        name: 'outer > inner > passes & reports',
        outcome: 'passed',
        suite: 'x',
      },
      {
        durationMs: 500,
        file: 'packages/x/x-tests/x.test.ts',
        name: 'outer > fails',
        outcome: 'failed',
        suite: 'x',
      },
    ])
  })

  Test('normalizes absolute Bun report paths to repository-relative test identities', () => {
    const observations = TestReport.parseBunJunit(
      '<testsuite><testcase name="works" file="/repo/packages/x/x-tests/x.test.ts" /></testsuite>',
      'x',
      '/repo',
    )

    Expect(observations[0]?.file).toBe('packages/x/x-tests/x.test.ts')
  })

  Test('parses Jest JSON assertions without relying on console summaries', () => {
    const observations = TestReport.parseJestJson(
      JSON.stringify({
        testResults: [{
          assertionResults: [{ ancestorTitles: ['outer'], duration: 45, status: 'passed', title: 'works' }],
          name: '/repo/packages/runtime-toolchain/runtime-toolchain-tests/a.jest-test.tsx',
        }],
      }),
      'runtime-jest',
      '/repo',
    )

    Expect(observations[0]).toEqual({
      durationMs: 45,
      file: 'packages/runtime-toolchain/runtime-toolchain-tests/a.jest-test.tsx',
      name: 'outer > works',
      outcome: 'passed',
      suite: 'runtime-jest',
    })
  })
})

Describe('full-run advisory', () => {
  const base = {
    changedPaths: [] as string[],
    hasMergeCommit: false,
    newestCommitAt: '2026-09-01T00:00:00Z',
    reference: 'abc',
  }

  Test('returns only the first matching reason', () => {
    const reason = TestAdvisory.fullRunReason(
      { ...base, changedPaths: ['packages/dev/x.ts', 'packages/runtime/y.ts'], hasMergeCommit: true },
      { lastFullRunStartedAt: '2026-09-02T00:00:00Z', tests: {}, version: 1 },
    )
    Expect(reason).toBe('packages/dev changed since the comparison point')
  })

  Test('recognizes a full run older than this branch', () => {
    Expect(TestAdvisory.fullRunReason(base, {
      lastFullRunStartedAt: '2026-08-31T00:00:00Z',
      tests: {},
      version: 1,
    })).toBe('the last complete test run predates this branch')
  })
})
