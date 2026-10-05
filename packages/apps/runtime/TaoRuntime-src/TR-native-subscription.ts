import React from 'react'
import { ActionBoundaryContext, type MountedActionBoundary, type TaoActionFailureSink } from './TR-action-boundary'
import { actionOwner, registerActionCleanup } from './TR-action-transactions'
import { RuntimeAssert } from './TR-assert'
import { reportUnownedFailure } from './TR-errors'

/** One mounted view owns its explicitly registered native subscriptions. */
export class TaoActionOwner {
  active = true
  boundary: MountedActionBoundary | undefined
  private generation = 0
  readonly subscriptions = new Set<() => void>()

  captureFailureSink(): TaoActionFailureSink | undefined {
    const sink = this.active ? this.boundary?.capture() : undefined
    if (!sink) {
      return undefined
    }
    const generation = this.generation
    return failure => this.active && this.generation === generation && sink(failure)
  }

  dispose(): void {
    this.active = false
    this.generation += 1
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
  const boundary = React.useContext(ActionBoundaryContext)
  const owner = React.useRef<TaoActionOwner | undefined>(undefined)
  owner.current ??= new TaoActionOwner()
  const current = owner.current
  React.useInsertionEffect(() => {
    current.boundary = boundary
  }, [current, boundary])
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
      action: { invokeOwned(owner: TaoActionOwner, active: () => boolean, ...args: Args): void | Promise<void> },
      ...args: Args
    ): void {
      if (!removed && owner.active) {
        void action.invokeOwned(owner, () => !removed && owner.active, ...args)
      }
    },
    remove,
  }
}
