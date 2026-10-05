import React from 'react'
import { existingTransactionResource, transactionResource } from './TR-action-transactions'
import type { TaoActionValue, TaoEvaluable } from './TR-action-values'
import { RuntimeAssert } from './TR-assert'
import { DataControls } from './TR-data'
import { getJSValue, type TaoJSValue } from './TR-js-value'
import { isCompletePersistedValue, isPersistedEnumCase } from './TR-persisted-state'
import { isReactiveValue } from './TR-reactive'
import { readAvailability, withReadAvailability } from './TR-read-availability'

/** TaoRuntimeValueInput preserves the minimal value contract accepted before native accessors. */
export type TaoRuntimeValueInput<ValueT> = Readonly<{
  evaluate(): TaoRuntimeValueInput<ValueT>
  jsValue: ValueT
}>

/** TaoRuntimeValue is the complete value produced by runtime factories. */
export type TaoRuntimeValue<ValueT> = Readonly<{
  evaluate(): TaoRuntimeValue<ValueT>
  getJSValue(): TaoJSValue<ValueT>
  jsValue: ValueT
}>

const registeredCompleteValues = new WeakSet<object>()
const registeredRuntimeValues = new WeakSet<object>()
const preservedStorageValues = new WeakSet<object>()

/** Behavior carriers keep their selected witnesses when placed in mutable item storage. */
export function registerPreservedStorageValue(value: TaoRuntimeValue<unknown>): void {
  preservedStorageValues.add(value)
}

/** Only explicitly registered carriers survive storage; ordinary values retain raw backing. */
export function runtimeStorageValue<ValueT>(
  source: TaoRuntimeValueInput<ValueT>,
): ValueT | TaoRuntimeValueInput<ValueT> {
  const value = source.evaluate()
  return preservedStorageValues.has(value) ? value : value.jsValue
}

/** Runtime-owned evaluables may be categorized without promising the complete output protocol. */
export function registerRuntimeValue(value: TaoEvaluable<unknown>): void {
  registeredRuntimeValues.add(value)
}

/** Runtime-owned facade constructors register complete outputs without inspecting their reads. */
export function registerCompleteRuntimeValue<ValueT>(value: TaoRuntimeValue<ValueT>): void {
  registeredCompleteValues.add(value)
  registeredRuntimeValues.add(value)
}

/** Native result categorization uses owned identity, never user fields or prototype membership. */
export function isRuntimeValue(candidate: unknown): candidate is TaoEvaluable<unknown> {
  return candidate !== null && (typeof candidate === 'object' || typeof candidate === 'function')
    && (registeredRuntimeValues.has(candidate) || isCompletePersistedValue(candidate))
}

/** TaoWritableInput preserves narrow read/write capabilities without requiring output methods. */
export type TaoWritableInput<ValueT> =
  & TaoEvaluable<ValueT>
  & Readonly<{ set(value: TaoRuntimeValueInput<ValueT>): void | Promise<void> }>

/** TaoWritable exposes a value read plus the capability to change its owning storage. */
export type TaoWritable<ValueT> =
  & TaoRuntimeValue<ValueT>
  & Readonly<{
    at(path: readonly string[]): TaoWritable<unknown>
    set(value: TaoRuntimeValueInput<ValueT>): void | Promise<void>
  }>

type TaoJoinedActionValue<Args extends any[] = any[]> =
  & TaoActionValue<Args>
  & Readonly<{
    invokeJoined(...args: Args): void | Promise<void>
  }>

export function isWritable<ValueT>(
  value: TaoEvaluable<ValueT>,
): value is TaoWritableInput<ValueT> {
  return 'set' in value && typeof (value as TaoWritableInput<ValueT>).set === 'function'
}

class Value<ValueT> implements TaoRuntimeValue<ValueT> {
  constructor(readonly jsValue: ValueT) {
    registerCompleteRuntimeValue(this)
  }

  evaluate(): TaoRuntimeValue<ValueT> {
    return this
  }

  getJSValue(): TaoJSValue<ValueT> {
    return getJSValue(this)
  }
}

/** reactiveValue creates a runtime wrapper without exposing its implementation class. */
export function reactiveValue<ValueT>(value: ValueT): TaoRuntimeValue<ValueT> {
  return new Value(value)
}

/** ReactiveCell owns a transaction-aware mutable value, optionally publishing commits to React. */
class ReactiveCell<ValueT> implements TaoWritable<ValueT> {
  constructor(
    private current: ValueT,
    private readonly publish?: (value: ValueT) => void,
  ) {
    registerCompleteRuntimeValue(this)
  }

  evaluate(): TaoRuntimeValue<ValueT> {
    const overlay = existingTransactionResource<{ value: ValueT }>(this)
    return reactiveValue(overlay === undefined ? this.current : overlay.value)
  }

