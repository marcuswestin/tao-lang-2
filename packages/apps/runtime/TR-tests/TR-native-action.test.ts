import TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import { actionOwner } from '../TaoRuntime-src/TR-action-transactions'
import { invokeNativeAction } from '../TaoRuntime-src/TR-native-action'
import { TaoActionOwner } from '../TaoRuntime-src/TR-native-subscription'

Describe('native structural action ownership', () => {
  Test('invokes structural methods with their receiver inside the supplied owner transaction', async () => {
    const owner = new TaoActionOwner()
    const value = TR.Cell(TR.Value('before'))
    const seen: string[] = []
    const callback = {
      prefix: 'receiver',
      invoke(next: TR.Value<string>) {
        Expect(actionOwner()).toBe(owner)
        seen.push(`${this.prefix}:${next.jsValue}`)
        TR.Set(value, () => next)
      },
    }
    await invokeNativeAction(callback, owner, () => true, TR.Value('after'))
    Expect(seen).toEqual(['receiver:after'])
    Expect(value.evaluate().jsValue).toBe('after')
  })

  Test('checks owner and cancellation again when a structural callback reaches its queued root', async () => {
    for (const unmount of [false, true]) {
      const owner = new TaoActionOwner()
      const release = Deferred()
      const seen: string[] = []
      let active = true
      const blocked = TR.Action(async () => await release.promise).jsValue.invoke()
      const pending = invokeNativeAction(
        {
          invoke() {
            seen.push('delivered')
          },
        },
        owner,
        () => active,
      )
      try {
        Expect(seen).toEqual([])
        if (unmount) {
          owner.dispose()
        } else {
          active = false
        }
      } finally {
        release.resolve()
      }
      await blocked
      await pending
      Expect(seen).toEqual([])
      Expect(owner.active).toBe(!unmount)
    }
  })

  Test('retains latest-only policy when dispatching a runtime action class', async () => {
    const owner = new TaoActionOwner()
    const started = Deferred()
    const release = Deferred()
    const seen: string[] = []
    const callback = TR.ForeignAction(
      async (value: string) => {
        Expect(actionOwner()).toBe(owner)
        seen.push(value)
        if (value === 'A') {
          started.resolve()
          await release.promise
        }
      },
      'LatestNative',
      [],
      { runs: 'latest' },
    ).jsValue
    const first = invokeNativeAction(callback, owner, () => true, TR.Value('A'))
    try {
      await started.promise
      let supersededSettled = false
      const second = Promise.resolve(invokeNativeAction(callback, owner, () => true, TR.Value('B'))).then(() => {
        supersededSettled = true
      })
      const third = invokeNativeAction(callback, owner, () => true, TR.Value('C'))
      await Promise.resolve()
      Expect(supersededSettled).toBe(true)
      await second
      release.resolve()
      await first
      await third
      Expect(seen).toEqual(['A', 'C'])
    } finally {
      release.resolve()
      await first
    }
  })

  Test('retains interrupt policy when a runtime response action releases a suspended root', async () => {
    const owner = new TaoActionOwner()
    const release = Deferred()
    const seen: string[] = []
    const blocked = TR.Action(async () => {
      await release.promise
      seen.push('resumed')
    }).jsValue.invoke()
    const response = TR.Action(() => {
      Expect(actionOwner()).toBe(owner)
      seen.push('response')
      release.resolve()
    }, { interrupt: true }).jsValue
    try {
      Expect(invokeNativeAction(response, owner, () => true)).toBeUndefined()
      await blocked
      Expect(seen).toEqual(['response', 'resumed'])
    } finally {
      release.resolve()
      await blocked
    }
  })
})
