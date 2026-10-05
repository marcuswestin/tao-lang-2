import { actionOwner, deferTransactionCommit, registerActionCleanup } from './TR-action-transactions'
import { RuntimeAssert } from './TR-assert'
import { reportUnownedFailure } from './TR-errors'
import { invokeNativeAction, type NativeActionInput } from './TR-native-action'

/** Async native events wait for registration commit, independently of later ambient transactions. */
export function nativeAsyncCallbacks() {
  const owner = actionOwner()
  RuntimeAssert.input(owner?.active, 'Register native callbacks from an action belonging to a mounted view.')
  let ready = false
  let admissionOpen = true
  let cancelled = false
  let pending = 0
  const buffered: Array<{ dispatch(): void; settle(): void }> = []
  const executionActive = () => !cancelled && owner.active
  const clearIfSettled = () => {
    if (!admissionOpen && pending === 0) {
      owner.subscriptions.delete(cancel)
    }
  }
  const cancel = () => {
    cancelled = true
    admissionOpen = false
    owner.subscriptions.delete(cancel)
    for (const callback of buffered.splice(0)) {
      callback.settle()
    }
  }
  const schedule = (callback: { dispatch(): void; settle(): void }) => {
    // Yield synchronous roots before starting an owned root; do not borrow their commit/rollback.
    try {
      queueMicrotask(callback.dispatch)
    } catch (error) {
      callback.settle()
      reportUnownedFailure(error)
    }
  }
  owner.subscriptions.add(cancel)
  registerActionCleanup(cancel)
  deferTransactionCommit(() => {
    if (!executionActive()) {
      return
    }
    ready = true
    for (const callback of buffered.splice(0)) {
      schedule(callback)
    }
  })

  return {
    get active(): boolean {
      return admissionOpen && executionActive()
    },
    invoke<Args extends unknown[]>(
      action: NativeActionInput<Args>,
      ...args: Args
    ): void {
      if (!admissionOpen || !executionActive()) {
        return
      }
      pending += 1
      let settled = false
      const settle = () => {
        if (settled) {
          return
        }
        settled = true
        pending -= 1
        clearIfSettled()
      }
      const dispatch = () => {
        if (!executionActive()) {
          settle()
          return
        }
        try {
          const result = invokeNativeAction(action, owner, executionActive, ...args)
          if (result === undefined) {
            settle()
          } else {
            void Promise.resolve(result).then(settle, error => {
              settle()
              reportUnownedFailure(error)
            })
          }
        } catch (error) {
          settle()
          reportUnownedFailure(error)
        }
      }
      const callback = { dispatch, settle }
      if (ready) {
        schedule(callback)
      } else {
        buffered.push(callback)
      }
    },
    finishCall(): void {
      admissionOpen = false
      clearIfSettled()
    },
    cancel,
  }
}
