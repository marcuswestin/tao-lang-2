import { CLI, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test, until } from '@shared/test'
import { TestAdvisory } from '../verification-src/TestAdvisory'
import { TestLedger, type TestObservation } from '../verification-src/TestLedger'
import { TestReport } from '../verification-src/TestReport'

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
      for (
        const value of [
          { tests: null, version: 1 },
          { tests: [], version: 1 },
          { tests: { bad: { id: 'bad', outcome: 'maybe' } }, version: 1 },
          { lastFullRunStartedAt: 'not-a-date', tests: {}, version: 1 },
        ]
      ) {
        await FS.writeJson(FS.resolvePath(TestLedger.LEDGER_PATH, root), value)
        Expect(await TestLedger.load(root)).toEqual({ tests: {}, version: 1 })
      }
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

  Test('a partial app run cannot erase a failure from the last full app run', async () => {
    await withRepository(async root => {
      await FS.writeText(FS.resolvePath('Apps/First/First.tao', root), 'app First\n')
      await FS.writeText(FS.resolvePath('Apps/Second/Second.tao', root), 'app Second\n')
      await TestLedger.recordRun({
        fullRun: true,
        observations: [observation('Apps', 'failed', 'all Tao behavior tests')],
        repositoryRoot: root,
        startedAt: Date.now() - 2_000,
      })

      await TestLedger.recordRun({
        fullRun: false,
        observations: [observation('Apps', 'passed', 'Tao behavior tests under Apps/First')],
        partialFiles: ['Apps'],
        repositoryRoot: root,
        startedAt: Date.now() - 1_000,
      })

      const retry = await TestLedger.selectRetryFiles([{ file: 'Apps', suite: 'example' }], root)
      Expect(retry.files).toEqual([{ file: 'Apps', suite: 'example' }])
      const records = Object.values(await TestLedger.load(root).then(store => store.tests))
      Expect(records.map(record => record.name).toSorted()).toEqual([
        'Tao behavior tests under Apps/First',
        'all Tao behavior tests',
      ])
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

  Test('compares parseable ledger timestamps chronologically rather than lexically', async () => {
    await withRepository(async root => {
      const file = await writeTestFile(root)
      const store = await TestLedger.recordRun({
        fullRun: true,
        observations: [observation(file, 'passed')],
        repositoryRoot: root,
        startedAt: Date.parse('2026-01-01T00:00:00.000Z'),
      })
      const record = Object.values(store.tests)[0]!
      record.lastPassedAt = 'Thu, 01 Jan 1970 00:00:00 GMT'
      await FS.writeJson(FS.resolvePath(TestLedger.LEDGER_PATH, root), store)

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

  Test('records no duration for a suite whose runner cannot attribute time to one test', async () => {
    // Under `--concurrent` Bun reports every test in a file as the time from that file's shared
    // start to its own completion, so the number is meaningless; `cli/dev-cli` is tuned that way.
    await withRepository(async root => {
      const file = await writeTestFile(root)
      await TestLedger.recordRun({
        fullRun: false,
        observations: [{ ...observation(file, 'passed'), durationMs: 6_200, suite: 'cli/dev-cli' }],
        repositoryRoot: root,
        startedAt: 1,
      })

      // It is absent rather than zero: a reader can tell "not measured" from "measured as fast".
      Expect((await TestLedger.slowest(root)).length).toBe(0)
    })
  })

  Test('compacts long histories while retaining adjacent outcomes for every test', async () => {
    await withRepository(async root => {
      const file = await writeTestFile(root)
      const observations = Array.from(
        { length: 40 },
        (_, index) => observation(file, 'passed', `group ${index} > ${'long-name-'.repeat(4_000)}`),
      )
      for (let run = 0; run < 3; run += 1) {
        await TestLedger.recordRun({
          fullRun: false,
          observations: observations.map(item => ({
            ...item,
            outcome: run % 2 === 0 ? 'passed' : 'failed',
          })),
          repositoryRoot: root,
          startedAt: run,
        })
      }

      const history = (await FS.readText(FS.resolvePath(TestLedger.HISTORY_PATH, root)))
        .trim().split('\n').map(line => JSON.parse(line) as { id: string })
      const counts = new Map<string, number>()
      for (const event of history) {
        counts.set(event.id, (counts.get(event.id) ?? 0) + 1)
      }
      Expect(history.length).toBeLessThan(120)
      Expect(counts.size).toBe(40)
      Expect([...counts.values()].every(count => count >= 2)).toBe(true)
      Expect(await TestLedger.flakes(root, 50)).toHaveLength(40)
    })
  })

  Test('serializes concurrent process updates without losing either result', async () => {
    await withRepository(async root => {
      const first = await writeTestFile(root, 'packages/example/example-tests/first.test.ts')
      const second = await writeTestFile(root, 'packages/example/example-tests/second.test.ts')
      const modulePath = Repo.resolvePath('packages/testing/verification/verification-src/TestLedger.ts')
      const sharedPath = Repo.resolvePath('packages/shared/shared-src/shared.ts')
      const script = `
        import { Errors, FS, Time } from ${JSON.stringify(sharedPath)}
        import { TestLedger } from ${JSON.stringify(modulePath)}
        const root = process.env['TAO_LEDGER_TEST_ROOT']
        const file = process.env['TAO_LEDGER_TEST_FILE']
        if (!root || !file) Errors.throwUnexpected('Missing fixture input.')
        await FS.writeText(FS.resolvePath('ready-' + FS.basename(file), root), '')
        while (!await FS.exists(FS.resolvePath('begin', root))) await Time.sleep(5)
        await TestLedger.recordRun({
          fullRun: false,
          observations: [{ file, name: 'group > test', outcome: 'passed', suite: 'example' }],
          repositoryRoot: root,
          startedAt: Date.now(),
        })
      `
      const runChild = (file: string) =>
        CLI.run('bun', {
          args: ['-e', script],
          env: { TAO_LEDGER_TEST_FILE: file, TAO_LEDGER_TEST_ROOT: root },
          stdio: 'pipe',
        })
      const children = [runChild(first), runChild(second)]
      try {
        await until(async () =>
          await FS.exists(FS.resolvePath(`ready-${FS.basename(first)}`, root))
          && await FS.exists(FS.resolvePath(`ready-${FS.basename(second)}`, root)), {
          description: 'both ledger writers to reach the barrier',
        })
        await FS.writeText(FS.resolvePath('begin', root), '')
        const results = await Promise.all(children)

        Expect(results.map(result => result.exitCode)).toEqual([0, 0])
        const ledger = await TestLedger.load(root)
        Expect(Object.values(ledger.tests).map(record => record.file).toSorted()).toEqual([first, second])
        Expect((await FS.readText(FS.resolvePath(TestLedger.HISTORY_PATH, root))).trim().split('\n')).toHaveLength(2)
      } finally {
        await FS.writeText(FS.resolvePath('begin', root), '').catch(() => {})
        await Promise.all(children).catch(() => {})
      }
    })
  })
})

Describe('native test result reports', () => {
  Test('reports missing and malformed native files as unavailable evidence', async () => {
    await withRepository(async root => {
      const missing = { format: 'bun-junit' as const, path: FS.resolvePath('missing.xml', root), suite: 'x' }
      Expect(await TestReport.read(missing, root)).toBeUndefined()
      await FS.writeText(missing.path, '<testcase broken')
      Expect(await TestReport.read(missing, root)).toBeUndefined()
      await FS.writeText(missing.path, '<testsuites>')
      Expect(await TestReport.read(missing, root)).toBeUndefined()
      await FS.writeText(missing.path, '<testsuites tests="1"></testsuites>')
      Expect(await TestReport.read(missing, root)).toBeUndefined()
      const malformed = { format: 'jest-json' as const, path: FS.resolvePath('bad.json', root), suite: 'x' }
      await FS.writeText(malformed.path, '{broken')
      Expect(await TestReport.read(malformed, root)).toBeUndefined()
      await FS.writeText(malformed.path, JSON.stringify({ testResults: [] }))
      Expect(await TestReport.read(malformed, root)).toBeUndefined()
      await FS.writeText(malformed.path, JSON.stringify({ numTotalTests: 1, testResults: [] }))
      Expect(await TestReport.read(malformed, root)).toBeUndefined()
    })
  })

  Test('accepts complete native reports that prove zero tests executed', async () => {
    await withRepository(async root => {
      const bunReport = { format: 'bun-junit' as const, path: FS.resolvePath('empty.xml', root), suite: 'x' }
      await FS.writeText(bunReport.path, '<testsuites tests="0"></testsuites>')
      Expect(await TestReport.read(bunReport, root)).toEqual([])
      const jestReport = { format: 'jest-json' as const, path: FS.resolvePath('empty.json', root), suite: 'x' }
      await FS.writeText(jestReport.path, JSON.stringify({ numTotalTests: 0, testResults: [] }))
      Expect(await TestReport.read(jestReport, root)).toEqual([])
    })
  })

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
          name: '/repo/packages/apps/expo-host/expo-host-tests/a.jest-test.tsx',
        }],
      }),
      'runtime-jest',
      '/repo',
    )

    Expect(observations[0]).toEqual({
      durationMs: 45,
      file: 'packages/apps/expo-host/expo-host-tests/a.jest-test.tsx',
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
    newestMergeAt: undefined,
    reference: 'abc',
  }

  Test('returns only the first matching reason', () => {
    const reason = TestAdvisory.fullRunReason(
      { ...base, changedPaths: ['packages/cli/dev-cli/x.ts', 'packages/apps/runtime/y.ts'], hasMergeCommit: true },
      { lastFullRunStartedAt: '2026-09-02T00:00:00Z', tests: {}, version: 1 },
    )
    Expect(reason).toBe('the developer or agent CLI changed since the comparison point')
  })

  Test('recognizes a full run older than this branch', () => {
    Expect(TestAdvisory.fullRunReason(base, {
      lastFullRunStartedAt: '2026-08-31T00:00:00Z',
      tests: {},
      version: 1,
    })).toBe('the last complete test run predates this branch')
  })

  Test('does not keep advising about a merge after a newer complete run', () => {
    Expect(TestAdvisory.fullRunReason({
      ...base,
      hasMergeCommit: true,
      newestMergeAt: '2026-09-01T12:00:00Z',
    }, {
      lastFullRunStartedAt: '2026-09-02T00:00:00Z',
      tests: {},
      version: 1,
    })).toBeUndefined()
  })
})
