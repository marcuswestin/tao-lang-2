import React from 'react'
import type {
  TaoNavDescriptor,
  TaoNavigationArguments,
  TaoNavigationPatch,
  TaoNavKindProfile,
  TaoPresentable,
} from './TR-navigation'
import { type Evaluable, RuntimeNavigationResult } from './TR-navigation-presentables'
import type { OverlayEntry, ResponseOccurrenceState, Subscription } from './TR-navigation-state'
import { NavigationSurface } from './TR-navigation-surfaces'
import type { TaoProps } from './TR-TaoProps'

/** RuntimeNavigationValue is the shared process-local contract for configured navigation values. */
export abstract class RuntimeNavigationValue implements Subscription {
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

  /**
   * ownsWindowSurface says this navigator renders a native surface that must receive true window
   * bounds — the app host then leaves the scrollable content frame to the navigator's own screens.
   */
  ownsWindowSurface(): boolean {
    return false
  }

  presentOverlay(
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
    options: { sheet?: boolean } = {},
  ): void {
    this.overlayEntries.push({
      arguments: { ...arguments_ },
      instanceId: this.nextOverlayEntryId++,
      presentable,
      ...(options.sheet ? { sheet: true } : {}),
    })
    this.emit()
  }

  ask(view: TaoPresentable, arguments_: TaoNavigationArguments): Promise<Evaluable> {
    return new Promise(resolve => {
      let entry: OverlayEntry
      const occurrence: ResponseOccurrenceState = {
        resolve,
        respond: value => this.settleResponse(entry, value),
        settled: false,
      }
      entry = {
        arguments: { ...arguments_ },
        response: occurrence,
        instanceId: this.nextOverlayEntryId++,
        presentable: view,
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
      if (entry.response && !entry.response.settled) {
        entry.response.settled = true
        entry.response.resolve(new RuntimeNavigationResult(null))
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
    if (entry.response) {
      this.settleResponse(entry)
      return true
    }
    this.overlayEntries.pop()
    this.emit()
    return true
  }

  private settleResponse(entry: OverlayEntry, value?: Evaluable): void {
    const occurrence = entry.response
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
