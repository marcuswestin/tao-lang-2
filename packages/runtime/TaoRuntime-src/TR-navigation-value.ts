import React from 'react'
import type {
  TaoNavDescriptor,
  TaoNavigationArguments,
  TaoNavigationPatch,
  TaoNavKindProfile,
  TaoPresentable,
} from './TR-navigation'
import {
  RuntimeHostReadChannel,
  type TaoHostSlotValues,
  type TaoNavHostSlotConfiguration,
  useHostSlots,
} from './TR-navigation-host-slots'
import { type Evaluable, RuntimeNavigationResult } from './TR-navigation-presentables'
import type {
  TaoNavigationContentSnapshot,
  TaoNavigationRestorationCodec,
  TaoNavigationSnapshot,
} from './TR-navigation-restoration-state'
import type {
  OverlayEntry,
  PresentableEntry,
  ResponseOccurrenceState,
  Subscription,
} from './TR-navigation-state'
import { NavigationSurface } from './TR-navigation-surfaces'
import type { TaoProps } from './TR-TaoProps'

export function withBrowserHistoryEntry<ResultT>(
  navigation: unknown,
  instanceId: number,
  mutation: () => ResultT,
): ResultT {
  const method = (navigation as {
    withBrowserHistoryEntry?: (instanceId: number, mutation: () => ResultT) => ResultT
  })?.withBrowserHistoryEntry
  return method ? method.call(navigation, instanceId, mutation) : mutation()
}

export function takeRemovedBrowserHistoryId(navigation: unknown): number | undefined {
  const method = (navigation as {
    takeRemovedBrowserHistoryId?: RuntimeNavigationValue['takeRemovedBrowserHistoryId']
  })?.takeRemovedBrowserHistoryId
  return method?.call(navigation)
}

type ActivationObserverState = {
  listeners: Set<(key: string) => void>
  ownDescriptor: PropertyDescriptor | undefined
}

const activationObservers = new WeakMap<object, ActivationObserverState>()

/** observeNavigationActivation instruments a mounted occurrence without extending the nav protocol. */
export function observeNavigationActivation(
  navigation: RuntimeNavigationValue,
  listener: (key: string) => void,
): { dispose(): void; observesKey: boolean } {
  const observed = navigation as RuntimeNavigationValue & object
  let state = activationObservers.get(observed)
  if (!state) {
    const original = observed.activate
    state = {
      listeners: new Set(),
      ownDescriptor: Object.getOwnPropertyDescriptor(observed, 'activate'),
    }
    try {
      Object.defineProperty(observed, 'activate', {
        configurable: true,
        value(key: string): boolean {
          const activated = original.call(this, key)
          if (activated) {
            for (const notify of state!.listeners) {
              notify(key)
            }
          }
          return activated
        },
        writable: true,
      })
    } catch {
      // Structural third-party mounts may be sealed. They remain usable, but cannot publish
      // history-free activation changes without extending the public navigation protocol.
      return { dispose: () => {}, observesKey: false }
    }
    activationObservers.set(observed, state)
  }
  state.listeners.add(listener)
  let active = true
  return {
    dispose() {
      if (!active) {
        return
      }
      active = false
      state?.listeners.delete(listener)
      if (state?.listeners.size !== 0) {
        return
      }
      if (state.ownDescriptor) {
        Object.defineProperty(observed, 'activate', state.ownDescriptor)
      } else {
        Reflect.deleteProperty(observed, 'activate')
      }
      activationObservers.delete(observed)
    },
    observesKey: true,
  }
}

/** RuntimeNavigationValue is the shared process-local contract for configured navigation values. */
export abstract class RuntimeNavigationValue implements Subscription {
  protected listeners = new Set<() => void>()
  protected version = 0
  private browserHistoryId: number | undefined
  private removedBrowserHistoryId: number | undefined
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

  /** historyDepth is the number of semantic Back operations mirrored by the web adapter. */
  historyDepth(): number {
    return this.overlayEntries.length + this.contentHistoryDepth()
  }

  back(): boolean {
    this.removedBrowserHistoryId = undefined
    return this.dismissOverlay() || this.backContent()
  }

  dismiss(): boolean {
    this.removedBrowserHistoryId = undefined
    return this.dismissOverlay() || this.dismissContent()
  }

  withBrowserHistoryEntry<ResultT>(instanceId: number, mutation: () => ResultT): ResultT {
    const previous = this.browserHistoryId
    this.browserHistoryId = instanceId
    try {
      return mutation()
    } finally {
      this.browserHistoryId = previous
    }
  }

