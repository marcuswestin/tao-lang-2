import React from 'react'
import { existingTransactionResource, transactionResource } from './TR-action-transactions'
import type { TaoActionValue } from './TR-action-values'
import { RuntimeAssert } from './TR-assert'
import { DataControls } from './TR-data'
import { isPersistedEnumCase } from './TR-persisted-state'
import { isReactiveValue } from './TR-reactive'

/** TaoRuntimeValue is the evaluable value shape generated Tao code exchanges at runtime. */
export type TaoRuntimeValue<ValueT> = Readonly<{
  evaluate(): TaoRuntimeValue<ValueT>
  jsValue: ValueT
}>

/** TaoWritable exposes a value read plus the capability to change its owning storage. */
export type TaoWritable<ValueT> =
  & TaoRuntimeValue<ValueT>
  & Readonly<{
    at(path: readonly string[]): TaoWritable<unknown>
    set(value: TaoRuntimeValue<ValueT>): void | Promise<void>
  }>

type TaoJoinedActionValue<Args extends any[] = any[]> =
  & TaoActionValue<Args>
  & Readonly<{
    invokeJoined(...args: Args): void | Promise<void>
  }>

export function isWritable<ValueT>(value: TaoRuntimeValue<ValueT>): value is TaoWritable<ValueT> {
  return 'set' in value && typeof (value as TaoWritable<ValueT>).set === 'function'
}

class Value<ValueT> implements TaoRuntimeValue<ValueT> {
  constructor(readonly jsValue: ValueT) {}

  evaluate(): TaoRuntimeValue<ValueT> {
    return this
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
  ) {}

  evaluate(): TaoRuntimeValue<ValueT> {
    const overlay = existingTransactionResource<{ value: ValueT }>(this)
    return reactiveValue(overlay === undefined ? this.current : overlay.value)
  }

  get jsValue(): ValueT {
    return this.evaluate().jsValue
  }

  set(value: TaoRuntimeValue<ValueT>): void | Promise<void> {
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
    private readonly root: Pick<TaoWritable<unknown>, 'evaluate' | 'set'>,
    private readonly path: readonly string[],
  ) {}

  evaluate(): TaoRuntimeValue<unknown> {
    let value: unknown = this.root.evaluate().jsValue
    for (const segment of this.path) {
      value = value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[segment] : undefined
    }
    return reactiveValue(value === undefined ? null : value)
  }

  get jsValue(): unknown {
    return this.evaluate().jsValue
  }

  set(value: TaoRuntimeValue<unknown>): void | Promise<void> {
    RuntimeAssert.input(this.path.length > 0, 'A writable field path must name a field.')
    const root = this.root.evaluate().jsValue
    if (isReactiveValue(root) && root.writeMember) {
      return root.writeMember(this.path, value.evaluate().jsValue)
    }
    return this.root.set(reactiveValue(replacePath(root, this.path, value.evaluate().jsValue)))
  }

  at(path: readonly string[]): TaoWritable<unknown> {
    return new PathLens(this.root, [...this.path, ...path])
  }
}

/** writablePath creates a field lens over any transaction-aware writable owner. */
export function writablePath(
  root: Pick<TaoWritable<unknown>, 'evaluate' | 'set'>,
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
export function createWritableCell<ValueT>(initial: TaoRuntimeValue<ValueT>): TaoWritable<ValueT> {
  return new ReactiveCell(initial.evaluate().jsValue)
}

/** mappedWritable adapts a live read and a Tao action-backed update into one writable lens. */
export function mappedWritable<ValueT>(
  read: () => TaoRuntimeValue<ValueT>,
  change: TaoJoinedActionValue<[TaoRuntimeValue<ValueT>]>,
): TaoWritable<ValueT> {
  return new MappedWritable(read, change)
}

class MappedWritable<ValueT> implements TaoWritable<ValueT> {
  constructor(
    private readonly read: () => TaoRuntimeValue<ValueT>,
    private readonly change: TaoJoinedActionValue<[TaoRuntimeValue<ValueT>]>,
  ) {}

  evaluate(): TaoRuntimeValue<ValueT> {
    return this.read().evaluate()
  }

  get jsValue(): ValueT {
    return this.evaluate().jsValue
  }

  set(value: TaoRuntimeValue<ValueT>): void | Promise<void> {
    // `invokeJoined` is TR.Do's transaction-preserving payload operation. A mapping is a caller
    // capability, not storage of its own, so its write must join the enclosing Tao action.
    return this.change.invokeJoined(value)
  }

  at(path: readonly string[]): TaoWritable<unknown> {
    return new PathLens(this as unknown as TaoWritable<unknown>, path)
  }
}

/** useParameterCell creates storage for one mounted occurrence and never reinitializes it on rerender. */
export function useParameterCell<ValueT>(
  initial: TaoRuntimeValue<ValueT>,
  options: Readonly<{ copy?: boolean }> = {},
): TaoWritable<ValueT> {
  const initialRef = React.useRef<TaoRuntimeValue<ValueT> | undefined>(undefined)
  initialRef.current ??= options.copy ? reactiveValue(copyValue(initial.evaluate().jsValue)) : initial.evaluate()
  const [, publish] = React.useReducer((revision: number) => revision + 1, 0)
  const cell = React.useRef<TaoWritable<ValueT> | undefined>(undefined)
  cell.current ??= new ReactiveCell(initialRef.current.jsValue, () => publish())
  return options.copy || !isWritable(initial) ? cell.current! : initial
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
  set(value: ValueT | TaoRuntimeValue<ValueT>): void | Promise<void>
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

  set(value: ValueT | TaoRuntimeValue<ValueT>): void | Promise<void> {
    RuntimeAssert.input(this.#active, 'A native control tried to update a value after it unmounted.')
    const wrapped = isRuntimeValue<ValueT>(value) ? value : reactiveValue(value)
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

function isRuntimeValue<ValueT>(value: ValueT | TaoRuntimeValue<ValueT>): value is TaoRuntimeValue<ValueT> {
  return typeof value === 'object' && value !== null && 'evaluate' in value && 'jsValue' in value
}
