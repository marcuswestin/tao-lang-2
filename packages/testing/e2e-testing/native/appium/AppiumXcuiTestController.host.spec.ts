import { AppiumNoSuchElementError } from '@appium-driver'
import type { HostAction, HostObservation, HostRevision, HostSession } from '@host-control'
import { expect, test } from '@playwright/test'
import { Errors, FS, Repo } from '@shared'
import { assertNativeInputValue, enterNativeInput } from '../AppiumNativeInputs'
import {
  type AppiumElement,
  type AppiumLease,
  type AppiumLeaseManager,
  type AppiumLocator,
  type AppiumNavigationDiagnosticsSession,
  type AppiumReceiptSink,
  type AppiumRevisionPublisher,
  type AppiumSessionReceipt,
  type AppiumTarget,
  type AppiumWebDriverSession,
  type AppiumXcuiTestCapabilities,
  appiumXcuiTestCapabilities,
  type AppiumXcuiTestDeepLinkSession,
  type AppiumXcuiTestRevealSession,
  createAppiumXcuiTestController,
  iosTargetLeaseName,
} from './AppiumXcuiTestController'

const revision: HostRevision = { build: 'build-a', source: 'source-a' }

test('allocates collision-free Appium resources for two simulator UDIDs', async () => {
  const leases = new FakeLeases()
  const receipts = new FakeReceipts()
  const firstClient = new FakeClient('first')
  const secondClient = new FakeClient('second')
  const first = appiumController(firstClient, leases, simulator('SIM-A'), receipts)
  const second = appiumController(secondClient, leases, simulator('SIM-B'), receipts)

  const [firstSession, secondSession] = await Promise.all([open(first), open(second)])

  expect(firstClient.capabilities[0]?.['appium:udid']).toBe('SIM-A')
  expect(secondClient.capabilities[0]?.['appium:udid']).toBe('SIM-B')
  expect(firstClient.capabilities[0]?.['appium:wdaLocalPort']).not.toBe(
    secondClient.capabilities[0]?.['appium:wdaLocalPort'],
  )
  expect(firstClient.capabilities[0]?.['appium:mjpegServerPort']).not.toBe(
    secondClient.capabilities[0]?.['appium:mjpegServerPort'],
  )
  expect(firstClient.capabilities[0]?.['appium:derivedDataPath']).not.toBe(
    secondClient.capabilities[0]?.['appium:derivedDataPath'],
  )
  expect(firstClient.capabilities[0]).not.toHaveProperty('appium:autoAcceptAlerts')
  expect(firstClient.capabilities[0]?.['appium:simulatorPasteboardAutomaticSync']).toBe('off')
  expect(firstClient.sessions[0]?.alertDismissals).toBe(1)
  expect(secondClient.sessions[0]?.alertDismissals).toBe(1)
  expect(
    receipts.records.find(record => record.receipt.target.udid === 'SIM-A' && record.receipt.lifecycle === 'open')
      ?.receipt,
  ).toMatchObject({
    build: 'build-a',
    lifecycle: 'open',
    source: 'source-a',
    target: { kind: 'simulator', udid: 'SIM-A' },
  })

  await firstSession.close(firstSession.descriptor().lease)
  await secondSession.close(secondSession.descriptor().lease)
})

test('uses canonical iOS target names and consumes a preheld simulator lease without reacquiring it', async () => {
  const leases = new FakeLeases()
  const target = simulator('SIM-PREHELD')
  const artifactRoot = await Repo.mkScratchDir('tao-appium-preheld-')
  expect(iosTargetLeaseName(target)).toBe('ios-simulator:SIM-PREHELD')
  expect(iosTargetLeaseName({
    appId: 'dev.tao.app',
    kind: 'physical',
    signing: { updatedWDABundleId: 'dev.tao.wda', xcodeOrgId: 'TEAM', xcodeSigningId: 'Apple Development' },
    udid: 'DEVICE-PREHELD',
  })).toBe('ios-device:DEVICE-PREHELD')

  const preheldTargetLease = await leases.acquire(iosTargetLeaseName(target))
  const session = await createAppiumXcuiTestController({
    client: new FakeClient('preheld'),
    leases,
    preheldTargetLease,
    target,
  }).openSession({ artifactRoot, mode: 'acceptance', revision, target: 'hnreader' })
  try {
    expect(session.descriptor().lease).toMatchObject({ name: 'ios-simulator:SIM-PREHELD' })
  } finally {
    await session.close(session.descriptor().lease)
    await FS.remove(artifactRoot)
  }
})

test('retains target and derived-port leases when an escaped session cannot be deleted', async () => {
  const leases = new FakeLeases()
  const client = new FakeClient('escaped-open')
  const receipts = new FakeReceipts()
  receipts.failWhen('open')
  client.sessions[0]!.failDeleteOnce()
  const controller = appiumController(client, leases, simulator('SIM-ESCAPED-OPEN'), receipts)

  await expect(open(controller)).rejects.toMatchObject({ details: { retainsTargetLease: true } })
  expect(client.sessions[0]?.deleteAttempts).toBe(1)
  await expect(open(appiumController(new FakeClient('competing'), leases, simulator('SIM-ESCAPED-OPEN')))).rejects
    .toThrow(
      "Machine resource 'ios-simulator:SIM-ESCAPED-OPEN' is busy",
    )
})

