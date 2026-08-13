import React from 'react'
import { DataControls } from './TR-data'
import { requireReactNativeRuntime } from './TR-react-native'
import { type TaoProps, TaoPropsControls } from './TR-TaoProps'
import { Views } from './TR-views'

type Evaluable = {
  evaluate(): { jsValue: unknown }
}

export type TaoNavigationArguments = Record<string, Evaluable>

export type TaoNavigationDestination = {
  render(arguments_: TaoNavigationArguments, taoProps?: TaoProps): React.ReactNode
}

export type TaoNavigationStackDefinition = {
  destinations: Record<string, TaoNavigationDestination>
  initial: string
  name: string
}

export type TaoPresentableDefinition = {
  name: string
  render(arguments_: TaoNavigationArguments, taoProps?: TaoProps): React.ReactNode
}

export type TaoStackNavDefinition = {
  initial: TaoPresentable
  name: string
}

export type TaoSlotNavDefinition = {
  initial: TaoPresentable | TaoNavigationValue
  name: string
}

export type TaoOverlayNavDefinition = {
  name: string
}

export type TaoAppDefinition = {
  auxiliaries(): Record<string, TaoNavigationValue>
  name: string
  navigator(): TaoNavigationValue
}

type NavigationEntry = {
  arguments: TaoNavigationArguments
  destination: string
  instanceId: number
}

type PresentableEntry = {
  arguments: TaoNavigationArguments
  instanceId: number
  presentable: TaoPresentable
}

type Subscription = {
  snapshot(): number
  subscribe(listener: () => void): () => void
}

const legacyStacks = new Set<RuntimeNavigationStack>()
const navigationValues = new Set<RuntimeNavigationValue>()
const appDefinitions = new Set<RuntimeAppDefinition>()
let activeBackTarget: { back(): boolean } | undefined

/** NavigationControls is the deterministic generated-code API for Tao navigation. */
export const NavigationControls = {
  /** Stack preserves the transitional closed-destination stack API. */
  Stack(definition: TaoNavigationStackDefinition): RuntimeNavigationStack {
    const stack = new RuntimeNavigationStack(definition)
    legacyStacks.add(stack)
    return stack
  },

  /** UI creates a first-class presentation descriptor for one Tao ui declaration. */
  UI(definition: TaoPresentableDefinition): TaoPresentable {
    return new RuntimePresentable(definition)
  },

  StackNav(definition: TaoStackNavDefinition): TaoNavigationValue {
    return registerNavigation(new RuntimeStackNav(definition))
  },

  SlotNav(definition: TaoSlotNavDefinition): TaoNavigationValue {
    return registerNavigation(new RuntimeSlotNav(definition))
  },

  OverlayNav(definition: TaoOverlayNavDefinition): TaoNavigationValue {
    return registerNavigation(new RuntimeOverlayNav(definition))
  },

  /** App creates a lazy, resettable process-local app navigation definition. */
  App(definition: TaoAppDefinition): RuntimeAppDefinition {
    const app = new RuntimeAppDefinition(definition)
    appDefinitions.add(app)
    return app
  },

  Host: NavigationHost,
  AppHost: NavigationAppHost,

  /** Present preserves the transitional explicit stack API. */
  Present(stack: RuntimeNavigationStack, destination: string, arguments_: TaoNavigationArguments): void {
    stack.present(destination, arguments_)
  },

  /** PresentIn presents through an explicit nav or the nearest enclosing nav in Tao props. */
  PresentIn(
    taoProps: TaoProps | undefined,
    target: TaoNavigationValue | undefined,
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
  ): void {
    const navigation = target ?? TaoPropsControls.navigationInChain(taoProps)
    if (!navigation) {
      throw new Error(`Cannot present ${presentable.name}: no enclosing or explicit navigation target.`)
    }
    navigation.present(presentable, arguments_)
  },

  /** PresentOverlay layers a UI above an explicit nav or the nearest enclosing nav. */
  PresentOverlay(
    taoProps: TaoProps | undefined,
    target: TaoNavigationValue | undefined,
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
  ): void {
    const navigation = target ?? TaoPropsControls.navigationInChain(taoProps)
    if (!navigation) {
      throw new Error(`Cannot present ${presentable.name} as overlay: no enclosing or explicit navigation target.`)
    }
    navigation.presentOverlay(presentable, arguments_)
  },

  /** Dismiss delegates to the nearest enclosing navigation container. */
  Dismiss(taoProps: TaoProps | undefined): void {
    const navigation = TaoPropsControls.navigationInChain(taoProps)
    if (!navigation) {
      throw new Error('Cannot dismiss: no enclosing navigation target.')
    }
    navigation.dismiss()
  },

  /** Replace swaps one app's root navigator by declaration identity. */
  Replace(navigator: TaoNavigationValue, app: RuntimeAppDefinition): void {
    app.replace(navigator)
  },

  /** Target resolves a strict keyed auxiliary on a generated app definition. */
  Target(app: RuntimeAppDefinition, key: string): TaoNavigationValue {
    const target = app.auxiliaries[key]
    if (!target) {
      throw new Error(`App ${app.definition.name} has no auxiliary navigator '@${key}'.`)
    }
    return target
  },

  Back(target?: { back(): boolean }): boolean {
    return (target ?? activeBackTarget)?.back() ?? false
  },

  /** beginTest resets cached generated navigation and apps before each Tao behavior check. */
  beginTest(): void {
    activeBackTarget = undefined
    for (const stack of legacyStacks) {
      stack.reset()
    }
    for (const navigation of navigationValues) {
      navigation.reset()
    }
    for (const app of appDefinitions) {
      app.reset()
    }
  },
} as const

