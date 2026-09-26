import { AppiumNoSuchElementError } from '@appium-driver'
import {
  assertHostLease,
  type HostAction,
  type HostActionReceipt,
  type HostCapability,
  HostControlError,
  type HostController,
  type HostLeaseIdentity,
  type HostObservation,
  type HostObservationRequest,
  type HostPublishRevisionRequest,
  type HostRevision,
  type HostScreenshot,
  type HostSession,
  type HostSessionDescriptor,
  hostSessionTargetLeaseName,
  type HostTarget,
  MachineResources,
} from '@host-control'
import { Errors, FS, Repo, Time } from '@shared'

type AppiumPhysicalSigning = Readonly<{
  updatedWDABundleId: string
  xcodeOrgId: string
  xcodeSigningId: string
}>

export type AppiumTarget =
  | Readonly<{ appId: string; kind: 'simulator'; udid: string }>
  | Readonly<{ appId: string; kind: 'physical'; signing: AppiumPhysicalSigning; udid: string }>

export type AppiumLocator = Readonly<
  { using: 'accessibility id' | '-ios predicate string' | '-ios class chain'; value: string }
>

export type AppiumElement = Readonly<{
  click: () => Promise<void>
  getAttribute?: (name: string) => Promise<string | undefined>
  getRect?: () => Promise<Readonly<{ height: number; width: number; x: number; y: number }>>
  getText?: () => Promise<string>
  id: string
  isDisplayed: () => Promise<boolean>
  sendKeys: (text: string) => Promise<void>
}>

type AppiumRect = Readonly<{ height: number; width: number; x: number; y: number }>

/** AppiumWebDriverSession is deliberately transport-neutral so the real WebDriver binding remains injectable. */
export type AppiumWebDriverSession = Readonly<{
  activateApp?: (appId: string) => Promise<void>
  deleteSession: () => Promise<void>
  /** Clears stale system UI from an earlier session without accepting future application alerts. */
  dismissAlertIfPresent?: () => Promise<void>
  findElement: (locator: AppiumLocator) => Promise<AppiumElement>
  findElementFrom?: (scope: AppiumElement, locator: AppiumLocator) => Promise<AppiumElement>
  findElements: (locator: AppiumLocator) => Promise<readonly AppiumElement[]>
  findElementsFrom?: (scope: AppiumElement, locator: AppiumLocator) => Promise<readonly AppiumElement[]>
  id: string
  /** Opens a URL through XCUITest with the explicit target bundle, avoiding Simulator's confirmation UI. */
  openDeepLink?: (url: string, appId: string) => Promise<void>
  pressKey?: (key: string) => Promise<void>
  screenshot?: () => Promise<Uint8Array>
  scroll?: (input: Readonly<{ deltaX: number; deltaY: number; element?: AppiumElement }>) => Promise<void>
  terminateApp?: (appId: string) => Promise<void>
}>

/** AppiumXcuiTestDeepLinkSession is the narrow driver capability used only by the native test-control bridge. */
export type AppiumXcuiTestDeepLinkSession =
  & HostSession
  & Readonly<{
    openDeepLink: (url: string) => Promise<void>
  }>

/** AppiumXcuiTestClient is the only seam a real Appium server/WebDriver implementation must bind. */
export type AppiumXcuiTestClient = Readonly<{
  createSession: (capabilities: AppiumXcuiTestCapabilities) => Promise<AppiumWebDriverSession>
}>

export type AppiumXcuiTestCapabilities = Readonly<Record<string, boolean | number | string>>

export type AppiumLease = Readonly<{
  assertCurrent: (generation: string) => Promise<void>
  generation: string
  release: () => Promise<void>
}>

/** AppiumLeaseManager guards both a device UDID and each derived local port. */
export type AppiumLeaseManager = Readonly<{
  acquire: (name: string) => Promise<AppiumLease>
  tryAcquire: (name: string) => Promise<AppiumLease | undefined>
}>

export type AppiumSessionReceipt = Readonly<{
  allocation: Readonly<{ derivedDataPath: string; mjpegServerPort: number; wdaLocalPort: number }>
  build: string
  lifecycle: 'failed' | 'open' | 'opening' | 'closed'
  sessionId?: string
  source: string
  target: Readonly<{ kind: AppiumTarget['kind']; udid: string }>
  version: 1
}>

