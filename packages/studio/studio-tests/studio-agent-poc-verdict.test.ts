// Semantic agent proof of concept: attributing a test failure to the change that caused it.
import { Describe, Expect, Test } from '@shared/test'
import { featureTestVerdict, firstLine, type TestRunSummary } from '../studio-src/agent-poc/FeatureVerdict'

function run(options: Partial<TestRunSummary> = {}): TestRunSummary {
  return { failed: 0, failures: [], passed: 3, status: 'passed', ...options }
}

const FEED = {
  message: 'Expected text "42 points by tester · 2 comments"\n  at HNReader.test.tao:9',
  name: 'fills the front page from the feed',
}

Describe('Semantic agent PoC change verdict', () => {
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

  Test('does not claim a verdict it cannot support', () => {
    Expect(featureTestVerdict(run(), undefined).status).toBe('unknown')
    Expect(featureTestVerdict(run(), run({ status: 'no-tests' })).heading)
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
