import { Errors, FS, Platform } from '@shared'
import type { HostRevision } from '../HostControl'
import { MachineResources, type MachineResourceLease } from '../MachineResources'

const MAX_PLATFORM_APP_ID_LENGTH = 100

export type HostSessionMode = 'acceptance' | 'development'

/** HostSessionTarget names one driver target whose mutations must be fenced across worktrees. */
export type HostSessionTarget =
  | Readonly<{ id?: string; kind: 'browserContext' }>
  | Readonly<{ id: string; kind: 'iosSimulator' }>
  | Readonly<{ id: string; kind: 'androidEmulator' }>
  | Readonly<{ id: string; kind: 'studioSemanticSession' }>

export type HostSessionTargetLease = Readonly<{
  generation: string
  name: string
}>

export type HostSessionIdentity = Readonly<{
  appId: string
  artifactRoot: string
  driverPortNamespace: string
  id: string
  revision: Readonly<{
    build: string
    id: string
    immutable: boolean
    source: string
  }>
  runId: string
  worktreeId: string
}>

/** HostSessionCleanup tells a driver exactly which session-scoped state it owns when it closes. */
export type HostSessionCleanup = Readonly<{
  applicationData: Readonly<{ action: 'remove' | 'retain'; appId: string; ownerSessionId: string }>
  artifacts: Readonly<{ action: 'preserve'; ownerSessionId: string; root: string }>
  driverPorts: Readonly<{ action: 'release'; namespace: string; ownerSessionId: string }>
  leases: readonly HostSessionTargetLease[]
}>

export type HostSessionAllocation = Readonly<{
  cleanup: HostSessionCleanup
  identity: HostSessionIdentity
  mode: HostSessionMode
  state: Readonly<{ initial: 'fresh' | 'retained'; retained: boolean }>
  target: HostSessionTarget
}>

export type HostSessionReservation = Readonly<{
  allocation: HostSessionAllocation
  close: () => Promise<void>
}>

export type HostSessionRequest = Readonly<{
  app: string
  mode: HostSessionMode
  /** Physical macOS input and attached devices are global, even when their app target is otherwise distinct. */
  needsPhysicalMacOSInput?: boolean
  revision: HostRevision
  target: HostSessionTarget
}>

export type HostSessionLeaseManager = Readonly<{
  acquire: (name: string) => Promise<Pick<MachineResourceLease, 'generation' | 'release'>>
}>

export type HostSessionOrchestratorOptions = Readonly<{
  artifactRoot: string
  command: string
  /** Injected by tests; production allocations use a UUID. */
  randomId?: () => string
  repositoryRoot?: string
  runId: string
  /** Injected by tests; production uses the shared machine-wide lease registry. */
  leases?: HostSessionLeaseManager
  worktreeId: string
}>

/** createHostSessionOrchestrator allocates isolated session identities for one worktree run. */
export function createHostSessionOrchestrator(options: HostSessionOrchestratorOptions): HostSessionOrchestrator {
  return new HostSessionOrchestrator(options)
}

/**
 * HostSessionOrchestrator keeps the namespace policy above host drivers. A driver receives one
 * allocation and must use its app identity, artifact root and port namespace without borrowing
 * from another session.
 */
export class HostSessionOrchestrator {
  readonly #artifactRoot: string
  readonly #command: string
  readonly #leases: HostSessionLeaseManager
  readonly #randomId: () => string
  readonly #repositoryRoot: string
  readonly #runId: string
  readonly #sessionIds = new Set<string>()
  readonly #worktreeId: string

  constructor(options: HostSessionOrchestratorOptions) {
    this.#artifactRoot = options.artifactRoot
    this.#command = requiredSegment(options.command, 'Host-session command')
    this.#randomId = options.randomId ?? Platform.randomUUID
    this.#repositoryRoot = options.repositoryRoot ?? Platform.runtimeProcess.cwd()
    this.#runId = requiredSegment(options.runId, 'Host-session run ID')
    this.#worktreeId = requiredSegment(options.worktreeId, 'Host-session worktree ID')
    this.#leases = options.leases ?? machineLeases({
      command: this.#command,
      repositoryRoot: this.#repositoryRoot,
    })
  }

  async open(request: HostSessionRequest): Promise<HostSessionReservation> {
    const app = requiredSegment(request.app, 'Host-session app ID')
    const sessionId = this.#reserveSessionId()
    const target = frozenTarget(request.target, sessionId)
    const identity = sessionIdentity({
      app,
      artifactRoot: this.#artifactRoot,
      mode: request.mode,
      revision: request.revision,
      runId: this.#runId,
      sessionId,
      worktreeId: this.#worktreeId,
    })
    const leaseNames = targetLeaseNames(target, request.needsPhysicalMacOSInput === true)
    const leases: Array<Pick<MachineResourceLease, 'generation' | 'release'>> = []
    try {
      for (const name of leaseNames) {
        leases.push(await this.#leases.acquire(name))
      }
    } catch (error) {
      await releaseAll(leases)
      this.#sessionIds.delete(sessionId)
      throw error
    }

    const allocation = frozenAllocation({
      cleanup: {
        applicationData: {
          action: request.mode === 'acceptance' ? 'remove' : 'retain',
          appId: identity.appId,
          ownerSessionId: identity.id,
        },
        artifacts: { action: 'preserve', ownerSessionId: identity.id, root: identity.artifactRoot },
        driverPorts: { action: 'release', namespace: identity.driverPortNamespace, ownerSessionId: identity.id },
        leases: leases.map((lease, index) => ({ generation: lease.generation, name: leaseNames[index]! })),
      },
      identity,
      mode: request.mode,
      state: request.mode === 'acceptance'
        ? { initial: 'fresh', retained: false }
        : { initial: 'retained', retained: true },
      target,
    })
    let closed = false
    return Object.freeze({
      allocation,
      close: async () => {
        if (closed) {
          return
        }
        closed = true
        try {
          await releaseAll(leases)
        } finally {
          this.#sessionIds.delete(sessionId)
        }
      },
    })
  }

  #reserveSessionId(): string {
    const prefix = [
      'session',
      this.#worktreeId,
      this.#runId,
      requiredSegment(this.#randomId(), 'Host-session random ID'),
    ].join('-')
    let candidate = prefix
    let suffix = 2
    while (this.#sessionIds.has(candidate)) {
      candidate = `${prefix}-${suffix}`
      suffix += 1
    }
    this.#sessionIds.add(candidate)
    return candidate
  }
}

