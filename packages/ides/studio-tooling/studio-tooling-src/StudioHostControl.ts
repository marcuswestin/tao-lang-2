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
  type HostTarget,
} from '@host-control'
import { Errors, FS, Platform, Switch, Time } from '@shared'

/** StudioHostTransport is the semantic RPC seam between dev tooling and the owned Electrobun shell. */
export type StudioHostTransport = Readonly<{
  capabilities: readonly HostCapability[]
  /** Captures the active project window once; HostSessionDescriptor.target remains an opaque label. */
  bindProject: () => Promise<StudioHostProjectBinding>
  observe: (
    binding: StudioHostProjectBinding,
    target: HostTarget,
    expectedRevision: HostRevision,
  ) => Promise<StudioHostTransportObservation>
  perform: (
    binding: StudioHostProjectBinding,
    action: StudioHostTransportAction,
    expectedRevision: HostRevision,
  ) => Promise<void>
  /** Resolves only after the shell has confirmed that the current document remains visible. */
  publishRevision: (binding: StudioHostProjectBinding, request: StudioHostTransportPublishRevision) => Promise<void>
}>

export type StudioHostProjectBinding = Readonly<{ projectSessionId: string; windowId: number; windowToken: string }>

/** The process-wide renderer fence must receive both revisions with the reload request. */
export type StudioHostTransportPublishRevision = Readonly<{
  expectedCurrentRevision: HostRevision
  revision: HostRevision
}>

type StudioHostTransportObservation = Readonly<{
  accessibilityLabel?: string
  bounds?: HostObservation['bounds']
  /** Opaque document-scoped identity of the exact rendered element that was inspected. */
  elementId: string
  text?: string
  visible: boolean
}>

type StudioHostTransportAction =
  | Readonly<{ elementId: string; kind: 'click'; target: HostTarget }>
  | Readonly<{ kind: 'key'; key: string }>
  | Readonly<{ kind: 'refreshDocument' }>
  | Readonly<{ deltaX: number; deltaY: number; kind: 'scroll'; observed?: { elementId: string; target: HostTarget } }>
  | Readonly<{ elementId: string; kind: 'type'; target: HostTarget; text: string }>

type StudioHostControlDiscovery = Readonly<{
  capability: string
  url: string
  version: 1
}>

type StudioHostControlDependencies = Readonly<{
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  readJson?: (path: string) => Promise<unknown>
  sleep?: (milliseconds: number) => Promise<void>
}>

const discoveryAttempts = 120
const discoveryRetryMs = 250

/** StudioHostControl creates development-only semantic sessions inside an already-owned native shell. */
export const StudioHostControl = {
  create: createStudioHostController,
  waitForTransport: waitForStudioHostTransport,
} as const

/**
 * createStudioHostController does not take a machine lease itself: StudioNative already owns the
 * fixed bundle identifier and Hutch home. Its session leases fence concurrent semantic callers
 * inside that one owned process; physical input remains an external host-driver responsibility.
 */
export function createStudioHostController(transport: StudioHostTransport): HostController {
  return new StudioHostController(transport)
}

/** waitForStudioHostTransport discovers the loopback capability endpoint written by Electrobun. */
export async function waitForStudioHostTransport(
  discoveryPath: string,
  dependencies: StudioHostControlDependencies = {},
): Promise<StudioHostTransport> {
  const readJson = dependencies.readJson ?? FS.readJson
  let lastError: unknown
  for (let attempt = 0; attempt < discoveryAttempts; attempt += 1) {
    try {
      const discovery = await readJson(discoveryPath)
      return httpTransport(parseDiscovery(discovery), dependencies.fetch ?? fetch)
    } catch (error) {
      lastError = error
      if (attempt + 1 < discoveryAttempts) {
        await (dependencies.sleep ?? Time.sleep)(discoveryRetryMs)
      }
    }
  }
  throw new HostControlError(
    'host',
    `Studio's Electrobun semantic-control endpoint did not become ready at ${discoveryPath}.`,
    { cause: Errors.messageOf(lastError) },
  )
}

