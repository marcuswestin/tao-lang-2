import { AppiumNoSuchElementError } from '@appium-driver'
import {
  type HostAction,
  HostControlError,
  type HostController,
  type HostObservation,
  type HostRevision,
  type HostScreenshot,
  type HostSession,
  type HostTarget,
} from '@host-control'
import { expect, test } from '@playwright/test'
import { Errors, FS } from '@shared'
import type { HostJourney } from '../../journey/HostJourney'
import { appiumIosJourneyAdapter, classifyAppiumIosFault, runAppiumIosHostProof } from './AppiumIosHostProof'

const revision: HostRevision = { build: 'build-a', source: 'source-a' }

test('folds nested authored selections into element-relative host targets', async () => {
  const session = new RecordingSession()
  const adapter = appiumIosJourneyAdapter(session, { advance: async () => {} }, 'run-a')
  await adapter.execute({
    kind: 'expect',
    missing: false,
    selector: 'text',
    selections: [
      { index: 2, source: source(), tag: 'reading' },
      { index: 1, source: source(), tag: 'story' },
    ],
    source: source(),
    text: 'Why local-first sync wins',
  })

  expect(session.targets).toEqual([{
    kind: 'scoped',
    scope: {
      kind: 'scoped',
      scope: { kind: 'tag', occurrence: 2, value: 'reading' },
      target: { kind: 'tag', occurrence: 1, value: 'story' },
    },
    target: { kind: 'text', value: 'Why local-first sync wins' },
  }])
})

test('leaves a source-linked failed operation when the authored fault assertion is absent', async () => {
  const session = new RecordingSession('Countdown: 0:09')
  const timeline: Parameters<typeof appiumIosJourneyAdapter>[3] = []
  const adapter = appiumIosJourneyAdapter(session, { advance: async () => {} }, 'run-a', timeline)

  await expect(adapter.execute({
    kind: 'expect',
    missing: false,
    selector: 'text',
    selections: [],
    source: source(),
    text: 'Countdown: 0:09',
  })).rejects.toThrow("expected visible text 'Countdown: 0:09'")
  expect(timeline).toEqual([{
    assertion: { kind: 'text', text: 'Countdown: 0:09' },
    operation: 'expect',
    outcome: 'failed',
    sourcePath: 'Apps/HNReader/HNReader.test.tao',
  }])
})

test('asserts authored navigation titles through the Tao runtime accessibility marker', async () => {
  const session = new RecordingSession(undefined, { __tao_navigation_title: 'Hacker News' })
  const adapter = appiumIosJourneyAdapter(session, { advance: async () => {} }, 'run-a')

  await adapter.execute({
    kind: 'expectNavigationTitle',
    selections: [],
    source: source(),
    title: 'Hacker News',
  })

  expect(session.targets).toEqual([{ kind: 'tag', value: '__tao_navigation_title' }])
})

test('recognizes a deliberate fault only at its final source-linked text assertion', () => {
  const fault = {
    expectedAssertion: {
      operation: 'expect' as const,
      sourceMarker: 'Apps/HNReader/HNReader.test.tao:115:0:115:24',
      sourcePath: 'Apps/HNReader/HNReader.test.tao',
      text: '2 opened',
    },
    kind: 'reading-history-not-persisted',
  }
  const finalFailure = {
    assertion: { kind: 'text' as const, text: '2 opened' },
    operation: 'expect' as const,
    outcome: 'failed' as const,
    sourceMarker: 'Apps/HNReader/HNReader.test.tao:115:0:115:24',
    sourcePath: 'Apps/HNReader/HNReader.test.tao',
  }

  expect(classifyAppiumIosFault([
    { operation: 'press', outcome: 'passed', sourcePath: 'Apps/HNReader/HNReader.test.tao' },
    finalFailure,
  ], fault)).toBe('detected')
  expect(classifyAppiumIosFault([
    { operation: 'press', outcome: 'failed', sourcePath: 'Apps/HNReader/HNReader.test.tao' },
    finalFailure,
  ], fault)).toBe('inconclusive')
  expect(classifyAppiumIosFault([
    { ...finalFailure, sourceMarker: 'Apps/HNReader/HNReader.test.tao:103:0:103:24' },
  ], fault)).toBe('inconclusive')
  expect(classifyAppiumIosFault([
    { ...finalFailure, assertion: { kind: 'text', text: 'other' } },
  ], fault)).toBe('inconclusive')
})

