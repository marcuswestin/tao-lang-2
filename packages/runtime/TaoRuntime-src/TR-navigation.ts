import { Errors, Switch } from '@shared/core'
import React from 'react'
import { DataControls } from './TR-data'
import {
  configureNavigation,
  createAppDeclaration,
  createNavDeclaration,
  freezeNavConfiguration,
  isConfiguredNavigation,
  mountConfiguredNavigation,
  resolveNavigationTarget,
} from './TR-navigation-configuration'
import { RuntimeSelectionNav, RuntimeSlotNav, RuntimeStackNav } from './TR-navigation-mounts'
import {
  type Evaluable,
  RuntimeDialogue,
  RuntimePresentable,
} from './TR-navigation-presentables'
import {
  backNavigation,
  clearActiveBackTarget,
  registerNavigation,
  registerNavigationApp,
  resetNavigationRuntime,
  setActiveBackTarget,
} from './TR-navigation-registry'
import type { PresentableEntry, Subscription } from './TR-navigation-state'
import { NavigationBackAffordance, navigationHostStyle } from './TR-navigation-surfaces'
import { RuntimeNavigationValue } from './TR-navigation-value'
import { requireReactNativeRuntime } from './TR-react-native'
import { type TaoProps, TaoPropsControls } from './TR-TaoProps'

export type TaoNavigationArguments = Record<string, Evaluable>

export type TaoPresentableDefinition = {
  name: string
  render(arguments_: TaoNavigationArguments, taoProps?: TaoProps): React.ReactNode
}

export type TaoDialogueDefinition = TaoPresentableDefinition

export type TaoSelectionNavItemDefinition = {
  content: TaoPresentable | TaoNavigationValue
  label: Evaluable
}

export type TaoAppDeclaration = Readonly<{
  identity: symbol
  name: string
}>

export type TaoAppDefinition = {
  auxiliaries(): Record<string, TaoNavigationInput>
  declaration?: TaoAppDeclaration
  name: string
  navigator(): TaoNavigationInput
}

export type TaoNavigationPatch = Readonly<Record<string, unknown>>
export type TaoNavigationConfiguration = Readonly<Record<string, unknown>>
export type TaoConfiguredNavigation = Readonly<{
  config: TaoNavigationConfiguration
  declaration: TaoImplementedNavDeclaration
  evaluate(): TaoConfiguredNavigation
}>

export type TaoNavigationInput = TaoNavigationValue | TaoConfiguredNavigation

export type TaoToastPresentationOptions = {
  duration: Evaluable
  key: Evaluable
}

export type TaoNavKindProfile = 'selection' | 'slot' | 'stack'

export type TaoNavDeclaration = Readonly<{
  identity: symbol
  name: string
}>

export type TaoImplementedNavDeclaration =
  & TaoNavDeclaration
  & Readonly<{
    kind: TaoNavKind<any, any>
  }>

export type TaoStackNavConfiguration = Readonly<{
  initial: TaoPresentable
}>

export type TaoSlotNavConfiguration = Readonly<{
  initial: TaoPresentable | TaoNavigationValue
}>

export type TaoSelectionNavConfiguration = Readonly<{
  display: Evaluable
  initial: string
  items: Readonly<Record<string, Readonly<TaoSelectionNavItemDefinition>>>
}>

export type TaoNavDescriptor<
  ProfileT extends TaoNavKindProfile = TaoNavKindProfile,
  ConfigurationT extends object = object,
> = Readonly<{
  config: Readonly<ConfigurationT>
  declaration: TaoNavDeclaration
  kind: TaoNavKind<ProfileT, ConfigurationT>
  profile: ProfileT
}>

export type TaoNavMount<
  ProfileT extends TaoNavKindProfile = TaoNavKindProfile,
  ConfigurationT extends object = object,