export type AppiumReceiptSink = Readonly<{
  write: (path: string, receipt: AppiumSessionReceipt) => Promise<void>
}>

/** AppiumRevisionPublisher deploys a development revision to the target before host-control exposes it. */
export type AppiumRevisionPublisher = (
  request: Readonly<{
    lease: HostLeaseIdentity
    revision: HostRevision
    target: AppiumTarget
  }>,
) => Promise<void>

export type AppiumXcuiTestControllerOptions = Readonly<{
  client: AppiumXcuiTestClient
  leases?: AppiumLeaseManager
  /** A proof command may reserve the simulator before build/install. It is consumed by one session open. */
  preheldTargetLease?: AppiumLease
  publishRevision?: AppiumRevisionPublisher
  receipts?: AppiumReceiptSink
  target: AppiumTarget
}>

const FIRST_MJPEG_PORT = 9100
const FIRST_WDA_PORT = 8100
const PORT_CANDIDATES = 1_000

/**
 * createAppiumXcuiTestController opens one Appium/XCUITest session at a time for one explicit iOS target.
 * It does not start Appium or supply real-device signing values: both are host integration responsibilities.
 */
export function createAppiumXcuiTestController(options: AppiumXcuiTestControllerOptions): HostController {
  return new AppiumXcuiTestController(options)
}

/** appiumXcuiTestCapabilities keeps simulator and physical-device capability policy inspectable and testable. */
export function appiumXcuiTestCapabilities(
  target: AppiumTarget,
  allocation: AppiumSessionReceipt['allocation'],
): AppiumXcuiTestCapabilities {
  const base = {
    'appium:automationName': 'XCUITest',
    'appium:bundleId': target.appId,
    'appium:derivedDataPath': allocation.derivedDataPath,
    'appium:mjpegServerPort': allocation.mjpegServerPort,
    'appium:udid': target.udid,
    'appium:wdaLocalPort': allocation.wdaLocalPort,
    platformName: 'iOS',
  } as const
  if (target.kind === 'simulator') {
    return base
  }
  return {
    ...base,
    'appium:updatedWDABundleId': target.signing.updatedWDABundleId,
    // Reusing a signed WDA avoids forcing an unnecessary reinstall on a physical device.
    'appium:useNewWDA': false,
    'appium:xcodeOrgId': target.signing.xcodeOrgId,
    'appium:xcodeSigningId': target.signing.xcodeSigningId,
  }
}

class AppiumXcuiTestController implements HostController {
  readonly #client: AppiumXcuiTestClient
  readonly #leases: AppiumLeaseManager
  readonly #receipts: AppiumReceiptSink
  readonly #publishRevision?: AppiumRevisionPublisher
  #preheldTargetLease: AppiumLease | undefined
  readonly #sessions = new Set<AppiumXcuiTestSession>()
  readonly #target: AppiumTarget

  constructor(options: AppiumXcuiTestControllerOptions) {
    this.#client = options.client
    this.#leases = options.leases ?? machineLeases()
    this.#preheldTargetLease = options.preheldTargetLease
    this.#publishRevision = options.publishRevision
    this.#receipts = options.receipts ?? fileReceipts()
    this.#target = options.target
  }