export type TaoNavigationStack = RuntimeNavigationStack
export type TaoPresentable = RuntimePresentable
export type TaoNavigationValue = RuntimeNavigationValue
export type TaoRuntimeApp = RuntimeAppDefinition

/** RuntimePresentable is an evaluable UI descriptor used by aliases and configured navs. */
class RuntimePresentable {
  readonly kind = 'ui'

  constructor(readonly definition: TaoPresentableDefinition) {}

  get name(): string {
    return this.definition.name
  }

  evaluate(): this {
    return this
  }

  render(arguments_: TaoNavigationArguments, taoProps?: TaoProps): React.ReactNode {
    return this.definition.render(arguments_, taoProps)
  }
}

/** RuntimeNavigationValue is the shared process-local contract for Stack/Slot/Overlay navs. */
abstract class RuntimeNavigationValue implements Subscription {
  protected listeners = new Set<() => void>()
  protected version = 0
  private nextOverlayEntryId = 1
  private overlayEntries: PresentableEntry[] = []

  abstract readonly kind: 'stack' | 'slot' | 'overlay'
  abstract readonly name: string

  readonly subscribe = (listener: () => void): () => void => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly snapshot = (): number => this.version

  evaluate(): this {
    return this
  }

  get canGoBack(): boolean {
    return this.overlayEntries.length > 0 || this.canGoBackContent()
  }

  back(): boolean {
    return this.dismissOverlay() || this.backContent()
  }

  dismiss(): boolean {
    return this.dismissOverlay() || this.dismissContent()
  }

  abstract present(presentable: TaoPresentable, arguments_: TaoNavigationArguments): void

  presentOverlay(presentable: TaoPresentable, arguments_: TaoNavigationArguments): void {
    this.overlayEntries.push({
      arguments: { ...arguments_ },
      instanceId: this.nextOverlayEntryId++,
      presentable,
    })
    this.emit()
  }

  render(taoProps?: TaoProps): React.ReactNode {
    return React.createElement(NavigationSurface, {
      content: this.renderContent(taoProps),
      navigation: this,
      overlays: this.overlayEntries,
      taoProps,
    })
  }

  reset(): void {
    this.overlayEntries = []
    this.resetContent()
    this.emit()
  }

  protected abstract backContent(): boolean
  protected abstract canGoBackContent(): boolean
  protected abstract dismissContent(): boolean
  protected abstract renderContent(taoProps?: TaoProps): React.ReactNode
  protected abstract resetContent(): void

  protected emit(): void {
    this.version += 1
    for (const listener of this.listeners) {
      listener()
    }
  }

  private dismissOverlay(): boolean {
    if (this.overlayEntries.length === 0) {
      return false
    }
    this.overlayEntries.pop()
    this.emit()
    return true
  }
}

/** RuntimeStackNav owns an ordered presentation history and preserves covered entries. */
class RuntimeStackNav extends RuntimeNavigationValue {
  readonly kind = 'stack'
  readonly name: string
  private entries: PresentableEntry[]
  private nextEntryId = 1

  constructor(private readonly definition: TaoStackNavDefinition) {
    super()
    this.name = definition.name
    this.entries = [this.initialEntry()]
  }

  get depth(): number {
    return this.entries.length
  }

