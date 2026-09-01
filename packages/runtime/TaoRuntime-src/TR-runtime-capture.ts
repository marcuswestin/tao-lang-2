import { RuntimeAssert } from './TR-assert'
import { UnexpectedBehaviorError } from './TR-errors'

export type TaoRuntimeJson = boolean | null | number | string | readonly TaoRuntimeJson[] | {
  readonly [key: string]: TaoRuntimeJson
}

export type TaoRuntimeCaptureDomain = Readonly<{ domain: string; value: TaoRuntimeJson; version: number }>

export type TaoRuntimeFailureFrame = Readonly<{
  arguments?: TaoRuntimeJson
  boundary: 'app' | 'item' | 'screen'
  componentStack?: string
  declaration?: string
  source?: Readonly<{ end: number; path: string; start: number }>
}>

export type TaoRuntimeFailure = Readonly<{
  boundaryId: string
  error: Readonly<{ message: string; name: string; stack?: string }>
  frame: TaoRuntimeFailureFrame
  retryEligible: boolean
  stopper: boolean
  timestamp: number
}>

export type TaoRuntimeCaptureArtifact = Readonly<{
  capturedAt: number
  domains: readonly TaoRuntimeCaptureDomain[]
  failure?: TaoRuntimeFailure
  version: 1
}>

export type TaoRuntimeCaptureDomainRegistration = Readonly<{
  capture(): Promise<TaoRuntimeJson> | TaoRuntimeJson
  domain: string
  restore?(value: TaoRuntimeJson): Promise<void> | void
  version: number
}>

const domains = new Map<string, TaoRuntimeCaptureDomainRegistration>()
let pendingReplay: TaoRuntimeCaptureArtifact | undefined

/** Registration is explicit: unregistered auth and credential stores cannot enter a capture. */
export function registerRuntimeCaptureDomain(registration: TaoRuntimeCaptureDomainRegistration): () => void {
  RuntimeAssert(
    !domains.has(registration.domain),
    `runtime capture domain '${registration.domain}' is registered exactly once`,
    { domain: registration.domain },
  )
  domains.set(registration.domain, registration)
  const replay = pendingReplay?.domains.find(domain => domain.domain === registration.domain)
  if (replay && registration.restore) {
    void Promise.resolve(registration.restore(replay.value))
  }
  return () => {
    if (domains.get(registration.domain) === registration) {
      domains.delete(registration.domain)
    }
  }
}

/** captureRuntime captures only explicitly registered semantic domains in stable domain order. */
export async function captureRuntime(failure?: TaoRuntimeFailure): Promise<TaoRuntimeCaptureArtifact> {
  const captured: TaoRuntimeCaptureDomain[] = []
  for (const registration of [...domains.values()].sort((a, b) => a.domain.localeCompare(b.domain))) {
    captured.push({
      domain: registration.domain,
      value: json(await registration.capture(), registration.domain),
      version: registration.version,
    })
  }
  return Object.freeze({
    capturedAt: Date.now(),
    domains: Object.freeze(captured),
    ...(failure ? { failure } : {}),
    version: 1,
  })
}

/** restoreRuntimeCapture restores known domains and retains the artifact for later registrations. */
export async function restoreRuntimeCapture(artifact: TaoRuntimeCaptureArtifact): Promise<void> {
  RuntimeAssert.input(artifact.version === 1, `Unsupported Tao runtime capture version '${artifact.version}'.`)
  pendingReplay = artifact
  for (const domain of artifact.domains) {
    const registration = domains.get(domain.domain)
    if (!registration?.restore) {
      continue
    }
    RuntimeAssert.input(
      registration.version === domain.version,
      `Unsupported runtime capture domain '${domain.domain}' version '${domain.version}'.`,
      { domain: domain.domain },
    )
    await registration.restore(json(domain.value, domain.domain))
  }
}

function json(value: unknown, domain: string): TaoRuntimeJson {
  return copyJson(value, domain, new Set())
}

function copyJson(value: unknown, domain: string, ancestors: Set<object>): TaoRuntimeJson {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    RuntimeAssert(Number.isFinite(value), `runtime capture domain '${domain}' holds only finite numbers`, { domain })
    return value
  }
  if (typeof value !== 'object') {
    throw new UnexpectedBehaviorError(`Runtime capture domain '${domain}' returned non-JSON state.`, {
      details: { domain },
    })
  }
  RuntimeAssert(!ancestors.has(value), `runtime capture domain '${domain}' holds no cycle`, { domain })
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map(item => copyJson(item, domain, ancestors))
    }
    const prototype = Object.getPrototypeOf(value)
    RuntimeAssert(
      prototype === Object.prototype || prototype === null,
      `runtime capture domain '${domain}' holds no opaque object`,
      { domain },
    )
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyJson(item, domain, ancestors)]))
  } finally {
    ancestors.delete(value)
  }
}