  get jsValue(): ValueT {
    return this.evaluate().jsValue
  }

  getJSValue(): TaoJSValue<ValueT> {
    return getJSValue(this)
  }

  set(value: TaoRuntimeValueInput<ValueT>): void | Promise<void> {
    const next = value.evaluate().jsValue
    const overlay = transactionResource(
      this,
      () => ({ previous: this.current, value: this.current }),
      committed => this.commit(committed.value),
      undefined,
      committed => this.commit(committed.previous),
      committed => [{
        kind: 'state' as const,
        target: 'parameter',
        committed: committed.previous,
        pending: committed.value,
      }],
    )
    if (overlay) {
      overlay.value = next
      return
    }
    this.commit(next)
  }

  at(path: readonly string[]): TaoWritable<unknown> {
    return new PathLens(this, path)
  }

  private commit(value: ValueT): void {
    this.current = value
    this.publish?.(value)
  }
}

class PathLens implements TaoWritable<unknown> {
  constructor(
    private readonly root: TaoWritableInput<unknown>,
    private readonly path: readonly string[],
  ) {
    registerCompleteRuntimeValue(this)
  }

  evaluate(): TaoRuntimeValue<unknown> {
    let value: unknown = this.root.evaluate().jsValue
    for (const segment of this.path) {
      value = value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[segment] : undefined
    }
    return isRuntimeValue(value)
      ? completeRuntimeValue(value).evaluate()
      : reactiveValue(value === undefined ? null : value)
  }

  get jsValue(): unknown {
    return this.evaluate().jsValue
  }

  getJSValue(): unknown {
    return getJSValue(this)
  }

  set(value: TaoRuntimeValueInput<unknown>): void | Promise<void> {
    RuntimeAssert.input(this.path.length > 0, 'A writable field path must name a field.')
    const root = this.root.evaluate().jsValue
    if (isReactiveValue(root) && root.writeMember) {
      return root.writeMember(this.path, runtimeStorageValue(value))
    }
    return this.root.set(reactiveValue(replacePath(root, this.path, runtimeStorageValue(value))))
  }

  at(path: readonly string[]): TaoWritable<unknown> {
    return new PathLens(this.root, [...this.path, ...path])
  }
}

/** writablePath creates a field lens over any transaction-aware writable owner. */
export function writablePath(
  root: TaoWritableInput<unknown>,
  path: readonly string[],
): TaoWritable<unknown> {
  return new PathLens(root, path)
}

function replacePath(root: unknown, path: readonly string[], replacement: unknown): unknown {
  const [head, ...tail] = path
  RuntimeAssert.input(head !== undefined, 'A writable field path must name a field.')
  RuntimeAssert.input(root !== null && typeof root === 'object', `Cannot update field '${head}' on a non-item value.`)
  const source = root as Record<string, unknown>
  const next: Record<string, unknown> = Array.isArray(root)
    ? [...root] as unknown as Record<string, unknown>
    : { ...source }
  next[head] = tail.length === 0 ? replacement : replacePath(source[head], tail, replacement)
  return next
}

/** createWritableCell creates detached mutable storage for one action invocation or test. */
export function createWritableCell<ValueT>(initial: TaoRuntimeValueInput<ValueT>): TaoWritable<ValueT> {
  return new ReactiveCell(initial.evaluate().jsValue)
}

/** mappedWritable adapts a live read and a Tao action-backed update into one writable lens. */
export function mappedWritable<ValueT>(
  read: () => TaoRuntimeValueInput<ValueT>,
  change: TaoJoinedActionValue<[TaoRuntimeValue<ValueT>]>,
): TaoWritable<ValueT> {
  return new MappedWritable(read, change)
}

class MappedWritable<ValueT> implements TaoWritable<ValueT> {
  constructor(
    private readonly read: () => TaoRuntimeValueInput<ValueT>,
    private readonly change: TaoJoinedActionValue<[TaoRuntimeValue<ValueT>]>,
  ) {
    registerCompleteRuntimeValue(this)
  }

  evaluate(): TaoRuntimeValue<ValueT> {
    return completeRuntimeValue(this.read()).evaluate()
  }

  get jsValue(): ValueT {
    return this.evaluate().jsValue
  }

  getJSValue(): TaoJSValue<ValueT> {
    return getJSValue(this)
  }

  set(value: TaoRuntimeValueInput<ValueT>): void | Promise<void> {
    // `invokeJoined` is TR.Do's transaction-preserving payload operation. A mapping is a caller
    // capability, not storage of its own, so its write must join the enclosing Tao action.
    return this.change.invokeJoined(new ForwardedValue(value))
  }

  at(path: readonly string[]): TaoWritable<unknown> {
    return new PathLens(this as unknown as TaoWritable<unknown>, path)
  }
}

