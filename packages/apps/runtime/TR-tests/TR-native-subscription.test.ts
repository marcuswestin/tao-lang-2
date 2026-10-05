import TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import React from 'react'
import { TaoActionOwner } from '../TaoRuntime-src/TR-native-subscription'
import { runtimeTestOverrideSlot } from '../TaoRuntime-src/TR-test-override'

const hooks = runtimeTestOverrideSlot({
  read: () => ({ effect: React.useEffect, ref: React.useRef }),
  equals: (left, right) => left.effect === right.effect && left.ref === right.ref,
  write: value => {
    React.useEffect = value.effect
    React.useRef = value.ref
  },
})

Describe('native subscription ownership', () => {
  Test('owns structural subscription methods and cancels queued delivery with one native cleanup', async () => {
    const owner = new TaoActionOwner()
    const held = Deferred()
    const seen: string[] = []
    let removed = 0
    let token!: ReturnType<typeof TR.NativeSubscription>
    const callback = {
      prefix: 'receiver',
      invoke(value: TR.Value<string>) {
        seen.push(`${this.prefix}:${value.jsValue}`)
      },
    }
    await TR.Action(() => {
      token = TR.NativeSubscription()
      token.attach(() => {
        removed += 1
      })
    }, { owner }).jsValue.invoke()
    token.invoke(callback, TR.Value('accepted'))
    Expect(seen).toEqual(['receiver:accepted'])
    const blocked = TR.Action(async () => await held.promise).jsValue.invoke()
    try {
      token.invoke(callback, TR.Value('queued'))
      owner.dispose()
      token.remove()
      token.invoke(callback, TR.Value('late'))
    } finally {
      held.resolve()
    }
    await blocked
    await TR.Action(() => {}).jsValue.invoke()
    Expect(seen).toEqual(['receiver:accepted'])
    Expect(removed).toBe(1)
    Expect(token.active).toBe(false)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('keeps a hook owner across renders and removes its listeners on unmount', async () => {
    const ref: { current: TaoActionOwner | undefined } = { current: undefined }
    let cleanup: (() => void) | undefined
    const restore = hooks.install({
      ref: (() => ref) as typeof React.useRef,
      effect: effect => {
        cleanup = effect() as (() => void) | undefined
      },
    })
    let owner: TaoActionOwner
    try {
      owner = TR.UseActionOwner()
      Expect(TR.UseActionOwner()).toBe(owner)
    } finally {
      restore()
    }
    let removed = 0
    await TR.Action(() => {
      TR.NativeSubscription().attach(() => {
        removed += 1
      })
    }, { owner }).jsValue.invoke()
    Expect(removed).toBe(0)
    cleanup?.()
    Expect(removed).toBe(1)
  })

  Test('isolates two views and suppresses removed listener events', async () => {
    const first = new TaoActionOwner()
    const second = new TaoActionOwner()
    const removed: string[] = []
    const events: string[] = []
    let firstToken!: ReturnType<typeof TR.NativeSubscription>
    let secondToken!: ReturnType<typeof TR.NativeSubscription>
    const callback = TR.Action((value: TR.Value<string>) => {
      events.push(value.jsValue)
    })
    const register = TR.ForeignAction(
      () => {
        const token = TR.NativeSubscription()
        token.attach(() => {
          removed.push(events.at(-1) ?? 'empty')
        })
        return token
      },
      'Register',
      [],
    )
    await TR.Action(async () => {
      firstToken = (await TR.DoResult<ReturnType<typeof TR.NativeSubscription>>(register)).jsValue
    }, { owner: first }).jsValue.invoke()
    await TR.Action(async () => {
      secondToken = (await TR.DoResult<ReturnType<typeof TR.NativeSubscription>>(register)).jsValue
    }, { owner: second }).jsValue.invoke()
    firstToken.invoke(callback.jsValue, TR.Value('first'))
    first.dispose()
    firstToken.invoke(callback.jsValue, TR.Value('late'))
    secondToken.invoke(callback.jsValue, TR.Value('second'))
    secondToken.remove()
    secondToken.remove()
    second.dispose()
    Expect(events).toEqual(['first', 'second'])
    Expect(removed).toEqual(['first', 'second'])
  })

  Test('removes late native attachments and rejects ownerless registration before native work', async () => {
    const owner = new TaoActionOwner()
    let token!: ReturnType<typeof TR.NativeSubscription>
    await TR.Action(() => {
      token = TR.NativeSubscription()
    }, { owner }).jsValue.invoke()
    owner.dispose()
    let removed = 0
    token.attach(() => {
      removed += 1
    })
    token.remove()
    Expect(removed).toBe(1)
    Expect(() => TR.NativeSubscription()).toThrow(
      'Register native listeners from an action belonging to a mounted view.',
    )
  })

  Test('retains the caller owner across awaits, nested calls, events and detached work', async () => {
    const owner = new TaoActionOwner()
    const removed: string[] = []
    const nested = TR.ForeignAction(
      () => {
        TR.NativeSubscription().attach(() => {
          removed.push('nested')
        })
      },
      'Nested',
      [],
    )
    let token!: ReturnType<typeof TR.NativeSubscription>
    const callback = TR.Action(async () => {
      const continuation = TR.ActionContinuation()
      await Promise.resolve()
      TR.ResumeActionContinuation(continuation)
      await TR.Do(nested)
    })
    await TR.Action(async () => {
      const continuation = TR.ActionContinuation()
      await Promise.resolve()
      TR.ResumeActionContinuation(continuation)
      token = TR.NativeSubscription()
      token.attach(() => {
        removed.push('parent')
      })
      TR.Async(async () => {
        await TR.Do(nested)
      })
    }, { owner }).jsValue.invoke()
    token.invoke(callback.jsValue)
    // A final root waits for detached work and the event callback to finish.
    await TR.Action(() => {}).jsValue.invoke()
    owner.dispose()
    Expect(removed).toEqual(['parent', 'nested', 'nested'])
  })

  Test('does not lend a suspended root owner to a queued ownerless action', async () => {
    const owner = new TaoActionOwner()
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let registrations = 0
    const reports: string[] = []
    const stop = TR.Errors.onFailure(report => {
      reports.push(report.message)
    })
    const register = TR.ForeignAction(
      () => {
        const token = TR.NativeSubscription()
        registrations += 1
        token.attach(() => {})
      },
      'Register',
      [],
    )
    try {
      const owned = TR.Action(async () => {
        const continuation = TR.ActionContinuation()
        await gate
        TR.ResumeActionContinuation(continuation)
        await TR.Do(register)
      }, { owner }).jsValue.invoke()
      const ownerless = TR.Action(async () => {
        await TR.Do(register)
      }).jsValue.invoke()
      release()
      await owned
      await ownerless
    } finally {
      stop()
      owner.dispose()
    }
    Expect(registrations).toBe(1)
    Expect(reports).toEqual(['Register native listeners from an action belonging to a mounted view.'])
  })

  Test('drops an event queued before its listener was removed', async () => {
    const owner = new TaoActionOwner()
    let token!: ReturnType<typeof TR.NativeSubscription>
    await TR.Action(() => {
      token = TR.NativeSubscription()
    }, { owner }).jsValue.invoke()
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const blocker = TR.Action(async () => {
      await gate
    }).jsValue.invoke()
    let delivered = 0
    token.invoke(
      TR.Action(() => {
        delivered += 1
      }).jsValue,
    )
    token.remove()
    release()
    await blocker
    await TR.Action(() => {}).jsValue.invoke()
    owner.dispose()
    Expect(delivered).toBe(0)
  })

  Test('a selectable loop starts its callback with the enclosing view owner', async () => {
    const owner = new TaoActionOwner()
    const removed: string[] = []
    const selected: string[] = []
    const register = TR.ForeignAction(
      (value: string) => {
        TR.NativeSubscription().attach(() => {
          removed.push(value)
        })
      },
      'Register',
      [],
    )
    const loop = TR.ForEach(TR.Value(['One']), () => null, async value => {
      const continuation = TR.ActionContinuation()
      await Promise.resolve()
      TR.ResumeActionContinuation(continuation)
      await TR.Do(register, value)
      selected.push(value.jsValue)
    }, { owner }) as React.ReactElement<{
      items: Array<
        React.ReactElement<{
          children: React.ReactElement<{
            runtimeValue: TR.Value<string>
            select(value: TR.Value<string>, index: number): Promise<void>
          }>
        }>
      >
    }>
    const item = loop.props.items[0]!.props.children
    await item.props.select(item.props.runtimeValue, 0)
    Expect(selected).toEqual(['One'])
    Expect(removed).toEqual([])
    owner.dispose()
    Expect(removed).toEqual(['One'])
    await item.props.select(item.props.runtimeValue, 0)
    Expect(selected).toEqual(['One'])
  })

  Test('a directly invoked view-local foreign action owns its native listener', async () => {
    const owner = new TaoActionOwner()
    let registrations = 0
    let removals = 0
    const local = TR.ForeignAction(
      () => {
        const token = TR.NativeSubscription()
        registrations += 1
        token.attach(() => {
          removals += 1
        })
      },
      'LocalRegister',
      [],
      { owner },
    )
    await local.jsValue.invoke()
    Expect(registrations).toBe(1)
    Expect(removals).toBe(0)
    owner.dispose()
    Expect(removals).toBe(1)
  })

  Test('a handled child failure removes only subscriptions acquired after its savepoint', async () => {
    const owner = new TaoActionOwner()
    const events: string[] = []
    let callerToken!: ReturnType<typeof TR.NativeSubscription>
    let childToken!: ReturnType<typeof TR.NativeSubscription>
    const callback = TR.Action((value: TR.Value<string>) => {
      events.push(value.jsValue)
    })
    const child = TR.Action(() => {
      childToken = TR.NativeSubscription()
      childToken.attach(() => {
        events.push('child removed')
      })
      TR.Errors.failInput('Child registration failed.')
    }, { name: 'Child' })
    const caller = TR.Action(async () => {
      callerToken = TR.NativeSubscription()
      callerToken.attach(() => {
        events.push('caller removed')
      })
      await TR.WhenDo(() => TR.Do(child), { declared: [], name: 'Child' }, [[
        'error',
        message => {
          events.push(message.jsValue)
          childToken.invoke(callback.jsValue, TR.Value('child event'))
          callerToken.invoke(callback.jsValue, TR.Value('caller event'))
        },
      ]])
    }, { name: 'Caller', owner })
    try {
      Expect((await caller.jsValue.invokeReceipt()).outcome).toBe('committed')
      await TR.Action(() => {}).jsValue.invoke()
      Expect(events).toEqual(['child removed', 'Child registration failed.', 'caller event'])
      owner.dispose()
      Expect(events).toEqual(['child removed', 'Child registration failed.', 'caller event', 'caller removed'])
    } finally {
      owner.dispose()
    }
  })

  Test('rolls native registration back with a failed transaction', async () => {
    const owner = new TaoActionOwner()
    let removed = 0
    const stop = TR.Errors.onFailure(() => {})
    try {
      await TR.Action(() => {
        TR.NativeSubscription().attach(() => {
          removed += 1
        })
        TR.Errors.failInput('Registration failed.')
      }, { owner }).jsValue.invoke()
    } finally {
      stop()
    }
    Expect(removed).toBe(1)
    owner.dispose()
    Expect(removed).toBe(1)
  })
})
