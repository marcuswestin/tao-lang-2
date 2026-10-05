import TR from '@runtime/TR'
import { Repo } from '@shared'
import { Deferred, Describe, Expect, settle, Test } from '@shared/test'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { InteractionAttention } from '../TaoRuntime-src/TR-interaction-attention'
import { CommandCatalog } from '../TaoRuntime-src/TR-interaction-catalog'
import { InteractionOutline } from '../TaoRuntime-src/TR-interaction-outline'
import {
  applyNativeEventPolicy,
  createNativeEventListenerType,
  invokeNativeEvent,
  type NativeAbortSignal,
  type NativeEventCallback,
  nativeEventControls,
  type NativeEventListenerOptions,
} from '../TaoRuntime-src/TR-native-events'
import { TaoActionOwner } from '../TaoRuntime-src/TR-native-subscription'

class NativeEvent {
  readonly controls: string[] = []
  #prevented = false
  immediate = false
  constructor(readonly label = 'event') {}
  get defaultPrevented() {
    return this.#prevented
  }
  preventDefault() {
    this.#prevented = true
    this.controls.push('preventDefault')
  }
  stopPropagation() {
    this.controls.push('stopPropagation')
  }
  stopImmediatePropagation() {
    this.immediate = true
    this.controls.push('stopImmediatePropagation')
  }
}

class NativeTarget {
  readonly adds: Array<{ callback: NativeEventCallback; options: NativeEventListenerOptions }> = []
  readonly removes: NativeEventCallback[] = []
  #entries: Array<{ name: string; callback: NativeEventCallback; options: NativeEventListenerOptions }> = []
  onprogress: NativeEventCallback | null = null
  addEventListener(name: string, callback: NativeEventCallback, options: NativeEventListenerOptions = {}) {
    this.adds.push({ callback, options })
    this.#entries.push({ name, callback, options })
  }
  removeEventListener(name: string, callback: NativeEventCallback, capture: boolean = false) {
    this.removes.push(callback)
    this.#entries = this.#entries.filter(entry =>
      entry.name !== name || entry.callback !== callback || (entry.options.capture === true) !== capture
    )
  }
  emit(name: string, event: NativeEvent, ...rawArgs: unknown[]): boolean {
    const arguments_ = rawArgs.length === 0 ? [event] : rawArgs
    for (const entry of [...this.#entries]) {
      if (entry.name !== name || !this.#entries.includes(entry)) {
        continue
      }
      if (entry.options.once) {
        this.#entries = this.#entries.filter(candidate => candidate !== entry)
      }
      if (typeof entry.callback === 'function') {
        Reflect.apply(entry.callback, this, arguments_)
      } else {
        Reflect.apply(entry.callback.handleEvent, entry.callback, arguments_)
      }
      if (event.immediate) {
        break
      }
    }
    return !event.defaultPrevented
  }
  emitProperty(event: NativeEvent): void {
    const callback = this.onprogress
    if (typeof callback === 'function') {
      Reflect.apply(callback, this, [event])
    } else if (callback) {
      Reflect.apply(callback.handleEvent, callback, [event])
    }
  }
}

const listeners = () =>
  createNativeEventListenerType<[TR.Value<NativeEvent>]>(
    'EventListener',
    event => [TR.Value(event as NativeEvent)],
    ['preventDefault', 'stopPropagation', 'stopImmediatePropagation'],
  )

