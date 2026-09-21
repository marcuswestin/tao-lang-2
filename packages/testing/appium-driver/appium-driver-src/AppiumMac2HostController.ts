import {
  assertHostLease,
  type HostAction,
  type HostActionReceipt,
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
  type HostTarget,
  type MachineResourceLease,
  MachineResources,
} from '@host-control'
import { Errors, FS, Platform, Repo, Switch } from '@shared'
import type {
  AppiumActionSequence,
  AppiumCapabilities,
  AppiumElement,
  AppiumLocator,
  AppiumSession,
  AppiumSessionFactory,
} from './AppiumWebDriver'

export type Mac2DesktopLease = Pick<MachineResourceLease, 'assertCurrent' | 'generation' | 'release'>

/** Mac2DesktopLeases keeps all physical desktop input behind one machine-wide fenced owner. */
export type Mac2DesktopLeases = Readonly<{
  acquire: () => Promise<Mac2DesktopLease>
}>

export type Mac2ExternalUiOperation =
  | Readonly<{ appId: string; kind: 'activateApplication' }>
  | Readonly<{ appId: string; kind: 'terminateApplication' }>
  | Readonly<{ args?: readonly unknown[]; kind: 'executeScript'; script: string }>

export type Mac2HostSession =
  & HostSession
  & Readonly<{
    executeExternalUi: (operation: Mac2ExternalUiOperation) => Promise<unknown>
  }>

export type Mac2HostController =
  & Omit<HostController, 'openSession'>
  & Readonly<{
    openSession: (
      options: Readonly<{
        artifactRoot: string
        mode: HostSessionDescriptor['mode']
        revision: HostRevision
        target: string
      }>,
    ) => Promise<Mac2HostSession>
  }>

export type CreateAppiumMac2HostControllerOptions = Readonly<{
  capabilities: AppiumCapabilities
  client: AppiumSessionFactory
  command?: string
  desktopLeases?: Mac2DesktopLeases
  resolveTarget: (target: HostTarget) => AppiumLocator
  target: Readonly<{ appId: string }>
}>

const mac2HostCapabilities: HostSessionDescriptor['capabilities'] = Object.freeze([
  'inspect',
  'key',
  'pointer',
  'relaunchApplication',
  'screenshot',
  'scroll',
  'textInput',
])

/**
 * createAppiumMac2HostController adapts an Appium Mac2 session to HostController. It owns the
 * machine-wide physical-input lease for the lifetime of a remote desktop session; an ambiguous
 * remote delete keeps that lease held so another process cannot send input to the same desktop.
 */
export function createAppiumMac2HostController(options: CreateAppiumMac2HostControllerOptions): Mac2HostController {
  return new AppiumMac2HostController(options)
}

class AppiumMac2HostController implements Mac2HostController {
  readonly #capabilities: AppiumCapabilities
  readonly #client: AppiumSessionFactory
  readonly #desktopLeases: Mac2DesktopLeases
  readonly #resolveTarget: (target: HostTarget) => AppiumLocator
  readonly #sessions = new Set<AppiumMac2HostSession>()
  readonly #target: Readonly<{ appId: string }>
  #closed = false
  #closePromise: Promise<void> | undefined

  constructor(options: CreateAppiumMac2HostControllerOptions) {
    this.#capabilities = mac2Capabilities(options.capabilities)
    this.#client = options.client
    this.#desktopLeases = options.desktopLeases ?? defaultDesktopLeases(options.command ?? 'Appium Mac2')
    this.#resolveTarget = options.resolveTarget
    this.#target = options.target
  }

  async close(): Promise<void> {
    if (this.#closePromise !== undefined) {
      return await this.#closePromise
    }
    this.#closed = true
    this.#closePromise = this.#closeSessions()
    try {
      await this.#closePromise
    } catch (error) {
      this.#closePromise = undefined
      throw error
    }
  }

