import React from 'react'
import type {
  TaoNavDescriptor,
  TaoNavigationArguments,
  TaoNavigationPatch,
  TaoNavigationValue,
  TaoPresentable,
  TaoSelectionNavConfiguration,
  TaoSelectionNavItemDefinition,
  TaoSlotNavConfiguration,
  TaoStackNavConfiguration,
} from './TR-navigation'
import type { PresentableEntry } from './TR-navigation-state'
import { navigationHostStyle, NavigationLevel, navigationProps } from './TR-navigation-surfaces'
import { RuntimeNavigationValue } from './TR-navigation-value'
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

/** RuntimeStackNav owns an ordered presentation history and preserves covered entries. */
export class RuntimeStackNav extends RuntimeNavigationValue {
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
export class RuntimeSlotNav extends RuntimeNavigationValue {
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
export class RuntimeSelectionNav extends RuntimeNavigationValue {
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

const selectionContentStyle = { flex: 1 } as const
const selectionDrawerControlsStyle = { flexDirection: 'column' } as const
const selectionTabControlsStyle = { flexDirection: 'row' } as const
