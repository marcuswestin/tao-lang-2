import { AppiumNoSuchElementError } from '@appium-driver'
import {
  HostControlError,
  type HostController,
  type HostObservation,
  type HostRevision,
  type HostSession,
  type HostTarget,
} from '@host-control'
import { Errors, FS, Switch, Time } from '@shared'
import {
  type HostJourney,
  type HostJourneyAdapter,
  type HostJourneyOperation,
  type HostJourneySelection,
  runHostJourney,
} from '../../journey/HostJourney'
import { assertNativeInputValue, enterNativeInput } from '../AppiumNativeInputs'
import type {
  AppiumNavigationDiagnosticsSession,
  AppiumXcuiTestDeepLinkSession,
  AppiumXcuiTestRevealSession,
} from './AppiumXcuiTestController'

export type AppiumIosHostFault = Readonly<{
  expectedAssertion: Readonly<{
    operation: 'expect'
    sourceMarker: string
    sourcePath: string
    text: string
  }>
  kind: string
}>

/** The host bridge delivers the authored test clock advance through a run-scoped native control. */
export type AppiumIosHostControl = Readonly<{
  advance: (request: Readonly<{ milliseconds: number; runId: string }>) => Promise<void>
  /** Uses the XCUITest driver to dispatch iOS controls without Simulator's cross-app confirmation. */
  deepLinkUrl?: (request: Readonly<{ milliseconds: number; runId: string }>) => string
}>

export type AppiumIosHostProofOptions = Readonly<{
  afterOperation?: (operation: HostJourneyOperation) => Promise<void>
  artifactRoot: string
  control: AppiumIosHostControl
  controller: HostController
  fault?: AppiumIosHostFault
  journey: HostJourney
  revision: HostRevision
  runId: string
  target: string
}>

export type AppiumIosHostProofReceipt = Readonly<{
  cleanupFailure?: Readonly<{ message: string }>
  fault?: AppiumIosHostFault & { verdict: 'detected' | 'escaped' | 'inconclusive' }
  failure?: Readonly<{ message: string }>
  journey: Readonly<{ check: string; sourcePath: string }>
  retainsTargetLease?: true
  screenshot?: string
  status: 'failed' | 'passed'
  timeline: readonly AppiumIosHostProofStep[]
  version: 1
}>

