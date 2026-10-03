import React from 'react'
import { existingTransactionResource, transactionResource } from './TR-action-transactions'
import { RuntimeAssert } from './TR-assert'
import type { TaoKeyValueStorage } from './TR-data'
import { memoryKeyValueStorage, platformKeyValueStorage } from './TR-data-provider'
import { warnContainedFailure } from './TR-errors'
import { runtimeRevisionStore } from './TR-listeners'
import type { TaoDeclarationIdentity } from './TR-navigation-identity'
import { registerRuntimeCaptureDomain, type TaoRuntimeJson } from './TR-runtime-capture'
import RuntimeSwitch from './TR-switch'
import { runtimeTestOverrideSlot } from './TR-test-override'

type EvaluableValue<T> = Readonly<{ evaluate(): EvaluableValue<T>; jsValue: T }>

type TaoPersistedStatePrimitiveName = 'boolean' | 'duration' | 'none' | 'number' | 'text' | 'time'

export type TaoPersistedStateType =
  | Readonly<{ cases: readonly string[]; declaration: string; kind: 'enum' }>
  | Readonly<{ kind: 'list'; element?: TaoPersistedStateType }>
  | Readonly<{ kind: 'primitive'; name: TaoPersistedStatePrimitiveName }>
  | Readonly<{
    kind: 'item'
    properties: Readonly<Record<string, Readonly<{ optional: boolean; type: TaoPersistedStateType }>>>
  }>
  | Readonly<{ kind: 'union'; members: readonly TaoPersistedStateType[] }>

/** What one decode attempt answers: the restored value, or the shared refusal every branch returns. */
type PersistedDecoding = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false }>

const undecoded: PersistedDecoding = { ok: false }

type PersistedEnvelope = Readonly<{
  formatVersion: 1
  type: TaoPersistedStateType
  value: unknown
}>

export type TaoWritableState<T> = Readonly<{
  defaultValue(): EvaluableValue<T>
  evaluate(): EvaluableValue<T>
  reset(): void
  set(value: EvaluableValue<T>): void
}>

const states = new Map<string, RuntimePersistedState<unknown>>()
/**
 * constructed holds every persisted state a generated module has ever declared, which `states`
 * cannot: `states` is filled by `usePersistedState` and emptied on unmount, so between checks — and
 * before the first mount of any check — it is empty. Only a registry filled by the constructor can
 * reach a state that a previous check wrote and then unmounted.
 *
 * It costs a real app nothing. A validated `(persist)` state is declared directly inside an app, so
 * the compiler emits its construction once at generated-module scope: the registry holds one entry
 * per declaration, already alive for the life of the module that declared it, and grows only when a
 * module is evaluated again — Fast Refresh, or a second compiled copy of one app under the harness.
 */
const constructed = new Set<ConstructedPersistedState>()
const pendingRestore = new Map<string, unknown>()
const enumCases = new Map<string, Map<string, PersistedEnumCaseIdentity>>()
let storageOverride: TaoKeyValueStorage | undefined
let testStorageRestore: (() => void) | undefined
const storageSlot = runtimeTestOverrideSlot({
  read: () => storageOverride,
  write: next => {
    storageOverride = next
  },
})

/** ConstructedPersistedState is the view the check- and launch-boundary registry needs. */
type ConstructedPersistedState = Readonly<{
  resetToDeclaredDefault(): void
  settleWrites(): Promise<void>
}>

type PersistedEnumCaseIdentity = Readonly<{ caseName: string; declaration: string; identity: symbol }>

/** registerPersistedEnumCase links one stable declaration/case name to its current runtime token. */
export function registerPersistedEnumCase(value: PersistedEnumCaseIdentity): void {
  let declarationCases = enumCases.get(value.declaration)
  if (declarationCases === undefined) {
    declarationCases = new Map()
    enumCases.set(value.declaration, declarationCases)
  }
  declarationCases.set(value.caseName, value)
}

/** isPersistedEnumCase recognizes only the canonical enum token the runtime registered. */
export function isPersistedEnumCase(value: unknown): value is PersistedEnumCaseIdentity {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<PersistedEnumCaseIdentity>
  return typeof candidate.caseName === 'string'
    && typeof candidate.declaration === 'string'
    && enumCases.get(candidate.declaration)?.get(candidate.caseName) === value
}

/** RuntimePersistedState owns one device-local value independently of preference semantics. */
export class RuntimePersistedState<T> implements TaoWritableState<T> {
  readonly key: string
  readonly #default: T
  readonly #changes = runtimeRevisionStore()
  #dirtyBeforeLoad = false
  #loaded = false
  #loading: Promise<void> | undefined
  #persistQueue: Promise<void> = Promise.resolve()
  readonly #type: TaoPersistedStateType
  #value: T

