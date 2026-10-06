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
import { Errors, FS, Repo } from '@shared'
import type { HostJourney } from '../../journey/HostJourney'
import { appiumAndroidJourneyAdapter } from '../appium-android/AppiumAndroidHostProof'
import {
  type AppiumIosHostProofStep,
  appiumIosJourneyAdapter,
  classifyAppiumIosFault,
  runAppiumIosHostProof,
} from './AppiumIosHostProof'

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
  const artifactRoot = await Repo.mkScratchDir('tao-appium-ios-retained-open-')
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

test('records navigation diagnostics separately from authored assertions and retains capture failures', async () => {
  const captures: string[] = []
  const session = Object.assign(new RecordingSession(), {
    captureNavigationDiagnostics: async (name: string) => {
      captures.push(name)
      if (captures.length > 1) {
        Errors.throwHostEnvironment('native diagnostic transport failed')
      }
      return { artifactPath: 'navigation/root.json' }
    },
  })
  const timeline: AppiumIosHostProofStep[] = []
  const adapter = appiumIosJourneyAdapter(session, { advance: async () => {} }, 'run-a', timeline)
  await adapter.execute({
    kind: 'run',
    appName: 'NativeNavigation',
    appSourcePath: 'Native Navigation.tao',
    source: source(),
  })
  await adapter.execute({
    kind: 'run',
    appName: 'NativeNavigation',
    appSourcePath: 'Native Navigation.tao',
    source: source(),
  })
  expect(captures).toEqual(['navigation-1-run', 'navigation-2-run'])
  expect(timeline[0]).toMatchObject({ outcome: 'passed', nativeDiagnostics: { artifactPath: 'navigation/root.json' } })
  expect(timeline[1]).toMatchObject({ outcome: 'passed', diagnosticFailure: 'native diagnostic transport failed' })
})