> = {
  readonly canGoBack: boolean
  readonly descriptor: TaoNavDescriptor<ProfileT, ConfigurationT>
  readonly kind: ProfileT
  readonly name: string
  activate(key: string): boolean
  back(): boolean
  dismiss(): boolean
  evaluate(): TaoNavMount<ProfileT, ConfigurationT>
  present(presentable: TaoPresentable, arguments_: TaoNavigationArguments): void
  presentOverlay(presentable: TaoPresentable, arguments_: TaoNavigationArguments): void
  render(taoProps?: TaoProps): React.ReactNode
  reset(): void
  snapshot(): number
  subscribe(listener: () => void): () => void
}

/** TaoNavKind is the published declaration-owned navigation implementation protocol. */
export type TaoNavKind<
  ProfileT extends TaoNavKindProfile = TaoNavKindProfile,
  ConfigurationT extends object = object,
> = Readonly<{
  profile: ProfileT
  activate(mount: TaoNavMount<ProfileT, ConfigurationT>, key: string): boolean
  back(mount: TaoNavMount<ProfileT, ConfigurationT>): boolean
  canGoBack(mount: TaoNavMount<ProfileT, ConfigurationT>): boolean
  configure(
    declaration: TaoNavDeclaration,
    config: ConfigurationT,
  ): TaoNavDescriptor<ProfileT, ConfigurationT>
  dismiss(mount: TaoNavMount<ProfileT, ConfigurationT>): boolean
  mount(descriptor: TaoNavDescriptor<ProfileT, ConfigurationT>): TaoNavMount<ProfileT, ConfigurationT>
  present(
    mount: TaoNavMount<ProfileT, ConfigurationT>,
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
  ): void
  render(mount: TaoNavMount<ProfileT, ConfigurationT>, taoProps?: TaoProps): React.ReactNode
  reset(mount: TaoNavMount<ProfileT, ConfigurationT>): void
}>

type ToastEntry = PresentableEntry & {
  key: string
  timeout: ReturnType<typeof setTimeout>
}

