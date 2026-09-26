import React from 'react'
import { Arrays } from './core/RuntimeCore'
import { accessibilityStateProps } from './TR-accessibility'
import { AppSurfaceFrame, AppSurfaceFrameDefaults, type SafeAreaEdge } from './TR-app-shell'
import { RuntimeAssert } from './TR-assert'
import { createElement } from './TR-create-element'
import { UserInputError } from './TR-errors'
import { OutlineRegionScope, regionNativeProps, selectionItemRegion, splitPaneRegion } from './TR-interaction-regions'
import { mountedDesignStyle } from './TR-mounted-design'
import type {
  TaoNavDescriptor,
  TaoNavigationArguments,
  TaoNavigationPatch,
  TaoNavigationValue,
  TaoPresentable,
  TaoSelectionNavConfiguration,
  TaoSelectionNavItemDefinition,
  TaoSlotNavConfiguration,
  TaoSplitNavConfiguration,
  TaoStackNavConfiguration,
} from './TR-navigation'
import { BasicStackSurface } from './TR-navigation-basic-stack'
import { RuntimeHostReadChannel } from './TR-navigation-host-slots'
import { nativeNavigationModule } from './TR-navigation-native-hosts'
import { nativeStackAvailable, NativeStackSurface } from './TR-navigation-native-stack'
import { nativeSelectionTabsAvailable, renderNativeSelectionTabs } from './TR-navigation-native-tabs'
import type {
  TaoNavigationContentSnapshot,
  TaoNavigationRestorationCodec,
} from './TR-navigation-restoration-state'
import type { PresentableEntry } from './TR-navigation-state'
import {
  LevelHiddenContext,
  navigationHostStyle,
  NavigationLevel,
  navigationProps,
  presentedOccurrenceRegion,
} from './TR-navigation-surfaces'
import { SelectionToggleBar, toggleBarContentInset } from './TR-navigation-toggle-bar'
import { RuntimeNavigationValue, takeRemovedBrowserHistoryId } from './TR-navigation-value'
import {
  assertPatchKeys,
  isNavigation,
  patchedEvaluable,
  patchedPresentable,
  patchedSelectionKey,
  renderPresentable,
} from './TR-navigation-values'
import { requireReactNativeRuntime } from './TR-react-native'
import type { TaoProps } from './TR-TaoProps'
import { Views } from './TR-views'

type SplitWidthBinding = TaoSplitNavConfiguration['items'][string]['width']

/** RuntimeSplitNav renders all keyed panes and owns their resize affordances. */
export class RuntimeSplitNav extends RuntimeNavigationValue {
  readonly kind = 'split'
  readonly name: string

  constructor(readonly descriptor: TaoNavDescriptor<'split', TaoSplitNavConfiguration>) {
    super()
    this.name = descriptor.declaration.name
    for (const item of Object.values(descriptor.config.items)) {
      if (isNavigation(item.content)) {
        item.content.subscribe(() => this.emit())
      }
    }
  }

  present(presentable: TaoPresentable, arguments_: TaoNavigationArguments): void {
    const target = Arrays.reversed(Object.values(this.descriptor.config.items))
      .map(item => item.content).find(isNavigation)
    target ? target.present(presentable, arguments_) : this.presentOverlay(presentable, arguments_)
  }

  patched(patch: TaoNavigationPatch): RuntimeNavigationValue {
    assertPatchKeys(patch, [], this.name)
    return this
  }

  protected canGoBackContent(): boolean {
    return Object.values(this.descriptor.config.items).some(item =>
      isNavigation(item.content) && item.content.canGoBack
    )
  }

  protected backContent(): boolean {
    const target = Arrays.reversed(Object.values(this.descriptor.config.items))
      .map(item => item.content).find(item => isNavigation(item) && item.canGoBack)
    return target && isNavigation(target) ? target.back() : false
  }

  protected dismissContent(): boolean {
    return this.backContent()
  }

  protected resetContent(): void {
    for (const item of Object.values(this.descriptor.config.items)) {
      if (isNavigation(item.content)) {
        item.content.reset()
      }
    }
  }

  protected renderContent(taoProps?: TaoProps): React.ReactNode {
    return createElement(SplitNavSurface, { navigation: this, taoProps })
  }