test('treats typed leaf absence as missing text while preserving scope and transport failures', async () => {
  const adapter = appiumIosJourneyAdapter(new MissingElementSession(), { advance: async () => {} }, 'run-a')

  await expect(adapter.execute({
    kind: 'expect',
    missing: true,
    selector: 'text',
    selections: [],
    source: source(),
    text: 'No longer visible',
  })).resolves.toBeUndefined()

  const missingScopedAdapter = appiumIosJourneyAdapter(
    new MissingScopedElementSession(),
    { advance: async () => {} },
    'run-a',
  )
  await expect(missingScopedAdapter.execute({
    kind: 'expect',
    missing: true,
    selector: 'text',
    selections: [{ index: 2, source: source(), tag: 'book' }],
    source: source(),
    text: 'Export complete book-001',
  })).resolves.toBeUndefined()

  const missingScopeAdapter = appiumIosJourneyAdapter(
    new MissingScopeSession(),
    { advance: async () => {} },
    'run-a',
  )
  await expect(missingScopeAdapter.execute({
    kind: 'expect',
    missing: true,
    selector: 'text',
    selections: [{ index: 2, source: source(), tag: 'book' }],
    source: source(),
    text: 'Export complete book-001',
  })).rejects.toThrow('selected native scope is missing')

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

for (const [position, y] of [['below', 1200]] as const) {
  for (const kind of ['expect', 'press'] as const) {
    test(`${kind} reveals a target ${position} the viewport and uses its fresh observation`, async () => {
      const session = new ScrollRevealSession(y)
      const adapter = appiumIosJourneyAdapter(session, { advance: async () => {} }, 'run-scroll')
      await adapter.execute({
        ...(kind === 'expect' ? { kind, missing: false } : { kind }),
        selector: 'text',
        selections: [],
        source: source(),
        text: 'Clipboard result',
      })
      expect(session.targets).toEqual([
        { kind: 'text', value: 'Clipboard result' },
        { kind: 'text', value: 'Clipboard result' },
      ])
      expect(session.reveals).toEqual([expect.objectContaining({
        bounds: expect.objectContaining({ y }),
        observationRevision: 1,
        visible: false,
      })])
      expect(session.actions).toEqual([
        ...(kind === 'press'
          ? [expect.objectContaining({
            kind: 'click',
            observation: expect.objectContaining({ observationRevision: 2, visible: true }),
          })]
          : []),
      ])
    })
  }
}

test('missing text does not scroll an existing off-screen target into view', async () => {
  const session = new ScrollRevealSession(1200)
  const adapter = appiumIosJourneyAdapter(session, { advance: async () => {} }, 'run-scroll')
  await adapter.execute({
    kind: 'expect',
    missing: true,
    selector: 'text',
    selections: [],
    source: source(),
    text: 'Clipboard result',
  })
  expect(session.targets).toHaveLength(1)
  expect(session.reveals).toEqual([])
  expect(session.actions).toEqual([])
})

for (const kind of ['expect', 'press'] as const) {
  test(`${kind} waits for an absent target without speculative scrolling`, async () => {
    const session = new ScrollRevealSession(1200, true)
    const observe = session.observe.bind(session)
    let lookups = 0
    session.observe = async request => {
      lookups += 1
      if (lookups === 1) {
        throw new AppiumNoSuchElementError('Target has not mounted')
      }
      return await observe(request)
    }
    const adapter = appiumIosJourneyAdapter(session, { advance: async () => {} }, 'run-scroll')
    await adapter.execute({
      ...(kind === 'expect' ? { kind, missing: false } : { kind }),
      selector: 'text',
      selections: [],
      source: source(),
      text: 'Clipboard result',
    })
    expect(lookups).toBe(2)
    expect(session.reveals).toEqual([])
    expect(session.actions.map(action => action.kind)).toEqual(kind === 'press' ? ['click'] : [])
  })

  test(`${kind} propagates a scrolling transport failure without retrying`, async () => {
    const session = new ScrollRevealSession(1200)
    const reveal = session.revealObservation.bind(session)
    session.revealObservation = async observation => {
      await reveal(observation)
      return Errors.throwHostEnvironment('Scroll transport disconnected')
    }
    const adapter = appiumIosJourneyAdapter(session, { advance: async () => {} }, 'run-scroll')
    await expect(adapter.execute({
      ...(kind === 'expect' ? { kind, missing: false } : { kind }),
      selector: 'text',
      selections: [],
      source: source(),
      text: 'Clipboard result',
    })).rejects.toThrow('Scroll transport disconnected')
    expect(session.targets).toHaveLength(1)
    expect(session.reveals).toHaveLength(1)
    expect(session.actions).toEqual([])
  })
}

test('a click failure after scrolling is propagated without dispatching a duplicate click', async () => {
  const session = new ScrollRevealSession(1200)
  const perform = session.perform.bind(session)
  session.perform = async action => {
    const receipt = await perform(action)
    if (action.kind === 'click') {
      return Errors.throwHostEnvironment('Click transport disconnected after dispatch')
    }
    return receipt
  }
  const adapter = appiumIosJourneyAdapter(session, { advance: async () => {} }, 'run-scroll')
  await expect(adapter.execute({
    kind: 'press',
    selector: 'text',
    selections: [],
    source: source(),
    text: 'Clipboard result',
  })).rejects.toThrow('Click transport disconnected after dispatch')
  expect(session.reveals).toHaveLength(1)
  expect(session.actions.map(action => action.kind)).toEqual(['click'])
  expect(session.targets).toHaveLength(2)
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
  const artifactRoot = await Repo.mkScratchDir('tao-appium-ios-proof-')
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
  readonly actions: HostAction[] = []
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

  async perform(action: HostAction): ReturnType<HostSession['perform']> {
    this.actions.push(action)
    return {
      action: action.kind,
      lease: this.descriptor().lease,
      observationRevision: this.actions.length,
      revision: this.descriptor().revision,
      sessionId: 'test',
      version: 1,
    }
  }

  async publishRevision(): Promise<void> {}
}

class ScrollRevealSession extends RecordingSession {
  readonly reveals: HostObservation[] = []
  readonly #y: number
  #visible: boolean

  constructor(y: number, visible = false) {
    super()
    this.#y = y
    this.#visible = visible
  }

  override async observe(request: Parameters<HostSession['observe']>[0]): Promise<HostObservation> {
    return {
      ...await super.observe(request),
      bounds: { height: 40, width: 200, x: 0, y: this.#visible ? 200 : this.#y },
      visible: this.#visible,
    }
  }

  async revealObservation(observation: HostObservation): Promise<void> {
    this.reveals.push(observation)
    this.#visible = true
  }
}

class MissingElementSession extends RecordingSession {
  override async observe(): Promise<HostObservation> {
    throw new AppiumNoSuchElementError('Appium found no matching element.')
  }
}

class MissingScopedElementSession extends RecordingSession {
  override async observe(): Promise<HostObservation> {
    throw new HostControlError('assertion', 'The scoped child is missing.', { reason: 'element-not-found' })
  }
}

class MissingScopeSession extends RecordingSession {
  override async observe(): Promise<HostObservation> {
    throw new HostControlError('assertion', 'The selected native scope is missing.', { scope: 'book' })
  }
}

class BrokenLookupSession extends RecordingSession {
  override async observe(): Promise<HostObservation> {
    throw new HostControlError('host', 'Appium transport failed.')
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

for (
  const [platform, createAdapter] of [['ios', appiumIosJourneyAdapter], [
    'android',
    appiumAndroidJourneyAdapter,
  ]] as const
) {
  test(`${platform} native navigation adapter preserves authored input, exact values, header titles and back`, async () => {
    const session = new RecordingSession(undefined, { nativeDraft: '', '': 'Keep this draft' })
    const adapter = createAdapter(session, { advance: async () => {} }, 'run-native', [])
    expect(adapter.capabilities).toEqual(expect.arrayContaining(['assertInputValue', 'back', 'textInput']))
    await adapter.execute({
      kind: 'run',
      appName: 'NativeNavigation',
      appSourcePath: 'Native Navigation.tao',
      source: source(),
    })
    await adapter.execute({
      kind: 'enter',
      selector: 'tag',
      target: 'nativeDraft',
      value: 'Keep this draft',
      selections: [],
      source: source(),
    })
    await adapter.execute({
      kind: 'expectInputValue',
      selector: 'tag',
      target: 'nativeDraft',
      value: 'Keep this draft',
      selections: [],
      source: source(),
    })
    await adapter.execute({ kind: 'expectNavigationTitle', title: 'Notes workspace', selections: [], source: source() })
    await adapter.execute({ kind: 'back', selections: [], source: source() })
    expect(session.targets).toEqual([
      { kind: 'tag', value: 'tao-host-ready' },
      {
        kind: 'scoped',
        scope: { kind: 'tag', value: 'nativeDraft' },
        target: { kind: 'accessibility', role: 'textbox', name: '' },
      },
      {
        kind: 'scoped',
        scope: { kind: 'tag', value: 'nativeDraft' },
        target: { kind: 'accessibility', role: 'textbox', name: '' },
      },
      { kind: 'text', value: 'Notes workspace' },
      ...(platform === 'ios' ? [{ kind: 'accessibility', role: 'navigation-back', name: 'Back' }] : []),
    ])
    expect(session.actions[0]).toMatchObject({
      kind: 'type',
      text: 'Keep this draft',
      observation: {
        target: {
          kind: 'scoped',
          scope: { kind: 'tag', value: 'nativeDraft' },
          target: { kind: 'accessibility', role: 'textbox', name: '' },
        },
      },
    })
    expect(session.actions[1]).toMatchObject(platform === 'ios' ? { kind: 'click' } : { kind: 'key', key: 'Back' })
    await expect(
      adapter.execute({
        kind: 'expectInputValue',
        selector: 'tag',
        target: 'nativeDraft',
        value: 'Lost draft',
        selections: [],
        source: source(),
      }),
    ).rejects.toThrow("expected input value 'Lost draft'")
  })

  test(`${platform} label assertions preserve accessibility selection inside a row`, async () => {
    const session = new RecordingSession()
    const original = session.observe.bind(session)
    session.observe = async request => {
      const observation = await original(request)
      const leaf = request.target.kind === 'scoped' ? request.target.target : request.target
      if (leaf.kind !== 'accessibility') {
        throw new AppiumNoSuchElementError('The label is not the rendered text')
      }
      return { ...observation, text: 'Export completed in 0.1 seconds.' }
    }
    const selections = [{ index: 1, source: source(), tag: 'book' }]
    const adapter = createAdapter(session, { advance: async () => {} }, 'labels', [])
    await adapter.execute({
      kind: 'expect',
      missing: false,
      selector: 'label',
      text: 'Export complete book-001',
      selections,
      source: source(),
    })
    expect(session.targets).toEqual([{
      kind: 'scoped',
      scope: { kind: 'tag', occurrence: 1, value: 'book' },
      target: { kind: 'accessibility', name: 'Export complete book-001' },
    }])
    await expect(adapter.execute({
      kind: 'expect',
      missing: true,
      selector: 'label',
      text: 'Export complete book-001',
      selections,
      source: source(),
    })).rejects.toThrow("expected hidden text 'Export complete book-001'")
  })

  test(`${platform} input assertions wait through missing, hidden and stale values`, async () => {
    const session = new RecordingSession(undefined, { 'Note draft': 'Keep this draft' })
    const observe = session.observe.bind(session)
    let attempts = 0
    session.observe = async request => {
      attempts += 1
      if (attempts === 1) {
        throw new AppiumNoSuchElementError('Pop transition is running')
      }
      if (attempts === 2) {
        throw new HostControlError('assertion', 'Editable descendant is missing', { reason: 'element-not-found' })
      }
      const found = await observe(request)
      if (attempts === 3) {
        return { ...found, visible: false }
      }
      if (attempts === 4) {
        return { ...found, text: 'Stale draft' }
      }
      return found
    }
    const adapter = createAdapter(session, { advance: async () => {} }, 'run-native', [])
    await adapter.execute({
      kind: 'expectInputValue',
      selector: 'label',
      target: 'Note draft',
      value: 'Keep this draft',
      selections: [],
      source: source(),
    })
    expect(attempts).toBe(5)
    expect(session.actions).toEqual([])
    expect(session.targets).toEqual(Array.from({ length: 3 }, () => ({
      kind: 'accessibility',
      name: 'Note draft',
      role: 'textbox',
    })))
  })

  test(`${platform} input entry waits for visibility but never retries dispatched typing`, async () => {
    const session = new RecordingSession(undefined, { 'Note draft': '' })
    const observe = session.observe.bind(session)
    let observations = 0
    let writes = 0
    session.observe = async request => {
      observations += 1
      if (observations === 1) {
        throw new AppiumNoSuchElementError('Input has not mounted')
      }
      return { ...await observe(request), visible: observations >= 3 }
    }
    session.perform = async () => {
      writes += 1
      return Errors.throwHostEnvironment('Typing transport failed after dispatch')
    }
    const adapter = createAdapter(session, { advance: async () => {} }, 'run-native', [])
    await expect(adapter.execute({
      kind: 'enter',
      selector: 'label',
      target: 'Note draft',
      value: 'Keep this draft',
      selections: [],
      source: source(),
    })).rejects.toThrow('Typing transport failed after dispatch')
    expect(observations).toBe(3)
    expect(writes).toBe(1)
  })

  test(`${platform} input lookups propagate transport failures without polling`, async () => {
    const session = new RecordingSession()
    let lookups = 0
    session.observe = async () => {
      lookups += 1
      return Errors.throwHostEnvironment('Input transport disconnected')
    }
    const adapter = createAdapter(session, { advance: async () => {} }, 'run-native', [])
    for (const kind of ['enter', 'expectInputValue'] as const) {
      await expect(adapter.execute({
        kind,
        selector: 'tag',
        target: 'nativeDraft',
        value: 'Keep this draft',
        selections: [],
        source: source(),
      })).rejects.toThrow('Input transport disconnected')
    }
    expect(lookups).toBe(2)
    expect(session.actions).toEqual([])
  })
}

test('native input labels retain nested authored selection scopes and editable roles', async () => {
  const session = new RecordingSession(undefined, { 'Note draft': 'Scoped draft' })
  const adapter = appiumIosJourneyAdapter(session, { advance: async () => {} }, 'run-native')
  await adapter.execute({
    kind: 'expectInputValue',
    selector: 'label',
    target: 'Note draft',
    value: 'Scoped draft',
    selections: [{ tag: 'notes', index: 2, source: source() }],
    source: source(),
  })
  expect(session.targets).toEqual([{
    kind: 'scoped',
    scope: { kind: 'tag', value: 'notes', occurrence: 2 },
    target: { kind: 'accessibility', name: 'Note draft', role: 'textbox' },
  }])
})