/** ForwardedValue adds output methods while preserving an input's current read semantics. */
class ForwardedValue<ValueT> implements TaoRuntimeValue<ValueT> {
  constructor(
    private readonly source: TaoEvaluable<ValueT>,
    private readonly validateSnapshot?: (snapshot: unknown) => void,
  ) {
    registerCompleteRuntimeValue(this)
  }

  evaluate(): TaoRuntimeValue<ValueT> {
    const evaluated = this.source.evaluate()
    this.validateSnapshot?.(evaluated)
    const completed = isKnownCompleteRuntimeValue(evaluated)
      ? evaluated as TaoRuntimeValue<ValueT>
      : new EvaluatedValue(evaluated)
    const availability = readAvailability(evaluated)
    return availability ? withReadAvailability(completed, availability) : completed
  }

  get jsValue(): ValueT {
    return this.evaluate().jsValue
  }

  getJSValue(): TaoJSValue<ValueT> {
    return getJSValue(this)
  }
}

/** EvaluatedValue retains one evaluated wrapper without reading its payload during completion. */
class EvaluatedValue<ValueT> implements TaoRuntimeValue<ValueT> {
  constructor(private readonly source: Readonly<{ jsValue: ValueT }>) {
    registerCompleteRuntimeValue(this)
  }

  evaluate(): TaoRuntimeValue<ValueT> {
    return this
  }

  get jsValue(): ValueT {
    return this.source.jsValue
  }

  getJSValue(): TaoJSValue<ValueT> {
    return getJSValue(this)
  }
}

/** completeRuntimeValue adds output methods without eagerly reading a legacy callable result. */
export function completeRuntimeValue<ValueT>(
  value: TaoEvaluable<ValueT>,
  validateSnapshot?: (snapshot: unknown) => void,
): TaoRuntimeValue<ValueT> {
  return isKnownCompleteRuntimeValue(value)
    ? value as TaoRuntimeValue<ValueT>
    : new ForwardedValue(value, validateSnapshot)
}

/** Only registered runtime outputs guarantee complete evaluations; prototypes convey no authority. */
function isKnownCompleteRuntimeValue(value: object): boolean {
  return registeredCompleteValues.has(value)
    || isCompletePersistedValue(value)
}

/** ForwardedWritable retains a legacy owner's storage while completing its produced value API. */
class ForwardedWritable<ValueT> implements TaoWritable<ValueT> {
  constructor(private readonly root: TaoWritableInput<ValueT>) {
    registerCompleteRuntimeValue(this)
  }

  evaluate(): TaoRuntimeValue<ValueT> {
    return completeRuntimeValue(this.root).evaluate()
  }

  get jsValue(): ValueT {
    return this.evaluate().jsValue
  }

  getJSValue(): TaoJSValue<ValueT> {
    return getJSValue(this)
  }

  set(value: TaoRuntimeValueInput<ValueT>): void | Promise<void> {
    return this.root.set(value)
  }

  at(path: readonly string[]): TaoWritable<unknown> {
    return new PathLens(this.root, path)
  }
}

/** useParameterCell creates storage for one mounted occurrence and never reinitializes it on rerender. */
export function useParameterCell<ValueT>(
  initial: TaoEvaluable<ValueT>,
  options: Readonly<{ copy?: boolean }> = {},
): TaoWritable<ValueT> {
  const initialRef = React.useRef<TaoRuntimeValue<ValueT> | undefined>(undefined)
  initialRef.current ??= reactiveValue(
    options.copy ? copyValue(initial.evaluate().jsValue) : initial.evaluate().jsValue,
  )
  const [, publish] = React.useReducer((revision: number) => revision + 1, 0)
  const cell = React.useRef<TaoWritable<ValueT> | undefined>(undefined)
  cell.current ??= new ReactiveCell(initialRef.current.jsValue, () => publish())
  return options.copy || !isWritable(initial) ? cell.current! : new ForwardedWritable(initial)
}

/** copyValue makes storage-owning copies of ordinary structures while retaining entity identity. */
export function copyValue<ValueT>(value: ValueT, fields?: readonly string[]): ValueT {
  if (fields) {
    RuntimeAssert.input(
      value !== null && typeof value === 'object',
      'A field projection needs an item or entity value.',
    )
    const projected: Record<string, unknown> = {}
    for (const field of fields) {
      const fieldValue = DataControls.IsEntityHandle(value)
        ? DataControls.Read(value, field)
        : (value as Record<string, unknown>)[field]
      projected[field] = copy(fieldValue, new Map())
    }
    return projected as ValueT
  }
  return copy(value, new Map())
}