  /**
   * ownsWindowSurface: a split always takes true window bounds and frames each pane itself (see
   * SplitNavSurface), so a sidebar and its detail scroll independently and a pane whose navigator
   * frames its own screens is never framed twice (decided 2026-09-22). One frame around the whole
   * split would scroll the panes as one and leave a stack pane's screens with no definite height.
   */
  override ownsWindowSurface(): boolean {
    return true
  }

  protected snapshotRestorationContent(codec: TaoNavigationRestorationCodec): TaoNavigationContentSnapshot {
    return {
      items: Object.fromEntries(
        Object.entries(this.descriptor.config.items).map((
          [key, item],
        ) => [
          key,
          isNavigation(item.content) && hasRestorationCapability(item.content)
            ? { navigation: item.content.navigationRestorationSnapshot(codec, codec.exclusions) }
            : {},
        ]),
      ),
      kind: 'split',
    }
  }

  protected restoreRestorationContent(
    snapshot: TaoNavigationContentSnapshot,
    codec: TaoNavigationRestorationCodec,
  ): void {
    if (snapshot.kind !== 'split') {
      throw new UserInputError(`Restored content is not a split for '${this.name}'.`, { navigation: this.name })
    }
    for (const [key, restored] of Object.entries(snapshot.items)) {
      const content = this.descriptor.config.items[key]?.content
      if (restored.navigation && content && isNavigation(content) && hasRestorationCapability(content)) {
        content.restoreNavigationSnapshot(restored.navigation, codec)
      }
    }
  }
}

function SplitNavSurface(props: { navigation: RuntimeSplitNav; taoProps?: TaoProps }): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  const items = Object.entries(props.navigation.descriptor.config.items)
  const [localWidths, setLocalWidths] = React.useState<Record<string, number>>({})
  const widths = items.map(([key, item]) => localWidths[key] ?? numericWidth(item.width))
  const drag = React.useRef<{ index: number; moved: boolean; start: number; width: number } | undefined>(undefined)
  const lastTap = React.useRef<Record<string, number>>({})
  const children: React.ReactNode[] = []
  items.forEach(([key, item], index) => {
    const region = splitPaneRegion(props.navigation.name, key, () => (widths[index] ?? 0) > 0)
    const content = renderPresentable(item.content, {}, navigationProps(props.taoProps, props.navigation))
    // Every pane is framed here unless its content frames its own screens — read live, so a pane's
    // `SlotNav` that presents a plain view is framed while it shows it. Either way a pane meets the
    // window on its outer side alone: the top and bottom edges always, the left edge in the first
    // pane, the right edge in the last.
    const paneContent = createElement(
      AppSurfaceFrameDefaults.Provider,
      { edges: splitPaneEdges(index, items.length) },
      paneOwnsWindow(item.content)
        ? content
        : createElement(AppSurfaceFrame, { children: content, taoProps: props.taoProps }),
    )
    children.push(createElement(runtime.View, {
      ...regionNativeProps(region),
      children: createElement(OutlineRegionScope, { region }, paneContent),
      key,
      style: { flexBasis: widths[index], flexGrow: 0, flexShrink: 0 },
    }))
    if (index >= items.length - 1 || item.resizable.evaluate().jsValue !== true) {
      return
    }
    const setWidth = (width: number) => {
      const bounded = Math.max(0, width)
      if (typeof item.width.set === 'function') {
        item.width.set(runtimeNumber(bounded))
      } else {
        setLocalWidths(current => ({ ...current, [key]: bounded }))
      }
    }
    const reset = () => {
      if (typeof item.width.reset === 'function') {
        item.width.reset()
      } else {
        setLocalWidths(current => {
          const next = { ...current }
          delete next[key]
          return next
        })
      }
    }
    children.push(createElement(runtime.View, {
      accessibilityLabel: `Resize ${key}`,
      accessibilityRole: 'adjustable',
      key: `${key}-resize`,
      onDoubleClick: reset,
      onResponderGrant: (event: any) => {
        drag.current = { index, moved: false, start: event.nativeEvent.pageX, width: widths[index]! }
      },
      onResponderMove: (event: any) => {
        if (drag.current?.index === index) {
          const delta = event.nativeEvent.pageX - drag.current.start
          if (Math.abs(delta) > 2) {
            drag.current.moved = true
          }
          setWidth(drag.current.width + delta)
        }
      },
      onResponderRelease: () => {
        const completed = drag.current
        drag.current = undefined
        if (!completed || completed.index !== index || completed.moved) {
          return
        }
        const now = Date.now()
        if (now - (lastTap.current[key] ?? 0) <= 300) {
          delete lastTap.current[key]
          reset()
        } else {
          lastTap.current[key] = now
        }
      },
      onResponderTerminate: () => {
        drag.current = undefined
      },
      onStartShouldSetResponder: () => true,
      style: { cursor: 'col-resize', width: 8 },
    }))
  })
  return createElement(runtime.View, { children, style: { flex: 1, flexDirection: 'row' } })
}

