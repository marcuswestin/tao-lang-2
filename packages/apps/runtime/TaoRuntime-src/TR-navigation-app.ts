import React from 'react'
import { Arrays } from './core/RuntimeCore'
import type { RuntimeAuthScope } from './TR-auth'
import { createElement } from './TR-create-element'
import { DesignControls, type TaoDesign } from './TR-design'
import { runtimeRevisionStore } from './TR-listeners'
import { mountedDesignStyle } from './TR-mounted-design'
import type {
  TaoAppDeclaration,
  TaoAppDefinition,
  TaoConfiguredNavigation,
  TaoNavigationArguments,
  TaoNavigationInput,
  TaoNavigationValue,
  TaoPresentable,
} from './TR-navigation'
import {
  BrowserNavigationHistory,
  type BrowserNavigationHistoryDriver,
} from './TR-navigation-browser-history'
import {
  createAppDeclaration,
  isConfiguredNavigation,
  mountConfiguredNavigation,
} from './TR-navigation-configuration'
import type { Evaluable } from './TR-navigation-presentables'
import {
  presentableRegistryVersion,
  registerNavigationApp,
  resolvePresentable,
  unregisterNavigation,
  unregisterNavigationApp,
} from './TR-navigation-registry'
import { NavigationRestorationController } from './TR-navigation-restoration'
import type { RestorationEnvelope } from './TR-navigation-restoration'
import type { PresentableEntry, Subscription } from './TR-navigation-state'
import {
  observeNavigationActivation,
  takeRemovedBrowserHistoryId,
  withBrowserHistoryEntry,
} from './TR-navigation-value'
import { requireReactNativeRuntime } from './TR-react-native'
import type { TaoReadNet } from './TR-read-net'
import { registerRuntimeCaptureDomain, type TaoRuntimeJson } from './TR-runtime-capture'
import type { TaoProps } from './TR-TaoProps'
import { Clock } from './TR-units'

type ToastEntry = PresentableEntry<TaoPresentable> & {
  key: string
  cancelExpiry: () => void
}

type NavigationOwner = {
  app: RuntimeAppDefinition
  lane: TaoNavigationValue
}

type NavigationLaneRecord = {
  configured: Array<readonly [TaoConfiguredNavigation, TaoNavigationValue]>
  contextDispose?: () => void
  mounts: TaoNavigationValue[]
  owner: NavigationOwner
  ownerDispose?: () => void
}

const navigationOwners = new WeakMap<TaoNavigationValue, Set<NavigationOwner>>()
const runtimeApps = new Set<RuntimeAppDefinition>()

type NavigationAppCapture = Readonly<{
  name: string
  state: RestorationEnvelope
  unreplayable: readonly Readonly<{ kind: 'ask'; restore: 'nearest-durable-screen' }>[]
}>

export function ownerOfNavigation(navigation: TaoNavigationValue): NavigationOwner | undefined {
  const owners = navigationOwners.get(navigation)
  return owners?.size === 1 ? owners.values().next().value : undefined
}

function registerNavigationOwner(
  mounts: TaoNavigationValue[],
  owner: NavigationOwner,
): () => void {
  for (const mount of mounts) {
    const owners = navigationOwners.get(mount) ?? new Set<NavigationOwner>()
    owners.add(owner)
    navigationOwners.set(mount, owners)
  }
  return () => {
    for (const mount of mounts) {
      const owners = navigationOwners.get(mount)
      owners?.delete(owner)
      if (owners?.size === 0) {
        navigationOwners.delete(mount)
      }
    }
  }
}

/** RuntimeAppDefinition lazily resolves app nav factories after generated module initialization. */
export class RuntimeAppDefinition implements Subscription {
  private auxiliariesValue: Record<string, TaoNavigationValue> | undefined
  private readonly browserMutatingLanes = new Map<TaoNavigationValue, number>()
  private readonly browserContexts = new WeakMap<
    TaoNavigationValue,
    Map<TaoNavigationValue, { id: number; key: string }>
  >()
  private descriptorMounts = new Map<TaoConfiguredNavigation, TaoNavigationValue>()
  private designValue: TaoDesign | undefined
  private readNetValue: TaoReadNet | undefined
  private readonly changes = runtimeRevisionStore()
  private readonly navigationLanes = new WeakMap<TaoNavigationValue, TaoNavigationValue>()
  private readonly navigationLaneRecords = new Map<TaoNavigationValue, NavigationLaneRecord>()
  private nextBrowserEntryId = 1
  private nextBrowserSelectionId = 1
  private nextToastEntryId = 1
  private readonly presentableVersion: number
  readonly authScope: RuntimeAuthScope | undefined
  private navigatorValue: TaoNavigationValue | undefined
  private replacement: TaoNavigationValue | undefined
  private toastEntries = new Map<string, ToastEntry>()
  private readonly browserHistory = new BrowserNavigationHistory(() => this.back())
  private readonly restoration: NavigationRestorationController

