import { actionOwner, registerActionCleanup } from './TR-action-transactions'
import { RuntimeAssert } from './TR-assert'
import { errorMessage, reportUnownedFailure } from './TR-errors'
import { nativeAsyncCallbacks } from './TR-native-async-callbacks'
import { createNativeReferenceType, type NativeReference } from './TR-native-references'
import type { TaoActionOwner } from './TR-native-subscription'

declare const nativePendingBrand: unique symbol

// Interface merging preserves the result family; operation state remains in its private map.
interface NativePendingPayload<T> {
  readonly [nativePendingBrand]: () => T
}

class NativePendingPayload<T> {}

type PendingState<T> = {
  outcome: { status: 'pending' } | { status: 'fulfilled'; value: T } | { status: 'rejected'; message: string }
  released: boolean
  observers: Set<{ notify(): void; remove(): void }>
  progressScope?: { finishCall(): void; cancel(): void }
}

/** Named contract keeps the private payload nominal across declaration emission. */
type NativePendingValue<T> = NativeReference<NativePendingPayload<T>>
export type NativePendingType<T> = {
  start(starter: () => PromiseLike<T>, progressScope?: { finishCall(): void; cancel(): void }): NativePendingValue<T>
  is(value: unknown): value is NativePendingValue<T>
  status(handle: unknown): 'pending' | 'fulfilled' | 'rejected'
  read(handle: unknown): T
  error(handle: unknown): string | null
  release(handle: unknown): void
  observe(
    handle: unknown,
    action: { invokeOwned(owner: TaoActionOwner, active: () => boolean): void | Promise<void> },
  ): { remove(): void }
}

/** Each native operation owns its pending handles; starting never awaits external settlement. */
export function createNativePendingType<T>(name: string): NativePendingType<T> {
  const states = new WeakMap<NativePendingPayload<T>, PendingState<T>>()
  const references = createNativeReferenceType(
    name,
    (value): value is NativePendingPayload<T> => value instanceof NativePendingPayload && states.has(value),
  )
  const stateOf = (handle: unknown) => states.get(references.unwrap(handle))!

  function settle(state: PendingState<T>, outcome: PendingState<T>['outcome']): void {
    state.outcome = outcome
    try {
      state.progressScope?.finishCall()
    } catch (error) {
      reportUnownedFailure(error)
    }
    state.progressScope = undefined
    for (const observer of [...state.observers]) {
      observer.notify()
    }
  }

  return {
    start(starter: () => PromiseLike<T>, progressScope?: { finishCall(): void; cancel(): void }) {
      // Keep a synchronous starter throw at the caller's existing foreign-action boundary.
      const promise = starter()
      const payload = new NativePendingPayload<T>()
      const state: PendingState<T> = {
        outcome: { status: 'pending' },
        released: false,
        observers: new Set(),
        progressScope,
      }
      states.set(payload, state)
      const handle = references.wrap(payload)
      // Handlers remain attached even when a handle or its registering view is released.
      void Promise.resolve(promise).then(
        value => settle(state, { status: 'fulfilled', value }),
        error => settle(state, { status: 'rejected', message: errorMessage(error) }),
      ).catch(reportUnownedFailure)
      return handle
    },
    is: references.is,
    status(handle: unknown): 'pending' | 'fulfilled' | 'rejected' {
      return stateOf(handle).outcome.status
    },
    read(handle: unknown): T {
      const outcome = stateOf(handle).outcome
      RuntimeAssert.input(outcome.status === 'fulfilled', `The ${name} native operation has not fulfilled.`)
      return outcome.value
    },
    error(handle: unknown): string | null {
      const outcome = stateOf(handle).outcome
      return outcome.status === 'rejected' ? outcome.message : null
    },
    release(handle: unknown): void {
      if (!references.is(handle)) {
        // Preserve the reference descriptor's idempotent release and wrong-handle checks.
        references.release(handle)
        return
      }
      const state = stateOf(handle)
      state.released = true
      for (const observer of [...state.observers]) {
        observer.remove()
      }
      try {
        state.progressScope?.cancel()
      } catch (error) {
        reportUnownedFailure(error)
      }
      state.progressScope = undefined
      references.release(handle)
    },
    observe(
      handle: unknown,
      action: { invokeOwned(owner: TaoActionOwner, active: () => boolean): void | Promise<void> },
    ): { remove(): void } {
      const state = stateOf(handle)
      const scope = nativeAsyncCallbacks()
      const owner = actionOwner()!
      let notified = false
      let removed = false
      const remove = () => {
        if (removed) {
          return
        }
        removed = true
        state.observers.delete(observer)
        owner.subscriptions.delete(remove)
        scope.cancel()
      }
      const observer = {
        remove,
        notify() {
          if (notified || removed || state.released) {
            return
          }
          notified = true
          scope.invoke({
            invokeOwned(callbackOwner, active) {
              try {
                const result = action.invokeOwned(callbackOwner, active)
                if (result === undefined) {
                  remove()
                  return
                }
                return Promise.resolve(result).finally(remove)
              } catch (error) {
                remove()
                throw error
              }
            },
          })
          scope.finishCall()
        },
      }
      state.observers.add(observer)
      owner.subscriptions.add(remove)
      registerActionCleanup(remove)
      if (state.outcome.status !== 'pending') {
        observer.notify()
      }
      return { remove }
    },
  }
}
