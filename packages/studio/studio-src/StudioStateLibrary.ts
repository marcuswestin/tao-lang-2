import { Errors } from '@shared'
import { requireText, validateTaoSource } from './StudioPreviewCell'
import type { StudioTaoSource } from './StudioPreviewManifest'
import type { StudioJsonValue } from './StudioProtocol'

export const studioStateSnapshotVersion = 1 as const

export type StudioStateDomainSnapshot = {
  codecVersion: number
  value: StudioJsonValue
}

export type StudioStateSnapshot = {
  domains: Readonly<Record<string, StudioStateDomainSnapshot>>
  version: typeof studioStateSnapshotVersion
}

export type StudioStateEntry = {
  label: string
  layers: readonly string[]
  revision: string
  snapshot: StudioStateSnapshot
  source: StudioTaoSource
  stateId: string
}

export type StudioStateDiagnostic = {
  code: 'state-cycle' | 'state-domain-codec-conflict' | 'state-domain-overridden' | 'state-not-found'
  domain?: string
  message: string
  severity: 'error' | 'warning'
  stateIds: readonly string[]
}

export type StudioResolvedState = {
  diagnostics: readonly StudioStateDiagnostic[]
  orderedStateIds: readonly string[]
  snapshot: StudioStateSnapshot
}

export class StudioStateResolutionError extends Errors.UserInputError {
  constructor(readonly diagnostics: readonly StudioStateDiagnostic[]) {
    super(diagnostics.map(diagnostic => diagnostic.message).join(' '))
  }
}

/** StudioStateLibrary resolves Tao-authored state layers through explicit versioned runtime domains. */
export class StudioStateLibrary {
  readonly #entries = new Map<string, StudioStateEntry>()
  readonly #supportedDomains: ReadonlySet<string>

  constructor(entries: readonly StudioStateEntry[], supportedDomains: readonly string[]) {
    this.#supportedDomains = new Set(supportedDomains.map(requireIdentifier))
    for (const entry of entries) {
      validateEntry(entry, this.#supportedDomains)
      if (this.#entries.has(entry.stateId)) {
        throw new Errors.UserInputError(`Studio state id is duplicated: ${entry.stateId}`)
      }
      this.#entries.set(entry.stateId, entry)
    }
  }

  entries(): readonly StudioStateEntry[] {
    return [...this.#entries.values()]
  }

  resolve(stateIds: readonly string[]): StudioResolvedState {
    const ordered: StudioStateEntry[] = []
    const completed = new Set<string>()
    const visiting: string[] = []
    for (const stateId of stateIds) {
      this.#visit(stateId, visiting, completed, ordered)
    }

    const diagnostics: StudioStateDiagnostic[] = []
    const domains: Record<string, StudioStateDomainSnapshot> = {}
    const ownerByDomain = new Map<string, string>()
    for (const entry of ordered) {
      for (const [domain, snapshot] of Object.entries(entry.snapshot.domains)) {
        const previous = domains[domain]
        const previousOwner = ownerByDomain.get(domain)
        if (previous !== undefined && previousOwner !== undefined) {
          if (previous.codecVersion !== snapshot.codecVersion) {
            throw new StudioStateResolutionError([{
              code: 'state-domain-codec-conflict',
              domain,
              message: `Studio states ${previousOwner} and ${entry.stateId} use incompatible ${domain} codecs.`,
              severity: 'error',
              stateIds: [previousOwner, entry.stateId],
            }])
          }
          diagnostics.push({
            code: 'state-domain-overridden',
            domain,
            message: `Studio state ${entry.stateId} overrides ${domain} from ${previousOwner}.`,
            severity: 'warning',
            stateIds: [previousOwner, entry.stateId],
          })
        }
        domains[domain] = snapshot
        ownerByDomain.set(domain, entry.stateId)
      }
    }
    return {
      diagnostics,
      orderedStateIds: ordered.map(entry => entry.stateId),
      snapshot: { domains, version: studioStateSnapshotVersion },
    }
  }

  #visit(
    stateId: string,
    visiting: string[],
    completed: Set<string>,
    ordered: StudioStateEntry[],
  ): void {
    if (completed.has(stateId)) {
      return
    }
    const cycleStart = visiting.indexOf(stateId)
    if (cycleStart >= 0) {
      const cycle = [...visiting.slice(cycleStart), stateId]
      throw new StudioStateResolutionError([{
        code: 'state-cycle',
        message: `Studio state composition contains a cycle: ${cycle.join(' -> ')}.`,
        severity: 'error',
        stateIds: cycle,
      }])
    }
    const entry = this.#entries.get(stateId)
    if (entry === undefined) {
      throw new StudioStateResolutionError([{
        code: 'state-not-found',
        message: `Studio state does not exist: ${stateId}.`,
        severity: 'error',
        stateIds: [stateId],
      }])
    }
    visiting.push(stateId)
    for (const layer of entry.layers) {
      this.#visit(layer, visiting, completed, ordered)
    }
    visiting.pop()
    completed.add(stateId)
    ordered.push(entry)
  }
}

function validateEntry(entry: StudioStateEntry, supportedDomains: ReadonlySet<string>): void {
  requireIdentifier(entry.stateId)
  requireText(entry.label, 'Studio state label')
  requireText(entry.revision, 'Studio state revision')
  validateTaoSource(entry.source, 'Studio state source')
  if (entry.snapshot.version !== studioStateSnapshotVersion) {
    throw new Errors.UserInputError(`Unsupported Studio state snapshot version: ${entry.snapshot.version}`)
  }
  for (const layer of entry.layers) {
    requireIdentifier(layer)
  }
  for (const [domain, snapshot] of Object.entries(entry.snapshot.domains)) {
    requireIdentifier(domain)
    if (!supportedDomains.has(domain)) {
      throw new Errors.UserInputError(`Studio state domain is not supported by this runtime: ${domain}`)
    }
    if (!Number.isSafeInteger(snapshot.codecVersion) || snapshot.codecVersion < 1) {
      throw new Errors.UserInputError(`Studio state domain ${domain} needs a positive codec version.`)
    }
    if (!isJsonValue(snapshot.value)) {
      throw new Errors.UserInputError(`Studio state domain ${domain} contains unsupported runtime data.`)
    }
  }
}

function isJsonValue(value: unknown): value is StudioJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }
  return typeof value === 'object'
    && value !== null
    && Object.values(value).every(isJsonValue)
}

function requireIdentifier(value: string): string {
  return requireText(value, 'Studio identifier')
}