class StudioHostController implements HostController {
  readonly #sessions = new Set<StudioHostSession>()
  readonly #transport: StudioHostTransport
  #closed = false
  #closing: Promise<void> | undefined
  #currentRevision: HostRevision | undefined
  #operationChain: Promise<void> = Promise.resolve()

  constructor(transport: StudioHostTransport) {
    this.#transport = transport
  }

  async close(): Promise<void> {
    if (this.#closing !== undefined) {
      return await this.#closing
    }
    this.#closed = true
    this.#closing = Promise.all(
      [...this.#sessions].map(async session => await session.close(session.descriptor().lease)),
    ).then(() => {})
    return await this.#closing
  }

  async openSession(options: {
    artifactRoot: string
    mode: HostSessionDescriptor['mode']
    revision: HostRevision
    target: string
  }): Promise<HostSession> {
    if (this.#closed) {
      throw new HostControlError('closed', 'The Studio semantic host controller is closed.')
    }
    // `target` is an opaque label in the HostControl descriptor. The shell resolves the actual
    // project window once here; later focus changes must not redirect this session's operations.
    const binding = await this.#transport.bindProject()
    if (this.#closed) {
      throw new HostControlError('closed', 'The Studio semantic host controller is closed.')
    }
    if (this.#currentRevision === undefined) {
      this.#currentRevision = copyRevision(options.revision)
    } else {
      assertRevision(this.#currentRevision, options.revision)
    }
    const session = new StudioHostSession({
      binding,
      capabilities: this.#transport.capabilities,
      currentRevision: () => this.#currentRevisionValue(),
      id: Platform.randomUUID(),
      mode: options.mode,
      onClosed: () => this.#sessions.delete(session),
      publishRevision: async (expectedCurrentRevision, revision) =>
        await this.#publishRevision(binding, expectedCurrentRevision, revision),
      revision: copyRevision(options.revision),
      serialize: async operation => await this.#serialize(operation),
      target: options.target,
      transport: this.#transport,
    })
    this.#sessions.add(session)
    return session
  }

  #currentRevisionValue(): HostRevision {
    if (this.#currentRevision === undefined) {
      throw new HostControlError('closed', 'The Studio semantic host controller has no active revision.')
    }
    return this.#currentRevision
  }

  async #publishRevision(
    binding: StudioHostProjectBinding,
    expectedCurrentRevision: HostRevision,
    revision: HostRevision,
  ): Promise<void> {
    assertRevision(this.#currentRevisionValue(), expectedCurrentRevision)
    const nextRevision = copyRevision(revision)
    // The renderer only becomes current after its post-reload visibility acknowledgement. Until then
    // the previous revision remains the controller fence and stays available to the publisher.
    await this.#transport.publishRevision(binding, {
      expectedCurrentRevision: copyRevision(expectedCurrentRevision),
      revision: nextRevision,
    })
    this.#currentRevision = nextRevision
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationChain.then(operation, operation)
    this.#operationChain = result.then(() => {}, () => {})
    return await result
  }
}

type StudioHostSessionOptions = Readonly<{
  binding: StudioHostProjectBinding
  capabilities: readonly HostCapability[]
  currentRevision: () => HostRevision
  id: string
  mode: HostSessionDescriptor['mode']
  onClosed: () => void
  publishRevision: (expectedCurrentRevision: HostRevision, revision: HostRevision) => Promise<void>
  revision: HostRevision
  serialize: <T>(operation: () => Promise<T>) => Promise<T>
  target: string
  transport: StudioHostTransport
}>

