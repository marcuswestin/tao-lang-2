import type {
  HostController,
  HostLeaseIdentity,
  HostObservation,
  HostRevision,
  HostSession,
  HostTarget,
} from '@host-control'
import { AppiumNoSuchElementError } from '@host-control/appium'
import { expect, test } from '@playwright/test'
import { Errors, FS } from '@shared'
import type { HostJourney } from '../../journey/HostJourney'
import {
  androidTargetLeaseName,
  appiumAndroidCapabilities,
  type AppiumAndroidClient,
  type AppiumAndroidElement,
  type AppiumAndroidLease,
  type AppiumAndroidLeaseManager,
  type AppiumAndroidLocator,
  type AppiumAndroidReceiptSink,
  type AppiumAndroidSessionReceipt,
  type AppiumAndroidWebDriverSession,
  createAppiumAndroidController,
} from './AppiumAndroidController'
import { classifyAppiumAndroidFault, runAppiumAndroidHostProof } from './AppiumAndroidHostProof'

const revision: HostRevision = { build: 'build-a', source: 'source-a' }

test('declares the isolated UiAutomator2 APK, emulator, and fenced-port capability contract', () => {
  expect(
    appiumAndroidCapabilities(target('emulator-5554'), build('/artifacts/host.apk'), {
      mjpegServerPort: 9132,
      systemPort: 8232,
    }),
  ).toEqual({
    'appium:app': '/artifacts/host.apk',
    'appium:appActivity': '.MainActivity',
    'appium:appPackage': 'dev.tao.taohostclockworkabc123',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': 'emulator-5554',
    'appium:fullReset': false,
    'appium:mjpegServerPort': 9132,
    'appium:noReset': true,
    'appium:systemPort': 8232,
    'appium:udid': 'emulator-5554',
    platformName: 'Android',
  })
})

test('uses the canonical Android target lease name and consumes a preheld emulator lease', async () => {
  const root = await FS.mkTmpDir('tao-appium-android-preheld-')
  await FS.writeFile(FS.resolvePath('host.apk', root), new Uint8Array([1]))
  const leases = new FakeLeases()
  const emulator = target('emulator-5554')
  expect(androidTargetLeaseName(emulator)).toBe('android-emulator:emulator-5554')
  const preheldTargetLease = await leases.acquire(androidTargetLeaseName(emulator))
  const host = controller(new FakeClient('preheld'), leases, emulator, new FakeReceipts(), root, preheldTargetLease)
  const session = await open(host, root)
  try {
    expect(session.descriptor().lease).toMatchObject({ name: 'android-emulator:emulator-5554' })
  } finally {
    await session.close(session.descriptor().lease)
    await FS.remove(root)
  }
})

