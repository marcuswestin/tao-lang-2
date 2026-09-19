import { expect, test } from '@playwright/test'
import {
  classifyApplicationFault,
  classifyNativeApplicationFault,
  validateApplicationFaultProvenance,
} from './FaultVerdict'

test('classifies only the complete Clockwork countdown failure signature as detected', () => {
  const verdict = classifyApplicationFault(
    'clockwork-countdown-frozen',
    report([
      failed(
        'Clockwork renders its configured seed and responds to a visible controlled clock advance',
        playwrightFailure(
          'Clockwork controlled countdown advances after visible clock advance',
          "getByText('Countdown: 0:09', { exact: true })",
        ),
      ),
      passed('Clockwork gives fresh same-seed browser realms the same visible random progression'),
      failed(
        'Clockwork does not advance a concurrent browser realm',
        playwrightFailure(
          'Clockwork concurrent realm countdown remains independent',
          "getByText('Countdown: 0:09', { exact: true })",
        ),
      ),
    ]),
  )

  expect(verdict).toEqual({
    fault: 'clockwork-countdown-frozen',
    reason: 'Every named healthy assertion failed with its expected marker.',
    status: 'detected',
  })
})

test('classifies a fully healthy HNReader report as an escaped persistence fault', () => {
  const verdict = classifyApplicationFault(
    'hnreader-reading-history-no-write',
    report([
      passed('opens a story, returns through browser-visible navigation, and keeps reading history after reload'),
    ]),
  )

  expect(verdict).toEqual({
    fault: 'hnreader-reading-history-no-write',
    reason: 'Every named healthy assertion passed.',
    status: 'escaped',
  })
})

test('detects the named HNReader reload assertion through nested Playwright suites', () => {
  const verdict = classifyApplicationFault(
    'hnreader-reading-history-no-write',
    nestedReport([
      failed(
        'opens a story, returns through browser-visible navigation, and keeps reading history after reload',
        playwrightFailure('HNReader reading history survives reload', "getByText('2 opened', { exact: true })"),
      ),
    ]),
  )

  expect(verdict.status).toBe('detected')
})

test('classifies unrelated failures and reporter errors as inconclusive', () => {
  const unrelated = classifyApplicationFault(
    'hnreader-reading-history-no-write',
    report([
      failed(
        'opens a story, returns through browser-visible navigation, and keeps reading history after reload',
        playwrightFailure('HNReader reading history survives reload', "getByText('2 opened', { exact: true })"),
      ),
      failed('Clockwork remains healthy', 'Unexpected browser assertion'),
    ]),
  )
  const global = classifyApplicationFault('hnreader-reading-history-no-write', {
    ...report([
      failed(
        'opens a story, returns through browser-visible navigation, and keeps reading history after reload',
        playwrightFailure('HNReader reading history survives reload', "getByText('2 opened', { exact: true })"),
      ),
    ]),
    errors: [{ message: 'Browser launch failed' }],
  })

  expect(unrelated.status).toBe('inconclusive')
  expect(global.status).toBe('inconclusive')
})

test('rejects a marker and locator that appear only in an adjacent Playwright codeframe', () => {
  const verdict = classifyApplicationFault(
    'clockwork-countdown-frozen',
    report([
      failed(
        'Clockwork renders its configured seed and responds to a visible controlled clock advance',
        adjacentCodeframe(
          'Clockwork controlled countdown advances after visible clock advance',
          "getByText('Countdown: 0:09', { exact: true })",
        ),
      ),
      passed('Clockwork gives fresh same-seed browser realms the same visible random progression'),
      failed(
        'Clockwork does not advance a concurrent browser realm',
        adjacentCodeframe(
          'Clockwork concurrent realm countdown remains independent',
          "getByText('Countdown: 0:09', { exact: true })",
        ),
      ),
    ]),
  )

  expect(verdict.status).toBe('inconclusive')
})

test('rejects a failed Clockwork control receipt whose next line names the countdown marker', () => {
  const verdict = classifyApplicationFault(
    'clockwork-countdown-frozen',
    report([
      failed(
        'Clockwork renders its configured seed and responds to a visible controlled clock advance',
        "Error: Control receipt assertion failed\nClockwork controlled countdown advances after visible clock advance getByText('Countdown: 0:09', { exact: true })",
      ),
      passed('Clockwork gives fresh same-seed browser realms the same visible random progression'),
      failed(
        'Clockwork does not advance a concurrent browser realm',
        playwrightFailure(
          'Clockwork concurrent realm countdown remains independent',
          "getByText('Countdown: 0:09', { exact: true })",
        ),
      ),
    ]),
  )

  expect(verdict.status).toBe('inconclusive')
})