  constructor(
    initial: EvaluableValue<T>,
    identity: TaoDeclarationIdentity,
    name: string,
    type: TaoPersistedStateType,
  ) {
    this.#default = initial.evaluate().jsValue
    RuntimeAssert(
      matchesPersistedType(this.#default, type),
      `persisted state '${name}' default matches its generated runtime type`,
      { type },
    )
    this.#value = this.#default
    this.#type = type
    this.key = `tao.persisted-state.v1:${identity.canonical}:${name}`
    const restored = pendingRestore.get(this.key)
    const decoded = restored === undefined ? undecoded : decodePersistedValue(restored, this.#type)
    if (decoded.ok) {
      this.#value = decoded.value as T
    }
    constructed.add(this)
  }

  defaultValue(): EvaluableValue<T> {
    return value(this.#default)
  }

  evaluate(): EvaluableValue<T> {
    return value(existingTransactionResource<{ value: T }>(this)?.value ?? this.#value)
  }

  reset(): void {
    this.set(value(this.#default))
  }

  set(next: EvaluableValue<T>): void {
    const nextValue = next.evaluate().jsValue
    const overlay = transactionResource(
      this,
      () => ({ previous: this.#value, value: this.#value }),
      committed => this.#commit(committed.value),
      undefined,
      committed => this.#commit(committed.previous),
      overlay => [{ kind: 'persisted', target: 'persisted', committed: overlay.previous, pending: overlay.value }],
    )
    if (overlay) {
      overlay.value = nextValue
      return
    }
    this.#commit(nextValue)
  }

  subscribe = this.#changes.subscribe

  snapshot = this.#changes.snapshot

  load(): Promise<void> {
    if (this.#loading) {
      return this.#loading
    }
    this.#loading = (async () => {
      const encoded = await storage().getItem(this.key)
      if (encoded !== null && !this.#dirtyBeforeLoad) {
        const restored = decodeEnvelope(encoded, this.#type)
        if (restored.ok) {
          this.#replace(restored.value as T)
        }
      }
      this.#loaded = true
    })().catch(error => {
      this.#loaded = true
      warnContainedFailure(`Could not load persisted state '${this.key}'.`, error)
    })
    return this.#loading
  }

  capture(): unknown {
    return encodePersistedValue(this.#value, this.#type)
  }

  restore(next: unknown): void {
    const decoded = decodePersistedValue(next, this.#type)
    if (decoded.ok) {
      this.#replace(decoded.value as T)
    }
  }

  /** settleWrites waits until the device holds every value this launch queued. */
  async settleWrites(): Promise<void> {
    await this.#persistQueue
  }

  /**
   * resetToDeclaredDefault returns this state to the value its declaration says a new device holds,
   * and is the seam behind both boundaries. Unlike `reset` it writes nothing, which each boundary
   * needs for its own reason: at a check boundary `beginPersistedStateTest` has already swapped in
   * an empty store, so a write would only put the default back into a store about to be discarded;
   * at a launch boundary the device is kept, and writing the default there would erase the very
   * value the relaunched instance is supposed to read back.
   *
   * Forgetting the load memo is the point of both. A state declared at generated-module scope
   * outlives every mount, so one that already loaded would hand the next check — or the next
   * launch — that same resolved read and never look at the store again.
   */
  resetToDeclaredDefault(): void {
    this.#dirtyBeforeLoad = false
    this.#loaded = false
    this.#loading = undefined
    // A save still queued against the previous check's storage keeps its own reference to it and
    // settles there. Dropping the chain stops the next check's saves from waiting on that promise.
    // A launch boundary has already awaited the chain, so there is nothing of its own to drop.
    this.#persistQueue = Promise.resolve()
    this.#replace(this.#default)
  }

  #commit(next: T): void {
    RuntimeAssert(
      matchesPersistedType(next, this.#type),
      `persisted state '${this.key}' only ever receives a value matching its generated runtime type`,
      { type: this.#type },
    )
    if (!this.#loaded) {
      this.#dirtyBeforeLoad = true
    }
    this.#replace(next)
    const envelope: PersistedEnvelope = {
      formatVersion: 1,
      type: this.#type,
      value: encodePersistedValue(next, this.#type),
    }
    const encoded = JSON.stringify(envelope)
    const targetStorage = storage()
    this.#persistQueue = this.#persistQueue
      .then(() => targetStorage.setItem(this.key, encoded))
      .catch(error => warnContainedFailure(`Could not save persisted state '${this.key}'.`, error))
  }

  #replace(next: T): void {
    this.#value = next
    this.#changes.changed()
  }
}

function decodeEnvelope(encoded: string, expectedType: TaoPersistedStateType): PersistedDecoding {
  try {
    const envelope = JSON.parse(encoded) as Partial<PersistedEnvelope>
    if (!isCurrentEnvelope(envelope, expectedType)) {
      warnContainedFailure('Ignored persisted state whose version or runtime type no longer matches.', undefined)
      return undecoded
    }
    const decoded = decodePersistedValue(envelope.value, expectedType)
    if (!decoded.ok) {
      warnContainedFailure('Ignored persisted state whose value no longer matches its runtime type.', undefined)
    }
    return decoded
  } catch (error) {
    warnContainedFailure('Ignored corrupt persisted state.', error)
    return undecoded
  }
}

/** An envelope is readable only when this build wrote its format and the very same runtime type. */
function isCurrentEnvelope(envelope: Partial<PersistedEnvelope>, expectedType: TaoPersistedStateType): boolean {
  return envelope !== null
    && typeof envelope === 'object'
    && envelope.formatVersion === 1
    && JSON.stringify(envelope.type) === JSON.stringify(expectedType)
}

function matchesPersistedType(value: unknown, type: TaoPersistedStateType): boolean {
  return RuntimeSwitch.kind(type, {
    enum: enumeration =>
      isPlainRecord(value)
      && value['declaration'] === enumeration.declaration
      && typeof value['caseName'] === 'string'
      && enumeration.cases.includes(value['caseName'])
      && typeof value['identity'] === 'symbol',
    item: item =>
      isPlainRecord(value)
      && Object.keys(value).every(name => name in item.properties)
      && Object.entries(item.properties).every(([name, property]) =>
        (property.optional && !(name in value)) || (name in value && matchesPersistedType(value[name], property.type))
      ),
    list: list =>
      Array.isArray(value)
      && (list.element === undefined || value.every(item => matchesPersistedType(item, list.element!))),
    primitive: primitive => matchesPersistedPrimitive(value, primitive.name),
    union: union => union.members.some(member => matchesPersistedType(value, member)),
  })
}

/**
 * The JavaScript shape each Tao primitive persists as. `duration` and `time` are finite numbers
 * like `number` is; naming all three keeps a primitive added later from silently joining them.
 */
function matchesPersistedPrimitive(value: unknown, name: TaoPersistedStatePrimitiveName): boolean {
  const finiteNumber = (): boolean => typeof value === 'number' && Number.isFinite(value)
  return RuntimeSwitch(name, {
    boolean: () => typeof value === 'boolean',
    duration: finiteNumber,
    none: () => value === null,
    number: finiteNumber,
    text: () => typeof value === 'string',
    time: finiteNumber,
  })
}

function encodePersistedValue(value: unknown, type: TaoPersistedStateType): unknown {
  return RuntimeSwitch.kind(type, {
    enum: enumeration => {
      RuntimeAssert(
        matchesPersistedType(value, enumeration),
        'persisted enum value matches its generated runtime type',
        {
          type,
        },
      )
      return { caseName: (value as PersistedEnumCaseIdentity).caseName, declaration: enumeration.declaration }
    },
    item: item =>
      Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, property]) => [
          name,
          encodePersistedValue(property, item.properties[name]!.type),
        ]),
      ),
    list: list =>
      list.element === undefined
        ? value
        : (value as unknown[]).map(item => encodePersistedValue(item, list.element!)),
    primitive: () => value,
    union: union => {
      const member = union.members.find(candidate => matchesPersistedType(value, candidate))
      RuntimeAssert.defined(member, 'persisted union value matches one of its generated runtime type members', { type })
      return encodePersistedValue(value, member)
    },
  })
}

function decodePersistedValue(value: unknown, type: TaoPersistedStateType): PersistedDecoding {
  return RuntimeSwitch.kind<TaoPersistedStateType, PersistedDecoding>(type, {
    enum: enumeration => {
      if (
        !isPlainRecord(value)
        || value['declaration'] !== enumeration.declaration
        || typeof value['caseName'] !== 'string'
        || !enumeration.cases.includes(value['caseName'])
      ) {
        return undecoded
      }
      const restored = enumCases.get(enumeration.declaration)?.get(value['caseName'])
      return restored === undefined ? undecoded : { ok: true, value: restored }
    },
    item: item => {
      if (!isPlainRecord(value) || Object.keys(value).some(name => !(name in item.properties))) {
        return undecoded
      }
      const restored: Record<string, unknown> = {}
      for (const [name, property] of Object.entries(item.properties)) {
        if (!(name in value)) {
          if (property.optional) {
            continue
          }
          return undecoded
        }
        const decoded = decodePersistedValue(value[name], property.type)
        if (!decoded.ok) {
          return decoded
        }
        restored[name] = decoded.value
      }
      return { ok: true, value: restored }
    },
    list: list => {
      if (!Array.isArray(value)) {
        return undecoded
      }
      if (list.element === undefined) {
        return { ok: true, value }
      }
      const restored: unknown[] = []
      for (const item of value) {
        const decoded = decodePersistedValue(item, list.element)
        if (!decoded.ok) {
          return decoded
        }
        restored.push(decoded.value)
      }
      return { ok: true, value: restored }
    },
    primitive: primitive => matchesPersistedPrimitive(value, primitive.name) ? { ok: true, value } : undecoded,
    union: union => {
      for (const member of union.members) {
        const decoded = decodePersistedValue(value, member)
        if (decoded.ok) {
          return decoded
        }
      }
      return undecoded
    },
  })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** usePersistedState subscribes a mounted app and starts its default-first async load. */
export function usePersistedState(state: RuntimePersistedState<unknown>): void {
  React.useSyncExternalStore(state.subscribe, state.snapshot, state.snapshot)
  React.useEffect(() => {
    states.set(state.key, state)
    void state.load()
    return () => {
      if (states.get(state.key) === state) {
        states.delete(state.key)
      }
    }
  }, [state])
}

/** capturePersistedState is the provider-neutral hook used by Studio capture orchestration. */
export function capturePersistedState(): Readonly<Record<string, unknown>> {
  return Object.freeze(Object.fromEntries([...states].map(([key, state]) => [key, state.capture()])))
}

function restorePersistedState(captured: Readonly<Record<string, unknown>>): void {
  for (const [key, capturedValue] of Object.entries(captured)) {
    pendingRestore.set(key, capturedValue)
    states.get(key)?.restore(capturedValue)
  }
}

/**
 * beginPersistedStateTest gives one Tao check its own device. Every state a generated module has
 * declared goes back to its declared default and forgets that it ever loaded, and the check runs
 * over a private in-memory store, so a value an earlier check wrote is unreachable in both the
 * values held in memory and the bytes on the device. A relaunch inside a check deliberately does
 * not come through here: the same device is what a relaunch keeps.
 */
export function beginPersistedStateTest(): void {
  endPersistedStateTest()
  testStorageRestore = setPersistedStateStorageForTests(memoryKeyValueStorage())
  pendingRestore.clear()
  for (const state of constructed) {
    state.resetToDeclaredDefault()
  }
}

/**
 * beginPersistedStateLaunch ends the running launch and prepares the next one on the same device,
 * the way `beginNavigationRestorationLaunch` does for navigation. The values the launched instance
 * held and the read each one memoized are dropped; the device is kept and never written, so the
 * relaunched instance genuinely hydrates from the bytes this one left behind rather than from a
 * module-scope value that outlived it. It settles the queued writes first, because the read the
 * next instance performs is not ordered behind a write that is still in flight.
 *
 * A relaunch has no `fresh` here. `fresh` opts a launch out of restoring navigation, not out of the
 * device: the width a person persisted is still theirs on the launch after it.
 */
export async function beginPersistedStateLaunch(): Promise<void> {
  for (const state of constructed) {
    await state.settleWrites()
  }
  for (const state of constructed) {
    state.resetToDeclaredDefault()
  }
}

/** endPersistedStateTest hands the device-local domain back to whatever storage surrounded the check. */
export function endPersistedStateTest(): void {
  testStorageRestore?.()
  testStorageRestore = undefined
}

/** setPersistedStateStorageForTests replaces only this device-local state domain. */
export function setPersistedStateStorageForTests(next: TaoKeyValueStorage | undefined): () => void {
  return storageSlot.install(next)
}

function storage(): TaoKeyValueStorage {
  return storageOverride ?? platformKeyValueStorage()
}

function value<T>(jsValue: T): EvaluableValue<T> {
  const result: EvaluableValue<T> = { evaluate: () => result, jsValue }
  return result
}

registerRuntimeCaptureDomain({
  capture: () => capturePersistedState() as TaoRuntimeJson,
  domain: 'persisted-state',
  module: 'TR-persisted-state',
  restore: value => restorePersistedState(value as Readonly<Record<string, unknown>>),
  version: 1,
})