  async openSession(options: Parameters<Mac2HostController['openSession']>[0]): Promise<Mac2HostSession> {
    if (this.#closed) {
      throw new HostControlError('closed', 'The Appium Mac2 host controller is closed.')
    }
    const desktopLease = await this.#desktopLeases.acquire()
    let remote: AppiumSession | undefined
    try {
      remote = await this.#client.createSession(this.#capabilities)
      const session = new AppiumMac2HostSession({
        artifactRoot: options.artifactRoot,
        desktopLease,
        descriptor: {
          capabilities: mac2HostCapabilities,
          driver: 'appium-mac2',
          id: remote.id,
          lease: { generation: desktopLease.generation, name: 'macos-physical-input' },
          mode: options.mode,
          revision: copyRevision(options.revision),
          target: options.target,
          version: 1,
        },
        onClosed: () => this.#sessions.delete(session),
        remote,
        resolveTarget: this.#resolveTarget,
        target: this.#target,
      })
      this.#sessions.add(session)
      return session
    } catch (error) {
      if (remote === undefined) {
        await desktopLease.release()
      } else {
        try {
          await remote.delete()
          await desktopLease.release()
        } catch (closeError) {
          Errors.throwHostEnvironment(
            'Appium Mac2 opened a remote session but could not terminate it; retaining the desktop-input lease.',
            {
              cause: closeError,
              details: { openingError: Errors.messageOf(error), sessionId: remote.id },
            },
          )
        }
      }
      throw error
    }
  }

  async #closeSessions(): Promise<void> {
    let failure: unknown
    for (const session of [...this.#sessions]) {
      try {
        await session.close(session.descriptor().lease)
      } catch (error) {
        failure ??= error
      }
    }
    if (failure !== undefined) {
      throw failure
    }
  }
}

class AppiumMac2HostSession implements Mac2HostSession {
  readonly #artifactRoot: string
  readonly #desktopLease: Mac2DesktopLease
  readonly #descriptor: HostSessionDescriptor
  readonly #onClosed: () => void
  readonly #remote: AppiumSession
  readonly #resolveTarget: (target: HostTarget) => AppiumLocator
  readonly #target: Readonly<{ appId: string }>
  #closed = false
  #closing: Promise<void> | undefined
  #observationRevision = 0
  #observed: Readonly<{ element: AppiumElement; observation: HostObservation }> | undefined
  #operationChain: Promise<void> = Promise.resolve()
  #screenshotSequence = 0

  constructor(
    options: Readonly<{
      artifactRoot: string
      desktopLease: Mac2DesktopLease
      descriptor: HostSessionDescriptor
      onClosed: () => void
      remote: AppiumSession
      resolveTarget: (target: HostTarget) => AppiumLocator
      target: Readonly<{ appId: string }>
    }>,
  ) {
    this.#artifactRoot = options.artifactRoot
    this.#desktopLease = options.desktopLease
    this.#descriptor = freezeDescriptor(options.descriptor)
    this.#onClosed = options.onClosed
    this.#remote = options.remote
    this.#resolveTarget = options.resolveTarget
    this.#target = options.target
  }

  descriptor(): HostSessionDescriptor {
    return this.#descriptor
  }

  async captureScreenshot(name: string): Promise<HostScreenshot> {
    return await this.#serialize(async () => await this.#captureScreenshot(name))
  }

