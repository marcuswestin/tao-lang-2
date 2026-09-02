import React from 'react'
import { RuntimeAssert } from './TR-assert'
import type {
  TaoNavDescriptor,
  TaoNavigationArguments,
  TaoNavigationInput,
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

/**
 * HostedNavigation is one navigator a view rendered inside this occurrence's content. Its mount
 * outlives the React tree that rendered it, which is what keeps its history when the enclosing
 * presentation is covered and comes back. `attached` counts the rendered occurrences of that mount
 * and `active` follows the host's focus, so Back and activation reach only a navigator on screen.
 */
type HostedNavigation = {
  active: boolean
  attached: number
  mount: RuntimeNavigationValue
}

type PendingHostedRestoration = {
  codec: TaoNavigationRestorationCodec
  snapshots: Record<string, TaoNavigationSnapshot>
}

/** RuntimeNavigationValue is the shared process-local contract for configured navigation values. */
export abstract class RuntimeNavigationValue implements Subscription {
  protected listeners = new Set<() => void>()
  protected version = 0
  private browserHistoryId: number | undefined
  private removedBrowserHistoryId: number | undefined
  private nextOverlayEntryId = 1
  private overlayEntries: OverlayEntry[] = []
  private readonly hosted = new Map<RuntimeNavigationValue, HostedNavigation>()
  private readonly hostedByInput = new Map<TaoNavigationInput, RuntimeNavigationValue>()
  private pendingHostedRestoration: PendingHostedRestoration | undefined

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
      || this.hostedNavigations().some(mount => mount.canGoBack)
  }

  /** historyDepth is the number of semantic Back operations mirrored by the web adapter. */
  historyDepth(): number {
    return this.overlayEntries.length + this.contentHistoryDepth()
      + this.hostedNavigations().reduce((depth, mount) => depth + mount.historyDepth(), 0)
  }

  /**
   * back removes this occurrence's top overlay, then its own content history, then reaches the
   * navigators its content renders. A hosted navigator sits inside the content, so the content
   * that covers it — a pushed screen, a presented replacement — goes first.
   */
  back(): boolean {
    this.removedBrowserHistoryId = undefined
    return this.dismissOverlay() || this.backContent() || this.backHosted()
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

  /** activate reaches a selection key through the navigators this occurrence's content renders. */
  activate(key: string): boolean {
    return this.hostedNavigations().some(mount => mount.activate(key))
  }

  /**
   * hostNavigation returns the one mount this occurrence holds for a navigator rendered inside its
   * content, creating it through `create` on first use. The cache is keyed by the configured
   * descriptor — or by the mounted value itself — so every render of the same navigator, across
   * covers and returns of the enclosing presentation, reaches the same history. Nothing here emits:
   * a render site calls it while React is rendering.
   */
  hostNavigation(input: TaoNavigationInput, create: () => RuntimeNavigationValue): RuntimeNavigationValue {
    const existing = this.hostedByInput.get(input)
    if (existing) {
      return existing
    }
    const mount = create()
    this.hostedByInput.set(input, mount)
    this.hosted.set(mount, { active: true, attached: 0, mount })
    mount.subscribe(() => this.emit())
    return mount
  }

  /**
   * attachHostedNavigation marks one rendered occurrence of a hosted navigator as on screen and
   * applies the position a stored snapshot holds for it. Restoration lands here, when the
   * navigator is mounted, because the app restores before its first render puts a view on screen
   * and a view is the only thing that renders a hosted navigator.
   */
  attachHostedNavigation(mount: RuntimeNavigationValue, active: boolean): () => void {
    const record = this.hosted.get(mount)
    RuntimeAssert.defined(record, `navigation '${mount.name}' is hosted by '${this.name}' before it attaches`, {
      host: this.name,
      navigation: mount.name,
    })
    record.active = active
    record.attached += 1
    this.restorePendingHosted(mount)
    return () => {
      record.attached -= 1
    }
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

  /** unreplayableOccurrences records asks whose process-local promises cannot enter replay state. */
  unreplayableOccurrences(): number {
    return this.overlayEntries.filter(entry => entry.response !== undefined).length
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
    this.pendingHostedRestoration = undefined
    this.resetContent()
    for (const record of this.hosted.values()) {
      record.mount.reset()
    }
    this.emit()
  }

  navigationRestorationSnapshot(
    codec: TaoNavigationRestorationCodec,
    exclusions: ReadonlySet<string>,
  ): TaoNavigationSnapshot {
    const descriptor = this.descriptor.canonicalDescriptor?.canonical
    RuntimeAssert.defined(descriptor, `navigation kind '${this.name}' has a canonical restoration identity`, {
      navigation: this.name,
    })
    const overlays = this.overlayEntries.flatMap(entry => {
      if (entry.response || (entry.sheet && exclusions.has('sheets'))) {
        return []
      }
      const snapshot = codec.snapshotPresentable(entry)
      return snapshot ? [{ ...snapshot, ...(entry.sheet ? { sheet: true as const } : {}) }] : []
    })
    const hosted = Object.fromEntries([...this.hosted.values()].flatMap(record => {
      const key = record.mount.descriptor.canonicalDescriptor?.canonical
      return key === undefined ? [] : [[key, record.mount.navigationRestorationSnapshot(codec, exclusions)] as const]
    }))
    return {
      content: this.snapshotRestorationContent(codec),
      descriptor,
      ...(Object.keys(hosted).length > 0 ? { hosted } : {}),
      kind: this.kind,
      overlays,
    }
  }

  restoreNavigationSnapshot(snapshot: TaoNavigationSnapshot, codec: TaoNavigationRestorationCodec): void {
    const descriptor = this.descriptor.canonicalDescriptor?.canonical
    RuntimeAssert.input(
      snapshot.kind === this.kind && descriptor !== undefined && snapshot.descriptor === descriptor,
      `Restored navigation descriptor does not match live '${this.name}'.`,
      { navigation: this.name },
    )
    this.overlayEntries = snapshot.overlays.map(entry => ({
      ...codec.restorePresentable(entry),
      host: new RuntimeHostReadChannel(),
      instanceId: this.nextOverlayEntryId++,
      ...(entry.sheet ? { sheet: true } : {}),
    }))
    this.restoreRestorationContent(snapshot.content, codec)
    // A hosted navigator this occurrence already holds restores now; one a view has yet to render
    // restores when it attaches. Either way it restores by its own descriptor identity.
    this.pendingHostedRestoration = snapshot.hosted ? { codec, snapshots: { ...snapshot.hosted } } : undefined
    for (const record of this.hosted.values()) {
      this.restorePendingHosted(record.mount)
    }
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

  /** overlayDepth is how many overlay or ask occurrences currently cover this occurrence's content. */
  protected overlayDepth(): number {
    return this.overlayEntries.length
  }

  /** hostedNavigations lists the rendered, focused navigators this occurrence's content holds. */
  private hostedNavigations(): RuntimeNavigationValue[] {
    return [...this.hosted.values()]
      .filter(record => record.attached > 0 && record.active)
      .map(record => record.mount)
  }

  private backHosted(): boolean {
    // Later mounts first, the order the app itself uses for its auxiliaries.
    for (const mount of this.hostedNavigations().toReversed()) {
      if (!mount.canGoBack) {
        continue
      }
      const consumed = mount.back()
      if (consumed) {
        this.adoptRemovedBrowserHistoryId(takeRemovedBrowserHistoryId(mount))
        return true
      }
    }
    return false
  }

  private restorePendingHosted(mount: RuntimeNavigationValue): void {
    const pending = this.pendingHostedRestoration
    const key = mount.descriptor.canonicalDescriptor?.canonical
    const snapshot = pending && key !== undefined ? pending.snapshots[key] : undefined
    if (!pending || key === undefined || !snapshot) {
      return
    }
    delete pending.snapshots[key]
    mount.restoreNavigationSnapshot(snapshot, pending.codec)
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