test('leases each emulator and port, observes semantic targets, relaunches, records screenshots, and cleans up', async () => {
  const root = await FS.mkTmpDir('tao-appium-android-')
  await FS.writeFile(FS.resolvePath('host.apk', root), new Uint8Array([1]))
  const leases = new FakeLeases()
  const receipts = new FakeReceipts()
  const firstClient = new FakeClient('first')
  const secondClient = new FakeClient('second')
  const first = controller(firstClient, leases, target('emulator-5554'), receipts, root)
  const second = controller(secondClient, leases, target('emulator-5556'), receipts, root)
  const [firstSession, secondSession] = await Promise.all([open(first, root), open(second, root)])

  try {
    expect(firstClient.capabilities[0]?.['appium:systemPort']).not.toBe(
      secondClient.capabilities[0]?.['appium:systemPort'],
    )
    expect(firstClient.capabilities[0]?.['appium:mjpegServerPort']).not.toBe(
      secondClient.capabilities[0]?.['appium:mjpegServerPort'],
    )
    const observation = await firstSession.observe({
      expectedRevision: revision,
      target: { kind: 'tag', occurrence: 2, value: 'reading' },
    })
    expect(firstClient.session.locators).toEqual([{
      using: '-android uiautomator',
      value: 'new UiSelector().resourceId("reading")',
    }])
    expect(observation).toMatchObject({ id: 'element-2', text: 'second', visible: true })
    const scoped = await firstSession.observe({
      expectedRevision: revision,
      target: {
        kind: 'scoped',
        scope: { kind: 'tag', occurrence: 2, value: 'reading' },
        target: { kind: 'text', value: 'second' },
      },
    })
    expect(firstClient.session.within).toEqual([{
      id: 'element-2',
      locator: { using: '-android uiautomator', value: 'new UiSelector().text("second")' },
    }])
    expect(scoped.text).toBe('first')
    await firstSession.perform({
      expectedRevision: revision,
      kind: 'relaunchApplication',
      lease: firstSession.descriptor().lease,
    })
    expect(firstClient.session.terminated).toEqual(['dev.tao.taohostclockworkabc123'])
    expect(firstClient.session.activated).toEqual(['dev.tao.taohostclockworkabc123'])
    const screenshot = await firstSession.captureScreenshot('checkpoint')
    expect(screenshot.artifactPath).toContain('appium-android/screenshots/emulator-5554-lease-1-1-checkpoint.png')
    await expect(FS.exists(screenshot.artifactPath)).resolves.toBe(true)
  } finally {
    await firstSession.close(firstSession.descriptor().lease)
    await secondSession.close(secondSession.descriptor().lease)
    await FS.remove(root)
  }
  expect(receipts.records.filter(record => record.receipt.lifecycle === 'closed')).toHaveLength(2)
  expect(firstClient.session.deleted).toBe(true)
  expect(secondClient.session.deleted).toBe(true)
})

test('preserves scoped Tao selection when Android flattens visual children in its accessibility tree', async () => {
  const root = await FS.mkTmpDir('tao-appium-android-flattened-')
  await FS.writeFile(FS.resolvePath('host.apk', root), new Uint8Array([1]))
  const client = new FakeClient('flattened')
  client.session.flattenScopedHierarchy = true
  const host = controller(client, new FakeLeases(), target('emulator-5554'), new FakeReceipts(), root)
  const session = await open(host, root)

  try {
    const observation = await session.observe({
      expectedRevision: revision,
      target: {
        kind: 'scoped',
        scope: { kind: 'tag', occurrence: 2, value: 'reading' },
        target: { kind: 'text', value: 'Why local-first sync wins' },
      },
    })
    expect(observation).toMatchObject({ id: 'title-2', text: 'Why local-first sync wins' })
  } finally {
    await session.close(session.descriptor().lease)
    await FS.remove(root)
  }
})

test('does not release emulator or port leases after an ambiguous failed-open deletion', async () => {
  const root = await FS.mkTmpDir('tao-appium-android-ambiguous-')
  await FS.writeFile(FS.resolvePath('host.apk', root), new Uint8Array([1]))
  const leases = new FakeLeases()
  const receipts = new FakeReceipts('open')
  const client = new FakeClient('ambiguous-open')
  client.session.failDelete = true
  const host = controller(client, leases, target('emulator-5560'), receipts, root)

  await expect(open(host, root)).rejects.toMatchObject({ details: { retainsTargetLease: true } })
  expect(leases.names()).toEqual(expect.arrayContaining([
    'android-emulator:emulator-5560',
    expect.stringMatching(/^appium-android-system-port-/u),
    expect.stringMatching(/^appium-android-mjpeg-port-/u),
  ]))
  expect(client.session.deleteAttempts).toBe(1)
  await FS.remove(root)
})

