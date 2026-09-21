import type { HostApplicationFault, HostFaultProvenance } from './HostBuild'

export type ApplicationFaultVerdict = Readonly<{
  fault: HostApplicationFault
  reason: string
  status: 'detected' | 'escaped' | 'inconclusive'
}>
export type ApplicationFaultProvenanceVerdict =
  | Readonly<{ provenance: HostFaultProvenance; status: 'valid' }>
  | Readonly<{ reason: string; status: 'invalid' }>

type FaultExpectation = Readonly<{ marker: string; test: string }>
type PlaywrightError = Readonly<{ message?: unknown }>
type PlaywrightResult = Readonly<{ errors?: unknown; status?: unknown }>
type PlaywrightTest = Readonly<{ results?: unknown; status?: unknown }>
type PlaywrightSpec = Readonly<{ tests?: unknown; title?: unknown }>
type PlaywrightSuite = Readonly<{ specs?: unknown; suites?: unknown }>
type PlaywrightReport = Readonly<{ errors?: unknown; stats?: unknown; suites: readonly unknown[] }>

/** The post-relaunch assertion marker shared by the authored journey and fault receipt classifier. */
export const HNREADER_AUTHORED_RELOAD_MARKER = 'HNReader authored journey reading history survives reload'

/** Classifies a deliberately faulted browser run without treating an arbitrary nonzero exit as proof. */
export function classifyApplicationFault(
  fault: HostApplicationFault,
  report: unknown,
): ApplicationFaultVerdict {
  if (!isPlaywrightReport(report)) {
    return inconclusive(fault, 'Playwright did not produce a complete JSON report.')
  }
  if (!Array.isArray(report.errors) || report.errors.length > 0) {
    return inconclusive(fault, 'Playwright reported a global error.')
  }
  const expectations = expectationsFor(fault)
  const tests = collectTests(report.suites)
  if (tests.length === 0) {
    return inconclusive(fault, 'Playwright reported no completed browser tests.')
  }
  const expectedTests = expectations.map(expectation => tests.find(test => test.title === expectation.test))
  if (expectedTests.some(test => test === undefined)) {
    return inconclusive(fault, 'Playwright did not report every fault-detection test.')
  }
  const failedExpected = expectations.every((expectation, index) =>
    expectedFaultFailure(expectedTests[index]!, expectation)
  )
  const allExpectedPassed = expectedTests.every(test => passed(test!))
  const otherTests = tests.filter(test => !expectations.some(expectation => expectation.test === test.title))
  if (!otherTests.every(passed)) {
    return inconclusive(fault, 'A browser test outside the expected fault assertions did not pass.')
  }
  if (failedExpected && unexpectedCount(report.stats) === expectations.length) {
    return { fault, reason: 'Every named healthy assertion failed with its expected marker.', status: 'detected' }
  }
  if (allExpectedPassed && unexpectedCount(report.stats) === 0) {
    return { fault, reason: 'Every named healthy assertion passed.', status: 'escaped' }
  }
  return inconclusive(fault, 'The browser failures did not match the complete expected fault signature.')
}

/** Confirms that a faulted run is tied to the generated mutation the browser is about to execute. */
export function validateApplicationFaultProvenance(
  fault: HostApplicationFault,
  provenance: unknown,
): ApplicationFaultProvenanceVerdict {
  if (!isHostFaultProvenance(provenance)) {
    return { reason: 'The isolated build did not publish complete fault provenance.', status: 'invalid' }
  }
  if (provenance.kind !== fault) {
    return { reason: 'The isolated build recorded a different fault kind.', status: 'invalid' }
  }
  if (
    provenance.targetPath !== targetPathFor(fault)
    || provenance.expectedVisibleAssertion !== expectedVisibleAssertionFor(fault)
  ) {
    return {
      reason: 'The isolated build fault target does not match the browser assertion contract.',
      status: 'invalid',
    }
  }
  if (!isSha256(provenance.originalDigest) || !isSha256(provenance.replacementDigest)) {
    return { reason: 'The isolated build fault provenance has invalid content digests.', status: 'invalid' }
  }
  if (provenance.originalDigest === provenance.replacementDigest) {
    return { reason: 'The isolated build fault did not change its generated artifact digest.', status: 'invalid' }
  }
  return { provenance, status: 'valid' }
}