  async close(): Promise<void> {
    await Promise.all([...this.#sessions].map(session => session.closeForController()))
  }

  async openSession(
    options: Readonly<{
      artifactRoot: string
      mode: HostSessionDescriptor['mode']
      revision: HostRevision
      target: string
    }>,
  ): Promise<HostSession> {
    const revision = frozenRevision(options.revision)
    const targetLease = this.#preheldTargetLease ?? await this.#leases.acquire(iosTargetLeaseName(this.#target))
    this.#preheldTargetLease = undefined
    let allocation: { leases: readonly AppiumLease[]; value: AppiumSessionReceipt['allocation'] } | undefined
    let receiptPath: string | undefined
    let session: AppiumWebDriverSession | undefined
    try {
      allocation = await this.#allocate(options.artifactRoot, targetLease)
      receiptPath = FS.resolvePath(
        `appium/${safeSegment(this.#target.udid)}-${safeSegment(targetLease.generation)}.receipt.json`,
        options.artifactRoot,
      )
      const writeReceipt = async (lifecycle: AppiumSessionReceipt['lifecycle']): Promise<void> => {
        await this.#receipts.write(receiptPath!, {
          allocation: allocation!.value,
          build: revision.build,
          lifecycle,
          ...(session === undefined ? {} : { sessionId: session.id }),
          source: revision.source,
          target: { kind: this.#target.kind, udid: this.#target.udid },
          version: 1,
        })
      }
      await writeReceipt('opening')
      session = await this.#client.createSession(appiumXcuiTestCapabilities(this.#target, allocation.value))
      await session.dismissAlertIfPresent?.()
      await writeReceipt('open')
      const hostSession = new AppiumXcuiTestSession({
        allocationLeases: allocation.leases,
        allocation: allocation.value,
        artifactRoot: options.artifactRoot,
        descriptor: {
          capabilities: sessionCapabilities(session),
          driver: 'appium-xcuitest',
          id: session.id,
          lease: { generation: targetLease.generation, name: iosTargetLeaseName(this.#target) },
          mode: options.mode,
          revision,
          target: options.target,
          version: 1,
        },
        onClosed: () => this.#sessions.delete(hostSession),
        publishRevision: this.#publishRevision,
        receiptPath,
        receipts: this.#receipts,
        session,
        target: this.#target,
        targetLease,
      })
      this.#sessions.add(hostSession)
      return hostSession
    } catch (error) {
      if (allocation !== undefined && receiptPath !== undefined) {
        await this.#receipts.write(receiptPath, {
          allocation: allocation.value,
          build: revision.build,
          lifecycle: 'failed',
          ...(session === undefined ? {} : { sessionId: session.id }),
          source: revision.source,
          target: { kind: this.#target.kind, udid: this.#target.udid },
          version: 1,
        }).catch(() => {})
      }
      let sessionCleanupFailed = false
      if (session !== undefined) {
        try {
          await session.deleteSession()
        } catch {
          sessionCleanupFailed = true
        }
      }
      if (sessionCleanupFailed) {
        Errors.throwHostEnvironment(
          `Appium session '${
            session!.id
          }' could not be closed after opening failed; retaining its iOS target and port leases to prevent a concurrent session from reusing live resources.`,
          { details: { retainsTargetLease: true } },
        )
      }
      await releaseAll([...(allocation?.leases ?? []), targetLease])
      throw error
    }
  }

  async #allocate(artifactRoot: string, targetLease: AppiumLease): Promise<{
    leases: readonly AppiumLease[]
    value: AppiumSessionReceipt['allocation']
  }> {
    const wda = await this.#reservePort('wda', FIRST_WDA_PORT)
    try {
      const mjpeg = await this.#reservePort('mjpeg', FIRST_MJPEG_PORT)
      return {
        leases: [wda.lease, mjpeg.lease],
        value: {
          derivedDataPath: FS.resolvePath(
            `appium/xcode/${safeSegment(this.#target.udid)}-${safeSegment(targetLease.generation)}`,
            artifactRoot,
          ),
          mjpegServerPort: mjpeg.port,
          wdaLocalPort: wda.port,
        },
      }
    } catch (error) {
      await wda.lease.release()
      throw error
    }
  }

  async #reservePort(kind: 'mjpeg' | 'wda', first: number): Promise<{ lease: AppiumLease; port: number }> {
    const offset = stableOffset(`${kind}:${this.#target.udid}`)
    for (let step = 0; step < PORT_CANDIDATES; step += 1) {
      const port = first + (offset + step) % PORT_CANDIDATES
      const lease = await this.#leases.tryAcquire(`appium-${kind}-port-${port}`)
      if (lease !== undefined) {
        return { lease, port }
      }
    }
    Errors.throwHostEnvironment(`No Appium ${kind} port is available for iOS target '${this.#target.udid}'.`)
  }
}