test('runs Clockwork through its authored readiness and records only its terminal fault assertion', async () => {
  const root = await FS.mkTmpDir('tao-appium-android-proof-')
  const host = new ProofController()
  host.failHostReadyLookup = true
  const receipt = await runAppiumAndroidHostProof({
    artifactRoot: root,
    control: {
      advance: async () => {
        host.afterAdvance = true
      },
    },
    controller: host,
    fault: {
      expectedAssertion: {
        operation: 'expect',
        sourceMarker: 'Clockwork.test.tao:12:0:12:24',
        sourcePath: 'Clockwork.test.tao',
        text: 'Countdown: 0:09',
      },
      kind: 'countdown-frozen',
    },
    journey: countdownJourney(),
    revision,
    runId: 'proof-1',
    target: 'clockwork',
  })
  try {
    expect(receipt).toMatchObject({ fault: { verdict: 'detected' }, status: 'failed' })
    expect(receipt.timeline).toEqual([
      { operation: 'run', outcome: 'passed', sourcePath: 'Clockwork.test.tao' },
      {
        assertion: { kind: 'text', text: 'Countdown: 0:10' },
        operation: 'expect',
        outcome: 'passed',
        sourcePath: 'Clockwork.test.tao',
      },
      { operation: 'advance', outcome: 'passed', sourcePath: 'Clockwork.test.tao' },
      {
        assertion: { kind: 'navigationTitle', title: 'Hacker News' },
        operation: 'expectNavigationTitle',
        outcome: 'passed',
        sourcePath: 'Clockwork.test.tao',
      },
      {
        assertion: { kind: 'text', text: 'Countdown: 0:09' },
        operation: 'expect',
        outcome: 'failed',
        sourceMarker: 'Clockwork.test.tao:12:0:12:24',
        sourcePath: 'Clockwork.test.tao',
      },
    ])
    expect(host.closed).toBe(true)
    await expect(FS.readJson(FS.resolvePath('appium-android/proof.receipt.json', root))).resolves.toMatchObject({
      fault: { verdict: 'detected' },
    })
  } finally {
    await FS.remove(root)
  }
})

test('treats a duplicate HNReader assertion that fails before relaunch as an inconclusive fault', () => {
  const fault = {
    expectedAssertion: {
      operation: 'expect' as const,
      sourceMarker: 'HNReader.test.tao:30:0:30:12',
      sourcePath: 'HNReader.test.tao',
      text: '2 opened',
    },
    kind: 'reading-history-not-persisted',
  }

  expect(classifyAppiumAndroidFault([
    {
      assertion: { kind: 'text', text: '2 opened' },
      operation: 'expect',
      outcome: 'failed',
      sourceMarker: 'HNReader.test.tao:10:0:10:12',
      sourcePath: 'HNReader.test.tao',
    },
  ], fault)).toBe('inconclusive')
})

test('writes a target-retention receipt when opening a session leaves a live driver behind', async () => {
  const root = await FS.mkTmpDir('tao-appium-android-retained-open-')
  try {
    const receipt = await runAppiumAndroidHostProof({
      artifactRoot: root,
      control: { advance: async () => {} },
      controller: new RetainedOpenController(),
      journey: visibleTextJourney('2 opened'),
      revision,
      runId: 'retained-open',
      target: 'android-emulator',
    })

    expect(receipt).toMatchObject({ retainsTargetLease: true, status: 'failed' })
  } finally {
    await FS.remove(root)
  }
})

test('waits for HNReader native control receipt before continuing the journey', async () => {
  const root = await FS.mkTmpDir('tao-appium-android-control-')
  const host = new ProofController()
  const receipt = await runAppiumAndroidHostProof({
    artifactRoot: root,
    control: {
      advance: async ({ milliseconds }) => {
        host.controlReceipt = `Control received: advance ${milliseconds}ms`
      },
    },
    controller: host,
    journey: hnReaderControlJourney(),
    revision,
    runId: 'proof-control',
    target: 'hnreader',
  })
  try {
    expect(receipt).toMatchObject({ status: 'passed' })
    expect(receipt.timeline).toEqual([
      { operation: 'run', outcome: 'passed', sourcePath: 'HNReader.test.tao' },
      { operation: 'advance', outcome: 'passed', sourcePath: 'HNReader.test.tao' },
    ])
  } finally {
    await FS.remove(root)
  }
})

test('waits for a positive assertion to appear after a native transition', async () => {
  const root = await FS.mkTmpDir('tao-appium-android-transition-')
  const host = new ProofController()
  host.delayedText = '2 opened'
  host.delayedTextAttemptsRemaining = 2
  const receipt = await runAppiumAndroidHostProof({
    artifactRoot: root,
    control: { advance: async () => {} },
    controller: host,
    journey: visibleTextJourney('2 opened'),
    revision,
    runId: 'proof-transition',
    target: 'hnreader',
  })
  try {
    expect(receipt).toMatchObject({ status: 'passed' })
    expect(host.delayedTextAttemptsRemaining).toBe(0)
  } finally {
    await FS.remove(root)
  }
})

