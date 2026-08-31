import React from 'react'
import { existingTransactionResource, transactionResource } from './TR-action-transactions'
import type { TaoKeyValueStorage } from './TR-data'
import { platformKeyValueStorage } from './TR-data-provider'
import type { TaoDeclarationIdentity } from './TR-navigation-identity'
import { registerRuntimeCaptureDomain, type TaoRuntimeJson } from './TR-runtime-capture'

type EvaluableValue<T> = Readonly<{ evaluate(): EvaluableValue<T>; jsValue: T }>

export type TaoPersistedStateType =
  | Readonly<{ cases: readonly string[]; declaration: string; kind: 'enum' }>
  | Readonly<{ kind: 'list'; element?: TaoPersistedStateType }>
  | Readonly<{ kind: 'primitive'; name: 'boolean' | 'duration' | 'none' | 'number' | 'text' | 'time' }>
  | Readonly<{
    kind: 'item'
    properties: Readonly<Record<string, Readonly<{ optional: boolean; type: TaoPersistedStateType }>>>
  }>
  | Readonly<{ kind: 'union'; members: readonly TaoPersistedStateType[] }>

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
const pendingRestore = new Map<string, unknown>()
const enumCases = new Map<string, Map<string, PersistedEnumCaseIdentity>>()
let storageOverride: TaoKeyValueStorage | undefined

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

/** RuntimePersistedState owns one device-local value independently of preference semantics. */
export class RuntimePersistedState<T> implements TaoWritableState<T> {
  readonly key: string
  readonly #default: T
  readonly #listeners = new Set<() => void>()
  #dirtyBeforeLoad = false
  #loaded = false
  #loading: Promise<void> | undefined
  #persistQueue: Promise<void> = Promise.resolve()
  readonly #type: TaoPersistedStateType
  #value: T
  #version = 0

  constructor(
    initial: EvaluableValue<T>,
    identity: TaoDeclarationIdentity,
    name: string,
    type: TaoPersistedStateType,
  ) {
    this.#default = initial.evaluate().jsValue
    if (!matchesPersistedType(this.#default, type)) {
      throw new Error(`Persisted state '${name}' default does not match its generated runtime type.`)
    }
    this.#value = this.#default
    this.#type = type
    this.key = `tao.persisted-state.v1:${identity.canonical}:${name}`
    const restored = pendingRestore.get(this.key)
    const decoded = restored === undefined ? { ok: false as const } : decodePersistedValue(restored, this.#type)
    if (decoded.ok) {
      this.#value = decoded.value as T
    }
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
    )
    if (overlay) {
      overlay.value = nextValue
      return
    }
    this.#commit(nextValue)
  }

  subscribe = (listener: () => void): () => void => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  snapshot = (): number => this.#version

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
      warnPersistence(`Could not load persisted state '${this.key}'.`, error)
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

  #commit(next: T): void {
    if (!matchesPersistedType(next, this.#type)) {
      throw new Error(`Persisted state '${this.key}' rejected a value that does not match its generated runtime type.`)
    }
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
      .catch(error => warnPersistence(`Could not save persisted state '${this.key}'.`, error))
  }

  #replace(next: T): void {
    this.#value = next
    this.#version += 1
    for (const listener of this.#listeners) {
      listener()
    }
  }
}

function decodeEnvelope(
  encoded: string,
  expectedType: TaoPersistedStateType,
): { ok: true; value: unknown } | { ok: false } {
  try {
    const envelope = JSON.parse(encoded) as Partial<PersistedEnvelope>
    if (
      envelope === null
      || typeof envelope !== 'object'
      || envelope.formatVersion !== 1
      || JSON.stringify(envelope.type) !== JSON.stringify(expectedType)
    ) {
      warnPersistence('Ignored persisted state whose version or runtime type no longer matches.', undefined)
      return { ok: false }
    }
    const decoded = decodePersistedValue(envelope.value, expectedType)
    if (!decoded.ok) {
      warnPersistence('Ignored persisted state whose value no longer matches its runtime type.', undefined)
    }
    return decoded
  } catch (error) {
    warnPersistence('Ignored corrupt persisted state.', error)
    return { ok: false }
  }
}