class AppiumXcuiTestSession implements HostSession {
  readonly #allocationLeases: readonly AppiumLease[]
  readonly #artifactRoot: string
  #closed = false
  #closedReceiptPersisted = false
  #descriptor: HostSessionDescriptor
  readonly #elements = new Map<string, AppiumElement>()
  readonly #onClosed: () => void
  #operationChain: Promise<void> = Promise.resolve()
  #observationRevision = 0
  #screenshotSequence = 0
  readonly #receiptPath: string
  readonly #receipts: AppiumReceiptSink
  readonly #publishRevision?: AppiumRevisionPublisher
  #revision: HostRevision
  readonly #session: AppiumWebDriverSession
  readonly #target: AppiumTarget
  readonly #targetLease: AppiumLease
  #closePromise: Promise<void> | undefined
  #sessionDeleted = false

  constructor(
    options: Readonly<{
      allocation: AppiumSessionReceipt['allocation']
      allocationLeases: readonly AppiumLease[]
      artifactRoot: string
      descriptor: HostSessionDescriptor
      onClosed: () => void
      publishRevision?: AppiumRevisionPublisher
      receiptPath: string
      receipts: AppiumReceiptSink
      session: AppiumWebDriverSession
      target: AppiumTarget
      targetLease: AppiumLease
    }>,
  ) {
    this.#allocationLeases = options.allocationLeases
    this.#artifactRoot = options.artifactRoot
    this.#descriptor = frozenDescriptor(options.descriptor)
    this.#onClosed = options.onClosed
    this.#publishRevision = options.publishRevision
    this.#receiptPath = options.receiptPath
    this.#receipts = options.receipts
    this.#revision = this.#descriptor.revision
    this.#session = options.session
    this.#target = options.target
    this.#targetLease = options.targetLease
    this.#allocation = options.allocation
  }

  readonly #allocation: AppiumSessionReceipt['allocation']

