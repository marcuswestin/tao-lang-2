import { Switch } from '@shared/core'
import React from 'react'
import { Dev, DevControls, type TaoDevModeOptions } from './dev-runtime/TR-dev'
import { AppShell } from './TR-app-shell'
import { DataControls, type TaoDataSchema } from './TR-data'
import { LayoutControls } from './TR-layout'
import { NavigationControls, type TaoNavigationStack } from './TR-navigation'
import * as TRTaoProps from './TR-TaoProps'
import * as TRViews from './TR-views'

/** TR exposes the generated-code runtime API used by generated apps. */
class TR {
  private constructor() {}

  /** Value creates runtime Tao values from JavaScript values. */
  static Value<T>(jsValue: T): TR.Value<T> {
    return new RuntimeValue(jsValue)
  }

  /** Binary applies Tao's small, deterministic binary-operator set. */
  static Binary(left: TR.Evaluable, operator: TR.BinaryOperator, right: TR.Evaluable): TR.Value<any> {
    const leftValue = left.evaluate().jsValue
    const rightValue = right.evaluate().jsValue
    return new RuntimeValue(Switch(operator, {
      '!=': () => !Object.is(leftValue, rightValue),
      '*': () => leftValue * rightValue,
      '+': () => leftValue + rightValue,
      '-': () => leftValue - rightValue,
      '/': () => leftValue / rightValue,
      '<': () => leftValue < rightValue,
      '<=': () => leftValue <= rightValue,
      '==': () => Object.is(leftValue, rightValue),
      '>': () => leftValue > rightValue,
      '>=': () => leftValue >= rightValue,
      and: () => Boolean(leftValue && rightValue),
      or: () => Boolean(leftValue || rightValue),
    }))
  }

  /** Unary applies Tao boolean negation or numeric negation. */
  static Unary(operator: TR.UnaryOperator, operand: TR.Evaluable): TR.Value<any> {
    const value = operand.evaluate().jsValue
    return new RuntimeValue(Switch(operator, {
      '-': () => -value,
      not: () => !value,
    }))
  }

  /** Interpolate concatenates Tao values, rendering absence as an empty string. */
  static Interpolate(parts: readonly TR.Evaluable[]): TR.Value<string> {
    return new RuntimeValue(parts.map(part => part.evaluate().jsValue).map(value => value ?? '').join(''))
  }

  /** Conditional evaluates only the selected expression branch. */
  static Conditional<T>(
    condition: TR.Value<boolean>,
    whenTrue: () => TR.Value<T>,
    whenFalse: () => TR.Value<T>,
  ): TR.Value<T> {
    return condition.evaluate().jsValue ? whenTrue() : whenFalse()
  }

  /** Member reads item fields and the built-in Empty/Count collection and text members. */
  static Member(root: TR.Evaluable, path: readonly string[]): TR.Value<any> {
    let value = root.evaluate().jsValue
    for (const member of path) {
      if ((Array.isArray(value) || typeof value === 'string') && member === 'Empty') {
        value = value.length === 0
        continue
      }
      if ((Array.isArray(value) || typeof value === 'string') && member === 'Count') {
        value = value.length
        continue
      }
      value = value?.[member]
    }
    return new RuntimeValue(value)
  }

  /** Function creates a Tao pure-function value. */
  static Function(body: (...args: any[]) => TR.Value<any>): TR.Function {
    return new RuntimeFunction(body)
  }

  /** Call invokes a Tao pure function with runtime-wrapped values. */
  static Call<T>(fn: TR.Function, ...args: TR.Evaluable[]): TR.Value<T> {
    return fn.invoke(...args) as TR.Value<T>
  }

  /** If selects one lazy render branch. */
  static If(
    condition: TR.Value<boolean>,
    whenTrue: () => React.ReactNode,
    whenFalse?: () => React.ReactNode,
  ): React.ReactNode {
    return condition.evaluate().jsValue ? whenTrue() : whenFalse?.() ?? null
  }

  /** ForEach renders a stable fragment for each list value. */
  static ForEach(
    collection: TR.Evaluable,
    render: (value: TR.Value<any>, index: number) => React.ReactNode,
  ): React.ReactNode {
    const values = collection.evaluate().jsValue
    if (!Array.isArray(values)) {
      return null
    }
    return values.map((value, index) =>
      React.createElement(
        React.Fragment,
        { key: stableListKey(value, index) },
        render(new RuntimeValue(value), index),
      )
    )
  }

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
    return Switch(operator, {
      '+=': () => new RuntimeValue(current + next),
      '-=': () => new RuntimeValue(current - next),
      '*=': () => new RuntimeValue(current * next),
      '/=': () => new RuntimeValue(current / next),
    })
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

