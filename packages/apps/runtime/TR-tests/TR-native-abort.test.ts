import { Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { HostEnvironmentError } from '../TaoRuntime-src/TR-errors'
import { installNativeAbortSupport } from '../TaoRuntime-src/TR-native-abort'

type NativeEnvironment = {
  AbortController: typeof AbortController
  AbortSignal: typeof AbortSignal
  DOMException: typeof DOMException
}

function nativeEnvironment(): NativeEnvironment {
  const nativeRequire = createRequire(realpathSync(
    Repo.resolvePath('packages/apps/expo-host/node_modules/react-native/package.json'),
  ))
  const implementation = nativeRequire.resolve('abort-controller/package.json').replace(
    /package\.json$/,
    'dist/abort-controller.js',
  )
  // Fresh copies isolate prototype upgrades; package-name loading would select the runner's DOM alias.
  const module = { exports: {} }
  new Function('require', 'module', 'exports', readFileSync(implementation, 'utf8'))(
    nativeRequire,
    module,
    module.exports,
  )
  return { ...module.exports, DOMException } as NativeEnvironment
}

function installExpoPatch(environment: NativeEnvironment): Array<() => void> {
  const source = readFileSync(
    Repo.resolvePath('packages/apps/expo-host/node_modules/expo/src/winter/AbortSignal.ts'),
    'utf8',
  ).replace('export function installAbortSignalPatch', 'function installAbortSignalPatch')
  const code = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
  const timers: Array<() => void> = []
  const install = new Function(
    'AbortController',
    'DOMException',
    'setTimeout',
    `${code}\nreturn installAbortSignalPatch;`,
  )(
    environment.AbortController,
    environment.DOMException,
    (callback: () => void) => timers.push(callback),
  )
  install(environment.AbortSignal)
  return timers
}

function thrownValue(callback: () => void): unknown {
  let threw = false
  let thrown: unknown
  try {
    callback()
  } catch (error) {
    threw = true
    thrown = error
  }
  Expect(threw).toBe(true)
  return thrown
}

Describe('shared native cancellation support', () => {
  Test('upgrades existing shim objects without replacing constructors, prototypes or events', () => {
    const environment = nativeEnvironment()
    const Controller = environment.AbortController
    const Signal = environment.AbortSignal
    const controller = new Controller()
    const signal = controller.signal
    const prototype = Object.getPrototypeOf(signal)
    const dispatch = signal.dispatchEvent
    const add = signal.addEventListener
    Expect(signal.reason).toBeUndefined()
    Expect(signal.throwIfAborted).toBeUndefined()
    installNativeAbortSupport(environment)
    Expect(environment.AbortController).toBe(Controller)
    Expect(environment.AbortSignal).toBe(Signal)
    Expect(controller.signal).toBe(signal)
    Expect(Object.getPrototypeOf(signal)).toBe(prototype)
    Expect(signal instanceof Signal).toBe(true)
    Expect(signal.dispatchEvent).toBe(dispatch)
    Expect(signal.addEventListener).toBe(add)
    Expect(signal.reason).toBeUndefined()
    signal.throwIfAborted()
    const observed: unknown[] = []
    signal.addEventListener('abort', () => observed.push(signal.reason))
    signal.onabort = () => observed.push(signal.reason)
    const reason = Object.freeze({ cancelled: true })
    controller.abort(reason)
    Expect(observed).toEqual([reason, reason])
    Expect(signal.reason).toBe(reason)
    Expect(thrownValue(() => signal.throwIfAborted())).toBe(reason)
    Expect(Object.hasOwn(signal, 'reason')).toBe(false)
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'reason')
    Expect(descriptor?.get).toBeTypeOf('function')
    Expect(descriptor?.set).toBeUndefined()
  })

  Test('preserves exact explicit primitive and null reasons and creates a stable default AbortError', () => {
    const environment = nativeEnvironment()
    installNativeAbortSupport(environment)
    for (const reason of [null, false, 0, '', 'stop', Symbol('cancel')]) {
      const controller = new environment.AbortController()
      let synchronous: unknown = undefined
      controller.signal.addEventListener('abort', () => {
        synchronous = thrownValue(() => controller.signal.throwIfAborted())
      })
      controller.abort(reason)
      Expect(synchronous).toBe(reason)
      Expect(controller.signal.reason).toBe(reason)
    }
    for (const explicitUndefined of [false, true]) {
      const controller = new environment.AbortController()
      let synchronous: unknown
      controller.signal.addEventListener('abort', () => {
        synchronous = controller.signal.reason
      })
      if (explicitUndefined) {
        controller.abort(undefined)
      } else {
        controller.abort()
      }
      const reason = controller.signal.reason
      Expect(reason instanceof environment.DOMException).toBe(true)
      Expect((reason as DOMException).name).toBe('AbortError')
      Expect(synchronous).toBe(reason)
      Expect(thrownValue(() => controller.signal.throwIfAborted())).toBe(reason)
    }
  })

  Test('retains the first reason and one native dispatch through repeated and reentrant aborts', () => {
    const environment = nativeEnvironment()
    installNativeAbortSupport(environment)
    const controller = new environment.AbortController()
    const first = { first: true }
    const observed: unknown[] = []
    controller.signal.addEventListener('abort', () => {
      observed.push(controller.signal.reason)
      controller.abort({ reentrant: true })
      observed.push(controller.signal.reason)
    })
    controller.abort(first)
    controller.abort({ repeated: true })
    Expect(observed).toEqual([first, first])
    Expect(controller.signal.reason).toBe(first)
    Expect(thrownValue(() => controller.signal.throwIfAborted())).toBe(first)
  })

  Test('uses a stable default for an already aborted foreign shim with no recorded reason history', () => {
    const environment = nativeEnvironment()
    const controller = new environment.AbortController()
    controller.abort({ unrecoverable: true })
    installNativeAbortSupport(environment)
    const reason = controller.signal.reason
    Expect((reason as DOMException).name).toBe('AbortError')
    controller.abort('late')
    Expect(controller.signal.reason).toBe(reason)
    Expect(thrownValue(() => controller.signal.throwIfAborted())).toBe(reason)
  })

  Test('makes the actual Expo any and timeout patch observe reasons before native dispatch', () => {
    const environment = nativeEnvironment()
    const timers = installExpoPatch(environment)
    installNativeAbortSupport(environment)
    const source = new environment.AbortController()
    const combined = environment.AbortSignal.any([source.signal])
    const observed: unknown[] = []
    combined.addEventListener('abort', () => observed.push(combined.reason))
    source.abort(null)
    Expect(observed).toEqual([null])
    Expect(combined.reason).toBe(null)
    Expect(thrownValue(() => combined.throwIfAborted())).toBe(null)
    Expect(Object.hasOwn(combined, 'reason')).toBe(false)
    const already = environment.AbortSignal.any([source.signal])
    Expect(already.reason).toBe(null)
    Expect(Object.hasOwn(already, 'reason')).toBe(false)
    const timeout = environment.AbortSignal.timeout(0)
    let duringTimeout: unknown
    timeout.onabort = () => {
      duringTimeout = timeout.reason
    }
    Expect(timers.length).toBe(1)
    timers[0]!()
    Expect((timeout.reason as DOMException).name).toBe('TimeoutError')
    Expect(duringTimeout).toBe(timeout.reason)
    Expect(thrownValue(() => timeout.throwIfAborted())).toBe(timeout.reason)
    Expect(Object.hasOwn(timeout, 'reason')).toBe(false)
  })

  Test('installs once and leaves a fully supported host untouched', () => {
    const environment = nativeEnvironment()
    installNativeAbortSupport(environment)
    const abort = environment.AbortController.prototype.abort
    const reason = Object.getOwnPropertyDescriptor(environment.AbortSignal.prototype, 'reason')
    const throwIfAborted = environment.AbortSignal.prototype.throwIfAborted
    installNativeAbortSupport(environment)
    Expect(environment.AbortController.prototype.abort).toBe(abort)
    Expect(Object.getOwnPropertyDescriptor(environment.AbortSignal.prototype, 'reason')).toEqual(reason)
    Expect(environment.AbortSignal.prototype.throwIfAborted).toBe(throwIfAborted)
    const controllerDescriptors = Object.getOwnPropertyDescriptors(AbortController.prototype)
    const signalDescriptors = Object.getOwnPropertyDescriptors(AbortSignal.prototype)
    installNativeAbortSupport()
    Expect(Object.getOwnPropertyDescriptors(AbortController.prototype)).toEqual(controllerDescriptors)
    Expect(Object.getOwnPropertyDescriptors(AbortSignal.prototype)).toEqual(signalDescriptors)
  })

  Test('repairs partial reason support when a getter exists but the controller ignores the supplied reason', () => {
    const environment = nativeEnvironment()
    const fallback = new DOMException('The operation was aborted.', 'AbortError')
    Object.defineProperty(environment.AbortSignal.prototype, 'reason', {
      configurable: true,
      get(this: AbortSignal) {
        return this.aborted ? fallback : undefined
      },
    })
    Object.defineProperty(environment.AbortSignal.prototype, 'throwIfAborted', {
      configurable: true,
      value(this: AbortSignal) {
        if (this.aborted) {
          throw fallback
        }
      },
    })
    installNativeAbortSupport(environment)
    const controller = new environment.AbortController()
    controller.abort(null)
    Expect(controller.signal.reason).toBe(null)
    Expect(thrownValue(() => controller.signal.throwIfAborted())).toBe(null)
  })

  Test('retains native bad-receiver failures for each upgraded method and accessor', () => {
    const environment = nativeEnvironment()
    installNativeAbortSupport(environment)
    const abort = environment.AbortController.prototype.abort
    const getter = Object.getOwnPropertyDescriptor(environment.AbortSignal.prototype, 'reason')!.get!
    const check = environment.AbortSignal.prototype.throwIfAborted
    Expect(() => Reflect.apply(abort, {}, ['reason'])).toThrow(TypeError)
    Expect(() => Reflect.apply(getter, {}, [])).toThrow(TypeError)
    Expect(() => Reflect.apply(check, {}, [])).toThrow(TypeError)
    Expect(() => Reflect.apply(abort, undefined, [])).toThrow(TypeError)
  })

  Test('reports frozen and nonconfigurable unsupported protocols before changing any prototypes', () => {
    for (const member of ['signal', 'controller', 'reason', 'throwIfAborted']) {
      const environment = nativeEnvironment()
      if (member === 'signal') {
        Object.freeze(environment.AbortSignal.prototype)
      } else if (member === 'controller') {
        Object.freeze(environment.AbortController.prototype)
      } else {
        Object.defineProperty(environment.AbortSignal.prototype, member, { value: undefined, configurable: false })
      }
      const controllerDescriptors = Object.getOwnPropertyDescriptors(environment.AbortController.prototype)
      const signalDescriptors = Object.getOwnPropertyDescriptors(environment.AbortSignal.prototype)
      Expect(() => installNativeAbortSupport(environment)).toThrow(HostEnvironmentError)
      Expect(Object.getOwnPropertyDescriptors(environment.AbortController.prototype)).toEqual(controllerDescriptors)
      Expect(Object.getOwnPropertyDescriptors(environment.AbortSignal.prototype)).toEqual(signalDescriptors)
    }
  })
})