/** NavigationControls is the deterministic generated-code API for Tao navigation. */
export const NavigationControls = {
  /** AppDeclaration creates one process-local source declaration identity for app configurations. */
  AppDeclaration(name: string): TaoAppDeclaration {
    return createAppDeclaration(name)
  },

  /** Declaration binds one Tao declaration identity to its package-scope implementation. */
  Declaration(name: string, kind: TaoNavKind<any, any>): TaoImplementedNavDeclaration {
    const declaration = { ...createNavDeclaration(name), kind }
    return Object.freeze(declaration)
  },

  /** Configure creates an immutable declaration-owned descriptor without mounting occurrence state. */
  Configure(
    declaration: TaoImplementedNavDeclaration,
    config: Record<string, unknown>,
  ): TaoConfiguredNavigation {
    return configureNavigation(declaration, config)
  },

  /** Mount creates independent navigation state for one configured descriptor occurrence. */
  Mount(configured: TaoConfiguredNavigation): TaoNavigationValue {
    return mountConfiguredNavigation(configured)
  },

  /** UI creates a first-class presentation descriptor for one Tao ui declaration. */
  UI(definition: TaoPresentableDefinition): TaoPresentable {
    return new RuntimePresentable(definition)
  },

  /** Dialogue creates a descriptor whose independently asked occurrences own their resolvers. */
  Dialogue(definition: TaoDialogueDefinition): TaoDialogue {
    return new RuntimeDialogue(definition)
  },

  /** App creates a lazy, resettable process-local app navigation definition. */
  App(definition: TaoAppDefinition): RuntimeAppDefinition {
    const app = new RuntimeAppDefinition(definition)
    return registerNavigationApp(app)
  },

  AppHost: NavigationAppHost,

  /** PresentIn presents through an explicit nav or the nearest enclosing nav in Tao props. */
  PresentIn(
    taoProps: TaoProps | undefined,
    target: TaoNavigationInput | undefined,
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
  ): void {
    const navigation = resolveNavigationTarget(taoProps, target)
    if (!navigation) {
      throw new Error(`Cannot present ${presentable.name}: no enclosing or explicit navigation target.`)
    }
    navigation.present(presentable, arguments_)
  },

  /** PresentOverlay layers a UI above an explicit nav or the nearest enclosing nav. */
  PresentOverlay(
    taoProps: TaoProps | undefined,
    target: TaoNavigationInput | undefined,
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
  ): void {
    const navigation = resolveNavigationTarget(taoProps, target)
    if (!navigation) {
      throw new Error(`Cannot present ${presentable.name} as overlay: no enclosing or explicit navigation target.`)
    }
    navigation.presentOverlay(presentable, arguments_)
  },

  /** PresentToast replaces one app-owned key and restarts its transient expiry. */
  PresentToast(
    taoProps: TaoProps | undefined,
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
    options: TaoToastPresentationOptions,
  ): void {
    const app = TaoPropsControls.appInChain(taoProps)
    if (!app) {
      throw new Error(`Cannot present ${presentable.name} as toast: no enclosing app.`)
    }
    const key = options.key.evaluate().jsValue
    const duration = options.duration.evaluate().jsValue
    if (typeof key !== 'string') {
      throw new Error(`Cannot present ${presentable.name} as toast: Key must evaluate to text.`)
    }
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
      throw new Error(`Cannot present ${presentable.name} as toast: Duration must be a finite non-negative number.`)
    }
    app.presentToast(key, duration, presentable, arguments_)
  },

  /** Ask stacks a fresh dialogue occurrence above the nearest enclosing navigation container. */
  Ask(
    taoProps: TaoProps | undefined,
    dialogue: TaoDialogue,
    arguments_: TaoNavigationArguments,
  ): Promise<Evaluable> {
    const navigation = TaoPropsControls.navigationInChain(taoProps)
    if (!navigation) {
      throw new Error(`Cannot ask ${dialogue.name}: no enclosing navigation target.`)
    }
    return navigation.ask(dialogue, arguments_)
  },

  /** Respond settles only the dialogue occurrence inherited by the responding render tree. */
  Respond(taoProps: TaoProps | undefined, value?: Evaluable): void {
    const dialogue = TaoPropsControls.dialogueInChain(taoProps)
    if (!dialogue) {
      throw new Error('Cannot respond: no enclosing dialogue occurrence.')
    }
    dialogue.respond(value)
  },

  /** Dismiss delegates to the nearest enclosing navigation container. */
  Dismiss(taoProps: TaoProps | undefined): void {
    const navigation = TaoPropsControls.navigationInChain(taoProps)
    if (!navigation) {
      throw new Error('Cannot dismiss: no enclosing navigation target.')
    }
    navigation.dismiss()
  },

  /** Replace swaps the matching enclosing app occurrence's root navigator. */
  Replace(taoProps: TaoProps | undefined, navigator: TaoNavigationInput, target: RuntimeAppDefinition): void {
    resolveStrictAppTarget(taoProps, target, 'replace').replace(navigator)
  },

  /** Patch creates a configured navigation copy without mutating the base value. */
  Patch<BaseT extends TaoNavigationInput>(
    base: BaseT,
    patch: TaoNavigationPatch,
  ): BaseT extends TaoConfiguredNavigation ? TaoConfiguredNavigation : TaoNavigationValue {
    const result = isConfiguredNavigation(base)
      ? NavigationControls.PatchConfigured(base, patch)
      : registerNavigation(base.patched(patch))
    return result as BaseT extends TaoConfiguredNavigation ? TaoConfiguredNavigation : TaoNavigationValue
  },

  /** PatchConfigured merge-copies immutable descriptor configuration without mounting it. */
  PatchConfigured(configured: TaoConfiguredNavigation, patch: Record<string, unknown>): TaoConfiguredNavigation {
    return NavigationControls.Configure(
      configured.declaration,
      { ...configured.config, ...patch },
    )
  },

  /** Activate reveals one keyed item on the matching enclosing app occurrence. */
  Activate(taoProps: TaoProps | undefined, target: RuntimeAppDefinition, key: string): void {
    const app = resolveStrictAppTarget(taoProps, target, 'activate')
    if (!app.navigator.activate(key)) {
      throw new Error(`App ${app.definition.name} has no selection item '@${key}'.`)
    }
  },

  /** Target resolves a keyed auxiliary on the matching enclosing app occurrence. */
  Target(taoProps: TaoProps | undefined, targetApp: RuntimeAppDefinition, key: string): TaoNavigationValue {
    const app = resolveStrictAppTarget(taoProps, targetApp, 'target')
    const target = app.auxiliaries[key]
    if (!target) {
      throw new Error(`App ${app.definition.name} has no auxiliary navigator '@${key}'.`)
    }
    return target
  },

  Back(target?: { back(): boolean }): boolean {
    return backNavigation(target)
  },

  /** beginTest resets cached generated navigation and apps before each Tao behavior check. */
  beginTest(): void {
    resetNavigationRuntime()
  },
} as const