  readonly declaration: TaoAppDeclaration

  constructor(
    readonly definition: TaoAppDefinition,
    options: { deferredRegistration?: boolean; authScope?: RuntimeAuthScope; presentableVersion?: number } = {},
  ) {
    this.restoration = new NavigationRestorationController(this, options.deferredRegistration)
    this.authScope = options.authScope
    this.presentableVersion = options.presentableVersion ?? presentableRegistryVersion()
    this.declaration = definition.declaration ?? createAppDeclaration(definition.name)
    if (options.deferredRegistration !== true) {
      runtimeApps.add(this)
    }
  }

  /** Authenticated hosts keep navigation and restoration within their own mounted scope. */
  mountForAuth(scope: RuntimeAuthScope): RuntimeAppDefinition {
    return new RuntimeAppDefinition(this.definition, {
      authScope: scope,
      deferredRegistration: true,
      presentableVersion: this.presentableVersion,
    })
  }

  /** Activates a render-created Studio app only after React commits the host that owns it. */
  commitRegistration(): void {
    this.restoration.commitRegistration()
    runtimeApps.add(this)
    registerNavigationApp(this)
  }

  /**
   * dispose forgets one app definition the process built rather than declared.
   *
   * The compiler emits an app definition once at generated-module scope, so a real app never calls
   * this. Studio's focused-view cells build one per mount, and a definition that outlived its cell
   * would still answer a process-wide reset, still contribute a lane to every runtime capture, and
   * still hold its mounted navigation alive.
   */
  dispose(): void {
    this.restoration.dispose()
    for (const [lane, record] of [...this.navigationLaneRecords]) {
      this.deactivateNavigationLane(lane, true)
      for (const mount of record.mounts) {
        unregisterNavigation(mount)
      }
    }
    runtimeApps.delete(this)
    unregisterNavigationApp(this)
    this.changes.clear()
  }

  readonly subscribe = this.changes.subscribe

  readonly snapshot = this.changes.snapshot

  get navigator(): TaoNavigationValue {
    return this.replacement ?? (this.navigatorValue ??= this.mount(this.definition.navigator(this.authScope)))
  }

  get auxiliaries(): Record<string, TaoNavigationValue> {
    return this.auxiliariesValue ??= Object.fromEntries(
      Object.entries(this.definition.auxiliaries(this.authScope)).map(([key, value]) => [key, this.mount(value)]),
    )
  }

  /** Keep the original declaration as the identity anchor while reading its latest published snapshot. */
  get design(): TaoDesign | undefined {
    return DesignControls.current(this.designValue ??= this.definition.design?.())
  }

  readonly subscribeDesign = (listener: () => void): () => void => DesignControls.subscribe(this.design, listener)

  readonly designSnapshot = (): number => DesignControls.revision(this.design)

  /** readNet is the app's guard, resolved after generated module initialization. */
  get readNet(): TaoReadNet | undefined {
    return this.readNetValue ??= this.definition.readNet?.()
  }

  attachBrowserHistory(driver: BrowserNavigationHistoryDriver): () => void {
    return this.browserHistory.attach(driver)
  }

  async attachRestoration(): Promise<() => void> {
    await this.authScope?.restore()
    return this.restoration.attach()
  }

  restorationRequiresInitialLoad(): boolean {
    return this.restoration.requiresInitialLoad()
  }

  present(
    navigation: TaoNavigationValue,
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
  ): void {
    presentable = this.localPresentable(presentable)
    const instanceId = this.nextBrowserEntryId++
    const owner = this.browserOwner(navigation)
    const argumentsCopy = { ...arguments_ }
    const apply = () =>
      withBrowserHistoryEntry(
        navigation,
        instanceId,
        () => this.mutateNavigation(navigation, () => navigation.present(presentable, argumentsCopy)),
      )
    apply()
    this.recordBrowserMutation(
      instanceId,
      'content',
      owner,
      presentable,
      argumentsCopy,
      apply,
    )
  }