Describe('native event controls', () => {
  Test('preserves immediate ordinary invocation, receivers and async completion', async () => {
    const completion = Deferred()
    const event = new NativeEvent()
    const action = {
      count: 0,
      invoke(value: number) {
        this.count += value
        return completion.promise
      },
    }
    const result = invokeNativeEvent(action, event, 3)
    Expect(action.count).toBe(3)
    Expect(event.controls).toEqual([])
    Expect(result).toBe(completion.promise)
    completion.resolve()
    await result
  })

  Test('suppresses an ordinary queued owner action after unmount', async () => {
    const owner = new TaoActionOwner()
    const seen: string[] = []
    const release = Deferred()
    const blocker = TR.Action(async () => await release.promise).jsValue.invoke()
    const action = TR.Action(() => {
      seen.push('body')
    }, { owner })
    const event = new NativeEvent()
    try {
      invokeNativeEvent(action, event)
      Expect(event.controls).toEqual([])
      Expect(seen).toEqual([])
      owner.dispose()
    } finally {
      release.resolve()
    }
    await blocker
    await TR.Action(() => {}).jsValue.invoke()
    Expect(seen).toEqual([])
  })

  Test('applies immutable controls synchronously while the ordinary action waits behind another root', async () => {
    const release = Deferred()
    const blocker = TR.Action(async () => await release.promise).jsValue.invoke()
    const seen: number[] = []
    const action = TR.Action((value: TR.Value<number>) => {
      seen.push(value.jsValue)
    })
    const policy = { preventDefault: true, stopPropagation: true }
    const decorated = nativeEventControls(action, policy)
    policy.preventDefault = false
    const event = new NativeEvent()
    try {
      invokeNativeEvent(decorated, event, TR.Value(3))
      Expect(decorated).not.toBe(action)
      Expect(event.controls).toEqual(['preventDefault', 'stopPropagation'])
      Expect(seen).toEqual([])
      await Promise.resolve()
      Expect(seen).toEqual([])
    } finally {
      release.resolve()
    }
    await blocker
    await TR.Action(() => {}).jsValue.invoke()
    Expect(seen).toEqual([3])
    Expect(event.controls).toEqual(['preventDefault', 'stopPropagation'])
    const originalEvent = new NativeEvent()
    invokeNativeEvent(action, originalEvent, TR.Value(4))
    await settle()
    Expect(originalEvent.controls).toEqual([])
    Expect(seen).toEqual([3, 4])
  })

  Test('preserves original private method receivers and supplied owned invocation guards', () => {
    class Action {
      #calls: number[] = []
      invoke(value: number) {
        this.#calls.push(value)
      }
      invokeOwned(_owner: TaoActionOwner, active: () => boolean, value: number) {
        if (active()) {
          this.invoke(value)
        }
      }
      calls() {
        return this.#calls
      }
    }
    const action = new Action()
    const decorated = nativeEventControls(action, { preventDefault: true })
    decorated.invoke(1)
    decorated.invokeOwned(new TaoActionOwner(), () => false, 2)
    decorated.invokeOwned(new TaoActionOwner(), () => true, 3)
    Expect(action.calls()).toEqual([1, 3])
    Expect(decorated.calls()).toBe(action.calls())
  })

  Test('rejects inactive owner events before controls and suppresses bodies after a later unmount', async () => {
    const owner = new TaoActionOwner()
    const seen: string[] = []
    const action = nativeEventControls(
      TR.Action(() => {
        seen.push('body')
      }, { owner }),
      { preventDefault: true },
    )
    const release = Deferred()
    const blocker = TR.Action(async () => await release.promise).jsValue.invoke()
    const admitted = new NativeEvent()
    invokeNativeEvent(action, admitted)
    await Promise.resolve()
    owner.dispose()
    const late = new NativeEvent()
    invokeNativeEvent(action, late)
    release.resolve()
    await blocker
    await TR.Action(() => {}).jsValue.invoke()
    Expect(admitted.defaultPrevented).toBe(true)
    Expect(late.defaultPrevented).toBe(false)
    Expect(seen).toEqual([])
  })

  Test('uses only the currently selected live binding policy and supports activation without an event', async () => {
    const outline = new InteractionOutline()
    const attention = new InteractionAttention(outline, new CommandCatalog())
    const seen: string[] = []
    const globalSave = nativeEventControls(
      TR.Action(() => {
        seen.push('global')
      }),
      { stopPropagation: true },
    )
    const liveSave = nativeEventControls(
      TR.Action(() => {
        seen.push('live')
      }),
      { preventDefault: true },
    )
    const withdraw = outline.register({
      identity: 'save',
      kind: 'action',
      label: () => 'Save',
      provenance: {},
      live: { activate: event => invokeNativeEvent(liveSave, event), enabled: () => true },
    })
    const event = new NativeEvent()
    attention.targetAndActivate('save', raw => invokeNativeEvent(globalSave, raw), event)
    Expect(event.controls).toEqual(['preventDefault'])
    Expect(seen).toEqual([])
    await settle()
    attention.targetAndActivate('save')
    await settle()
    Expect(seen).toEqual(['live', 'live'])
    withdraw()
  })

  Test('binds an ownerless action at the event occurrence and checks that owner at actual dequeue', async () => {
    const owner = new TaoActionOwner()
    const seen: number[] = []
    const global = TR.Action((value: TR.Value<number>) => {
      seen.push(value.jsValue)
    })
    const binding = nativeEventControls(global, { preventDefault: true }, owner)
    const release = Deferred()
    const blocker = TR.Action(async () => await release.promise).jsValue.invoke()
    try {
      const admitted = new NativeEvent()
      invokeNativeEvent(binding, admitted, TR.Value(3))
      Expect(admitted.defaultPrevented).toBe(true)
      await Promise.resolve()
      owner.dispose()
      const late = new NativeEvent()
      invokeNativeEvent(binding, late, TR.Value(5))
      Expect(late.defaultPrevented).toBe(false)
    } finally {
      release.resolve()
    }
    await blocker
    await TR.Action(() => {}).jsValue.invoke()
    Expect(seen).toEqual([])
    await global.jsValue.invoke(TR.Value(4))
    Expect(seen).toEqual([4])
  })

  Test('uses declared native controls rather than invoking unsupported methods', () => {
    const event = new NativeEvent()
    applyNativeEventPolicy(event, { preventDefault: true, stopPropagation: true, stopImmediatePropagation: true }, [
      'stopImmediatePropagation',
    ])
    Expect(event.controls).toEqual(['stopImmediatePropagation'])
    applyNativeEventPolicy(undefined, { preventDefault: true }, ['preventDefault'])
    Expect(() => applyNativeEventPolicy({}, { preventDefault: true }, ['preventDefault'])).toThrow(
      "does not support 'preventDefault'",
    )
  })
})