export type TaoPresentable = RuntimePresentable
export type TaoDialogue = RuntimeDialogue
export type TaoNavigationValue = RuntimeNavigationValue
export type TaoRuntimeApp = RuntimeAppDefinition

function resolveStrictAppTarget(
  taoProps: TaoProps | undefined,
  target: RuntimeAppDefinition,
  operation: 'activate' | 'replace' | 'target',
): RuntimeAppDefinition {
  const app = TaoPropsControls.appInChain(
    taoProps,
    candidate => candidate.declaration.identity === target.declaration.identity,
  )
  if (app) {
    return app
  }
  throw new Errors.UnexpectedBehaviorError(
    `Cannot ${operation} app '${target.declaration.name}': no enclosing instance matches its declaration.`,
    { details: { appDeclaration: target.declaration.name, operation } },
  )
}

type NavMountFactory<ProfileT extends TaoNavKindProfile, ConfigurationT extends object> = (
  descriptor: TaoNavDescriptor<ProfileT, ConfigurationT>,
) => TaoNavMount<ProfileT, ConfigurationT>

/** RuntimeNavKind implements the public protocol while profile mounts own all mutable state. */
class RuntimeNavKind<ProfileT extends TaoNavKindProfile, ConfigurationT extends object>
  implements TaoNavKind<ProfileT, ConfigurationT>
{
  constructor(
    readonly profile: ProfileT,
    private readonly createMount: NavMountFactory<ProfileT, ConfigurationT>,
  ) {}

  configure(
    declaration: TaoNavDeclaration,
    config: ConfigurationT,
  ): TaoNavDescriptor<ProfileT, ConfigurationT> {
    const descriptor: TaoNavDescriptor<ProfileT, ConfigurationT> = {
      config: freezeNavConfiguration(config),
      declaration,
      kind: this,
      profile: this.profile,
    }
    return Object.freeze(descriptor)
  }

  mount(descriptor: TaoNavDescriptor<ProfileT, ConfigurationT>): TaoNavMount<ProfileT, ConfigurationT> {
    this.assertDescriptor(descriptor)
    return this.createMount(descriptor)
  }

  render(
    mount: TaoNavMount<ProfileT, ConfigurationT>,
    taoProps?: TaoProps,
  ): React.ReactNode {
    this.assertMount(mount)
    return mount.render(taoProps)
  }

  present(
    mount: TaoNavMount<ProfileT, ConfigurationT>,
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
  ): void {
    this.assertMount(mount)
    mount.present(presentable, arguments_)
  }

  dismiss(mount: TaoNavMount<ProfileT, ConfigurationT>): boolean {
    this.assertMount(mount)
    return mount.dismiss()
  }

  back(mount: TaoNavMount<ProfileT, ConfigurationT>): boolean {
    this.assertMount(mount)
    return mount.back()
  }

  reset(mount: TaoNavMount<ProfileT, ConfigurationT>): void {
    this.assertMount(mount)
    mount.reset()
  }

  canGoBack(mount: TaoNavMount<ProfileT, ConfigurationT>): boolean {
    this.assertMount(mount)
    return mount.canGoBack
  }

  activate(mount: TaoNavMount<ProfileT, ConfigurationT>, key: string): boolean {
    this.assertMount(mount)
    return mount.activate(key)
  }

  private assertDescriptor(descriptor: TaoNavDescriptor<ProfileT, ConfigurationT>): void {
    assertNavKind(
      descriptor.kind === this && descriptor.profile === this.profile,
      `Cannot mount a ${descriptor.profile} descriptor with the ${this.profile} implementation.`,
    )
  }

  private assertMount(mount: TaoNavMount<ProfileT, ConfigurationT>): void {
    this.assertDescriptor(mount.descriptor)
  }
}

