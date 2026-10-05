import TR from '@runtime/TR'
import { Deferred, Describe, Expect, settle, Test } from '@shared/test'
import { nativeAsyncCallbacks } from '../TaoRuntime-src/TR-native-async-callbacks'
import { TaoActionOwner } from '../TaoRuntime-src/TR-native-subscription'

Describe('asynchronous native callback ownership', () => {
  Test('owns structural asynchronous failures and closes admission without losing accepted work', async () => {
    const owner = new TaoActionOwner()
    const started = Deferred()
    const release = Deferred()
    const value = TR.Cell(TR.Value('before'))
    const seen: string[] = []
    const reports: string[] = []
    const unowned: unknown[] = []
    const stop = TR.Errors.onFailure(report => reports.push(`${report.action}:${report.message}`))
    const stopUnowned = TR.Errors.onUnowned(error => unowned.push(error))
    let token!: ReturnType<typeof nativeAsyncCallbacks>
    const callback = {
      prefix: 'receiver',
      async invoke(label: TR.Value<string>) {
        seen.push(`${this.prefix}:${label.jsValue}`)
        TR.Set(value, () => TR.Value('pending'))
        started.resolve()
        await release.promise
        TR.Errors.failInput('Structural callback failed.')
      },
    }
    try {
      await TR.Action(() => {
        token = nativeAsyncCallbacks()
        token.invoke(callback, TR.Value('accepted'))
        token.finishCall()
        token.invoke(callback, TR.Value('late'))
        Expect(seen).toEqual([])
      }, { owner }).jsValue.invoke()
      await started.promise
      Expect(owner.subscriptions.size).toBe(1)
      release.resolve()
      await TR.Action(() => {}).jsValue.invoke()
      Expect(seen).toEqual(['receiver:accepted'])
      Expect(value.evaluate().jsValue).toBe('before')
      Expect(reports).toEqual(['native callback:Structural callback failed.'])
      Expect(unowned).toEqual([])
      Expect(token.active).toBe(false)
      Expect(owner.subscriptions.size).toBe(0)
    } finally {
      release.resolve()
      token?.cancel()
      stop()
      stopUnowned()
    }
  })

  Test('holds early native callbacks throughout a suspended registration root', async () => {
    const owner = new TaoActionOwner()
    const release = Deferred()
    const registered = Deferred()
    const seen: string[] = []
    let token!: ReturnType<typeof nativeAsyncCallbacks>
    const registration = TR.Action(async () => {
      token = nativeAsyncCallbacks()
      token.invoke(TR.Action(() => seen.push('event')).jsValue)
      registered.resolve()
      await release.promise
    }, { owner }).jsValue.invoke()
    try {
      await registered.promise
      await settle()
      Expect(seen).toEqual([])
      Expect(token.active).toBe(true)
    } finally {
      release.resolve()
    }
    await registration
    await settle()
    Expect(seen).toEqual(['event'])
    token.cancel()
  })

  Test('buffers early events until registration commits and retains accepted work after admission closes', async () => {
    const owner = new TaoActionOwner()
    const cell = TR.Cell(TR.Value('before'))
    const seen: string[] = []
    let token!: ReturnType<typeof nativeAsyncCallbacks>
    const callback = TR.Action((label: TR.Value<string>) => seen.push(`${label.jsValue}:${cell.evaluate().jsValue}`))
    await TR.Action(() => {
      token = nativeAsyncCallbacks()
      token.invoke(callback.jsValue, TR.Value('accepted'))
      token.finishCall()
      token.invoke(callback.jsValue, TR.Value('late'))
      Expect(seen).toEqual([])
      TR.Set(cell, () => TR.Value('committed'))
    }, { owner }).jsValue.invoke()
    await settle()
    Expect(seen).toEqual(['accepted:committed'])
    Expect(token.active).toBe(false)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('does not lend a ready event to an unrelated asynchronous root rollback', async () => {
    const owner = new TaoActionOwner()
    let token!: ReturnType<typeof nativeAsyncCallbacks>
    await TR.Action(() => {
      token = nativeAsyncCallbacks()
    }, { owner }).jsValue.invoke()
    const release = Deferred()
    const stop = TR.Errors.onFailure(() => {})
    const seen: string[] = []
    const unrelated = TR.Action(async () => {
      await release.promise
      TR.Errors.failInput('Unrelated root failed.')
    }).jsValue.invoke()
    token.invoke(TR.Action(() => seen.push('delivered')).jsValue)
    await Promise.resolve()
    Expect(seen).toEqual([])
    release.resolve()
    try {
      await unrelated
      await TR.Action(() => {}).jsValue.invoke()
      Expect(seen).toEqual(['delivered'])
      Expect(token.active).toBe(true)
    } finally {
      stop()
      token.cancel()
    }
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('yields a ready event until an unrelated synchronous root has committed', async () => {
    const owner = new TaoActionOwner()
    let token!: ReturnType<typeof nativeAsyncCallbacks>
    const cell = TR.Cell(TR.Value('before'))
    const seen: string[] = []
    await TR.Action(() => {
      token = nativeAsyncCallbacks()
    }, { owner }).jsValue.invoke()
    await TR.Action(() => {
      token.invoke(TR.Action(() => seen.push(cell.evaluate().jsValue)).jsValue)
      Expect(seen).toEqual([])
      TR.Set(cell, () => TR.Value('after'))
    }).jsValue.invoke()
    await settle()
    Expect(seen).toEqual(['after'])
    token.cancel()
  })

  Test('cancels early events on registration rollback and handled child rollback', async () => {
    const owner = new TaoActionOwner()
    const seen: string[] = []
    let token!: ReturnType<typeof nativeAsyncCallbacks>
    const callback = TR.Action(() => seen.push('event'))
    const child = TR.Action(() => {
      token = nativeAsyncCallbacks()
      token.invoke(callback.jsValue)
      TR.Errors.failInput('Registration failed.')
    }, { name: 'Child' })
    await TR.Action(async () => {
      await TR.WhenDo(() => TR.Do(child), { declared: [], name: 'Child' }, [['error', () => {}]])
      Expect(token.active).toBe(false)
    }, { owner }).jsValue.invoke()
    await settle()
    Expect(seen).toEqual([])
    Expect(owner.subscriptions.size).toBe(0)
    const stop = TR.Errors.onFailure(() => {})
    try {
      await TR.Action(() => {
        token = nativeAsyncCallbacks()
        token.invoke(callback.jsValue)
        TR.Errors.failInput('Root failed.')
      }, { owner }).jsValue.invoke()
    } finally {
      stop()
    }
    await settle()
    Expect(seen).toEqual([])
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('suppresses scheduled events on explicit cancellation or view unmount', async () => {
    const seen: string[] = []
    for (const unmount of [false, true]) {
      const owner = new TaoActionOwner()
      let token!: ReturnType<typeof nativeAsyncCallbacks>
      await TR.Action(() => {
        token = nativeAsyncCallbacks()
      }, { owner }).jsValue.invoke()
      token.invoke(TR.Action(() => seen.push('event')).jsValue)
      if (unmount) {
        owner.dispose()
      } else {
        token.cancel()
      }
      token.cancel()
      await settle()
      Expect(token.active).toBe(false)
      Expect(owner.subscriptions.size).toBe(0)
    }
    Expect(seen).toEqual([])
  })

  Test('retains ownership until accepted asynchronous actions settle without duplicate failure reports', async () => {
    const owner = new TaoActionOwner()
    const started = Deferred()
    const release = Deferred()
    const reports: string[] = []
    const unowned: unknown[] = []
    const stop = TR.Errors.onFailure(report => reports.push(report.message))
    const stopUnowned = TR.Errors.onUnowned(error => unowned.push(error))
    let token!: ReturnType<typeof nativeAsyncCallbacks>
    try {
      await TR.Action(() => {
        token = nativeAsyncCallbacks()
        token.invoke(
          TR.Action(async () => {
            started.resolve()
            await release.promise
            TR.Errors.failInput('Callback failed.')
          }).jsValue,
        )
        token.finishCall()
      }, { owner }).jsValue.invoke()
      await started.promise
      Expect(owner.subscriptions.size).toBe(1)
      release.resolve()
      await TR.Action(() => {}).jsValue.invoke()
      Expect(owner.subscriptions.size).toBe(0)
      Expect(reports).toEqual(['Callback failed.'])
      Expect(unowned).toEqual([])
    } finally {
      release.resolve()
      token?.cancel()
      stop()
      stopUnowned()
    }
  })

  Test('requires an active mounted registration owner', () => {
    Expect(() => nativeAsyncCallbacks()).toThrow(
      'Register native callbacks from an action belonging to a mounted view.',
    )
  })
})
