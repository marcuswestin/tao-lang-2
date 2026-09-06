import { Describe, Expect, Test, withCapturedOutput } from '@shared/test'
import { MachineLanes } from '../dev-src/repository-tests/MachineLanes'
import { TestResultSummary } from '../dev-src/repository-tests/TestResultSummary'
import { TestRunner } from '../dev-src/repository-tests/TestRunner'

function suiteState(name: string, sleepSeconds = 0, scheduling?: { cost?: number; priority?: number }) {
  return TestRunner.createSuiteState({ name, command: 'sleep', args: [String(sleepSeconds)], scheduling })
}

/** discover answers one selection from the real registry and returns the suites by name. */
async function discover(
  selection: Parameters<typeof TestRunner.discoverTestSuites>[0] = {},
  context: Parameters<typeof TestRunner.discoverTestSuites>[1] = {},
) {
  const result = await TestRunner.discoverTestSuites(selection, context)
  return { ...result, byName: new Map(result.suites.map(suite => [suite.name, suite])) }
}

Describe('test runner suite registry', () => {
  Test('a name pattern filters every Bun suite and leaves out the suite that cannot filter by name', async () => {
    const { byName, skipped } = await discover({ pattern: 'one package only' })

    Expect(byName.get('dev')?.args).toContain('--pass-with-no-tests')
    Expect(byName.get('dev')?.args).toContain('--test-name-pattern=one package only')
    Expect(byName.has('tao-apps')).toBe(false)
    // The summary's note comes from the registry entry, so the runner has no second flag to keep true.
    Expect(skipped).toEqual([{ name: 'tao-apps', reason: 'a test-name pattern cannot select Tao behavior tests' }])
  })

  Test('gives concurrent process-heavy developer tests a contention-safe timeout', async () => {
    const { byName } = await discover()

    Expect(byName.get('dev')?.args).toContain('--concurrent')
    Expect(byName.get('dev')?.args).toContain('--timeout=15000')
  })

  Test('runs performance checks as a dashboard suite', async () => {
    const { byName } = await discover()

    Expect(
      byName.get('performance-checks')?.args.some(argument =>
        argument.endsWith('/packages/dev/performance-checks/language-performance.test.ts')
      ),
    ).toBe(true)
  })

  Test('holds the Jest suite to the slots it reserved instead of letting it size to the machine', async () => {
    const { byName } = await discover()

    // Jest defaults to `cpuCount - 1` workers. Inside a three-slot reservation that fills the
    // machine on its own, and on a machine already shared with another worktree it fills it twice.
    Expect(byName.get('runtime-jest')?.args).toContain('--maxWorkers=3')
  })

  Test('narrows the Jest suite further when the whole lane has been narrowed', async () => {
    const { byName } = await discover({}, { jobs: 1 })

    Expect(byName.get('runtime-jest')?.args).toContain('--maxWorkers=1')
  })

  Test('narrows the Jest child to the slots actually admitted after another lane joins', async () => {
    const { byName } = await discover()
    const state = TestRunner.createSuiteState(byName.get('runtime-jest')!)
    const run = state.node.run
    Expect(typeof run).toBe('function')
    if (typeof run !== 'function') {
      return
    }

    Expect(run({ slots: 1 }).args).toContain('--maxWorkers=1')
    Expect(run({ slots: 2 }).args).toContain('--maxWorkers=2')
  })

  Test('gives every native runner its own structured report artifact', async () => {
    const { byName } = await discover({}, { jobs: 3, reportRoot: '/tmp/test-reports' })

    Expect(byName.get('dev')?.args).toContain('--reporter=junit')
    Expect(byName.get('dev')?.args).toContain('--reporter-outfile=/tmp/test-reports/dev.xml')
    Expect(byName.get('runtime-jest')?.args).toContain('--json')
    Expect(byName.get('runtime-jest')?.args).toContain('--outputFile=/tmp/test-reports/runtime-jest.json')
  })

  Test('a suite plan keeps only the named suites and hands the Tao Apps suite its roots', async () => {
    const { byName, suites } = await discover({
      files: new Map([['tao-apps', ['Apps/WordFlower']]]),
      kind: 'changed',
      suites: new Set(['dev', 'runtime-jest', 'tao-apps']),
    }, { jobs: 3 })

    Expect(suites.map(suite => suite.name)).toEqual(['dev', 'runtime-jest', 'tao-apps'])
    // Whole suites run in full: neither runner is asked to narrow by Git, because Bun's
    // `--changed` stops at the package boundary and Jest ignores `--changedSince` beside paths.
    Expect(byName.get('dev')?.args.some(arg => arg.startsWith('--changed'))).toBe(false)
    Expect(byName.get('dev')?.args).not.toContain('--pass-with-no-tests')
    Expect(byName.get('runtime-jest')?.args.some(arg => arg.startsWith('--changedSince'))).toBe(false)
    Expect(byName.get('tao-apps')?.args).toEqual(['test', 'Apps/WordFlower'])
    Expect(byName.get('tao-apps')?.files).toEqual(['Apps/WordFlower'])
  })

  Test('exact files run only their own suites, over only those files', async () => {
    const file = 'packages/shared/shared-tests/shared.test.ts'
    const { suites } = await discover({
      files: new Map([['shared', [file]]]),
      kind: 'file',
      suites: new Set(['shared']),
    })

    Expect(suites.map(suite => suite.name)).toEqual(['shared'])
    Expect(suites[0]?.files).toEqual([file])
    Expect(suites[0]?.args.filter(arg => arg.endsWith('.test.ts'))).toHaveLength(1)
  })

  Test('the complete run tests every app and the inventory names every suite it would run', async () => {
    const { byName, skipped, suites } = await discover()
    const inventory = await TestRunner.suiteInventory()

    Expect(skipped).toEqual([])
    Expect(byName.get('tao-apps')?.args).toEqual(['test', 'Apps'])
    Expect(inventory.packageSuites).toContain('dev')
    Expect(inventory.packageSuites).toContain('shared')
    Expect(inventory.hasRuntimeJest).toBe(true)
    const expected = [...inventory.packageSuites, 'performance-checks', 'runtime-jest', 'tao-apps'].sort()
    Expect(suites.map(suite => suite.name).sort()).toEqual(expected)
  })

  Test('weights the widest suites so the three largest fit inside the test gate together', async () => {
    const { byName } = await discover()

    Expect(byName.get('tao-apps')?.scheduling).toEqual({ priority: 5, cost: 8 })
    Expect(byName.get('runtime-jest')?.scheduling).toEqual({ priority: 4, cost: 3 })
    Expect(byName.get('runtime-toolchain')?.scheduling).toEqual({ priority: 3, cost: 2 })
    Expect(byName.get('dev')?.scheduling).toBeUndefined()
  })

  Test('a name-filter run fails only when reporter metadata proves zero tests executed', () => {
    const states = [suiteState('dev'), suiteState('runtime-jest')]
    for (const state of states) {
      state.status = 'passed'
      state.testObservations = []
    }

    Expect(TestRunner.noTestsMatched('name', [], states)).toBe(true)
    Expect(TestRunner.noTestsMatched('name', [{
      file: 'packages/dev/dev-tests/example.test.ts',
      name: 'not selected',
      outcome: 'skipped',
      suite: 'dev',
    }], states)).toBe(true)
    states[0]!.testReport = { format: 'bun-junit', path: '/missing.xml', suite: 'dev' }
    states[0]!.testObservations = undefined
    Expect(TestRunner.noTestsMatched('name', [{
      file: 'packages/runtime-toolchain/runtime-toolchain-tests/example.jest-test.ts',
      name: 'not selected',
      outcome: 'skipped',
      suite: 'runtime-jest',
    }], states)).toBe(false)
    Expect(TestRunner.noTestsMatched('changed', [], states)).toBe(false)
  })

  Test('routes exact Bun and runtime Jest files to their owning suites', async () => {
    Expect((await TestRunner.testFile('packages/shared/shared-tests/shared.test.ts')).suite).toBe('shared')
    Expect(
      (await TestRunner.testFile(
        'packages/runtime-toolchain/runtime-toolchain-tests/navigation-e2e.jest-test.tsx',
      )).suite,
    ).toBe('runtime-jest')
  })

  Test('a costly suite reserves the whole capacity before cheap suites start', async () => {
    const events: string[] = []
    const states = [
      suiteState('cheap-a'),
      suiteState('tao-apps', 0.1, { priority: 5, cost: 8 }),
      suiteState('cheap-b'),
    ]
    await TestRunner.runSuiteProcesses(states, {
      jobs: 2,
      onChange: () => {},
      onComplete: state => events.push(`complete ${state.name}`),
      onStart: state => events.push(`start ${state.name}`),
    })
    Expect(events[0]).toBe('start tao-apps')
    // tao-apps' cost clamps to the full capacity of 2, so both cheap suites wait for it.
    Expect(events[1]).toBe('complete tao-apps')
    Expect(events.slice(2).filter(event => event.startsWith('start')).sort())
      .toEqual(['start cheap-a', 'start cheap-b'])
    Expect(states.every(state => state.status === 'passed')).toBe(true)
  })

  Test('higher-priority suites start first under a single job', async () => {
    const started: string[] = []
    const states = [
      suiteState('cheap-a'),
      suiteState('tao-cli', 0, { priority: 2 }),
      suiteState('runtime-jest', 0, { priority: 4, cost: 3 }),
    ]
    await TestRunner.runSuiteProcesses(states, {
      jobs: 1,
      onChange: () => {},
      onStart: state => started.push(state.name),
    })
    Expect(started).toEqual(['runtime-jest', 'tao-cli', 'cheap-a'])
  })
})

