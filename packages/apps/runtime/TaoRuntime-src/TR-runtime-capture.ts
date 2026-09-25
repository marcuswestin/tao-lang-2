import { Arrays } from './core/RuntimeCore'
import { RuntimeAssert } from './TR-assert'
import {
  captureActionHistory,
  restoreActionHistory,
  UnexpectedBehaviorError,
} from './TR-errors'

export type TaoRuntimeJson = boolean | null | number | string | readonly TaoRuntimeJson[] | {
  readonly [key: string]: TaoRuntimeJson
}

type TaoRuntimeCaptureDomain = Readonly<{ domain: string; value: TaoRuntimeJson; version: number }>

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
/**
 * Which domains the pending replay has already been put back into.
 *
 * A replay is a one-time seed, not a standing subscription. Without this, a domain that registers
 * from inside a React effect is restored again on every re-registration — and a restore that sets
 * state changes that effect's dependencies, which re-registers, which restores. `TR-scheme.ts` does
 * exactly that, and the result was every replayed cell spinning until React gave up with 'Maximum
 * update depth exceeded', on the device and in the browser canvas alike.
 */
const replayedDomains = new Set<string>()

registerRuntimeCaptureDomain({
  capture: () => captureActionHistory() as TaoRuntimeJson,
  domain: 'action-history',
  restore: restoreActionHistory,
  version: 1,
})

/** Registration is explicit: unregistered auth and credential stores cannot enter a capture. */
export function registerRuntimeCaptureDomain(registration: TaoRuntimeCaptureDomainRegistration): () => void {
  RuntimeAssert(
    !domains.has(registration.domain),
    `runtime capture domain '${registration.domain}' is registered exactly once`,
    { domain: registration.domain },
  )
  domains.set(registration.domain, registration)
  const replay = pendingReplay?.domains.find(domain => domain.domain === registration.domain)
  if (replay && registration.restore && !replayedDomains.has(registration.domain)) {
    replayedDomains.add(registration.domain)
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
  for (const registration of Arrays.sorted([...domains.values()], (a, b) => a.domain.localeCompare(b.domain))) {
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
export async function restoreRuntimeCapture(
  artifact: TaoRuntimeCaptureArtifact,
  onDomain?: (domain: string, stage: 'restoring' | 'restored' | 'skipped') => void,
): Promise<void> {
  RuntimeAssert.input(artifact.version === 1, `Unsupported Tao runtime capture version '${artifact.version}'.`)
  pendingReplay = artifact
  // A new artifact is a new seed: whatever the last one put back says nothing about this one.
  replayedDomains.clear()
  for (const domain of artifact.domains) {
    const registration = domains.get(domain.domain)
    // `replayedDomains` is checked here too, not only added to: a domain can re-register while an
    // earlier domain's restore is still awaited — which is exactly the React-effect churn this
    // guard exists for — and would then be seeded by that path and again by this loop.
    if (!registration?.restore || replayedDomains.has(domain.domain)) {
      onDomain?.(domain.domain, 'skipped')
      continue
    }
    RuntimeAssert.input(
      registration.version === domain.version,
      `Unsupported runtime capture domain '${domain.domain}' version '${domain.version}'.`,
      { domain: domain.domain },
    )
    replayedDomains.add(domain.domain)
    onDomain?.(domain.domain, 'restoring')
    await registration.restore(json(domain.value, domain.domain))
    onDomain?.(domain.domain, 'restored')
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