test('writes a target-retention receipt when opening a session leaves a live driver behind', async () => {
  const artifactRoot = await FS.mkTmpDir('tao-appium-ios-retained-open-')
  try {
    const receipt = await runAppiumIosHostProof({
      artifactRoot,
      control: { advance: async () => {} },
      controller: new RetainedOpenController(),
      journey: clockJourney(),
      revision,
      runId: 'retained-open',
      target: 'ios-simulator',
    })

    expect(receipt).toMatchObject({ retainsTargetLease: true, status: 'failed' })
  } finally {
    await FS.remove(artifactRoot)
  }
})

test('treats only a typed Appium absent-element response as a passing missing-text assertion', async () => {
  const adapter = appiumIosJourneyAdapter(new MissingElementSession(), { advance: async () => {} }, 'run-a')

  await expect(adapter.execute({
    kind: 'expect',
    missing: true,
    selector: 'text',
    selections: [],
    source: source(),
    text: 'No longer visible',
  })).resolves.toBeUndefined()

  const brokenAdapter = appiumIosJourneyAdapter(new BrokenLookupSession(), { advance: async () => {} }, 'run-a')
  await expect(brokenAdapter.execute({
    kind: 'expect',
    missing: true,
    selector: 'text',
    selections: [],
    source: source(),
    text: 'No longer visible',
  })).rejects.toThrow('Appium transport failed.')
})

test('waits for a positive assertion to appear after a native transition', async () => {
  const session = new DelayedElementSession(2)
  const adapter = appiumIosJourneyAdapter(session, { advance: async () => {} }, 'run-a')

  await expect(adapter.execute({
    kind: 'expect',
    missing: false,
    selector: 'text',
    selections: [],
    source: source(),
    text: '2 opened',
  })).resolves.toBeUndefined()
  expect(session.attemptsRemaining).toBe(0)
})

test('uses an XCUITest deep link before waiting for the exact native clock receipt', async () => {
  const session = new ClockControlSession()
  const timeline: Parameters<typeof appiumIosJourneyAdapter>[3] = []
  const advances: Array<{ milliseconds: number; runId: string }> = []
  const adapter = appiumIosJourneyAdapter(
    session,
    {
      advance: async request => {
        advances.push(request)
      },
      deepLinkUrl: request => `taohostpoc-${request.runId}://control?advanceMs=${request.milliseconds}`,
    },
    'run-clock',
    timeline,
  )

  await adapter.execute({ kind: 'advance', milliseconds: 1_000, selections: [], source: source() })

  expect(advances).toEqual([])
  expect(session.deepLinks).toEqual(['taohostpoc-run-clock://control?advanceMs=1000'])
  expect(session.targets).toEqual([{ kind: 'tag', value: 'tao-host-control-receipt' }])
  expect(timeline).toEqual([{ operation: 'advance', outcome: 'passed', sourcePath: source().filePath }])
})

test('uses the host-control fallback when no XCUITest deep link is supplied', async () => {
  const session = new ClockControlSession(false)
  const advances: Array<{ milliseconds: number; runId: string }> = []
  const adapter = appiumIosJourneyAdapter(
    session,
    {
      advance: async request => {
        advances.push(request)
      },
    },
    'run-clock',
  )

  await adapter.execute({ kind: 'advance', milliseconds: 1_000, selections: [], source: source() })

  expect(session.targets).toEqual([{ kind: 'tag', value: 'tao-host-control-receipt' }])
  expect(session.deepLinks).toEqual([])
  expect(advances).toEqual([{ milliseconds: 1_000, runId: 'run-clock' }])
})