  present(presentable: TaoPresentable, arguments_: TaoNavigationArguments): void {
    this.entries.push({ arguments: { ...arguments_ }, instanceId: this.nextEntryId++, presentable })
    this.emit()
  }

  protected canGoBackContent(): boolean {
    return this.entries.length > 1
  }

  protected dismissContent(): boolean {
    return this.backContent()
  }

  protected backContent(): boolean {
    if (this.entries.length === 1) {
      return false
    }
    this.entries.pop()
    this.emit()
    return true
  }

  protected resetContent(): void {
    this.entries = [this.initialEntry()]
  }

  protected renderContent(taoProps?: TaoProps): React.ReactNode {
    return this.entries.map((entry, index) =>
      React.createElement(NavigationLevel, {
        children: entry.presentable.render(entry.arguments, navigationProps(taoProps, this)),
        hidden: index !== this.entries.length - 1,
        key: entry.instanceId,
      })
    )
  }

  private initialEntry(): PresentableEntry {
    return { arguments: {}, instanceId: this.nextEntryId++, presentable: this.definition.initial }
  }
}

/** RuntimeSlotNav shows either its Initial value or one currently presented UI. */
class RuntimeSlotNav extends RuntimeNavigationValue {
  readonly kind = 'slot'
  readonly name: string
  private presented: PresentableEntry | undefined
  private nextEntryId = 1

  constructor(private readonly definition: TaoSlotNavDefinition) {
    super()
    this.name = definition.name
    if (isNavigation(definition.initial)) {
      definition.initial.subscribe(() => this.emit())
    }
  }

  present(presentable: TaoPresentable, arguments_: TaoNavigationArguments): void {
    this.presented = { arguments: { ...arguments_ }, instanceId: this.nextEntryId++, presentable }
    this.emit()
  }

  protected dismissContent(): boolean {
    if (!this.presented) {
      return false
    }
    this.presented = undefined
    this.emit()
    return true
  }

  protected canGoBackContent(): boolean {
    return this.presented !== undefined
      || (isNavigation(this.definition.initial) && this.definition.initial.canGoBack)
  }

  protected backContent(): boolean {
    if (this.presented) {
      return this.dismissContent()
    }
    return isNavigation(this.definition.initial) ? this.definition.initial.back() : false
  }

  protected resetContent(): void {
    this.presented = undefined
    if (isNavigation(this.definition.initial)) {
      this.definition.initial.reset()
    }
  }

  protected renderContent(taoProps?: TaoProps): React.ReactNode {
    if (this.presented) {
      return this.presented.presentable.render(
        this.presented.arguments,
        navigationProps(taoProps, this),
      )
    }
    // Initial content presents and dismisses through this slot, exactly like presented content.
    return renderPresentable(this.definition.initial, {}, navigationProps(taoProps, this))
  }
}

/** RuntimeOverlayNav stacks presented UIs above primary app content. */
class RuntimeOverlayNav extends RuntimeNavigationValue {
  readonly kind = 'overlay'
  readonly name: string
  private entries: PresentableEntry[] = []
  private nextEntryId = 1

  constructor(definition: TaoOverlayNavDefinition) {
    super()
    this.name = definition.name
  }

  present(presentable: TaoPresentable, arguments_: TaoNavigationArguments): void {
    this.entries.push({ arguments: { ...arguments_ }, instanceId: this.nextEntryId++, presentable })
    this.emit()
  }

  protected canGoBackContent(): boolean {
    return this.entries.length > 0
  }

  protected dismissContent(): boolean {
    return this.backContent()
  }

  protected backContent(): boolean {
    if (this.entries.length === 0) {
      return false
    }
    this.entries.pop()
    this.emit()
    return true
  }

  protected resetContent(): void {
    this.entries = []
  }

  protected renderContent(taoProps?: TaoProps): React.ReactNode {
    return this.entries.map((entry, index) =>
      React.createElement(NavigationLevel, {
        children: entry.presentable.render(entry.arguments, navigationProps(taoProps, this)),
        fill: true,
        hidden: index !== this.entries.length - 1,
        key: entry.instanceId,
      })
    )
  }
}

/** RuntimeAppDefinition lazily resolves app nav factories after generated module initialization. */
class RuntimeAppDefinition implements Subscription {
  private auxiliariesValue: Record<string, TaoNavigationValue> | undefined
  private listeners = new Set<() => void>()
  private navigatorValue: TaoNavigationValue | undefined
  private replacement: TaoNavigationValue | undefined
  private version = 0

  constructor(readonly definition: TaoAppDefinition) {}

