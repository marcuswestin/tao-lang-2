import type React from 'react'
import type { TaoDesign } from './TR-design'
import { UnexpectedBehaviorError } from './TR-errors'
import { ownerOfNavigation, RuntimeAppDefinition } from './TR-navigation-app'
import { NavigationAppHost } from './TR-navigation-app-host'
import {
  configureNavigation,
  createAppDeclaration,
  createNavDeclaration,
  isConfiguredNavigation,
  mountConfiguredNavigation,
  resolveNavigationTarget,
} from './TR-navigation-configuration'
import {
  type RuntimeHostReadChannel,
  RuntimeNavigationCommand,
  type TaoCommandAction,
  type TaoCommandDefinition,
  type TaoHostSlotValues,
  type TaoNavHostSlotConfiguration,
  useHostSlots,
} from './TR-navigation-host-slots'
import {
  declarationIdentity,
  type TaoCanonicalDescriptor,
  type TaoDeclarationIdentity,
  type TaoDeclarationIdentityTuple,
} from './TR-navigation-identity'
import { disableNativeNavigationSurfaces } from './TR-navigation-native-hosts'
import {
  type Evaluable,
  RuntimePresentable,
} from './TR-navigation-presentables'
import {
  backNavigation,
  registerNavigation,
  registerNavigationApp,
  registerPresentable,
  resetNavigationRuntime,
  resolvePresentable,
} from './TR-navigation-registry'
import {
  beginNavigationRestorationTest,
  endNavigationRestorationTest,
} from './TR-navigation-restoration'
import { RuntimeNavigationValue } from './TR-navigation-value'
import { type TaoProps, TaoPropsControls } from './TR-TaoProps'

export { testNavKind } from './TR-navigation-conformance'
export { NavKindControls } from './TR-navigation-kinds'

export type TaoNavigationArguments = Record<string, Evaluable>

export type TaoPresentableDefinition = {
  identity?: TaoDeclarationIdentity
  name: string
  source?: Readonly<{ end: number; path: string; start: number }>
  render(
    arguments_: TaoNavigationArguments,
    taoProps?: TaoProps,
    host?: RuntimeHostReadChannel,
  ): React.ReactNode
}

export type TaoSelectionNavItemDefinition = {
  content: TaoPresentable | TaoNavigationValue
  icon?: Evaluable
  label: Evaluable
}

export type TaoSplitNavItemDefinition = {
  content: TaoPresentable | TaoNavigationValue
  resizable: Evaluable
  width:
    & Evaluable
    & Partial<{
      defaultValue(): Evaluable
      reset(): void
      set(value: Evaluable): void
    }>
}

export type TaoAppDeclaration = Readonly<{
  canonicalIdentity?: TaoDeclarationIdentity
  identity: symbol
  name: string
}>

export type TaoAppDefinition = {
  auxiliaries(): Record<string, TaoNavigationInput>
  declaration?: TaoAppDeclaration
  design?(): TaoDesign
  name: string
  navigator(): TaoNavigationInput
  restoration?: TaoAppRestorationDefinition
}

export type TaoAppRestorationDefinition = Readonly<{
  exclusions: readonly ('menus' | 'sheets' | 'toasts')[]
  mode: 'automatic' | 'fresh'
  providerIdentity?(): string | undefined
  variant: string
}>

export type TaoNavigationPatch = Readonly<Record<string, unknown>>
type TaoNavigationConfiguration = Readonly<Record<string, unknown>>
export type TaoConfiguredNavigation = Readonly<{
  canonicalDescriptor?: TaoCanonicalDescriptor
  config: TaoNavigationConfiguration
  declaration: TaoImplementedNavDeclaration
  evaluate(): TaoConfiguredNavigation
}>

export type TaoNavigationInput = TaoNavigationValue | TaoConfiguredNavigation

type TaoToastPresentationOptions = {
  duration: Evaluable
  key: Evaluable
}

export type TaoNavKindProfile = 'selection' | 'slot' | 'split' | 'stack'
export type TaoNavHostSlot = 'Title' | 'Toolbar'
export type TaoNavHostSlotContract = Readonly<{
  reads: readonly TaoNavHostSlot[]
  requires: readonly TaoNavHostSlot[]
}>

export type TaoNavDeclaration = Readonly<{
  canonicalIdentity?: TaoDeclarationIdentity
  identity: symbol
  name: string
}>

