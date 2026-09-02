import React from 'react'
import { Dev, DevControls, type TaoDevModeOptions } from './dev-runtime/TR-dev'
import {
  actionFailureCaseName,
  deferDetached,
  existingTransactionResource,
  markExternalEffect,
  runAction,
  type TaoDeclaredFailure,
  transactionResource,
} from './TR-action-transactions'
import { AppShell, AppSurfaceFrame } from './TR-app-shell'
import { RuntimeAssert } from './TR-assert'
import { createClipboard, type TaoPasteboard } from './TR-clipboard'
import {
  DataControls,
  type TaoConfiguredDatasource,
  type TaoDataConnection,
  type TaoDataConnectionObserver,
  type TaoDataProvider,
  type TaoDataProviderContext,
  type TaoDataSchema,
  type TaoDataSchemaDefinition,
  type TaoDatasourceDeclaration,
  type TaoFillOps,
  type TaoFillRequest,
  type TaoQueryDescriptor,
  testProvider as testDataProvider,
} from './TR-data'
import {
  HttpAdapterControls,
  type TaoHttpAdapter,
  type TaoHttpFillTools,
  type TaoHttpMatch,
  type TaoHttpShape,
} from './TR-data-http'
import {
  DesignControls,
  type TaoDesign,
  type TaoDesignSpec,
} from './TR-design'
import {
  captureArguments,
  latestFailureCapture,
  onRuntimeFailure,
  recoveryBackup,
  TaoErrorBoundary,
} from './TR-error-containment'
import {
  ErrorControls,
  TaoActionFailure,
  type TaoActionFailureReport,
  TaoViewDepthError,
  warnDesignDivergence,
} from './TR-errors'
import { createHaptic, type TaoHapticKinds, type TaoHaptics } from './TR-haptic'
import type { RuntimeCommand } from './TR-interaction'
import { CommandCatalog, InteractionControls, type TaoCommandTable } from './TR-interaction-catalog'
import { LayoutControls } from './TR-layout'
import { NativeHosts } from './TR-native-hosts'
import { NativeModules } from './TR-native-modules'
import {
  NavigationControls,
  NavKindControls,
  type RuntimeHostReadChannel,
  type TaoNavDeclaration,
  type TaoNavDescriptor,
  type TaoNavHostSlot,
  type TaoNavHostSlotConfiguration,
  type TaoNavHostSlotContract,
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
import type { TaoDeclarationIdentity } from './TR-navigation-identity'
import {
  beginPersistedStateLaunch,
  beginPersistedStateTest,
  capturePersistedState,
  endPersistedStateTest,
  registerPersistedEnumCase,
  RuntimePersistedState,
  setPersistedStateStorageForTests,
  type TaoWritableState,
  usePersistedState,
} from './TR-persisted-state'
import { requireReactNativeRuntime } from './TR-react-native'
import { isReactiveValue } from './TR-reactive'
import {
  captureRuntime,
  registerRuntimeCaptureDomain,
  restoreRuntimeCapture,
  type TaoRuntimeCaptureArtifact,
  type TaoRuntimeCaptureDomainRegistration,
  type TaoRuntimeFailure,
  type TaoRuntimeFailureFrame,
  type TaoRuntimeJson,
} from './TR-runtime-capture'
import {
  SchemeControls,
  type TaoAppearance,
  type TaoScheme,
  type TaoSchemeCapability,
  type TaoSchemeSnapshot,
  type TaoSchemeSource,
} from './TR-scheme'
import { SelectableRow } from './TR-selectable-row'
import { createShareSheet, type TaoShareSheet } from './TR-share'
import {
  StudioEnvironmentControls,
  type TaoStudioEnvironment,
  type TaoStudioProviderOverlay,
  type TaoStudioStateCapture,
  type TaoStudioStateSeed,
} from './TR-studio-environment'
import { StudioPreview } from './TR-studio-preview'
import {
  StudioStateControls,
  type TaoStudioStateArtifact,
  type TaoStudioStateDomainCodec,
  type TaoStudioStateLayer,
} from './TR-studio-state'
import { runtimeSwitchHandler } from './TR-switch'
import * as TRTaoProps from './TR-TaoProps'
import { Clock, createTicker, makeUnitControls, type TaoTicker } from './TR-units'
import * as TRViews from './TR-views'

const warnedUnhonoredLayouts = new Set<string>()

/** TR exposes the generated-code runtime API used by generated apps. */
class TR {
  private constructor() {}

  /** Value creates runtime Tao values from JavaScript values. */
  static Value<T>(jsValue: T): TR.Value<T> {
    return new RuntimeValue(jsValue)
  }

  /** Binary applies Tao's small, deterministic binary-operator set. */
  static Binary(left: TR.Evaluable, operator: TR.BinaryOperator, right: TR.Evaluable): TR.Value<any> {
    return new RuntimeValue(
      runtimeSwitchHandler(operator, binaryOperations)(
        left.evaluate().jsValue,
        right.evaluate().jsValue,
      ),
    )
  }

  /** Unary applies Tao boolean negation or numeric negation. */
  static Unary(operator: TR.UnaryOperator, operand: TR.Evaluable): TR.Value<any> {
    return new RuntimeValue(runtimeSwitchHandler(operator, unaryOperations)(operand.evaluate().jsValue))
  }

  /** Interpolate concatenates Tao values, rendering absence as an empty string. */
  static Interpolate(parts: readonly TR.Evaluable[]): TR.Value<string> {
    return new RuntimeValue(parts.map(part => part.evaluate().jsValue).map(value => value ?? '').join(''))
  }

  /** Enum creates declaration-owned case identities and registers their stable persistence names. */
  static Enum(
    declaration: TR.DeclarationIdentity,
    caseNames: readonly string[],
  ): Readonly<Record<string, TR.Value<TR.EnumCaseIdentity>>> {
    return Object.freeze(Object.fromEntries(caseNames.map(caseName => {
      const value = Object.freeze({ caseName, declaration: declaration.canonical, identity: Symbol(caseName) })
      registerPersistedEnumCase(value)
      return [caseName, new RuntimeValue(value)]
    })))
  }

  /** IsCase tests built-in subject states, declared boolean cases, and enum identity values. */
  static IsCase(subject: TR.Evaluable, expected: TR.SubjectCaseName | TR.Evaluable): TR.Value<boolean> {
    const value = subject.evaluate().jsValue
    if (typeof expected === 'string') {
      return new RuntimeValue(matchSubjectCase(value, expected).matched)
    }
    return new RuntimeValue(Object.is(value, expected.evaluate().jsValue))
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
    const matched = firstMatchedBranch(subject.evaluate().jsValue, branches)
    return (matched ? matched.result.evaluate() : otherwise().evaluate()) as TR.Value<T>
  }

  /** WhenCaseRender evaluates one subject once and renders one matching case. */
  static WhenCaseRender(
    subject: TR.Evaluable,
    branches: readonly TR.CaseBranch<React.ReactNode>[],
    otherwise: () => React.ReactNode,
  ): React.ReactNode {
    const matched = firstMatchedBranch(subject.evaluate().jsValue, branches)
    return matched ? matched.result : otherwise()
  }

  /** GuardAction runs a matching handler and reports whether the enclosing block must stop. */
  static GuardAction(
    subject: TR.Evaluable,
    branches: readonly TR.CaseBranch<unknown>[],
  ): boolean | Promise<boolean> {
    const matched = firstMatchedBranch(subject.evaluate().jsValue, branches)
    if (!matched) {
      return false
    }
    return isPromiseLike(matched.result) ? Promise.resolve(matched.result).then(() => true) : true
  }

  /** GuardRender renders a matching handler or the untouched remainder of the enclosing block. */
  static GuardRender(
    subject: TR.Evaluable,
    branches: readonly TR.CaseBranch<React.ReactNode>[],
    remaining: () => React.ReactNode,
  ): React.ReactNode {
    const matched = firstMatchedBranch(subject.evaluate().jsValue, branches)
    return matched ? matched.result : remaining()
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
    frame?: Omit<TaoRuntimeFailureFrame, 'arguments' | 'boundary'>,
  ): React.ReactNode {
    const values = collection.evaluate().jsValue
    if (!Array.isArray(values)) {
      return null
    }
    return values.map((value, index) => {
      const runtimeValue = new RuntimeValue(value)
      let capturedArguments: TaoRuntimeJson | undefined
      const diagnosticsArguments = () => capturedArguments ??= captureArguments({ index, value })
      return React.createElement(
        TaoErrorBoundary,
        {
          boundaryId: `item:${frame?.source?.path ?? 'unknown'}:${frame?.source?.start ?? 0}:${
            String(stableListKey(value, index))
          }`,
          frame: () => ({ ...frame, arguments: diagnosticsArguments(), boundary: 'item' as const }),
          key: stableListKey(value, index),
          stateKey: () => JSON.stringify(diagnosticsArguments()),
        },
        React.createElement(ForEachItem, { index, render, runtimeValue, select }),
      )
    })
  }

  /** Action creates runtime Tao actions from generated callbacks. */
  static Action<Args extends any[]>(
    body: (...args: Args) => unknown,
    metadata: RuntimeActionMetadata = {},
  ): TR.Action<Args> {
    return new RuntimeAction(body, metadata)
  }

  /** ForeignAction adapts a named TypeScript effect and its declared Tao failure contract. */
  static ForeignAction<Args extends Array<TR.Evaluable | undefined>>(
    implementation: (...arguments_: any[]) => unknown,
    name: string,
    failures: readonly TaoDeclaredFailure[],
    options: Readonly<{ requiredArguments?: number; runs?: 'latest' }> = {},
  ): TR.Action<Args> {
    const requiredArguments = options.requiredArguments ?? implementation.length
    return new RuntimeAction(
      async (...arguments_: Args) => {
        const missingRequired = Array.from(
          { length: requiredArguments },
          (_, index) => index,
        ).find(index => arguments_[index] === undefined)
        RuntimeAssert.input(
          missingRequired === undefined,
          `Foreign action '${name}' is missing required argument ${(missingRequired ?? 0) + 1} of `
            + `${requiredArguments}.`,
          { action: name },
        )
        markExternalEffect()
        try {
          await implementation(...arguments_.map(argument => argument?.evaluate().jsValue))
        } catch (error) {
          if (error instanceof TaoActionFailure) {
            throw error
          }
          const providerCase = providerFailureCase(error)
          const declared = failures.find(failure => actionFailureCaseName(failure.case) === providerCase)
          throw new TaoActionFailure(
            providerCase || (declared ? actionFailureCaseName(declared.case) : 'Unexpected'),
            declared?.sentence ?? '',
            error instanceof Error ? error.message : undefined,
          )
        }
      },
      { name },
      options.runs,
    )
  }

  /** BridgedAction adapts an explicitly action-typed TypeScript export at the ordinary from boundary. */
  static BridgedAction<Args extends TR.Evaluable[]>(
    implementation: (...arguments_: any[]) => unknown,
  ): TR.Action<Args> {
    return TR.Action(async (...arguments_: Args) => {
      markExternalEffect()
      await implementation(...arguments_.map(argument => argument.evaluate().jsValue))
    })
  }

  /** Async starts detached action work immediately and reports the failure its absent caller cannot observe. */
  static Async(body: () => PromiseLike<unknown>): void {
    deferDetached(body)
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
    return new RuntimeValue(
      runtimeSwitchHandler(operator, compoundSetOperations)(
        state.evaluate().jsValue,
        value.evaluate().jsValue,
      ),
    )
  }

  /**
   * Do runs one verb inside the caller's transaction: a Tao action with its compiled arguments, or
   * a command value that already carries the slots it needs.
   */
  static Do<Args extends any[]>(
    action: { evaluate(): { jsValue: { invokeJoined(...args: Args): void | Promise<void> } } },
    ...args: Args
  ): void | Promise<void> {
    return action.evaluate().jsValue.invokeJoined(...args)
  }

  /** Set updates a Tao state value. */
  static Set<T>(state: TR.State<T>, value: () => TR.Value<T>): void {
    state.set(value())
  }

  /** Toggle inverts a boolean state. Validation limits this to boolean states. */
  static Toggle(state: TR.State<boolean>): void {
    state.set(new RuntimeValue(!state.evaluate().jsValue))
  }

  /** Fail aborts the complete joined action transaction and skips the remaining caller block. */
  static Fail(failureCase: TR.Evaluable, sentence: string): never {
    throw new TaoActionFailure(actionFailureCaseName(failureCase), sentence)
  }

  /**
   * State creates view-local reactive Tao state. A library value that changes on its own — an
   * ticker or device reading — is held like any other value, and the holder re-renders while it is
   * mounted, which is what gives the value the holder's lifetime.
   */
  static State<T>(initialValue: () => TR.Value<T>): TR.State<T> {
    const initial = React.useRef<TR.Value<T> | undefined>(undefined)
    initial.current ??= initialValue().evaluate()
    const [jsValue, setJsValue] = React.useState<T>(() => initial.current!.jsValue)
    const [, onSelfDrivenChange] = React.useReducer((count: number) => count + 1, 0)
    React.useEffect(
      () => isReactiveValue(jsValue) ? jsValue.subscribe(onSelfDrivenChange) : undefined,
      [jsValue, onSelfDrivenChange],
    )
    const jsValueRef = React.useRef(jsValue)
    jsValueRef.current = jsValue
    return new RuntimeState(jsValueRef, setJsValue, initial.current.jsValue)
  }

  /** PersistedState creates one app-declaration-owned, device-local state store. */
  static PersistedState<T>(
    initialValue: () => TR.Value<T>,
    identity: TR.DeclarationIdentity,
    name: string,
    type: import('./TR-persisted-state').TaoPersistedStateType,
  ): RuntimePersistedState<T> {
    return new RuntimePersistedState(initialValue(), identity, name, type)
  }

  /** UsePersistedState mounts one persisted store and begins its asynchronous load. */
  static UsePersistedState(state: RuntimePersistedState<unknown>): void {
    usePersistedState(state)
  }

  /** Element creates one React element; the escape hatch native pass-through implementations use. */
  static Element(
    component: React.ComponentType<any> | string,
    props: Record<string, unknown> | null,
    ...children: React.ReactNode[]
  ): React.ReactNode {
    return React.createElement(component as React.ComponentType<any>, props as any, ...children)
  }

  /**
   * WarnUnhonoredLayout reports, outside production, styling passed to a platform-native component
   * that renders the OS's own control and cannot honor layout clauses. The component still renders
   * — best-effort, never a failure — but silent divergence between the declared style and the
   * screen would be worse than a named limitation. `warnDesignDivergence` owns when such a notice
   * reaches a reader; this keeps only the once-per-component dedupe and the sentence itself.
   */
  static WarnUnhonoredLayout(component: string, layout: unknown): void {
    if (warnedUnhonoredLayouts.has(component)) {
      return
    }
    // A layout is `{ entries }`, and each entry is a tuple whose head names the clause. Reading keys
    // off the wrapper named the wrapper — every warning used to say `(entries)` instead of naming
    // the clauses the reader actually wrote.
    const entries = (layout as { layout?: { entries?: readonly (readonly unknown[])[] } } | undefined)?.layout?.entries
    const clauses = [...new Set((entries ?? []).map(entry => String(entry[0])))]
    if (clauses.length === 0) {
      return
    }
    warnedUnhonoredLayouts.add(component)
    warnDesignDivergence(
      `Tao: the platform-native ${component} ignores styling clauses (${clauses.join(', ')}). `
        + `Use the design's semantic surface, or alias a styled implementation instead.`,
    )
  }

  /** now reads the current time from the Tao clock, which a check holds still and advances. */
  static now(): number {
    return Clock.now()
  }

  /** Units converts unit values, relates them to `time`, and renders a family's named readings. */
  static Units = makeUnitControls(<T>(jsValue: T) => new RuntimeValue(jsValue))

  /** Interval constructs the reactive ticker behind `@tao/time`. */
  static Interval(everyNanoseconds: number): TaoTicker {
    return createTicker(everyNanoseconds, body => new RuntimeActionValue(body))
  }

  /** Clipboard constructs the reactive pasteboard behind `@tao/device/clipboard`. */
  static Clipboard(): TaoPasteboard {
    return createClipboard(body => new RuntimeActionValue(body), TR.native)
  }

  /** Haptic constructs semantic tactile feedback behind `@tao/device/haptic`. */
  static Haptic(kinds: TaoHapticKinds): TaoHaptics {
    return createHaptic(kinds, body => new RuntimeActionValue(body), TR.native)
  }

  /** Share constructs the system share sheet behind `@tao/device/share`. */
  static Share(): TaoShareSheet {
    return createShareSheet(body => new RuntimeActionValue(body), TR.native)
  }

  /** native is the internal lazy native-module kernel used by curated stdlib bindings. */
  private static readonly native = NativeModules

  /** Clock exposes the runtime clock a check holds, advances, and releases. */
  static Clock = Clock

  /** Hosts resolves the optional platform components `@tao/ui/native` implementations reach for. */
  static Hosts = NativeHosts

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

  /** ViewTaoProps advances the render-frame depth carried to one generated Tao view. */
  static ViewTaoProps(
    localProps: TR.TaoProps,
    callerProps?: TR.TaoProps,
    inheritCallerProps = true,
  ): TR.TaoProps {
    const props = { ...localProps, viewDepth: (callerProps?.viewDepth ?? 1) + 1 }
    return inheritCallerProps ? TR.TaoProps(props, callerProps) : props
  }

  /** AssertViewDepth fails the first generated view frame beyond the exact 256-frame cap. */
  static AssertViewDepth(props: TR.TaoProps | undefined, view: string): void {
    const depth = props?.viewDepth ?? 1
    if (depth > 256) {
      throw new TaoViewDepthError(view, depth)
    }
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

  /** VisualNativeProps lowers private Studio identity and a test tag onto an injected native root. */
  static VisualNativeProps(layout: TR.TaoVisualLayout | undefined, tag?: string): Record<string, unknown> {
    return TRTaoProps.TaoPropsControls.visualNativeProps(layout, tag)
  }

  /** VisualNativeRoot preserves filtered native controls while making their Studio occurrence selectable. */
  static VisualNativeRoot(layout: TR.TaoVisualLayout | undefined, child: React.ReactNode): React.ReactNode {
    const props = TRTaoProps.TaoPropsControls.visualNativeProps(layout)
    return Object.keys(props).length === 0
      ? child
      : React.createElement(requireReactNativeRuntime().View, props, child)
  }

  /** setDevMode configures Tao runtime development-only diagnostics. */
  static setDevMode(options?: TR.DevModeOptions): void {
    Dev.setMode(options)
  }

  /** AppShell wraps generated app roots in Tao's safe default app frame. */
  static readonly AppShell = AppShell

  /** AppSurfaceFrame is the safe-area scroll frame the app host puts around one content surface. */
  static readonly AppSurfaceFrame = AppSurfaceFrame

  /** Dev exposes public Tao runtime development-only diagnostic controls. */
  static readonly Dev = DevControls

  /** Studio exposes opt-in preview-only runtime behavior for generated Studio apps. */
  static readonly Studio = {
    ...StudioPreview,
    Environment: StudioEnvironmentControls,
    State: StudioStateControls,
  } as const

  /** Errors is the runtime's one error-handling surface, owned by `TR-errors.ts`. */
  static readonly Errors = ErrorControls

  /** Capture is the explicit semantic replay boundary; it never scrapes arbitrary host objects. */
  static readonly Capture = {
    capture: captureRuntime,
    onFailure: onRuntimeFailure,
    latestFailure: latestFailureCapture,
    recoveryBackup,
    register: registerRuntimeCaptureDomain,
    restore: restoreRuntimeCapture,
  } as const

  /** Persisted exposes capture and test seams for the device-local app-state domain. */
  static readonly Persisted = {
    beginLaunch: beginPersistedStateLaunch,
    beginTest: beginPersistedStateTest,
    capture: capturePersistedState,
    endTest: endPersistedStateTest,
    setStorageForTests: setPersistedStateStorageForTests,
  } as const

  /** Data exposes provider-neutral reactive schemas, queries, and mutations. */
  static readonly Data = DataControls

  /** Http is the adapter-authoring surface for Http datasources: `TR.Http.adapter`, `TR.Http.on`. */
  static readonly Http = HttpAdapterControls

  /** Scheme exposes the resolved appearance environment used by conditional design entries. */
  static readonly Scheme = SchemeControls

  /** Design exposes declaration-local tokens, named bundles, conditions, and combined spec resolution. */
  static readonly Design = DesignControls

  /** Layout exposes deterministic runtime lowering for Tao layout clauses. */
  static readonly Layout = LayoutControls

  /** Interaction exposes command values and the catalog of the verbs a module publishes. */
  static readonly Interaction = InteractionControls

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
    private readonly initialValue: T,
  ) {}

  defaultValue(): RuntimeValue<T> {
    return new RuntimeValue(this.initialValue)
  }

  evaluate(): RuntimeValue<T> {
    return new RuntimeValue(existingTransactionResource<{ value: T }>(this)?.value ?? this.jsValueRef.current)
  }

  set(value: TR.Value<T>): void {
    const nextValue = value.evaluate().jsValue
    const overlay = transactionResource(
      this,
      () => ({ previous: this.jsValueRef.current, value: this.jsValueRef.current }),
      committed => this.commit(committed.value),
      undefined,
      committed => this.commit(committed.previous),
    )
    if (overlay) {
      overlay.value = nextValue
      return
    }
    this.commit(nextValue)
  }

  reset(): void {
    this.set(new RuntimeValue(this.initialValue))
  }

  private commit(value: T): void {
    this.jsValueRef.current = value
    this.setJsValue(value)
  }
}

class RuntimeActionValue<Args extends any[] = any[]> {
  readonly #latest: LatestActionInvocations<Args> | undefined

  constructor(
    private readonly body: (...args: Args) => unknown,
    private readonly name = 'action',
    runs?: 'latest',
    private readonly interrupt = false,
  ) {
    this.#latest = runs === 'latest' ? new LatestActionInvocations<Args>() : undefined
  }

  invoke(...args: Args): void | Promise<void> {
    const run = (latestArgs: Args) =>
      runAction(this.name, latestArgs, () => this.body(...latestArgs), false, this.interrupt)
    return this.#latest?.invoke(args, run) ?? run(args)
  }

  invokeJoined(...args: Args): void | Promise<void> {
    const run = (latestArgs: Args) => runAction(this.name, latestArgs, () => this.body(...latestArgs), true)
    return this.#latest?.invoke(args, run) ?? run(args)
  }
}

type LatestActionInvocation<Args extends any[]> = {
  args: Args
  reject(error: unknown): void
  resolve(): void
  run(args: Args): void | Promise<void>
}

/** LatestActionInvocations keeps one running effect and at most one newest not-yet-started call. */
class LatestActionInvocations<Args extends any[]> {
  #active = false
  #pending: LatestActionInvocation<Args> | undefined

  invoke(args: Args, run: (args: Args) => void | Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const invocation = { args, reject, resolve, run }
      if (!this.#active) {
        this.#active = true
        void this.#execute(invocation)
        return
      }
      this.#pending?.resolve()
      this.#pending = invocation
    })
  }

  async #execute(invocation: LatestActionInvocation<Args>): Promise<void> {
    try {
      await invocation.run(invocation.args)
      invocation.resolve()
    } catch (error) {
      invocation.reject(error)
    } finally {
      const next = this.#pending
      this.#pending = undefined
      if (next) {
        void this.#execute(next)
      } else {
        this.#active = false
      }
    }
  }
}