function paneOwnsWindow(content: TaoSplitNavConfiguration['items'][string]['content']): boolean {
  return isNavigation(content) && content.ownsWindowSurface()
}

function splitPaneEdges(index: number, count: number): readonly SafeAreaEdge[] {
  return [
    'bottom',
    'top',
    ...(index === 0 ? ['left' as const] : []),
    ...(index === count - 1 ? ['right' as const] : []),
  ]
}

function numericWidth(width: SplitWidthBinding): number {
  const value = width.evaluate().jsValue
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new UserInputError('SplitNav Width must be a finite non-negative number.', { value })
  }
  return value
}

function runtimeNumber(jsValue: number): any {
  const result = { evaluate: () => result, jsValue }
  return result
}

/** RuntimeStackNav owns an ordered presentation history and preserves covered entries. */
export class RuntimeStackNav extends RuntimeNavigationValue {
  readonly kind = 'stack'
  readonly name: string
  private entries: Array<PresentableEntry & { host: RuntimeHostReadChannel }>
  private nextEntryId = 1

  constructor(
    readonly descriptor: TaoNavDescriptor<'stack', TaoStackNavConfiguration>,
    private readonly surface: 'basic' | 'native' = 'native',
  ) {
    super()
    this.name = descriptor.declaration.name
    this.entries = [this.initialEntry()]
    if (isNavigation(descriptor.config.initial)) {
      descriptor.config.initial.subscribe(() => this.emit())
    }
  }

  get depth(): number {
    return this.entries.length
  }

  present(presentable: TaoPresentable, arguments_: TaoNavigationArguments): void {
    this.entries.push(this.presentableEntry(presentable, arguments_, this.nextEntryId++))
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
    return this.entries.length > 1 || this.initialNavigation()?.canGoBack === true
  }

  protected override contentHistoryDepth(): number {
    return this.entries.length - 1 + (this.initialNavigation()?.historyDepth() ?? 0)
  }

  protected dismissContent(): boolean {
    return this.backContent()
  }

  protected backContent(): boolean {
    if (this.entries.length > 1) {
      const removed = this.entries.pop()
      this.adoptRemovedBrowserHistoryId(removed?.browserHistoryId)
      this.emit()
      return true
    }
    return this.initialNavigation()?.back() ?? false
  }

  protected resetContent(): void {
    this.entries = [this.initialEntry()]
    this.initialNavigation()?.reset()
  }

  protected snapshotRestorationContent(codec: TaoNavigationRestorationCodec): TaoNavigationContentSnapshot {
    return {
      entries: this.entries.slice(1).flatMap(entry => {
        const snapshot = codec.snapshotPresentable(entry)
        return snapshot ? [snapshot] : []
      }),
      kind: 'stack',
    }
  }

  protected restoreRestorationContent(
    snapshot: TaoNavigationContentSnapshot,
    codec: TaoNavigationRestorationCodec,
  ): void {
    if (snapshot.kind !== 'stack') {
      throw new UserInputError(`Restored content is not a stack for '${this.name}'.`, { navigation: this.name })
    }
    this.entries = [
      this.initialEntry(),
      ...snapshot.entries.map(entry => ({
        ...codec.restorePresentable(entry),
        host: new RuntimeHostReadChannel(),
        instanceId: this.nextEntryId++,
      })),
    ]
  }

  protected renderContent(taoProps?: TaoProps): React.ReactNode {
    // Enclosing chrome belongs to this stack alone: the scenes it presents, and any navigator they
    // render, draw their own chrome as usual.
    const { navigationBottomInset, navigationChrome, ...ownProps } = taoProps ?? {}
    const props = {
      bottomInset: navigationBottomInset,
      chrome: navigationChrome,
      entries: this.entries,
      navigation: this,
      taoProps: navigationProps(ownProps, this),
    }
    return this.surface === 'native'
      ? createElement(NativeStackSurface, props)
      : createElement(BasicStackSurface, props)
  }