  async captureScreenshot(name: string): Promise<HostScreenshot> {
    return await this.#serialize(async () => {
      await this.#assertUsable()
      if (this.#session.screenshot === undefined) {
        return unsupported('screenshot', 'The injected Appium client does not expose screenshots.')
      }
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) {
        Errors.throwUserInput('Appium screenshot names must use only letters, numbers, dots, underscores, or dashes.')
      }
      const fileName = name.endsWith('.png') ? name : `${name}.png`
      const sequence = ++this.#screenshotSequence
      const screenshotIdentity = [
        safeSegment(this.#target.kind),
        safeSegment(this.#target.udid),
        safeSegment(this.#descriptor.lease.generation),
        sequence,
      ].join('-')
      const artifactPath = FS.resolvePath(
        `appium/screenshots/${screenshotIdentity}-${fileName}`,
        this.#artifactRoot,
      )
      await FS.writeFile(artifactPath, await this.#session.screenshot())
      return {
        artifactPath,
        observationRevision: this.#advanceObservationRevision(),
        revision: this.#revision,
        sessionId: this.#descriptor.id,
        version: 1,
      }
    })
  }

  async close(lease: HostLeaseIdentity): Promise<void> {
    await this.#serialize(async () => {
      await this.#assertCloseLease(lease)
      await this.#close()
    })
  }

  async closeForController(): Promise<void> {
    await this.#serialize(async () => {
      await this.#assertCloseLease(this.#descriptor.lease)
      await this.#close()
    })
  }

  descriptor(): HostSessionDescriptor {
    return this.#descriptor
  }

  async openDeepLink(url: string): Promise<void> {
    await this.#serialize(async () => {
      await this.#assertUsable()
      if (this.#session.openDeepLink === undefined) {
        throw new HostControlError('unsupported', 'The injected Appium client does not expose XCUITest deep links.')
      }
      await this.#session.openDeepLink(url, this.#target.appId)
      this.#advanceObservationRevision()
    })
  }

  async observe(request: HostObservationRequest): Promise<HostObservation> {
    return await this.#serialize(async () => {
      await this.#assertUsable()
      if (!sameRevision(request.expectedRevision, this.#revision)) {
        return staleRevision(this.#revision, request.expectedRevision)
      }
      const element = await this.#findTarget(request.target)
      const visible = await element.isDisplayed()
      this.#elements.clear()
      this.#elements.set(element.id, element)
      return {
        ...(element.getAttribute === undefined ? {} : { accessibilityLabel: await element.getAttribute('label') }),
        ...(element.getRect === undefined ? {} : { bounds: await element.getRect() }),
        id: element.id,
        lease: this.#descriptor.lease,
        observationRevision: this.#advanceObservationRevision(false),
        revision: this.#revision,
        sessionId: this.#descriptor.id,
        target: request.target,
        ...(element.getText === undefined ? {} : { text: await element.getText() }),
        timestamp: new Date(Time.nowMs()).toISOString(),
        visible,
        version: 1,
      }
    })
  }

  async perform(action: HostAction): Promise<HostActionReceipt> {
    return await this.#serialize(async () => {
      await this.#assertLease(action.lease)
      if (!sameRevision(action.expectedRevision, this.#revision)) {
        return staleRevision(this.#revision, action.expectedRevision)
      }
      if (action.kind === 'click') {
        const element = this.#elementFor(action.observation)
        await element.click()
      } else if (action.kind === 'key') {
        if (this.#session.pressKey === undefined) {
          return unsupported('key', 'The injected Appium client does not expose key input.')
        }
        await this.#session.pressKey(action.key)
      } else if (action.kind === 'refreshDocument') {
        return unsupported('refreshDocument', 'Appium/XCUITest has no document-refresh operation.')
      } else if (action.kind === 'relaunchApplication') {
        if (this.#session.terminateApp === undefined || this.#session.activateApp === undefined) {
          return unsupported(
            'relaunchApplication',
            'The injected Appium client does not expose app lifecycle commands.',
          )
        }
        await this.#session.terminateApp(this.#target.appId)
        await this.#session.activateApp(this.#target.appId)
      } else if (action.kind === 'scroll') {
        if (this.#session.scroll === undefined) {
          return unsupported('scroll', 'The injected Appium client does not expose native scrolling.')
        }
        await this.#session.scroll({
          deltaX: action.deltaX,
          deltaY: action.deltaY,
          ...(action.observation === undefined ? {} : { element: this.#elementFor(action.observation) }),
        })
      } else {
        const element = this.#elementFor(action.observation)
        await element.sendKeys(action.text)
      }
      return {
        action: action.kind,
        lease: this.#descriptor.lease,
        observationRevision: this.#advanceObservationRevision(),
        revision: this.#revision,
        sessionId: this.#descriptor.id,
        version: 1,
      }
    })
  }

  async publishRevision(request: HostPublishRevisionRequest): Promise<void> {
    await this.#serialize(async () => {
      await this.#assertLease(request.lease)
      if (!sameRevision(request.expectedCurrentRevision, this.#revision)) {
        return staleRevision(this.#revision, request.expectedCurrentRevision)
      }
      if (this.#descriptor.mode === 'acceptance') {
        return unsupported('refreshDocument', 'Acceptance Appium sessions cannot publish a source revision.')
      }
      if (this.#publishRevision === undefined) {
        return unsupported('refreshDocument', 'The Appium host does not expose native revision publication.')
      }
      const revision = frozenRevision(request.revision)
      await this.#publishRevision({ lease: request.lease, revision, target: this.#target })
      this.#revision = revision
      this.#descriptor = frozenDescriptor({ ...this.#descriptor, revision })
      this.#advanceObservationRevision()
    })
  }

  async #assertLease(lease: HostLeaseIdentity): Promise<void> {
    await this.#assertUsable()
    assertHostLease(this.#descriptor.lease, lease)
    await this.#targetLease.assertCurrent(lease.generation)
  }

  async #assertCloseLease(lease: HostLeaseIdentity): Promise<void> {
    assertHostLease(this.#descriptor.lease, lease)
    if (!this.#closed && !this.#closedReceiptPersisted) {
      await this.#targetLease.assertCurrent(lease.generation)
    }
  }

  async #assertUsable(): Promise<void> {
    if (this.#closed) {
      throw new HostControlError('closed', `Appium session '${this.#descriptor.id}' is closed.`)
    }
    await this.#targetLease.assertCurrent(this.#descriptor.lease.generation)
  }

  async #close(): Promise<void> {
    if (this.#closed) {
      return
    }
    if (this.#closePromise === undefined) {
      this.#closePromise = this.#closeResources().finally(() => {
        if (!this.#closed) {
          this.#closePromise = undefined
        }
      })
    }
    await this.#closePromise
  }

  async #closeResources(): Promise<void> {
    if (!this.#sessionDeleted) {
      await this.#session.deleteSession()
      this.#sessionDeleted = true
    }
    if (!this.#closedReceiptPersisted) {
      await this.#receipts.write(this.#receiptPath, {
        allocation: this.#allocation,
        build: this.#revision.build,
        lifecycle: 'closed',
        sessionId: this.#descriptor.id,
        source: this.#revision.source,
        target: { kind: this.#target.kind, udid: this.#target.udid },
        version: 1,
      })
      this.#closedReceiptPersisted = true
    }
    await releaseAll([...this.#allocationLeases, this.#targetLease])
    this.#closed = true
    this.#onClosed()
  }

  #advanceObservationRevision(clearElements = true): number {
    if (clearElements) {
      this.#elements.clear()
    }
    this.#observationRevision += 1
    return this.#observationRevision
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationChain.then(operation, operation)
    this.#operationChain = result.then(() => {}, () => {})
    return await result
  }

  #elementFor(observation: HostObservation): AppiumElement {
    if (
      observation.sessionId !== this.#descriptor.id
      || observation.observationRevision !== this.#observationRevision
      || !sameRevision(observation.revision, this.#revision)
    ) {
      return staleObservation(this.#descriptor.id)
    }
    assertHostLease(this.#descriptor.lease, observation.lease)
    const element = this.#elements.get(observation.id)
    if (element === undefined) {
      return staleObservation(this.#descriptor.id)
    }
    return element
  }

  async #findTarget(target: HostTarget): Promise<AppiumElement> {
    if (target.kind === 'scoped') {
      const scope = await this.#findTarget(target.scope)
      return await this.#findTargetWithin(scope, target.target)
    }
    const occurrence = target.occurrence ?? 1
    const locator = locatorFor(target)
    if (occurrence === 1) {
      return await this.#session.findElement(locator)
    }
    const element = (await this.#session.findElements(locator))[occurrence - 1]
    if (element === undefined) {
      throw new HostControlError(
        'assertion',
        `Appium/XCUITest did not find occurrence ${occurrence} for the requested native target.`,
        { occurrence, target },
      )
    }
    return element
  }

  async #findTargetWithin(
    scope: AppiumElement,
    target: HostTarget,
  ): Promise<AppiumElement> {
    if (target.kind === 'scoped') {
      const nestedScope = await this.#findTargetWithin(scope, target.scope)
      return await this.#findTargetWithin(nestedScope, target.target)
    }
    const occurrence = target.occurrence ?? 1
    const locator = locatorFor(target)
    try {
      if (occurrence === 1) {
        if (this.#session.findElementFrom === undefined) {
          return unsupported('inspect', 'The Appium client does not expose element-relative native lookup.')
        }
        return await this.#session.findElementFrom(scope, locator)
      }
      if (this.#session.findElementsFrom === undefined) {
        return unsupported('inspect', 'The Appium client does not expose element-relative native lookup.')
      }
      const element = (await this.#session.findElementsFrom(scope, locator))[occurrence - 1]
      if (element === undefined) {
        return missingScopedOccurrence(occurrence, target)
      }
      return element
    } catch (error) {
      if (!(error instanceof AppiumNoSuchElementError)) {
        throw error
      }
      return await this.#findFlattenedWithin(scope, target)
    }
  }

  async #findFlattenedWithin(
    scope: AppiumElement,
    target: Exclude<HostTarget, { kind: 'scoped' }>,
  ): Promise<AppiumElement> {
    const occurrence = target.occurrence ?? 1
    if (scope.getRect === undefined) {
      return missingScopedOccurrence(occurrence, target)
    }
    const scopeRect = await scope.getRect()
    const contained: AppiumElement[] = []
    for (const candidate of await this.#session.findElements(locatorFor(target))) {
      if (candidate.getRect !== undefined && rectContainsCenter(scopeRect, await candidate.getRect())) {
        contained.push(candidate)
      }
    }
    return contained[occurrence - 1] ?? missingScopedOccurrence(occurrence, target)
  }
}

function missingScopedOccurrence(occurrence: number, target: HostTarget): never {
  throw new HostControlError(
    'assertion',
    `Appium/XCUITest did not find occurrence ${occurrence} within the requested native scope.`,
    { occurrence, target },
  )
}

function rectContainsCenter(container: AppiumRect, candidate: AppiumRect): boolean {
  const centerX = candidate.x + candidate.width / 2
  const centerY = candidate.y + candidate.height / 2
  return centerX >= container.x && centerX <= container.x + container.width
    && centerY >= container.y && centerY <= container.y + container.height
}

function fileReceipts(): AppiumReceiptSink {
  return { write: async (path, receipt) => await FS.writeJson(path, receipt) }
}

function frozenDescriptor(descriptor: HostSessionDescriptor): HostSessionDescriptor {
  return Object.freeze({
    ...descriptor,
    capabilities: Object.freeze([...descriptor.capabilities]),
    lease: Object.freeze({ ...descriptor.lease }),
    revision: frozenRevision(descriptor.revision),
  })
}

function frozenRevision(revision: HostRevision): HostRevision {
  return Object.freeze({ build: revision.build, source: revision.source })
}

function machineLeases(): AppiumLeaseManager {
  return {
    acquire: async name =>
      await MachineResources.acquire({
        command: 'appium-xcuitest',
        name,
        repositoryRoot: Repo.getRoot(),
      }),
    tryAcquire: async name =>
      await MachineResources.tryAcquire({
        command: 'appium-xcuitest',
        name,
        repositoryRoot: Repo.getRoot(),
      }),
  }
}

function locatorFor(target: HostTarget): AppiumLocator {
  if (target.kind === 'scoped') {
    return unsupported('inspect', 'Appium/XCUITest resolves nested scopes before creating a leaf locator.')
  }
  if (target.kind === 'tag') {
    return { using: 'accessibility id', value: target.value }
  }
  if (target.kind === 'accessibility') {
    if (target.role === 'textbox') {
      const types = 'type IN {"XCUIElementTypeTextField", "XCUIElementTypeSecureTextField", "XCUIElementTypeTextView"}'
      return {
        using: '-ios predicate string',
        value: target.name === '' ? types : `${types} AND label == ${JSON.stringify(target.name)}`,
      }
    }
    if (target.role === 'navigation-back') {
      return {
        using: '-ios class chain',
        value: '**/XCUIElementTypeNavigationBar[`visible == true`]/XCUIElementTypeButton[1]',
      }
    }
    if (target.role !== undefined) {
      return unsupported('inspect', 'Appium/XCUITest cannot enforce an accessibility role for this target.')
    }
    return { using: 'accessibility id', value: target.name }
  }
  return { using: '-ios predicate string', value: `label == ${JSON.stringify(target.value)}` }
}

function releaseAll(leases: readonly AppiumLease[]): Promise<void> {
  return Promise.all(leases.toReversed().map(lease => lease.release())).then(() => {})
}

function safeSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, '_')
}

