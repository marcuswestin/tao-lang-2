import { Errors } from '@shared'

export type HostCapability =
  | 'inspect'
  | 'key'
  | 'pointer'
  | 'refreshDocument'
  | 'relaunchApplication'
  | 'screenshot'
  | 'scroll'
  | 'textInput'

export type HostRevision = Readonly<{
  build: string
  source: string
}>

export type HostLeaseIdentity = Readonly<{
  generation: string
  name: string
}>

export function assertHostLease(expected: HostLeaseIdentity, actual: HostLeaseIdentity): void {
  if (expected.name === actual.name && expected.generation === actual.generation) {
    return
  }
  throw new HostControlError(
    'staleLease',
    `Host target lease '${actual.name}' generation '${actual.generation}' is no longer current.`,
    { actual, expected },
  )
}

export type HostSessionDescriptor = Readonly<{
  capabilities: readonly HostCapability[]
  driver: string
  id: string
  lease: HostLeaseIdentity
  mode: 'acceptance' | 'development'
  revision: HostRevision
  target: string
  version: 1
}>

/** HostTarget occurrence is 1-based, matching authored Tao `select #tag[n]` scopes. */
export type HostTarget =
  | Readonly<{ kind: 'accessibility'; name: string; occurrence?: number; role?: string }>
  | Readonly<{ kind: 'scoped'; scope: HostTarget; target: HostTarget }>
  | Readonly<{ kind: 'tag'; occurrence?: number; value: string }>
  | Readonly<{ kind: 'text'; occurrence?: number; value: string }>

export type HostBounds = Readonly<{
  height: number
  width: number
  x: number
  y: number
}>

export type HostObservation = Readonly<{
  accessibilityLabel?: string
  bounds?: HostBounds
  id: string
  lease: HostLeaseIdentity
  observationRevision: number
  revision: HostRevision
  sessionId: string
  target: HostTarget
  text?: string
  timestamp: string
  visible: boolean
  version: 1
}>

export type HostObservationRequest = Readonly<{
  expectedRevision: HostRevision
  target: HostTarget
}>

export type HostAction =
  & Readonly<{ expectedRevision: HostRevision; lease: HostLeaseIdentity }>
  & (
    | Readonly<{ kind: 'click'; observation: HostObservation }>
    | Readonly<{ kind: 'key'; key: string }>
    | Readonly<{ kind: 'refreshDocument' }>
    | Readonly<{ kind: 'relaunchApplication' }>
    | Readonly<{ deltaX: number; deltaY: number; kind: 'scroll'; observation?: HostObservation }>
    | Readonly<{ kind: 'type'; observation: HostObservation; text: string }>
  )

export type HostActionReceipt = Readonly<{
  action: HostAction['kind']
  lease: HostLeaseIdentity
  observationRevision: number
  revision: HostRevision
  sessionId: string
  version: 1
}>

export type HostPublishRevisionRequest = Readonly<{
  expectedCurrentRevision: HostRevision
  lease: HostLeaseIdentity
  revision: HostRevision
}>

export type HostScreenshot = Readonly<{
  artifactPath: string
  observationRevision: number
  revision: HostRevision
  sessionId: string
  version: 1
}>

export type HostControlFailureCode =
  | 'assertion'
  | 'build'
  | 'busy'
  | 'closed'
  | 'host'
  | 'staleObservation'
  | 'staleLease'
  | 'staleRevision'
  | 'unsupported'

export class HostControlError extends Errors.HostEnvironmentError {
  readonly code: HostControlFailureCode

  constructor(code: HostControlFailureCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message, { details: { code, ...details } })
    this.code = code
  }
}

export type HostSession = Readonly<{
  captureScreenshot(name: string): Promise<HostScreenshot>
  close(lease: HostLeaseIdentity): Promise<void>
  descriptor(): HostSessionDescriptor
  observe(request: HostObservationRequest): Promise<HostObservation>
  perform(action: HostAction): Promise<HostActionReceipt>
  publishRevision(request: HostPublishRevisionRequest): Promise<void>
}>

export type HostController = Readonly<{
  close(): Promise<void>
  openSession(
    options: Readonly<{
      artifactRoot: string
      mode: HostSessionDescriptor['mode']
      revision: HostRevision
      target: string
    }>,
  ): Promise<HostSession>
}>
