import { RuntimeAssert } from './TR-assert'
import { ErrorControls } from './TR-errors'

type Signal = {
  readonly aborted: boolean
  readonly reason?: unknown
  throwIfAborted?(): void
  addEventListener(type: string, listener: () => void): void
}
type Controller = { readonly signal: Signal; abort(reason?: unknown): void }
type AbortEnvironment = {
  AbortController: { new(): Controller; readonly prototype: Controller }
  AbortSignal: { readonly prototype: Signal }
  DOMException: new(message?: string, name?: string) => { readonly name: string }
}

const installed = new WeakMap<object, object>()

/** Upgrade the installed native protocol after the host's bootstrap, retaining native identity/events. */
export function installNativeAbortSupport(environment: AbortEnvironment = globalThis): void {
  const { AbortController: Controller, AbortSignal: Signal, DOMException } = environment
  if (typeof Controller !== 'function' || !Signal?.prototype || typeof DOMException !== 'function') {
    unsupported('The host must install its cancellation constructors before starting the app.')
  }
  const controllerPrototype = Controller.prototype
  const signalPrototype = Signal.prototype
  if (installed.get(controllerPrototype) === signalPrototype) {
    return
  }
  const nativeAbort = controllerPrototype.abort
  const signalGetter = descriptor(controllerPrototype, 'signal')?.get
  const abortedGetter = descriptor(signalPrototype, 'aborted')?.get
  if (typeof nativeAbort !== 'function' || !signalGetter || !abortedGetter) {
    unsupported('The host cancellation protocol requires native signal and aborted accessors.')
  }
  const readAborted = (signal: Signal): boolean => Reflect.apply(abortedGetter, signal, [])
  const capabilities = probe(Controller, nativeAbort)
  const replaceReason = !capabilities.reason
  const replaceThrow = !capabilities.throwIfAborted
  if (!replaceReason && !replaceThrow) {
    installed.set(controllerPrototype, signalPrototype)
    return
  }

  // Preflight every required descriptor before changing any shared prototype.
  if (replaceReason) {
    requireReplaceable(signalPrototype, 'reason')
    requireReplaceable(controllerPrototype, 'abort')
  }
  if (replaceThrow) {
    requireReplaceable(signalPrototype, 'throwIfAborted')
  }
  const reasons = new WeakMap<object, unknown>()
  const previousReason = descriptor(signalPrototype, 'reason')?.get
  const defaultReason = () => new DOMException('The operation was aborted.', 'AbortError')
  const reasonOf = (signal: Signal): unknown => {
    if (!readAborted(signal)) {
      return undefined
    }
    if (!reasons.has(signal)) {
      // A foreign signal aborted before installation has no recoverable custom-reason history.
      const previous = previousReason ? Reflect.apply(previousReason, signal, []) : undefined
      reasons.set(signal, previous === undefined ? defaultReason() : previous)
    }
    return reasons.get(signal)
  }
  if (replaceReason) {
    const previous = Object.getOwnPropertyDescriptor(signalPrototype, 'reason')
    Object.defineProperty(signalPrototype, 'reason', {
      configurable: previous?.configurable ?? true,
      enumerable: previous?.enumerable ?? false,
      get(this: Signal) {
        return reasonOf(this)
      },
    })
    const previousAbort = Object.getOwnPropertyDescriptor(controllerPrototype, 'abort')
    Object.defineProperty(controllerPrototype, 'abort', {
      configurable: previousAbort?.configurable ?? true,
      enumerable: previousAbort?.enumerable ?? false,
      writable: previousAbort?.writable ?? true,
      value: function abort(this: Controller, ...args: unknown[]): void {
        // The original getter retains native receiver validation, including extracted method calls.
        const signal: Signal = Reflect.apply(signalGetter, this, [])
        if (!readAborted(signal) && !reasons.has(signal)) {
          reasons.set(signal, args[0] === undefined ? defaultReason() : args[0])
        }
        return Reflect.apply(nativeAbort, this, args)
      },
    })
  }
  if (replaceThrow) {
    const previous = Object.getOwnPropertyDescriptor(signalPrototype, 'throwIfAborted')
    Object.defineProperty(signalPrototype, 'throwIfAborted', {
      configurable: previous?.configurable ?? true,
      enumerable: previous?.enumerable ?? false,
      writable: previous?.writable ?? true,
      value: function throwIfAborted(this: Signal): void {
        if (readAborted(this)) {
          // This checked native effect must throw the exact reason, including primitives and null.
          throw this.reason
        }
      },
    })
  }
  installed.set(controllerPrototype, signalPrototype)
}

function descriptor(object: object, name: string): PropertyDescriptor | undefined {
  for (let current: object | null = object; current !== null; current = Object.getPrototypeOf(current)) {
    const found = Object.getOwnPropertyDescriptor(current, name)
    if (found) {
      return found
    }
  }
  return undefined
}

function requireReplaceable(prototype: object, name: string): void {
  const current = Object.getOwnPropertyDescriptor(prototype, name)
  if (current ? !current.configurable && !(name !== 'reason' && current.writable) : !Object.isExtensible(prototype)) {
    unsupported(`The host cancellation protocol cannot upgrade its '${name}' property.`)
  }
}

function unsupported(message: string): never {
  return ErrorControls.failHost(message)
}

function probe(Controller: AbortEnvironment['AbortController'], abort: Controller['abort']) {
  let reason = true
  let throwIfAborted = true
  for (const expected of [Object.freeze({}), null]) {
    const controller = new Controller()
    const signal = controller.signal
    RuntimeAssert(!signal.aborted, 'a newly constructed cancellation signal is active')
    reason = reason && signal.reason === undefined
    let dispatched = false
    let synchronousReason: unknown
    signal.addEventListener('abort', () => {
      dispatched = true
      synchronousReason = signal.reason
    })
    Reflect.apply(abort, controller, [expected])
    reason = reason && signal.aborted && dispatched && synchronousReason === expected && signal.reason === expected
    Reflect.apply(abort, controller, ['later'])
    reason = reason && signal.reason === expected
    if (typeof signal.throwIfAborted !== 'function') {
      throwIfAborted = false
    } else {
      let threw = false
      let thrown: unknown
      try {
        signal.throwIfAborted()
      } catch (error) {
        threw = true
        thrown = error
      }
      throwIfAborted = throwIfAborted && threw && thrown === expected
    }
  }
  return { reason, throwIfAborted }
}
