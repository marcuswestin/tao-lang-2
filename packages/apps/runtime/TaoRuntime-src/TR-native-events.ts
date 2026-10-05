import { actionOwner, registerActionCleanup } from './TR-action-transactions'
import type { TaoEvaluable } from './TR-action-values'
import { RuntimeAssert } from './TR-assert'
import { reportUnownedFailure } from './TR-errors'
import { nativeAsyncCallbacks } from './TR-native-async-callbacks'
import { createNativeReferenceType } from './TR-native-references'
import type { TaoActionOwner } from './TR-native-subscription'

export type NativeEventControl = 'preventDefault' | 'stopPropagation' | 'stopImmediatePropagation'
export type NativeEventPolicy = Readonly<Partial<Record<NativeEventControl, boolean>>>
export type NativeEventAction<Args extends unknown[] = unknown[]> = {
  invoke(...args: Args): unknown
  nativeEventActive?(): boolean
  invokeNativeEvent?(...args: Args): unknown
}

const syntheticControls: readonly NativeEventControl[] = ['preventDefault', 'stopPropagation']
const policies = new WeakMap<object, NativeEventPolicy>()

/** Snapshot modifiers on a distinct action while retaining every original method's receiver. */
export function nativeEventControls<ActionT extends object>(
  action: ActionT,
  policy: NativeEventPolicy,
  owner?: TaoActionOwner,
): ActionT {
  const captured: NativeEventPolicy = Object.freeze({
    preventDefault: policy.preventDefault === true,
    stopPropagation: policy.stopPropagation === true,
    stopImmediatePropagation: policy.stopImmediatePropagation === true,
  })
  return decorate(action, captured, owner)
}

function decorate<ActionT extends object>(action: ActionT, policy: NativeEventPolicy, owner?: TaoActionOwner): ActionT {
  const bound = new Map<PropertyKey, { original: Function; method: Function }>()
  const payloads = new WeakMap<object, object>()
  const active = () => {
    const original = Reflect.get(action, 'nativeEventActive', action)
    return owner?.active !== false && (typeof original !== 'function' || Reflect.apply(original, action, []) !== false)
  }
  const invokeOwned = (...args: unknown[]) => {
    const original = Reflect.get(action, 'invokeOwned', action)
    RuntimeAssert.input(typeof original === 'function', 'A native event binding requires an owned Tao action.')
    return Reflect.apply(original, action, [owner, active, ...args])
  }
  const decoration: ActionT = new Proxy(Object.create(Object.getPrototypeOf(action)) as ActionT, {
    get(_target, property) {
      if (owner !== undefined && property === 'nativeEventActive') {
        return active
      }
      if (owner !== undefined && property === 'invokeNativeEvent') {
        return invokeOwned
      }
      const value = Reflect.get(action, property, action)
      if (property === 'jsValue' && isObject(value)) {
        let payload = payloads.get(value)
        if (payload === undefined) {
          payload = decorate(value, policy, owner)
          payloads.set(value, payload)
        }
        return payload
      }
      if (typeof value !== 'function') {
        return value
      }
      const cached = bound.get(property)
      if (cached?.original === value) {
        return cached.method
      }
      const method = property === 'evaluate'
        ? (...args: unknown[]) => {
          const evaluated = Reflect.apply(value, action, args)
          return evaluated === action ? decoration : decorate(evaluated, policy, owner)
        }
        : value.bind(action)
      bound.set(property, { original: value, method })
      return method
    },
    ownKeys: () => Reflect.ownKeys(action),
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Object.getOwnPropertyDescriptor(action, property)
      return descriptor === undefined ? undefined : { ...descriptor, configurable: true }
    },
  })
  policies.set(decoration, policy)
  return decoration
}

