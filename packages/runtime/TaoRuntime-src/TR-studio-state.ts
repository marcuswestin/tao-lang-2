import { RuntimeAssert } from './TR-assert'
import { UserInputError } from './TR-errors'
import {
  studioStateSeedVersion,
  type TaoStudioStateSeed,
} from './TR-studio-environment'

export const studioStateArtifactVersion = 1 as const

type TaoStudioJsonObject = { readonly [key: string]: TaoStudioJsonValue }
type TaoStudioJsonValue =
  | boolean
  | null
  | number
  | readonly TaoStudioJsonValue[]
  | string
  | TaoStudioJsonObject

type TaoStudioStateDomainPayload = Readonly<{
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

type TaoStudioStateComposeContext = Readonly<{
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
    RuntimeAssert.input(
      !this.#codecs.has(codec.domain),
      `Tao Studio state domain '${codec.domain}' is already registered.`,
      { domain: codec.domain },
    )
    this.#codecs.set(codec.domain, codec as RegisteredCodec)
  }

  /** validate rejects unsupported domains, unsupported codec versions, and duplicate payloads. */
  validate(artifact: TaoStudioStateArtifact): void {
    requireArtifactVersion(artifact)
    const seen = new Set<string>()
    for (const payload of artifact.domains) {
      RuntimeAssert.input(
        !seen.has(payload.domain),
        `Tao Studio state artifact repeats domain '${payload.domain}'.`,
        { domain: payload.domain },
      )
      seen.add(payload.domain)
      const codec = this.#codecs.get(payload.domain)
      RuntimeAssert.input(codec, `Unsupported Tao Studio state domain '${payload.domain}'.`, {
        domain: payload.domain,
      })
      RuntimeAssert.input(
        payload.version === codec.version,
        `Unsupported Tao Studio state domain '${payload.domain}' version '${payload.version}'; `
          + `expected '${codec.version}'.`,
        { domain: payload.domain },
      )
      RuntimeAssert.input(isJsonValue(payload.state), `Tao Studio state domain '${payload.domain}' is not JSON data.`, {
        domain: payload.domain,
      })
      codec.decode(payload.state)
    }
  }

  /** compose applies layers and domain codecs in source order and returns canonical domain order. */
  compose(layers: readonly TaoStudioStateLayer[]): TaoStudioStateArtifact {
    const composed = new Map<string, ComposedDomain>()
    const order: string[] = []
    const layerNames = new Set<string>()
    for (const layer of layers) {
      RuntimeAssert.input(layer.name.trim().length > 0, 'A Tao Studio state composition layer must have a name.')
      RuntimeAssert.input(
        !layerNames.has(layer.name),
        `Tao Studio state composition repeats layer '${layer.name}'.`,
        { layer: layer.name },
      )
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
        RuntimeAssert.input(isJsonValue(state), `Tao Studio state codec '${domain}' encoded non-JSON data.`, { domain })
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
const StudioDataStateCodec: TaoStudioStateDomainCodec<TaoStudioStateSeed> = {
  compose(current, incoming) {
    const snapshots: Record<string, string> = { ...current.snapshots }
    for (const [storageKey, snapshot] of Object.entries(incoming.snapshots)) {
      const existing = snapshots[storageKey]
      RuntimeAssert.input(
        existing === undefined || existing === snapshot,
        `storage key '${storageKey}' has different snapshots`,
        { storageKey },
      )
      snapshots[storageKey] = snapshot
    }
    return canonicalDataState(snapshots)
  },
  decode(state) {
    if (!isObject(state) || state['version'] !== studioStateSeedVersion || !isObject(state['snapshots'])) {
      throw new UserInputError('Tao Studio data state must contain a supported version and snapshot object.')
    }
    const snapshots: Record<string, string> = {}
    for (const [storageKey, snapshot] of Object.entries(state['snapshots'])) {
      if (storageKey.trim().length === 0 || typeof snapshot !== 'string') {
        throw new UserInputError('Tao Studio data state requires non-empty storage keys and string snapshots.')
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
  RuntimeAssert.input(
    artifact.version === studioStateArtifactVersion,
    `Unsupported Tao Studio state artifact version '${String(artifact.version)}'.`,
  )
}

function validateCodec(codec: TaoStudioStateDomainCodec<unknown>): void {
  RuntimeAssert.input(codec.domain.trim().length > 0, 'A Tao Studio state domain codec must have a name.')
  RuntimeAssert.input(
    Number.isSafeInteger(codec.version) && codec.version >= 1,
    `Tao Studio state domain '${codec.domain}' must have a positive safe-integer version.`,
    { domain: codec.domain },
  )
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
