import { type ReactNativeRuntime, setReactNativeRuntime, type TaoProps as ViewTaoProps, Views } from './TR-views'

class RuntimeValue<T> {
  constructor(readonly jsValue: T) {}

  evaluate(): TR.Value<T> {
    return this
  }
}

class RuntimeAlias<T> {
  private evaluatedValue?: TR.Value<T>

  constructor(private readonly value: TR.Value<T> | (() => TR.Value<T>)) {}

  evaluate(): TR.Value<T> {
    this.evaluatedValue ??= (typeof this.value === 'function' ? this.value() : this.value).evaluate()
    return this.evaluatedValue
  }
}

/** TR exposes the generated-code runtime API used by generated apps. */
class TR {
  private constructor() {}

  /** Value creates runtime Tao values from JavaScript values. */
  static readonly Value = RuntimeValue

  /** Alias creates runtime Tao aliases from eager or lazy Tao values. */
  static Alias<T>(value: TR.Value<T> | (() => TR.Value<T>)): TR.Alias<T> {
    return new RuntimeAlias(value)
  }

  /** BlockScope creates a child scope that can shadow parent declarations. */
  static BlockScope<ScopeT extends TR.Scope, ReturnT>(parentScope: ScopeT, body: (scope: ScopeT) => ReturnT): ReturnT {
    const scope = Object.create(parentScope) as ScopeT
    return body(scope)
  }

  /** Use binds an imported module declaration into a file scope as a lazy, live binding. */
  static Use(scope: TR.Scope, name: string, getValue: () => unknown): void {
    Object.defineProperty(scope, name, {
      // Lazy reads keep circular module imports working: the imported binding is only
      // dereferenced when used, after module initialization.
      get: getValue,
      // Assignments through child scopes must still shadow on the receiver instead of
      // throwing against a get-only prototype property.
      set(value: unknown) {
        Object.defineProperty(this, name, { value, writable: true, enumerable: true, configurable: true })
      },
      enumerable: true,
      configurable: true,
    })
  }

  /** setReactNativeRuntime sets the runtime RN component set used by TR.Views. */
  static setReactNativeRuntime(runtime: ReactNativeRuntime): void {
    setReactNativeRuntime(runtime)
  }

  /** Views exposes runtime-backed Tao stdlib primitives. */
  static readonly Views = Views
}

namespace TR {
  /** Value declares a runtime Tao value wrapper. */
  export type Value<T> = RuntimeValue<T>
  /** Alias declares a runtime Tao alias wrapper. */
  export type Alias<T> = RuntimeAlias<T>
  /** Scope declares generated Tao runtime declaration storage. */
  export type Scope = Record<string, any>
  /** TaoProps declares the Tao-owned props bag generated views receive as the `__tao` prop. */
  export type TaoProps = ViewTaoProps
}

export default TR
