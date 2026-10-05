import TR from '@runtime/TR'
import { Deferred, Describe, Expect, settle, Test } from '@shared/test'
import { nativeAsyncCallbacks } from '../TaoRuntime-src/TR-native-async-callbacks'
import { nativeReceiverCallbacks } from '../TaoRuntime-src/TR-native-receiver-callbacks'
import { TaoActionOwner } from '../TaoRuntime-src/TR-native-subscription'

Describe('receiver-owned native callbacks', () => {
  Test('cancels queued and late structural callback delivery for a released native receiver', async () => {
    const owner = new TaoActionOwner()
    const receiver = {}
    const held = Deferred()
    const seen: string[] = []
    let scope!: ReturnType<typeof nativeAsyncCallbacks>
    const callback = {
      invoke() {
        seen.push('delivered')
      },
    }
    await TR.Action(() => {
      scope = nativeAsyncCallbacks()
      nativeReceiverCallbacks.attach(receiver, scope)
    }, { owner }).jsValue.invoke()
    const blocked = TR.Action(async () => await held.promise).jsValue.invoke()
    try {
      scope.invoke(callback)
      await Promise.resolve()
      nativeReceiverCallbacks.cancel(receiver)
      scope.invoke(callback)
    } finally {
      held.resolve()
    }
    await blocked
    await settle()
    Expect(seen).toEqual([])
    Expect(owner.active).toBe(true)
    Expect(scope.active).toBe(false)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('cancels queued callbacks for one receiver without changing native resources or other receivers', async () => {
    const owner = new TaoActionOwner()
    const first = {
      delete() {
        nativeDeletes += 1
      },
    }
    const second = {}
    let nativeDeletes = 0
    const seen: string[] = []
    let firstScope!: ReturnType<typeof nativeAsyncCallbacks>
    let secondScope!: ReturnType<typeof nativeAsyncCallbacks>
    await TR.Action(() => {
      firstScope = nativeAsyncCallbacks()
      secondScope = nativeAsyncCallbacks()
      nativeReceiverCallbacks.attach(first, firstScope)
      nativeReceiverCallbacks.attach(second, secondScope)
    }, { owner }).jsValue.invoke()
    const held = Deferred()
    const blocked = TR.Action(async () => await held.promise).jsValue.invoke()
    firstScope.invoke(TR.Action(() => seen.push('first')).jsValue)
    secondScope.invoke(TR.Action(() => seen.push('second')).jsValue)
    nativeReceiverCallbacks.cancel(first)
    nativeReceiverCallbacks.cancel(first)
    held.resolve()
    await blocked
    await settle()
    Expect(seen).toEqual(['second'])
    Expect(nativeDeletes).toBe(0)
    Expect(firstScope.active).toBe(false)
    Expect(secondScope.active).toBe(true)
    owner.dispose()
    Expect(secondScope.active).toBe(false)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('removes old ownership on unmount while allowing a new owner of the same native receiver', async () => {
    const receiver = {}
    const oldOwner = new TaoActionOwner()
    const newOwner = new TaoActionOwner()
    let oldScope!: ReturnType<typeof nativeAsyncCallbacks>
    let newScope!: ReturnType<typeof nativeAsyncCallbacks>
    await TR.Action(() => {
      oldScope = nativeAsyncCallbacks()
      nativeReceiverCallbacks.attach(receiver, oldScope)
    }, { owner: oldOwner }).jsValue.invoke()
    oldOwner.dispose()
    await TR.Action(() => {
      newScope = nativeAsyncCallbacks()
      nativeReceiverCallbacks.attach(receiver, newScope)
    }, { owner: newOwner }).jsValue.invoke()
    oldOwner.dispose()
    Expect(oldScope.active).toBe(false)
    Expect(newScope.active).toBe(true)
    nativeReceiverCallbacks.cancel(receiver)
    Expect(newScope.active).toBe(false)
    Expect(newOwner.subscriptions.size).toBe(0)
  })

  Test('registration rollback cancels receiver callbacks without cancelling native work', async () => {
    const receiver = {
      cancel() {
        nativeCancels += 1
      },
    }
    let nativeCancels = 0
    const owner = new TaoActionOwner()
    let scope!: ReturnType<typeof nativeAsyncCallbacks>
    const stop = TR.Errors.onFailure(() => {})
    try {
      await TR.Action(() => {
        scope = nativeAsyncCallbacks()
        nativeReceiverCallbacks.attach(receiver, scope)
        TR.Errors.failInput('Registration failed.')
      }, { owner }).jsValue.invoke()
    } finally {
      stop()
    }
    nativeReceiverCallbacks.cancel(receiver)
    Expect(scope.active).toBe(false)
    Expect(nativeCancels).toBe(0)
    Expect(owner.subscriptions.size).toBe(0)
  })
})
