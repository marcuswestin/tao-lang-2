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
  if (after === undefined || after.status === 'no-tests') {
    return {
      broke: [],
      detail: 'Nothing here can tell you whether the change is right, only that it compiles.',
      heading: 'This app declares no tests, so nothing checked the change.',
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
  return {
    broke,
    ...(repaired.length === 0 ? {} : { detail: `It also repaired ${repaired.length}.` }),
    heading: `The app's tests still pass: ${after.passed} of them.`,
    repaired,
    status: 'held',
  }
}