  presentOverlay(
    navigation: TaoNavigationValue,
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
    options: { sheet?: boolean } = {},
  ): void {
    presentable = this.localPresentable(presentable)
    const instanceId = this.nextBrowserEntryId++
    const owner = this.browserOwner(navigation)
    const argumentsCopy = { ...arguments_ }
    const apply = () =>
      withBrowserHistoryEntry(
        navigation,
        instanceId,
        () =>
          this.mutateNavigation(
            navigation,
            () => navigation.presentOverlay(presentable, argumentsCopy, options),
          ),
      )
    apply()
    this.recordBrowserMutation(
      instanceId,
      'overlay',
      owner,
      presentable,
      argumentsCopy,
      apply,
    )
  }

  ask(
    navigation: TaoNavigationValue,
    view: TaoPresentable,
    arguments_: TaoNavigationArguments,
  ): Promise<Evaluable> {
    view = this.localPresentable(view)
    const instanceId = this.nextBrowserEntryId++
    const owner = this.browserOwner(navigation)
    const result = withBrowserHistoryEntry(
      navigation,
      instanceId,
      () =>
        this.mutateNavigation(navigation, () =>
          navigation.ask(
            view,
            arguments_,
            () => this.browserHistory.reducerBackCompleted({ instanceId, owner }),
          )),
    )
    this.recordBrowserMutation(instanceId, 'ask', owner, view, arguments_)
    return result
  }

  dismiss(navigation: TaoNavigationValue): boolean {
    const owner = this.browserOwner(navigation)
    const dismissed = this.mutateNavigation(navigation, () => navigation.dismiss())
    if (dismissed) {
      this.browserHistory.reducerBackCompleted({
        instanceId: takeRemovedBrowserHistoryId(navigation),
        context: this.browserContext(owner),
        owner,
      })
    }
    return dismissed
  }

  replace(navigator: TaoNavigationInput): void {
    const previousReplacement = this.replacement
    const previous = previousReplacement ?? this.navigatorValue
    if (previous) {
      this.deactivateNavigationLane(
        previous,
        previousReplacement !== undefined && !this.isRetainedNavigation(previous),
      )
    }
    this.replacement = this.mount(navigator)
    this.restoration.lanesChanged()
    this.browserHistory.reset()
    this.emit()
  }

  activate(key: string): boolean {
    return this.navigator.activate(key)
  }

  /**
   * hostNavigation mounts a navigator a view rendered inside `host`'s content and joins it to the
   * lane `host` belongs to, so `present … in Nav` resolves it, Back reaches it through the lane's
   * owner, and its selection changes keep the browser mirror honest. A host this app does not own
   * — a view rendered outside any lane — still gets a registered mount.
   */
  hostNavigation(host: TaoNavigationValue, configured: TaoConfiguredNavigation): TaoNavigationValue {
    const lane = this.navigationLanes.get(host)
    const record = lane ? this.navigationLaneRecords.get(lane) : undefined
    const mounts: TaoNavigationValue[] = []
    const configuredMounts: Array<readonly [TaoConfiguredNavigation, TaoNavigationValue]> = []
    const mount = mountConfiguredNavigation(
      configured,
      (nested, nestedMount) => {
        mounts.push(nestedMount)
        configuredMounts.push([nested, nestedMount])
      },
      presentable => this.localPresentable(presentable),
    )
    if (!lane || !record) {
      return mount
    }
    record.mounts.push(...mounts)
    record.configured.push(...configuredMounts)
    if (!record.ownerDispose) {
      // An inactive lane registers everything it holds when it is activated again.
      return mount
    }
    for (const hosted of mounts) {
      this.navigationLanes.set(hosted, lane)
    }
    for (const [nested, nestedMount] of configuredMounts) {
      this.descriptorMounts.set(nested, nestedMount)
    }
    const disposeOwner = registerNavigationOwner(mounts, record.owner)
    const previousOwnerDispose = record.ownerDispose
    record.ownerDispose = () => {
      disposeOwner()
      previousOwnerDispose()
    }
    const disposeContexts = this.trackBrowserContexts(lane, mounts)
    const previousContextDispose = record.contextDispose
    record.contextDispose = () => {
      disposeContexts()
      previousContextDispose?.()
    }
    return mount
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
    durationNanoseconds: number,
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
  ): void {
    presentable = this.localPresentable(presentable)
    const existing = this.toastEntries.get(key)
    if (existing) {
      existing.cancelExpiry()
    }
    const entry: ToastEntry = {
      arguments: { ...arguments_ },
      instanceId: this.nextToastEntryId++,
      key,
      presentable,
      cancelExpiry: () => {},
    }
    // A toast expires on the Tao clock, so a check can advance to its expiry the same way it
    // advances a ticker.
    entry.cancelExpiry = Clock.after(durationNanoseconds / 1e6, () => this.expireToast(key, entry))
    this.toastEntries.set(key, entry)
    this.emit()
  }

