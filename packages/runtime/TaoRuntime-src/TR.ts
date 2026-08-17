import React from 'react'
import { Dev, DevControls, type TaoDevModeOptions } from './dev-runtime/TR-dev'
import { AppShell } from './TR-app-shell'
import {
  DataControls,
  DataProviderControls,
  type TaoConfiguredDatasource,
  type TaoDataProvider,
  type TaoDataSchema,
  type TaoDatasourceDeclaration,
  testProvider as testDataProvider,
} from './TR-data'
import {
  DesignControls,
  type TaoDesign,
  type TaoDesignSpec,
} from './TR-design'
import { reportUnownedFailure } from './TR-errors'
import { LayoutControls } from './TR-layout'
import {
  NavigationControls,
  NavKindControls,
  type TaoNavDeclaration,
  type TaoNavDescriptor,
  type TaoNavigationValue,
  type TaoNavKind,
  type TaoNavKindProfile,
  type TaoNavMount,
  type TaoPresentable,
  type TaoSelectionNavConfiguration,
  type TaoSlotNavConfiguration,
  type TaoStackNavConfiguration,
  testNavKind as testNavigationKind,
} from './TR-navigation'
import { SelectableRow } from './TR-selectable-row'
import RuntimeSwitch from './TR-switch'
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
    return new RuntimeValue(RuntimeSwitch(operator, {
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
    return new RuntimeValue(RuntimeSwitch<TR.UnaryOperator, any>(operator, {
      '-': () => -value,
      not: () => !value,
    }))
  }

  /** Interpolate concatenates Tao values, rendering absence as an empty string. */
  static Interpolate(parts: readonly TR.Evaluable[]): TR.Value<string> {
    return new RuntimeValue(parts.map(part => part.evaluate().jsValue).map(value => value ?? '').join(''))
  }

  /** Enum creates declaration-owned case identities without a process-global name registry. */
  static Enum(caseNames: readonly string[]): Readonly<Record<string, TR.Value<TR.EnumCaseIdentity>>> {
    return Object.freeze(Object.fromEntries(caseNames.map(caseName => [
      caseName,
      new RuntimeValue(Object.freeze({ identity: Symbol(caseName) })),
    ])))
  }

  /** IsCase tests built-in subject states, declared boolean cases, and enum identity values. */
  static IsCase(subject: TR.Evaluable, expected: TR.SubjectCaseName | TR.Evaluable): TR.Value<boolean> {
    const value = subject.evaluate().jsValue
    if (typeof expected === 'string') {
      return new RuntimeValue(matchSubjectCase(value, expected).matched)
    }
    return new RuntimeValue(Object.is(value, expected.evaluate().jsValue))
  }

  /** IsEmpty matches empty text/lists and ready queries with no rows. */
  static IsEmpty(subject: TR.Evaluable): TR.Value<boolean> {
    return TR.IsCase(subject, 'empty')
  }

  /** If evaluates a validated boolean once and lazily runs its one-sided body when true. */
  static If<ResultT>(condition: TR.Evaluable, body: () => ResultT): ResultT | undefined {
    return condition.evaluate().jsValue === true ? body() : undefined
  }

  /** WhenCase evaluates one subject once and selects one mutually exclusive value case. */
  static WhenCase<T>(
    subject: TR.Evaluable,
    branches: readonly TR.CaseBranch<TR.Evaluable>[],
    otherwise: () => TR.Evaluable,
  ): TR.Value<T> {
    const value = subject.evaluate().jsValue
    for (const [caseName, body] of branches) {
      const match = matchSubjectCase(value, caseName)
      if (match.matched) {
        return body(new RuntimeValue(match.payload)).evaluate() as TR.Value<T>
      }
    }
    return otherwise().evaluate() as TR.Value<T>
  }

  /** WhenCaseRender evaluates one subject once and renders one matching case. */
  static WhenCaseRender(
    subject: TR.Evaluable,
    branches: readonly TR.CaseBranch<React.ReactNode>[],
    otherwise: () => React.ReactNode,
  ): React.ReactNode {
    const value = subject.evaluate().jsValue
    for (const [caseName, body] of branches) {
      const match = matchSubjectCase(value, caseName)
      if (match.matched) {
        return body(new RuntimeValue(match.payload))
      }
    }
    return otherwise()
  }

  /** GuardAction runs a matching handler and reports whether the enclosing block must stop. */
  static GuardAction(
    subject: TR.Evaluable,
    branches: readonly TR.CaseBranch<unknown>[],
  ): boolean | Promise<boolean> {
    const value = subject.evaluate().jsValue
    for (const [caseName, body] of branches) {
      const match = matchSubjectCase(value, caseName)
      if (match.matched) {
        const result = body(new RuntimeValue(match.payload))
        return isPromiseLike(result) ? Promise.resolve(result).then(() => true) : true
      }
    }
    return false
  }

  /** GuardRender renders a matching handler or the untouched remainder of the enclosing block. */
  static GuardRender(
    subject: TR.Evaluable,
    branches: readonly TR.CaseBranch<React.ReactNode>[],
    remaining: () => React.ReactNode,
  ): React.ReactNode {
    const value = subject.evaluate().jsValue
    for (const [caseName, body] of branches) {
      const match = matchSubjectCase(value, caseName)
      if (match.matched) {
        return body(new RuntimeValue(match.payload))
      }
    }
    return remaining()
  }

  /** Member reads item fields and the built-in Count collection and text member. */
  static Member(root: TR.Evaluable, path: readonly string[]): TR.Value<any> {
    let value = root.evaluate().jsValue
    for (const member of path) {
      if (DataControls.IsEntityHandle(value)) {
        value = DataControls.Read(value, member)
        continue
      }
      if (isCountableValue(value) && member === 'Count') {
        value = value.length
        continue
      }
      value = value?.[member]
    }
    return new RuntimeValue(value === undefined ? null : value)
  }

  /** Function creates a Tao pure-function value. */
  static Function(body: (...args: any[]) => TR.Value<any>): TR.Function {
    return new RuntimeFunction(body)
  }

  /** Call invokes a Tao pure function with runtime-wrapped values. */
  static Call<T>(fn: TR.Function, ...args: TR.Evaluable[]): TR.Value<T> {
    return fn.invoke(...args) as TR.Value<T>
  }

  /** ForEach renders a stable fragment for each list value. */
  static ForEach(
    collection: TR.Evaluable,
    render: (value: TR.Value<any>, index: number) => React.ReactNode,
    select?: (value: TR.Value<any>, index: number) => unknown,
  ): React.ReactNode {
    const values = collection.evaluate().jsValue
    if (!Array.isArray(values)) {
      return null
    }
    return values.map((value, index) => {
      const runtimeValue = new RuntimeValue(value)
      const content = render(runtimeValue, index)
      return React.createElement(
        React.Fragment,
        { key: stableListKey(value, index) },
        select
          ? React.createElement(SelectableRow, { onSelect: () => select(runtimeValue, index) }, content)
          : content,
      )
    })
  }

  /** Action creates runtime Tao actions from generated callbacks. */
  static Action<Args extends any[]>(body: (...args: Args) => unknown): TR.Action<Args> {
    return new RuntimeAction(body)
  }

  /** Async starts detached action work immediately and reports the failure its absent caller cannot observe. */
  static Async(body: () => PromiseLike<unknown>): void {
    // The async wrapper gives a synchronous throw the same reported outcome as a rejection.
    void (async () => await body())().catch(reportUnownedFailure)
  }

  /** Alias creates live runtime Tao aliases that intentionally re-evaluate their initializer on every read. */
  static Alias<Source extends TR.Evaluable>(value: Source | (() => Source)): RuntimeAlias<Source> {
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
    return RuntimeSwitch(operator, {
      '+=': () => new RuntimeValue(current + next),
      '-=': () => new RuntimeValue(current - next),
      '*=': () => new RuntimeValue(current * next),
      '/=': () => new RuntimeValue(current / next),
    })
  }

  /** Do invokes a Tao action value with already-compiled runtime arguments. */
  static async Do<Args extends any[]>(action: TR.Action<Args>, ...args: Args): Promise<void> {
    await action.evaluate().jsValue.invoke(...args)
  }

  /** Set updates a Tao state value. */
  static Set<T>(state: TR.State<T>, value: () => TR.Value<T>): void {
    state.set(value())
  }

  /** Toggle inverts a boolean state. Validation limits this to boolean states. */
  static Toggle(state: TR.State<boolean>): void {
    state.set(new RuntimeValue(!state.evaluate().jsValue))
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

  /** TaoContext carries presentation context across generated view boundaries without carrying layout. */
  static TaoContext(callerProps: TR.TaoProps | undefined): TRTaoProps.TaoAmbientContext {
    return TRTaoProps.TaoPropsControls.ambientContext(callerProps)
  }

  /** VisualLayout exposes only the resolved layout snapshot to an injected visual implementation. */
  static VisualLayout(props: TR.TaoProps | undefined): TR.TaoVisualLayout | undefined {
    return TRTaoProps.TaoPropsControls.visualLayout(props)
  }

  /** VisualTag exposes the nearest concrete occurrence tag to an injected visual implementation. */
  static VisualTag(props: TR.TaoProps | undefined): string | undefined {
    return TRTaoProps.TaoPropsControls.visualTag(props)
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

  /** DataProvider exposes the published provider factories used by datasource injections. */
  static readonly DataProvider = DataProviderControls

  /** Design exposes declaration-local flat tokens, named bundles, and combined spec resolution. */
  static readonly Design = DesignControls

  /** Layout exposes deterministic runtime lowering for Tao layout clauses. */
  static readonly Layout = LayoutControls

  /** Navigation exposes deterministic stack history, presentation, and back behavior. */
  static readonly Navigation = NavigationControls

  /** NavKind exposes declaration-owned navigation implementations and identities. */
  static readonly NavKind = NavKindControls

  /** testProvider runs the published full-snapshot provider conformance suite. */
  static readonly testProvider = testDataProvider

  /** testNavKind runs the published navigation implementation conformance suite. */
  static readonly testNavKind = testNavigationKind

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

class RuntimeAlias<Source extends TR.Evaluable> {
  constructor(private readonly value: Source | (() => Source)) {}

  evaluate(): TR.AliasValue<Source> {
    return (typeof this.value === 'function' ? this.value() : this.value).evaluate() as TR.AliasValue<Source>
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

class RuntimeActionValue<Args extends any[] = any[]> {
  constructor(private readonly body: (...args: Args) => unknown) {}

  invoke(...args: Args): void | Promise<void> {
    const result = this.body(...args)
    return isPromiseLike(result) ? Promise.resolve(result).then(() => undefined) : undefined
  }
}

class RuntimeAction<Args extends any[] = any[]> {
  readonly jsValue: RuntimeActionValue<Args>

  constructor(body: (...args: Args) => unknown) {
    this.jsValue = new RuntimeActionValue(body)
  }

  evaluate(): RuntimeAction<Args> {
    return this
  }
}

class RuntimeFunction {
  constructor(private readonly body: (...args: any[]) => TR.Value<any>) {}

  invoke(...args: TR.Evaluable[]): TR.Value<any> {
    return this.body(...args)
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object'
    && value !== null
    && 'then' in value
    && typeof value.then === 'function'
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
  export type Action<Args extends any[] = any[]> = RuntimeAction<Args>
  /** ActionValue declares the JavaScript payload for an evaluated Tao action. */
  export type ActionValue<Args extends any[] = any[]> = RuntimeActionValue<Args>
  /** BinaryOperator declares the shipped Tao binary operators. */
  export type BinaryOperator = '!=' | '*' | '+' | '-' | '/' | '<' | '<=' | '==' | '>' | '>=' | 'and' | 'or'
  /** Alias declares a runtime Tao alias wrapper. */
  export type Alias<T> = RuntimeAlias<T extends TR.Evaluable ? T : TR.Value<T>>
  /** AliasValue declares the evaluated runtime value for a Tao alias. */
  export type AliasValue<T> = T extends TR.Evaluable ? ReturnType<T['evaluate']> : TR.Value<T>
  /** CompoundSetOperator declares supported numeric compound state update operators. */
  export type CompoundSetOperator = '+=' | '-=' | '*=' | '/='
  /** Evaluable declares runtime values that can collapse to their current value. */
  export type Evaluable = { evaluate(): any }
  /** EnumCaseIdentity is the opaque runtime token owned by one enum declaration and case. */
  export type EnumCaseIdentity = Readonly<{ identity: symbol }>
  /** SubjectCaseName declares runtime-recognized built-in subject states. */
  export type SubjectCaseName =
    | 'empty'
    | 'loading'
    | 'missing'
    | 'unauthorized'
    | 'error'
    | 'true'
    | 'false'
  /** CaseBranch maps one source case name to a payload-aware lazy body. */
  export type CaseBranch<ResultT> = readonly [string, (payload: TR.Value<any>) => ResultT]
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
  /** TaoVisualLayout is the layout-only snapshot exposed to injected visual implementations. */
  export type TaoVisualLayout = TRTaoProps.TaoVisualLayout
  /** DevModeOptions declares runtime development-only diagnostic flags. */
  export type DevModeOptions = TaoDevModeOptions
  /** DataSchema declares one runtime-backed Tao data schema. */
  export type DataSchema = TaoDataSchema
  /** DataProvider declares the published full-snapshot persistence protocol. */
  export type DataProvider = TaoDataProvider
  /** DatasourceDeclaration owns the identity and provider implementation of a Tao datasource. */
  export type DatasourceDeclaration = TaoDatasourceDeclaration
  /** ConfiguredDatasource is an immutable declaration-linked provider configuration. */
  export type ConfiguredDatasource = TaoConfiguredDatasource
  /** Design is one immutable declaration-owned token and named-bundle catalog. */
  export type Design = TaoDesign
  /** DesignSpec preserves authored combined clauses until mounted-app-local resolution. */
  export type DesignSpec = TaoDesignSpec
  /** NavKindProfile declares the shipped profile-specific lifecycle contracts. */
  export type NavKindProfile = TaoNavKindProfile
  /** NavDeclaration is the immutable declaration identity carried by configured descriptors. */
  export type NavDeclaration = TaoNavDeclaration
  /** NavKind declares the published declaration-owned navigation implementation protocol. */
  export type NavKind<
    ProfileT extends TaoNavKindProfile = TaoNavKindProfile,
    ConfigurationT extends object = object,
  > = TaoNavKind<ProfileT, ConfigurationT>
  /** NavDescriptor is immutable configuration separated from occurrence-local navigation state. */
  export type NavDescriptor<
    ProfileT extends TaoNavKindProfile = TaoNavKindProfile,
    ConfigurationT extends object = object,
  > = TaoNavDescriptor<ProfileT, ConfigurationT>
  /** NavMount owns the independent mutable state for one descriptor occurrence. */
  export type NavMount<
    ProfileT extends TaoNavKindProfile = TaoNavKindProfile,
    ConfigurationT extends object = object,
  > = TaoNavMount<ProfileT, ConfigurationT>
  /** StackNavConfiguration is the normalized Stack profile descriptor configuration. */
  export type StackNavConfiguration = TaoStackNavConfiguration
  /** SlotNavConfiguration is the normalized Slot profile descriptor configuration. */
  export type SlotNavConfiguration = TaoSlotNavConfiguration
  /** SelectionNavConfiguration is the normalized Selection profile descriptor configuration. */
  export type SelectionNavConfiguration = TaoSelectionNavConfiguration
  /** NavigationValue declares one mounted declaration-owned navigation occurrence. */
  export type NavigationValue = TaoNavigationValue
  /** Presentable declares a first-class Tao ui descriptor. */
  export type Presentable = TaoPresentable
}

type SubjectCaseMatch = { matched: boolean; payload: unknown }

function matchSubjectCase(value: unknown, caseName: string): SubjectCaseMatch {
  const entity = DataControls.EntityAvailability(value)
  if (entity) {
    if (caseName === 'error') {
      return {
        matched: entity.status === 'error',
        payload: entity.status === 'error' ? entity.message : undefined,
      }
    }
    if (caseName === 'loading' || caseName === 'missing' || caseName === 'unauthorized') {
      return { matched: entity.status === caseName, payload: undefined }
    }
    return { matched: false, payload: undefined }
  }
  const query = queryStatus(value)
  if (caseName === 'loading') {
    return { matched: query?.status === 'loading', payload: undefined }
  }
  if (caseName === 'error') {
    return { matched: query?.status === 'error', payload: query?.message }
  }
  if (caseName === 'empty') {
    if (query) {
      return { matched: query.status === 'ready' && query.rows.length === 0, payload: undefined }
    }
    return {
      matched: isCountableValue(value) && value.length === 0,
      payload: undefined,
    }
  }
  if (caseName === 'true' || caseName === 'false') {
    return { matched: value === (caseName === 'true'), payload: undefined }
  }
  return { matched: false, payload: undefined }
}

const isCountableValue = (value: unknown): value is string | unknown[] =>
  Array.isArray(value) || typeof value === 'string'

function queryStatus(
  value: unknown,
): { status: 'loading' | 'error' | 'ready'; message?: string; rows: unknown[] } | undefined {
  if (!Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, 'Loading')) {
    return undefined
  }
  const query = value as unknown[] & { Loading?: boolean; Error?: string }
  if (query.Loading === true) {
    return { status: 'loading', rows: query }
  }
  if (typeof query.Error === 'string' && query.Error.length > 0) {
    return { status: 'error', message: query.Error, rows: query }
  }
  return { status: 'ready', rows: query }
}

export default TR
