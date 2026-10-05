import React from 'react'
import { actionOwner, registerActionCleanup } from './TR-action-transactions'
import { RuntimeAssert } from './TR-assert'
import { reportUnownedFailure } from './TR-errors'
import { invokeNativeAction, type NativeActionInput } from './TR-native-action'

/** One mounted view owns its explicitly registered native subscriptions. */
export class TaoActionOwner {
  active = true
  readonly subscriptions = new Set<() => void>()

  dispose(): void {
    this.active = false
    for (const remove of [...this.subscriptions]) {
      try {
        remove()
      } catch (error) {
        reportUnownedFailure(error)
      }
    }
  }
}

/** The hook keeps ownership stable through renders and removes listeners at unmount. */
export function useActionOwner(): TaoActionOwner {
  const owner = React.useRef<TaoActionOwner | undefined>(undefined)
  owner.current ??= new TaoActionOwner()
  const current = owner.current
  React.useEffect(() => {
    current.active = true
    return () => current.dispose()
  }, [current])
  return current
}

/** Capture ownership before calling a native registration API, including asynchronous ones. */
export function nativeSubscription() {
  const owner = actionOwner()
  RuntimeAssert.input(
    owner?.active,
    'Register native listeners from an action belonging to a mounted view.',
  )
  let removed = false
  let attached = false
  let dispose: (() => void) | undefined
  const remove = () => {
    if (removed) {
      return
    }
    removed = true
    owner.subscriptions.delete(remove)
    const cleanup = dispose
    dispose = undefined
    cleanup?.()
  }
  owner.subscriptions.add(remove)
  registerActionCleanup(remove)
  return {
    get active(): boolean {
      return !removed && owner.active
    },
    attach(cleanup: () => void): void {
      RuntimeAssert(!attached, 'a native subscription attaches its cleanup once')
      attached = true
      if (removed || !owner.active) {
        cleanup()
      } else {
        dispose = cleanup
      }
    },
    invoke<Args extends any[]>(
      action: NativeActionInput<Args>,
      ...args: Args
    ): void {
      if (!removed && owner.active) {
        void invokeNativeAction(action, owner, () => !removed && owner.active, ...args)
      }
    },
    remove,
  }
}
