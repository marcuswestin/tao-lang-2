import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { MountedActionBoundary } from '../TaoRuntime-src/TR-action-boundary'
import { actionFailurePublicMessage, TaoActionFailure } from '../TaoRuntime-src/TR-errors'
import { TaoActionOwner } from '../TaoRuntime-src/TR-native-subscription'

Describe('mounted action failure ownership', () => {
  Test(
    'keeps raw diagnostics private through composed exits and legacy captures while modeled primary messages survive',
    async () => {
      const boundary = new MountedActionBoundary()
      const unmount = boundary.mount()
      const owner = new TaoActionOwner()
      owner.boundary = boundary
      try {
        await TR.Action(() =>
          TR.ActionScope(() => {
            TR.Defer(() => {
              throw new TypeError('cleanup private')
            })
            throw new TypeError('primary private')
          }), { owner, name: 'Composed' }).jsValue.invoke()
        Expect(boundary.failure?.message).toBe('primary private')
        Expect(boundary.failure?.publicMessage).toBe("Couldn't finish 'Composed.' Nothing was changed.")
        const legacy = { ...boundary.failure!, publicMessage: undefined }
        Expect(actionFailurePublicMessage(legacy)).toBe("Couldn't finish 'Composed.' Nothing was changed.")
        boundary.recover()
        await TR.Action(() =>
          TR.ActionScope(() => {
            TR.Defer(() => {
              throw new TypeError('outer cleanup private')
            })
            return TR.ActionScope(() => {
              TR.Defer(() => {
                throw new TypeError('inner cleanup private')
              })
              throw new TaoActionFailure('InvalidInput', 'Authored safe sentence.')
            })
          }), { owner, name: 'Nested' }).jsValue.invoke()
        Expect(boundary.failure?.publicMessage).toBe('Authored safe sentence.')
      } finally {
        owner.dispose()
        unmount()
      }
    },
  )
  Test(
    'delivers after asynchronous cleanup and rollback, latches once, and retains the original occurrence',
    async () => {
      const first = new MountedActionBoundary()
      const second = new MountedActionBoundary()
      const unmountFirst = first.mount()
      const unmountSecond = second.mount()
      const owner = new TaoActionOwner()
      owner.boundary = first
      const state = TR.Cell(TR.Value('before'))
      const events: string[] = []
      const unsubscribe = first.subscribe(() => events.push(state.evaluate().jsValue))
      let release!: () => void
      const gate = new Promise<void>(resolve => {
        release = resolve
      })
      const unowned: unknown[] = []
      const stop = TR.Errors.onUnowned(error => unowned.push(error))
      try {
        const pending = TR.Action(() =>
          TR.ActionScope(async () => {
            const continuation = TR.ActionContinuation()
            TR.Defer(async () => {
              events.push('cleanup')
              await Promise.resolve()
            })
            state.set(TR.Value('during'))
            await gate
            TR.ResumeActionContinuation(continuation)
            throw new TaoActionFailure('InvalidInput', 'Use another title.')
          }), { owner }).jsValue.invoke()
        owner.boundary = second
        release()
        await pending
        Expect(events).toEqual(['cleanup', 'before'])
        Expect(first.failure?.message).toBe('Use another title.')
        Expect(second.failure).toBeUndefined()
        Expect(unowned).toEqual([])
        const stale = first.capture()!
        const failure = first.failure!
        first.recover()
        Expect(stale(failure)).toBe(false)
        Expect(first.failure).toBeUndefined()
      } finally {
        unsubscribe()
        stop()
        owner.dispose()
        unmountFirst()
        unmountSecond()
      }
    },
  )

  Test('rejects disposed and recovered generations even after the same owner or host reactivates', async () => {
    const boundary = new MountedActionBoundary()
    const unmount = boundary.mount()
    const owner = new TaoActionOwner()
    owner.boundary = boundary
    const old = owner.captureFailureSink()!
    unmount()
    const dispose = boundary.mount()
    const failure = {
      action: 'Save',
      arguments: [],
      case: 'InvalidInput',
      message: 'Bad title.',
      retryEligible: true,
      frames: [],
      timestamp: 1,
    }
    Expect(old(failure)).toBe(false)
    const current = owner.captureFailureSink()!
    owner.dispose()
    owner.active = true
    Expect(current(failure)).toBe(false)
    Expect(owner.captureFailureSink()!(failure)).toBe(true)
    boundary.recover()
    dispose()
    Expect(boundary.capture()).toBeUndefined()
  })

  Test('preserves receipts, handled outcomes, detached failures and declined or broken sinks', async () => {
    const boundary = new MountedActionBoundary()
    const unmount = boundary.mount()
    const owner = new TaoActionOwner()
    owner.boundary = boundary
    const unowned: unknown[] = []
    const stop = TR.Errors.onUnowned(error => unowned.push(error))
    const fail = () => {
      throw new TaoActionFailure('InvalidInput', 'Bad title.')
    }
    try {
      const action = TR.Action(fail, { owner })
      Expect((await action.jsValue.invokeReceipt()).outcome).toBe('failed')
      Expect(boundary.failure).toBeUndefined()
      await TR.Action(async () => {
        await TR.WhenDo(() => TR.Do(action), { declared: [], name: 'Save' }, [['otherwise', () => {}]])
      }, { owner }).jsValue.invoke()
      Expect(boundary.failure).toBeUndefined()
      await TR.Action(() => {
        TR.Async(async () => fail())
      }, { owner }).jsValue.invoke()
      await TR.Action(() => {}).jsValue.invoke()
      Expect(boundary.failure).toBeUndefined()
      Expect(unowned).toHaveLength(1)
      unmount()
      await action.jsValue.invoke()
      Expect(unowned).toHaveLength(2)
      owner.captureFailureSink = () => () => {
        throw new TaoActionFailure('Unexpected', 'Delivery broke.')
      }
      await action.jsValue.invoke()
      Expect(unowned).toHaveLength(4)
    } finally {
      stop()
      owner.dispose()
      unmount()
    }
  })
})