const stackNavKind = Object.freeze(
  new RuntimeNavKind<'stack', TaoStackNavConfiguration>(
    'stack',
    descriptor => new RuntimeStackNav(descriptor),
  ),
)
const slotNavKind = Object.freeze(
  new RuntimeNavKind<'slot', TaoSlotNavConfiguration>(
    'slot',
    descriptor => new RuntimeSlotNav(descriptor),
  ),
)
const selectionNavKind = Object.freeze(
  new RuntimeNavKind<'selection', TaoSelectionNavConfiguration>(
    'selection',
    descriptor => new RuntimeSelectionNav(descriptor),
  ),
)

/** NavKindControls publishes the built-in implementations used by Tao `implement inject`. */
export const NavKindControls = {
  Declaration: createNavDeclaration,
  Selection: (): TaoNavKind<'selection', TaoSelectionNavConfiguration> => selectionNavKind,
  Slot: (): TaoNavKind<'slot', TaoSlotNavConfiguration> => slotNavKind,
  Stack: (): TaoNavKind<'stack', TaoStackNavConfiguration> => stackNavKind,
} as const

/** testNavKind runs the published navigation protocol suite without depending on a test runner. */
export function testNavKind(
  kind: TaoNavKind<any, any>,
  profile: TaoNavKindProfile,
): void {
  assertNavKind(kind.profile === profile, `Expected the '${profile}' profile, received '${kind.profile}'.`)

  const declaration = createNavDeclaration(`Conformance ${profile}`)
  const home = new RuntimePresentable({ name: 'Home', render: () => null })
  const detail = new RuntimePresentable({ name: 'Detail', render: () => null })
  const notice = new RuntimePresentable({ name: 'Notice', render: () => null })
  const descriptor = kind.configure(declaration, conformanceConfiguration(profile, home, detail))

  assertNavKind(Object.isFrozen(declaration), 'Declarations must be immutable.')
  assertNavKind(Object.isFrozen(descriptor), 'Configured descriptors must be immutable.')
  assertNavKind(Object.isFrozen(descriptor.config), 'Normalized descriptor configuration must be immutable.')
  assertNavKind(descriptor.declaration === declaration, 'A descriptor must retain declaration identity.')
  assertNavKind(descriptor.kind === kind, 'A descriptor must retain its implementation identity.')
  assertNavKind(descriptor.profile === profile, 'A descriptor must retain its navigation profile.')

  const first = kind.mount(descriptor)
  const second = kind.mount(descriptor)
  assertNavKind(first !== second, 'Each descriptor mount must create an independent occurrence.')
  assertNavKind(first.descriptor === descriptor, 'A mount must retain its immutable descriptor.')
  assertNavKind(second.descriptor === descriptor, 'Every mount must retain its immutable descriptor.')
  assertNavKind(!kind.canGoBack(first) && !kind.canGoBack(second), 'Fresh mounts must begin at their root.')

  const secondVersion = second.snapshot()
  kind.present(first, detail, {})
  assertNavKind(kind.canGoBack(first), 'Present must make the changed mount dismissible.')
  assertNavKind(!kind.canGoBack(second), 'Present must not mutate another mount of the descriptor.')
  assertNavKind(second.snapshot() === secondVersion, 'Mount notifications must remain occurrence-local.')
  assertNavKind(kind.back(first), 'Back must consume a presented occurrence.')
  assertNavKind(!kind.back(first), 'Back must be root-safe.')

  first.presentOverlay(notice, {})
  assertNavKind(kind.canGoBack(first), 'A nav-owned overlay must participate in back state.')
  assertNavKind(kind.dismiss(first), 'Dismiss must consume the top nav-owned overlay first.')
  assertNavKind(!kind.canGoBack(first), 'Dismissing the only overlay must restore root state.')

  testNavKindProfile(kind, profile, first, detail)
  kind.reset(first)
  assertNavKind(!kind.canGoBack(first), 'Reset must restore the configured root.')
  assertNavKind(!kind.canGoBack(second), 'Resetting one mount must not mutate another mount.')
}