test('captures hidden navigation descendants and refuses capture after session close', async () => {
  const artifactRoot = await Repo.mkScratchDir('tao-native-navigation-diagnostics-')
  const client = new FakeClient('diagnostics')
  const driver = client.sessions[0]!
  driver.visible = false
  const bar = new FakeElement(driver, 'bar', 'Library workspace')
  const title = Object.assign(
    new FakeElement(driver, 'title', 'Library workspace', { x: 0, y: 0, width: 0, height: 0 }),
    {
      getAttribute: async (name: string) =>
        ({ label: 'Library workspace', name: 'Library workspace', type: 'XCUIElementTypeStaticText' })[
          name as 'label' | 'name' | 'type'
        ],
    },
  )
  driver.findElements = async locator => {
    if (locator.using === '-ios predicate string') {
      expect(locator.value).toBe('label == "Library workspace" OR name == "Library workspace"')
      return [title]
    }
    expect(locator).toEqual({ using: '-ios class chain', value: '**/XCUIElementTypeNavigationBar' })
    return [bar]
  }
  Object.assign(driver, {
    findElementsFrom: async (scope: AppiumElement, locator: AppiumLocator) => {
      expect(scope.id).toBe('bar')
      expect(locator.value).toBe('**/*')
      return [title]
    },
  })
  const session = await open(
    appiumController(client, new FakeLeases(), simulator('SIM-DIAGNOSTICS')),
    'acceptance',
    artifactRoot,
  ) as AppiumNavigationDiagnosticsSession
  try {
    const capture = await session.captureNavigationDiagnostics('root', ['Library workspace'])
    expect(await FS.readJson(capture.artifactPath)).toMatchObject({
      matchingTitles: [{ title: 'Library workspace', elements: [{ id: 'title', visible: false }] }],
      navigationBars: [{
        id: 'bar',
        visible: false,
        children: [{
          id: 'title',
          label: 'Library workspace',
          type: 'XCUIElementTypeStaticText',
          text: 'Library workspace',
          visible: false,
          rect: { width: 0, height: 0 },
        }],
      }],
    })
    await session.close(session.descriptor().lease)
    await expect(session.captureNavigationDiagnostics('closed')).rejects.toThrow('closed')
  } finally {
    await session.close(session.descriptor().lease)
    await FS.remove(artifactRoot)
  }
})

test('writes immutable screenshot evidence for repeated captures across two sessions', async () => {
  const artifactRoot = await Repo.mkScratchDir('tao-appium-screenshots-')
  const leases = new FakeLeases()
  const first = await open(
    appiumController(new FakeClient('first-screenshot'), leases, simulator('SIM-SHOT-A')),
    'acceptance',
    artifactRoot,
  )
  const second = await open(
    appiumController(new FakeClient('second-screenshot'), leases, simulator('SIM-SHOT-B')),
    'acceptance',
    artifactRoot,
  )

  try {
    const [firstCapture, secondCapture, repeatedFirstCapture] = await Promise.all([
      first.captureScreenshot('checkpoint'),
      second.captureScreenshot('checkpoint'),
      first.captureScreenshot('checkpoint'),
    ])

    expect([
      firstCapture.artifactPath,
      secondCapture.artifactPath,
      repeatedFirstCapture.artifactPath,
    ]).toEqual([
      FS.resolvePath('appium/screenshots/simulator-SIM-SHOT-A-lease-1-1-checkpoint.png', artifactRoot),
      FS.resolvePath('appium/screenshots/simulator-SIM-SHOT-B-lease-4-1-checkpoint.png', artifactRoot),
      FS.resolvePath('appium/screenshots/simulator-SIM-SHOT-A-lease-1-2-checkpoint.png', artifactRoot),
    ])
    expect(
      new Set([
        firstCapture.artifactPath,
        secondCapture.artifactPath,
        repeatedFirstCapture.artifactPath,
      ]).size,
    ).toBe(3)
    await expect(Promise.all([
      FS.exists(firstCapture.artifactPath),
      FS.exists(secondCapture.artifactPath),
      FS.exists(repeatedFirstCapture.artifactPath),
    ])).resolves.toEqual([true, true, true])
  } finally {
    await first.close(first.descriptor().lease)
    await second.close(second.descriptor().lease)
    await FS.remove(artifactRoot)
  }
})