export type AppiumIosHostProofStep = Readonly<{
  nativeDiagnostics?: Readonly<{ artifactPath: string; screenshot: string }>
  diagnosticFailure?: string
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
 * runAppiumIosHostProof executes compiled Tao test-plan operations against one real iOS session.
 * The receipt preserves each source-linked operation, so a deliberate fault is detected only when
 * its named authored assertion is the failing operation rather than a setup or transport error.
 */
export async function runAppiumIosHostProof(options: AppiumIosHostProofOptions): Promise<AppiumIosHostProofReceipt> {
  const receiptPath = FS.resolvePath('appium-ios/proof.receipt.json', options.artifactRoot)
  const timeline: AppiumIosHostProofStep[] = []
  let session: HostSession | undefined
  let screenshot: string | undefined
  let receipt: AppiumIosHostProofReceipt
  try {
    session = await options.controller.openSession({
      artifactRoot: options.artifactRoot,
      mode: 'acceptance',
      revision: options.revision,
      target: options.target,
    })
    await runHostJourney(
      options.journey,
      appiumIosJourneyAdapter(session, options.control, options.runId, timeline),
      options.afterOperation,
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
    const verdict = options.fault === undefined ? undefined : classifyAppiumIosFault(timeline, options.fault)
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

/** appiumIosJourneyAdapter turns the shared, compiled Tao test-plan IR into scoped XCUITest actions. */
export function appiumIosJourneyAdapter(
  session: HostSession,
  control: AppiumIosHostControl,
  runId: string,
  timeline: AppiumIosHostProofStep[] = [],
): HostJourneyAdapter {
  let appName: string | undefined
  return {
    capabilities: [
      'advanceTime',
      'assertNavigationTitle',
      'assertInputValue',
      'back',
      'textInput',
      'assertText',
      'press',
      'relaunch',
      'runApplication',
      'select',
    ],
    async execute(operation) {
      const step: Omit<AppiumIosHostProofStep, 'outcome'> = {
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
          network: unsupportedJourneyOperation,
          waitForSync: unsupportedJourneyOperation,
          datasourceFailure: unsupportedJourneyOperation,
          advance: async next =>
            await advanceNativeClock(
              session,
              control,
              runId,
              next.milliseconds,
              appName === 'Clockwork' ? 'controlReceipt' : 'tao-host-control-receipt',
            ),
          back: async () => {
            const observation = await observe(session, { kind: 'accessibility', role: 'navigation-back', name: 'Back' })
            await session.perform({
              expectedRevision: session.descriptor().revision,
              kind: 'click',
              lease: session.descriptor().lease,
              observation,
            })
          },
          enter: async next => await enterNativeInput(session, next.selector, next.target, next.value, next.selections),
          expect: async next =>
            await assertText(session, next.text, next.missing, next.selections, next.source.filePath, next.selector),
          expectCheckboxState: unsupportedJourneyOperation,
          expectFocusRegion: unsupportedJourneyOperation,
          expectGroup: unsupportedJourneyOperation,
          expectInputValue: async next =>
            await assertNativeInputValue(
              session,
              next.selector,
              next.target,
              next.value,
              next.selections,
              next.source.filePath,
            ),
          expectNavigationTitle: async next =>
            appName === 'NativeNavigation'
              ? await assertText(session, next.title, false, [], next.source.filePath)
              : await assertNavigationTitle(session, next.title, next.source.filePath),
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
            await assertReady(session, appName)
          },
          submit: unsupportedJourneyOperation,
        })
        const diagnosticSession = session as Partial<AppiumNavigationDiagnosticsSession>
        if (
          appName === 'NativeNavigation' && ['run', 'back', 'press', 'relaunch'].includes(operation.kind)
          && diagnosticSession.captureNavigationDiagnostics !== undefined
        ) {
          const name = `navigation-${timeline.length + 1}-${operation.kind}`
          try {
            const capture = await diagnosticSession.captureNavigationDiagnostics(name, [
              'Notes workspace',
              'Note detail',
              'Library workspace',
              'Library detail',
              'Settings workspace',
              'Settings detail',
            ])
            const screenshot = await session.captureScreenshot(name)
            timeline.push({
              ...step,
              outcome: 'passed',
              nativeDiagnostics: {
                artifactPath: capture.artifactPath,
                screenshot: screenshot.artifactPath,
              },
            })
          } catch (error) {
            timeline.push({ ...step, outcome: 'passed', diagnosticFailure: Errors.messageOf(error) })
          }
        } else {
          timeline.push({ ...step, outcome: 'passed' })
        }
      } catch (error) {
        timeline.push({ ...step, outcome: 'failed' })
        throw error
      }
    },
  }
}

async function advanceNativeClock(
  session: HostSession,
  control: AppiumIosHostControl,
  runId: string,
  milliseconds: number,
  receiptTag: string,
): Promise<void> {
  const expectedReceipt = `Control received: advance ${milliseconds}ms`
  const request = { milliseconds, runId }
  if (control.deepLinkUrl === undefined) {
    await control.advance(request)
  } else {
    await appiumDeepLinkSession(session).openDeepLink(control.deepLinkUrl(request))
  }
  const receipt = await Time.pollUntil(async () => {
    const observedReceipt = await observeIfPresent(session, { kind: 'tag', value: receiptTag })
    if (
      observedReceipt?.visible === true
      && (observedReceipt.text === expectedReceipt || observedReceipt.accessibilityLabel === expectedReceipt)
    ) {
      return observedReceipt
    }
    return undefined
  }, { intervalMs: 100, timeoutMs: 10_000 })
  if (receipt === undefined) {
    throw new HostControlError(
      'assertion',
      `Appium XCUITest did not display the native host-control receipt '${expectedReceipt}'.`,
    )
  }
}

function appiumDeepLinkSession(session: HostSession): AppiumXcuiTestDeepLinkSession {
  if (!('openDeepLink' in session) || typeof session.openDeepLink !== 'function') {
    throw new HostControlError(
      'unsupported',
      'The Appium iOS control bridge requires an XCUITest session that supports explicit deep links.',
    )
  }
  return session as AppiumXcuiTestDeepLinkSession
}

async function observeIfPresent(session: HostSession, target: HostTarget): Promise<HostObservation | undefined> {
  try {
    return await observe(session, target)
  } catch (error) {
    if (isMissingElement(error)) {
      return undefined
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

async function assertReady(session: HostSession, appName: string): Promise<void> {
  const observation = await observe(session, {
    kind: 'tag',
    value: appName === 'Clockwork' ? 'hostReady' : 'tao-host-ready',
  })
  if (!observation.visible) {
    throw new HostControlError('assertion', `Appium XCUITest did not display the host-ready marker for '${appName}'.`)
  }
}

async function assertText(
  session: HostSession,
  text: string,
  missing: boolean,
  selections: readonly HostJourneySelection[],
  sourcePath: string,
  selector = 'text',
): Promise<void> {
  const target = targetWithinSelections(
    selections,
    selector === 'label'
      ? { kind: 'accessibility', name: text }
      : { kind: 'text', value: text },
  )
  if (!missing) {
    const found = await Time.pollUntil(async () => {
      const observation = await observeIfPresent(session, target)
      if (observation?.visible === false) {
        await scrollToward(session, observation)
      }
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
    if (missing && isMissingElement(error)) {
      return
    }
    throw error
  }
}

function isMissingElement(error: unknown): boolean {
  return error instanceof AppiumNoSuchElementError
    || (error instanceof HostControlError && error.code === 'assertion'
      && error.details?.['reason'] === 'element-not-found')
}

/** classifyAppiumIosFault accepts a mutation only when its authored terminal text assertion failed. */
export function classifyAppiumIosFault(
  timeline: readonly AppiumIosHostProofStep[],
  fault: AppiumIosHostFault,
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

async function press(
  session: HostSession,
  selector: string,
  value: string,
  selections: readonly HostJourneySelection[],
): Promise<void> {
  const leaf: HostTarget = selector === 'tag'
    ? { kind: 'tag', value }
    : selector === 'label'
    ? { kind: 'accessibility', name: value }
    : { kind: 'text', value }
  const target = targetWithinSelections(selections, leaf)
  const observation = await Time.pollUntil(async () => {
    const found = await observeIfPresent(session, target)
    if (found?.visible === true) {
      return found
    }
    if (found !== undefined) {
      await scrollToward(session, found)
    }
    return undefined
  }, { intervalMs: 100, timeoutMs: 10_000 })
  if (observation === undefined) {
    throw new HostControlError(
      'assertion',
      `Tao journey could not press ${selector} '${value}': target was not visible.`,
    )
  }
  await session.perform({
    expectedRevision: session.descriptor().revision,
    kind: 'click',
    lease: session.descriptor().lease,
    observation,
  })
}

function targetWithinSelections(selections: readonly HostJourneySelection[], leaf: HostTarget): HostTarget {
  let scope: HostTarget | undefined
  for (const selection of selections) {
    const next: HostTarget = { kind: 'tag', occurrence: selection.index, value: selection.tag }
    scope = scope === undefined ? next : { kind: 'scoped', scope, target: next }
  }
  return scope === undefined ? leaf : { kind: 'scoped', scope, target: leaf }
}

async function observe(session: HostSession, target: HostTarget): Promise<HostObservation> {
  return await session.observe({ expectedRevision: session.descriptor().revision, target })
}

function unsupportedJourneyOperation(operation: HostJourneyOperation): never {
  throw new HostControlError(
    'unsupported',
    `Appium XCUITest cannot preserve Tao journey operation '${operation.kind}'.`,
  )
}

/** Reveal only an existing off-screen target; the native driver owns container-relative geometry. */
async function scrollToward(session: HostSession, observation: HostObservation): Promise<void> {
  const native = session as HostSession & Partial<AppiumXcuiTestRevealSession>
  await native.revealObservation?.(observation)
}