/** Native controls run synchronously; absent events also support semantic accessibility activation. */
export function applyNativeEventPolicy(
  event: unknown,
  policy: NativeEventPolicy,
  permittedControls: readonly NativeEventControl[],
): void {
  if (!isObject(event)) {
    return
  }
  for (const control of permittedControls) {
    if (policy[control] !== true) {
      continue
    }
    const method = Reflect.get(event, control, event)
    RuntimeAssert.input(typeof method === 'function', `The native event does not support '${control}'.`)
    Reflect.apply(method, event, [])
  }
}

/** Preserve ordinary invocation; controlled bindings apply controls before queueing their body. */
export function invokeNativeEvent<Args extends unknown[]>(
  action: NativeEventAction<Args> | TaoEvaluable<NativeEventAction<Args>>,
  rawEvent: unknown,
  ...taoArgs: Args
): unknown {
  const value = 'evaluate' in action ? action.evaluate().jsValue : action
  if (value.nativeEventActive?.() === false) {
    return
  }
  const policy = policies.get(value) ?? policies.get(action)
  if (policy === undefined) {
    return value.invokeNativeEvent ? value.invokeNativeEvent(...taoArgs) : value.invoke(...taoArgs)
  }
  applyNativeEventPolicy(rawEvent, policy, syntheticControls)
  queueMicrotask(() => {
    if (value.nativeEventActive?.() === false) {
      return
    }
    try {
      const result = value.invokeNativeEvent ? value.invokeNativeEvent(...taoArgs) : value.invoke(...taoArgs)
      if (result !== undefined) {
        void Promise.resolve(result).catch(reportUnownedFailure)
      }
    } catch (error) {
      reportUnownedFailure(error)
    }
  })
}