  readonly subscribe = (listener: () => void): () => void => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly snapshot = (): number => this.version

  get navigator(): TaoNavigationValue {
    return this.replacement ?? (this.navigatorValue ??= this.definition.navigator())
  }

  get auxiliaries(): Record<string, TaoNavigationValue> {
    return this.auxiliariesValue ??= this.definition.auxiliaries()
  }

  replace(navigator: TaoNavigationValue): void {
    this.replacement = navigator
    this.emit()
  }

  back(): boolean {
    for (const auxiliary of Object.values(this.auxiliaries).toReversed()) {
      if (auxiliary.back()) {
        return true
      }
    }
    return this.navigator.back()
  }

  get canGoBack(): boolean {
    return Object.values(this.auxiliaries).some(auxiliary => auxiliary.canGoBack)
      || this.navigator.canGoBack
  }

  reset(): void {
    this.replacement = undefined
    this.navigatorValue?.reset()
    for (const auxiliary of Object.values(this.auxiliariesValue ?? {})) {
      auxiliary.reset()
    }
    this.emit()
  }

  private emit(): void {
    this.version += 1
    for (const listener of this.listeners) {
      listener()
    }
  }
}

/** RuntimeNavigationStack owns one transitional ordered navigation history. */
class RuntimeNavigationStack implements Subscription {
  private entries: NavigationEntry[]
  private listeners = new Set<() => void>()
  private nextEntryId = 1
  private version = 0

  constructor(readonly definition: TaoNavigationStackDefinition) {
    if (!definition.destinations[definition.initial]) {
      throw new Error(`Navigation stack ${definition.name} has no initial destination '${definition.initial}'.`)
    }
    this.entries = [this.initialEntry()]
  }

  readonly subscribe = (listener: () => void): () => void => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly snapshot = (): number => this.version

  get currentDestination(): string {
    return this.currentEntry().destination
  }

  get depth(): number {
    return this.entries.length
  }

  present(destination: string, arguments_: TaoNavigationArguments): void {
    if (!this.definition.destinations[destination]) {
      throw new Error(`Navigation stack ${this.definition.name} has no destination '${destination}'.`)
    }
    this.entries.push({ arguments: { ...arguments_ }, destination, instanceId: this.nextEntryId++ })
    this.emit()
  }

  back(): boolean {
    if (this.entries.length === 1) {
      return false
    }
    this.entries.pop()
    this.emit()
    return true
  }

  reset(): void {
    this.entries = [this.initialEntry()]
    this.emit()
  }

  render(taoProps?: TaoProps): React.ReactNode {
    return this.entries.map((entry, index) =>
      React.createElement(NavigationLevel, {
        children: this.definition.destinations[entry.destination]!.render(entry.arguments, taoProps),
        hidden: index !== this.entries.length - 1,
        key: entry.instanceId,
      })
    )
  }

  private currentEntry(): NavigationEntry {
    return this.entries[this.entries.length - 1]!
  }

  private initialEntry(): NavigationEntry {
    return { arguments: {}, destination: this.definition.initial, instanceId: this.nextEntryId++ }
  }

  private emit(): void {
    this.version += 1
    for (const listener of this.listeners) {
      listener()
    }
  }
}

function NavigationHost(props: { stack: RuntimeNavigationStack; __tao?: TaoProps }): React.JSX.Element {
  useSubscription(props.stack)
  React.useSyncExternalStore(DataControls.subscribeAll, DataControls.revision, DataControls.revision)
  usePlatformBack(props.stack)
  return React.createElement(
    React.Fragment,
    null,
    props.stack.depth > 1 ? React.createElement(NavigationBackAffordance, { target: props.stack }) : null,
    props.stack.render(props.__tao),
  )
}

