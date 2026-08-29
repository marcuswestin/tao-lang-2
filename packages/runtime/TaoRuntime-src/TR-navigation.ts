import type React from 'react'
import type { TaoDesign } from './TR-design'
import { UnexpectedBehaviorError } from './TR-errors'
import { RuntimeAppDefinition } from './TR-navigation-app'
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
  type Evaluable,
  RuntimeDialogue,
  RuntimePresentable,
} from './TR-navigation-presentables'
import {
  backNavigation,
  registerNavigation,
  registerNavigationApp,
  resetNavigationRuntime,
} from './TR-navigation-registry'
import { RuntimeNavigationValue } from './TR-navigation-value'
import { type TaoProps, TaoPropsControls } from './TR-TaoProps'
import { disableNativeNavigationSurfaces } from './TR-navigation-native-tabs'

export { testNavKind } from './TR-navigation-conformance'
export { NavKindControls } from './TR-navigation-kinds'

export type TaoNavigationArguments = Record<string, Evaluable>

export type TaoPresentableDefinition = {
  name: string
  render(arguments_: TaoNavigationArguments, taoProps?: TaoProps): React.ReactNode
}

export type TaoDialogueDefinition = TaoPresentableDefinition

export type TaoSelectionNavItemDefinition = {
  content: TaoPresentable | TaoNavigationValue
  icon?: Evaluable
  label: Evaluable
}

export type TaoAppDeclaration = Readonly<{
  identity: symbol
  name: string
}>

export type TaoAppDefinition = {
  auxiliaries(): Record<string, TaoNavigationInput>
  declaration?: TaoAppDeclaration
  design?(): TaoDesign
  name: string
  navigator(): TaoNavigationInput
}

export type TaoNavigationPatch = Readonly<Record<string, unknown>>
type TaoNavigationConfiguration = Readonly<Record<string, unknown>>
export type TaoConfiguredNavigation = Readonly<{
  config: TaoNavigationConfiguration
  declaration: TaoImplementedNavDeclaration
  evaluate(): TaoConfiguredNavigation
}>

export type TaoNavigationInput = TaoNavigationValue | TaoConfiguredNavigation

type TaoToastPresentationOptions = {
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
      throw new Error(`Cannot present ${presentable.name} as toast: Duration must be a finite non-negative duration.`)
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
    return NavigationControls.Configure(
      configured.declaration,
      { ...configured.config, ...patch },
    )
  },

  /** Activate reveals one keyed item on the matching enclosing app occurrence. */
  Activate(taoProps: TaoProps | undefined, target: RuntimeAppDefinition | undefined, key: string): void {
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
    // Checks run the deterministic JS surfaces; a native tab bar has no host under the harness.
    disableNativeNavigationSurfaces()
    resetNavigationRuntime()
  },
} as const

export type TaoPresentable = RuntimePresentable
export type TaoDialogue = RuntimeDialogue
export type TaoNavigationValue = RuntimeNavigationValue
export type TaoRuntimeApp = RuntimeAppDefinition

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