/** RuntimeAppDefinition lazily resolves app nav factories after generated module initialization. */
class RuntimeAppDefinition implements Subscription {
  private auxiliariesValue: Record<string, TaoNavigationValue> | undefined
  private descriptorMounts = new Map<TaoConfiguredNavigation, TaoNavigationValue>()
  private listeners = new Set<() => void>()
  private nextToastEntryId = 1
  private navigatorValue: TaoNavigationValue | undefined
  private replacement: TaoNavigationValue | undefined
  private toastEntries = new Map<string, ToastEntry>()
  private version = 0

  readonly declaration: TaoAppDeclaration

  constructor(readonly definition: TaoAppDefinition) {
    this.declaration = definition.declaration ?? createAppDeclaration(definition.name)
  }

  readonly subscribe = (listener: () => void): () => void => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly snapshot = (): number => this.version

  get navigator(): TaoNavigationValue {
    return this.replacement ?? (this.navigatorValue ??= this.mount(this.definition.navigator()))
  }

  get auxiliaries(): Record<string, TaoNavigationValue> {
    return this.auxiliariesValue ??= Object.fromEntries(
      Object.entries(this.definition.auxiliaries()).map(([key, value]) => [key, this.mount(value)]),
    )
  }

  replace(navigator: TaoNavigationInput): void {
    this.replacement = this.mount(navigator)
    this.emit()
  }

  /** resolve returns the mounted occurrence owned by this app for one descriptor identity. */
  resolve(configured: TaoConfiguredNavigation): TaoNavigationValue | undefined {
    // Force lazy app configuration before resolving a target nested in its root or auxiliaries.
    void this.navigator
    void this.auxiliaries
    return this.descriptorMounts.get(configured)
  }

  presentToast(
    key: string,
    durationSeconds: number,
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
  ): void {
    const existing = this.toastEntries.get(key)
    if (existing) {
      clearTimeout(existing.timeout)
    }
    const entry: ToastEntry = {
      arguments: { ...arguments_ },
      instanceId: this.nextToastEntryId++,
      key,
      presentable,
      timeout: setTimeout(() => this.expireToast(key, entry), durationSeconds * 1000),
    }
    this.toastEntries.set(key, entry)
    this.emit()
  }