test('resolves nested host selections through Appium element-relative lookup', async () => {
  const client = new FakeClient('scoped')
  const session = await open(appiumController(client, new FakeLeases(), simulator('SIM-SCOPED')))
  try {
    const observation = await session.observe({
      expectedRevision: revision,
      target: {
        kind: 'scoped',
        scope: { kind: 'tag', occurrence: 2, value: 'reading' },
        target: { kind: 'text', value: 'Why local-first sync wins' },
      },
    })

    expect(observation.id).toBe('entry-2-child')
    expect(client.sessions[0]?.locators).toEqual([
      { using: 'accessibility id', value: 'reading' },
      { using: '-ios predicate string', value: 'label == "Why local-first sync wins"' },
    ])
    expect(client.sessions[0]?.scopes).toEqual(['entry-2'])
  } finally {
    await session.close(session.descriptor().lease)
  }
})

test('preserves scoped Tao selection when XCUITest flattens visual children in its accessibility tree', async () => {
  const client = new FakeClient('flattened')
  client.sessions[0]!.flattenScopedHierarchy = true
  const session = await open(appiumController(client, new FakeLeases(), simulator('SIM-FLATTENED')))
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
  }
})

test('opens iOS control deep links through the current target application', async () => {
  const client = new FakeClient('deep-link')
  const session = await open(appiumController(client, new FakeLeases(), simulator('SIM-DEEP-LINK')))
  try {
    await (session as AppiumXcuiTestDeepLinkSession).openDeepLink('taohostpoc-run://control?advanceMs=1000')

    expect(client.sessions[0]?.deepLinks).toEqual([{
      appId: 'dev.tao.app',
      url: 'taohostpoc-run://control?advanceMs=1000',
    }])
  } finally {
    await session.close(session.descriptor().lease)
  }
})

test('copies and freezes caller revisions for acceptance evidence and successful publication', async () => {
  const leases = new FakeLeases()
  const acceptanceReceipts = new FakeReceipts()
  const openedRevision = { build: 'build-a', source: 'source-a' }
  const acceptance = await appiumController(
    new FakeClient('frozen-acceptance'),
    leases,
    simulator('SIM-FROZEN-ACCEPTANCE'),
    acceptanceReceipts,
  ).openSession({
    artifactRoot: '/artifacts',
    mode: 'acceptance',
    revision: openedRevision,
    target: 'hnreader',
  })
  openedRevision.build = 'caller-mutated-build'
  openedRevision.source = 'caller-mutated-source'

  expect(acceptance.descriptor().revision).toEqual({ build: 'build-a', source: 'source-a' })
  expect(Object.isFrozen(acceptance.descriptor().revision)).toBe(true)
  const acceptanceObservation = await acceptance.observe({
    expectedRevision: revision,
    target: { kind: 'accessibility', name: 'entry' },
  })
  expect(acceptanceObservation.revision).toEqual({ build: 'build-a', source: 'source-a' })
  await acceptance.close(acceptance.descriptor().lease)
  expect(acceptanceReceipts.records.at(-1)?.receipt).toMatchObject({
    build: 'build-a',
    lifecycle: 'closed',
    source: 'source-a',
  })

  const publicationReceipts = new FakeReceipts()
  let publishedByHost: HostRevision | undefined
  const development = await open(
    appiumController(
      new FakeClient('frozen-development'),
      leases,
      simulator('SIM-FROZEN-DEVELOPMENT'),
      publicationReceipts,
      async request => {
        publishedByHost = request.revision
      },
    ),
    'development',
  )
  const publishedRevision = { build: 'build-b', source: 'source-b' }
  await development.publishRevision({
    expectedCurrentRevision: revision,
    lease: development.descriptor().lease,
    revision: publishedRevision,
  })
  publishedRevision.build = 'caller-mutated-build'
  publishedRevision.source = 'caller-mutated-source'

  expect(publishedByHost).toEqual({ build: 'build-b', source: 'source-b' })
  expect(Object.isFrozen(publishedByHost)).toBe(true)
  expect(development.descriptor().revision).toEqual({ build: 'build-b', source: 'source-b' })
  const developmentObservation = await development.observe({
    expectedRevision: { build: 'build-b', source: 'source-b' },
    target: { kind: 'accessibility', name: 'entry' },
  })
  expect(developmentObservation.revision).toEqual({ build: 'build-b', source: 'source-b' })
  await development.close(development.descriptor().lease)
  expect(publicationReceipts.records.at(-1)?.receipt).toMatchObject({
    build: 'build-b',
    lifecycle: 'closed',
    source: 'source-b',
  })
})