function frozenAllocation(allocation: HostSessionAllocation): HostSessionAllocation {
  return Object.freeze({
    ...allocation,
    cleanup: Object.freeze({
      ...allocation.cleanup,
      applicationData: Object.freeze({ ...allocation.cleanup.applicationData }),
      artifacts: Object.freeze({ ...allocation.cleanup.artifacts }),
      driverPorts: Object.freeze({ ...allocation.cleanup.driverPorts }),
      leases: Object.freeze(allocation.cleanup.leases.map(lease => Object.freeze({ ...lease }))),
    }),
    identity: Object.freeze({
      ...allocation.identity,
      revision: Object.freeze({ ...allocation.identity.revision }),
    }),
    state: Object.freeze({ ...allocation.state }),
    target: frozenTarget(allocation.target),
  })
}

function frozenTarget(target: HostSessionTarget, browserSessionId?: string): HostSessionTarget {
  const id = target.kind === 'browserContext' ? target.id ?? browserSessionId : target.id
  return target.kind === 'browserContext'
    ? Object.freeze({ id: requiredSegment(id, 'Browser context ID'), kind: target.kind })
    : Object.freeze({ id: requiredSegment(id, `${target.kind} ID`), kind: target.kind })
}

function machineLeases(context: Readonly<{ command: string; repositoryRoot: string }>): HostSessionLeaseManager {
  return {
    acquire: async name => await MachineResources.acquire({
      command: context.command,
      name,
      repositoryRoot: context.repositoryRoot,
    }),
  }
}

async function releaseAll(leases: readonly Pick<MachineResourceLease, 'release'>[]): Promise<void> {
  await Promise.all(leases.toReversed().map(async lease => await lease.release()))
}

function requiredSegment(value: string | undefined, label: string): string {
  const segment = value?.trim()
  if (segment === undefined || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(segment)) {
    Errors.throwUserInput(`${label} must contain only letters, numbers, dots, underscores and dashes.`)
  }
  return segment
}

function sessionIdentity(input: Readonly<{
  app: string
  artifactRoot: string
  mode: HostSessionMode
  revision: HostRevision
  runId: string
  sessionId: string
  worktreeId: string
}>): HostSessionIdentity {
  const namespace = `tao-host-${input.worktreeId}-${input.runId}-${input.sessionId}`
  const appId = platformAppId({
    app: input.app,
    runId: input.runId,
    sessionId: input.sessionId,
    worktreeId: input.worktreeId,
  })
  return Object.freeze({
    appId,
    artifactRoot: FS.resolvePath(`${input.worktreeId}/${input.runId}/${input.sessionId}`, input.artifactRoot),
    driverPortNamespace: `${namespace}.ports`,
    id: input.sessionId,
    revision: Object.freeze({
      build: input.revision.build,
      id: `${input.mode}-${namespace}-revision`,
      immutable: input.mode === 'acceptance',
      source: input.revision.source,
    }),
    runId: input.runId,
    worktreeId: input.worktreeId,
  })
}

/** platformAppId is valid for both iOS bundle identifiers and Android application IDs. */
function platformAppId(input: Readonly<{
  app: string
  runId: string
  sessionId: string
  worktreeId: string
}>): string {
  const appId = [
    'io',
    'tao',
    'host',
    `a${identityHash(input.app)}`,
    `w${identityHash(input.worktreeId)}`,
    `r${identityHash(input.runId)}`,
    `s${identityHash(input.sessionId)}`,
  ].join('.')
  if (appId.length > MAX_PLATFORM_APP_ID_LENGTH) {
    Errors.throwUnexpected('Host-session platform app identity exceeded its bounded allocation length.')
  }
  return appId
}

/** identityHash keeps long or platform-invalid scope labels out of application identifiers. */
function identityHash(value: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index)!
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return `${hex(first)}${hex(second)}`
}

function hex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0')
}

function targetLeaseNames(target: HostSessionTarget, needsPhysicalMacOSInput: boolean): readonly string[] {
  const name = target.kind === 'browserContext'
    ? `browser-context:${target.id}`
    : target.kind === 'iosSimulator'
      ? `ios-simulator:${target.id}`
      : target.kind === 'androidEmulator'
        ? `android-emulator:${target.id}`
        : `studio-semantic-session:${target.id}`
  return needsPhysicalMacOSInput ? ['macos-physical-input', name] : [name]
}
