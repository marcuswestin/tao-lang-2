import {
  HostControlError,
  type HostController,
  type HostObservation,
  type HostRevision,
  type HostSession,
  type HostTarget,
} from '@host-control'
import { AppiumNoSuchElementError } from '@host-control/appium'
import { Errors, FS, Switch, Time } from '@shared'
import {
  type HostJourney,
  type HostJourneyAdapter,
  type HostJourneyOperation,
  type HostJourneySelection,
  runHostJourney,
} from '../../journey/HostJourney'

export type AppiumAndroidHostFault = Readonly<{
  expectedAssertion: Readonly<{
    operation: 'expect'
    sourceMarker: string
    sourcePath: string
    text: string
  }>
  kind: string
}>

/** The host bridge advances Tao's native test clock through a run-scoped platform action. */
type AppiumAndroidHostControl = Readonly<{
  advance: (request: Readonly<{ milliseconds: number; runId: string }>) => Promise<void>
}>

export type AppiumAndroidHostProofOptions = Readonly<{
  artifactRoot: string
  control: AppiumAndroidHostControl
  controller: HostController
  fault?: AppiumAndroidHostFault
  journey: HostJourney
  revision: HostRevision
  runId: string
  target: string
}>

export type AppiumAndroidHostProofReceipt = Readonly<{
  cleanupFailure?: Readonly<{ message: string }>
  fault?: AppiumAndroidHostFault & { verdict: 'detected' | 'escaped' | 'inconclusive' }
  failure?: Readonly<{ message: string }>
  journey: Readonly<{ check: string; sourcePath: string }>
  retainsTargetLease?: true
  screenshot?: string
  status: 'failed' | 'passed'
  timeline: readonly AppiumAndroidHostProofStep[]
  version: 1
}>

export type AppiumAndroidHostProofStep = Readonly<{
  assertion?: Readonly<
    | { kind: 'navigationTitle'; title: string }
    | { kind: 'text'; text: string }
  >
  operation: HostJourneyOperation['kind']
  outcome: 'failed' | 'passed'
  sourceMarker?: string
  sourcePath: string
}>

/**
 * runAppiumAndroidHostProof executes an authored Tao check through an actual host-control session.
 * A supplied fault is evidence only when the named authored assertion fails; a transport or setup
 * failure is intentionally inconclusive rather than a false claim that the mutation was detected.
 */
export async function runAppiumAndroidHostProof(
  options: AppiumAndroidHostProofOptions,
): Promise<AppiumAndroidHostProofReceipt> {
  const receiptPath = FS.resolvePath('appium-android/proof.receipt.json', options.artifactRoot)
  let session: HostSession | undefined
  let screenshot: string | undefined
  const timeline: AppiumAndroidHostProofStep[] = []
  let receipt: AppiumAndroidHostProofReceipt
  try {
    session = await options.controller.openSession({
      artifactRoot: options.artifactRoot,
      mode: 'acceptance',
      revision: options.revision,
      target: options.target,
    })
    await runHostJourney(
      options.journey,
      appiumAndroidJourneyAdapter(session, options.control, options.runId, timeline),
    )
    screenshot = (await session.captureScreenshot('journey-passed')).artifactPath
    receipt = {
      ...(options.fault === undefined ? {} : { fault: { ...options.fault, verdict: 'escaped' as const } }),
      journey: { check: options.journey.check.name, sourcePath: options.journey.sourcePath },
      screenshot,
      status: 'passed',
      timeline,
      version: 1,
    }
  } catch (error) {
    if (session !== undefined) {
      screenshot = await session.captureScreenshot('journey-failed').then(capture => capture.artifactPath).catch(() =>
        undefined
      )
    }
    const message = Errors.messageOf(error)
    const verdict = options.fault === undefined ? undefined : classifyAppiumAndroidFault(timeline, options.fault)
    receipt = {
      ...(options.fault === undefined ? {} : { fault: { ...options.fault, verdict: verdict! } }),
      failure: { message },
      journey: { check: options.journey.check.name, sourcePath: options.journey.sourcePath },
      ...(retainsTargetLease(error) ? { retainsTargetLease: true as const } : {}),
      ...(screenshot === undefined ? {} : { screenshot }),
      status: 'failed',
      timeline,
      version: 1,
    }
  }
  let cleanupFailure: unknown
  if (session !== undefined) {
    await session.close(session.descriptor().lease).catch(error => {
      cleanupFailure = error
    })
  }
  await options.controller.close().catch(error => {
    cleanupFailure ??= error
  })
  if (cleanupFailure !== undefined) {
    receipt = { ...receipt, cleanupFailure: { message: Errors.messageOf(cleanupFailure) }, status: 'failed' }
  }
  await FS.writeJson(receiptPath, receipt)
  return receipt
}

