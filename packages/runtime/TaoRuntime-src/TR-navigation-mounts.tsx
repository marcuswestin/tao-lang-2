import React from 'react'
import { AppSurfaceFrame } from './TR-app-shell'
import { RuntimeAssert } from './TR-assert'
import { UserInputError } from './TR-errors'
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
import { nativeStackAvailable, NativeStackSurface } from './TR-navigation-native-stack'
import { nativeSelectionTabsAvailable, renderNativeSelectionTabs } from './TR-navigation-native-tabs'
import type {
  TaoNavigationContentSnapshot,
  TaoNavigationRestorationCodec,
} from './TR-navigation-restoration-state'
import type { PresentableEntry } from './TR-navigation-state'
import { navigationHostStyle, NavigationLevel, navigationProps } from './TR-navigation-surfaces'
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
    const target = [...Object.values(this.descriptor.config.items)].reverse()
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
    const target = [...Object.values(this.descriptor.config.items)].reverse()
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
    return React.createElement(SplitNavSurface, { navigation: this, taoProps })
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
    children.push(React.createElement(runtime.View, {
      children: renderPresentable(item.content, {}, navigationProps(props.taoProps, props.navigation)),
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
    children.push(React.createElement(runtime.View, {
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
  return React.createElement(runtime.View, { children, style: { flex: 1, flexDirection: 'row' } })
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
    const props = { entries: this.entries, navigation: this, taoProps: navigationProps(taoProps, this) }
    return this.surface === 'native'
      ? React.createElement(NativeStackSurface, props)
      : React.createElement(BasicStackSurface, props)
  }

  /** reconcileNativeDismissal applies a gesture once; a prior Tao/header Back makes it a no-op. */
  reconcileNativeDismissal(instanceId: number, count: number): void {
    // A native gesture belongs to the retained content stack. If Tao is currently presenting an
    // overlay or ask above it, that semantic layer must win Back precedence and the gesture is stale.
    if (this.historyDepth() > this.contentHistoryDepth()) {
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
    if (this.historyDepth() > this.contentHistoryDepth()) {
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
}

type SelectionItemState = {
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
    const display = String(this.descriptor.config.display.evaluate().jsValue)
    // `automatic` prefers the platform's own tab surface. The native bar runs controlled — Tao's
    // reducer stays the source of truth — and every tab's entry stack stays mounted inside its
    // native screen, matching the JS surface's covered-content contract. Where no native host
    // exists (web, checks, a platform without the module), the JS bar below renders instead.
    if (display === 'automatic' && this.nativeSurface) {
      const native = renderNativeSelectionTabs({
        activeKey: this.activeKey,
        items: this.items.map(item => ({
          content: this.itemEntryLevels(item, taoProps),
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
    return React.createElement(runtime.View, {
      children: [
        React.createElement(runtime.View, {
          children: this.items.map(item =>
            React.createElement(
              React.Fragment,
              { key: item.key },
              Views.Pressable(
                {
                  __tao: {
                    ...taoProps,
                    designDefault: item.key === this.activeKey ? 'NavigationTabActive' : 'NavigationTab',
                  },
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
          style: [
            display === 'drawer' ? selectionDrawerControlsStyle : selectionTabControlsStyle,
            mountedDesignStyle(taoProps, 'NavigationTabs', display === 'drawer' ? 'column' : 'row'),
          ],
        }),
        React.createElement(runtime.View, {
          children: this.items.flatMap(item =>
            item.entries.map((entry, index) =>
              React.createElement(NavigationLevel, {
                children: renderPresentable(
                  entry.presentable,
                  entry.arguments,
                  this.entryTaoProps(item, taoProps),
                ),
                hidden: item.key !== this.activeKey || index !== item.entries.length - 1,
                key: `${item.key}-${entry.instanceId}`,
              })
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
    return String(this.descriptor.config.display.evaluate().jsValue) === 'automatic'
      && this.nativeSurface
      && nativeSelectionTabsAvailable()
  }

  /** itemEntryLevels renders one tab's entry stack; only the top entry is visible within the tab. */
  private itemEntryLevels(item: SelectionItemState, taoProps?: TaoProps): React.ReactNode {
    // Each tab carries its own content frame: the navigator owns the window, so the safe-area
    // scroll frame the app host would normally provide renders inside the native screen instead.
    return React.createElement(
      AppSurfaceFrame,
      { nativeInsets: true, taoProps: this.entryTaoProps(item, taoProps) },
      item.entries.map((entry, index) =>
        React.createElement(NavigationLevel, {
          children: renderPresentable(entry.presentable, entry.arguments, this.entryTaoProps(item, taoProps)),
          hidden: index !== item.entries.length - 1,
          key: `${item.key}-${entry.instanceId}`,
        })
      ),
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
const selectionDrawerControlsStyle = { flexDirection: 'column' } as const
const selectionTabControlsStyle = { flexDirection: 'row' } as const