  renderToasts(taoProps?: TaoProps): React.ReactNode {
    return [...this.toastEntries.values()].map(entry =>
      React.createElement(
        React.Fragment,
        { key: entry.instanceId },
        entry.presentable.render(entry.arguments, { ...taoProps, app: this }),
      )
    )
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
    for (const entry of this.toastEntries.values()) {
      clearTimeout(entry.timeout)
    }
    this.toastEntries.clear()
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

  private mount(input: TaoNavigationInput): TaoNavigationValue {
    return isConfiguredNavigation(input)
      ? mountConfiguredNavigation(input, (configured, mount) => this.descriptorMounts.set(configured, mount))
      : input
  }

  private expireToast(key: string, entry: ToastEntry): void {
    if (this.toastEntries.get(key) !== entry) {
      return
    }
    this.toastEntries.delete(key)
    this.emit()
  }
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
  const runtime = requireReactNativeRuntime()
  const appTaoProps = { ...props.__tao, app: props.app }
  const toasts = props.app.renderToasts(appTaoProps)
  return React.createElement(runtime.View, {
    children: [
      React.createElement(
        React.Fragment,
        { key: 'content' },
        props.app.canGoBack
          ? React.createElement(NavigationBackAffordance, { target: props.app })
          : null,
        navigator.render(appTaoProps),
        ...auxiliaries.map(auxiliary => auxiliary.render(appTaoProps)),
      ),
      React.Children.count(toasts) > 0
        ? React.createElement(runtime.View, {
          children: toasts,
          key: 'app-toasts',
          pointerEvents: 'box-none',
          style: toastLayerStyle,
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
    setActiveBackTarget(target)
    const subscription = requireReactNativeRuntime().BackHandler?.addEventListener(
      'hardwareBackPress',
      () => backNavigation(target),
    )
    return () => {
      subscription?.remove()
      clearActiveBackTarget(target)
    }
  }, [target])
}

const toastLayerStyle = {
  bottom: 0,
  left: 0,
  position: 'absolute',
  right: 0,
  zIndex: 2,
} as const

function conformanceConfiguration(
  profile: TaoNavKindProfile,
  home: TaoPresentable,
  detail: TaoPresentable,
): TaoStackNavConfiguration | TaoSlotNavConfiguration | TaoSelectionNavConfiguration {
  if (profile === 'selection') {
    return {
      display: { evaluate: () => ({ jsValue: 'automatic' }) },
      initial: 'home',
      items: {
        home: { content: home, label: { evaluate: () => ({ jsValue: 'Home' }) } },
        settings: { content: detail, label: { evaluate: () => ({ jsValue: 'Settings' }) } },
      },
    }
  }
  return {
    initial: home,
  }
}

function testNavKindProfile(
  kind: TaoNavKind<any, any>,
  profile: TaoNavKindProfile,
  mount: TaoNavMount<any, any>,
  detail: TaoPresentable,
): void {
  Switch(profile, {
    stack: () => {
      kind.present(mount, detail, {})
      kind.present(mount, detail, {})
      assertNavKind(kind.dismiss(mount), 'Stack dismiss must pop the newest occurrence.')
      assertNavKind(kind.canGoBack(mount), 'Stack dismiss must preserve the covered occurrence.')
      assertNavKind(kind.back(mount), 'Stack back must pop the remaining presented occurrence.')
      assertNavKind(!kind.dismiss(mount), 'Stack dismiss must be root-safe.')
    },
    slot: () => {
      kind.present(mount, detail, {})
      kind.present(mount, detail, {})
      assertNavKind(kind.dismiss(mount), 'Slot dismiss must restore Initial after replacement.')
      assertNavKind(!kind.canGoBack(mount), 'Slot replacement must not accumulate history.')
      assertNavKind(!kind.dismiss(mount), 'Slot dismiss must be root-safe.')
    },
    selection: () => {
      assertNavKind(kind.activate(mount, 'settings'), 'Selection must activate a declared keyed child.')
      assertNavKind(!kind.canGoBack(mount), 'Selection activation must not create content history.')
      assertNavKind(!kind.activate(mount, 'missing'), 'Selection must reject an unknown keyed child.')
      kind.present(mount, detail, {})
      assertNavKind(kind.back(mount), 'Selection back must pop content from the active keyed child.')
      assertNavKind(!kind.canGoBack(mount), 'Selection back must restore the keyed child root.')
    },
  })
}

function assertNavKind(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`NavKind conformance failed: ${message}`)
  }
}