  async #captureScreenshot(name: string): Promise<HostScreenshot> {
    await this.#assertOpen()
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) {
      Errors.throwUserInput(
        'Appium Mac2 screenshot names must use only letters, numbers, dots, underscores, or dashes.',
      )
    }
    const fileName = name.endsWith('.png') ? name : `${name}.png`
    const artifactPath = FS.resolvePath(
      `appium-mac2/screenshots/${++this.#screenshotSequence}-${fileName}`,
      this.#artifactRoot,
    )
    await FS.writeFile(artifactPath, await this.#remote.screenshot())
    return {
      artifactPath,
      observationRevision: this.#invalidateObservation(),
      revision: this.#descriptor.revision,
      sessionId: this.#descriptor.id,
      version: 1,
    }
  }

  async close(lease: HostLeaseIdentity): Promise<void> {
    assertHostLease(this.#descriptor.lease, lease)
    if (this.#closed) {
      return
    }
    if (this.#closing !== undefined) {
      return await this.#closing
    }
    // Closing is an operation on the same remote session as input and inspection. Queue its delete
    // behind every operation already admitted, so neither the Appium session nor its desktop lease
    // disappears while one of them is still in use.
    this.#closing = this.#serialize(async () => await this.#closeRemote())
    try {
      await this.#closing
    } catch (error) {
      this.#closing = undefined
      throw error
    }
  }

  async executeExternalUi(operation: Mac2ExternalUiOperation): Promise<unknown> {
    return await this.#serialize(async () => await this.#executeExternalUi(operation))
  }

  async #executeExternalUi(operation: Mac2ExternalUiOperation): Promise<unknown> {
    await this.#assertOpen()
    return await Switch.kind(operation, {
      activateApplication: async next => {
        await this.#remote.activateApplication(next.appId)
        return undefined
      },
      executeScript: async next => await this.#remote.executeScript(next.script, next.args),
      terminateApplication: async next => {
        await this.#remote.terminateApplication(next.appId)
        return undefined
      },
    })
  }

  async observe(request: HostObservationRequest): Promise<HostObservation> {
    return await this.#serialize(async () => await this.#observe(request))
  }

  async #observe(request: HostObservationRequest): Promise<HostObservation> {
    await this.#assertOpen()
    assertRevision(this.#descriptor.revision, request.expectedRevision)
    const target = copyTarget(request.target)
    const element = await this.#find(target)
    const value = await element.observe()
    const observation = Object.freeze({
      ...(value.accessibilityLabel === undefined ? {} : { accessibilityLabel: value.accessibilityLabel }),
      ...(value.rect === undefined ? {} : { bounds: value.rect }),
      id: element.id,
      lease: this.#descriptor.lease,
      observationRevision: ++this.#observationRevision,
      revision: this.#descriptor.revision,
      sessionId: this.#descriptor.id,
      target,
      ...(value.text === undefined ? {} : { text: value.text }),
      timestamp: new Date().toISOString(),
      version: 1,
      visible: value.visible,
    })
    this.#observed = { element, observation }
    return observation
  }

  async perform(action: HostAction): Promise<HostActionReceipt> {
    return await this.#serialize(async () => await this.#perform(action))
  }

  async #perform(action: HostAction): Promise<HostActionReceipt> {
    await this.#assertOpen()
    assertHostLease(this.#descriptor.lease, action.lease)
    assertRevision(this.#descriptor.revision, action.expectedRevision)
    await Switch.kind(action, {
      click: async next => await this.#elementFor(next.observation).then(async element => await element.click()),
      key: async next => await this.#remote.actions(keyActions(next.key)),
      refreshDocument: () => {
        throw new HostControlError(
          'unsupported',
          'Appium Mac2 cannot refresh a document without an explicit external UI operation.',
        )
      },
      relaunchApplication: async () => {
        await this.#executeExternalUi({ appId: this.#target.appId, kind: 'terminateApplication' })
        await this.#executeExternalUi({ appId: this.#target.appId, kind: 'activateApplication' })
      },
      scroll: async next =>
        await this.#remote.actions(scrollActions(next.deltaX, next.deltaY, await this.#boundsFor(next.observation))),
      type: async next =>
        await this.#elementFor(next.observation).then(async element => await element.sendKeys(next.text)),
    })
    return Object.freeze({
      action: action.kind,
      lease: this.#descriptor.lease,
      observationRevision: this.#invalidateObservation(),
      revision: this.#descriptor.revision,
      sessionId: this.#descriptor.id,
      version: 1,
    })
  }

  async publishRevision(request: HostPublishRevisionRequest): Promise<void> {
    return await this.#serialize(async () => await this.#publishRevision(request))
  }

  async #publishRevision(request: HostPublishRevisionRequest): Promise<void> {
    await this.#assertOpen()
    assertHostLease(this.#descriptor.lease, request.lease)
    assertRevision(this.#descriptor.revision, request.expectedCurrentRevision)
    throw new HostControlError(
      'unsupported',
      'Appium Mac2 does not publish revisions without a host-specific external UI operation.',
    )
  }

  async #assertOpen(): Promise<void> {
    if (this.#closed) {
      throw new HostControlError('closed', 'The Appium Mac2 session is closed.')
    }
    await this.#desktopLease.assertCurrent(this.#descriptor.lease.generation)
  }

  async #closeRemote(): Promise<void> {
    try {
      await this.#remote.delete()
    } catch (error) {
      Errors.throwHostEnvironment(
        'Appium Mac2 could not confirm remote session termination; retaining the desktop-input lease.',
        {
          cause: error,
          details: { sessionId: this.#descriptor.id },
        },
      )
    }
    await this.#desktopLease.release()
    this.#closed = true
    this.#onClosed()
  }

  async #elementFor(observation: HostObservation) {
    assertHostLease(this.#descriptor.lease, observation.lease)
    if (
      observation.sessionId !== this.#descriptor.id
      || observation.observationRevision !== this.#observationRevision
      || observation.revision.build !== this.#descriptor.revision.build
      || observation.revision.source !== this.#descriptor.revision.source
      || this.#observed?.observation !== observation
    ) {
      throw new HostControlError('staleObservation', 'The Appium Mac2 observation is no longer current.')
    }
    return this.#observed.element
  }

  async #boundsFor(observation: HostObservation | undefined): Promise<NonNullable<HostObservation['bounds']>> {
    if (observation === undefined) {
      throw new HostControlError(
        'unsupported',
        'Appium Mac2 scroll needs an observed target so it can use that element bounds as its pointer origin.',
      )
    }
    await this.#elementFor(observation)
    if (observation.bounds === undefined) {
      throw new HostControlError('host', 'Appium Mac2 did not report bounds for the observed scroll target.')
    }
    return observation.bounds
  }

  async #find(target: HostTarget, root?: AppiumElement): Promise<AppiumElement> {
    return await Switch.kind(target, {
      accessibility: async next =>
        await this.#selectOccurrence(next, await this.#findWithin(root, this.#resolveTarget(next))),
      scoped: async next => {
        const scope = await this.#find(next.scope, root)
        return await this.#find(next.target, scope)
      },
      tag: async next => await this.#selectOccurrence(next, await this.#findWithin(root, this.#resolveTarget(next))),
      text: async next => await this.#selectOccurrence(next, await this.#findWithin(root, this.#resolveTarget(next))),
    })
  }

  #selectOccurrence(
    target: Exclude<HostTarget, Readonly<{ kind: 'scoped'; scope: HostTarget; target: HostTarget }>>,
    elements: readonly AppiumElement[],
  ): AppiumElement {
    const occurrence = target.occurrence ?? 1
    if (!Number.isInteger(occurrence) || occurrence < 1) {
      Errors.throwUserInput('Appium Mac2 target occurrences must be positive integers.')
    }
    const element = elements[occurrence - 1]
    if (element === undefined) {
      throw new HostControlError(
        'host',
        `Appium Mac2 could not find occurrence ${occurrence} of the requested target.`,
        { target },
      )
    }
    return element
  }

  async #findWithin(root: AppiumElement | undefined, locator: AppiumLocator): Promise<readonly AppiumElement[]> {
    return root === undefined ? await this.#remote.findAll(locator) : await root.findAll(locator)
  }

  #invalidateObservation(): number {
    this.#observed = undefined
    return ++this.#observationRevision
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#operationChain.then(operation)
    this.#operationChain = next.then(() => undefined, () => undefined)
    return await next
  }
}