Describe('test lane reporting on a shared machine', () => {
  const shared = MachineLanes.contentionReport({ cpuCount: 18, peakLanes: 3, peakLoadAverage: 44 })

  async function report(state: ReturnType<typeof suiteState>, contention = shared): Promise<string> {
    const captured = await withCapturedOutput(() => {
      TestResultSummary.printResultSummary([state], 1_000, { contention })
    })
    return `${captured.stdout}${captured.stderr}`
  }

  Test('names the contention and how to confirm a suite that ran out of time', async () => {
    const state = suiteState('validator')
    state.status = 'failed'
    state.exitCode = 1
    state.fullOutput = 'error: Test "resolves imports" timed out after 5000ms'

    const output = await report(state)

    Expect(output).toContain('Machine contention: 3 Tao lanes ran at once; load peaked at 44.0 on 18 CPUs.')
    Expect(output).toContain('validator ran out of time under that load')
    Expect(output).toContain('once the machine is quiet')
  })

  Test('says a suite only passed because it was run again on its own', async () => {
    const state = suiteState('runtime-jest')
    state.status = 'passed'
    state.retried = true
    state.reason = 'timed out under machine contention; passed on an isolated retry'

    Expect(await report(state)).toContain('passed on an isolated retry')
  })

  Test('uses process output counts when a native report is unavailable', async () => {
    const state = suiteState('dev')
    state.status = 'passed'
    state.fullOutput = ' 3 pass\n 0 fail\n 7 expect() calls\nRan 3 tests across 1 file.\n'

    const output = await report(state)

    Expect(output).toContain('tests 3; pass 3; fail 0; expect 7')
    Expect(output).not.toContain('tests 0; pass 0')
  })

  Test('does not repeat manual timeout advice after an isolated retry already ran', async () => {
    const state = suiteState('validator')
    state.status = 'failed'
    state.retried = true
    state.reason = 'timed out under machine contention and failed again on an isolated retry'
    state.fullOutput = 'timed out after 5000ms again'

    const output = await report(state)

    Expect(output).toContain('failed again on an isolated retry')
    Expect(output).not.toContain('Confirm it alone')
  })

  Test('names every suite the registry left out, with the registry reason', async () => {
    const state = suiteState('dev')
    state.status = 'passed'
    const captured = await withCapturedOutput(() => {
      TestResultSummary.printResultSummary([state], 1_000, {
        skippedSuites: [{ name: 'tao-apps', reason: 'a test-name pattern cannot select Tao behavior tests' }],
      })
    })

    Expect(captured.stdout).toContain(
      'Note: the tao-apps suite was skipped; a test-name pattern cannot select Tao behavior tests.',
    )
  })

  Test('says nothing at all about a machine this run had to itself', async () => {
    const state = suiteState('validator')
    state.status = 'passed'
    const quiet = MachineLanes.contentionReport({ cpuCount: 18, peakLanes: 1, peakLoadAverage: 4 })

    // A note nobody needs is a note nobody reads, and the next one that matters gets skipped too.
    Expect(await report(state, quiet)).not.toContain('Machine contention')
  })
})