  renderToasts(taoProps?: TaoProps): React.ReactNode {
    const runtime = requireReactNativeRuntime()
    return [...this.toastEntries.values()].map(entry =>
      // A toast is transient, so it carries its own surface rather than relying on the app's
      // background: bare text over arbitrary content is not reliably legible.
      createElement(
        runtime.View,
        {
          key: entry.instanceId,
          style: [toastSurfaceStyle, mountedDesignStyle(taoProps, 'ToastSurface')],
        },
        entry.presentable.render(entry.arguments, { ...taoProps, app: this }),
      )
    )
  }

  back(): boolean {
    for (const auxiliary of Arrays.reversed(Object.values(this.auxiliaries))) {
      if (this.mutateNavigation(auxiliary, () => auxiliary.back())) {
        this.browserHistory.reducerBackCompleted({
          context: this.browserContext(auxiliary),
          instanceId: takeRemovedBrowserHistoryId(auxiliary),
          owner: auxiliary,
        })
        return true
      }
    }
    const navigator = this.navigator
    const consumed = this.mutateNavigation(navigator, () => navigator.back())
    if (consumed) {
      this.browserHistory.reducerBackCompleted({
        context: this.browserContext(navigator),
        instanceId: takeRemovedBrowserHistoryId(navigator),
        owner: navigator,
      })
    }
    return consumed
  }

  get canGoBack(): boolean {
    return Object.values(this.auxiliaries).some(auxiliary => auxiliary.canGoBack)
      || this.navigator.canGoBack
  }

  /** historyDepth totals the reducer work one browser history cursor represents. */
  historyDepth(): number {
    return Object.values(this.auxiliaries).reduce((depth, auxiliary) => depth + auxiliary.historyDepth(), 0)
      + this.navigator.historyDepth()
  }

  reset(): void {
    for (const entry of this.toastEntries.values()) {
      entry.cancelExpiry()
    }
    this.toastEntries.clear()

    const replacement = this.replacement
    if (replacement) {
      this.mutateNavigation(replacement, () => replacement.reset())
      this.deactivateNavigationLane(replacement, !this.isRetainedNavigation(replacement))
      this.replacement = undefined
    }
    const retained = [
      ...(this.navigatorValue ? [this.navigatorValue] : []),
      ...Object.values(this.auxiliariesValue ?? {}),
    ]
    for (const navigation of retained) {
      this.deactivateNavigationLane(navigation)
      this.mutateNavigation(navigation, () => navigation.reset())
      this.activateNavigationLane(this.navigationLaneRecords.get(navigation)!)
    }
    this.browserHistory.reset()
    this.emit()
  }

  captureNavigation(): NavigationAppCapture {
    void this.navigator
    void this.auxiliaries
    const mounts = new Set([...this.navigationLaneRecords.values()].flatMap(record => record.mounts))
    const asks = [...mounts].reduce((count, mount) => count + mount.unreplayableOccurrences(), 0)
    return {
      name: this.definition.name,
      state: this.restoration.capture(),
      unreplayable: Object.freeze(Array.from({ length: asks }, () => ({
        kind: 'ask' as const,
        restore: 'nearest-durable-screen' as const,
      }))),
    }
  }

  restoreNavigation(capture: NavigationAppCapture): void {
    this.reset()
    this.restoration.restoreCapture(capture.state)
  }

  private emit(): void {
    this.changes.changed()
  }

  private mutateNavigation<ResultT>(
    navigation: TaoNavigationValue,
    mutation: () => ResultT,
  ): ResultT {
    const lane = this.browserOwner(navigation)
    this.browserMutatingLanes.set(lane, (this.browserMutatingLanes.get(lane) ?? 0) + 1)
    try {
      return mutation()
    } finally {
      const depth = this.browserMutatingLanes.get(lane)! - 1
      if (depth === 0) {
        this.browserMutatingLanes.delete(lane)
      } else {
        this.browserMutatingLanes.set(lane, depth)
      }
    }
  }

