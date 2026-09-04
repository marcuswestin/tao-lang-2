// Semantic agent proof of concept: does the change the agent just made still satisfy the app's own tests?
//
// The plan and the compile say a change is well-formed. Only the app's behavior tests say it is right. This
// compares a run taken before applying with a run taken after, so the verdict names what this change broke
// rather than what was already broken.

export type TestRunSummary = {
  failed: number
  failures: readonly { message: string; name: string }[]
  passed: number
  status: string
}

export type FeatureTestVerdict = {
  /** Tests that pass before the change and fail after it. */
  broke: readonly { message: string; name: string }[]
  detail?: string
  heading: string
  /** Tests that were already failing and now pass. Rare, and worth saying out loud when it happens. */
  repaired: readonly string[]
  status: 'held' | 'broke' | 'unknown'
}

function names(run: TestRunSummary | undefined): Set<string> {
  return new Set((run?.failures ?? []).map(failure => failure.name))
}

/** firstLine keeps a verdict readable: a test failure's message is often a whole diff. */
export function firstLine(message: string): string {
  const line = message.split('\n').map(entry => entry.trim()).find(entry => entry !== '')
  return line ?? 'no detail'
}

export function featureTestVerdict(
  before: TestRunSummary | undefined,
  after: TestRunSummary | undefined,
): FeatureTestVerdict {
  if (after === undefined) {
    // The run did not happen — the runner was busy, closed, or failed. That is not the same as an app with
    // no tests, and saying so would be the one wrong thing this verdict must never say.
    return {
      broke: [],
      detail: 'Nothing here can tell you whether the change is right, only that it compiles.',
      heading: 'The tests did not run, so nothing checked this change.',
      repaired: [],
      status: 'unknown',
    }
  }
  if (after.status === 'no-tests') {
    return {
      broke: [],
      detail: 'Nothing here can tell you whether the change is right, only that it compiles.',
      heading: 'This app declares no tests, so nothing checked the change.',
      repaired: [],
      status: 'unknown',
    }
  }
  // A run that reported neither a pass nor a failure did not measure anything. `tao test` exits early with no
  // summary when a test file fails to compile, and a change that breaks a `.test.tao` file does exactly that:
  // counting that as "everything still passes" would turn the one contradicting check into a rubber stamp.
  if (after.passed === 0 && after.failed === 0) {
    return {
      broke: [],
      detail: `The runner reported ${after.status} without running a test; check the test sources compile.`,
      heading: 'The test run produced no result, so nothing checked this change.',
      repaired: [],
      status: 'unknown',
    }
  }
  if (before === undefined) {
    // Without a baseline a failure cannot be attributed to this change, so report it without blaming it.
    return {
      broke: [],
      detail: after.failed === 0
        ? undefined
        : `${after.failed} failing, but they were not measured before the change.`,
      heading: after.failed === 0
        ? `The app's tests pass: ${after.passed} of them.`
        : 'The app has failing tests; this change was not measured against a baseline.',
      repaired: [],
      status: 'unknown',
    }
  }
  const failedBefore = names(before)
  const failedAfter = names(after)
  // One failing test can report several times: the assertion that failed, then the source frame around it.
  // The verdict counts tests, not records, and keeps the first message, which is the assertion itself.
  const seen = new Set<string>()
  const broke: { message: string; name: string }[] = []
  for (const failure of after.failures) {
    if (failedBefore.has(failure.name) || seen.has(failure.name)) {
      continue
    }
    seen.add(failure.name)
    broke.push({ message: firstLine(failure.message), name: failure.name })
  }
  const repaired = [...failedBefore].filter(name => !failedAfter.has(name))
  if (broke.length > 0) {
    return {
      broke,
      detail: 'Undo restores every file in one step.',
      heading: `This change breaks ${broke.length} ${broke.length === 1 ? 'test' : 'tests'} the app passed before it.`,
      repaired,
      status: 'broke',
    }
  }
  // "Still pass" is a claim about this change, not about the app. An app that was already red stays red, and
  // the heading has to say so rather than reporting the passing count as though nothing were failing.
  const stillFailing = after.failures.filter(failure => failedBefore.has(failure.name)).length
  const notes = [
    ...(repaired.length === 0 ? [] : [`It also repaired ${repaired.length}.`]),
    ...(after.failed === 0 ? [] : [`${after.failed} were already failing before it, and still are.`]),
  ]
  return {
    broke,
    ...(notes.length === 0 ? {} : { detail: notes.join(' ') }),
    heading: after.failed === 0
      ? `The app's tests still pass: ${after.passed} of them.`
      : `This change broke nothing: ${after.passed} still pass and the ${stillFailing} red ${
        stillFailing === 1 ? 'test was' : 'tests were'
      } red before it.`,
    repaired,
    status: 'held',
  }
}