test('reports a busy target, keeps inputs isolated, and releases only the session it closes', async () => {
  const leases = new FakeLeases()
  const firstClient = new FakeClient('first')
  const secondClient = new FakeClient('second')
  const first = appiumController(firstClient, leases, simulator('SIM-A'))
  const competing = appiumController(new FakeClient('competing'), leases, simulator('SIM-A'))
  const second = appiumController(secondClient, leases, simulator('SIM-B'))
  const firstSession = await open(first)

  await expect(open(competing)).rejects.toThrow("Machine resource 'ios-simulator:SIM-A' is busy")

  const secondSession = await open(second)
  const firstObservation = await firstSession.observe({
    expectedRevision: revision,
    target: { kind: 'accessibility', name: 'entry' },
  })
  await firstSession.perform(typeAction(firstSession, firstObservation, 'only first'))
  expect(firstClient.sessions[0]?.input).toEqual(['only first'])
  expect(secondClient.sessions[0]?.input).toEqual([])

  await firstSession.close(firstSession.descriptor().lease)
  await secondSession.perform({
    expectedRevision: revision,
    kind: 'key',
    key: 'Enter',
    lease: secondSession.descriptor().lease,
  })
  expect(secondClient.sessions[0]?.keys).toEqual(['Enter'])
  expect(secondClient.sessions[0]?.deleted).toBe(false)

  await secondSession.close(secondSession.descriptor().lease)
})

test('native reveal invalidates its observation and requires a fresh lookup before input', async () => {
  const client = new FakeClient('reveal')
  client.sessions[0]!.visible = false
  const controller = appiumController(client, new FakeLeases(), simulator('SIM-REVEAL'))
  const session = await open(controller) as AppiumXcuiTestRevealSession
  try {
    const request = { expectedRevision: revision, target: { kind: 'accessibility' as const, name: 'entry' } }
    const hidden = await session.observe(request)
    expect(hidden.visible).toBe(false)
    await session.revealObservation(hidden)
    await expect(session.revealObservation(hidden)).rejects.toThrow('Observation is no longer current')
    await expect(session.perform(typeAction(session, hidden, 'stale write'))).rejects.toThrow(
      'Observation is no longer current',
    )
    expect(client.sessions[0]!.revealed).toHaveLength(1)
    expect(client.sessions[0]!.input).toEqual([])
    const visible = await session.observe(request)
    expect(visible.visible).toBe(true)
    await session.perform(typeAction(session, visible, 'fresh write'))
    expect(client.sessions[0]!.input).toEqual(['fresh write'])
  } finally {
    await controller.close()
  }
})

test('native reveal rejects foreign observation leases and fenced target leases before dispatch', async () => {
  const leases = new FakeLeases()
  const client = new FakeClient('reveal-fenced')
  const controller = appiumController(client, leases, simulator('SIM-REVEAL-FENCED'))
  const session = await open(controller) as AppiumXcuiTestRevealSession
  const observation = await session.observe({
    expectedRevision: revision,
    target: { kind: 'accessibility', name: 'entry' },
  })
  await expect(session.revealObservation({
    ...observation,
    lease: { ...observation.lease, generation: 'foreign-lease' },
  })).rejects.toThrow('no longer current')
  leases.fence('ios-simulator:SIM-REVEAL-FENCED')
  await expect(session.revealObservation(observation)).rejects.toThrow('is no longer current')
  expect(client.sessions[0]!.revealed).toEqual([])
  await expect(controller.close()).rejects.toThrow('is no longer current')
})

test('fences stale leases before they can mutate a session', async () => {
  const leases = new FakeLeases()
  const client = new FakeClient('fenced')
  const controller = appiumController(client, leases, simulator('SIM-FENCED'))
  const session = await open(controller)
  const observation = await session.observe({
    expectedRevision: revision,
    target: { kind: 'accessibility', name: 'entry' },
  })
  const wrongObservationLease: HostAction = {
    expectedRevision: revision,
    kind: 'type',
    lease: session.descriptor().lease,
    observation: { ...observation, lease: { ...observation.lease, generation: 'foreign-lease' } },
    text: 'wrong observation lease',
  }
  await expect(session.perform(wrongObservationLease)).rejects.toThrow('no longer current')
  expect(client.sessions[0]?.input).toEqual([])
  leases.fence('ios-simulator:SIM-FENCED')

  await expect(session.perform(typeAction(session, observation, 'blocked'))).rejects.toThrow('is no longer current')
  expect(client.sessions[0]?.input).toEqual([])
  await expect(controller.close()).rejects.toThrow('is no longer current')
  expect(client.sessions[0]?.deleted).toBe(false)
})