function sameRevision(left: HostRevision, right: HostRevision): boolean {
  return left.build === right.build && left.source === right.source
}

function sessionCapabilities(session: AppiumWebDriverSession): HostCapability[] {
  return [
    'inspect',
    ...(session.pressKey === undefined ? [] : ['key' as const]),
    ...(session.screenshot === undefined ? [] : ['screenshot' as const]),
    ...(session.scroll === undefined ? [] : ['scroll' as const]),
    ...(session.terminateApp === undefined || session.activateApp === undefined
      ? []
      : ['relaunchApplication' as const]),
    'pointer',
    'textInput',
  ]
}

function stableOffset(value: string): number {
  let hash = 0
  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0
  }
  return hash % PORT_CANDIDATES
}

function staleObservation(sessionId: string): never {
  throw new HostControlError('staleObservation', `Observation is no longer current for Appium session '${sessionId}'.`)
}

function staleRevision(actual: HostRevision, expected: HostRevision): never {
  throw new HostControlError('staleRevision', 'Appium session revision is no longer current.', { actual, expected })
}

/** iosTargetLeaseName is shared before build/install so every iOS driver reserves the same target. */
export function iosTargetLeaseName(target: AppiumTarget): string {
  return hostSessionTargetLeaseName({
    id: target.udid,
    kind: target.kind === 'simulator' ? 'iosSimulator' : 'iosDevice',
  })
}

function unsupported(capability: HostCapability, message: string): never {
  throw new HostControlError('unsupported', message, { capability })
}
