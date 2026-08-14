import { Errors, Switch } from '@shared/core'
import React from 'react'
import { DataControls } from './TR-data'
import {
  backNavigation,
  clearActiveBackTarget,
  registerNavigation,
  registerNavigationApp,
  resetNavigationRuntime,
  setActiveBackTarget,
} from './TR-navigation-registry'
import { requireReactNativeRuntime } from './TR-react-native'
import { type TaoDialogueOccurrence, type TaoProps, TaoPropsControls } from './TR-TaoProps'
import { Views } from './TR-views'

type Evaluable = {
  evaluate(): { jsValue: unknown }
}

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

type PresentableEntry = {
  arguments: TaoNavigationArguments
  instanceId: number
  presentable: TaoPresentable
}

type DialogueOccurrenceState = TaoDialogueOccurrence & {
  resolve(value: Evaluable): void
  settled: boolean
}

type OverlayEntry = Omit<PresentableEntry, 'presentable'> & {
  dialogue?: DialogueOccurrenceState
  presentable: TaoPresentable | TaoDialogue
}

type ToastEntry = PresentableEntry & {
  key: string
  timeout: ReturnType<typeof setTimeout>
}

type Subscription = {
  snapshot(): number
  subscribe(listener: () => void): () => void
}

/** NavigationControls is the deterministic generated-code API for Tao navigation. */
export const NavigationControls = {
  /** AppDeclaration creates one process-local source declaration identity for app configurations. */
  AppDeclaration(name: string): TaoAppDeclaration {
    return Object.freeze({ identity: Symbol(name), name })
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
    let configured: TaoConfiguredNavigation
    configured = Object.freeze({
      config: freezeNavConfiguration(config),
      declaration,
      evaluate: () => configured,
    })
    return configured
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

/** RuntimeDialogue is a declaration descriptor; each ask creates separate mutable occurrence state. */
class RuntimeDialogue {
  readonly kind = 'dialogue'

  constructor(readonly definition: TaoDialogueDefinition) {}

  get name(): string {
    return this.definition.name
  }

  render(arguments_: TaoNavigationArguments, taoProps?: TaoProps): React.ReactNode {
    return this.definition.render(arguments_, taoProps)
  }
}

/** RuntimeNavigationValue is the shared process-local contract for configured navigation values. */
abstract class RuntimeNavigationValue implements Subscription {
  protected listeners = new Set<() => void>()
  protected version = 0
  private nextOverlayEntryId = 1
  private overlayEntries: OverlayEntry[] = []

  abstract readonly kind: TaoNavKindProfile
  abstract readonly name: string
  abstract readonly descriptor: TaoNavDescriptor<any, any>

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

  abstract patched(patch: TaoNavigationPatch): RuntimeNavigationValue

  activate(_key: string): boolean {
    return false
  }

  presentOverlay(presentable: TaoPresentable, arguments_: TaoNavigationArguments): void {
    this.overlayEntries.push({
      arguments: { ...arguments_ },
      instanceId: this.nextOverlayEntryId++,
      presentable,
    })
    this.emit()
  }

  ask(dialogue: TaoDialogue, arguments_: TaoNavigationArguments): Promise<Evaluable> {
    return new Promise(resolve => {
      let entry: OverlayEntry
      const occurrence: DialogueOccurrenceState = {
        resolve,
        respond: value => this.settleDialogue(entry, value),
        settled: false,
      }
      entry = {
        arguments: { ...arguments_ },
        dialogue: occurrence,
        instanceId: this.nextOverlayEntryId++,
        presentable: dialogue,
      }
      this.overlayEntries.push(entry)
      this.emit()
    })
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
    for (const entry of this.overlayEntries) {
      if (entry.dialogue && !entry.dialogue.settled) {
        entry.dialogue.settled = true
        entry.dialogue.resolve(new RuntimeNavigationResult(null))
      }
    }
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
    const entry = this.overlayEntries[this.overlayEntries.length - 1]!
    if (entry.dialogue) {
      this.settleDialogue(entry)
      return true
    }
    this.overlayEntries.pop()
    this.emit()
    return true
  }

  private settleDialogue(entry: OverlayEntry, value?: Evaluable): void {
    const occurrence = entry.dialogue
    if (!occurrence || occurrence.settled) {
      return
    }
    occurrence.settled = true
    // Resolving schedules the suspended action continuation; removal still completes synchronously
    // before that continuation can resume in the next microtask.
    occurrence.resolve(value ?? new RuntimeNavigationResult(null))
    const index = this.overlayEntries.indexOf(entry)
    if (index >= 0) {
      this.overlayEntries.splice(index, 1)
      this.emit()
    }
  }
}

/** RuntimeStackNav owns an ordered presentation history and preserves covered entries. */
class RuntimeStackNav extends RuntimeNavigationValue {
  readonly kind = 'stack'
  readonly name: string
  private entries: PresentableEntry[]
  private nextEntryId = 1

  constructor(readonly descriptor: TaoNavDescriptor<'stack', TaoStackNavConfiguration>) {
    super()
    this.name = descriptor.declaration.name
    this.entries = [this.initialEntry()]
  }

  get depth(): number {
    return this.entries.length
  }

  present(presentable: TaoPresentable, arguments_: TaoNavigationArguments): void {
    this.entries.push({ arguments: { ...arguments_ }, instanceId: this.nextEntryId++, presentable })
    this.emit()
  }

  patched(patch: TaoNavigationPatch): RuntimeNavigationValue {
    assertPatchKeys(patch, ['Initial'], this.name)
    const descriptor = this.descriptor.kind.configure(this.descriptor.declaration, {
      ...this.descriptor.config,
      initial: patchedPresentable(patch['Initial'], this.descriptor.config.initial, this.name, 'Initial'),
    })
    return descriptor.kind.mount(descriptor) as RuntimeNavigationValue
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
    return { arguments: {}, instanceId: this.nextEntryId++, presentable: this.descriptor.config.initial }
  }
}

/** RuntimeSlotNav shows either its Initial value or one currently presented UI. */
class RuntimeSlotNav extends RuntimeNavigationValue {
  readonly kind = 'slot'
  readonly name: string
  private presented: PresentableEntry | undefined
  private nextEntryId = 1

  constructor(readonly descriptor: TaoNavDescriptor<'slot', TaoSlotNavConfiguration>) {
    super()
    this.name = descriptor.declaration.name
    if (isNavigation(descriptor.config.initial)) {
      descriptor.config.initial.subscribe(() => this.emit())
    }
  }

  present(presentable: TaoPresentable, arguments_: TaoNavigationArguments): void {
    this.presented = { arguments: { ...arguments_ }, instanceId: this.nextEntryId++, presentable }
    this.emit()
  }

  patched(patch: TaoNavigationPatch): RuntimeNavigationValue {
    assertPatchKeys(patch, ['Initial'], this.name)
    const descriptor = this.descriptor.kind.configure(this.descriptor.declaration, {
      ...this.descriptor.config,
      initial: patchedPresentable(patch['Initial'], this.descriptor.config.initial, this.name, 'Initial'),
    })
    return descriptor.kind.mount(descriptor) as RuntimeNavigationValue
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
      || (isNavigation(this.descriptor.config.initial) && this.descriptor.config.initial.canGoBack)
  }

  protected backContent(): boolean {
    if (this.presented) {
      return this.dismissContent()
    }
    return isNavigation(this.descriptor.config.initial) ? this.descriptor.config.initial.back() : false
  }

  protected resetContent(): void {
    this.presented = undefined
    if (isNavigation(this.descriptor.config.initial)) {
      this.descriptor.config.initial.reset()
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
    return renderPresentable(this.descriptor.config.initial, {}, navigationProps(taoProps, this))
  }
}

type SelectionItemState = {
  definition: TaoSelectionNavItemDefinition
  entries: Array<{
    arguments: TaoNavigationArguments
    instanceId: number
    presentable: TaoPresentable | TaoNavigationValue
  }>
  key: string
}

/** RuntimeSelectionNav switches keyed content without adding presentation history. */
class RuntimeSelectionNav extends RuntimeNavigationValue {
  readonly kind = 'selection'
  readonly name: string
  private activeKey: string
  private readonly items: SelectionItemState[]
  private nextEntryId = 1

  constructor(readonly descriptor: TaoNavDescriptor<'selection', TaoSelectionNavConfiguration>) {
    super()
    const definition = descriptor.config
    this.name = descriptor.declaration.name
    if (!definition.items[definition.initial]) {
      throw new Error(`SelectionNav ${this.name} has no initial item '@${definition.initial}'.`)
    }
    this.activeKey = definition.initial
    this.items = Object.entries(definition.items).map(([key, item]) => ({
      definition: item,
      entries: [this.initialEntry(item.content)],
      key,
    }))
    for (const item of Object.values(definition.items)) {
      if (isNavigation(item.content)) {
        item.content.subscribe(() => this.emit())
      }
    }
  }

  override activate(key: string): boolean {
    if (!this.item(key)) {
      return false
    }
    if (key !== this.activeKey) {
      this.activeKey = key
      this.emit()
    }
    return true
  }

  present(presentable: TaoPresentable, arguments_: TaoNavigationArguments): void {
    this.activeItem().entries.push({
      arguments: { ...arguments_ },
      instanceId: this.nextEntryId++,
      presentable,
    })
    this.emit()
  }

  patched(patch: TaoNavigationPatch): RuntimeNavigationValue {
    assertPatchKeys(patch, ['Display', 'Initial'], this.name)
    const display = patchedEvaluable(
      patch['Display'],
      this.descriptor.config.display,
      this.name,
      'Display',
    )
    const initial = patch['Initial'] === undefined
      ? this.descriptor.config.initial
      : patchedSelectionKey(patch['Initial'], this.name)
    const descriptor = this.descriptor.kind.configure(
      this.descriptor.declaration,
      { ...this.descriptor.config, display, initial },
    )
    return descriptor.kind.mount(descriptor) as RuntimeNavigationValue
  }

  protected canGoBackContent(): boolean {
    const active = this.activeItem()
    if (active.entries.length > 1) {
      return true
    }
    const content = active.definition.content
    return isNavigation(content) && content.canGoBack
  }

  protected dismissContent(): boolean {
    return this.backContent()
  }

  protected backContent(): boolean {
    const active = this.activeItem()
    if (active.entries.length > 1) {
      active.entries.pop()
      this.emit()
      return true
    }
    const content = active.definition.content
    return isNavigation(content) ? content.back() : false
  }

  protected resetContent(): void {
    this.activeKey = this.descriptor.config.initial
    for (const item of this.items) {
      item.entries = [this.initialEntry(item.definition.content)]
      if (isNavigation(item.definition.content)) {
        item.definition.content.reset()
      }
    }
  }

  protected renderContent(taoProps?: TaoProps): React.ReactNode {
    const runtime = requireReactNativeRuntime()
    const display = String(this.descriptor.config.display.evaluate().jsValue)
    return React.createElement(runtime.View, {
      children: [
        React.createElement(runtime.View, {
          children: this.items.map(item =>
            React.createElement(
              React.Fragment,
              { key: item.key },
              Views.Pressable(
                {
                  action: {
                    invoke: () => {
                      this.activate(item.key)
                    },
                  },
                  title: String(item.definition.label.evaluate().jsValue),
                },
                {
                  nativeProps: {
                    accessibilityRole: 'tab',
                    accessibilityState: { selected: item.key === this.activeKey },
                  },
                },
              ),
            )
          ),
          key: 'selection-controls',
          style: display === 'drawer' ? selectionDrawerControlsStyle : selectionTabControlsStyle,
        }),
        React.createElement(runtime.View, {
          children: this.items.flatMap(item =>
            item.entries.map((entry, index) =>
              React.createElement(NavigationLevel, {
                children: renderPresentable(
                  entry.presentable,
                  entry.arguments,
                  navigationProps(taoProps, this),
                ),
                hidden: item.key !== this.activeKey || index !== item.entries.length - 1,
                key: `${item.key}-${entry.instanceId}`,
              })
            )
          ),
          key: 'selection-content',
          style: selectionContentStyle,
        }),
      ],
      style: navigationHostStyle,
    })
  }

  private activeItem(): SelectionItemState {
    return this.item(this.activeKey)!
  }

  private initialEntry(content: TaoPresentable | TaoNavigationValue): SelectionItemState['entries'][number] {
    return { arguments: {}, instanceId: this.nextEntryId++, presentable: content }
  }

  private item(key: string): SelectionItemState | undefined {
    return this.items.find(item => item.key === key)
  }
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
    this.declaration = definition.declaration ?? NavigationControls.AppDeclaration(definition.name)
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
    {
      action: {
        invoke: () => {
          backNavigation(props.target)
        },
      },
      title: 'Back',
    },
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
const toastLayerStyle = {
  bottom: 0,
  left: 0,
  position: 'absolute',
  right: 0,
  zIndex: 2,
} as const
const hiddenNavigationLevelStyle = { display: 'none' } as const
const visibleOverlayLevelStyle = { flex: 1 } as const
const selectionContentStyle = { flex: 1 } as const
const selectionDrawerControlsStyle = { flexDirection: 'column' } as const
const selectionTabControlsStyle = { flexDirection: 'row' } as const

/** NavigationSurface gives every nav a relative host and its own absolute overlay lane. */
function NavigationSurface(props: {
  content?: React.ReactNode
  navigation: TaoNavigationValue
  overlays: OverlayEntry[]
  taoProps?: TaoProps
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  const overlays = props.overlays.length > 0
    ? React.createElement(runtime.View, {
      children: props.overlays.map((entry, index) =>
        React.createElement(NavigationLevel, {
          children: entry.presentable.render(
            entry.arguments,
            entry.dialogue
              ? dialogueProps(props.taoProps, props.navigation, entry.dialogue)
              : navigationProps(props.taoProps, props.navigation),
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

function resolveNavigationTarget(
  taoProps: TaoProps | undefined,
  target: TaoNavigationInput | undefined,
): TaoNavigationValue | undefined {
  if (!target) {
    return TaoPropsControls.navigationInChain(taoProps)
  }
  if (!isConfiguredNavigation(target)) {
    return target
  }
  const app = TaoPropsControls.appInChain(taoProps)
  const mounted = app?.resolve(target)
  if (!mounted) {
    throw new Error(
      `Cannot resolve configured navigation '${target.declaration.name}': it is not mounted in the enclosing app.`,
    )
  }
  return mounted
}

function mountConfiguredNavigation(
  configured: TaoConfiguredNavigation,
  registerMount?: (configured: TaoConfiguredNavigation, mount: TaoNavigationValue) => void,
): TaoNavigationValue {
  const kind = configured.declaration.kind
  const config = normalizeConfiguredNavigation(configured, registerMount)
  const descriptor = kind.configure(configured.declaration, config)
  const mount = registerNavigation(kind.mount(descriptor) as RuntimeNavigationValue)
  registerMount?.(configured, mount)
  return mount
}

function normalizeConfiguredNavigation(
  configured: TaoConfiguredNavigation,
  registerMount?: (configured: TaoConfiguredNavigation, mount: TaoNavigationValue) => void,
): Record<string, unknown> {
  const config = configured.config
  if (configured.declaration.kind.profile === 'stack' || configured.declaration.kind.profile === 'slot') {
    return {
      initial: configuredPresentable(config['Initial'], configured.declaration.name, 'Initial', registerMount),
      name: configured.declaration.name,
    }
  }
  const items = Object.fromEntries(
    Object.entries(config)
      .filter(([key, value]) => key.startsWith('@') && isPlainRecord(value))
      .map(([sourceKey, value]) => {
        const key = sourceKey.slice(1)
        const item = value as Record<string, unknown>
        return [key, {
          content: configuredPresentable(
            item['Content'],
            configured.declaration.name,
            `@${key}.Content`,
            registerMount,
          ),
          label: configuredEvaluable(item['Label'], configured.declaration.name, `@${key}.Label`),
        }]
      }),
  )
  return {
    display: configuredEvaluable(config['Display'], configured.declaration.name, 'Display'),
    initial: configuredKey(config['Initial'], configured.declaration.name, 'Initial'),
    items,
    name: configured.declaration.name,
  }
}

function configuredEvaluable(value: unknown, name: string, property: string): Evaluable {
  if (isPresentable(value) || !value || typeof (value as Evaluable).evaluate !== 'function') {
    throw new Error(`${name} configuration '${property}' expects a scalar Tao value.`)
  }
  return value as Evaluable
}

function configuredPresentable(
  value: unknown,
  name: string,
  property: string,
  registerMount?: (configured: TaoConfiguredNavigation, mount: TaoNavigationValue) => void,
): TaoPresentable | TaoNavigationValue {
  const mounted = isConfiguredNavigation(value) ? mountConfiguredNavigation(value, registerMount) : value
  if (!isPresentable(mounted)) {
    throw new Error(`${name} configuration '${property}' expects ui or nav.`)
  }
  return mounted
}

function configuredKey(value: unknown, name: string, property: string): string {
  const key = configuredEvaluable(value, name, property).evaluate().jsValue
  if (typeof key !== 'string' || !key.startsWith('@')) {
    throw new Error(`${name} configuration '${property}' expects an @key.`)
  }
  return key.slice(1)
}

function isConfiguredNavigation(value: unknown): value is TaoConfiguredNavigation {
  return typeof value === 'object' && value !== null
    && 'declaration' in value && 'config' in value && 'evaluate' in value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
}

function createNavDeclaration(name: string): TaoNavDeclaration {
  return Object.freeze({ identity: Symbol(name), name })
}

function freezeNavConfiguration<ConfigurationT extends object>(
  config: ConfigurationT,
): Readonly<ConfigurationT> {
  return freezePlainNavValue(config)
}

function freezePlainNavValue<ValueT>(value: ValueT): ValueT {
  // Nested descriptors are declaration identities, not plain configuration records to clone.
  if (isConfiguredNavigation(value)) {
    return value
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => freezePlainNavValue(item))) as ValueT
  }
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, freezePlainNavValue(item)]),
    )) as ValueT
  }
  return value
}

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

function navigationProps(props: TaoProps | undefined, navigation: TaoNavigationValue): TaoProps {
  return { ...props, navigation }
}

function dialogueProps(
  props: TaoProps | undefined,
  navigation: TaoNavigationValue,
  dialogue: DialogueOccurrenceState,
): TaoProps {
  return { ...props, dialogue, navigation }
}

/** RuntimeNavigationResult supplies the same evaluable shape as TR.Value without a runtime cycle. */
class RuntimeNavigationResult {
  constructor(readonly jsValue: unknown) {}

  evaluate(): this {
    return this
  }
}

function isNavigation(value: TaoPresentable | TaoNavigationValue): value is TaoNavigationValue {
  return value instanceof RuntimeNavigationValue
}

function isPresentable(value: unknown): value is TaoPresentable | TaoNavigationValue {
  return value instanceof RuntimePresentable || value instanceof RuntimeNavigationValue
}

function patchedPresentable<ValueT extends TaoPresentable | TaoNavigationValue>(
  patch: unknown,
  fallback: ValueT,
  navigationName: string,
  property: string,
): ValueT {
  if (patch === undefined) {
    return fallback
  }
  if (!isPresentable(patch)) {
    throw new Error(`Navigation ${navigationName} patch '${property}' expects ui or nav.`)
  }
  return patch as ValueT
}

function patchedSelectionKey(
  value: unknown,
  navigationName: string,
): string {
  if (isPresentable(value) || !isEvaluable(value)) {
    throw new Error(`SelectionNav ${navigationName} patch 'Initial' expects an @key.`)
  }
  const key = String(value.evaluate().jsValue)
  if (!key.startsWith('@')) {
    throw new Error(`SelectionNav ${navigationName} patch 'Initial' expects an @key.`)
  }
  return key.slice(1)
}

function patchedEvaluable(
  patch: unknown,
  fallback: Evaluable,
  navigationName: string,
  property: string,
): Evaluable {
  if (patch === undefined) {
    return fallback
  }
  if (isPresentable(patch) || !isEvaluable(patch)) {
    throw new Error(`Navigation ${navigationName} patch '${property}' expects a scalar value.`)
  }
  return patch
}

function isEvaluable(value: unknown): value is Evaluable {
  return typeof value === 'object' && value !== null && 'evaluate' in value
    && typeof value.evaluate === 'function'
}

function assertPatchKeys(
  patch: TaoNavigationPatch,
  allowed: readonly string[],
  navigationName: string,
): void {
  for (const key of Object.keys(patch)) {
    if (!allowed.includes(key)) {
      throw new Error(`Navigation ${navigationName} has no configurable property '${key}'.`)
    }
  }
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
