import TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import { nativeCallCallbacks } from '../TaoRuntime-src/TR-native-call-callbacks'
import { TaoActionOwner } from '../TaoRuntime-src/TR-native-subscription'

Describe('native call callbacks', () => {
  Test('runs structural methods after caller commit and drops late callbacks after finish', async () => {
    const owner = new TaoActionOwner()
    const value = TR.Cell(TR.Value('before'))
    const seen: string[] = []
    const callback = {
      prefix: 'receiver',
      invoke(index: TR.Value<number>) {
        seen.push(`${this.prefix}:${index.jsValue}:${value.evaluate().jsValue}`)
      },
    }
    await TR.Action(() => {
      const token = nativeCallCallbacks()
      token.invoke(callback, TR.Value(1))
      token.invoke(callback, TR.Value(2))
      Expect(seen).toEqual([])
      token.finishCall()
      token.invoke(callback, TR.Value(3))
      TR.Set(value, () => TR.Value('committed'))
    }, { owner }).jsValue.invoke()
    await TR.Action(() => {}).jsValue.invoke()
    Expect(seen).toEqual(['receiver:1:committed', 'receiver:2:committed'])
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('buffers synchronous callbacks until the caller commits its writes', async () => {
    const owner = new TaoActionOwner()
    const value = TR.Cell(TR.Value('before'))
    const seen: string[] = []
    const callback = TR.Action((index: TR.Value<number>) => {
      seen.push(`${index.jsValue}:${value.evaluate().jsValue}`)
    })
    await TR.Action(() => {
      const token = nativeCallCallbacks()
      ;[1, 2].forEach(index => token.invoke(callback.jsValue, TR.Value(index)))
      Expect(seen).toEqual([])
      token.finishCall()
      TR.Set(value, () => TR.Value('committed'))
      seen.push('caller finished')
    }, { owner }).jsValue.invoke()
    await TR.Action(() => {}).jsValue.invoke()
    Expect(seen).toEqual(['caller finished', '1:committed', '2:committed'])
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('finishes a foreign synchronous iteration without awaiting accepted asynchronous actions', async () => {
    const owner = new TaoActionOwner()
    const started = Deferred()
    const release = Deferred()
    const events: string[] = []
    let token!: ReturnType<typeof nativeCallCallbacks>
    const callback = TR.Action(async (value: TR.Value<string>) => {
      events.push(value.jsValue)
      started.resolve()
      await release.promise
      events.push('callback settled')
    })
    const foreign = TR.ForeignAction(
      () => {
        token = nativeCallCallbacks()
        ;['accepted'].forEach(value => token.invoke(callback.jsValue, TR.Value(value)))
        token.finishCall()
      },
      'IterateNative',
      [],
    )
    try {
      const receipt = await TR.Action(async () => {
        await TR.Do(foreign)
        events.push('caller finished')
      }, { owner }).jsValue.invokeReceipt()
      Expect(receipt.outcome).toBe('committed')
      await started.promise
      Expect(events).toEqual(['caller finished', 'accepted'])
      Expect(token.active).toBe(false)
      Expect(owner.subscriptions.size).toBe(1)
      token.invoke(callback.jsValue, TR.Value('late'))
    } finally {
      release.resolve()
    }
    await TR.Action(() => {}).jsValue.invoke()
    Expect(events).toEqual(['caller finished', 'accepted', 'callback settled'])
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('keeps ownership until every accepted asynchronous callback settles', async () => {
    const owner = new TaoActionOwner()
    const firstStarted = Deferred()
    const secondStarted = Deferred()
    const firstRelease = Deferred()
    const secondRelease = Deferred()
    const seen: number[] = []
    const callback = TR.Action(async (index: TR.Value<number>) => {
      if (index.jsValue === 1) {
        firstStarted.resolve()
        await firstRelease.promise
      } else {
        secondStarted.resolve()
        await secondRelease.promise
      }
      seen.push(index.jsValue)
    })
    try {
      await TR.Action(() => {
        const token = nativeCallCallbacks()
        token.invoke(callback.jsValue, TR.Value(1))
        token.invoke(callback.jsValue, TR.Value(2))
        token.finishCall()
      }, { owner }).jsValue.invoke()
      await firstStarted.promise
      Expect(owner.subscriptions.size).toBe(1)
      firstRelease.resolve()
      await secondStarted.promise
      Expect(seen).toEqual([1])
      Expect(owner.subscriptions.size).toBe(1)
    } finally {
      firstRelease.resolve()
      secondRelease.resolve()
    }
    await TR.Action(() => {}).jsValue.invoke()
    Expect(seen).toEqual([1, 2])
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('cancels callbacks queued behind another root when their view unmounts', async () => {
    const owner = new TaoActionOwner()
    let token!: ReturnType<typeof nativeCallCallbacks>
    await TR.Action(() => {
      token = nativeCallCallbacks()
    }, { owner }).jsValue.invoke()
    const release = Deferred()
    const blocker = TR.Action(async () => await release.promise).jsValue.invoke()
    let delivered = 0
    token.invoke(
      TR.Action(() => {
        delivered += 1
      }).jsValue,
    )
    token.finishCall()
    owner.dispose()
    release.resolve()
    await blocker
    await TR.Action(() => {}).jsValue.invoke()
    Expect(delivered).toBe(0)
    Expect(token.active).toBe(false)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('explicit cancellation suppresses already accepted work while its owner stays mounted', async () => {
    const owner = new TaoActionOwner()
    let token!: ReturnType<typeof nativeCallCallbacks>
    await TR.Action(() => {
      token = nativeCallCallbacks()
    }, { owner }).jsValue.invoke()
    const release = Deferred()
    const blocker = TR.Action(async () => await release.promise).jsValue.invoke()
    let delivered = 0
    token.invoke(
      TR.Action(() => {
        delivered += 1
      }).jsValue,
    )
    token.cancel()
    token.cancel()
    release.resolve()
    await blocker
    await TR.Action(() => {}).jsValue.invoke()
    Expect(owner.active).toBe(true)
    Expect(delivered).toBe(0)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('drops accepted callbacks after root rollback without undoing native effects', async () => {
    const owner = new TaoActionOwner()
    let token!: ReturnType<typeof nativeCallCallbacks>
    let delivered = 0
    let nativeEffects = 0
    const stop = TR.Errors.onFailure(() => {})
    try {
      const receipt = await TR.Action(() => {
        token = nativeCallCallbacks()
        nativeEffects += 1
        token.invoke(
          TR.Action(() => {
            delivered += 1
          }).jsValue,
        )
        token.finishCall()
        TR.Errors.failInput('Caller failed.')
      }, { owner }).jsValue.invokeReceipt()
      Expect(receipt.outcome).toBe('failed')
    } finally {
      stop()
    }
    await TR.Action(() => {}).jsValue.invoke()
    Expect(delivered).toBe(0)
    Expect(nativeEffects).toBe(1)
    Expect(token.active).toBe(false)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('cancels a failed child call at its savepoint while the caller commits', async () => {
    const owner = new TaoActionOwner()
    const seen: string[] = []
    let childToken!: ReturnType<typeof nativeCallCallbacks>
    const callback = TR.Action((value: TR.Value<string>) => {
      seen.push(value.jsValue)
    })
    const child = TR.Action(() => {
      childToken = nativeCallCallbacks()
      childToken.invoke(callback.jsValue, TR.Value('child callback'))
      childToken.finishCall()
      TR.Errors.failInput('Child failed.')
    }, { name: 'Child' })
    const caller = TR.Action(async () => {
      await TR.WhenDo(() => TR.Do(child), { declared: [], name: 'Child' }, [[
        'error',
        message => {
          seen.push(message.jsValue)
        },
      ]])
      const token = nativeCallCallbacks()
      token.invoke(callback.jsValue, TR.Value('caller callback'))
      token.finishCall()
    }, { owner })
    Expect((await caller.jsValue.invokeReceipt()).outcome).toBe('committed')
    await TR.Action(() => {}).jsValue.invoke()
    Expect(seen).toEqual(['Child failed.', 'caller callback'])
    Expect(childToken.active).toBe(false)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('settles discarded child dispatches even when the token predates the savepoint', async () => {
    const owner = new TaoActionOwner()
    const seen: string[] = []
    let token!: ReturnType<typeof nativeCallCallbacks>
    const callback = TR.Action((value: TR.Value<string>) => {
      seen.push(value.jsValue)
    })
    const child = TR.Action(() => {
      token.invoke(callback.jsValue, TR.Value('discarded'))
      TR.Errors.failInput('Child failed.')
    }, { name: 'Child' })
    await TR.Action(async () => {
      token = nativeCallCallbacks()
      await TR.WhenDo(() => TR.Do(child), { declared: [], name: 'Child' }, [['error', () => {}]])
      token.invoke(callback.jsValue, TR.Value('retained'))
      token.finishCall()
    }, { owner }).jsValue.invoke()
    await TR.Action(() => {}).jsValue.invoke()
    Expect(seen).toEqual(['retained'])
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('cancels a native call exception before accepted callbacks can run', async () => {
    const owner = new TaoActionOwner()
    let delivered = 0
    let token!: ReturnType<typeof nativeCallCallbacks>
    const reports: string[] = []
    const stop = TR.Errors.onFailure(report => reports.push(report.message))
    try {
      await TR.Action(() => {
        token = nativeCallCallbacks()
        try {
          token.invoke(
            TR.Action(() => {
              delivered += 1
            }).jsValue,
          )
          TR.Errors.failInput('Native call failed.')
        } catch (error) {
          token.cancel()
          throw error
        } finally {
          token.finishCall()
        }
      }, { owner }).jsValue.invoke()
    } finally {
      stop()
    }
    Expect(reports).toEqual(['Native call failed.'])
    Expect(delivered).toBe(0)
    Expect(token.active).toBe(false)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('reports owned callback failures once and exceptional invocation plumbing separately', async () => {
    const owner = new TaoActionOwner()
    const reports: string[] = []
    const unowned: unknown[] = []
    const stop = TR.Errors.onFailure(report => reports.push(report.message))
    const stopUnowned = TR.Errors.onUnowned(error => unowned.push(error))
    try {
      await TR.Action(() => {
        const token = nativeCallCallbacks()
        token.invoke(TR.Action(() => TR.Errors.failInput('Callback failed.')).jsValue)
        token.finishCall()
      }, { owner }).jsValue.invoke()
      await TR.Action(() => {}).jsValue.invoke()
      Expect(reports).toEqual(['Callback failed.'])
      Expect(unowned).toEqual([])
      await TR.Action(() => {
        const token = nativeCallCallbacks()
        token.invoke({
          invokeOwned() {
            TR.Errors.failInput('Callback plumbing failed.')
          },
        })
        token.finishCall()
      }, { owner }).jsValue.invoke()
      Expect(unowned).toHaveLength(1)
      Expect((unowned[0] as { message: string }).message).toBe('Callback plumbing failed.')
      Expect(reports).toEqual(['Callback failed.'])
      Expect(owner.subscriptions.size).toBe(0)
      await TR.Action(() => {
        const token = nativeCallCallbacks()
        token.invoke({
          async invokeOwned() {
            TR.Errors.failInput('Asynchronous plumbing failed.')
          },
        })
        token.finishCall()
      }, { owner }).jsValue.invoke()
      Expect(unowned).toHaveLength(2)
      Expect((unowned[1] as { message: string }).message).toBe('Asynchronous plumbing failed.')
      Expect(owner.subscriptions.size).toBe(0)
    } finally {
      stop()
      stopUnowned()
    }
  })

  Test('requires mounted ownership and clears an empty or cancelled call idempotently', async () => {
    Expect(() => nativeCallCallbacks()).toThrow('Call native callbacks from an action belonging to a mounted view.')
    const owner = new TaoActionOwner()
    await TR.Action(() => {
      const token = nativeCallCallbacks()
      Expect(token.active).toBe(true)
      token.finishCall()
      token.finishCall()
      token.cancel()
      token.cancel()
      Expect(token.active).toBe(false)
      Expect(owner.subscriptions.size).toBe(0)
    }, { owner }).jsValue.invoke()
  })
})
