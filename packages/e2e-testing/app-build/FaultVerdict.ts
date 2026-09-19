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

/**
 * Classifies a faulted Maestro journey only when its receipt, JUnit output, and command trace
 * agree on the named healthy assertion. A failed native command alone is never fault evidence.
 */
export function classifyNativeApplicationFault(
  fault: HostApplicationFault,
  evidence: Readonly<{ commands: unknown; junit: unknown; receipt: unknown }>,
): ApplicationFaultVerdict {
  const receipt = nativeReceipt(evidence.receipt)
  if (receipt === undefined) {
    return inconclusive(fault, 'Native proof did not produce a complete receipt.')
  }
  const provenance = validateApplicationFaultProvenance(fault, receipt.preparation?.fault)
  if (provenance.status === 'invalid') {
    return inconclusive(fault, provenance.reason)
  }
  const journey = nativeJourney(receipt.commands, fault)
  if (journey === 'invalid') {
    return inconclusive(fault, 'Native receipt did not complete only its final Maestro journey command.')
  }
  const junit = parseJUnit(evidence.junit)
  if (junit === undefined) {
    return inconclusive(fault, 'Maestro did not produce one complete JUnit testcase.')
  }
  const commands = maestroCommands(evidence.commands)
  if (commands === undefined) {
    return inconclusive(fault, 'Maestro did not produce a complete journey command trace.')
  }
  if (
    receipt.status === 'passed' && journey === 'passed' && junit.failure === undefined
    && commands.every(command => command.status === 'COMPLETED')
  ) {
    return { fault, reason: 'The complete native Maestro journey passed.', status: 'escaped' }
  }
  if (
    receipt.status === 'failed'
    && receipt.failureCode === 'native-ui-flow-failed'
    && journey === 'failed'
    && typeof junit.failure === 'string'
    && expectedNativeFailure(fault, junit.failure, commands, receipt.preparation?.appId)
  ) {
    return {
      fault,
      reason: 'Only the named healthy native assertion failed in the Maestro journey.',
      status: 'detected',
    }
  }
  return inconclusive(fault, 'The native failure did not match the complete expected fault signature.')
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
    : [{
      marker: 'HNReader reading history survives reload',
      test: 'opens a story, returns through browser-visible navigation, and keeps reading history after reload',
    }]
}

function targetPathFor(fault: HostApplicationFault): string {
  return fault === 'clockwork-countdown-frozen'
    ? '_gen_tao-app/App.tsx'
    : '_gen_tao-app/modules/external/Local.ts'
}

function expectedVisibleAssertionFor(fault: HostApplicationFault): string {
  return fault === 'clockwork-countdown-frozen' ? 'Countdown: 0:09' : '2 opened after reload'
}

type NativeReceipt = Readonly<{
  commands: readonly unknown[]
  failureCode?: string
  preparation?: Readonly<{ appId?: string; fault?: unknown }>
  status: 'blocked' | 'failed' | 'passed'
}>
type MaestroCommand = Readonly<{
  appId?: string
  assertion?: string
  kind: 'assertion' | 'kill' | 'launch' | 'other'
  status: 'COMPLETED' | 'FAILED'
}>

function nativeReceipt(value: unknown): NativeReceipt | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const candidate = value as { commands?: unknown; failure?: unknown; preparation?: unknown; status?: unknown }
  if (!Array.isArray(candidate.commands) || !['blocked', 'failed', 'passed'].includes(String(candidate.status))) {
    return undefined
  }
  const failure = candidate.failure
  const failureCode = typeof failure === 'object' && failure !== null && !Array.isArray(failure)
      && typeof (failure as { code?: unknown }).code === 'string'
    ? (failure as { code: string }).code
    : undefined
  const preparation =
    typeof candidate.preparation === 'object' && candidate.preparation !== null && !Array.isArray(candidate.preparation)
      ? {
        appId: typeof (candidate.preparation as { appId?: unknown }).appId === 'string'
          ? (candidate.preparation as { appId: string }).appId
          : undefined,
        fault: (candidate.preparation as { fault?: unknown }).fault,
      }
      : undefined
  return { commands: candidate.commands, failureCode, preparation, status: candidate.status as NativeReceipt['status'] }
}

function nativeJourney(commands: readonly unknown[], fault: HostApplicationFault): 'failed' | 'invalid' | 'passed' {
  if (commands.length === 0) {
    return 'invalid'
  }
  const commandReceipts = commands.map(commandReceipt)
  if (commandReceipts.some(command => command === undefined)) {
    return 'invalid'
  }
  const completeReceipts = commandReceipts as readonly NonNullable<typeof commandReceipts[number]>[]
  const last = completeReceipts.at(-1)!
  const expectedFlow = fault === 'clockwork-countdown-frozen' ? 'flows/clockwork.yaml' : 'flows/hnreader.yaml'
  if (last.command !== 'maestro' || !last.args.some(argument => argument.endsWith(expectedFlow))) {
    return 'invalid'
  }
  if (!completeReceipts.slice(0, -1).every(succeededNativeCommand)) {
    return 'invalid'
  }
  return succeededNativeCommand(last) ? 'passed' : failedNativeCommand(last) ? 'failed' : 'invalid'
}

