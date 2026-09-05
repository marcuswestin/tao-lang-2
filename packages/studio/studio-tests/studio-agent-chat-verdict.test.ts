// Semantic agent proof of concept: attributing a test failure to the change that caused it.
import { Describe, Expect, Test } from '@shared/test'
import { featureTestVerdict, firstLine, type TestRunSummary } from '../studio-src/agent-chat/FeatureVerdict'

function run(options: Partial<TestRunSummary> = {}): TestRunSummary {
  return { failed: 0, failures: [], passed: 3, status: 'passed', ...options }
}

const FEED = {
  message: 'Expected text "42 points by tester · 2 comments"\n  at HNReader.test.tao:9',
  name: 'fills the front page from the feed',
}

Describe('Agent change verdict', () => {
  Test('says the change held when the app still passes', () => {
    Expect(featureTestVerdict(run(), run())).toEqual({
      broke: [],
      heading: "The app's tests still pass: 3 of them.",
      repaired: [],
      status: 'held',
    })
  })

  Test('names the tests this change broke, and only those', () => {
    const before = run({ failed: 1, failures: [{ message: 'already red', name: 'flaky thread' }], passed: 2 })
    const after = run({ failed: 2, failures: [{ message: 'already red', name: 'flaky thread' }, FEED], passed: 1 })
    const verdict = featureTestVerdict(before, after)

    Expect(verdict.status).toBe('broke')
    Expect(verdict.heading).toBe('This change breaks 1 test the app passed before it.')
    // The test that was failing beforehand is not blamed on this change.
    Expect(verdict.broke).toEqual([{
      message: 'Expected text "42 points by tester · 2 comments"',
      name: 'fills the front page from the feed',
    }])
  })

  Test('counts a test that reported twice once, keeping the assertion over the source frame', () => {
    // The Tao runner reports a failing journey as the failed assertion followed by the source frame it sat in.
    const after = run({
      failed: 1,
      failures: [FEED, { message: '57 |     // the line the assertion sat on', name: FEED.name }],
      passed: 2,
    })
    const verdict = featureTestVerdict(run(), after)

    Expect(verdict.heading).toBe('This change breaks 1 test the app passed before it.')
    Expect(verdict.broke).toEqual([{
      message: 'Expected text "42 points by tester · 2 comments"',
      name: 'fills the front page from the feed',
    }])
  })

  Test('reports a change that repaired a failing test', () => {
    const before = run({ failed: 1, failures: [FEED], passed: 2 })
    const verdict = featureTestVerdict(before, run())

    Expect(verdict.status).toBe('held')
    Expect(verdict.repaired).toEqual(['fills the front page from the feed'])
    Expect(verdict.detail).toBe('It also repaired 1.')
  })

  Test('a run that produced no result is not a green verdict', () => {
    // `tao test` exits before running anything when a test file fails to compile, which is exactly what a
    // change that breaks a `.test.tao` file causes. Reading that as "everything passes" would make the one
    // check that can contradict the agent agree with it automatically.
    const empty = run({ failed: 0, passed: 0, status: 'failed' })
    const verdict = featureTestVerdict(run(), empty)

    Expect(verdict.status).toBe('unknown')
    Expect(verdict.heading).toBe('The test run produced no result, so nothing checked this change.')
    Expect(verdict.repaired).toEqual([])
  })

  Test('a run that never happened is not an app without tests', () => {
    const verdict = featureTestVerdict(run(), undefined)

    Expect(verdict.status).toBe('unknown')
    Expect(verdict.heading).toBe('The tests did not run, so nothing checked this change.')
  })

  Test('says the change broke nothing without claiming a red app is green', () => {
    const red = run({ failed: 1, failures: [FEED], passed: 2 })

    const verdict = featureTestVerdict(red, red)

    Expect(verdict.status).toBe('held')
    Expect(verdict.broke).toEqual([])
    // The old heading said "the app's tests still pass: 2 of them" while one was failing.
    Expect(verdict.heading).toBe('This change broke nothing: 2 still pass and the 1 red test was red before it.')
    Expect(verdict.detail).toBe('1 were already failing before it, and still are.')
  })

  Test('does not claim a verdict it cannot support', () => {
    Expect(featureTestVerdict(run(), run({ failed: 0, passed: 0, status: 'no-tests' })).heading)
      .toBe('This app declares no tests, so nothing checked the change.')
    // Without a baseline a failure cannot be attributed to the change, so it is reported without blame.
    const noBaseline = featureTestVerdict(undefined, run({ failed: 1, failures: [FEED], passed: 2 }))
    Expect(noBaseline.status).toBe('unknown')
    Expect(noBaseline.broke).toEqual([])
    Expect(noBaseline.heading).toBe('The app has failing tests; this change was not measured against a baseline.')
  })

  Test('keeps a multi-line failure message to the line that says what went wrong', () => {
    Expect(firstLine(FEED.message)).toBe('Expected text "42 points by tester · 2 comments"')
    Expect(firstLine('   \n\n  ')).toBe('no detail')
  })
})