function matchesPersistedType(value: unknown, type: TaoPersistedStateType): boolean {
  if (type.kind === 'enum') {
    if (!isPlainRecord(value)) {
      return false
    }
    return value['declaration'] === type.declaration
      && typeof value['caseName'] === 'string'
      && type.cases.includes(value['caseName'])
      && typeof value['identity'] === 'symbol'
  }
  if (type.kind === 'primitive') {
    if (type.name === 'none') {
      return value === null
    }
    if (type.name === 'text') {
      return typeof value === 'string'
    }
    if (type.name === 'boolean') {
      return typeof value === 'boolean'
    }
    return typeof value === 'number' && Number.isFinite(value)
  }
  if (type.kind === 'list') {
    return Array.isArray(value)
      && (type.element === undefined || value.every(item => matchesPersistedType(item, type.element!)))
  }
  if (type.kind === 'union') {
    return type.members.some(member => matchesPersistedType(value, member))
  }
  if (!isPlainRecord(value)) {
    return false
  }
  return Object.keys(value).every(name => name in type.properties)
    && Object.entries(type.properties).every(([name, property]) =>
      (property.optional && !(name in value)) || (name in value && matchesPersistedType(value[name], property.type))
    )
}

function encodePersistedValue(value: unknown, type: TaoPersistedStateType): unknown {
  if (type.kind === 'enum') {
    if (!matchesPersistedType(value, type)) {
      throw new Error('Persisted enum value does not match its generated runtime type.')
    }
    return { caseName: (value as PersistedEnumCaseIdentity).caseName, declaration: type.declaration }
  }
  if (type.kind === 'list') {
    return type.element === undefined
      ? value
      : (value as unknown[]).map(item => encodePersistedValue(item, type.element!))
  }
  if (type.kind === 'union') {
    const member = type.members.find(candidate => matchesPersistedType(value, candidate))
    if (member === undefined) {
      throw new Error('Persisted union value does not match its generated runtime type.')
    }
    return encodePersistedValue(value, member)
  }
  if (type.kind === 'item') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([name, item]) => [
        name,
        encodePersistedValue(item, type.properties[name]!.type),
      ]),
    )
  }
  return value
}

function decodePersistedValue(
  value: unknown,
  type: TaoPersistedStateType,
): { ok: true; value: unknown } | { ok: false } {
  if (type.kind === 'enum') {
    if (
      !isPlainRecord(value)
      || value['declaration'] !== type.declaration
      || typeof value['caseName'] !== 'string'
      || !type.cases.includes(value['caseName'])
    ) {
      return { ok: false }
    }
    const restored = enumCases.get(type.declaration)?.get(value['caseName'])
    return restored === undefined ? { ok: false } : { ok: true, value: restored }
  }
  if (type.kind === 'primitive') {
    return matchesPersistedType(value, type) ? { ok: true, value } : { ok: false }
  }
  if (type.kind === 'list') {
    if (!Array.isArray(value)) {
      return { ok: false }
    }
    if (type.element === undefined) {
      return { ok: true, value }
    }
    const restored: unknown[] = []
    for (const item of value) {
      const decoded = decodePersistedValue(item, type.element)
      if (!decoded.ok) {
        return decoded
      }
      restored.push(decoded.value)
    }
    return { ok: true, value: restored }
  }
  if (type.kind === 'union') {
    for (const member of type.members) {
      const decoded = decodePersistedValue(value, member)
      if (decoded.ok) {
        return decoded
      }
    }
    return { ok: false }
  }
  if (!isPlainRecord(value) || Object.keys(value).some(name => !(name in type.properties))) {
    return { ok: false }
  }
  const restored: Record<string, unknown> = {}
  for (const [name, property] of Object.entries(type.properties)) {
    if (!(name in value)) {
      if (property.optional) {
        continue
      }
      return { ok: false }
    }
    const decoded = decodePersistedValue(value[name], property.type)
    if (!decoded.ok) {
      return decoded
    }
    restored[name] = decoded.value
  }
  return { ok: true, value: restored }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function warnPersistence(message: string, error: unknown): void {
  if (typeof process === 'undefined' || process.env.NODE_ENV === 'production') {
    return
  }
  console.warn(message, error ?? '')
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

export function restorePersistedState(captured: Readonly<Record<string, unknown>>): void {
  for (const [key, capturedValue] of Object.entries(captured)) {
    pendingRestore.set(key, capturedValue)
    states.get(key)?.restore(capturedValue)
  }
}

/** setPersistedStateStorageForTests replaces only this device-local state domain. */
export function setPersistedStateStorageForTests(next: TaoKeyValueStorage | undefined): () => void {
  const previous = storageOverride
  storageOverride = next
  return () => {
    storageOverride = previous
  }
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
  restore: value => restorePersistedState(value as Readonly<Record<string, unknown>>),
  version: 1,
})