test('rejects fault provenance whose generated target does not match the requested mutation', () => {
  const verdict = validateApplicationFaultProvenance('clockwork-countdown-frozen', {
    expectedVisibleAssertion: 'Countdown: 0:09',
    kind: 'clockwork-countdown-frozen',
    originalDigest: '0'.repeat(64),
    replacementDigest: '1'.repeat(64),
    targetPath: '_gen_tao-app/modules/external/Local.ts',
  })

  expect(verdict).toEqual({
    reason: 'The isolated build fault target does not match the browser assertion contract.',
    status: 'invalid',
  })
})

test('classifies only the Clockwork Maestro countdown assertion after its control receipt as detected', () => {
  const verdict = classifyNativeApplicationFault('clockwork-countdown-frozen', {
    commands: [
      assertVisible('COMPLETED', 'Control received: advance 1000ms'),
      assertVisible('FAILED', 'Countdown: 0:09'),
    ],
    junit:
      '<testsuite><testcase><failure>Assertion is false: "Countdown: 0:09" is visible</failure></testcase></testsuite>',
    receipt: nativeReceipt('clockwork-countdown-frozen', 'failed', 'native-ui-flow-failed', [
      command('expo', [], 0),
      command('maestro', ['test', '/flows/clockwork.yaml'], 1),
    ]),
  })

  expect(verdict.status).toBe('detected')
})

test('classifies only the HNReader post-relaunch reading history assertion as detected', () => {
  const verdict = classifyNativeApplicationFault('hnreader-reading-history-no-write', {
    commands: [
      assertVisible('COMPLETED', '2 opened'),
      appCommand('COMPLETED', 'killAppCommand'),
      appCommand('COMPLETED', 'launchAppCommand'),
      assertVisible('FAILED', '2 opened'),
    ],
    junit: '<testsuite><testcase><failure>Assertion is false: "2 opened" is visible</failure></testcase></testsuite>',
    receipt: nativeReceipt('hnreader-reading-history-no-write', 'failed', 'native-ui-flow-failed', [
      command('expo', [], 0),
      command('maestro', ['test', '/flows/hnreader.yaml'], 1),
    ]),
  })

  expect(verdict.status).toBe('detected')
})

test('classifies a complete native Maestro pass as an escaped fault and missing provenance as inconclusive', () => {
  const escaped = classifyNativeApplicationFault('clockwork-countdown-frozen', {
    commands: [assertVisible('COMPLETED', 'Countdown: 0:09')],
    junit: '<testsuite><testcase status="SUCCESS"/></testsuite>',
    receipt: nativeReceipt('clockwork-countdown-frozen', 'passed', undefined, [
      command('expo', [], 0),
      command('maestro', ['test', '/flows/clockwork.yaml'], 0),
    ]),
  })
  const missingProvenance = classifyNativeApplicationFault('clockwork-countdown-frozen', {
    commands: [assertVisible('FAILED', 'Countdown: 0:09')],
    junit:
      '<testsuite><testcase><failure>Assertion is false: "Countdown: 0:09" is visible</failure></testcase></testsuite>',
    receipt: {
      ...nativeReceipt('clockwork-countdown-frozen', 'failed', 'native-ui-flow-failed', [
        command('expo', [], 0),
        command('maestro', ['test', '/flows/clockwork.yaml'], 1),
      ]),
      preparation: {},
    },
  })

  expect(escaped.status).toBe('escaped')
  expect(missingProvenance.status).toBe('inconclusive')
})

test('rejects an HNReader failure without the matching post-kill app launch', () => {
  const verdict = classifyNativeApplicationFault('hnreader-reading-history-no-write', {
    commands: [
      assertVisible('COMPLETED', '2 opened'),
      appCommand('COMPLETED', 'killAppCommand'),
      assertVisible('FAILED', '2 opened'),
    ],
    junit: '<testsuite><testcase><failure>Assertion is false: "2 opened" is visible</failure></testcase></testsuite>',
    receipt: nativeReceipt('hnreader-reading-history-no-write', 'failed', 'native-ui-flow-failed', [
      command('expo', [], 0),
      command('maestro', ['test', '/flows/hnreader.yaml'], 1),
    ]),
  })

  expect(verdict.status).toBe('inconclusive')
})

