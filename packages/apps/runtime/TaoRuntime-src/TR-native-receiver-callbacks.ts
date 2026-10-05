import { actionOwner, registerActionCleanup } from './TR-action-transactions'
import { RuntimeAssert } from './TR-assert'

type CallbackScope = { cancel(): void }
type ReceiverEntry = { cancel(): void }

const receivers = new WeakMap<object, Set<ReceiverEntry>>()

/** Receiver cleanup invalidates owned callback delivery without invoking a native side effect. */
export const nativeReceiverCallbacks = {
  attach(receiver: object, scope: CallbackScope): void {
    const owner = actionOwner()
    RuntimeAssert.input(owner?.active, 'Attach native callbacks from an action belonging to a mounted view.')
    let entries = receivers.get(receiver)
    if (!entries) {
      entries = new Set()
      receivers.set(receiver, entries)
    }
    const retained = entries
    let cancelled = false
    const entry: ReceiverEntry = {
      cancel() {
        if (cancelled) {
          return
        }
        cancelled = true
        retained.delete(entry)
        if (retained.size === 0) {
          receivers.delete(receiver)
        }
        owner.subscriptions.delete(entry.cancel)
        scope.cancel()
      },
    }
    retained.add(entry)
    owner.subscriptions.add(entry.cancel)
    registerActionCleanup(entry.cancel)
  },
  cancel(receiver: object): void {
    for (const entry of [...receivers.get(receiver) ?? []]) {
      entry.cancel()
    }
  },
}