test('keeps acceptance immutable and only advances development after a publisher deploys it', async () => {
  const leases = new FakeLeases()
  const acceptance = await open(appiumController(new FakeClient('acceptance'), leases, simulator('SIM-ACCEPTANCE')))
  await expect(acceptance.publishRevision({
    expectedCurrentRevision: revision,
    lease: acceptance.descriptor().lease,
    revision: { build: 'build-b', source: 'source-b' },
  })).rejects.toThrow('Acceptance Appium sessions cannot publish a source revision')
  await acceptance.close(acceptance.descriptor().lease)

  const nextRevision = { build: 'build-b', source: 'source-b' }
  const absent = await open(
    appiumController(new FakeClient('absent'), leases, simulator('SIM-ABSENT')),
    'development',
  )
  await expect(absent.publishRevision({
    expectedCurrentRevision: revision,
    lease: absent.descriptor().lease,
    revision: nextRevision,
  })).rejects.toThrow(
    'The Appium host does not expose native revision publication',
  )
  expect(absent.descriptor().revision).toEqual({ build: 'build-a', source: 'source-a' })
  await absent.close(absent.descriptor().lease)

  const failed = await open(
    appiumController(
      new FakeClient('failed'),
      leases,
      simulator('SIM-FAILED'),
      new FakeReceipts(),
      async () => Errors.throwHostEnvironment('native deployment failed'),
    ),
    'development',
  )
  await expect(failed.publishRevision({
    expectedCurrentRevision: revision,
    lease: failed.descriptor().lease,
    revision: nextRevision,
  })).rejects.toThrow(
    'native deployment failed',
  )
  expect(failed.descriptor().revision).toEqual({ build: 'build-a', source: 'source-a' })
  await failed.close(failed.descriptor().lease)

  const publications: Array<{ before: HostRevision | undefined; revision: HostRevision }> = []
  let development: HostSession | undefined
  development = await open(
    appiumController(
      new FakeClient('development'),
      leases,
      simulator('SIM-DEVELOPMENT'),
      new FakeReceipts(),
      async request => {
        publications.push({ before: development?.descriptor().revision, revision: request.revision })
      },
    ),
    'development',
  )
  await development.publishRevision({
    expectedCurrentRevision: revision,
    lease: development.descriptor().lease,
    revision: nextRevision,
  })
  expect(publications).toEqual([{
    before: { build: 'build-a', source: 'source-a' },
    revision: { build: 'build-b', source: 'source-b' },
  }])
  expect(development.descriptor().revision).toEqual(nextRevision)
  await development.close(development.descriptor().lease)
})

test('maps a Tao tag to an accessibility identifier and selects its second native occurrence', async () => {
  const client = new FakeClient('tag-occurrence')
  const session = await open(appiumController(client, new FakeLeases(), simulator('SIM-TAGS')))
  const observation = await session.observe({
    expectedRevision: revision,
    target: { kind: 'tag', occurrence: 2, value: 'reading' },
  })

  expect(client.sessions[0]?.locators).toEqual([{ using: 'accessibility id', value: 'reading' }])
  expect(observation.id).toBe('entry-2')
  await session.perform(typeAction(session, observation, 'second row only'))
  expect(client.sessions[0]?.inputTargets).toEqual(['entry-2'])

  await session.close(session.descriptor().lease)
})

test('uses the exact physical signing inputs and only physical WDA policy', () => {
  const allocation = { derivedDataPath: '/artifacts/wda', mjpegServerPort: 9201, wdaLocalPort: 8201 }
  const simulatorCapabilities = appiumXcuiTestCapabilities(simulator('SIM-CAP'), allocation)
  const physicalCapabilities = appiumXcuiTestCapabilities({
    appId: 'dev.tao.app',
    kind: 'physical',
    signing: {
      updatedWDABundleId: 'dev.tao.wda',
      xcodeOrgId: 'ORG-EXPLICIT',
      xcodeSigningId: 'Apple Development: Explicit Team',
    },
    udid: 'DEVICE-CAP',
  }, allocation)

  expect(simulatorCapabilities).toMatchObject({
    'appium:automationName': 'XCUITest',
    'appium:udid': 'SIM-CAP',
    platformName: 'iOS',
  })
  expect(simulatorCapabilities['appium:xcodeOrgId']).toBeUndefined()
  expect(simulatorCapabilities['appium:useNewWDA']).toBeUndefined()
  expect(physicalCapabilities).toMatchObject({
    'appium:updatedWDABundleId': 'dev.tao.wda',
    'appium:useNewWDA': false,
    'appium:xcodeOrgId': 'ORG-EXPLICIT',
    'appium:xcodeSigningId': 'Apple Development: Explicit Team',
    'appium:udid': 'DEVICE-CAP',
  })
})

test('does not retry an ambiguous Appium input failure', async () => {
  const client = new FakeClient('ambiguous')
  const controller = appiumController(client, new FakeLeases(), simulator('SIM-AMBIGUOUS'))
  const session = await open(controller)
  const observation = await session.observe({
    expectedRevision: revision,
    target: { kind: 'accessibility', name: 'entry' },
  })
  client.sessions[0]?.failInputOnce()

  await expect(session.perform(typeAction(session, observation, 'uncertain'))).rejects.toThrow(
    'connection lost after input dispatch',
  )
  expect(client.sessions[0]?.inputAttempts).toBe(1)

  await session.close(session.descriptor().lease)
})