test('rejects generic timeouts and command records that only resemble the expected assertion', () => {
  const timeout = classifyNativeApplicationFault('clockwork-countdown-frozen', {
    commands: [
      assertVisible('COMPLETED', 'Control received: advance 1000ms'),
      assertVisible('FAILED', 'Countdown: 0:09'),
    ],
    junit: '<testsuite><testcase><failure>Timed out waiting for the app</failure></testcase></testsuite>',
    receipt: nativeReceipt('clockwork-countdown-frozen', 'failed', 'native-ui-flow-failed', [
      command('expo', [], 0),
      command('maestro', ['test', '/flows/clockwork.yaml'], 1),
    ]),
  })
  const wrongShape = classifyNativeApplicationFault('clockwork-countdown-frozen', {
    commands: [
      { metadata: { evaluatedCommand: { text: 'Control received: advance 1000ms' }, status: 'COMPLETED' } },
      { metadata: { evaluatedCommand: { text: 'Countdown: 0:09' }, status: 'FAILED' } },
    ],
    junit:
      '<testsuite><testcase><failure>Assertion is false: "Countdown: 0:09" is visible</failure></testcase></testsuite>',
    receipt: nativeReceipt('clockwork-countdown-frozen', 'failed', 'native-ui-flow-failed', [
      command('expo', [], 0),
      command('maestro', ['test', '/flows/clockwork.yaml'], 1),
    ]),
  })

  expect(timeout.status).toBe('inconclusive')
  expect(wrongShape.status).toBe('inconclusive')
})

function report(tests: readonly ReturnType<typeof passed>[]): object {
  return {
    errors: [],
    stats: { unexpected: tests.filter(test => test.status === 'unexpected').length },
    suites: [{ specs: tests.map(test => ({ tests: [test], title: test.title })) }],
  }
}

function nestedReport(tests: readonly ReturnType<typeof passed>[]): object {
  return {
    errors: [],
    stats: { unexpected: tests.filter(test => test.status === 'unexpected').length },
    suites: [{ suites: [{ specs: tests.map(test => ({ tests: [test], title: test.title })) }] }],
  }
}

function passed(title: string): { results: readonly object[]; status: string; title: string } {
  return { results: [{ errors: [], status: 'passed' }], status: 'expected', title }
}

function failed(title: string, message: string): { results: readonly object[]; status: string; title: string } {
  return {
    results: [{ errors: [{ message }], status: 'failed' }],
    status: 'unexpected',
    title,
  }
}

function playwrightFailure(marker: string, locator: string): string {
  return `Error: ${marker}\n\nexpect(locator).toBeVisible failed\n\nLocator: ${locator}\nExpected: visible`
}

function adjacentCodeframe(marker: string, locator: string): string {
  return `Error: unrelated browser assertion\n\n  12 | await expect(page.${locator}, '${marker}').toBeVisible()\n> 13 | expect(actual, 'unrelated browser assertion').toBe(expected)`
}

function nativeReceipt(
  fault: 'clockwork-countdown-frozen' | 'hnreader-reading-history-no-write',
  status: 'failed' | 'passed',
  failureCode: string | undefined,
  commands: readonly object[],
): object {
  return {
    commands,
    ...(failureCode === undefined ? {} : { failure: { code: failureCode } }),
    preparation: { appId: appIdFor(fault), fault: provenance(fault) },
    status,
  }
}

function provenance(fault: 'clockwork-countdown-frozen' | 'hnreader-reading-history-no-write'): object {
  return {
    expectedVisibleAssertion: fault === 'clockwork-countdown-frozen' ? 'Countdown: 0:09' : '2 opened after reload',
    kind: fault,
    originalDigest: '0'.repeat(64),
    replacementDigest: '1'.repeat(64),
    targetPath: fault === 'clockwork-countdown-frozen'
      ? '_gen_tao-app/App.tsx'
      : '_gen_tao-app/modules/external/Local.ts',
  }
}

function command(command: string, args: readonly string[], exitCode: number): object {
  return { args, command, exitCode, signal: null }
}

function assertVisible(status: 'COMPLETED' | 'FAILED', textRegex: string): object {
  return {
    command: { assertConditionCommand: { condition: { visible: { textRegex } } } },
    metadata: { evaluatedCommand: { assertConditionCommand: { condition: { visible: { textRegex } } } }, status },
  }
}

function appCommand(status: 'COMPLETED' | 'FAILED', kind: 'killAppCommand' | 'launchAppCommand'): object {
  const appId = appIdFor('hnreader-reading-history-no-write')
  return {
    command: { [kind]: { appId } },
    metadata: { evaluatedCommand: { [kind]: { appId } }, status },
  }
}

function appIdFor(fault: 'clockwork-countdown-frozen' | 'hnreader-reading-history-no-write'): string {
  return fault === 'clockwork-countdown-frozen'
    ? 'dev.tao.taohostclockworktest'
    : 'dev.tao.taohosthnreadertest'
}