function build(apkPath: string): { apkPath: string; compiledArtifactDigest: string } {
  return { apkPath, compiledArtifactDigest: 'a'.repeat(64) }
}

function controller(
  client: FakeClient,
  leases: FakeLeases,
  nextTarget: ReturnType<typeof target>,
  receipts: FakeReceipts,
  root = '/artifacts',
  preheldTargetLease?: AppiumAndroidLease,
) {
  return createAppiumAndroidController({
    build: build(FS.resolvePath('host.apk', root)),
    client,
    leases,
    preheldTargetLease,
    receipts,
    target: nextTarget,
  })
}

function open(
  controller: ReturnType<typeof createAppiumAndroidController>,
  artifactRoot = '/artifacts',
): Promise<HostSession> {
  return controller.openSession({ artifactRoot, mode: 'acceptance', revision, target: 'clockwork' })
}

function target(serial: string) {
  return { appId: 'dev.tao.taohostclockworkabc123', kind: 'emulator' as const, serial }
}

class FakeClient implements AppiumAndroidClient {
  readonly capabilities: ReturnType<typeof appiumAndroidCapabilities>[] = []
  readonly session: FakeSession
  constructor(name: string) {
    this.session = new FakeSession(name)
  }
  async createSession(
    capabilities: ReturnType<typeof appiumAndroidCapabilities>,
  ): Promise<AppiumAndroidWebDriverSession> {
    this.capabilities.push(capabilities)
    return this.session
  }
}

class FakeSession implements AppiumAndroidWebDriverSession {
  readonly activated: string[] = []
  deleted = false
  deleteAttempts = 0
  failDelete = false
  flattenScopedHierarchy = false
  readonly id: string
  readonly locators: AppiumAndroidLocator[] = []
  readonly terminated: string[] = []
  readonly within: Array<{ id: string; locator: AppiumAndroidLocator }> = []
  constructor(name: string) {
    this.id = `${name}-session`
  }
  async activateApp(appId: string): Promise<void> {
    this.activated.push(appId)
  }
  async deleteSession(): Promise<void> {
    this.deleteAttempts += 1
    if (this.failDelete) {
      Errors.throwHostEnvironment('ambiguous delete')
    }
    this.deleted = true
  }
  async findElement(locator: AppiumAndroidLocator): Promise<AppiumAndroidElement> {
    this.locators.push(locator)
    return (await this.elementsFor(locator))[0]!
  }
  async findElements(locator: AppiumAndroidLocator): Promise<readonly AppiumAndroidElement[]> {
    this.locators.push(locator)
    return await this.elementsFor(locator)
  }
  async findElementWithin(
    element: AppiumAndroidElement,
    locator: AppiumAndroidLocator,
  ): Promise<AppiumAndroidElement> {
    this.within.push({ id: element.id, locator })
    if (this.flattenScopedHierarchy) {
      throw new AppiumNoSuchElementError('Android exposed the visual child as an accessibility sibling')
    }
    return await this.findElement(locator)
  }
  async findElementsWithin(
    _element: AppiumAndroidElement,
    locator: AppiumAndroidLocator,
  ): Promise<readonly AppiumAndroidElement[]> {
    return await this.findElements(locator)
  }
  async pressKey(): Promise<void> {}
  async screenshot(): Promise<Uint8Array> {
    return new Uint8Array([1, 2])
  }
  async scroll(): Promise<void> {}
  async terminateApp(appId: string): Promise<void> {
    this.terminated.push(appId)
  }
  async elementsFor(locator: AppiumAndroidLocator): Promise<readonly AppiumAndroidElement[]> {
    if (this.flattenScopedHierarchy && locator.value.includes('resourceId')) {
      return [
        new FakeElement(this, 'row-1', 'reading', { height: 100, width: 300, x: 0, y: 0 }),
        new FakeElement(this, 'row-2', 'reading', { height: 100, width: 300, x: 0, y: 100 }),
      ]
    }
    if (this.flattenScopedHierarchy) {
      return [
        new FakeElement(this, 'title-1', 'Why local-first sync wins', { height: 20, width: 220, x: 10, y: 20 }),
        new FakeElement(this, 'title-2', 'Why local-first sync wins', { height: 20, width: 220, x: 10, y: 120 }),
      ]
    }
    return [new FakeElement(this, 'element-1', 'first'), new FakeElement(this, 'element-2', 'second')]
  }
}