function copy<ValueT>(value: ValueT, seen: Map<object, unknown>): ValueT {
  if (value === null || typeof value !== 'object' || DataControls.IsEntityHandle(value)) {
    return value
  }
  const known = seen.get(value)
  if (known !== undefined) {
    return known as ValueT
  }
  if (Array.isArray(value)) {
    const next: unknown[] = []
    seen.set(value, next)
    next.push(...value.map(entry => copy(entry, seen)))
    return next as ValueT
  }
  if (isOpaqueRuntimeValue(value)) {
    return value
  }
  const next: Record<string, unknown> = {}
  seen.set(value, next)
  for (const [key, entry] of Object.entries(value)) {
    next[key] = copy(entry, seen)
  }
  return next as ValueT
}

/** Opaque runtime values carry behavior or a canonical identity; ordinary item records stay copyable. */
function isOpaqueRuntimeValue(value: object): boolean {
  if (isPersistedEnumCase(value)) {
    return true
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return true
  }
  const candidate = value as Partial<{ evaluate(): unknown; invoke(...args: unknown[]): unknown }>
  return typeof candidate.evaluate === 'function' || typeof candidate.invoke === 'function'
}

/** NativeMutationLease prevents callbacks retained by an unmounted native control from publishing. */
export type NativeMutationLease<ValueT> = Readonly<{
  revoke(): void
  set(value: ValueT | TaoRuntimeValueInput<ValueT>): void | Promise<void>
}>

/** NativeMutationLeaseCandidate stays inert until the render that produced it commits. */
export type NativeMutationLeaseCandidate<ValueT> = Readonly<{
  lease: NativeMutationLease<ValueT>
  commit(previous: NativeMutationLeaseCandidate<ValueT> | undefined): void
  revoke(): void
}>

class ActiveNativeMutationLease<ValueT> implements NativeMutationLease<ValueT> {
  #active: boolean

  constructor(
    private readonly action: { current: TaoActionValue<[TaoRuntimeValue<ValueT>]> },
    active = true,
  ) {
    this.#active = active
  }

  revoke(): void {
    this.#active = false
  }

  activate(): void {
    this.#active = true
  }

  set(value: ValueT | TaoRuntimeValueInput<ValueT>): void | Promise<void> {
    RuntimeAssert.input(this.#active, 'A native control tried to update a value after it unmounted.')
    const wrapped = isRuntimeValueInput<ValueT>(value) ? new ForwardedValue(value) : reactiveValue(value)
    return this.action.current.invoke(wrapped)
  }
}

class RenderNativeMutationLeaseCandidate<ValueT> implements NativeMutationLeaseCandidate<ValueT> {
  readonly #lease: ActiveNativeMutationLease<ValueT>

  constructor(action: TaoActionValue<[TaoRuntimeValue<ValueT>]>) {
    this.#lease = new ActiveNativeMutationLease({ current: action }, false)
  }

  get lease(): NativeMutationLease<ValueT> {
    return this.#lease
  }

  commit(previous: NativeMutationLeaseCandidate<ValueT> | undefined): void {
    previous?.revoke()
    this.#lease.activate()
  }

  revoke(): void {
    this.#lease.revoke()
  }
}

/** nativeMutationLeaseCandidate creates the inert callback a foreign view receives during render. */
export function nativeMutationLeaseCandidate<ValueT>(
  action: TaoActionValue<[TaoRuntimeValue<ValueT>]>,
): NativeMutationLeaseCandidate<ValueT> {
  return new RenderNativeMutationLeaseCandidate(action)
}

/** nativeMutationLease makes one lease for a native view implementation. */
export function nativeMutationLease<ValueT>(
  action: TaoActionValue<[TaoRuntimeValue<ValueT>]>,
): NativeMutationLease<ValueT> {
  return new ActiveNativeMutationLease({ current: action })
}

/**
 * useNativeMutationLease gives a foreign receiver an event callback after its render commits.
 * Calls from render or layout-effect initialization intentionally fail; native controls should
 * report interaction through their event callbacks or passive effects.
 */
export function useNativeMutationLease<ValueT>(
  action: TaoActionValue<[TaoRuntimeValue<ValueT>]>,
): NativeMutationLease<ValueT> {
  // This candidate intentionally changes on every render. The current foreign implementation sees
  // only an inert callback until that render commits; a discarded concurrent render cannot poison
  // the callback belonging to the previous committed occurrence.
  const candidate = nativeMutationLeaseCandidate(action)
  const committed = React.useRef<NativeMutationLeaseCandidate<ValueT> | undefined>(undefined)
  React.useLayoutEffect(() => {
    candidate.commit(committed.current)
    committed.current = candidate
    return () => {
      candidate.revoke()
      if (committed.current === candidate) {
        committed.current = undefined
      }
    }
  }, [candidate])
  return candidate.lease
}

function isRuntimeValueInput<ValueT>(
  value: ValueT | TaoRuntimeValueInput<ValueT>,
): value is TaoRuntimeValueInput<ValueT> {
  return typeof value === 'object' && value !== null && 'evaluate' in value && 'jsValue' in value
}
