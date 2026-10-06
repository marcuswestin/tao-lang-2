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
import { Errors, FS, Repo, Switch, Time } from '@shared'
import type { ManagedMobileGrant } from '../ManagedMobileGrant'

export type AppiumAndroidBuild = Readonly<{
  apkPath: string
  compiledArtifactDigest: string
}>

/** An Android target is always an explicit emulator serial; physical devices need their own proof policy. */
export type AppiumAndroidTarget = Readonly<{
  appId: string
  kind: 'emulator'
  serial: string
}>

export type AppiumAndroidLocator = Readonly<{
  using: '-android uiautomator' | 'accessibility id'
  value: string
}>

export type AppiumAndroidElement = Readonly<{
  click: () => Promise<void>
  getAttribute?: (name: string) => Promise<string | undefined>
  getRect?: () => Promise<Readonly<{ height: number; width: number; x: number; y: number }>>
  getText?: () => Promise<string>
  id: string
  isDisplayed: () => Promise<boolean>
  sendKeys: (text: string) => Promise<void>
}>

type AppiumAndroidRect = Readonly<{ height: number; width: number; x: number; y: number }>

/** This is the seam implemented by the W3C HTTP client and kept injectable for host-free tests. */
export type AppiumAndroidWebDriverSession = Readonly<{
  activateApp: (appId: string) => Promise<void>
  deleteSession: () => Promise<void>
  findElement: (locator: AppiumAndroidLocator) => Promise<AppiumAndroidElement>
  findElements: (locator: AppiumAndroidLocator) => Promise<readonly AppiumAndroidElement[]>
  findElementWithin: (element: AppiumAndroidElement, locator: AppiumAndroidLocator) => Promise<AppiumAndroidElement>
  findElementsWithin: (
    element: AppiumAndroidElement,
    locator: AppiumAndroidLocator,
  ) => Promise<readonly AppiumAndroidElement[]>
  id: string
  pressKey: (key: string) => Promise<void>
  /** Invoked only after UUID publication and mounted managed-runtime proof. */
  prepareManagedRuntime?: () => Promise<void>
  screenshot: () => Promise<Uint8Array>
  scroll: (input: Readonly<{ deltaX: number; deltaY: number; element?: AppiumAndroidElement }>) => Promise<void>
  terminateApp: (appId: string) => Promise<void>
}>

export type AppiumAndroidClient = Readonly<{
  createSession: (capabilities: AppiumAndroidCapabilities) => Promise<AppiumAndroidWebDriverSession>
}>

export type AppiumAndroidCapabilities = Readonly<Record<string, boolean | number | string>>

export type AppiumAndroidLease = Readonly<{
  assertCurrent: (generation: string) => Promise<void>
  generation: string
  release: () => Promise<void>
}>

/** Leases protect the emulator serial and every UiAutomator2 port shared across worktrees. */
export type AppiumAndroidLeaseManager = Readonly<{
  acquire: (name: string) => Promise<AppiumAndroidLease>
  tryAcquire: (name: string) => Promise<AppiumAndroidLease | undefined>
}>

export type AppiumAndroidAllocation = Readonly<{
  mjpegServerPort: number
  systemPort: number
}>

export type AppiumAndroidSessionReceipt = Readonly<{
  allocation: AppiumAndroidAllocation
  artifact?: AppiumAndroidBuild
  build: string
  lifecycle: 'failed' | 'open' | 'opening' | 'closed'
  sessionId?: string
  source: string
  target: Readonly<{ appId: string; kind: 'emulator'; serial: string }>
  version: 1
}>

export type AppiumAndroidReceiptSink = Readonly<{
  write: (path: string, receipt: AppiumAndroidSessionReceipt) => Promise<void>
}>

type AppiumAndroidRevisionPublisher = (
  request: Readonly<{
    lease: HostLeaseIdentity
    revision: HostRevision
    target: AppiumAndroidTarget
  }>,
) => Promise<void>