test('serializes deferred Appium input, later inspection, and controller close', async () => {
  const client = new FakeClient('serialized')
  const controller = appiumController(client, new FakeLeases(), simulator('SIM-SERIALIZED'))
  const session = await open(controller)
  const observation = await session.observe({
    expectedRevision: revision,
    target: { kind: 'accessibility', name: 'entry' },
  })
  client.sessions[0]?.deferInput()

  const input = session.perform(typeAction(session, observation, 'one at a time'))
  const laterObservation = session.observe({
    expectedRevision: revision,
    target: { kind: 'accessibility', name: 'entry' },
  })
  const close = controller.close()
  await Promise.resolve()
  expect(client.sessions[0]?.locators).toHaveLength(1)
  expect(client.sessions[0]?.deleted).toBe(false)

  client.sessions[0]?.resolveDeferredInput()
  await expect(input).resolves.toMatchObject({ action: 'type' })
  await expect(laterObservation).resolves.toMatchObject({ observationRevision: 3 })
  await expect(close).resolves.toBeUndefined()
  expect(client.sessions[0]?.deleted).toBe(true)
})

test('reports Appium hidden elements from the displayed-state endpoint', async () => {
  const client = new FakeClient('hidden')
  client.sessions[0]!.visible = false
  const controller = appiumController(client, new FakeLeases(), simulator('SIM-HIDDEN'))
  const session = await open(controller)

  await expect(session.observe({
    expectedRevision: revision,
    target: { kind: 'accessibility', name: 'entry' },
  })).resolves.toMatchObject({ visible: false })

  await session.close(session.descriptor().lease)
})

test('writes a closed receipt before releasing leases, and retries failed deletion without stranded bookkeeping', async () => {
  const events: string[] = []
  const leases = new FakeLeases(events)
  const client = new FakeClient('close-retry')
  client.sessions[0]?.failDeleteOnce()
  const controller = appiumController(client, leases, simulator('SIM-CLOSE-RETRY'), new FakeReceipts(events))
  await open(controller)

  await expect(controller.close()).rejects.toThrow('connection lost while ending session')
  expect(events).not.toContain('receipt:closed')
  expect(events.some(event => event.startsWith('release:'))).toBe(false)

  await expect(controller.close()).resolves.toBeUndefined()
  expect(events.indexOf('receipt:closed')).toBeLessThan(events.findIndex(event => event.startsWith('release:')))
  expect(client.sessions[0]?.deleteAttempts).toBe(2)

  await controller.close()
  expect(client.sessions[0]?.deleteAttempts).toBe(2)
  const reopened = await open(controller)
  await reopened.close(reopened.descriptor().lease)
})

test('shares one in-flight Appium close and persists its receipt before each lease release', async () => {
  const events: string[] = []
  const leases = new FakeLeases(events)
  const client = new FakeClient('single-flight-close')
  client.sessions[0]?.deferDelete()
  const session = await open(appiumController(client, leases, simulator('SIM-SINGLE-FLIGHT'), new FakeReceipts(events)))

  const firstClose = session.close(session.descriptor().lease)
  const secondClose = session.close(session.descriptor().lease)
  await client.sessions[0]!.waitForDeleteStart()
  expect(client.sessions[0]?.deleteAttempts).toBe(1)

  client.sessions[0]?.resolveDeferredDelete()
  await expect(Promise.all([firstClose, secondClose])).resolves.toEqual([undefined, undefined])
  expect(client.sessions[0]?.deleteAttempts).toBe(1)
  expect(events.indexOf('receipt:closed')).toBeLessThan(events.findIndex(event => event.startsWith('release:')))
})

function open(
  controller: ReturnType<typeof createAppiumXcuiTestController>,
  mode: 'acceptance' | 'development' = 'acceptance',
  artifactRoot = '/artifacts',
): Promise<HostSession> {
  return controller.openSession({
    artifactRoot,
    mode,
    revision,
    target: 'hnreader',
  })
}

function appiumController(
  client: FakeClient,
  leases: FakeLeases,
  target: AppiumTarget,
  receipts: AppiumReceiptSink = new FakeReceipts(),
  publishRevision?: AppiumRevisionPublisher,
): ReturnType<typeof createAppiumXcuiTestController> {
  return createAppiumXcuiTestController({ client, leases, publishRevision, receipts, target })
}

function simulator(udid: string): AppiumTarget {
  return { appId: 'dev.tao.app', kind: 'simulator', udid }
}

function typeAction(session: HostSession, observation: HostObservation, text: string): HostAction {
  return {
    expectedRevision: session.descriptor().revision,
    kind: 'type',
    lease: session.descriptor().lease,
    observation,
    text,
  }
}

class FakeClient {
  readonly capabilities: AppiumXcuiTestCapabilities[] = []
  readonly sessions: FakeSession[]

  constructor(name: string) {
    this.sessions = [new FakeSession(name)]
  }

  async createSession(capabilities: AppiumXcuiTestCapabilities): Promise<AppiumWebDriverSession> {
    this.capabilities.push(capabilities)
    return this.sessions[0]!
  }
}

