import { Describe, Expect, Test, withCapturedOutput } from '@shared/test'
import { MachineLanes } from '../dev-src/repository-tests/MachineLanes'
import { TestResultSummary } from '../dev-src/repository-tests/TestResultSummary'
import { TestRunner } from '../dev-src/repository-tests/TestRunner'

function suiteState(name: string, sleepSeconds = 0) {
  return TestRunner.createSuiteState({ name, command: 'sleep', args: [String(sleepSeconds)] })
}

Describe('test runner suite scheduling', () => {
  Test('filtered Bun suites pass when another package owns the matching test', async () => {
    const suites = await TestRunner.discoverTestSuites('one package only')
    const devSuite = suites.find(suite => suite.name === 'dev')

    Expect(devSuite?.args).toContain('--pass-with-no-tests')
    Expect(devSuite?.args).toContain('--test-name-pattern=one package only')
  })

  Test('gives concurrent process-heavy developer tests a contention-safe timeout', async () => {
    const suites = await TestRunner.discoverTestSuites()
    const devSuite = suites.find(suite => suite.name === 'dev')

    Expect(devSuite?.args).toContain('--concurrent')
    Expect(devSuite?.args).toContain('--timeout=15000')
  })

  Test('runs performance checks as a dashboard suite', async () => {
    const suites = await TestRunner.discoverTestSuites()
    const performanceSuite = suites.find(suite => suite.name === 'performance-checks')

    Expect(
      performanceSuite?.args.some(argument =>
        argument.endsWith('/packages/dev/performance-checks/language-performance.test.ts')
      ),
    ).toBe(true)
  })

  Test('holds the Jest suite to the slots it reserved instead of letting it size to the machine', async () => {
    const suites = await TestRunner.discoverTestSuites()
    const jestSuite = suites.find(suite => suite.name === 'runtime-jest')

    // Jest defaults to `cpuCount - 1` workers. Inside a three-slot reservation that fills the
    // machine on its own, and on a machine already shared with another worktree it fills it twice.
    Expect(jestSuite?.args).toContain('--maxWorkers=3')
  })

  Test('narrows the Jest suite further when the whole lane has been narrowed', async () => {
    const suites = await TestRunner.discoverTestSuites('', 1)
    const jestSuite = suites.find(suite => suite.name === 'runtime-jest')

    Expect(jestSuite?.args).toContain('--maxWorkers=1')
  })

  Test('narrows the Jest child to the slots actually admitted after another lane joins', async () => {
    const suites = await TestRunner.discoverTestSuites()
    const jestSuite = suites.find(suite => suite.name === 'runtime-jest')!
    const state = TestRunner.createSuiteState(jestSuite)

    Expect(state.node.runForSlots?.(1).args).toContain('--maxWorkers=1')
    Expect(state.node.runForSlots?.(2).args).toContain('--maxWorkers=2')
  })

  Test('gives every native runner its own structured report artifact', async () => {
    const suites = await TestRunner.discoverTestSuites('', 3, { reportRoot: '/tmp/test-reports' })
    const devSuite = suites.find(suite => suite.name === 'dev')
    const jestSuite = suites.find(suite => suite.name === 'runtime-jest')

    Expect(devSuite?.args).toContain('--reporter=junit')
    Expect(devSuite?.args).toContain('--reporter-outfile=/tmp/test-reports/dev.xml')
    Expect(jestSuite?.args).toContain('--json')
    Expect(jestSuite?.args).toContain('--outputFile=/tmp/test-reports/runtime-jest.json')
  })

  Test('a suite plan keeps only the named suites and hands the Tao Apps suite its roots', async () => {
    const suites = await TestRunner.discoverTestSuites('', 3, {
      suites: new Set(['dev', 'runtime-jest', 'tao-apps']),
      taoAppPaths: ['Apps/WordFlower'],
    })

    Expect(suites.map(suite => suite.name)).toEqual(['dev', 'runtime-jest', 'tao-apps'])
    // Whole suites run in full: neither runner is asked to narrow by Git, because Bun's
    // `--changed` stops at the package boundary and Jest ignores `--changedSince` beside paths.
    Expect(suites.find(suite => suite.name === 'dev')?.args.some(arg => arg.startsWith('--changed'))).toBe(false)
    Expect(suites.find(suite => suite.name === 'dev')?.args).not.toContain('--pass-with-no-tests')
    Expect(suites.find(suite => suite.name === 'runtime-jest')?.args.some(arg => arg.startsWith('--changedSince')))
      .toBe(false)
    Expect(suites.find(suite => suite.name === 'tao-apps')?.args).toEqual(['test', 'Apps/WordFlower'])
    Expect(suites.find(suite => suite.name === 'tao-apps')?.files).toEqual(['Apps/WordFlower'])
  })

  Test('the complete run tests every app and the inventory names every suite it would run', async () => {
    const suites = await TestRunner.discoverTestSuites()
    const inventory = await TestRunner.suiteInventory()

    Expect(suites.find(suite => suite.name === 'tao-apps')?.args).toEqual(['test', 'Apps'])
    Expect(inventory.packageSuites).toContain('dev')
    Expect(inventory.packageSuites).toContain('shared')
    Expect(inventory.hasRuntimeJest).toBe(true)
    const expected = [...inventory.packageSuites, 'performance-checks', 'runtime-jest', 'tao-apps'].sort()
    Expect(suites.map(suite => suite.name).sort()).toEqual(expected)
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
    const states = [suiteState('cheap-a'), suiteState('tao-apps', 0.1), suiteState('cheap-b')]
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
    const states = [suiteState('cheap-a'), suiteState('tao-cli'), suiteState('runtime-jest')]
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

  Test('says nothing at all about a machine this run had to itself', async () => {
    const state = suiteState('validator')
    state.status = 'passed'
    const quiet = MachineLanes.contentionReport({ cpuCount: 18, peakLanes: 1, peakLoadAverage: 4 })

    // A note nobody needs is a note nobody reads, and the next one that matters gets skipped too.
    Expect(await report(state, quiet)).not.toContain('Machine contention')
  })
})