class StudioHostSession implements HostSession {
  readonly #binding: StudioHostProjectBinding
  readonly #capabilities: readonly HostCapability[]
  readonly #currentRevision: () => HostRevision
  readonly #id: string
  readonly #lease: HostLeaseIdentity
  readonly #mode: HostSessionDescriptor['mode']
  readonly #onClosed: () => void
  readonly #publishRevision: (expectedCurrentRevision: HostRevision, revision: HostRevision) => Promise<void>
  readonly #serializeOperation: <T>(operation: () => Promise<T>) => Promise<T>
  readonly #target: string
  readonly #transport: StudioHostTransport
  #closed = false
  #currentElementId: string | undefined
  #currentObservation: HostObservation | undefined
  #observationRevision = 0
  #revision: HostRevision

  constructor(options: StudioHostSessionOptions) {
    this.#binding = Object.freeze({ ...options.binding })
    this.#capabilities = Object.freeze([...options.capabilities])
    this.#currentRevision = options.currentRevision
    this.#id = options.id
    this.#lease = Object.freeze({ generation: Platform.randomUUID(), name: `studio-semantic-${options.id}` })
    this.#mode = options.mode
    this.#onClosed = options.onClosed
    this.#publishRevision = options.publishRevision
    this.#revision = options.revision
    this.#serializeOperation = options.serialize
    this.#target = options.target
    this.#transport = options.transport
  }

  descriptor(): HostSessionDescriptor {
    return Object.freeze({
      capabilities: this.#capabilities,
      driver: 'studio-electrobun-semantic',
      id: this.#id,
      lease: this.#lease,
      mode: this.#mode,
      revision: this.#revision,
      target: this.#target,
      version: 1,
    })
  }

  async observe(request: HostObservationRequest): Promise<HostObservation> {
    return await this.#serialize(async () => {
      this.#assertOpen()
      assertRevision(this.#revision, request.expectedRevision)
      assertRevision(this.#currentRevision(), this.#revision)
      const target = copyTarget(request.target)
      const rendered = await this.#transport.observe(this.#binding, target, this.#revision)
      if (typeof rendered.elementId !== 'string' || rendered.elementId.length === 0) {
        throw new HostControlError('host', 'Studio semantic control did not identify the observed element.')
      }
      const observation: HostObservation = Object.freeze({
        accessibilityLabel: rendered.accessibilityLabel,
        bounds: rendered.bounds,
        id: Platform.randomUUID(),
        lease: this.#lease,
        observationRevision: this.#advanceObservationRevision(false),
        revision: this.#revision,
        sessionId: this.#id,
        target,
        text: rendered.text,
        timestamp: new Date().toISOString(),
        version: 1,
        visible: rendered.visible,
      })
      this.#currentObservation = observation
      this.#currentElementId = rendered.elementId
      return observation
    })
  }

  async captureScreenshot(_name: string): Promise<HostScreenshot> {
    this.#assertOpen()
    throw new HostControlError(
      'unsupported',
      'Studio semantic sessions do not capture native-window screenshots; use the Appium Mac2 acceptance transport.',
      { capability: 'screenshot', sessionId: this.#id },
    )
  }

  async perform(action: HostAction): Promise<HostActionReceipt> {
    return await this.#serialize(async () => {
      this.#assertOpen()
      assertHostLease(this.#lease, action.lease)
      assertRevision(this.#revision, action.expectedRevision)
      assertRevision(this.#currentRevision(), this.#revision)
      await Switch.kind<HostAction, Promise<void>>(action, {
        click: async click => {
          const { elementId, observation } = this.#assertCurrentObservation(click.observation)
          await this.#transport.perform(
            this.#binding,
            { elementId, kind: 'click', target: observation.target },
            this.#revision,
          )
        },
        key: async key => await this.#transport.perform(this.#binding, { kind: 'key', key: key.key }, this.#revision),
        refreshDocument: async () =>
          await this.#transport.perform(this.#binding, { kind: 'refreshDocument' }, this.#revision),
        relaunchApplication: async () => {
          throw new HostControlError(
            'unsupported',
            'Studio semantic sessions do not relaunch the native application; use the Appium Mac2 acceptance transport.',
            { capability: 'relaunchApplication', sessionId: this.#id },
          )
        },
        scroll: async scroll => {
          const observed = scroll.observation === undefined
            ? undefined
            : (() => {
              const { elementId, observation } = this.#assertCurrentObservation(scroll.observation)
              return { elementId, target: observation.target }
            })()
          await this.#transport.perform(this.#binding, {
            deltaX: scroll.deltaX,
            deltaY: scroll.deltaY,
            kind: 'scroll',
            observed,
          }, this.#revision)
        },
        type: async type => {
          const { elementId, observation } = this.#assertCurrentObservation(type.observation)
          await this.#transport.perform(this.#binding, {
            elementId,
            kind: 'type',
            target: observation.target,
            text: type.text,
          }, this.#revision)
        },
      })
      return this.#receipt(action.kind)
    })
  }

