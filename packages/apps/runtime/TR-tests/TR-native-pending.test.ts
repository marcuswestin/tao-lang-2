import TR from '@runtime/TR'
import { Deferred, Describe, Expect, settle, Test } from '@shared/test'
import { nativeAsyncCallbacks } from '../TaoRuntime-src/TR-native-async-callbacks'
import { createNativePendingType } from '../TaoRuntime-src/TR-native-pending'
import { TaoActionOwner } from '../TaoRuntime-src/TR-native-subscription'

Describe('native pending operations', () => {
  Test('lets owned progress and an ordinary cancel action run before external settlement', async () => {
    const operation = createNativePendingType<string>('Download')
    const external = Deferred<string>()
    const owner = new TaoActionOwner()
    const events: string[] = []
    let handle!: ReturnType<typeof operation.start>
    let progress!: ReturnType<typeof nativeAsyncCallbacks>
    let nestedRemovals = 0
    const progressAction = TR.Action((value: TR.Value<number>) => {
      events.push(`progress:${value.jsValue}`)
      TR.NativeSubscription().attach(() => {
        nestedRemovals += 1
      })
    })
    await TR.Action(() => {
      progress = nativeAsyncCallbacks()
      handle = operation.start(() => external.promise, progress)
      operation.observe(
        handle,
        TR.Action(() => {
          events.push(`terminal:${operation.status(handle)}`)
        }).jsValue,
      )
    }, { owner }).jsValue.invoke()
    Expect('then' in handle).toBe(false)
    Expect(Reflect.ownKeys(handle)).toEqual([])
    Expect(operation.status(handle)).toBe('pending')
    Expect(operation.error(handle)).toBe(null)
    Expect(() => operation.read(handle)).toThrow('has not fulfilled')
    progress.invoke(progressAction.jsValue, TR.Value(25))
    await settle()
    const cancel = TR.ForeignAction(
      () => {
        events.push('native cancel action')
        progress.cancel()
      },
      'CancelDownload',
      [],
    )
    await TR.Action(async () => {
      await TR.Do(cancel)
    }, { owner }).jsValue.invoke()
    Expect(events).toEqual(['progress:25', 'native cancel action'])
    Expect(operation.status(handle)).toBe('pending')
    external.reject('The native download was cancelled.')
    await settle()
    Expect(operation.status(handle)).toBe('rejected')
    Expect(operation.error(handle)).toBe('The native download was cancelled.')
    Expect(() => operation.read(handle)).toThrow('has not fulfilled')
    Expect(events).toEqual(['progress:25', 'native cancel action', 'terminal:rejected'])
    owner.dispose()
    Expect(nestedRemovals).toBe(1)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('delivers existing and late terminal observations once after each registration commit', async () => {
    const operation = createNativePendingType<string>('Read')
    const external = Deferred<string>()
    const handle = operation.start(() => external.promise)
    const owner = new TaoActionOwner()
    const seen: string[] = []
    const cell = TR.Cell(TR.Value('before'))
    await TR.Action(() => {
      operation.observe(handle, TR.Action(() => seen.push(`early:${operation.read(handle)}`)).jsValue)
    }, { owner }).jsValue.invoke()
    external.resolve('result')
    await settle()
    Expect(operation.status(handle)).toBe('fulfilled')
    Expect(operation.read(handle)).toBe('result')
    Expect(operation.error(handle)).toBe(null)
    let observer!: { remove(): void }
    await TR.Action(() => {
      observer = operation.observe(handle, TR.Action(() => seen.push(`late:${cell.evaluate().jsValue}`)).jsValue)
      Expect(seen).toEqual(['early:result'])
      TR.Set(cell, () => TR.Value('committed'))
    }, { owner }).jsValue.invoke()
    await settle()
    observer.remove()
    observer.remove()
    await settle()
    Expect(seen).toEqual(['early:result', 'late:committed'])
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('finishes progress on success and rejection while retaining accepted progress actions', async () => {
    for (const reject of [false, true]) {
      const operation = createNativePendingType<string>('Transfer')
      const external = Deferred<string>()
      const owner = new TaoActionOwner()
      const seen: string[] = []
      let progress!: ReturnType<typeof nativeAsyncCallbacks>
      let handle!: ReturnType<typeof operation.start>
      await TR.Action(() => {
        progress = nativeAsyncCallbacks()
        handle = operation.start(() => external.promise, progress)
        progress.invoke(TR.Action(() => seen.push('accepted')).jsValue)
        if (reject) {
          external.reject('Transfer failed.')
        } else {
          external.resolve('done')
        }
      }, { owner }).jsValue.invoke()
      await settle()
      Expect(seen).toEqual(['accepted'])
      Expect(progress.active).toBe(false)
      progress.invoke(TR.Action(() => seen.push('late')).jsValue)
      await settle()
      Expect(seen).toEqual(['accepted'])
      Expect(operation.status(handle)).toBe(reject ? 'rejected' : 'fulfilled')
      Expect(owner.subscriptions.size).toBe(0)
    }
  })

  Test('release removes callback guards and permanently observes a later native rejection', async () => {
    const operation = createNativePendingType<string>('Download')
    const external = Deferred<string>()
    const owner = new TaoActionOwner()
    const unowned: unknown[] = []
    const stop = TR.Errors.onUnowned(error => unowned.push(error))
    let cancelledScopes = 0
    let finishedScopes = 0
    let delivered = 0
    let handle!: ReturnType<typeof operation.start>
    try {
      await TR.Action(() => {
        handle = operation.start(() => external.promise, {
          cancel() {
            cancelledScopes += 1
          },
          finishCall() {
            finishedScopes += 1
          },
        })
        operation.observe(
          handle,
          TR.Action(() => {
            delivered += 1
          }).jsValue,
        )
      }, { owner }).jsValue.invoke()
      operation.release(handle)
      operation.release(handle)
      Expect(operation.is(handle)).toBe(false)
      Expect(() => operation.status(handle)).toThrow('native reference has been released')
      Expect(owner.subscriptions.size).toBe(0)
      external.reject('Rejection after release.')
      await settle()
      Expect(unowned).toEqual([])
      Expect(delivered).toBe(0)
      Expect(cancelledScopes).toBe(1)
      Expect(finishedScopes).toBe(0)
    } finally {
      stop()
    }
  })

  Test('unmount removes progress and observers while the retained rejected result remains readable', async () => {
    const operation = createNativePendingType<string>('Download')
    const external = Deferred<string>()
    const owner = new TaoActionOwner()
    let progress!: ReturnType<typeof nativeAsyncCallbacks>
    let handle!: ReturnType<typeof operation.start>
    const seen: string[] = []
    await TR.Action(() => {
      progress = nativeAsyncCallbacks()
      handle = operation.start(() => external.promise, progress)
      operation.observe(handle, TR.Action(() => seen.push('terminal')).jsValue)
    }, { owner }).jsValue.invoke()
    owner.dispose()
    Expect(owner.subscriptions.size).toBe(0)
    progress.invoke(TR.Action(() => seen.push('progress')).jsValue)
    external.reject('Unmounted native operation rejected.')
    await settle()
    Expect(seen).toEqual([])
    Expect(operation.status(handle)).toBe('rejected')
    Expect(operation.error(handle)).toBe('Unmounted native operation rejected.')
  })

  Test('keeps rejection handlers on an operation started by a rolled-back registering action', async () => {
    const operation = createNativePendingType<string>('Download')
    const external = Deferred<string>()
    const owner = new TaoActionOwner()
    let handle!: ReturnType<typeof operation.start>
    let progress!: ReturnType<typeof nativeAsyncCallbacks>
    let delivered = 0
    const reports: string[] = []
    const unowned: unknown[] = []
    const stop = TR.Errors.onFailure(report => reports.push(report.message))
    const stopUnowned = TR.Errors.onUnowned(error => unowned.push(error))
    try {
      await TR.Action(() => {
        progress = nativeAsyncCallbacks()
        handle = operation.start(() => external.promise, progress)
        operation.observe(
          handle,
          TR.Action(() => {
            delivered += 1
          }).jsValue,
        )
        TR.Errors.failInput('Registering action failed.')
      }, { owner }).jsValue.invoke()
      Expect(progress.active).toBe(false)
      Expect(owner.subscriptions.size).toBe(0)
      external.reject('Native failure after rollback.')
      await settle()
      Expect(operation.error(handle)).toBe('Native failure after rollback.')
      Expect(operation.status(handle)).toBe('rejected')
      Expect(delivered).toBe(0)
      Expect(reports).toEqual(['Registering action failed.'])
      Expect(unowned).toEqual([])
    } finally {
      stop()
      stopUnowned()
    }
  })

  Test('rolls back terminal observation registration at root and child savepoint boundaries', async () => {
    const operation = createNativePendingType<string>('Read')
    const external = Deferred<string>()
    const handle = operation.start(() => external.promise)
    const owner = new TaoActionOwner()
    const seen: string[] = []
    const callback = TR.Action(() => seen.push('terminal'))
    const child = TR.Action(() => {
      operation.observe(handle, callback.jsValue)
      TR.Errors.failInput('Child registration failed.')
    }, { name: 'Child' })
    await TR.Action(async () => {
      await TR.WhenDo(() => TR.Do(child), { declared: [], name: 'Child' }, [['error', () => {}]])
    }, { owner }).jsValue.invoke()
    Expect(owner.subscriptions.size).toBe(0)
    const stop = TR.Errors.onFailure(() => {})
    try {
      await TR.Action(() => {
        operation.observe(handle, callback.jsValue)
        TR.Errors.failInput('Root registration failed.')
      }, { owner }).jsValue.invoke()
    } finally {
      stop()
    }
    Expect(owner.subscriptions.size).toBe(0)
    external.resolve('result')
    await settle()
    Expect(seen).toEqual([])
    Expect(operation.read(handle)).toBe('result')
  })

  Test('removal and release suppress terminal delivery already buffered before registration commit', async () => {
    const operation = createNativePendingType<string>('Read')
    const handle = operation.start(() => Promise.resolve('result'))
    await settle()
    const owner = new TaoActionOwner()
    let delivered = 0
    await TR.Action(() => {
      const observer = operation.observe(
        handle,
        TR.Action(() => {
          delivered += 1
        }).jsValue,
      )
      observer.remove()
      observer.remove()
      operation.observe(
        handle,
        TR.Action(() => {
          delivered += 1
        }).jsValue,
      )
      operation.release(handle)
    }, { owner }).jsValue.invoke()
    await settle()
    Expect(delivered).toBe(0)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('delivers terminal observations independently of an unrelated root rollback', async () => {
    const operation = createNativePendingType<string>('Read')
    const external = Deferred<string>()
    const handle = operation.start(() => external.promise)
    const owner = new TaoActionOwner()
    const seen: string[] = []
    await TR.Action(() => {
      operation.observe(handle, TR.Action(() => seen.push(operation.read(handle))).jsValue)
    }, { owner }).jsValue.invoke()
    const release = Deferred()
    const stop = TR.Errors.onFailure(() => {})
    const unrelated = TR.Action(async () => {
      await release.promise
      TR.Errors.failInput('Unrelated root failed.')
    }).jsValue.invoke()
    external.resolve('result')
    await settle()
    Expect(operation.status(handle)).toBe('fulfilled')
    Expect(seen).toEqual([])
    release.resolve()
    try {
      await unrelated
      await TR.Action(() => {}).jsValue.invoke()
      Expect(seen).toEqual(['result'])
      Expect(owner.subscriptions.size).toBe(0)
    } finally {
      stop()
    }
  })

  Test('rejects foreign and forged handles and propagates a synchronous starter throw', () => {
    const first = createNativePendingType<string>('Read')
    const second = createNativePendingType<string>('Read')
    const external = Deferred<string>()
    const handle = first.start(() => external.promise)
    Expect(second.is(handle)).toBe(false)
    Expect(() => second.status(handle)).toThrow('Use a Read native reference')
    Expect(() => second.release(handle)).toThrow('Use a Read native reference')
    Expect(() => first.read(Object.create(Object.getPrototypeOf(handle)))).toThrow('Use a Read native reference')
    Expect(() => JSON.stringify(handle)).toThrow('A native reference cannot be serialized')
    Expect(() => first.start(() => TR.Errors.failInput('Starter failed synchronously.'))).toThrow(
      'Starter failed synchronously.',
    )
    first.release(handle)
    external.resolve('cleanup')
  })
})