Describe('native listener registry', () => {
  Test(
    'deduplicates target, logical listener, event and capture identity using the exact removal wrapper',
    async () => {
      const type = listeners()
      const target = new NativeTarget()
      const owner = new TaoActionOwner()
      const seen: string[] = []
      const listener = type.create(
        TR.Action((event: TR.Value<NativeEvent>) => {
          seen.push(event.jsValue.label)
        }).jsValue,
      )
      await TR.Action(() => {
        type.add(target, 'progress', listener)
        type.add(target, 'progress', listener, { once: true, passive: true })
        type.add(target, 'progress', listener, true)
      }, { owner }).jsValue.invoke()
      Expect(target.adds).toHaveLength(2)
      Expect(target.adds[0]!.callback).not.toBe(target.adds[1]!.callback)
      Expect(target.adds[0]!.options.once).toBe(false)
      type.remove(target, 'progress', listener)
      Expect(target.removes[0]).toBe(target.adds[0]!.callback)
      target.emit('progress', new NativeEvent('capture'))
      await settle()
      Expect(seen).toEqual(['capture'])
      owner.dispose()
      Expect(target.removes[1]).toBe(target.adds[1]!.callback)
      Expect(owner.subscriptions.size).toBe(0)
    },
  )

  Test('controls native dispatch synchronously and admits a once listener body only once', async () => {
    const type = listeners()
    const target = new NativeTarget()
    const owner = new TaoActionOwner()
    const seen: string[] = []
    const listener = type.create(
      TR.Action((event: TR.Value<NativeEvent>) => {
        seen.push(event.jsValue.label)
      }).jsValue,
      { preventDefault: true, stopImmediatePropagation: true },
    )
    await TR.Action(() => {
      type.add(target, 'progress', listener, { once: true })
    }, { owner }).jsValue.invoke()
    const event = new NativeEvent('first')
    Expect(target.emit('progress', event)).toBe(false)
    Expect(event.controls).toEqual(['preventDefault', 'stopImmediatePropagation'])
    Expect(target.emit('progress', new NativeEvent('second'))).toBe(true)
    Expect(seen).toEqual([])
    await settle()
    Expect(seen).toEqual(['first'])
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('preserves passive propagation controls while refusing native default cancellation', async () => {
    const type = listeners()
    const target = new NativeTarget()
    const owner = new TaoActionOwner()
    const seen: boolean[] = []
    const listener = type.create(
      TR.Action((event: TR.Value<NativeEvent>) => {
        seen.push(event.jsValue.defaultPrevented)
      }).jsValue,
      { preventDefault: true, stopPropagation: true },
    )
    await TR.Action(() => {
      type.add(target, 'progress', listener, { passive: true })
    }, { owner }).jsValue.invoke()
    const event = new NativeEvent()
    Expect(target.emit('progress', event)).toBe(true)
    Expect(event.controls).toEqual(['stopPropagation'])
    Expect(target.adds[0]!.options.passive).toBe(true)
    await settle()
    Expect(seen).toEqual([false])
    owner.dispose()
  })

  Test('implements signal cleanup independently of native options.signal support', async () => {
    const type = listeners()
    const target = new NativeTarget()
    const owner = new TaoActionOwner()
    const signal = new AbortController()
    let calls = 0
    const listener = type.create(
      TR.Action(() => {
        calls += 1
      }).jsValue,
    )
    await TR.Action(() => {
      type.add(target, 'progress', listener, { signal: signal.signal })
    }, { owner }).jsValue.invoke()
    Expect('signal' in target.adds[0]!.options).toBe(false)
    target.emit('progress', new NativeEvent())
    signal.abort()
    await settle()
    Expect(calls).toBe(0)
    Expect(target.removes).toHaveLength(1)
    Expect(owner.subscriptions.size).toBe(0)
    await TR.Action(() => {
      type.add(target, 'progress', listener, { signal: signal.signal })
    }, { owner }).jsValue.invoke()
    Expect(target.adds).toHaveLength(1)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('unmount and release suppress accepted bodies, including an already detached once listener', async () => {
    const type = listeners()
    const seen: string[] = []
    for (const once of [false, true]) {
      const target = new NativeTarget()
      const owner = new TaoActionOwner()
      const listener = type.create(
        TR.Action(() => {
          seen.push('body')
        }).jsValue,
      )
      await TR.Action(() => {
        type.add(target, 'progress', listener, { once })
      }, { owner }).jsValue.invoke()
      target.emit('progress', new NativeEvent())
      type.release(listener)
      type.release(listener)
      await settle()
      Expect(type.is(listener)).toBe(false)
      Expect(owner.subscriptions.size).toBe(0)
    }
    const target = new NativeTarget()
    const owner = new TaoActionOwner()
    const listener = type.create(
      TR.Action(() => {
        seen.push('unmounted')
      }).jsValue,
    )
    await TR.Action(() => {
      type.add(target, 'progress', listener)
    }, { owner }).jsValue.invoke()
    target.emit('progress', new NativeEvent())
    owner.dispose()
    await settle()
    Expect(seen).toEqual([])
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('rolls listener registration back without undoing native event controls', async () => {
    const type = listeners()
    const target = new NativeTarget()
    const owner = new TaoActionOwner()
    let calls = 0
    const event = new NativeEvent()
    const listener = type.create(
      TR.Action(() => {
        calls += 1
      }).jsValue,
      { preventDefault: true },
    )
    const stop = TR.Errors.onFailure(() => {})
    try {
      await TR.Action(() => {
        type.add(target, 'progress', listener)
        Expect(target.emit('progress', event)).toBe(false)
        TR.Errors.failInput('Registering action failed.')
      }, { owner }).jsValue.invoke()
    } finally {
      stop()
    }
    await settle()
    Expect(event.defaultPrevented).toBe(true)
    Expect(calls).toBe(0)
    Expect(target.removes).toHaveLength(1)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('recovers logical property handles and preserves foreign callback function and object identity', async () => {
    const type = listeners()
    const target = new NativeTarget()
    const owner = new TaoActionOwner()
    const seen: string[] = []
    class ForeignListener {
      #calls = 0
      handleEvent() {
        this.#calls += 1
      }
      calls() {
        return this.#calls
      }
    }
    const foreign = new ForeignListener()
    target.onprogress = foreign
    const foreignHandle = type.get(target, 'onprogress')!
    Expect(type.unwrap(foreignHandle)).toBe(foreign)
    Expect(type.get(target, 'onprogress')).toBe(foreignHandle)
    const listener = type.create(
      TR.Action(() => {
        seen.push('owned')
      }).jsValue,
    )
    await TR.Action(() => {
      type.set(target, 'onprogress', listener)
      Expect(type.get(target, 'onprogress')).toBe(listener)
      const wrapper = target.onprogress
      type.set(target, 'onprogress', listener)
      Expect(target.onprogress).toBe(wrapper)
    }, { owner }).jsValue.invoke()
    target.emitProperty(new NativeEvent())
    await settle()
    Expect(seen).toEqual(['owned'])
    owner.dispose()
    Expect(target.onprogress).toBe(foreign)
    target.emitProperty(new NativeEvent())
    Expect(foreign.calls()).toBe(1)
    const callback = function(this: NativeTarget) {
      this.onprogress = null
    }
    target.onprogress = callback
    Expect(type.unwrap(type.get(target, 'onprogress'))).toBe(callback)
    target.emitProperty(new NativeEvent())
    Expect(type.get(target, 'onprogress')).toBe(null)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('cancels a handled child registration while preserving the committing caller listener', async () => {
    const type = listeners()
    const target = new NativeTarget()
    const owner = new TaoActionOwner()
    const seen: string[] = []
    const listener = type.create(
      TR.Action((event: TR.Value<NativeEvent>) => {
        seen.push(event.jsValue.label)
      }).jsValue,
    )
    const child = TR.Action(() => {
      type.add(target, 'child', listener)
      target.emit('child', new NativeEvent('discarded'))
      TR.Errors.failInput('Child registration failed.')
    }, { name: 'Child' })
    const receipt = await TR.Action(async () => {
      await TR.WhenDo(() => TR.Do(child), { declared: [], name: 'Child' }, [[
        'error',
        message => seen.push(message.jsValue),
      ]])
      type.add(target, 'caller', listener)
      target.emit('caller', new NativeEvent('committed'))
    }, { owner }).jsValue.invokeReceipt()
    await settle()
    Expect(receipt.outcome).toBe('committed')
    Expect(seen).toEqual(['Child registration failed.', 'committed'])
    Expect(target.removes).toHaveLength(1)
    owner.dispose()
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('delivers a ready listener after an unrelated ambient root rolls back', async () => {
    const type = listeners()
    const target = new NativeTarget()
    const owner = new TaoActionOwner()
    const seen: string[] = []
    const listener = type.create(TR.Action(() => seen.push('delivered')).jsValue)
    await TR.Action(() => type.add(target, 'progress', listener), { owner }).jsValue.invoke()
    const release = Deferred()
    const stop = TR.Errors.onFailure(() => {})
    const unrelated = TR.Action(async () => {
      await release.promise
      TR.Errors.failInput('Unrelated action failed.')
    }).jsValue.invoke()
    try {
      target.emit('progress', new NativeEvent())
      await Promise.resolve()
      Expect(seen).toEqual([])
      release.resolve()
      await unrelated
      await TR.Action(() => {}).jsValue.invoke()
      Expect(seen).toEqual(['delivered'])
      Expect(target.removes).toHaveLength(0)
    } finally {
      release.resolve()
      stop()
      owner.dispose()
    }
  })

  Test('preserves synchronous cancellation and signal cleanup on an actual EventTarget', async () => {
    const type = createNativeEventListenerType<[TR.Value<Event>]>(
      'EventListener',
      event => [TR.Value(event as Event)],
      ['preventDefault', 'stopImmediatePropagation'],
    )
    const target = new EventTarget()
    const signal = new AbortController()
    const owner = new TaoActionOwner()
    let taoCalls = 0
    let foreignCalls = 0
    const listener = type.create(
      TR.Action(() => {
        taoCalls += 1
      }).jsValue,
      {
        preventDefault: true,
        stopImmediatePropagation: true,
      },
    )
    await TR.Action(() => type.add(target, 'progress', listener, { signal: signal.signal }), { owner }).jsValue.invoke()
    target.addEventListener('progress', () => {
      foreignCalls += 1
    })
    const event = new Event('progress', { cancelable: true })
    Expect(target.dispatchEvent(event)).toBe(false)
    Expect(event.defaultPrevented).toBe(true)
    Expect(taoCalls).toBe(0)
    Expect(foreignCalls).toBe(0)
    await settle()
    Expect(taoCalls).toBe(1)
    signal.abort()
    Expect(target.dispatchEvent(new Event('progress', { cancelable: true }))).toBe(true)
    await settle()
    Expect(taoCalls).toBe(1)
    Expect(foreignCalls).toBe(1)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('preserves the installed native AbortSignal shim protocol, once, passive and abort cleanup', async () => {
    const nativeRequire = createRequire(realpathSync(
      Repo.resolvePath('packages/apps/expo-host/node_modules/react-native/package.json'),
    ))
    // Load the installed implementation explicitly: the host runner aliases the package name to its DOM built-in.
    const implementation = nativeRequire.resolve('abort-controller/package.json').replace(
      /package\.json$/,
      'dist/abort-controller.js',
    )
    const { AbortController: Controller } = nativeRequire(implementation) as {
      AbortController: new() => {
        signal: NativeAbortSignal & { dispatchEvent(event: unknown): boolean }
        abort(): void
      }
    }
    const type = createNativeEventListenerType<[TR.Value<Event>]>(
      'EventListener',
      event => [TR.Value(event as Event)],
      ['preventDefault', 'stopPropagation', 'stopImmediatePropagation'],
    )
    const owner = new TaoActionOwner()
    const target = new Controller()
    const lifetime = new Controller()
    Expect(Reflect.get(target.signal, 'throwIfAborted')).toBeUndefined()
    let observed!: Event
    let calls = 0
    let foreignCalls = 0
    target.signal.addEventListener('progress', (event: Event) => {
      observed = event
    })
    const listener = type.create(
      TR.Action((event: TR.Value<Event>) => {
        Expect(event.jsValue).toBe(observed)
        calls += 1
      }).jsValue,
      { preventDefault: true, stopImmediatePropagation: true },
    )
    await TR.Action(() => type.add(target.signal, 'progress', listener, { once: true }), { owner }).jsValue.invoke()
    target.signal.addEventListener('progress', () => {
      foreignCalls += 1
    })
    Expect(target.signal.dispatchEvent({ type: 'progress', cancelable: true })).toBe(false)
    Expect(observed.defaultPrevented).toBe(true)
    for (
      const member of ['composedPath', 'initEvent', 'preventDefault', 'stopPropagation', 'stopImmediatePropagation']
    ) {
      Expect(typeof Reflect.get(observed, member)).toBe('function')
    }
    Expect(observed.composedPath()).toEqual([])
    Expect(calls).toBe(0)
    Expect(foreignCalls).toBe(0)
    await settle()
    Expect(calls).toBe(1)
    Expect(target.signal.dispatchEvent({ type: 'progress', cancelable: true })).toBe(true)
    Expect(foreignCalls).toBe(1)
    const passive = type.create(
      TR.Action(() => {
        calls += 1
      }).jsValue,
      { preventDefault: true },
    )
    await TR.Action(() =>
      type.add(target.signal, 'progress', passive, {
        passive: true,
        signal: lifetime.signal,
      }), { owner }).jsValue.invoke()
    Expect(target.signal.dispatchEvent({ type: 'progress', cancelable: true })).toBe(true)
    Expect(observed.defaultPrevented).toBe(false)
    lifetime.abort()
    await settle()
    Expect(calls).toBe(1)
    Expect(owner.subscriptions.size).toBe(0)
    const abortListener = type.create(
      TR.Action(() => {
        calls += 1
      }).jsValue,
    )
    await TR.Action(() => type.add(target.signal, 'abort', abortListener, { once: true }), { owner }).jsValue.invoke()
    target.abort()
    await settle()
    Expect(target.signal.aborted).toBe(true)
    Expect(calls).toBe(2)
    Expect(owner.subscriptions.size).toBe(0)
  })

  Test('property cleanup preserves a later native writer and explicit null clears the slot', async () => {
    const type = listeners()
    const target = new NativeTarget()
    const owner = new TaoActionOwner()
    const listener = type.create(TR.Action(() => {}).jsValue)
    await TR.Action(() => {
      type.set(target, 'onprogress', listener)
    }, { owner }).jsValue.invoke()
    const replacement = () => undefined
    target.onprogress = replacement
    owner.dispose()
    Expect(target.onprogress).toBe(replacement)
    type.set(target, 'onprogress', null)
    Expect(target.onprogress).toBe(null)
  })

  Test(
    'restores the live foreign property writer when another owned listener replaces an older registration',
    async () => {
      const type = listeners()
      const target = new NativeTarget()
      const ownerA = new TaoActionOwner()
      const ownerB = new TaoActionOwner()
      const listenerA = type.create(TR.Action(() => {}).jsValue)
      const listenerB = type.create(TR.Action(() => {}).jsValue)
      await TR.Action(() => type.set(target, 'onprogress', listenerA), { owner: ownerA }).jsValue.invoke()
      let calls = 0
      const foreign = function(this: NativeTarget) {
        Expect(this).toBe(target)
        calls += 1
      }
      target.onprogress = foreign
      await TR.Action(() => type.set(target, 'onprogress', listenerB), { owner: ownerB }).jsValue.invoke()
      Expect(target.onprogress).not.toBe(foreign)
      ownerB.dispose()
      Expect(target.onprogress).toBe(foreign)
      target.emitProperty(new NativeEvent())
      Expect(calls).toBe(1)
      ownerA.dispose()
      Expect(target.onprogress).toBe(foreign)
    },
  )

  Test('honors explicit nonzero event argument metadata and converted Tao arguments', async () => {
    const type = createNativeEventListenerType<[TR.Value<string>, TR.Value<NativeEvent>]>(
      'DetailedListener',
      (label, event) => [TR.Value(String(label)), TR.Value(event as NativeEvent)],
      ['preventDefault'],
      1,
    )
    const target = new NativeTarget()
    const owner = new TaoActionOwner()
    const seen: string[] = []
    const listener = type.create(
      TR.Action((label: TR.Value<string>, event: TR.Value<NativeEvent>) => {
        seen.push(`${label.jsValue}:${event.jsValue.label}`)
      }).jsValue,
      { preventDefault: true },
    )
    await TR.Action(() => {
      type.add(target, 'progress', listener)
    }, { owner }).jsValue.invoke()
    const event = new NativeEvent('second argument')
    Expect(target.emit('progress', event, 'phase', event)).toBe(false)
    await settle()
    Expect(seen).toEqual(['phase:second argument'])
    owner.dispose()
  })
})