  private isRetainedNavigation(navigation: TaoNavigationValue): boolean {
    return navigation === this.navigatorValue
      || Object.values(this.auxiliariesValue ?? {}).includes(navigation)
  }

  private mount(input: TaoNavigationInput): TaoNavigationValue {
    if (!isConfiguredNavigation(input)) {
      const existing = this.navigationLaneRecords.get(input)
      if (existing) {
        this.activateNavigationLane(existing)
        return input
      }
      const record: NavigationLaneRecord = {
        configured: [],
        mounts: [input],
        owner: { app: this, lane: input },
      }
      this.navigationLaneRecords.set(input, record)
      this.activateNavigationLane(record)
      return input
    }
    const mounts: TaoNavigationValue[] = []
    const configuredMounts: Array<readonly [TaoConfiguredNavigation, TaoNavigationValue]> = []
    const lane = mountConfiguredNavigation(
      input,
      (configured, mount) => {
        mounts.push(mount)
        configuredMounts.push([configured, mount])
      },
      presentable => this.localPresentable(presentable),
    )
    const record: NavigationLaneRecord = {
      configured: configuredMounts,
      mounts,
      owner: { app: this, lane },
    }
    this.navigationLaneRecords.set(lane, record)
    this.activateNavigationLane(record)
    return lane
  }

  /** resolvePresentable returns the closure registered in this app's generated module generation. */
  resolvePresentable(canonicalIdentity: string): TaoPresentable {
    return resolvePresentable<TaoPresentable>(canonicalIdentity, this.presentableVersion)
  }

  private localPresentable(presentable: TaoPresentable): TaoPresentable {
    const identity = presentable.definition.identity?.canonical
    if (!identity) {
      return presentable
    }
    const local = this.resolvePresentable(identity)
    return presentable.boundArguments ? local.bind(presentable.boundArguments) : local
  }

  private activateNavigationLane(record: NavigationLaneRecord): void {
    if (record.ownerDispose) {
      return
    }
    const { lane } = record.owner
    for (const mount of record.mounts) {
      this.navigationLanes.set(mount, lane)
    }
    for (const [configured, mount] of record.configured) {
      this.descriptorMounts.set(configured, mount)
    }
    record.ownerDispose = registerNavigationOwner(record.mounts, record.owner)
    record.contextDispose = this.trackBrowserContexts(lane, record.mounts)
  }

  private deactivateNavigationLane(lane: TaoNavigationValue, forget = false): void {
    const record = this.navigationLaneRecords.get(lane)
    if (!record?.ownerDispose) {
      return
    }
    record.contextDispose?.()
    record.contextDispose = undefined
    record.ownerDispose()
    record.ownerDispose = undefined
    for (const mount of record.mounts) {
      if (this.navigationLanes.get(mount) === lane) {
        this.navigationLanes.delete(mount)
      }
    }
    for (const [configured, mount] of record.configured) {
      if (this.descriptorMounts.get(configured) === mount) {
        this.descriptorMounts.delete(configured)
      }
    }
    if (forget) {
      this.navigationLaneRecords.delete(lane)
    }
  }

  private recordBrowserMutation(
    instanceId: number,
    kind: 'ask' | 'content' | 'overlay',
    owner: TaoNavigationValue,
    presentable: TaoPresentable,
    arguments_: TaoNavigationArguments,
    replay?: () => void,
  ): void {
    const context = this.browserContext(owner)
    this.browserHistory.record({
      arguments: arguments_,
      ...(context ? { context } : {}),
      instanceId,
      kind,
      owner,
      presentable,
      ...(replay ? { replay } : {}),
    })
  }

  private browserOwner(navigation: TaoNavigationValue): TaoNavigationValue {
    return this.navigationLanes.get(navigation) ?? navigation
  }

  private browserContext(navigation: TaoNavigationValue): string | undefined {
    const contexts = this.browserContexts.get(navigation)
    if (!contexts || contexts.size === 0) {
      return undefined
    }
    return JSON.stringify(
      Arrays.sorted([...contexts.values()], (left, right) => left.id - right.id)
        .map(context => [context.id, context.key]),
    )
  }

