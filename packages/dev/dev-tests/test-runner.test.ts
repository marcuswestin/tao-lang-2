import { Describe, Expect, Test } from '@shared/test'
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

  Test('runs performance checks as a dashboard suite', async () => {
    const suites = await TestRunner.discoverTestSuites()
    const performanceSuite = suites.find(suite => suite.name === 'performance-checks')

    Expect(
      performanceSuite?.args.some(argument =>
        argument.endsWith('/packages/dev/performance-checks/language-performance.test.ts')
      ),
    ).toBe(true)
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