class FakeSession implements AppiumWebDriverSession {
  readonly revealed: string[] = []
  alertDismissals = 0
  deleted = false
  deleteAttempts = 0
  readonly id: string
  readonly input: string[] = []
  readonly deepLinks: Array<{ appId: string; url: string }> = []
  flattenScopedHierarchy = false
  inputAttempts = 0
  readonly inputTargets: string[] = []
  readonly keys: string[] = []
  readonly locators: AppiumLocator[] = []
  readonly scopes: string[] = []
  visible = true
  #deferredDelete: Deferred | undefined
  #deferredInput: Deferred | undefined
  readonly #deleteStarted = new Deferred()
  #failDelete = false
  #failInput = false

  constructor(name: string) {
    this.id = `${name}-session`
  }

  async revealElement(element: AppiumElement): Promise<void> {
    this.revealed.push(element.id)
    this.visible = true
  }

  async deleteSession(): Promise<void> {
    this.deleteAttempts += 1
    this.#deleteStarted.resolve()
    if (this.#failDelete) {
      this.#failDelete = false
      Errors.throwHostEnvironment('connection lost while ending session')
    }
    await this.#deferredDelete?.promise
    this.deleted = true
  }

  async dismissAlertIfPresent(): Promise<void> {
    this.alertDismissals += 1
  }

  deferDelete(): void {
    this.#deferredDelete = new Deferred()
  }

  deferInput(): void {
    this.#deferredInput = new Deferred()
  }

  failDeleteOnce(): void {
    this.#failDelete = true
  }

  failInputOnce(): void {
    this.#failInput = true
  }

  async findElement(locator: AppiumLocator): Promise<FakeElement> {
    this.locators.push(locator)
    return (await this.elementsFor(locator))[0]!
  }

  async openDeepLink(url: string, appId: string): Promise<void> {
    this.deepLinks.push({ appId, url })
  }

  async findElements(locator: AppiumLocator): Promise<readonly FakeElement[]> {
    this.locators.push(locator)
    return await this.elementsFor(locator)
  }

  async findElementFrom(scope: AppiumElement, locator: AppiumLocator): Promise<FakeElement> {
    this.scopes.push(scope.id)
    this.locators.push(locator)
    if (this.flattenScopedHierarchy) {
      throw new AppiumNoSuchElementError('XCUITest exposed the visual child as an accessibility sibling')
    }
    return new FakeElement(this, `${scope.id}-child`)
  }

  consumeInputFailure(): boolean {
    const failed = this.#failInput
    this.#failInput = false
    return failed
  }

  async awaitDeferredInput(): Promise<void> {
    await this.#deferredInput?.promise
  }

  resolveDeferredDelete(): void {
    this.#deferredDelete?.resolve()
  }

  async waitForDeleteStart(): Promise<void> {
    await this.#deleteStarted.promise
  }

  resolveDeferredInput(): void {
    this.#deferredInput?.resolve()
  }

  async pressKey(key: string): Promise<void> {
    this.keys.push(key)
  }

  async screenshot(): Promise<Uint8Array> {
    return new Uint8Array()
  }

  async elementsFor(locator: AppiumLocator): Promise<readonly FakeElement[]> {
    if (this.flattenScopedHierarchy && locator.using === 'accessibility id') {
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
    return [new FakeElement(this, 'entry-1'), new FakeElement(this, 'entry-2')]
  }
}

class FakeElement {
  readonly id: string
  readonly #rect: Readonly<{ height: number; width: number; x: number; y: number }>
  readonly #session: FakeSession
  readonly #text: string

  constructor(
    session: FakeSession,
    id: string,
    text = id,
    rect: Readonly<{ height: number; width: number; x: number; y: number }> = { height: 1, width: 1, x: 0, y: 0 },
  ) {
    this.#session = session
    this.id = id
    this.#rect = rect
    this.#text = text
  }

  async click(): Promise<void> {}

  async isDisplayed(): Promise<boolean> {
    return this.#session.visible
  }

  async getRect(): Promise<Readonly<{ height: number; width: number; x: number; y: number }>> {
    return this.#rect
  }

  async getText(): Promise<string> {
    return this.#text
  }

  async sendKeys(text: string): Promise<void> {
    this.#session.inputAttempts += 1
    if (this.#session.consumeInputFailure()) {
      Errors.throwHostEnvironment('connection lost after input dispatch')
    }
    await this.#session.awaitDeferredInput()
    this.#session.input.push(text)
    this.#session.inputTargets.push(this.id)
  }
}

class FakeLeases implements AppiumLeaseManager {
  readonly #events: string[] | undefined
  readonly #leases = new Map<string, FakeLease>()
  #sequence = 0

  constructor(events?: string[]) {
    this.#events = events
  }

  async acquire(name: string): Promise<AppiumLease> {
    if (this.#leases.has(name)) {
      Errors.throwHostEnvironment(`Machine resource '${name}' is busy.`)
    }
    return this.#claim(name)
  }

  fence(name: string): void {
    const lease = this.#leases.get(name)
    if (lease !== undefined) {
      lease.current = false
    }
  }

  async tryAcquire(name: string): Promise<AppiumLease | undefined> {
    return this.#leases.has(name) ? undefined : this.#claim(name)
  }