function NavigationAppHost(props: { app: RuntimeAppDefinition; __tao?: TaoProps }): React.JSX.Element {
  useSubscription(props.app)
  const navigator = props.app.navigator
  const auxiliaries = Object.values(props.app.auxiliaries)
  useSubscription(navigator)
  // App auxiliary declarations are static, so hook cardinality is stable for the mounted app.
  for (const auxiliary of auxiliaries) {
    useSubscription(auxiliary)
  }
  React.useSyncExternalStore(DataControls.subscribeAll, DataControls.revision, DataControls.revision)
  usePlatformBack(props.app)
  const overlayAuxiliaries = auxiliaries.filter(auxiliary => auxiliary.kind === 'overlay')
  const contentAuxiliaries = auxiliaries.filter(auxiliary => auxiliary.kind !== 'overlay')
  const runtime = requireReactNativeRuntime()
  return React.createElement(runtime.View, {
    children: [
      React.createElement(
        React.Fragment,
        { key: 'content' },
        props.app.canGoBack
          ? React.createElement(NavigationBackAffordance, { target: props.app })
          : null,
        navigator.render(props.__tao),
        ...contentAuxiliaries.map(auxiliary => auxiliary.render(props.__tao)),
      ),
      overlayAuxiliaries.length > 0
        ? React.createElement(runtime.View, {
          children: overlayAuxiliaries.map((auxiliary, index) =>
            React.createElement(
              React.Fragment,
              { key: `${auxiliary.name}-${index}` },
              auxiliary.render(props.__tao),
            )
          ),
          key: 'app-overlays',
          pointerEvents: 'box-none',
          style: overlayLayerStyle,
        })
        : null,
    ],
    pointerEvents: 'box-none',
    style: navigationHostStyle,
  })
}

function useSubscription(subscription: Subscription): void {
  React.useSyncExternalStore(subscription.subscribe, subscription.snapshot, subscription.snapshot)
}

function usePlatformBack(target: { back(): boolean }): void {
  React.useEffect(() => {
    activeBackTarget = target
    const subscription = requireReactNativeRuntime().BackHandler?.addEventListener(
      'hardwareBackPress',
      () => NavigationControls.Back(target as RuntimeNavigationStack),
    )
    return () => {
      subscription?.remove()
      if (activeBackTarget === target) {
        activeBackTarget = undefined
      }
    }
  }, [target])
}

/** NavigationLevel hides covered stack entries without unmounting their local React state. */
function NavigationLevel(props: {
  children?: React.ReactNode
  fill?: boolean
  hidden: boolean
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  return React.createElement(runtime.View, {
    accessibilityElementsHidden: props.hidden,
    children: props.children,
    importantForAccessibility: props.hidden ? 'no-hide-descendants' : 'auto',
    style: props.hidden ? hiddenNavigationLevelStyle : props.fill ? visibleOverlayLevelStyle : undefined,
  })
}

/** NavigationBackAffordance exposes the same root-safe reducer through an accessible control. */
function NavigationBackAffordance(props: {
  target: { back(): boolean }
}): React.JSX.Element | null {
  return Views.Pressable(
    { action: { invoke: () => NavigationControls.Back(props.target) }, title: 'Back' },
    { nativeProps: { accessibilityLabel: 'Back', accessibilityRole: 'button' } },
  )
}

const navigationHostStyle = { flex: 1, position: 'relative' } as const
const overlayLayerStyle = {
  bottom: 0,
  left: 0,
  position: 'absolute',
  right: 0,
  top: 0,
  zIndex: 1,
} as const
const hiddenNavigationLevelStyle = { display: 'none' } as const
const visibleOverlayLevelStyle = { flex: 1 } as const

/** NavigationSurface gives every nav a relative host and its own absolute overlay lane. */
function NavigationSurface(props: {
  content?: React.ReactNode
  navigation: TaoNavigationValue
  overlays: PresentableEntry[]
  taoProps?: TaoProps
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  const overlays = props.overlays.length > 0
    ? React.createElement(runtime.View, {
      children: props.overlays.map((entry, index) =>
        React.createElement(NavigationLevel, {
          children: entry.presentable.render(
            entry.arguments,
            navigationProps(props.taoProps, props.navigation),
          ),
          fill: true,
          hidden: index !== props.overlays.length - 1,
          key: entry.instanceId,
        })
      ),
      pointerEvents: 'box-none',
      style: overlayLayerStyle,
    })
    : null
  return React.createElement(
    runtime.View,
    { pointerEvents: 'box-none', style: navigationHostStyle },
    props.content,
    overlays,
  )
}

function registerNavigation<ValueT extends RuntimeNavigationValue>(navigation: ValueT): ValueT {
  navigationValues.add(navigation)
  return navigation
}

function navigationProps(props: TaoProps | undefined, navigation: TaoNavigationValue): TaoProps {
  return { ...props, navigation }
}

function isNavigation(value: TaoPresentable | TaoNavigationValue): value is TaoNavigationValue {
  return value instanceof RuntimeNavigationValue
}

function renderPresentable(
  value: TaoPresentable | TaoNavigationValue,
  arguments_: TaoNavigationArguments,
  taoProps?: TaoProps,
): React.ReactNode {
  return isNavigation(value)
    ? value.render(taoProps)
    : value.render(arguments_, taoProps)
}