function isObject(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

export type NativeEventCallback = Function | { handleEvent: Function }
export type NativeEventTarget = { addEventListener: Function; removeEventListener: Function }
export type NativeAbortSignal = NativeEventTarget & { readonly aborted: boolean }
export type NativeEventListenerOptions = Readonly<{
  capture?: boolean
  once?: boolean
  passive?: boolean
  signal?: NativeAbortSignal
}>
export type NativeOwnedEventAction<Args extends unknown[]> = {
  nativeEventActive?(): boolean
  invokeOwned(owner: TaoActionOwner, active: () => boolean, ...args: Args): void | Promise<void>
}

type AsyncCallbacks = ReturnType<typeof nativeAsyncCallbacks>
type ListenerDefinition = {
  active(): boolean
  policy: NativeEventPolicy
  permittedControls: readonly NativeEventControl[]
  eventArgumentIndex: number
  invoke(scope: AsyncCallbacks, rawArgs: unknown[], settled: () => void): void
}
type Registration = {
  active: boolean
  callback: NativeEventCallback
  wrapper: (...args: unknown[]) => void
  scope: AsyncCallbacks
  remove(): void
  detach(cancel: boolean): void
  previous?: unknown
}

// Identity is native object identity across descriptor aliases, never a package or display name.
const listenerDefinitions = new WeakMap<object, ListenerDefinition>()
const wrapperSources = new WeakMap<object, NativeEventCallback>()
const registeredCallbacks = new WeakMap<object, Set<Registration>>()
const callbackScopes = new WeakMap<object, Set<AsyncCallbacks>>()
const targetEvents = new WeakMap<object, Map<string, Map<object, Map<boolean, Registration>>>>()
const targetProperties = new WeakMap<object, Map<string, Registration>>()

/** A typed listener descriptor owns conversion; the shared registry owns physical registration. */
export function createNativeEventListenerType<Args extends unknown[]>(
  name: string,
  convert: (...rawArgs: unknown[]) => Args,
  permittedControls: readonly NativeEventControl[],
  eventArgumentIndex = 0,
) {
  const references = createNativeReferenceType(
    name,
    (value): value is NativeEventCallback =>
      typeof value === 'function' || isObject(value) && typeof Reflect.get(value, 'handleEvent', value) === 'function',
  )
  const permitted = Object.freeze([...permittedControls])

  function register(
    target: object,
    callback: NativeEventCallback,
    options: NativeEventListenerOptions,
    install: (wrapper: Function) => void,
    uninstall: (registration: Registration) => void,
    previous?: unknown,
  ): Registration {
    const scope = nativeAsyncCallbacks()
    const owner = actionOwner()!
    const scopes = callbackScopes.get(callback) ?? new Set<AsyncCallbacks>()
    callbackScopes.set(callback, scopes)
    scopes.add(scope)
    const registrations = registeredCallbacks.get(callback) ?? new Set<Registration>()
    registeredCallbacks.set(callback, registrations)
    const definition = listenerDefinitions.get(callback)
    const abort = () => registration.remove()
    const registration: Registration = {
      active: true,
      callback,
      scope,
      previous,
      wrapper(...rawArgs: unknown[]) {
        if (!registration.active || !scope.active || definition?.active() === false) {
          return
        }
        if (options.once) {
          registration.detach(false)
        }
        let accepted = false
        try {
          if (definition) {
            applyNativeEventPolicy(
              rawArgs[definition.eventArgumentIndex],
              definition.policy,
              options.passive
                ? definition.permittedControls.filter(control => control !== 'preventDefault')
                : definition.permittedControls,
            )
            definition.invoke(scope, rawArgs, () => {
              if (!scope.active) {
                scopes.delete(scope)
              }
            })
            accepted = true
          } else if (typeof callback === 'function') {
            Reflect.apply(callback, target, rawArgs)
          } else {
            Reflect.apply(callback.handleEvent, callback, rawArgs)
          }
        } catch (error) {
          reportUnownedFailure(error)
        } finally {
          if (options.once) {
            scope.finishCall()
            if (!accepted) {
              scopes.delete(scope)
            }
          }
        }
      },
      detach(cancel) {
        if (cancel) {
          scope.cancel()
          scopes.delete(scope)
        }
        if (!registration.active) {
          return
        }
        registration.active = false
        registrations.delete(registration)
        owner.subscriptions.delete(registration.remove)
        try {
          uninstall(registration)
        } catch (error) {
          reportUnownedFailure(error)
        }
        if (options.signal) {
          try {
            Reflect.apply(options.signal.removeEventListener, options.signal, ['abort', abort])
          } catch (error) {
            reportUnownedFailure(error)
          }
        }
      },
      remove() {
        registration.detach(true)
      },
    }
    registrations.add(registration)
    wrapperSources.set(registration.wrapper, callback)
    owner.subscriptions.add(registration.remove)
    registerActionCleanup(registration.remove)
    try {
      if (options.signal) {
        Reflect.apply(options.signal.addEventListener, options.signal, ['abort', abort, { once: true }])
      }
      if (options.signal?.aborted) {
        registration.remove()
      } else {
        install(registration.wrapper)
      }
    } catch (error) {
      registration.remove()
      throw error
    }
    return registration
  }

  return {
    create(action: NativeOwnedEventAction<Args>, policy?: NativeEventPolicy) {
      const callback = () => RuntimeAssert.input(false, `Register the ${name} native listener before invoking it.`)
      const captured = Object.freeze({ ...(policy ?? policies.get(action) ?? {}) })
      listenerDefinitions.set(callback, {
        active: () => action.nativeEventActive?.() !== false,
        policy: captured,
        permittedControls: permitted,
        eventArgumentIndex,
        invoke(scope, rawArgs, settled) {
          scope.invoke({
            invokeOwned(owner, active, ...args: Args) {
              try {
                const result = action.invokeOwned(owner, active, ...args)
                if (result === undefined) {
                  settled()
                  return
                }
                return Promise.resolve(result).finally(settled)
              } catch (error) {
                settled()
                throw error
              }
            },
          }, ...convert(...rawArgs))
        },
      })
      return references.wrap(callback)
    },
    wrap: references.wrap,
    unwrap: references.unwrap,
    is: references.is,
    release(listener: unknown): void {
      if (!references.is(listener)) {
        references.release(listener)
        return
      }
      const callback = references.unwrap(listener)
      for (const registration of [...(registeredCallbacks.get(callback) ?? [])]) {
        registration.remove()
      }
      for (const scope of [...(callbackScopes.get(callback) ?? [])]) {
        scope.cancel()
      }
      callbackScopes.delete(callback)
      references.release(listener)
    },
    add(
      target: NativeEventTarget,
      eventName: string,
      listener: unknown,
      options: boolean | NativeEventListenerOptions = {},
    ): void {
      if (listener === null) {
        return
      }
      const callback = references.unwrap(listener)
      const normalized = typeof options === 'boolean' ? { capture: options } : options
      const capture = normalized.capture === true
      const events = targetEvents.get(target) ?? new Map<string, Map<object, Map<boolean, Registration>>>()
      targetEvents.set(target, events)
      const listeners = events.get(eventName) ?? new Map<object, Map<boolean, Registration>>()
      events.set(eventName, listeners)
      const captures = listeners.get(callback) ?? new Map<boolean, Registration>()
      listeners.set(callback, captures)
      if (captures.get(capture)?.active) {
        return
      }
      if (normalized.signal?.aborted) {
        if (captures.size === 0) {
          listeners.delete(callback)
        }
        if (listeners.size === 0) {
          events.delete(eventName)
        }
        return
      }
      const registration = register(
        target,
        callback,
        normalized,
        wrapper =>
          Reflect.apply(target.addEventListener, target, [eventName, wrapper, {
            capture,
            once: normalized.once === true,
            passive: normalized.passive === true,
          }]),
        entry => {
          captures.delete(capture)
          if (captures.size === 0) {
            listeners.delete(callback)
          }
          if (listeners.size === 0) {
            events.delete(eventName)
          }
          Reflect.apply(target.removeEventListener, target, [eventName, entry.wrapper, capture])
        },
      )
      if (registration.active) {
        captures.set(capture, registration)
      }
    },
    remove(
      target: NativeEventTarget,
      eventName: string,
      listener: unknown,
      options: boolean | Pick<NativeEventListenerOptions, 'capture'> = {},
    ): void {
      if (listener === null) {
        return
      }
      const callback = references.unwrap(listener)
      const capture = typeof options === 'boolean' ? options : options.capture === true
      const entry = targetEvents.get(target)?.get(eventName)?.get(callback)?.get(capture)
      if (entry) {
        entry.remove()
      } else {
        Reflect.apply(target.removeEventListener, target, [eventName, callback, capture])
      }
    },
    get(target: object, property: string) {
      const callback = Reflect.get(target, property, target)
      if (callback === null || callback === undefined) {
        return null
      }
      return references.wrap(wrapperSources.get(callback) ?? callback)
    },
    set(target: object, property: string, listener: unknown | null): void {
      const properties = targetProperties.get(target) ?? new Map<string, Registration>()
      targetProperties.set(target, properties)
      const previousEntry = properties.get(property)
      const current = Reflect.get(target, property, target)
      const previous = previousEntry !== undefined && current === previousEntry.wrapper
        ? previousEntry.previous
        : current
      const callback = listener === null ? null : references.unwrap(listener)
      if (
        previousEntry?.active && previousEntry.callback === callback
        && current === previousEntry.wrapper
      ) {
        return
      }
      // Replacing the property cancels only the owned guard; the new native assignment owns the slot.
      if (previousEntry) {
        previousEntry.detach(true)
      }
      if (callback === null) {
        RuntimeAssert.input(
          Reflect.set(target, property, null, target),
          `The native callback property '${property}' cannot be changed.`,
        )
        return
      }
      const registration = register(target, callback, {}, wrapper => {
        RuntimeAssert.input(
          Reflect.set(target, property, wrapper, target),
          `The native callback property '${property}' cannot be changed.`,
        )
      }, entry => {
        if (properties.get(property) === entry) {
          properties.delete(property)
        }
        if (Reflect.get(target, property, target) === entry.wrapper) {
          Reflect.set(target, property, entry.previous ?? null, target)
        }
      }, previous)
      if (registration.active) {
        properties.set(property, registration)
      }
    },
  }
}