function defaultDesktopLeases(command: string): Mac2DesktopLeases {
  return {
    acquire: async () =>
      await MachineResources.acquire({
        command,
        name: 'macos-physical-input',
        repositoryRoot: Repo.getRoot(),
      }),
  }
}

function keyActions(key: string): readonly AppiumActionSequence[] {
  return [{
    actions: [{ type: 'keyDown', value: key }, { type: 'keyUp', value: key }],
    id: `tao-mac2-key-${Platform.randomUUID()}`,
    type: 'key',
  }]
}

function scrollActions(
  deltaX: number,
  deltaY: number,
  bounds: NonNullable<HostObservation['bounds']>,
): readonly AppiumActionSequence[] {
  const x = Math.round(bounds.x + bounds.width / 2)
  const y = Math.round(bounds.y + bounds.height / 2)
  return [{
    actions: [
      { duration: 0, type: 'pointerMove', x, y },
      { button: 0, type: 'pointerDown' },
      { duration: 250, type: 'pointerMove', x: -deltaX, y: -deltaY },
      { button: 0, type: 'pointerUp' },
    ],
    id: `tao-mac2-scroll-${Platform.randomUUID()}`,
    parameters: { pointerType: 'mouse' },
    type: 'pointer',
  }]
}

function assertRevision(actual: HostRevision, expected: HostRevision): void {
  if (actual.build !== expected.build || actual.source !== expected.source) {
    throw new HostControlError('staleRevision', 'The Appium Mac2 session revision is no longer current.', {
      actual,
      expected,
    })
  }
}

function copyRevision(revision: HostRevision): HostRevision {
  return Object.freeze({ build: revision.build, source: revision.source })
}

function copyTarget(target: HostTarget): HostTarget {
  return Object.freeze({ ...target }) as HostTarget
}

function mac2Capabilities(capabilities: AppiumCapabilities): AppiumCapabilities {
  return Object.freeze({
    ...capabilities,
    'appium:automationName': 'mac2',
    platformName: 'mac',
  })
}

function freezeDescriptor(descriptor: HostSessionDescriptor): HostSessionDescriptor {
  return Object.freeze({
    ...descriptor,
    capabilities: Object.freeze([...descriptor.capabilities]),
    lease: Object.freeze({ ...descriptor.lease }),
    revision: copyRevision(descriptor.revision),
  })
}
