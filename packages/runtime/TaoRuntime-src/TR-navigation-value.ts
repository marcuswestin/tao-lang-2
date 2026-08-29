import React from 'react'
import type {
  TaoDialogue,
  TaoNavDescriptor,
  TaoNavigationArguments,
  TaoNavigationPatch,
  TaoNavKindProfile,
  TaoPresentable,
} from './TR-navigation'
import { type Evaluable, RuntimeNavigationResult } from './TR-navigation-presentables'
import type { DialogueOccurrenceState, OverlayEntry, Subscription } from './TR-navigation-state'
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