function commandReceipt(
  value: unknown,
):
  | Readonly<{ args: readonly string[]; command: string; error?: unknown; exitCode: unknown; signal: unknown }>
  | undefined
{
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const candidate = value as {
    args?: unknown
    command?: unknown
    error?: unknown
    exitCode?: unknown
    signal?: unknown
  }
  if (
    typeof candidate.command !== 'string' || !Array.isArray(candidate.args)
    || !candidate.args.every(argument => typeof argument === 'string')
  ) {
    return undefined
  }
  return candidate as Readonly<
    { args: readonly string[]; command: string; error?: unknown; exitCode: unknown; signal: unknown }
  >
}

function succeededNativeCommand(command: Readonly<{ error?: unknown; exitCode: unknown; signal: unknown }>): boolean {
  return command.error === undefined && command.exitCode === 0 && command.signal === null
}

function failedNativeCommand(command: Readonly<{ error?: unknown; exitCode: unknown; signal: unknown }>): boolean {
  return command.error === undefined && typeof command.exitCode === 'number' && command.exitCode !== 0
    && command.signal === null
}

function parseJUnit(value: unknown): Readonly<{ failure?: string }> | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const cases = [...value.matchAll(/<testcase(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/testcase>)/gu)]
  if (cases.length !== 1) {
    return undefined
  }
  const body = cases[0]?.[1]
  if (body === undefined) {
    return {}
  }
  const failures = [...body.matchAll(/<failure(?:\s[^>]*)?>([\s\S]*?)<\/failure>/gu)]
  return failures.length === 1 && failures[0]?.[1] !== undefined ? { failure: failures[0][1] } : undefined
}

function maestroCommands(value: unknown): readonly MaestroCommand[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined
  }
  const commands: MaestroCommand[] = []
  for (const record of value) {
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      return undefined
    }
    const metadata = (record as { metadata?: unknown }).metadata
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
      return undefined
    }
    const status = (metadata as { status?: unknown }).status
    if (status !== 'COMPLETED' && status !== 'FAILED') {
      return undefined
    }
    const evaluated = (metadata as { evaluatedCommand?: unknown }).evaluatedCommand
    const command = maestroCommand(status, evaluated)
    if (command === undefined) {
      return undefined
    }
    commands.push(command)
  }
  return commands
}

function maestroCommand(
  status: MaestroCommand['status'],
  evaluated: unknown,
): MaestroCommand | undefined {
  const command = objectValue(evaluated)
  if (command === undefined) {
    return undefined
  }
  const assertion = objectValue(command['assertConditionCommand'])
  if (assertion !== undefined) {
    const condition = objectValue(assertion['condition'])
    const visible = condition === undefined ? undefined : objectValue(condition['visible'])
    if (visible === undefined || typeof visible['textRegex'] !== 'string') {
      return undefined
    }
    return { assertion: visible['textRegex'], kind: 'assertion', status }
  }
  const kill = objectValue(command['killAppCommand'])
  if (kill !== undefined) {
    return typeof kill['appId'] === 'string' ? { appId: kill['appId'], kind: 'kill', status } : undefined
  }
  const launch = objectValue(command['launchAppCommand'])
  if (launch !== undefined) {
    return typeof launch['appId'] === 'string' ? { appId: launch['appId'], kind: 'launch', status } : undefined
  }
  return { kind: 'other', status }
}

function expectedNativeFailure(
  fault: HostApplicationFault,
  failure: string,
  commands: readonly MaestroCommand[],
  appId: string | undefined,
): boolean {
  if (fault === 'clockwork-countdown-frozen') {
    const receipt = commands.findIndex(command =>
      command.status === 'COMPLETED' && command.kind === 'assertion'
      && command.assertion === 'Control received: advance 1000ms'
    )
    const countdown = commands.findIndex(command =>
      command.status === 'FAILED' && command.kind === 'assertion' && command.assertion === 'Countdown: 0:09'
    )
    return failure.includes('Countdown: 0:09')
      && receipt >= 0
      && countdown > receipt
      && commands.filter(command => command.kind === 'assertion' && command.assertion === 'Countdown: 0:09').length
        === 1
      && commands.filter(command => command.status === 'FAILED').length === 1
  }
  if (appId === undefined) {
    return false
  }
  const opened = commands.filter(command => command.kind === 'assertion' && command.assertion === '2 opened')
  const first = commands.findIndex(command =>
    command.kind === 'assertion' && command.assertion === '2 opened' && command.status === 'COMPLETED'
  )
  const kill = commands.findIndex((command, index) =>
    index > first && command.kind === 'kill' && command.status === 'COMPLETED' && command.appId === appId
  )
  const launch = commands.findIndex((command, index) =>
    index > kill && command.kind === 'launch' && command.status === 'COMPLETED' && command.appId === appId
  )
  const second = commands.findIndex((command, index) =>
    index > launch && command.kind === 'assertion' && command.assertion === '2 opened' && command.status === 'FAILED'
  )
  return failure.includes('2 opened')
    && opened.length === 2
    && first >= 0
    && kill > first
    && launch > kill
    && second > launch
    && commands.filter(command => command.status === 'FAILED').length === 1
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
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