function expectationsFor(fault: HostApplicationFault): readonly FaultExpectation[] {
  return fault === 'clockwork-countdown-frozen'
    ? [
      {
        marker: 'Clockwork controlled countdown advances after visible clock advance',
        test: 'Clockwork renders its configured seed and responds to a visible controlled clock advance',
      },
      {
        marker: 'Clockwork concurrent realm countdown remains independent',
        test: 'Clockwork does not advance a concurrent browser realm',
      },
    ]
    : [
      {
        marker: 'HNReader reading history survives reload',
        test: 'opens a story, returns through browser-visible navigation, and keeps reading history after reload',
      },
      {
        marker: HNREADER_AUTHORED_RELOAD_MARKER,
        test: 'executes the authored HNReader reading-history journey through browser-visible input and reload',
      },
    ]
}

function targetPathFor(fault: HostApplicationFault): string {
  return fault === 'clockwork-countdown-frozen'
    ? '_gen_tao-app/App.tsx'
    : '_gen_tao-app/modules/external/Local.ts'
}

function expectedVisibleAssertionFor(fault: HostApplicationFault): string {
  return fault === 'clockwork-countdown-frozen' ? 'Countdown: 0:09' : '2 opened after reload'
}

function collectTests(
  suites: readonly unknown[],
): Array<{ results: readonly PlaywrightResult[]; status: string; title: string }> {
  const tests: Array<{ results: readonly PlaywrightResult[]; status: string; title: string }> = []
  const visit = (suite: unknown): void => {
    if (!isPlaywrightSuite(suite)) {
      return
    }
    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        if (!isPlaywrightSpec(spec) || typeof spec.title !== 'string' || !Array.isArray(spec.tests)) {
          continue
        }
        for (const test of spec.tests) {
          if (isPlaywrightTest(test) && typeof test.status === 'string' && Array.isArray(test.results)) {
            tests.push({ results: test.results.filter(isPlaywrightResult), status: test.status, title: spec.title })
          }
        }
      }
    }
    if (Array.isArray(suite.suites)) {
      for (const nested of suite.suites) {
        visit(nested)
      }
    }
  }
  for (const suite of suites) {
    visit(suite)
  }
  return tests
}

function expectedFaultFailure(
  test: { results: readonly PlaywrightResult[]; status: string; title: string },
  expectation: FaultExpectation,
): boolean {
  return test.status === 'unexpected'
    && test.results.length === 1
    && test.results[0]?.status === 'failed'
    && Array.isArray(test.results[0].errors)
    && test.results[0].errors.length === 1
    && isPlaywrightError(test.results[0].errors[0])
    && typeof test.results[0].errors[0].message === 'string'
    && primaryErrorHeader(test.results[0].errors[0].message) === `Error: ${expectation.marker}`
}

function primaryErrorHeader(message: string): string | undefined {
  return message.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '').split(/\r?\n\r?\n/u)[0]?.trim()
}

function passed(test: { results: readonly PlaywrightResult[]; status: string }): boolean {
  return test.status === 'expected' && test.results.length === 1 && test.results[0]?.status === 'passed'
}

function unexpectedCount(stats: unknown): number | undefined {
  if (typeof stats !== 'object' || stats === null || Array.isArray(stats)) {
    return undefined
  }
  const unexpected = (stats as { unexpected?: unknown }).unexpected
  return typeof unexpected === 'number' && Number.isInteger(unexpected) && unexpected >= 0 ? unexpected : undefined
}

function inconclusive(fault: HostApplicationFault, reason: string): ApplicationFaultVerdict {
  return { fault, reason, status: 'inconclusive' }
}

function isPlaywrightReport(value: unknown): value is PlaywrightReport {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Array.isArray((value as { suites?: unknown }).suites)
}

function isPlaywrightSuite(value: unknown): value is PlaywrightSuite {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPlaywrightSpec(value: unknown): value is PlaywrightSpec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPlaywrightTest(value: unknown): value is PlaywrightTest {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPlaywrightResult(value: unknown): value is PlaywrightResult {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPlaywrightError(value: unknown): value is PlaywrightError {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHostFaultProvenance(value: unknown): value is HostFaultProvenance {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as Partial<HostFaultProvenance>).expectedVisibleAssertion === 'string'
    && typeof (value as Partial<HostFaultProvenance>).kind === 'string'
    && typeof (value as Partial<HostFaultProvenance>).originalDigest === 'string'
    && typeof (value as Partial<HostFaultProvenance>).replacementDigest === 'string'
    && typeof (value as Partial<HostFaultProvenance>).targetPath === 'string'
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value)
}