/** appiumAndroidJourneyAdapter maps one authored Tao journey onto the Android driver. */
function appiumAndroidJourneyAdapter(
  session: HostSession,
  control: AppiumAndroidHostControl,
  runId: string,
  timeline: AppiumAndroidHostProofStep[],
): HostJourneyAdapter {
  let appName: string | undefined
  return {
    capabilities: [
      'advanceTime',
      'assertNavigationTitle',
      'assertText',
      'press',
      'relaunch',
      'runApplication',
      'select',
    ],
    async execute(operation) {
      const step: Omit<AppiumAndroidHostProofStep, 'outcome'> = {
        operation: operation.kind,
        ...(operation.source.range === undefined ? {} : { sourceMarker: sourceMarker(operation) }),
        sourcePath: operation.source.filePath,
        ...(operation.kind === 'expect'
          ? { assertion: { kind: 'text' as const, text: operation.text } }
          : operation.kind === 'expectNavigationTitle'
          ? { assertion: { kind: 'navigationTitle' as const, title: operation.title } }
          : {}),
      }
      try {
        await Switch.kind(operation, {
          advance: async next =>
            await advanceNativeClock(session, control, runId, next.milliseconds, appName === 'HNReaderStub'),
          back: unsupportedJourneyOperation,
          enter: unsupportedJourneyOperation,
          expect: async next =>
            await assertText(session, next.text, next.missing, next.selections, next.source.filePath),
          expectCheckboxState: unsupportedJourneyOperation,
          expectFocusRegion: unsupportedJourneyOperation,
          expectGroup: unsupportedJourneyOperation,
          expectInputValue: unsupportedJourneyOperation,
          expectNavigationTitle: async next => await assertNavigationTitle(session, next.title, next.source.filePath),
          expectTarget: unsupportedJourneyOperation,
          expectToolbarCommand: unsupportedJourneyOperation,
          expectVerbs: unsupportedJourneyOperation,
          focus: unsupportedJourneyOperation,
          hover: unsupportedJourneyOperation,
          narrow: unsupportedJourneyOperation,
          press: async next => await press(session, next.selector, next.text, next.selections),
          pressDown: unsupportedJourneyOperation,
          pressKey: unsupportedJourneyOperation,
          pressToolbarCommand: unsupportedJourneyOperation,
          pressUp: unsupportedJourneyOperation,
          relaunch: async () =>
            await session.perform({
              expectedRevision: session.descriptor().revision,
              kind: 'relaunchApplication',
              lease: session.descriptor().lease,
            }),
          run: async next => {
            appName = next.appName
            if (appName === 'HNReaderStub') {
              await assertReady(session, appName)
            }
          },
          submit: unsupportedJourneyOperation,
        })
        timeline.push({ ...step, outcome: 'passed' })
      } catch (error) {
        timeline.push({ ...step, outcome: 'failed' })
        throw error
      }
    },
  }
}

async function advanceNativeClock(
  session: HostSession,
  control: AppiumAndroidHostControl,
  runId: string,
  milliseconds: number,
  requiresWrapperReceipt: boolean,
): Promise<void> {
  await control.advance({ milliseconds, runId })
  if (!requiresWrapperReceipt) {
    return
  }
  const expectedReceipt = `Control received: advance ${milliseconds}ms`
  const receipt = await Time.pollUntil(async () => {
    const observation = await observeIfPresent(session, { kind: 'tag', value: 'tao-host-control-receipt' })
    return observation?.visible === true
        && (observation.text === expectedReceipt || observation.accessibilityLabel === expectedReceipt)
      ? observation
      : undefined
  }, { intervalMs: 100, timeoutMs: 10_000 })
  if (receipt === undefined) {
    throw new HostControlError(
      'assertion',
      `Appium Android did not display the native host-control receipt '${expectedReceipt}'.`,
    )
  }
}

async function assertReady(session: HostSession, appName: string): Promise<void> {
  const observation = await observe(session, { kind: 'tag', value: 'tao-host-ready' })
  if (!observation.visible) {
    throw new HostControlError('assertion', `Appium Android did not display the host-ready marker for '${appName}'.`)
  }
}