test('uses the authored Clockwork readiness and control tags on native iOS', async () => {
  const session = new ClockControlSession(false, 'controlReceipt')
  const adapter = appiumIosJourneyAdapter(session, { advance: async () => {} }, 'run-clock')

  await adapter.execute({
    appName: 'Clockwork',
    appSourcePath: 'packages/testing/e2e-testing/fixtures/Clockwork/Clockwork.tao',
    kind: 'run',
    source: source(),
  })
  await adapter.execute({ kind: 'advance', milliseconds: 1_000, selections: [], source: source() })

  expect(session.targets).toEqual([
    { kind: 'tag', value: 'hostReady' },
    { kind: 'tag', value: 'controlReceipt' },
  ])
  expect(session.deepLinks).toEqual([])
})

test('writes the exact passed receipt after the native clock acknowledgement', async () => {
  const artifactRoot = await FS.mkTmpDir('tao-appium-ios-proof-')
  const session = new ClockControlSession()
  const controller = new ProofController(session)
  try {
    const receipt = await runAppiumIosHostProof({
      artifactRoot,
      control: {
        advance: async () => {},
        deepLinkUrl: request => `taohostpoc-${request.runId}://control?advanceMs=${request.milliseconds}`,
      },
      controller,
      journey: clockJourney(),
      revision,
      runId: 'receipt-proof',
      target: 'ios-simulator',
    })

    expect(receipt).toEqual({
      journey: { check: 'acknowledges the native clock advance', sourcePath: source().filePath },
      screenshot: '/proof/journey-passed.png',
      status: 'passed',
      timeline: [
        { operation: 'run', outcome: 'passed', sourcePath: source().filePath },
        { operation: 'advance', outcome: 'passed', sourcePath: source().filePath },
      ],
      version: 1,
    })
    await expect(FS.readJson(FS.resolvePath('appium-ios/proof.receipt.json', artifactRoot))).resolves.toEqual(receipt)
    expect(controller.closed).toBe(true)
    expect(session.closed).toBe(true)
    expect(session.deepLinks).toEqual(['taohostpoc-receipt-proof://control?advanceMs=1000'])
  } finally {
    await FS.remove(artifactRoot)
  }
})

class RecordingSession implements HostSession {
  readonly targets: HostTarget[] = []
  readonly #missing: string | undefined
  readonly #texts: Readonly<Record<string, string>>

  constructor(missing?: string, texts: Readonly<Record<string, string>> = {}) {
    this.#missing = missing
    this.#texts = texts
  }

  async captureScreenshot(): Promise<HostScreenshot> {
    return {} as HostScreenshot
  }

  async close(): Promise<void> {}

  descriptor(): ReturnType<HostSession['descriptor']> {
    return {
      capabilities: ['inspect', 'pointer', 'relaunchApplication'],
      driver: 'test',
      id: 'test',
      lease: { generation: 'one', name: 'test' },
      mode: 'acceptance',
      revision: { build: 'build', source: 'source' },
      target: 'clockwork',
      version: 1,
    }
  }

  async observe(
    request: Readonly<{ expectedRevision: ReturnType<HostSession['descriptor']>['revision']; target: HostTarget }>,
  ): Promise<HostObservation> {
    this.targets.push(request.target)
    const targetText = leafText(request.target)
    const text = this.#texts[targetText] ?? targetText
    return {
      accessibilityLabel: text,
      id: targetText,
      lease: this.descriptor().lease,
      observationRevision: this.targets.length,
      revision: this.descriptor().revision,
      sessionId: 'test',
      target: request.target,
      text: targetText === this.#missing ? undefined : text,
      timestamp: '2026-01-01T00:00:00.000Z',
      version: 1,
      visible: targetText !== this.#missing,
    }
  }

  async perform(_action: HostAction): Promise<never> {
    return {} as never
  }