export type AppiumAndroidControllerOptions = Readonly<{
  build: AppiumAndroidBuild
  client: AppiumAndroidClient
  leases?: AppiumAndroidLeaseManager
  /** A proof command may reserve the emulator before build/install. It is consumed by one session open. */
  preheldTargetLease?: AppiumAndroidLease
  publishRevision?: AppiumAndroidRevisionPublisher
  receipts?: AppiumAndroidReceiptSink
  target: AppiumAndroidTarget
}>

const FIRST_MJPEG_PORT = 9100
const FIRST_SYSTEM_PORT = 8200
const PORT_CANDIDATES = 1_000

/** Creates one fenced UiAutomator2 controller for one named Android emulator and isolated APK. */
export function createAppiumAndroidController(options: AppiumAndroidControllerOptions): HostController {
  return new AppiumAndroidController(options)
}

export function createManagedAppiumAndroidController(
  options: Omit<AppiumAndroidControllerOptions, 'build' | 'preheldTargetLease' | 'publishRevision'> & {
    grant: ManagedMobileGrant
    beforeDriverDeletion?: () => Promise<void>
  },
): HostController {
  if (
    options.grant.identity.target.platform !== 'android'
    || options.target.serial !== options.grant.identity.target.id
    || options.target.appId !== options.grant.identity.runtime.appId
  ) {
    Errors.throwUserInput('Managed Android attachment must use the granted emulator and dispatched runtime.')
  }
  return new AppiumAndroidController(
    { ...options, preheldTargetLease: options.grant.lease },
    options.grant,
    options.beforeDriverDeletion,
  )
}

/** appiumAndroidCapabilities is deliberately public so the exact UiAutomator2 contract stays reviewable. */
export function appiumAndroidCapabilities(
  target: AppiumAndroidTarget,
  build: AppiumAndroidBuild,
  allocation: AppiumAndroidAllocation,
): AppiumAndroidCapabilities {
  return {
    'appium:app': build.apkPath,
    'appium:appActivity': '.MainActivity',
    'appium:appPackage': target.appId,
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': target.serial,
    'appium:fullReset': false,
    'appium:mjpegServerPort': allocation.mjpegServerPort,
    'appium:noReset': true,
    'appium:systemPort': allocation.systemPort,
    'appium:udid': target.serial,
    platformName: 'Android',
  }
}

class AppiumAndroidController implements HostController {
  readonly #build?: AppiumAndroidBuild
  readonly #managed?: ManagedMobileGrant
  readonly #beforeDriverDeletion?: () => Promise<void>
  readonly #client: AppiumAndroidClient
  readonly #leases: AppiumAndroidLeaseManager
  readonly #publishRevision?: AppiumAndroidRevisionPublisher
  #preheldTargetLease: AppiumAndroidLease | undefined
  readonly #receipts: AppiumAndroidReceiptSink
  readonly #sessions = new Set<AppiumAndroidSession>()
  readonly #target: AppiumAndroidTarget

  constructor(
    options: Omit<AppiumAndroidControllerOptions, 'build'> & { build?: AppiumAndroidBuild },
    managed?: ManagedMobileGrant,
    beforeDriverDeletion?: () => Promise<void>,
  ) {
    this.#managed = managed
    this.#beforeDriverDeletion = beforeDriverDeletion
    this.#build = options.build === undefined ? undefined : frozenBuild(options.build)
    this.#client = options.client
    this.#leases = options.leases ?? machineLeases()
    this.#preheldTargetLease = options.preheldTargetLease
    this.#publishRevision = options.publishRevision
    this.#receipts = options.receipts ?? fileReceipts()
    this.#target = Object.freeze({ ...options.target })
  }

