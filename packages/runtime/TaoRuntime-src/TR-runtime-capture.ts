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
  if (domains.has(registration.domain)) {
    throw new Error(`Runtime capture domain '${registration.domain}' is already registered.`)
  }
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
  if (artifact.version !== 1) {
    throw new Error(`Unsupported Tao runtime capture version '${artifact.version}'.`)
  }
  pendingReplay = artifact
  for (const domain of artifact.domains) {
    const registration = domains.get(domain.domain)
    if (!registration?.restore) {
      continue
    }
    if (registration.version !== domain.version) {
      throw new Error(`Unsupported runtime capture domain '${domain.domain}' version '${domain.version}'.`)
    }
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
    if (Number.isFinite(value)) {
      return value
    }
    throw new Error(`Runtime capture domain '${domain}' contains a non-finite number.`)
  }
  if (typeof value !== 'object') {
    throw new Error(`Runtime capture domain '${domain}' returned non-JSON state.`)
  }
  if (ancestors.has(value)) {
    throw new Error(`Runtime capture domain '${domain}' contains a cycle.`)
  }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map(item => copyJson(item, domain, ancestors))
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Runtime capture domain '${domain}' contains an opaque object.`)
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyJson(item, domain, ancestors)]))
  } finally {
    ancestors.delete(value)
  }
}