  async publishRevision(): Promise<void> {}
}

class MissingElementSession extends RecordingSession {
  override async observe(): Promise<HostObservation> {
    throw new AppiumNoSuchElementError('Appium found no matching element.')
  }
}

class BrokenLookupSession extends RecordingSession {
  override async observe(): Promise<HostObservation> {
    throw new HostControlError('host', 'Appium transport failed.')
  }
}

class DelayedElementSession extends RecordingSession {
  attemptsRemaining: number

  constructor(attemptsRemaining: number) {
    super()
    this.attemptsRemaining = attemptsRemaining
  }

  override async observe(
    request: Readonly<{ expectedRevision: ReturnType<HostSession['descriptor']>['revision']; target: HostTarget }>,
  ): Promise<HostObservation> {
    if (this.attemptsRemaining > 0) {
      this.attemptsRemaining -= 1
      throw new AppiumNoSuchElementError('native transition has not published the text yet')
    }
    return await super.observe(request)
  }
}

class ClockControlSession extends RecordingSession {
  closed = false
  readonly deepLinks: string[] = []
  readonly #requiresOpen: boolean
  readonly #receiptTag: string
  #opened = false

  constructor(requiresOpen = true, receiptTag = 'tao-host-control-receipt') {
    super()
    this.#requiresOpen = requiresOpen
    this.#receiptTag = receiptTag
  }

  override async captureScreenshot(): Promise<HostScreenshot> {
    return {
      artifactPath: '/proof/journey-passed.png',
      observationRevision: this.targets.length,
      revision,
      sessionId: 'test',
      version: 1,
    }
  }

  override async close(): Promise<void> {
    this.closed = true
  }

  async openDeepLink(url: string): Promise<void> {
    this.deepLinks.push(url)
    this.#opened = true
  }

  override descriptor(): ReturnType<HostSession['descriptor']> {
    return {
      ...super.descriptor(),
      revision,
    }
  }

  override async observe(
    request: Readonly<{ expectedRevision: ReturnType<HostSession['descriptor']>['revision']; target: HostTarget }>,
  ): Promise<HostObservation> {
    this.targets.push(request.target)
    const text = request.target.kind === 'tag' && request.target.value === this.#receiptTag
      ? this.#opened || !this.#requiresOpen
        ? 'Control received: advance 1000ms'
        : 'Control received: advance 1ms'
      : leafText(request.target)
    return {
      accessibilityLabel: text,
      id: text,
      lease: this.descriptor().lease,
      observationRevision: this.targets.length,
      revision,
      sessionId: 'test',
      target: request.target,
      text,
      timestamp: '2026-01-01T00:00:00.000Z',
      version: 1,
      visible: true,
    }
  }
}

class ProofController implements HostController {
  closed = false
  readonly #session: ClockControlSession

  constructor(session: ClockControlSession) {
    this.#session = session
  }

  async close(): Promise<void> {
    this.closed = true
  }

  async openSession(): Promise<HostSession> {
    return this.#session
  }
}

class RetainedOpenController implements HostController {
  async close(): Promise<void> {}

  async openSession(): Promise<HostSession> {
    Errors.throwHostEnvironment('Appium could not close the just-opened session.', {
      details: { retainsTargetLease: true },
    })
  }
}

function leafText(target: HostTarget): string {
  return target.kind === 'scoped'
    ? leafText(target.target)
    : target.kind === 'accessibility'
    ? target.name
    : target.value
}

function source(): { filePath: string } {
  return { filePath: 'Apps/HNReader/HNReader.test.tao' }
}

function clockJourney(): HostJourney {
  return {
    check: {
      name: 'acknowledges the native clock advance',
      run: { appName: 'HNReaderStub', appSourcePath: 'Apps/HNReader/HNReader.tao', source: source() },
      source: source(),
      steps: [
        { kind: 'advance', milliseconds: 1_000, source: source() },
      ],
    },
    sourcePath: source().filePath,
    version: 1,
  }
}