  async close(): Promise<void> {
    await Promise.all([...this.#sessions].map(async session => await session.closeForController()))
  }

  async openSession(
    options: Readonly<{
      artifactRoot: string
      mode: HostSessionDescriptor['mode']
      revision: HostRevision
      target: string
    }>,
  ): Promise<HostSession> {
    if (this.#managed === undefined) {
      if (this.#build === undefined) {
        Errors.throwUnexpected('Expected an isolated Android build.')
      }
      assertIsolatedBuild(options.artifactRoot, this.#target, this.#build)
    }
    const revision = frozenRevision(options.revision)
    const targetLease = this.#preheldTargetLease ?? await this.#leases.acquire(androidTargetLeaseName(this.#target))
    this.#preheldTargetLease = undefined
    let allocation: { leases: readonly AppiumAndroidLease[]; value: AppiumAndroidAllocation } | undefined
    let receiptPath: string | undefined
    let session: AppiumAndroidWebDriverSession | undefined
    let creationAttempted = false
    try {
      allocation = await this.#allocate()
      receiptPath = FS.resolvePath(
        `appium-android/${safeSegment(this.#target.serial)}-${safeSegment(targetLease.generation)}.receipt.json`,
        options.artifactRoot,
      )
      const writeReceipt = async (lifecycle: AppiumAndroidSessionReceipt['lifecycle']): Promise<void> => {
        await this.#receipts.write(
          receiptPath!,
          receipt({
            allocation: allocation!.value,
            build: this.#build,
            lifecycle,
            revision,
            session,
            target: this.#target,
          }),
        )
      }
      await writeReceipt('opening')
      await this.#managed?.assertOwnerCurrent()
      creationAttempted = true
      session = await this.#client.createSession(
        this.#managed === undefined
          ? appiumAndroidCapabilities(this.#target, this.#build!, allocation.value)
          : {
            'appium:automationName': 'UiAutomator2',
            'appium:deviceName': this.#target.serial,
            'appium:udid': this.#target.serial,
            'appium:appPackage': this.#target.appId,
            'appium:noReset': true,
            'appium:fullReset': false,
            'appium:autoLaunch': false,
            'appium:forceAppLaunch': false,
            'appium:shouldTerminateApp': false,
            'appium:dontStopAppOnReset': true,
            'appium:mjpegServerPort': allocation.value.mjpegServerPort,
            'appium:systemPort': allocation.value.systemPort,
            platformName: 'Android',
          },
      )
      await this.#managed?.assertCurrent()
      await writeReceipt('open')
      if (this.#managed !== undefined) {
        await session.prepareManagedRuntime?.()
      }
      let hostSession: AppiumAndroidSession
      hostSession = new AppiumAndroidSession({
        allocation: allocation.value,
        allocationLeases: allocation.leases,
        artifactRoot: options.artifactRoot,
        descriptor: {
          capabilities: sessionCapabilities().filter(capability =>
            this.#managed === undefined || capability !== 'relaunchApplication'
          ),
          driver: 'appium-uiautomator2',
          id: session.id,
          lease: { generation: targetLease.generation, name: androidTargetLeaseName(this.#target) },
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
        managed: this.#managed,
        beforeDriverDeletion: this.#beforeDriverDeletion,
        build: this.#build,
      })
      this.#sessions.add(hostSession)
      return hostSession
    } catch (error) {
      if (this.#managed !== undefined && creationAttempted && session === undefined) {
        Errors.throwHostEnvironment(
          'Managed Android driver creation ended without a session identity; its target and port fences remain retained.',
          {
            cause: error,
            details: { retainsTargetLease: true },
          },
        )
      }
      if (allocation !== undefined && receiptPath !== undefined) {
        await this.#receipts.write(
          receiptPath,
          receipt({
            allocation: allocation.value,
            build: this.#build,
            lifecycle: 'failed',
            revision,
            session,
            target: this.#target,
          }),
        ).catch(() => {})
      }
      if (session !== undefined) {
        try {
          await this.#managed?.assertCleanupCurrent()
          await session.deleteSession()
        } catch (cleanupError) {
          Errors.throwHostEnvironment(
            `Appium Android session '${session.id}' opened but could not be closed; retaining its emulator and port leases.`,
            { cause: cleanupError, details: { openFailure: Errors.messageOf(error), retainsTargetLease: true } },
          )
        }
      }
      await releaseAll([...(allocation?.leases ?? []), targetLease])
      throw error
    }
  }

  async #allocate(): Promise<{ leases: readonly AppiumAndroidLease[]; value: AppiumAndroidAllocation }> {
    const system = await this.#reservePort('system', FIRST_SYSTEM_PORT)
    try {
      const mjpeg = await this.#reservePort('mjpeg', FIRST_MJPEG_PORT)
      return { leases: [system.lease, mjpeg.lease], value: { mjpegServerPort: mjpeg.port, systemPort: system.port } }
    } catch (error) {
      await system.lease.release()
      throw error
    }
  }

  async #reservePort(kind: 'mjpeg' | 'system', first: number): Promise<{ lease: AppiumAndroidLease; port: number }> {
    const offset = stableOffset(`${kind}:${this.#target.serial}`)
    for (let step = 0; step < PORT_CANDIDATES; step += 1) {
      const port = first + (offset + step) % PORT_CANDIDATES
      const lease = await this.#leases.tryAcquire(`appium-android-${kind}-port-${port}`)
      if (lease !== undefined) {
        return { lease, port }
      }
    }
    return Errors.throwHostEnvironment(
      `No Appium ${kind} port is available for Android emulator '${this.#target.serial}'.`,
    )
  }
}

class AppiumAndroidSession implements HostSession {
  readonly #managed?: ManagedMobileGrant
  readonly #beforeDriverDeletion?: () => Promise<void>
  readonly #allocation: AppiumAndroidAllocation
  readonly #allocationLeases: readonly AppiumAndroidLease[]
  readonly #artifactRoot: string
  readonly #build?: AppiumAndroidBuild
  #closed = false
  #closedReceiptPersisted = false
  #closePromise: Promise<void> | undefined
  #descriptor: HostSessionDescriptor
  readonly #elements = new Map<string, AppiumAndroidElement>()
  readonly #onClosed: () => void
  #operationChain: Promise<void> = Promise.resolve()
  #observationRevision = 0
  readonly #publishRevision?: AppiumAndroidRevisionPublisher
  readonly #receiptPath: string
  readonly #receipts: AppiumAndroidReceiptSink
  #revision: HostRevision
  readonly #session: AppiumAndroidWebDriverSession
  #sessionDeleted = false
  #screenshotSequence = 0
  readonly #target: AppiumAndroidTarget
  readonly #targetLease: AppiumAndroidLease

  constructor(
    options: Readonly<{
      allocation: AppiumAndroidAllocation
      allocationLeases: readonly AppiumAndroidLease[]
      artifactRoot: string
      build?: AppiumAndroidBuild
      descriptor: HostSessionDescriptor
      onClosed: () => void
      publishRevision?: AppiumAndroidRevisionPublisher
      receiptPath: string
      receipts: AppiumAndroidReceiptSink
      session: AppiumAndroidWebDriverSession
      target: AppiumAndroidTarget
      targetLease: AppiumAndroidLease
      managed?: ManagedMobileGrant
      beforeDriverDeletion?: () => Promise<void>
    }>,
  ) {
    this.#allocation = options.allocation
    this.#managed = options.managed
    this.#beforeDriverDeletion = options.beforeDriverDeletion
    this.#allocationLeases = options.allocationLeases
    this.#artifactRoot = options.artifactRoot
    this.#build = options.build
    this.#descriptor = frozenDescriptor(options.descriptor)
    this.#onClosed = options.onClosed
    this.#publishRevision = options.publishRevision
    this.#receiptPath = options.receiptPath
    this.#receipts = options.receipts
    this.#revision = this.#descriptor.revision
    this.#session = options.session
    this.#target = options.target
    this.#targetLease = options.targetLease
  }

  async captureScreenshot(name: string): Promise<HostScreenshot> {
    return await this.#serialize(async () => {
      await this.#assertUsable()
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) {
        Errors.throwUserInput(
          'Appium Android screenshot names must use only letters, numbers, dots, underscores, or dashes.',
        )
      }
      const fileName = name.endsWith('.png') ? name : `${name}.png`
      const path = FS.resolvePath(
        `appium-android/screenshots/${safeSegment(this.#target.serial)}-${
          safeSegment(this.#descriptor.lease.generation)
        }-${++this.#screenshotSequence}-${fileName}`,
        this.#artifactRoot,
      )
      await FS.writeFile(path, await this.#session.screenshot())
      return {
        artifactPath: path,
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
        ...(element.getAttribute === undefined
          ? {}
          : { accessibilityLabel: await element.getAttribute('content-desc') }),
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
      await Switch.kind(action, {
        click: async next => await this.#elementFor(next.observation).click(),
        key: async next => await this.#session.pressKey(next.key),
        refreshDocument: async () =>
          unsupported('refreshDocument', 'Appium/UiAutomator2 has no document-refresh operation.'),
        relaunchApplication: async () => {
          if (this.#managed !== undefined) {
            return unsupported('relaunchApplication', 'Managed attachment cannot relaunch its borrowed runtime.')
          }
          await this.#session.terminateApp(this.#target.appId)
          await this.#session.activateApp(this.#target.appId)
        },
        scroll: async next =>
          await this.#session.scroll({
            deltaX: next.deltaX,
            deltaY: next.deltaY,
            ...(next.observation === undefined ? {} : { element: this.#elementFor(next.observation) }),
          }),
        type: async next => await this.#elementFor(next.observation).sendKeys(next.text),
      })
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
      if (this.#managed !== undefined) {
        return unsupported('refreshDocument', 'Managed attachment cannot publish a runtime revision.')
      }
      if (!sameRevision(request.expectedCurrentRevision, this.#revision)) {
        return staleRevision(this.#revision, request.expectedCurrentRevision)
      }
      if (this.#descriptor.mode === 'acceptance') {
        return unsupported('refreshDocument', 'Acceptance Appium Android sessions cannot publish a source revision.')
      }
      if (this.#publishRevision === undefined) {
        return unsupported('refreshDocument', 'The Appium Android host does not expose native revision publication.')
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
      if (this.#managed === undefined) {
        await this.#targetLease.assertCurrent(lease.generation)
      } else {
        await this.#managed.assertCleanupCurrent()
      }
    }
  }

  async #assertUsable(): Promise<void> {
    if (this.#closed) {
      throw new HostControlError('closed', `Appium Android session '${this.#descriptor.id}' is closed.`)
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
      await this.#beforeDriverDeletion?.()
      await this.#session.deleteSession()
      this.#sessionDeleted = true
    }
    if (!this.#closedReceiptPersisted) {
      await this.#receipts.write(
        this.#receiptPath,
        receipt({
          allocation: this.#allocation,
          build: this.#build,
          lifecycle: 'closed',
          revision: this.#revision,
          session: this.#session,
          target: this.#target,
        }),
      )
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
    return ++this.#observationRevision
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationChain.then(operation, operation)
    this.#operationChain = result.then(() => {}, () => {})
    return await result
  }

  #elementFor(observation: HostObservation): AppiumAndroidElement {
    if (
      observation.sessionId !== this.#descriptor.id || observation.observationRevision !== this.#observationRevision
      || !sameRevision(observation.revision, this.#revision)
    ) {
      return staleObservation(this.#descriptor.id)
    }
    assertHostLease(this.#descriptor.lease, observation.lease)
    const element = this.#elements.get(observation.id)
    return element ?? staleObservation(this.#descriptor.id)
  }

  async #findTarget(target: HostTarget): Promise<AppiumAndroidElement> {
    if (target.kind === 'scoped') {
      return await this.#findWithin(await this.#findTarget(target.scope), target.target)
    }
    return await this.#findAtTopLevel(target)
  }

  async #findWithin(parent: AppiumAndroidElement, target: HostTarget): Promise<AppiumAndroidElement> {
    if (target.kind === 'scoped') {
      return await this.#findWithin(await this.#findWithin(parent, target.scope), target.target)
    }
    const occurrence = target.occurrence ?? 1
    const locator = locatorFor(target)
    try {
      if (occurrence === 1) {
        return await this.#session.findElementWithin(parent, locator)
      }
      const element = (await this.#session.findElementsWithin(parent, locator))[occurrence - 1]
      if (element === undefined) {
        return missingOccurrence(occurrence, target)
      }
      return element
    } catch (error) {
      if (!(error instanceof AppiumNoSuchElementError)) {
        throw error
      }
      return await this.#findFlattenedWithin(parent, target)
    }
  }

  async #findFlattenedWithin(
    parent: AppiumAndroidElement,
    target: Exclude<HostTarget, { kind: 'scoped' }>,
  ): Promise<AppiumAndroidElement> {
    if (parent.getRect === undefined) {
      return missingOccurrence(target.occurrence ?? 1, target)
    }
    const parentRect = await parent.getRect()
    const candidates = await this.#session.findElements(locatorFor(target))
    const contained: AppiumAndroidElement[] = []
    for (const candidate of candidates) {
      if (candidate.getRect !== undefined && rectContainsCenter(parentRect, await candidate.getRect())) {
        contained.push(candidate)
      }
    }
    return contained[(target.occurrence ?? 1) - 1] ?? missingOccurrence(target.occurrence ?? 1, target)
  }

  async #findAtTopLevel(target: Exclude<HostTarget, { kind: 'scoped' }>): Promise<AppiumAndroidElement> {
    const occurrence = target.occurrence ?? 1
    const locator = locatorFor(target)
    if (occurrence === 1) {
      return await this.#session.findElement(locator)
    }
    const element = (await this.#session.findElements(locator))[occurrence - 1]
    if (element === undefined) {
      return missingOccurrence(occurrence, target)
    }
    return element
  }
}

function assertIsolatedBuild(artifactRoot: string, target: AppiumAndroidTarget, build: AppiumAndroidBuild): void {
  if (!/^dev\.tao\.taohost(?:clockwork|hnreader|nativenavigation|syntax2)[a-z0-9]+$/u.test(target.appId)) {
    Errors.throwUserInput('Appium Android requires an isolated dev.tao.taohost application identifier.')
  }
  if (!/^[a-f0-9]{64}$/u.test(build.compiledArtifactDigest)) {
    Errors.throwUserInput('Appium Android requires a SHA-256 compiled artifact digest.')
  }
  if (
    !build.apkPath.endsWith('.apk') || !FS.pathIsWithin(FS.resolvePath(build.apkPath), FS.resolvePath(artifactRoot))
  ) {
    Errors.throwUserInput('Appium Android requires an APK under this host proof artifact directory.')
  }
}

function fileReceipts(): AppiumAndroidReceiptSink {
  return { write: async (path, value) => await FS.writeJson(path, value) }
}

function frozenBuild(build: AppiumAndroidBuild): AppiumAndroidBuild {
  return Object.freeze({ ...build })
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

function locatorFor(target: HostTarget): AppiumAndroidLocator {
  if (target.kind === 'scoped') {
    return Errors.throwUnexpected('Appium Android resolves scoped targets through element-relative lookup.')
  }
  if (target.kind === 'tag') {
    // React Native exposes `testID` through Android accessibility as the resource-id name,
    // deliberately separate from the content description used by accessibility labels.
    return { using: '-android uiautomator', value: `new UiSelector().resourceId(${JSON.stringify(target.value)})` }
  }
  if (target.kind === 'accessibility') {
    if (target.role === 'button') {
      return {
        using: '-android uiautomator',
        value: `new UiSelector().className("android.widget.Button").description(${JSON.stringify(target.name)})`,
      }
    }
    if (target.role === 'textbox') {
      const editable = 'new UiSelector().className("android.widget.EditText")'
      return {
        using: '-android uiautomator',
        value: target.name === '' ? editable : `${editable}.description(${JSON.stringify(target.name)})`,
      }
    }
    if (target.role !== undefined) {
      return unsupported('inspect', 'Appium/UiAutomator2 cannot enforce an accessibility role for this target.')
    }
    return { using: 'accessibility id', value: target.name }
  }
  return { using: '-android uiautomator', value: `new UiSelector().text(${JSON.stringify(target.value)})` }
}

function machineLeases(): AppiumAndroidLeaseManager {
  return {
    acquire: async name =>
      await MachineResources.acquire({ command: 'appium-uiautomator2', name, repositoryRoot: Repo.getRoot() }),
    tryAcquire: async name =>
      await MachineResources.tryAcquire({ command: 'appium-uiautomator2', name, repositoryRoot: Repo.getRoot() }),
  }
}

function receipt(
  input: Readonly<
    {
      allocation: AppiumAndroidAllocation
      build?: AppiumAndroidBuild
      lifecycle: AppiumAndroidSessionReceipt['lifecycle']
      revision: HostRevision
      session?: AppiumAndroidWebDriverSession
      target: AppiumAndroidTarget
    }
  >,
): AppiumAndroidSessionReceipt {
  return {
    allocation: input.allocation,
    ...(input.build === undefined ? {} : { artifact: input.build }),
    build: input.revision.build,
    lifecycle: input.lifecycle,
    ...(input.session === undefined ? {} : { sessionId: input.session.id }),
    source: input.revision.source,
    target: { appId: input.target.appId, kind: input.target.kind, serial: input.target.serial },
    version: 1,
  }
}

function releaseAll(leases: readonly AppiumAndroidLease[]): Promise<void> {
  return Promise.all(leases.toReversed().map(async lease => await lease.release())).then(() => {})
}
function rectContainsCenter(container: AppiumAndroidRect, candidate: AppiumAndroidRect): boolean {
  const centerX = candidate.x + candidate.width / 2
  const centerY = candidate.y + candidate.height / 2
  return centerX >= container.x && centerX <= container.x + container.width
    && centerY >= container.y && centerY <= container.y + container.height
}
function safeSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, '_')
}
function sameRevision(left: HostRevision, right: HostRevision): boolean {
  return left.build === right.build && left.source === right.source
}
function sessionCapabilities(): HostCapability[] {
  return ['inspect', 'key', 'pointer', 'relaunchApplication', 'screenshot', 'scroll', 'textInput']
}
function stableOffset(value: string): number {
  let hash = 0
  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0
  }
  return hash % PORT_CANDIDATES
}
function missingOccurrence(occurrence: number, target: HostTarget): never {
  throw new HostControlError(
    'assertion',
    `Appium/UiAutomator2 did not find occurrence ${occurrence} for the requested native target.`,
    { occurrence, reason: 'element-not-found', target },
  )
}

function staleObservation(sessionId: string): never {
  throw new HostControlError(
    'staleObservation',
    `Observation is no longer current for Appium Android session '${sessionId}'.`,
  )
}
function staleRevision(actual: HostRevision, expected: HostRevision): never {
  throw new HostControlError('staleRevision', 'Appium Android session revision is no longer current.', {
    actual,
    expected,
  })
}
/** androidTargetLeaseName is shared before build/install so every Android driver reserves the same target. */
export function androidTargetLeaseName(target: AppiumAndroidTarget): string {
  return hostSessionTargetLeaseName({ id: target.serial, kind: 'androidEmulator' })
}
function unsupported(capability: HostCapability, message: string): never {
  throw new HostControlError('unsupported', message, { capability })
}