  /** reconcileNativeDismissal applies a gesture once; a prior Tao/header Back makes it a no-op. */
  reconcileNativeDismissal(instanceId: number, count: number): void {
    // A native gesture belongs to the retained content stack. If Tao is currently presenting an
    // overlay or ask above it, that semantic layer must win Back precedence and the gesture is stale.
    if (this.overlayDepth() > 0) {
      return
    }
    const dismissedIndex = this.entries.findIndex(entry => entry.instanceId === instanceId)
    if (dismissedIndex !== this.entries.length - 1 || dismissedIndex < 1) {
      return
    }
    let changed = false
    for (let index = 0; index < count && this.entries.length > 1; index++) {
      this.entries.pop()
      changed = true
    }
    if (changed) {
      this.emit()
    }
  }

  override ownsWindowSurface(): boolean {
    return true
  }

  override ownsBackAffordance(): boolean {
    // Content chrome is defocused while an overlay or ask is active, so it cannot own the visible
    // affordance then. The app host supplies one until the overlay lane is empty again.
    if (this.overlayDepth() > 0) {
      return false
    }
    return this.depth > 1 || this.initialNavigation()?.ownsBackAffordance() === true
  }

  nativeSurfaceAvailable(): boolean {
    return this.surface === 'native' && nativeStackAvailable()
  }

  private initialEntry(): PresentableEntry & { host: RuntimeHostReadChannel } {
    return {
      arguments: {},
      host: new RuntimeHostReadChannel(),
      instanceId: this.nextEntryId++,
      presentable: this.descriptor.config.initial,
    }
  }

  private initialNavigation(): RuntimeNavigationValue | undefined {
    const initial = this.descriptor.config.initial
    return isNavigation(initial) ? initial : undefined
  }
}

/** RuntimeSlotNav shows either its Initial value or one currently presented UI. */
export class RuntimeSlotNav extends RuntimeNavigationValue {
  readonly kind = 'slot'
  readonly name: string
  private presented: PresentableEntry<TaoPresentable> | undefined
  private nextEntryId = 1

  constructor(readonly descriptor: TaoNavDescriptor<'slot', TaoSlotNavConfiguration>) {
    super()
    this.name = descriptor.declaration.name
    if (isNavigation(descriptor.config.initial)) {
      descriptor.config.initial.subscribe(() => this.emit())
    }
  }

  present(presentable: TaoPresentable, arguments_: TaoNavigationArguments): void {
    this.presented = this.presentableEntry(presentable, arguments_, this.nextEntryId++)
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
    const removed = this.presented
    this.presented = undefined
    this.adoptRemovedBrowserHistoryId(removed.browserHistoryId)
    this.emit()
    return true
  }

  protected canGoBackContent(): boolean {
    return this.presented !== undefined
      || (isNavigation(this.descriptor.config.initial) && this.descriptor.config.initial.canGoBack)
  }

  protected override contentHistoryDepth(): number {
    const initialDepth = isNavigation(this.descriptor.config.initial)
      ? this.descriptor.config.initial.historyDepth()
      : 0
    if (this.presented) {
      return 1 + initialDepth
    }
    return initialDepth
  }

  protected backContent(): boolean {
    if (this.presented) {
      return this.dismissContent()
    }
    if (!isNavigation(this.descriptor.config.initial)) {
      return false
    }
    const consumed = this.descriptor.config.initial.back()
    if (consumed) {
      this.adoptRemovedBrowserHistoryId(takeRemovedBrowserHistoryId(this.descriptor.config.initial))
    }
    return consumed
  }

  protected resetContent(): void {
    this.presented = undefined
    if (isNavigation(this.descriptor.config.initial)) {
      this.descriptor.config.initial.reset()
    }
  }

  protected snapshotRestorationContent(codec: TaoNavigationRestorationCodec): TaoNavigationContentSnapshot {
    const presented = this.presented ? codec.snapshotPresentable(this.presented) : undefined
    const initial = this.descriptor.config.initial
    return {
      ...(isNavigation(initial) && hasRestorationCapability(initial)
        ? { initialNavigation: initial.navigationRestorationSnapshot(codec, codec.exclusions) }
        : {}),
      kind: 'slot',
      ...(presented ? { presented } : {}),
    }
  }

