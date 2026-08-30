import {
  studioStateSeedVersion,
  type TaoStudioStateSeed,
} from './TR-studio-environment'

export const studioStateArtifactVersion = 1 as const

export type TaoStudioJsonObject = { readonly [key: string]: TaoStudioJsonValue }
export type TaoStudioJsonValue =
  | boolean
  | null
  | number
  | readonly TaoStudioJsonValue[]
  | string
  | TaoStudioJsonObject

export type TaoStudioStateDomainPayload = Readonly<{
  domain: string
  state: TaoStudioJsonValue
  version: number
}>

export type TaoStudioStateArtifact = Readonly<{
  domains: readonly TaoStudioStateDomainPayload[]
  version: typeof studioStateArtifactVersion
}>

export type TaoStudioStateLayer = Readonly<{
  artifact: TaoStudioStateArtifact
  name: string
}>

export type TaoStudioStateComposeContext = Readonly<{
  incomingLayer: string
  previousLayers: readonly string[]
}>

export type TaoStudioStateDomainCodec<ValueT> = Readonly<{
  compose(current: ValueT, incoming: ValueT, context: TaoStudioStateComposeContext): ValueT
  decode(state: TaoStudioJsonValue): ValueT
  domain: string
  encode(value: ValueT): TaoStudioJsonValue
  version: number
}>

type RegisteredCodec = TaoStudioStateDomainCodec<unknown>

type ComposedDomain = {
  codec: RegisteredCodec
  layers: string[]
  value: unknown
}

/** TaoStudioStateConflictError names the exact domain and layers that cannot compose. */
export class TaoStudioStateConflictError extends Error {
  constructor(
    readonly domain: string,
    readonly previousLayers: readonly string[],
    readonly incomingLayer: string,
    detail: string,
  ) {
    super(
      `Tao Studio state domain '${domain}' conflicts between '${previousLayers.join("', '")}' and `
        + `'${incomingLayer}': ${detail}`,
    )
    this.name = 'TaoStudioStateConflictError'
  }
}

/** TaoStudioStateCodecRegistry validates and deterministically composes explicit state domains. */
export class TaoStudioStateCodecRegistry {
  readonly #codecs = new Map<string, RegisteredCodec>()

  register<ValueT>(codec: TaoStudioStateDomainCodec<ValueT>): void {
    validateCodec(codec)
    if (this.#codecs.has(codec.domain)) {
      throw new Error(`Tao Studio state domain '${codec.domain}' is already registered.`)
    }
    this.#codecs.set(codec.domain, codec as RegisteredCodec)
  }

  /** validate rejects unsupported domains, unsupported codec versions, and duplicate payloads. */
  validate(artifact: TaoStudioStateArtifact): void {
    requireArtifactVersion(artifact)
    const seen = new Set<string>()
    for (const payload of artifact.domains) {
      if (seen.has(payload.domain)) {
        throw new Error(`Tao Studio state artifact repeats domain '${payload.domain}'.`)
      }
      seen.add(payload.domain)
      const codec = this.#codecs.get(payload.domain)
      if (codec === undefined) {
        throw new Error(`Unsupported Tao Studio state domain '${payload.domain}'.`)
      }
      if (payload.version !== codec.version) {
        throw new Error(
          `Unsupported Tao Studio state domain '${payload.domain}' version '${payload.version}'; `
            + `expected '${codec.version}'.`,
        )
      }
      if (!isJsonValue(payload.state)) {
        throw new Error(`Tao Studio state domain '${payload.domain}' is not JSON data.`)
      }
      codec.decode(payload.state)
    }
  }

