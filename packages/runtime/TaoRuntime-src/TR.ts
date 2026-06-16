import React from 'react'
import { type ReactNativeRuntime, setReactNativeRuntime, type TaoProps as ViewTaoProps, Views } from './TR-views'

class RuntimeValue<T> {
  constructor(readonly jsValue: T) {}

  evaluate(): RuntimeValue<T> {
    return this
  }
}

class RuntimeAlias<T> {
  constructor(private readonly value: TR.Evaluable | (() => TR.Evaluable)) {}

  evaluate(): TR.AliasValue<T> {
    return (typeof this.value === 'function' ? this.value() : this.value).evaluate() as TR.AliasValue<T>
  }
}

class RuntimeState<T> {
  constructor(
    private readonly jsValueRef: { current: T },
    private readonly setJsValue: React.Dispatch<React.SetStateAction<T>>,
  ) {}

  evaluate(): RuntimeValue<T> {
    return new RuntimeValue(this.jsValueRef.current)
  }

  set(value: TR.Value<T>): void {
    const nextValue = value.evaluate().jsValue
    this.jsValueRef.current = nextValue
    this.setJsValue(nextValue)
  }
}

class RuntimeActionValue {
  constructor(private readonly body: (...args: any[]) => void) {}

  invoke(...args: any[]): void {
    this.body(...args)
  }
}

class RuntimeAction {
  readonly jsValue: RuntimeActionValue

  constructor(body: (...args: any[]) => void) {
    this.jsValue = new RuntimeActionValue(body)
  }

  evaluate(): RuntimeAction {
    return this
  }
}

/** TR exposes the generated-code runtime API used by generated apps. */
class TR {
  private constructor() {}

  /** Value creates runtime Tao values from JavaScript values. */
  static readonly Value = RuntimeValue

  /** Action creates runtime Tao actions from generated callbacks. */
  static Action(body: (...args: any[]) => void): TR.Action {
    return new RuntimeAction(body)
  }

  /** Alias creates live runtime Tao aliases that intentionally re-evaluate their initializer on every read. */
  static Alias<T>(value: TR.Evaluable | (() => TR.Evaluable)): TR.Alias<T> {
    return new RuntimeAlias(value)
  }

  /** BlockScope creates a child scope that can shadow parent declarations. */
  static BlockScope<ScopeT extends TR.Scope, ReturnT>(parentScope: ScopeT, body: (scope: ScopeT) => ReturnT): ReturnT {
    const scope = Object.create(parentScope) as ScopeT
    return body(scope)
  }

  /** CompoundSet returns the numeric value produced by a Tao compound state update. */
  static CompoundSet(
    state: TR.State<number>,
    operator: TR.CompoundSetOperator,
    value: TR.Value<number>,
  ): TR.Value<number> {
    const current = state.evaluate().jsValue
    const next = value.evaluate().jsValue
    switch (operator) {
      case '+=':
        return new RuntimeValue(current + next)
      case '-=':
        return new RuntimeValue(current - next)
      case '*=':
        return new RuntimeValue(current * next)
      case '/=':
        return new RuntimeValue(current / next)
    }
  }

  /** Do invokes a Tao action value with already-compiled runtime arguments. */
  static Do(action: TR.Action, ...args: any[]): void {
    action.evaluate().jsValue.invoke(...args)
  }

  /** Set updates a Tao state value. */
  static Set<T>(state: TR.State<T>, value: () => TR.Value<T>): void {
    state.set(value())
  }

  /** State creates view-local reactive Tao state. */
  static State<T>(initialValue: () => TR.Value<T>): TR.State<T> {
    const [jsValue, setJsValue] = React.useState<T>(() => initialValue().evaluate().jsValue)
    const jsValueRef = React.useRef(jsValue)
    jsValueRef.current = jsValue
    return new RuntimeState(jsValueRef, setJsValue)
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
  /** Action declares a runtime Tao action wrapper. */
  export type Action = RuntimeAction
  /** ActionValue declares the JavaScript payload for an evaluated Tao action. */
  export type ActionValue = RuntimeActionValue
  /** Alias declares a runtime Tao alias wrapper. */
  export type Alias<T> = RuntimeAlias<T>
  /** AliasValue declares the evaluated runtime value for a Tao alias. */
  export type AliasValue<T> = T extends TR.Action ? TR.Action : TR.Value<T>
  /** CompoundSetOperator declares supported numeric compound state update operators. */
  export type CompoundSetOperator = '+=' | '-=' | '*=' | '/='
  /** Evaluable declares runtime values that can collapse to their current value. */
  export type Evaluable = { evaluate(): any }
  /** State declares a runtime Tao state wrapper. */
  export type State<T> = RuntimeState<T>
  /** Value declares a runtime Tao value wrapper. */
  export type Value<T> = RuntimeValue<T>
  /** Scope declares generated Tao runtime declaration storage. */
  export type Scope = Record<string, any>
  /** TaoProps declares the Tao-owned props bag generated views receive as the `__tao` prop. */
  export type TaoProps = ViewTaoProps
}

export default TR