  async publishRevision(request: HostPublishRevisionRequest): Promise<void> {
    await this.#serialize(async () => {
      this.#assertOpen()
      assertHostLease(this.#lease, request.lease)
      assertRevision(this.#revision, request.expectedCurrentRevision)
      assertRevision(this.#currentRevision(), this.#revision)
      if (this.#mode === 'acceptance') {
        throw new HostControlError(
          'unsupported',
          'Acceptance Studio sessions are immutable; open a new session for a different revision.',
          { revision: request.revision, sessionId: this.#id },
        )
      }
      const revision = copyRevision(request.revision)
      // The transport acknowledges a visible document before we advance. A failed update leaves the
      // previous revision and observation intact, which keeps the last-good visible iteration usable.
      await this.#publishRevision(request.expectedCurrentRevision, revision)
      this.#revision = revision
      this.#advanceObservationRevision()
    })
  }

  async close(lease: HostLeaseIdentity): Promise<void> {
    assertHostLease(this.#lease, lease)
    await this.#serialize(async () => {
      if (this.#closed) {
        return
      }
      this.#closed = true
      this.#advanceObservationRevision()
      this.#onClosed()
    })
  }

  #assertCurrentObservation(observation: HostObservation): { elementId: string; observation: HostObservation } {
    if (
      observation.sessionId !== this.#id
      || observation.observationRevision !== this.#observationRevision
      || this.#currentObservation?.id !== observation.id
      || this.#currentElementId === undefined
    ) {
      throw staleObservation(this.#id, observation)
    }
    assertHostLease(this.#lease, observation.lease)
    assertRevision(this.#revision, observation.revision)
    return { elementId: this.#currentElementId, observation: this.#currentObservation }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new HostControlError('closed', `Studio semantic session '${this.#id}' is closed.`, { sessionId: this.#id })
    }
  }

  #advanceObservationRevision(clear = true): number {
    if (clear) {
      this.#currentObservation = undefined
      this.#currentElementId = undefined
    }
    this.#observationRevision += 1
    return this.#observationRevision
  }

  #receipt(action: HostAction['kind']): HostActionReceipt {
    return Object.freeze({
      action,
      lease: this.#lease,
      observationRevision: this.#advanceObservationRevision(),
      revision: this.#revision,
      sessionId: this.#id,
      version: 1,
    })
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    return await this.#serializeOperation(operation)
  }
}

function httpTransport(
  discovery: StudioHostControlDiscovery,
  request: (input: string, init?: RequestInit) => Promise<Response>,
): StudioHostTransport {
  const call = async <T>(operation: string, value: Record<string, unknown> = {}): Promise<T> => {
    let response: Response
    try {
      response = await request(discovery.url, {
        body: JSON.stringify({ capability: discovery.capability, operation, ...value }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
    } catch (error) {
      throw new HostControlError('host', `Could not reach Studio's Electrobun semantic-control endpoint.`, {
        cause: Errors.messageOf(error),
      })
    }
    const payload = await response.json().catch(() => undefined)
    if (!response.ok || !isResponse(payload)) {
      throw new HostControlError(
        'host',
        responseFailureMessage(payload, operation),
        { status: response.status },
      )
    }
    return payload.value as T
  }
  return {
    capabilities: ['inspect', 'key', 'pointer', 'refreshDocument', 'scroll', 'textInput'],
    bindProject: async () => parseProjectBinding(await call<unknown>('bindProject')),
    observe: async (binding, target, expectedRevision) =>
      await call<StudioHostTransportObservation>('observe', { binding, expectedRevision, target }),
    perform: async (binding, action, expectedRevision) =>
      await call<void>('perform', { action, binding, expectedRevision }),
    publishRevision: async (binding, revision) => await call<void>('publishRevision', { binding, ...revision }),
  }
}

function parseProjectBinding(value: unknown): StudioHostProjectBinding {
  if (
    typeof value !== 'object'
    || value === null
    || !Number.isSafeInteger((value as { windowId?: unknown }).windowId)
    || (value as { windowId: number }).windowId < 0
    || typeof (value as { projectSessionId?: unknown }).projectSessionId !== 'string'
    || (value as { projectSessionId: string }).projectSessionId.length === 0
    || typeof (value as { windowToken?: unknown }).windowToken !== 'string'
    || (value as { windowToken: string }).windowToken.length === 0
  ) {
    throw new HostControlError('host', 'Studio semantic control returned an invalid project-window binding.')
  }
  const binding = value as StudioHostProjectBinding
  return Object.freeze({
    projectSessionId: binding.projectSessionId,
    windowId: binding.windowId,
    windowToken: binding.windowToken,
  })
}

function parseDiscovery(value: unknown): StudioHostControlDiscovery {
  if (
    typeof value !== 'object'
    || value === null
    || (value as Record<string, unknown>)['version'] !== 1
    || typeof (value as Record<string, unknown>)['capability'] !== 'string'
    || typeof (value as Record<string, unknown>)['url'] !== 'string'
  ) {
    throw new HostControlError('host', 'Studio wrote an invalid Electrobun semantic-control discovery record.')
  }
  const discovery = value as StudioHostControlDiscovery
  const url = new URL(discovery.url)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new HostControlError('host', 'Studio semantic control must use a loopback endpoint.')
  }
  return Object.freeze({ capability: discovery.capability, url: url.href, version: 1 })
}

function isResponse(value: unknown): value is { ok: true; value: unknown } {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>)['ok'] === true
}

function responseFailureMessage(value: unknown, operation: string): string {
  if (typeof value === 'object' && value !== null && typeof (value as { message?: unknown }).message === 'string') {
    return (value as { message: string }).message
  }
  return `Studio's Electrobun semantic-control endpoint rejected ${operation}.`
}

function assertRevision(expected: HostRevision, actual: HostRevision): void {
  if (sameRevision(expected, actual)) {
    return
  }
  throw new HostControlError(
    'staleRevision',
    `Studio semantic revision '${actual.build}' at source '${actual.source}' is no longer current.`,
    { actual, expected },
  )
}

function staleObservation(sessionId: string, observation: HostObservation): HostControlError {
  return new HostControlError(
    'staleObservation',
    `Studio semantic observation '${observation.id}' is no longer current for session '${sessionId}'.`,
    { observation, sessionId },
  )
}

function sameRevision(left: HostRevision, right: HostRevision): boolean {
  return left.build === right.build && left.source === right.source
}

function copyRevision(revision: HostRevision): HostRevision {
  return Object.freeze({ build: revision.build, source: revision.source })
}

function copyTarget(target: HostTarget): HostTarget {
  return Switch.kind<HostTarget, HostTarget>(target, {
    accessibility: accessibility => Object.freeze({ ...accessibility }),
    scoped: scoped =>
      Object.freeze({
        kind: 'scoped',
        scope: copyTarget(scoped.scope),
        target: copyTarget(scoped.target),
      }),
    tag: tag => Object.freeze({ ...tag }),
    text: text => Object.freeze({ ...text }),
  })
}
