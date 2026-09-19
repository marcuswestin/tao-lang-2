import { FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import { FlakeTolerance, type ToleranceNode } from '../dev-src/repository-tests/FlakeTolerance'
import { buildSummary, formatGateSummary, formatVerdict } from '../dev-src/repository-tests/RunSummary'
import { TestLedger, type TestObservation, type ToleratedFlake } from '../dev-src/repository-tests/TestLedger'
import { TestRunner } from '../dev-src/repository-tests/TestRunner'
import { WorkGraph, type WorkState } from '../dev-src/repository-tests/WorkGraph'

const SUITE = 'shared'
const FILE = 'packages/shared/shared-tests/process-supervision.test.ts'
const NAME = 'process supervision > a supervised child survives its parent'
const ID = `${SUITE}::${FILE}::${NAME}`

async function withRepository(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkTestDir('tao-flake-tolerance-')
  try {
    await run(root)
  } finally {
    await FS.remove(root)
  }
}

async function writeTestFile(root: string, body = 'Test("supervision", () => {})\n'): Promise<void> {
  await FS.writeText(FS.resolvePath(FILE, root), body)
}

function observation(outcome: TestObservation['outcome'], name = NAME): TestObservation {
  return { durationMs: 10, file: FILE, name, outcome, suite: SUITE }
}

/** record replays one run's outcome for the named test, which is what builds the flake history. */
async function record(root: string, outcome: TestObservation['outcome'], startedAt: number): Promise<void> {
  await TestLedger.recordRun({
    fullRun: false,
    observations: [observation(outcome)],
    repositoryRoot: root,
    startedAt,
  })
}

/** replay writes one outcome per character: `p` passed, `f` failed. */
async function replay(root: string, outcomes: string): Promise<void> {
  for (const [index, outcome] of [...outcomes].entries()) {
    await record(root, outcome === 'p' ? 'passed' : 'failed', index + 1)
  }
}

function node(overrides: Partial<ToleranceNode> = {}): ToleranceNode {
  return {
    name: `${SUITE}#1`,
    status: 'failed',
    suite: SUITE,
    testObservations: [observation('failed')],
    ...overrides,
  }
}

function failedState(name: string, exitCode = 1): WorkState {
  return {
    ...WorkGraph.createState({ name, run: { args: [], command: 'true' } }),
    elapsedMs: 1_000,
    exitCode,
    fullOutput: '1 fail\n',
    status: 'failed',
  }
}

function passedState(name: string): WorkState {
  return {
    ...WorkGraph.createState({ name, run: { args: [], command: 'true' } }),
    elapsedMs: 1_000,
    exitCode: 0,
    status: 'passed',
  }
}

Describe('proven flakes stop failing a lane', () => {
  Test('a test that flipped twice without its file changing is tolerated, with its evidence', async () => {
    await withRepository(async root => {
      await writeTestFile(root)
      await replay(root, 'pfpf')

      const tolerated = await TestLedger.tolerated(root)

      Expect(tolerated.map(flake => flake.id)).toEqual([ID])
      Expect(tolerated[0]?.reversals).toBe(3)
      Expect(tolerated[0]?.evidence).toBe(`3 outcome reversals in the last 4 recorded runs with no change to ${FILE}`)
    })
  })

  Test('one reversal is a regression, not a flake, and is never tolerated', async () => {
    await withRepository(async root => {
      await writeTestFile(root)
      await replay(root, 'ppf')

      Expect((await TestLedger.flakes(root))[0]?.reversals).toBe(1)
      Expect(await TestLedger.tolerated(root)).toEqual([])
    })
  })

  Test('a test that stops flipping and starts failing loses its tolerance', async () => {
    await withRepository(async root => {
      await writeTestFile(root)
      await replay(root, 'pfpf')
      Expect((await TestLedger.tolerated(root)).map(flake => flake.id)).toEqual([ID])

      // Two more failures. With the failure being judged now that is three in a row, which is a
      // test that is simply failing however long its flake history is.
      await replay(root, 'ff')

      const flake = (await TestLedger.flakes(root))[0]
      Expect(flake?.reversals).toBe(3)
      Expect(flake?.consecutiveFailures).toBe(3)
      Expect(await TestLedger.tolerated(root)).toEqual([])
    })
  })

  Test('editing the test file withdraws the tolerance its old bytes earned', async () => {
    await withRepository(async root => {
      await writeTestFile(root)
      await replay(root, 'pfpf')
      Expect((await TestLedger.tolerated(root)).map(flake => flake.id)).toEqual([ID])

      await writeTestFile(root, 'Test("supervision", () => { rewritten() })\n')

      Expect(await TestLedger.tolerated(root)).toEqual([])
    })
  })

  Test('the window is the history that survives compaction, so old flips age out', async () => {
    await withRepository(async root => {
      await writeTestFile(root)
      // One pair of flips, then a long clean run of passes that pushes them out of the window.
      await replay(root, `pfp${'p'.repeat(TestLedger.FLAKE_WINDOW_EVENTS)}`)

      Expect(await TestLedger.tolerated(root)).toEqual([])
    })
  })

  Test('a node is tolerated only when the ledger accounts for every failure in it', () => {
    const flake: ToleratedFlake = {
      consecutiveFailures: 0,
      evidence: 'evidence',
      file: FILE,
      fileIdentity: 'identity',
      id: ID,
      name: NAME,
      observed: 4,
      reversals: 3,
      suite: SUITE,
    }
    const other = observation('failed', 'process supervision > a second, unproven test')

    Expect(FlakeTolerance.apply([node()], [flake]).nodes.has(`${SUITE}#1`)).toBe(true)
    Expect(FlakeTolerance.apply([node({ testObservations: [observation('failed'), other] })], [flake]).demoted)
      .toEqual([])
    Expect(FlakeTolerance.apply([node({ status: 'passed' })], [flake]).demoted).toEqual([])
    Expect(FlakeTolerance.apply([node({ testObservations: [] })], [flake]).demoted).toEqual([])
  })

  Test('a whole-process failure is never tolerated, however often it has flipped', () => {
    const standIn: ToleratedFlake = {
      consecutiveFailures: 0,
      evidence: 'evidence',
      file: FILE,
      fileIdentity: 'identity',
      id: `${SUITE}::${FILE}::suite process`,
      name: 'suite process',
      observed: 4,
      reversals: 3,
      suite: SUITE,
    }

    Expect(
      FlakeTolerance.apply(
        [node({ testObservations: [observation('failed', 'suite process')] })],
        [standIn],
      ).demoted,
    ).toEqual([])
  })

  Test('a tolerated node passes the lane while naming what bought it that verdict', () => {
    const summary = buildSummary({
      elapsedMs: 4_000,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [failedState(`${SUITE}#1`), passedState('_typecheck')],
      suiteOf: name => (name === `${SUITE}#1` ? SUITE : undefined),
      toleratedFlakes: [{
        evidence: '3 outcome reversals in the last 4 recorded runs',
        file: FILE,
        id: ID,
        node: `${SUITE}#1`,
      }],
    })

    const gate = summary.gates.find(candidate => candidate.name === `${SUITE}#1`)
    Expect(summary.status).toBe('passed')
    Expect(gate?.status).toBe('passed')
    Expect(gate?.tolerated).toEqual([ID])
    // The exit code survives the demotion, so `passed` beside `exit 1` shows a judgment was made.
    Expect(gate?.exitCode).toBe(1)
    Expect(gate?.failureKind).toBeUndefined()
    Expect(gate?.reason).toBe(`failed only on 1 known flake: ${ID}`)
    Expect(summary.toleratedFlakes?.map(flake => flake.id)).toEqual([ID])
    Expect(summary.warnings[0]).toBe('1 recorded flake failed in this run and did not fail it:')
    Expect(summary.warnings[1]).toBe(`  ${ID} (in ${SUITE}#1) — 3 outcome reversals in the last 4 recorded runs`)
    Expect(formatVerdict(summary)).toBe('verify: PASSED in 4.0s — tolerating 1 known flake')
    Expect(formatGateSummary(summary)).toContain(ID)
  })

  Test('a lane that also failed for a real reason still reports FAILED, and still says it tolerated', () => {
    const summary = buildSummary({
      elapsedMs: 4_000,
      lane: 'verify',
      logRoot: '/repo/logs',
      order: ['_typecheck', `${SUITE}#1`],
      states: [failedState(`${SUITE}#1`), failedState('_typecheck', 2)],
      toleratedFlakes: [{ evidence: 'evidence', file: FILE, id: ID, node: `${SUITE}#1` }],
    })

    Expect(summary.status).toBe('failed')
    Expect(summary.firstFailure?.name).toBe('_typecheck')
    Expect(formatVerdict(summary))
      .toBe('verify: FAILED in 4.0s — first failure: _typecheck — tolerating 1 known flake')
  })

  Test('a summary with nothing tolerated says nothing about tolerance', () => {
    const summary = buildSummary({
      elapsedMs: 1_000,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [passedState('_typecheck')],
    })

    Expect(summary.toleratedFlakes).toBeUndefined()
    Expect(formatVerdict(summary)).toBe('verify: PASSED in 1.0s')
  })

  Test('a sharded suite reports the tolerance one of its shards leaned on', () => {
    const summary = buildSummary({
      elapsedMs: 4_000,
      lane: 'verify',
      logRoot: '/repo/logs',
      states: [failedState(`${SUITE}#1`), passedState(`${SUITE}#2`)],
      suiteOf: () => SUITE,
      toleratedFlakes: [{ evidence: 'evidence', file: FILE, id: ID, node: `${SUITE}#1` }],
    })

    const rollup = formatGateSummary(summary)
    Expect(rollup).toContain(`- ${SUITE}: passed`)
    Expect(rollup).toContain('tolerated 1 known flake')
  })
})

/**
 * The same demotion through `./dev test`, started for real. The unit tests above prove what the
 * summary decides; this proves the test lane reaches that decision at all — it is the lane that
 * reports no gate rollup and returned its exit code from the node states, either of which would
 * have left a demoted flake failing `just test` while `just verify` passed on the same evidence.
 */
Describe('proven flakes stop failing the test lane too', () => {
  Test('a demoted failure exits zero and prints the history that bought the pass', async () => {
    await withRepository(async root => {
      // A registry-owned path, so this checkout's suite registry discovers it as the `shared` suite,
      // and a body whose reported test name is the one the ledger history below is keyed on.
      await writeTestFile(
        root,
        `import { describe, expect, test } from '${['bun', 'test'].join(':')}'\n`
          + `describe('process supervision', () => {\n`
          + `  test('a supervised child survives its parent', () => expect(1).toBe(2))\n`
          + `})\n`,
      )
      await replay(root, 'pfpf')
      Expect((await TestLedger.tolerated(root)).map(flake => flake.id)).toEqual([ID])

      // A real top-level lane would register on this machine and wait on every other worktree's
      // work. The registry root comes from `XDG_CACHE_HOME`, so pointing it inside this test gives
      // the lane a machine to itself.
      const cacheHome = Platform.runtimeProcess.env['XDG_CACHE_HOME']
      Platform.runtimeProcess.env['XDG_CACHE_HOME'] = FS.resolvePath('cache', root)
      try {
        const captured = await withCapturedOutput(() =>
          TestRunner.runTestRequest({ kind: 'file', path: FILE }, {
            jobs: 1,
            outputMode: 'quiet',
            repositoryRoot: root,
          })
        )
        const output = `${captured.stdout}${captured.stderr}`

        // The suite really did fail: this is a demotion, not a green run.
        Expect(output).toContain('1 fail')
        // And the lane does not fail on it — which the node states alone would never have said.
        Expect(captured.result).toBe(0)
        Expect(output).toContain('tolerating 1 known flake')
        // The evidence reaches the terminal, not only `summary.json`.
        Expect(output).toContain(ID)
        Expect(output).toContain('outcome reversals in the last')
      } finally {
        if (cacheHome === undefined) {
          delete Platform.runtimeProcess.env['XDG_CACHE_HOME']
        } else {
          Platform.runtimeProcess.env['XDG_CACHE_HOME'] = cacheHome
        }
      }
    })
  })
})