  /**
   * trackBrowserContexts observes the selection mounts among `mounts` on behalf of `lane`. It adds
   * to whatever the lane already tracks, because a navigator a view renders joins its lane after
   * the lane was activated.
   */
  private trackBrowserContexts(lane: TaoNavigationValue, mounts: TaoNavigationValue[]): () => void {
    const selections = mounts.filter(mount => mount.kind === 'selection')
    if (selections.length === 0) {
      return () => {}
    }
    const contexts = this.browserContexts.get(lane) ?? new Map<TaoNavigationValue, { id: number; key: string }>()
    const disposers: Array<() => void> = []
    this.browserContexts.set(lane, contexts)
    for (const selection of selections) {
      const initial = (selection.descriptor.config as { initial?: unknown }).initial
      if (typeof initial !== 'string') {
        continue
      }
      const context = { id: this.nextBrowserSelectionId++, key: initial }
      contexts.set(selection, context)
      // Subscription is the zero-change structural fallback for sealed third-party mounts. Any
      // selection state change makes an existing redo chain unsafe even if its active key is opaque.
      const observation = observeNavigationActivation(selection, key => {
        if (key !== context.key) {
          this.browserHistory.invalidateRedo()
        }
        context.key = key
      })
      disposers.push(observation.dispose)
      disposers.push(selection.subscribe(() => {
        if (this.browserMutatingLanes.has(lane) || observation.observesKey) {
          return
        }
        this.browserHistory.invalidateOwnerReplay(lane)
      }))
    }
    return () => {
      for (const dispose of Arrays.reversed(disposers)) {
        dispose()
      }
      for (const selection of selections) {
        contexts.delete(selection)
      }
      if (contexts.size === 0 && this.browserContexts.get(lane) === contexts) {
        this.browserContexts.delete(lane)
      }
    }
  }

  private expireToast(key: string, entry: ToastEntry): void {
    if (this.toastEntries.get(key) !== entry) {
      return
    }
    this.toastEntries.delete(key)
    this.emit()
  }
}

/** Narrow test seam for proving render-created apps do not enter the process registry before commit. */
export function runtimeAppIsRegisteredForTest(app: RuntimeAppDefinition): boolean {
  return runtimeApps.has(app)
}

/**
 * Identifies one app's navigation capture. The declaration alone is not enough: an app variant
 * (`app Preview = Base with { … }`) keeps its base's declaration identity, so every variant of one
 * app shared a key. Capture is an object literal, so the last variant overwrote the rest, and
 * restore handed that one snapshot to all of them — where a navigator whose configuration the
 * variant had patched refused a descriptor that was never its own, and the whole restore failed.
 *
 * The lanes are what makes the capture what it is, so they belong in its name. They are also
 * exactly what `restore` validates, which gives the key the property worth having: two apps share a
 * key only when each could restore the other's snapshot.
 */
function appCaptureKey(app: RuntimeAppDefinition): string {
  const declaration = app.declaration.canonicalIdentity?.canonical ?? app.definition.name
  const lanes = Arrays.sorted([
    ['', laneCaptureIdentity(app.navigator)] as const,
    ...Object.entries(app.auxiliaries).map(([key, navigation]) => [key, laneCaptureIdentity(navigation)] as const),
  ], ([left], [right]) => left.localeCompare(right))
  // The declaration stays verbatim at the front rather than nested, so the key still reads as the
  // declaration it belongs to. Both halves are JSON, which cannot carry a raw newline, so the
  // separator cannot collide with either.
  return `${declaration}\n${JSON.stringify(lanes)}`
}

/** A lane's structural identity, falling back to its kind where a navigation declares none. */
function laneCaptureIdentity(navigation: TaoNavigationValue): string {
  return navigation.descriptor.canonicalDescriptor?.canonical ?? navigation.name
}

function captureNavigationApps(): TaoRuntimeJson {
  return Object.fromEntries(
    [...runtimeApps].map(app => [appCaptureKey(app), app.captureNavigation()]),
  ) as TaoRuntimeJson
}

function restoreNavigationApps(value: TaoRuntimeJson): void {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return
  }
  const captures = value as Readonly<Record<string, TaoRuntimeJson>>
  for (const app of runtimeApps) {
    const capture = captures[appCaptureKey(app)]
    if (capture && typeof capture === 'object' && !Array.isArray(capture)) {
      app.restoreNavigation(capture as unknown as NavigationAppCapture)
    }
  }
}

registerRuntimeCaptureDomain({
  capture: captureNavigationApps,
  domain: 'navigation',
  module: 'TR-navigation-app',
  restore: restoreNavigationApps,
  version: 1,
})

const toastSurfaceStyle = {
  alignSelf: 'center',
  backgroundColor: '#121826',
  borderRadius: 10,
  boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.3)',
  marginTop: 8,
  maxWidth: 480,
  paddingHorizontal: 16,
  paddingVertical: 12,
} as const