class FakeElement implements AppiumAndroidElement {
  readonly id: string
  readonly #rect: Readonly<{ height: number; width: number; x: number; y: number }>
  readonly #session: FakeSession
  readonly #text: string
  constructor(
    session: FakeSession,
    id: string,
    text: string,
    rect: Readonly<{ height: number; width: number; x: number; y: number }> = { height: 1, width: 1, x: 0, y: 0 },
  ) {
    this.#session = session
    this.id = id
    this.#rect = rect
    this.#text = text
  }
  async click(): Promise<void> {
    void this.#session
  }
  async getAttribute(): Promise<string> {
    return this.#text
  }
  async getRect(): Promise<{ height: number; width: number; x: number; y: number }> {
    return this.#rect
  }
  async getText(): Promise<string> {
    return this.#text
  }
  async isDisplayed(): Promise<boolean> {
    return true
  }
  async sendKeys(): Promise<void> {}
}

class FakeLeases implements AppiumAndroidLeaseManager {
  readonly #leases = new Map<string, FakeLease>()
  #sequence = 0
  async acquire(name: string): Promise<AppiumAndroidLease> {
    if (this.#leases.has(name)) {
      Errors.throwHostEnvironment(`Machine resource '${name}' is busy.`)
    }
    return this.#claim(name)
  }
  names(): string[] {
    return [...this.#leases.keys()]
  }
  async tryAcquire(name: string): Promise<AppiumAndroidLease | undefined> {
    return this.#leases.has(name) ? undefined : this.#claim(name)
  }
  #claim(name: string): FakeLease {
    const lease = new FakeLease(`lease-${++this.#sequence}`, () => this.#leases.delete(name))
    this.#leases.set(name, lease)
    return lease
  }
}

class FakeLease implements AppiumAndroidLease {
  readonly generation: string
  readonly #release: () => void
  constructor(generation: string, release: () => void) {
    this.generation = generation
    this.#release = release
  }
  async assertCurrent(generation: string): Promise<void> {
    if (generation !== this.generation) {
      Errors.throwHostEnvironment('lease is stale')
    }
  }
  async release(): Promise<void> {
    this.#release()
  }
}

class FakeReceipts implements AppiumAndroidReceiptSink {
  readonly records: Array<{ path: string; receipt: AppiumAndroidSessionReceipt }> = []
  readonly #failLifecycle: string | undefined
  constructor(failLifecycle?: string) {
    this.#failLifecycle = failLifecycle
  }
  async write(path: string, receipt: AppiumAndroidSessionReceipt): Promise<void> {
    this.records.push({ path, receipt })
    if (receipt.lifecycle === this.#failLifecycle) {
      Errors.throwHostEnvironment('receipt disk unavailable')
    }
  }
}

class ProofController implements HostController {
  afterAdvance = false
  closed = false
  controlReceipt: string | undefined
  delayedText: string | undefined
  delayedTextAttemptsRemaining = 0
  failHostReadyLookup = false
  readonly #lease: HostLeaseIdentity = { generation: 'proof-lease', name: 'proof-device' }
  readonly #session: HostSession = {
    captureScreenshot: async name => ({
      artifactPath: `/proof/${name}.png`,
      observationRevision: 1,
      revision,
      sessionId: 'proof-session',
      version: 1,
    }),
    close: async () => {
      this.closed = true
    },
    descriptor: () => ({
      capabilities: ['inspect', 'relaunchApplication', 'screenshot'],
      driver: 'proof',
      id: 'proof-session',
      lease: this.#lease,
      mode: 'acceptance',
      revision,
      target: 'clockwork',
      version: 1,
    }),
    observe: async request => this.#observe(request.target),
    perform: async () => ({
      action: 'relaunchApplication',
      lease: this.#lease,
      observationRevision: 1,
      revision,
      sessionId: 'proof-session',
      version: 1,
    }),
    publishRevision: async () => {},
  }
  async close(): Promise<void> {
    this.closed = true
  }
  async openSession(): Promise<HostSession> {
    return this.#session
  }
  #observe(target: HostTarget): HostObservation {
    if (target.kind === 'tag' && target.value === 'tao-host-ready' && this.failHostReadyLookup) {
      Errors.throwUnexpected('Clockwork must not require the HNReader wrapper-ready marker')
    }
    if (
      target.kind === 'text'
      && target.value === this.delayedText
      && this.delayedTextAttemptsRemaining > 0
    ) {
      this.delayedTextAttemptsRemaining -= 1
      throw new AppiumNoSuchElementError('native transition has not published the text yet')
    }
    const text = target.kind === 'tag' && target.value === '__tao_navigation_title'
      ? 'Hacker News'
      : target.kind === 'tag' && target.value === 'tao-host-control-receipt'
      ? this.controlReceipt ?? 'Control pending'
      : target.kind === 'text' && target.value === 'Countdown: 0:09' && this.afterAdvance
      ? 'Countdown: 0:10'
      : target.kind === 'text'
      ? target.value
      : 'ready'
    return {
      id: 'proof-element',
      lease: this.#lease,
      observationRevision: 1,
      revision,
      sessionId: 'proof-session',
      target,
      text,
      timestamp: '2026-01-01T00:00:00.000Z',
      version: 1,
      visible: true,
    }
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

function visibleTextJourney(text: string): HostJourney {
  return {
    check: {
      name: 'waits for visible text',
      run: { appName: 'HNReaderStub', appSourcePath: 'HNReader.tao', source: { filePath: 'HNReader.test.tao' } },
      source: { filePath: 'HNReader.test.tao' },
      steps: [{ kind: 'expect', missing: false, selector: 'text', source: { filePath: 'HNReader.test.tao' }, text }],
    },
    sourcePath: 'HNReader.test.tao',
    version: 1,
  }
}

function hnReaderControlJourney(): HostJourney {
  return {
    check: {
      name: 'receives native clock control',
      run: { appName: 'HNReaderStub', appSourcePath: 'HNReader.tao', source: { filePath: 'HNReader.test.tao' } },
      source: { filePath: 'HNReader.test.tao' },
      steps: [{ kind: 'advance', milliseconds: 1_000, source: { filePath: 'HNReader.test.tao' } }],
    },
    sourcePath: 'HNReader.test.tao',
    version: 1,
  }
}

function countdownJourney(): HostJourney {
  return {
    check: {
      name: 'counts down',
      run: { appName: 'Clockwork', appSourcePath: 'Clockwork.tao', source: { filePath: 'Clockwork.test.tao' } },
      source: { filePath: 'Clockwork.test.tao' },
      steps: [
        {
          kind: 'expect',
          missing: false,
          selector: 'text',
          source: { filePath: 'Clockwork.test.tao' },
          text: 'Countdown: 0:10',
        },
        { kind: 'advance', milliseconds: 1_000, source: { filePath: 'Clockwork.test.tao' } },
        {
          kind: 'expectNavigationTitle',
          source: { filePath: 'Clockwork.test.tao' },
          title: 'Hacker News',
        },
        {
          kind: 'expect',
          missing: false,
          selector: 'text',
          source: sourceWithRange('Clockwork.test.tao', 12),
          text: 'Countdown: 0:09',
        },
      ],
    },
    sourcePath: 'Clockwork.test.tao',
    version: 1,
  }
}

function sourceWithRange(
  filePath: string,
  line: number,
): {
  filePath: string
  range: { end: { character: number; line: number }; start: { character: number; line: number } }
} {
  return { filePath, range: { end: { character: 24, line }, start: { character: 0, line } } }
}
