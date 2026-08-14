import React from 'react'
import type {
  TaoNavDescriptor,
  TaoNavigationArguments,
  TaoNavigationPatch,
  TaoPresentable,
  TaoSlotNavConfiguration,
  TaoStackNavConfiguration,
} from './TR-navigation'
import type { PresentableEntry } from './TR-navigation-state'
import { NavigationLevel, navigationProps } from './TR-navigation-surfaces'
import { RuntimeNavigationValue } from './TR-navigation-value'
import {
  assertPatchKeys,
  isNavigation,
  patchedPresentable,
  renderPresentable,
} from './TR-navigation-values'
import type { TaoProps } from './TR-TaoProps'

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