export type TaoImplementedNavDeclaration =
  & TaoNavDeclaration
  & Readonly<{
    kind: TaoNavKind<any, any>
  }>

export type TaoStackNavConfiguration = Readonly<{
  hostSlots?: TaoNavHostSlotConfiguration
  initial: TaoPresentable | TaoNavigationValue
}>

export type TaoSlotNavConfiguration = Readonly<{
  hostSlots?: TaoNavHostSlotConfiguration
  initial: TaoPresentable | TaoNavigationValue
}>

export type TaoSelectionNavConfiguration = Readonly<{
  display: Evaluable
  hostSlots?: TaoNavHostSlotConfiguration
  initial: string
  items: Readonly<Record<string, Readonly<TaoSelectionNavItemDefinition>>>
}>

export type TaoSplitNavConfiguration = Readonly<{
  items: Readonly<Record<string, Readonly<TaoSplitNavItemDefinition>>>
}>

export type TaoNavDescriptor<
  ProfileT extends TaoNavKindProfile = TaoNavKindProfile,
  ConfigurationT extends object = object,
> = Readonly<{
  canonicalDescriptor?: TaoCanonicalDescriptor
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
  hostSlots: TaoNavHostSlotContract
  protocolVersion: 2
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

/** NavigationControls is the deterministic generated-code API for Tao navigation. */
export const NavigationControls = {
  /** Identity constructs one validated canonical declaration identity from generated owner metadata. */
  Identity(tuple: TaoDeclarationIdentityTuple): TaoDeclarationIdentity {
    return declarationIdentity(tuple)
  },

  /** AppDeclaration creates one process-local source declaration identity for app configurations. */
  AppDeclaration(name: string, identity?: TaoDeclarationIdentity): TaoAppDeclaration {
    return createAppDeclaration(name, identity)
  },

  /** Declaration binds one Tao declaration identity to its package-scope implementation. */
  Declaration(
    name: string,
    kind: TaoNavKind<any, any>,
    identity?: TaoDeclarationIdentity,
  ): TaoImplementedNavDeclaration {
    const declaration = { ...createNavDeclaration(name, identity), kind }
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

  /** View creates the first-class presentation descriptor for one Tao view declaration. */
  View(definition: TaoPresentableDefinition): TaoPresentable {
    return registerPresentable(new RuntimePresentable(definition))
  },

  /** ViewReference resolves a module-registered view without rebuilding its render closure. */
  ViewReference(identity: TaoDeclarationIdentity): TaoPresentable {
    return resolvePresentable(identity.canonical)
  },

  /** Command binds one intent invocation and its live chrome metadata to the declaring view occurrence. */
  Command(definition: TaoCommandDefinition): RuntimeNavigationCommand {
    return new RuntimeNavigationCommand(definition)
  },

  /** CommandReference adapts one validated reference-block action without owning the slot vocabulary. */
  CommandReference(name: string, resolveAction: () => TaoCommandAction): RuntimeNavigationCommand {
    const lazyAction: TaoCommandAction = {
      evaluate: () => resolveAction().evaluate(),
    }
    return new RuntimeNavigationCommand({ action: lazyAction, arguments: [], name })
  },

  /** UseHostSlots publishes only the fills of the directly presented generated view. */
  UseHostSlots(host: RuntimeHostReadChannel | undefined, values: TaoHostSlotValues): void {
    useHostSlots(host, values)
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
    const app = resolveNavigationApp(taoProps, navigation)
    app ? app.present(navigation, presentable, arguments_) : navigation.present(presentable, arguments_)
  },

  /** PresentOverlay layers a UI above an explicit nav or the nearest enclosing nav. */
  PresentOverlay(
    taoProps: TaoProps | undefined,
    target: TaoNavigationInput | undefined,
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
    options: { sheet?: boolean } = {},
  ): void {
    const navigation = resolveNavigationTarget(taoProps, target)
    if (!navigation) {
      const mode = options.sheet ? 'sheet' : 'overlay'
      throw new Error(`Cannot present ${presentable.name} as ${mode}: no enclosing or explicit navigation target.`)
    }
    const app = resolveNavigationApp(taoProps, navigation)
    app
      ? app.presentOverlay(navigation, presentable, arguments_, options)
      : navigation.presentOverlay(presentable, arguments_, options)
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
      throw new Error(`Cannot present ${presentable.name} as toast: Duration must be a finite non-negative duration.`)
    }
    app.presentToast(key, duration, presentable, arguments_)
  },

  /** Ask stacks a fresh responding occurrence above the nearest enclosing navigation container. */
  Ask(
    taoProps: TaoProps | undefined,
    view: TaoPresentable,
    arguments_: TaoNavigationArguments,
  ): Promise<Evaluable> {
    const navigation = TaoPropsControls.navigationInChain(taoProps)
    if (!navigation) {
      throw new Error(`Cannot ask ${view.name}: no enclosing navigation target.`)
    }
    const app = resolveNavigationApp(taoProps, navigation)
    return app ? app.ask(navigation, view, arguments_) : navigation.ask(view, arguments_)
  },

  /** Respond settles only the asked occurrence inherited by the responding render tree. */
  Respond(taoProps: TaoProps | undefined, value?: Evaluable): void {
    const response = TaoPropsControls.responseInChain(taoProps)
    if (!response) {
      throw new Error('Cannot respond: no enclosing ask occurrence.')
    }
    response.respond(value)
  },

  /** Dismiss delegates to the nearest enclosing navigation container. */
  Dismiss(taoProps: TaoProps | undefined): void {
    const navigation = TaoPropsControls.navigationInChain(taoProps)
    if (!navigation) {
      throw new Error('Cannot dismiss: no enclosing navigation target.')
    }
    const app = resolveNavigationApp(taoProps, navigation)
    app ? app.dismiss(navigation) : navigation.dismiss()
  },

  /** Replace swaps the matching enclosing app occurrence's root navigator. */
  Replace(
    taoProps: TaoProps | undefined,
    navigator: TaoNavigationInput,
    target?: RuntimeAppDefinition,
  ): void {
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
    const baseHostSlots = recordValue(configured.config['__taoHostSlots'])
    const patchHostSlots = recordValue(patch['__taoHostSlots'])
    return NavigationControls.Configure(
      configured.declaration,
      {
        ...configured.config,
        ...patch,
        ...(patchHostSlots
          ? { '__taoHostSlots': { ...baseHostSlots, ...patchHostSlots } }
          : {}),
      },
    )
  },

  /** Activate reveals one keyed item on the matching enclosing app occurrence. */
  Activate(taoProps: TaoProps | undefined, target: RuntimeAppDefinition | undefined, key: string): void {
    const app = resolveStrictAppTarget(taoProps, target, 'activate')
    if (!app.activate(key)) {
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
  beginTest(options: { freshRestoration?: boolean } = {}): void {
    // Checks run the deterministic JS surfaces; a native tab bar has no host under the harness.
    disableNativeNavigationSurfaces()
    if (options.freshRestoration) {
      beginNavigationRestorationTest()
    }
    resetNavigationRuntime()
  },

  endTest(): void {
    endNavigationRestorationTest()
  },
} as const

function recordValue(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

export type TaoPresentable = RuntimePresentable
export type TaoNavigationValue = RuntimeNavigationValue
export type TaoRuntimeApp = RuntimeAppDefinition
export type { RuntimeHostReadChannel, RuntimeNavigationCommand, TaoNavHostSlotConfiguration }

function resolveNavigationApp(
  taoProps: TaoProps | undefined,
  navigation: TaoNavigationValue,
): RuntimeAppDefinition | undefined {
  return TaoPropsControls.appInChain(taoProps) ?? ownerOfNavigation(navigation)?.app
}

function resolveStrictAppTarget(
  taoProps: TaoProps | undefined,
  target: RuntimeAppDefinition | undefined,
  operation: 'activate' | 'replace' | 'target',
): RuntimeAppDefinition {
  // Without a named target the nearest enclosing app is the address. Naming one narrows the walk
  // to that declaration, which is the assertion the name buys.
  const app = target === undefined
    ? TaoPropsControls.appInChain(taoProps)
    : TaoPropsControls.appInChain(
      taoProps,
      candidate => candidate.declaration.identity === target.declaration.identity,
    )
  if (app) {
    return app
  }
  const named = target?.declaration.name
  throw new UnexpectedBehaviorError(
    named === undefined
      ? `Cannot ${operation}: no enclosing app instance.`
      : `Cannot ${operation} app '${named}': no enclosing instance matches its declaration.`,
    { details: { appDeclaration: named, operation } },
  )
}