  /** TaoProps creates a Tao-owned props bag with optional inherited caller props. */
  static TaoProps(localProps: TR.TaoProps, callerProps?: TR.TaoProps): TR.TaoProps {
    if (!callerProps) {
      return localProps
    }

    const inheritedParentDirection = parentDirectionFromProps(callerProps)
    return inheritedParentDirection && localProps.parentDirection === undefined
      ? { ...localProps, parentDirection: inheritedParentDirection, callerProps }
      : { ...localProps, callerProps }
  }

  /** setDevMode configures Tao runtime development-only diagnostics. */
  static setDevMode(options?: TR.DevModeOptions): void {
    Dev.setMode(options)
  }

  /** AppShell wraps generated app roots in Tao's safe default app frame. */
  static readonly AppShell = AppShell

  /** Dev exposes public Tao runtime development-only diagnostic controls. */
  static readonly Dev = DevControls

  /** Data exposes provider-neutral reactive schemas, queries, and mutations. */
  static readonly Data = DataControls

  /** Layout exposes deterministic runtime lowering for Tao layout clauses. */
  static readonly Layout = LayoutControls

  /** Navigation exposes deterministic stack history, presentation, and back behavior. */
  static readonly Navigation = NavigationControls

  /** Views exposes runtime-backed Tao stdlib primitives. */
  static readonly Views = TRViews.Views
}

function parentDirectionFromProps(props: TR.TaoProps | undefined): TR.TaoProps['parentDirection'] {
  if (!props) {
    return undefined
  }
  return props.parentDirection ?? parentDirectionFromProps(props.callerProps)
}

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

class RuntimeFunction {
  constructor(private readonly body: (...args: any[]) => TR.Value<any>) {}

  invoke(...args: TR.Evaluable[]): TR.Value<any> {
    return this.body(...args)
  }
}

function stableListKey(value: unknown, index: number): string | number {
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const key = record['Id'] ?? record['id']
    if (typeof key === 'string' || typeof key === 'number') {
      return key
    }
  }
  return index
}

namespace TR {
  /** Action declares a runtime Tao action wrapper. */
  export type Action = RuntimeAction
  /** ActionValue declares the JavaScript payload for an evaluated Tao action. */
  export type ActionValue = RuntimeActionValue
  /** BinaryOperator declares the shipped Tao binary operators. */
  export type BinaryOperator = '!=' | '*' | '+' | '-' | '/' | '<' | '<=' | '==' | '>' | '>=' | 'and' | 'or'
  /** Alias declares a runtime Tao alias wrapper. */
  export type Alias<T> = RuntimeAlias<T>
  /** AliasValue declares the evaluated runtime value for a Tao alias. */
  export type AliasValue<T> = T extends TR.Action ? TR.Action : TR.Value<T>
  /** CompoundSetOperator declares supported numeric compound state update operators. */
  export type CompoundSetOperator = '+=' | '-=' | '*=' | '/='
  /** Evaluable declares runtime values that can collapse to their current value. */
  export type Evaluable = { evaluate(): any }
  /** Function declares a runtime Tao pure function. */
  export type Function = RuntimeFunction
  /** State declares a runtime Tao state wrapper. */
  export type State<T> = RuntimeState<T>
  /** Value declares a runtime Tao value wrapper. */
  export type Value<T> = RuntimeValue<T>
  /** UnaryOperator declares the shipped Tao unary operators. */
  export type UnaryOperator = '-' | 'not'
  /** Scope declares generated Tao runtime declaration storage. */
  export type Scope = Record<string, any>
  /** TaoProps declares the Tao-owned props bag generated views receive as the `__tao` prop. */
  export type TaoProps = TRTaoProps.TaoProps
  /** DevModeOptions declares runtime development-only diagnostic flags. */
  export type DevModeOptions = TaoDevModeOptions
  /** DataSchema declares one runtime-backed Tao data schema. */
  export type DataSchema = TaoDataSchema
  /** NavigationStack declares one runtime-backed Tao application stack. */
  export type NavigationStack = TaoNavigationStack
}

export default TR