type RuntimeActionMetadata = {
  name?: string
  /** interrupt is compiler-owned and marks a response action that may settle its suspended ask. */
  interrupt?: boolean
}

class RuntimeAction<Args extends any[] = any[]> {
  readonly jsValue: RuntimeActionValue<Args>

  constructor(
    body: (...args: Args) => unknown,
    metadata: RuntimeActionMetadata = {},
    runs?: 'latest',
  ) {
    this.jsValue = new RuntimeActionValue(body, metadata.name ?? 'action', runs, metadata.interrupt)
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

function providerFailureCase(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }
  const value = 'case' in error
    ? (error as { case: unknown }).case
    : 'caseName' in error
    ? (error as { caseName: unknown }).caseName
    : undefined
  if (typeof value === 'string') {
    return value
  }
  if (
    typeof value === 'object'
    && value !== null
    && 'evaluate' in value
    && typeof value.evaluate === 'function'
  ) {
    return actionFailureCaseName(value as TR.Evaluable)
  }
  return undefined
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

function ForEachItem(props: {
  index: number
  render(value: TR.Value<any>, index: number): React.ReactNode
  runtimeValue: TR.Value<any>
  select?: (value: TR.Value<any>, index: number) => unknown
}): React.ReactNode {
  const content = props.render(props.runtimeValue, props.index)
  return props.select
    ? React.createElement(SelectableRow, { onSelect: () => props.select!(props.runtimeValue, props.index) }, content)
    : content
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
  /** ActionFailureReport is the contained, redacted record published for one failed root action. */
  export type ActionFailureReport = TaoActionFailureReport
  export type RuntimeCaptureArtifact = TaoRuntimeCaptureArtifact
  export type RuntimeCaptureDomainRegistration = TaoRuntimeCaptureDomainRegistration
  export type RuntimeFailure = TaoRuntimeFailure
  export type RuntimeFailureFrame = TaoRuntimeFailureFrame
  export type RuntimeJson = TaoRuntimeJson
  /** Appearance is a Scheme request; System follows the live host only where the capability is reactive. */
  export type Appearance = TaoAppearance
  /** Scheme is the resolved Light or Dark value consumed by Tao design conditions. */
  export type Scheme = TaoScheme
  /** SchemeCapability reports whether the current host is reactive or intentionally fixed Light. */
  export type SchemeCapability = TaoSchemeCapability
  /** SchemeSource records which precedence layer resolved the captured frame. */
  export type SchemeSource = TaoSchemeSource
  /** SchemeSnapshot is the replay-safe requested/resolved/source/capability record. */
  export type SchemeSnapshot = TaoSchemeSnapshot
  /** DeclarationIdentity is the stable owner-relative identity used by persisted runtime domains. */
  export type DeclarationIdentity = TaoDeclarationIdentity
  /** EnumCaseIdentity is the opaque runtime token owned by one enum declaration and case. */
  export type EnumCaseIdentity = Readonly<{ caseName: string; declaration: string; identity: symbol }>
  /** SubjectCaseName declares runtime-recognized built-in subject states. */
  export type SubjectCaseName =
    | 'empty'
    | 'loading'
    | 'refreshing'
    | 'stale'
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
  export type State<T> = RuntimeState<T> | TaoWritableState<T>
  /** Value declares a runtime Tao value wrapper. */
  export type Value<T> = RuntimeValue<T>
  /** Ticker declares the reactive value `@tao/time`'s `Interval` returns. */
  export type Ticker = TaoTicker
  /** Pasteboard declares the reactive value `@tao/device/clipboard`'s `Clipboard()` returns. */
  export type Pasteboard = TaoPasteboard
  /** Haptics declares the semantic action value `@tao/device/haptic`'s `Haptic()` returns. */
  export type Haptics = TaoHaptics
  /** ShareSheet declares the action value `@tao/device/share`'s `Share()` returns. */
  export type ShareSheet = TaoShareSheet
  /** UnaryOperator declares the shipped Tao unary operators. */
  export type UnaryOperator = '-' | 'not'
  /** Scope declares generated Tao runtime declaration storage. */
  export type Scope = Record<string, any>
  /** TaoProps declares the Tao-owned props bag generated views receive as the `__tao` prop. */
  export type TaoProps = TRTaoProps.TaoProps
  /** TaoStudioIdentity locates one concrete render occurrence in Tao source. */
  export type TaoStudioIdentity = TRTaoProps.TaoStudioIdentity
  /** StudioPreviewConfig identifies and secures one generated Studio preview bridge. */
  export type StudioPreviewConfig = import('./TR-studio-preview').StudioPreviewConfig
  /** StudioEnvironment is one isolated preview cell's versioned provider and Scheme configuration. */
  export type StudioEnvironment = TaoStudioEnvironment
  /** StudioStateSeed carries exact full-snapshot provider envelopes into one isolated preview cell. */
  export type StudioStateSeed = TaoStudioStateSeed
  /** StudioStateCapture carries the exact current provider envelopes out of one isolated preview cell. */
  export type StudioStateCapture = TaoStudioStateCapture
  /** StudioProviderOverlay is the cell-local provider wrapper exposed to generated Studio hosts. */
  export type StudioProviderOverlay = TaoStudioProviderOverlay
  /** StudioStateArtifact is the versioned, explicit-domain durable state transport. */
  export type StudioStateArtifact = TaoStudioStateArtifact
  /** StudioStateLayer is one named input to ordered state composition. */
  export type StudioStateLayer = TaoStudioStateLayer
  /** StudioStateDomainCodec owns validation and composition for one explicit state domain. */
  export type StudioStateDomainCodec<ValueT> = TaoStudioStateDomainCodec<ValueT>
  /** TaoVisualLayout is the layout-only snapshot exposed to injected visual implementations. */
  export type TaoVisualLayout = TRTaoProps.TaoVisualLayout
  /** DevModeOptions declares runtime development-only diagnostic flags. */
  export type DevModeOptions = TaoDevModeOptions
  /** DataSchema declares one runtime-backed Tao data schema. */
  export type DataSchema = TaoDataSchema
  /** DataSchemaDefinition declares the provider-visible shape of one mounted Tao data catalog. */
  export type DataSchemaDefinition = TaoDataSchemaDefinition
  /** DataConnection is one provider connection bound to evaluated datasource configuration. */
  export type DataConnection = TaoDataConnection
  /** DataConnectionObserver receives live provider snapshots and failures. */
  export type DataConnectionObserver = TaoDataConnectionObserver
  /** DataProvider declares the package-owned datasource implementation protocol. */
  export type DataProvider = TaoDataProvider
  /** DataProviderContext carries one schema mount and plain evaluated configuration. */
  export type DataProviderContext = TaoDataProviderContext
  /** DataFillRequest carries the query descriptor a connection's fill is offered. */
  export type DataFillRequest = TaoFillRequest
  /** DataFillOps is what a connection's fill receives to land fetched rows in the store. */
  export type DataFillOps = TaoFillOps
  /** QueryDescriptor is the serializable shape of one active query offered to a fill. */
  export type QueryDescriptor = TaoQueryDescriptor
  /** HttpAdapter declares an Http datasource's supported query shapes per entity. */
  export type HttpAdapter = TaoHttpAdapter
  /** HttpMatch declares which query shapes one adapter entry serves. */
  export type HttpMatch = TaoHttpMatch
  /** HttpShape is one declared query shape and its fill. */
  export type HttpShape = TaoHttpShape
  /** HttpFillTools is what an adapter shape's fill receives to land fetched rows. */
  export type HttpFillTools = TaoHttpFillTools
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
  /** NavHostSlot names chrome values a navigation kind may read from its direct presented view. */
  export type NavHostSlot = TaoNavHostSlot
  /** NavHostSlotContract publishes immutable read and requirement sets in protocol v2. */
  export type NavHostSlotContract = TaoNavHostSlotContract
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
  /** HostReadChannel is the occurrence-local direct-view chrome publication channel. */
  export type HostReadChannel = RuntimeHostReadChannel
  /** Command is one declared verb, bound or still awaiting its slots. */
  export type Command = RuntimeCommand
  /** CommandValue is the generated-code type of a Tao value of primitive `command`. */
  export type CommandValue = RuntimeCommand
  /** CommandTable is one module's emitted command catalog entry set. */
  export type CommandTable = TaoCommandTable
  /** Catalog is the registry of every command the running app published. */
  export type Catalog = CommandCatalog
  /** NavHostSlotConfiguration is the normalized host-read slot payload for a nav occurrence. */
  export type NavHostSlotConfiguration = TaoNavHostSlotConfiguration
  /** Presentable declares a first-class Tao ui descriptor. */
  export type Presentable = TaoPresentable
}

// Frozen operator tables keep the generated app's hottest evaluation path allocation-free:
// each application is one lookup and one call, with no per-evaluation closure objects.
const binaryOperations = Object.freeze(
  {
    '!=': (left: any, right: any) => !Object.is(left, right),
    '*': (left: any, right: any) => left * right,
    '+': (left: any, right: any) => left + right,
    '-': (left: any, right: any) => left - right,
    '/': (left: any, right: any) => left / right,
    '<': (left: any, right: any) => left < right,
    '<=': (left: any, right: any) => left <= right,
    '==': (left: any, right: any) => Object.is(left, right),
    '>': (left: any, right: any) => left > right,
    '>=': (left: any, right: any) => left >= right,
    and: (left: any, right: any) => Boolean(left && right),
    or: (left: any, right: any) => Boolean(left || right),
  } satisfies Record<TR.BinaryOperator, (left: any, right: any) => unknown>,
)

const unaryOperations = Object.freeze(
  {
    '-': (value: any) => -value,
    not: (value: any) => !value,
  } satisfies Record<TR.UnaryOperator, (value: any) => unknown>,
)

const compoundSetOperations = Object.freeze(
  {
    '+=': (current: number, next: number) => current + next,
    '-=': (current: number, next: number) => current - next,
    '*=': (current: number, next: number) => current * next,
    '/=': (current: number, next: number) => current / next,
  } satisfies Record<TR.CompoundSetOperator, (current: number, next: number) => number>,
)

/** firstMatchedBranch runs the first branch whose case matches `value` and returns its result. */
function firstMatchedBranch<ResultT>(
  value: unknown,
  branches: readonly TR.CaseBranch<ResultT>[],
): { result: ResultT } | undefined {
  for (const [caseName, body] of branches) {
    const match = matchSubjectCase(value, caseName)
    if (match.matched) {
      return { result: body(new RuntimeValue(match.payload)) }
    }
  }
  return undefined
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
  if (caseName === 'refreshing') {
    return { matched: query?.refreshing === true, payload: undefined }
  }
  if (caseName === 'stale') {
    return { matched: query?.stale === true, payload: undefined }
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
): {
  status: 'loading' | 'error' | 'ready'
  message?: string
  refreshing?: boolean
  rows: unknown[]
  stale?: boolean
} | undefined {
  if (!Array.isArray(value) || !Object.prototype.hasOwnProperty.call(value, 'Loading')) {
    return undefined
  }
  const query = value as unknown[] & { Loading?: boolean; Error?: string; Refreshing?: boolean; Stale?: boolean }
  // Refreshing and stale are advisory states over renderable rows, never availability by themselves.
  const advisory = { refreshing: query.Refreshing === true, stale: query.Stale === true }
  if (query.Loading === true) {
    return { status: 'loading', rows: query, ...advisory }
  }
  if (typeof query.Error === 'string' && query.Error.length > 0) {
    return { status: 'error', message: query.Error, rows: query, ...advisory }
  }
  return { status: 'ready', rows: query, ...advisory }
}

export default TR