  takeRemovedBrowserHistoryId(): number | undefined {
    const removed = this.removedBrowserHistoryId
    this.removedBrowserHistoryId = undefined
    return removed
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

  /** ownsBackAffordance says the navigator's own chrome already exposes semantic Back. */
  ownsBackAffordance(): boolean {
    return false
  }

  presentOverlay(
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
    options: { sheet?: boolean } = {},
  ): void {
    this.overlayEntries.push({
      ...this.presentableEntry(presentable, arguments_, this.nextOverlayEntryId++),
      ...(options.sheet ? { sheet: true } : {}),
    })
    this.emit()
  }

  ask(
    view: TaoPresentable,
    arguments_: TaoNavigationArguments,
    onRespond?: () => void,
  ): Promise<Evaluable> {
    return new Promise(resolve => {
      let entry: OverlayEntry
      const occurrence: ResponseOccurrenceState = {
        resolve,
        respond: value => this.settleResponse(entry, value, onRespond),
        settled: false,
      }
      entry = {
        ...this.presentableEntry(view, arguments_, this.nextOverlayEntryId++),
        response: occurrence,
      }
      this.overlayEntries.push(entry)
      this.emit()
    })
  }

  render(taoProps?: TaoProps, host?: RuntimeHostReadChannel): React.ReactNode {
    return React.createElement(NavigationValueHost, { host, navigation: this, taoProps })
  }

  renderSurface(taoProps?: TaoProps): React.ReactNode {
    const contentTaoProps = this.overlayEntries.length > 0
      ? { ...taoProps, navigationHostActive: false }
      : taoProps
    return React.createElement(NavigationSurface, {
      content: this.renderContent(contentTaoProps),
      navigation: this,
      overlays: this.overlayEntries,
      taoProps,
    })
  }

  hostSlotValues(): TaoHostSlotValues {
    const config = this.descriptor.config as { hostSlots?: TaoNavHostSlotConfiguration }
    return Object.freeze(Object.fromEntries(
      Object.entries(config.hostSlots ?? {}).map(([name, value]) => [name, () => value]),
    ))
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

  navigationRestorationSnapshot(
    codec: TaoNavigationRestorationCodec,
    exclusions: ReadonlySet<string>,
  ): TaoNavigationSnapshot {
    const descriptor = this.descriptor.canonicalDescriptor?.canonical
    if (!descriptor) {
      throw new Error(`Navigation kind '${this.name}' lacks canonical restoration identity.`)
    }
    const overlays = this.overlayEntries.flatMap(entry => {
      if (entry.response || (entry.sheet && exclusions.has('sheets'))) {
        return []
      }
      const snapshot = codec.snapshotPresentable(entry)
      return snapshot ? [{ ...snapshot, ...(entry.sheet ? { sheet: true as const } : {}) }] : []
    })
    return {
      content: this.snapshotRestorationContent(codec),
      descriptor,
      kind: this.kind,
      overlays,
    }
  }

  restoreNavigationSnapshot(snapshot: TaoNavigationSnapshot, codec: TaoNavigationRestorationCodec): void {
    const descriptor = this.descriptor.canonicalDescriptor?.canonical
    if (snapshot.kind !== this.kind || descriptor === undefined || snapshot.descriptor !== descriptor) {
      throw new Error(`Restored navigation descriptor does not match live '${this.name}'.`)
    }
    this.overlayEntries = snapshot.overlays.map(entry => ({
      ...codec.restorePresentable(entry),
      host: new RuntimeHostReadChannel(),
      instanceId: this.nextOverlayEntryId++,
      ...(entry.sheet ? { sheet: true } : {}),
    }))
    this.restoreRestorationContent(snapshot.content, codec)
    this.emit()
  }

  protected abstract backContent(): boolean
  protected abstract canGoBackContent(): boolean
  protected abstract dismissContent(): boolean
  protected contentHistoryDepth(): number {
    return this.canGoBackContent() ? 1 : 0
  }
  protected abstract renderContent(taoProps?: TaoProps): React.ReactNode
  protected abstract resetContent(): void
  protected abstract restoreRestorationContent(
    snapshot: TaoNavigationContentSnapshot,
    codec: TaoNavigationRestorationCodec,
  ): void
  protected abstract snapshotRestorationContent(
    codec: TaoNavigationRestorationCodec,
  ): TaoNavigationContentSnapshot

  protected adoptRemovedBrowserHistoryId(instanceId: number | undefined): void {
    this.removedBrowserHistoryId = instanceId
  }

  protected presentableEntry<PresentableT extends TaoPresentable>(
    presentable: PresentableT,
    arguments_: TaoNavigationArguments,
    instanceId: number,
  ): PresentableEntry<PresentableT> & { host: RuntimeHostReadChannel } {
    return {
      arguments: { ...arguments_ },
      ...(this.browserHistoryId === undefined ? {} : { browserHistoryId: this.browserHistoryId }),
      host: new RuntimeHostReadChannel(),
      instanceId,
      presentable,
    }
  }

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
    this.adoptRemovedBrowserHistoryId(entry.browserHistoryId)
    this.emit()
    return true
  }

  private settleResponse(entry: OverlayEntry, value?: Evaluable, onRespond?: () => void): void {
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
      this.adoptRemovedBrowserHistoryId(entry.browserHistoryId)
      this.emit()
      onRespond?.()
    }
  }
}

function NavigationValueHost(props: {
  host?: RuntimeHostReadChannel
  navigation: RuntimeNavigationValue
  taoProps?: TaoProps
}): React.ReactNode {
  useHostSlots(props.host, props.navigation.hostSlotValues())
  return props.navigation.renderSurface(props.taoProps)
}