  /** compose applies layers and domain codecs in source order and returns canonical domain order. */
  compose(layers: readonly TaoStudioStateLayer[]): TaoStudioStateArtifact {
    const composed = new Map<string, ComposedDomain>()
    const order: string[] = []
    const layerNames = new Set<string>()
    for (const layer of layers) {
      if (layer.name.trim().length === 0) {
        throw new Error('A Tao Studio state composition layer must have a name.')
      }
      if (layerNames.has(layer.name)) {
        throw new Error(`Tao Studio state composition repeats layer '${layer.name}'.`)
      }
      layerNames.add(layer.name)
      this.validate(layer.artifact)
      for (const payload of layer.artifact.domains) {
        const codec = this.#codecs.get(payload.domain)!
        const incoming = codec.decode(payload.state)
        const current = composed.get(payload.domain)
        if (current === undefined) {
          order.push(payload.domain)
          composed.set(payload.domain, { codec, layers: [layer.name], value: incoming })
          continue
        }
        try {
          current.value = codec.compose(current.value, incoming, {
            incomingLayer: layer.name,
            previousLayers: [...current.layers],
          })
        } catch (error) {
          if (error instanceof TaoStudioStateConflictError) {
            throw error
          }
          throw new TaoStudioStateConflictError(
            payload.domain,
            [...current.layers],
            layer.name,
            error instanceof Error ? error.message : String(error),
          )
        }
        current.layers.push(layer.name)
      }
    }
    return {
      domains: Object.freeze(order.map(domain => {
        const value = composed.get(domain)!
        const state = value.codec.encode(value.value)
        if (!isJsonValue(state)) {
          throw new Error(`Tao Studio state codec '${domain}' encoded non-JSON data.`)
        }
        return Object.freeze({
          domain,
          state,
          version: value.codec.version,
        })
      })),
      version: studioStateArtifactVersion,
    }
  }
}

/** StudioDataStateCodec composes exact provider snapshots without silently choosing a conflicting store. */
export const StudioDataStateCodec: TaoStudioStateDomainCodec<TaoStudioStateSeed> = {
  compose(current, incoming) {
    const snapshots: Record<string, string> = { ...current.snapshots }
    for (const [storageKey, snapshot] of Object.entries(incoming.snapshots)) {
      const existing = snapshots[storageKey]
      if (existing !== undefined && existing !== snapshot) {
        throw new Error(`storage key '${storageKey}' has different snapshots`)
      }
      snapshots[storageKey] = snapshot
    }
    return canonicalDataState(snapshots)
  },
  decode(state) {
    if (!isObject(state) || state['version'] !== studioStateSeedVersion || !isObject(state['snapshots'])) {
      throw new Error('Tao Studio data state must contain a supported version and snapshot object.')
    }
    const snapshots: Record<string, string> = {}
    for (const [storageKey, snapshot] of Object.entries(state['snapshots'])) {
      if (storageKey.trim().length === 0 || typeof snapshot !== 'string') {
        throw new Error('Tao Studio data state requires non-empty storage keys and string snapshots.')
      }
      snapshots[storageKey] = snapshot
    }
    return canonicalDataState(snapshots)
  },
  domain: 'data',
  encode: value => ({ snapshots: value.snapshots, version: value.version }),
  version: 1,
}

/** StudioStateControls publishes the versioned domain registry without assuming future state domains. */
export const StudioStateControls = {
  Data: StudioDataStateCodec,
  Registry(): TaoStudioStateCodecRegistry {
    const registry = new TaoStudioStateCodecRegistry()
    registry.register(StudioDataStateCodec)
    return registry
  },
} as const

function requireArtifactVersion(artifact: TaoStudioStateArtifact): void {
  if (artifact.version !== studioStateArtifactVersion) {
    throw new Error(`Unsupported Tao Studio state artifact version '${String(artifact.version)}'.`)
  }
}

function validateCodec(codec: TaoStudioStateDomainCodec<unknown>): void {
  if (codec.domain.trim().length === 0) {
    throw new Error('A Tao Studio state domain codec must have a name.')
  }
  if (!Number.isSafeInteger(codec.version) || codec.version < 1) {
    throw new Error(`Tao Studio state domain '${codec.domain}' must have a positive safe-integer version.`)
  }
}

function canonicalDataState(snapshots: Readonly<Record<string, string>>): TaoStudioStateSeed {
  return Object.freeze({
    snapshots: Object.freeze(
      Object.fromEntries(Object.entries(snapshots).toSorted(([left], [right]) => left.localeCompare(right))),
    ),
    version: studioStateSeedVersion,
  })
}

function isObject(value: unknown): value is Record<string, TaoStudioJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is TaoStudioJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }
  return isObject(value) && Object.values(value).every(isJsonValue)
}