  protected restoreRestorationContent(
    snapshot: TaoNavigationContentSnapshot,
    codec: TaoNavigationRestorationCodec,
  ): void {
    if (snapshot.kind !== 'slot') {
      throw new UserInputError(`Restored content is not a slot for '${this.name}'.`, { navigation: this.name })
    }
    this.presented = snapshot.presented
      ? { ...codec.restorePresentable(snapshot.presented), instanceId: this.nextEntryId++ }
      : undefined
    const initial = this.descriptor.config.initial
    if (snapshot.initialNavigation) {
      if (!isNavigation(initial) || !hasRestorationCapability(initial)) {
        throw new UserInputError(`Restored slot '${this.name}' requires an unrestorable nested navigator.`, {
          navigation: this.name,
        })
      }
      initial.restoreNavigationSnapshot(snapshot.initialNavigation, codec)
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

  /**
   * ownsWindowSurface delegates to the slot's showing content: `present` only ever hands this slot
   * a plain view, but `Initial` may be a nested window-owning navigator, and that navigator already
   * frames its own screens — an enclosing AppSurfaceFrame here would inset its content twice.
   */
  override ownsWindowSurface(): boolean {
    if (this.presented) {
      return false
    }
    const initial = this.descriptor.config.initial
    return isNavigation(initial) && initial.ownsWindowSurface()
  }
}

type SelectionItemState = {
  /** chrome receives the item's visible screen chrome when a toggle bar draws it. */
  chrome: RuntimeHostReadChannel
  definition: TaoSelectionNavItemDefinition
  entries: Array<{
    arguments: TaoNavigationArguments
    browserHistoryId?: number
    instanceId: number
    presentable: TaoPresentable | TaoNavigationValue
  }>
  key: string
}

/** RuntimeSelectionNav switches keyed content without adding presentation history. */
export class RuntimeSelectionNav extends RuntimeNavigationValue {
  readonly kind = 'selection'
  readonly name: string
  private activeKey: string
  private readonly items: SelectionItemState[]
  private nextEntryId = 1

  constructor(
    readonly descriptor: TaoNavDescriptor<'selection', TaoSelectionNavConfiguration>,
    private readonly nativeSurface = true,
  ) {
    super()
    const definition = descriptor.config
    this.name = descriptor.declaration.name
    RuntimeAssert.input(
      definition.items[definition.initial],
      `SelectionNav ${this.name} has no initial item '@${definition.initial}'.`,
      { navigation: this.name },
    )
    this.activeKey = definition.initial
    this.items = Object.entries(definition.items).map(([key, item]) => ({
      chrome: new RuntimeHostReadChannel(),
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
      // Not one of this navigator's own keys: a navigator an item's view renders may still own it.
      return super.activate(key)
    }
    if (key !== this.activeKey) {
      this.activeKey = key
      this.emit()
    }
    return true
  }

  present(presentable: TaoPresentable, arguments_: TaoNavigationArguments): void {
    this.activeItem().entries.push({
      ...this.presentableEntry(presentable, arguments_, this.nextEntryId++),
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

  /**
   * A selection navigator draws no back chrome of its own — whatever it shows for the active item
   * does. A stack in a tab already puts Back in its own header, and the app host adding a second
   * one is a duplicate that lands outside the tab's screen entirely, at the top of the window.
   *
   * An entry presented onto the item covers that chrome, and an overlay defocuses it, so in both
   * cases the app host owns the visible affordance again.
   */
  override ownsBackAffordance(): boolean {
    if (this.historyDepth() > this.contentHistoryDepth()) {
      return false
    }
    // The toggle bar's Back reaches every entry and nested navigator the active item holds.
    if (this.display() === 'toggle') {
      return true
    }
    const active = this.activeItem()
    if (active.entries.length > 1) {
      return false
    }
    const content = active.definition.content
    return isNavigation(content) && content.ownsBackAffordance()
  }

  protected override contentHistoryDepth(): number {
    const active = this.activeItem()
    const nested = active.definition.content
    return active.entries.length - 1
      + (isNavigation(nested) ? nested.historyDepth() : 0)
  }

  protected dismissContent(): boolean {
    return this.backContent()
  }

  protected backContent(): boolean {
    const active = this.activeItem()
    if (active.entries.length > 1) {
      const removed = active.entries.pop()
      this.adoptRemovedBrowserHistoryId(removed?.browserHistoryId)
      this.emit()
      return true
    }
    const content = active.definition.content
    if (!isNavigation(content)) {
      return false
    }
    const consumed = content.back()
    if (consumed) {
      this.adoptRemovedBrowserHistoryId(takeRemovedBrowserHistoryId(content))
    }
    return consumed
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

  protected snapshotRestorationContent(codec: TaoNavigationRestorationCodec): TaoNavigationContentSnapshot {
    return {
      activeKey: this.activeKey,
      items: Object.fromEntries(this.items.map(item => {
        const content = item.definition.content
        return [item.key, {
          entries: item.entries.slice(1).flatMap(entry => {
            if (isNavigation(entry.presentable)) {
              return []
            }
            const snapshot = codec.snapshotPresentable(entry as PresentableEntry)
            return snapshot ? [snapshot] : []
          }),
          ...(isNavigation(content) && hasRestorationCapability(content)
            ? { navigation: content.navigationRestorationSnapshot(codec, codec.exclusions) }
            : {}),
        }]
      })),
      kind: 'selection',
    }
  }

  protected restoreRestorationContent(
    snapshot: TaoNavigationContentSnapshot,
    codec: TaoNavigationRestorationCodec,
  ): void {
    if (snapshot.kind !== 'selection' || !this.item(snapshot.activeKey)) {
      throw new UserInputError(`Restored content is not a valid selection for '${this.name}'.`, {
        navigation: this.name,
      })
    }
    this.activeKey = snapshot.activeKey
    for (const item of this.items) {
      const restored = snapshot.items[item.key]
      if (!restored) {
        throw new UserInputError(`Restored selection '${this.name}' has no '@${item.key}' item.`, {
          navigation: this.name,
        })
      }
      item.entries = [
        this.initialEntry(item.definition.content),
        ...restored.entries.map(entry => ({
          ...codec.restorePresentable(entry),
          instanceId: this.nextEntryId++,
        })),
      ]
      const content = item.definition.content
      if (restored.navigation) {
        if (!isNavigation(content) || !hasRestorationCapability(content)) {
          throw new UserInputError(
            `Restored selection '${this.name}@${item.key}' requires an unrestorable navigator.`,
            {
              navigation: this.name,
            },
          )
        }
        content.restoreNavigationSnapshot(restored.navigation, codec)
      }
    }
  }

  protected renderContent(taoProps?: TaoProps): React.ReactNode {
    const runtime = requireReactNativeRuntime()
    const display = this.display()
    if (display === 'toggle') {
      return this.renderToggle(taoProps)
    }
    // `automatic` prefers the platform's own tab surface. The native bar runs controlled — Tao's
    // reducer stays the source of truth — and every tab's entry stack stays mounted inside its
    // native screen, matching the JS surface's covered-content contract. Where no native host
    // exists (web, checks, a platform without the module), the JS bar below renders instead.
    if (display === 'automatic' && this.nativeSurface) {
      const activePresentable = this.activeItem().entries.at(-1)?.presentable
      const observable = taoProps?.navigationHostActive !== false
        && !(activePresentable !== undefined
          && isNavigation(activePresentable)
          && activePresentable.contentIsCovered())
      const native = renderNativeSelectionTabs({
        activeKey: this.activeKey,
        observable,
        items: this.items.map(item => ({
          content: createElement(LevelHiddenContext.Provider, {
            children: this.itemEntryLevels(item, taoProps),
            hidden: item.key !== this.activeKey,
          }),
          iconName: selectionItemIconName(item.definition),
          key: item.key,
          title: String(item.definition.label.evaluate().jsValue),
        })),
        onActivate: key => {
          this.activate(key)
        },
      })
      if (native !== undefined) {
        return native
      }
    }
    return createElement(runtime.View, {
      children: [
        createElement(runtime.View, {
          accessibilityRole: 'tablist',
          children: this.items.map(item =>
            createElement(
              React.Fragment,
              { key: item.key },
              Views.Pressable(
                {
                  __tao: {
                    ...taoProps,
                    designDefault: 'NavigationTab',
                    selected: item.key === this.activeKey,
                  },
                  action: {
                    invoke: () => {
                      this.activate(item.key)
                    },
                  },
                  semanticIdentity: `navigation:${this.name}:selection:${item.key}`,
                  title: String(item.definition.label.evaluate().jsValue),
                },
                {
                  nativeProps: {
                    accessibilityRole: 'tab',
                    ...accessibilityStateProps({ selected: item.key === this.activeKey }),
                  },
                },
              ),
            )
          ),
          key: 'selection-controls',
          style: [
            display === 'drawer' ? selectionDrawerControlsStyle : selectionTabControlsStyle,
            mountedDesignStyle(taoProps, 'NavigationTabs', display === 'drawer' ? 'column' : 'row'),
          ],
        }),
        createElement(runtime.View, {
          children: this.items.map(item =>
            createElement(
              OutlineRegionScope,
              { key: item.key, region: this.itemRegion(item) },
              item.entries.map((entry, index) =>
                createElement(NavigationLevel, {
                  children: renderPresentable(
                    entry.presentable,
                    entry.arguments,
                    this.entryTaoProps(item, taoProps),
                  ),
                  fill: isNavigation(entry.presentable) && entry.presentable.ownsWindowSurface(),
                  hidden: item.key !== this.activeKey || index !== item.entries.length - 1,
                  key: `${item.key}-${entry.instanceId}`,
                  region: presentedOccurrenceRegion(this, entry, 'content'),
                })
              ),
            )
          ),
          key: 'selection-content',
          style: [selectionContentStyle, mountedDesignStyle(taoProps, 'NavigationContent')],
        }),
      ],
      style: [navigationHostStyle, mountedDesignStyle(taoProps, 'NavigationHost')],
    })
  }

  /**
   * ownsWindowSurface: the native tab controller must receive true window bounds, so the app
   * host's scroll frame moves inside each tab (see itemEntryLevels) whenever the bar is native.
   */
  override ownsWindowSurface(): boolean {
    const display = this.display()
    return display === 'toggle'
      || display === 'automatic' && this.nativeSurface && nativeSelectionTabsAvailable(this.items.length)
  }

  /**
   * renderToggle draws every item full-bleed under one floating bar. Each item keeps its entries
   * mounted and hidden while inactive, exactly as the tab surfaces do; the bar shows the active
   * item's visible screen and switches to the item after it, wrapping.
   */
  private renderToggle(taoProps?: TaoProps): React.ReactNode {
    const runtime = requireReactNativeRuntime()
    const active = this.activeItem()
    const activeIndex = this.items.indexOf(active)
    const next = this.items.length > 1 ? this.items[(activeIndex + 1) % this.items.length] : undefined
    const nextIcon = next ? selectionItemIconName(next.definition) : undefined
    const activePresentable = active.entries.at(-1)?.presentable
    const observable = taoProps?.navigationHostActive !== false
      && !(activePresentable !== undefined
        && isNavigation(activePresentable)
        && activePresentable.contentIsCovered())
    return createElement(runtime.View, {
      children: [
        ...this.items.map(item =>
          createElement(runtime.View, {
            accessibilityElementsHidden: item !== active,
            children: createElement(LevelHiddenContext.Provider, {
              children: this.itemEntryLevels(item, {
                ...taoProps,
                navigationBottomInset: toggleBarContentInset(),
                navigationChrome: item.chrome,
              }, false),
              hidden: item !== active,
            }),
            importantForAccessibility: item === active ? 'auto' : 'no-hide-descendants',
            key: item.key,
            style: item === active ? toggleItemStyle : hiddenToggleItemStyle,
          })
        ),
        observable
          ? createElement(SelectionToggleBar, {
            back: () => {
              this.back()
            },
            canGoBack: this.canGoBack,
            chrome: active.chrome,
            fallbackTitle: String(active.definition.label.evaluate().jsValue),
            key: 'toggle-bar',
            name: this.name,
            // Glass follows the same switch as every native surface, so checks keep the portable bar.
            native: this.nativeSurface && nativeNavigationModule() !== undefined,
            ...(next
              ? {
                next: {
                  ...(nextIcon ? { icon: nextIcon } : {}),
                  key: next.key,
                  label: String(next.definition.label.evaluate().jsValue),
                },
              }
              : {}),
            observable,
            select: key => {
              this.activate(key)
            },
            taoProps,
          })
          : null,
      ],
      style: [navigationHostStyle, mountedDesignStyle(taoProps, 'NavigationHost')],
    })
  }

  private display(): string {
    return String(this.descriptor.config.display.evaluate().jsValue)
  }

  /**
   * itemEntryLevels renders one tab's entry stack; only the top entry is visible within the tab.
   * A tab entry carries its own content frame, because the navigator owns the window and the
   * safe-area scroll frame the app host would normally provide belongs inside the native screen.
   * An entry that is itself a window-owning navigator — a stack, which already frames each of its
   * own screens — takes the tab's bounds instead: a scroll frame around it leaves its screens with
   * no definite height, so they measure as empty and its header draws against nothing.
   */
  private itemEntryLevels(item: SelectionItemState, taoProps?: TaoProps, nativeInsets = true): React.ReactNode {
    const { navigationBottomInset, navigationChrome, ...entryTaoProps } = this.entryTaoProps(item, taoProps)
    return createElement(
      OutlineRegionScope,
      { region: this.itemRegion(item) },
      item.entries.map((entry, index) => {
        const ownsWindow = isNavigation(entry.presentable) && entry.presentable.ownsWindowSurface()
        // Enclosing chrome reaches only a stack that is the item's own entry, since only a stack
        // reads its presented scene's slots. Anything rendered deeper keeps its own chrome.
        const stack = isNavigation(entry.presentable) && entry.presentable.kind === 'stack'
        const presentableTaoProps = stack
          ? { ...entryTaoProps, navigationBottomInset, navigationChrome }
          : entryTaoProps
        const level = createElement(NavigationLevel, {
          children: renderPresentable(entry.presentable, entry.arguments, presentableTaoProps),
          fill: ownsWindow,
          hidden: index !== item.entries.length - 1,
          region: presentedOccurrenceRegion(this, entry, 'content'),
        })
        // A window-owning entry frames its own screens; inside a native screen those frames take
        // the platform's insets, as the frame this item would otherwise draw around it does.
        return ownsWindow
          ? createElement(AppSurfaceFrameDefaults.Provider, {
            children: level,
            key: `${item.key}-${entry.instanceId}`,
            nativeInsets,
          })
          : createElement(AppSurfaceFrame, {
            bottomInset: navigationBottomInset,
            children: level,
            key: `${item.key}-${entry.instanceId}`,
            nativeInsets,
            taoProps: entryTaoProps,
          })
      }),
    )
  }

  /** itemRegion is the region one keyed item is: its key, named by its `Label`. */
  private itemRegion(item: SelectionItemState): ReturnType<typeof selectionItemRegion> {
    return selectionItemRegion(
      this.name,
      item.key,
      () => String(item.definition.label.evaluate().jsValue),
      () => item.key === this.activeKey,
    )
  }

  private activeItem(): SelectionItemState {
    return this.item(this.activeKey)!
  }

  private entryTaoProps(item: SelectionItemState, taoProps?: TaoProps): TaoProps {
    return {
      ...navigationProps(taoProps, this),
      navigationHostActive: taoProps?.navigationHostActive !== false && item.key === this.activeKey,
    }
  }

  private initialEntry(content: TaoPresentable | TaoNavigationValue): SelectionItemState['entries'][number] {
    return { arguments: {}, instanceId: this.nextEntryId++, presentable: content }
  }

  private item(key: string): SelectionItemState | undefined {
    return this.items.find(item => item.key === key)
  }
}

function hasRestorationCapability(navigation: TaoNavigationValue): navigation is TaoNavigationValue & {
  navigationRestorationSnapshot: RuntimeNavigationValue['navigationRestorationSnapshot']
  restoreNavigationSnapshot: RuntimeNavigationValue['restoreNavigationSnapshot']
} {
  const candidate = navigation as Partial<RuntimeNavigationValue>
  return typeof candidate.navigationRestorationSnapshot === 'function'
    && typeof candidate.restoreNavigationSnapshot === 'function'
}

/** selectionItemIconName reads an item's `Icon` property, which carries an SF Symbol name. */
function selectionItemIconName(definition: TaoSelectionNavItemDefinition): string | undefined {
  const icon = definition.icon?.evaluate().jsValue
  return typeof icon === 'string' && icon.length > 0 ? icon : undefined
}

const selectionContentStyle = { flex: 1 } as const
const toggleItemStyle = { flex: 1 } as const
const hiddenToggleItemStyle = { display: 'none' } as const
const selectionDrawerControlsStyle = { flexDirection: 'column' } as const
const selectionTabControlsStyle = { flexDirection: 'row' } as const
