import { actionOwner, deferTransactionCommit, registerActionCleanup } from './TR-action-transactions'
import { RuntimeAssert } from './TR-assert'
import { reportUnownedFailure } from './TR-errors'
import { invokeNativeAction, type NativeActionInput } from './TR-native-action'

/** Admit native call callbacks now, then run their owned actions only after caller commit. */
export function nativeCallCallbacks() {
  const owner = actionOwner()
  RuntimeAssert.input(owner?.active, 'Call native callbacks from an action belonging to a mounted view.')
  let admissionOpen = true
  let cancelled = false
  let pending = 0
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
  }
  owner.subscriptions.add(cancel)
  registerActionCleanup(cancel)

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
      // A savepoint can discard this dispatch even when the token predates the savepoint.
      registerActionCleanup(settle)
      try {
        deferTransactionCommit(() => {
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
        })
      } catch (error) {
        settle()
        reportUnownedFailure(error)
      }
    },
    finishCall(): void {
      admissionOpen = false
      clearIfSettled()
    },
    cancel,
  }
}