  #claim(name: string): FakeLease {
    const lease = new FakeLease(name, `lease-${++this.#sequence}`, () => {
      this.#events?.push(`release:${name}`)
      this.#leases.delete(name)
    })
    this.#leases.set(name, lease)
    return lease
  }
}

class FakeLease implements AppiumLease {
  current = true
  readonly generation: string
  readonly #name: string
  readonly #onRelease: () => void

  constructor(name: string, generation: string, onRelease: () => void) {
    this.#name = name
    this.generation = generation
    this.#onRelease = onRelease
  }

  async assertCurrent(generation: string): Promise<void> {
    if (!this.current || generation !== this.generation) {
      Errors.throwHostEnvironment(`Machine resource '${this.#name}' is no longer current.`)
    }
  }

  async release(): Promise<void> {
    this.#onRelease()
  }
}

class FakeReceipts implements AppiumReceiptSink {
  readonly #events: string[] | undefined
  readonly records: Array<{ path: string; receipt: AppiumSessionReceipt }> = []
  #failLifecycle: AppiumSessionReceipt['lifecycle'] | undefined

  constructor(events?: string[]) {
    this.#events = events
  }

  async write(path: string, receipt: AppiumSessionReceipt): Promise<void> {
    if (this.#failLifecycle === receipt.lifecycle) {
      this.#failLifecycle = undefined
      Errors.throwHostEnvironment('receipt storage stopped accepting writes')
    }
    this.#events?.push(`receipt:${receipt.lifecycle}`)
    this.records.push({ path, receipt })
  }

  failWhen(lifecycle: AppiumSessionReceipt['lifecycle']): void {
    this.#failLifecycle = lifecycle
  }
}

class Deferred {
  readonly promise: Promise<void>
  readonly #resolve: () => void

  constructor() {
    let resolve: (() => void) | undefined
    this.promise = new Promise<void>(nextResolve => {
      resolve = nextResolve
    })
    this.#resolve = resolve!
  }

  resolve(): void {
    this.#resolve()
  }
}

test('native back identifies the navigation bar button even when the previous title labels it', async () => {
  const client = new FakeClient('native-back')
  const session = await open(appiumController(client, new FakeLeases(), simulator('SIM-NATIVE-BACK')))
  try {
    const observation = await session.observe({
      expectedRevision: revision,
      target: { kind: 'accessibility', name: 'Back', role: 'navigation-back' },
    })
    expect(observation.visible).toBe(true)
    expect(client.sessions[0]?.locators).toEqual([
      {
        using: '-ios class chain',
        value: '**/XCUIElementTypeNavigationBar[`visible == true`]/XCUIElementTypeButton[1]',
      },
    ])
  } finally {
    await session.close(session.descriptor().lease)
  }
})

test('tagged input entry and value assertions use its editable child, never the empty wrapper', async () => {
  const client = new FakeClient('editable-child')
  const remote = client.sessions[0]!
  const wrapper = new FakeElement(remote, 'wrapper', '')
  const input = new FakeElement(remote, 'editable', '')
  let value = ''
  const typedTargets: string[] = []
  input.getText = async () => value
  input.sendKeys = async text => {
    value = text
    typedTargets.push(input.id)
  }
  wrapper.sendKeys = async () => {
    Errors.throwUnexpected('The input wrapper is not editable.')
  }
  remote.findElement = async locator => {
    remote.locators.push(locator)
    return locator.using === 'accessibility id' ? wrapper : input
  }
  remote.findElementFrom = async (scope, locator) => {
    expect(scope.id).toBe('wrapper')
    remote.locators.push(locator)
    return input
  }
  const session = await open(appiumController(client, new FakeLeases(), simulator('SIM-EDITABLE')))
  try {
    await enterNativeInput(session, 'tag', 'nativeDraft', 'Keep this draft', [])
    await assertNativeInputValue(session, 'tag', 'nativeDraft', 'Keep this draft', [], 'Native Navigation.test.tao')
    await assertNativeInputValue(session, 'label', 'Note draft', 'Keep this draft', [], 'Native Navigation.test.tao')
    expect(typedTargets).toEqual(['editable'])
    expect(remote.locators).toEqual([
      { using: 'accessibility id', value: 'nativeDraft' },
      {
        using: '-ios predicate string',
        value: 'type IN {"XCUIElementTypeTextField", "XCUIElementTypeSecureTextField", "XCUIElementTypeTextView"}',
      },
      { using: 'accessibility id', value: 'nativeDraft' },
      {
        using: '-ios predicate string',
        value: 'type IN {"XCUIElementTypeTextField", "XCUIElementTypeSecureTextField", "XCUIElementTypeTextView"}',
      },
      {
        using: '-ios predicate string',
        value:
          'type IN {"XCUIElementTypeTextField", "XCUIElementTypeSecureTextField", "XCUIElementTypeTextView"} AND label == "Note draft"',
      },
    ])
  } finally {
    await session.close(session.descriptor().lease)
  }
})