async function assertText(
  session: HostSession,
  text: string,
  missing: boolean,
  selections: readonly HostJourneySelection[],
  sourcePath: string,
): Promise<void> {
  const target = scopedTarget(selections, { kind: 'text', value: text })
  if (!missing) {
    const found = await Time.pollUntil(async () => {
      const observation = await observeIfPresent(session, target)
      return observation?.visible === true
          && (observation.text === text || observation.accessibilityLabel === text)
        ? observation
        : undefined
    }, { intervalMs: 100, timeoutMs: 10_000 })
    if (found === undefined) {
      throw new HostControlError(
        'assertion',
        `Tao journey assertion at ${sourcePath}: expected visible text '${text}'.`,
      )
    }
    return
  }
  try {
    const observation = await observe(session, target)
    const found = observation.visible && (observation.text === text || observation.accessibilityLabel === text)
    if (found) {
      throw new HostControlError(
        'assertion',
        `Tao journey assertion at ${sourcePath}: expected hidden text '${text}'.`,
      )
    }
  } catch (error) {
    if (isMissingElement(error)) {
      return
    }
    throw error
  }
}

async function assertNavigationTitle(session: HostSession, title: string, sourcePath: string): Promise<void> {
  const observation = await observe(session, { kind: 'tag', value: '__tao_navigation_title' })
  const actual = observation.text ?? observation.accessibilityLabel
  if (!observation.visible || actual !== title) {
    throw new HostControlError(
      'assertion',
      `Tao journey assertion at ${sourcePath}: expected navigation title '${title}'.`,
      { actual, expected: title },
    )
  }
}

async function observe(session: HostSession, target: HostTarget): Promise<HostObservation> {
  return await session.observe({ expectedRevision: session.descriptor().revision, target })
}

async function observeIfPresent(session: HostSession, target: HostTarget): Promise<HostObservation | undefined> {
  try {
    return await observe(session, target)
  } catch (error) {
    if (error instanceof AppiumNoSuchElementError) {
      return undefined
    }
    throw error
  }
}

async function press(
  session: HostSession,
  selector: string,
  value: string,
  selections: readonly HostJourneySelection[],
): Promise<void> {
  const target: HostTarget = selector === 'tag'
    ? { kind: 'tag', value }
    : selector === 'label'
    ? { kind: 'accessibility', name: value }
    : { kind: 'text', value }
  const observation = await observe(session, scopedTarget(selections, target))
  await session.perform({
    expectedRevision: session.descriptor().revision,
    kind: 'click',
    lease: session.descriptor().lease,
    observation,
  })
}

/** classifyAppiumAndroidFault requires the fault's exact source-ranged authored assertion to fail. */
export function classifyAppiumAndroidFault(
  timeline: readonly AppiumAndroidHostProofStep[],
  fault: AppiumAndroidHostFault,
): 'detected' | 'inconclusive' {
  const final = timeline.at(-1)
  if (
    final?.outcome === 'failed'
    && final.operation === fault.expectedAssertion.operation
    && final.sourcePath === fault.expectedAssertion.sourcePath
    && final.sourceMarker === fault.expectedAssertion.sourceMarker
    && final.assertion?.kind === 'text'
    && final.assertion.text === fault.expectedAssertion.text
    && timeline.slice(0, -1).every(step => step.outcome === 'passed')
  ) {
    return 'detected'
  }
  return 'inconclusive'
}

function sourceMarker(operation: HostJourneyOperation): string {
  const range = operation.source.range!
  return `${operation.source.filePath}:${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`
}

function retainsTargetLease(error: unknown): boolean {
  return error instanceof Errors.HostEnvironmentError && error.details?.['retainsTargetLease'] === true
}

function isMissingElement(error: unknown): boolean {
  return error instanceof AppiumNoSuchElementError
}

function scopedTarget(selections: readonly HostJourneySelection[], target: HostTarget): HostTarget {
  const scope = selections.reduce<HostTarget | undefined>(
    (current, selection) =>
      current === undefined
        ? { kind: 'tag', occurrence: selection.index, value: selection.tag }
        : {
          kind: 'scoped',
          scope: current,
          target: { kind: 'tag', occurrence: selection.index, value: selection.tag },
        },
    undefined,
  )
  return scope === undefined ? target : { kind: 'scoped', scope, target }
}

function unsupportedJourneyOperation(operation: HostJourneyOperation): never {
  throw new HostControlError('unsupported', `Appium Android cannot preserve Tao journey operation '${operation.kind}'.`)
}
