import { RuntimeAssert } from './TR-assert'
import { appProviderIdentity, type TaoKeyValueStorage } from './TR-data'
import { entityHandle } from './TR-data-entity'
import { memoryKeyValueStorage, platformKeyValueStorage } from './TR-data-provider'
import { restoreEntityReference, serializeEntityReference } from './TR-data-registry'
import { errorMessage, UnexpectedBehaviorError, UserInputError } from './TR-errors'
import { runtimeListeners } from './TR-listeners'
import type {
  TaoAppDeclaration,
  TaoAppDefinition,
  TaoNavigationArguments,
  TaoNavigationValue,
  TaoPresentable,
} from './TR-navigation'
import { RuntimeNavigationResult } from './TR-navigation-presentables'
import type {
  TaoNavigationRestorationCodec,
  TaoNavigationSnapshot,
  TaoPersistedValue,
  TaoPresentableSnapshot,
} from './TR-navigation-restoration-state'
import type { PresentableEntry } from './TR-navigation-state'
import { runtimeTestOverrideSlot } from './TR-test-override'

export type RestorationEnvelope = Readonly<{
  formatVersion: 1
  payload: Readonly<{
    auxiliaries: Readonly<Record<string, TaoNavigationSnapshot>>
    navigator: TaoNavigationSnapshot
  }>
  schemaVersion: 1
}>

type RestorableNavigation = TaoNavigationValue & {
  navigationRestorationSnapshot(
    codec: TaoNavigationRestorationCodec,
    exclusions: ReadonlySet<string>,
  ): TaoNavigationSnapshot
  restoreNavigationSnapshot(snapshot: TaoNavigationSnapshot, codec: TaoNavigationRestorationCodec): void
}

type RestorableApp = {
  auxiliaries: Record<string, TaoNavigationValue>
  declaration: TaoAppDeclaration
  definition: TaoAppDefinition
  navigator: TaoNavigationValue
  resolvePresentable(canonicalIdentity: string): TaoPresentable
  reset(): void
}

export type NavigationRestorationDiagnostic = Readonly<{
  app: string
  code: 'NAV_RESTORE_ENTRY_SKIPPED' | 'NAV_RESTORE_FALLBACK' | 'NAV_RESTORE_UNSUPPORTED'
  message: string
  severity: 'warning'
}>

const diagnosticsListeners = runtimeListeners<[diagnostic: NavigationRestorationDiagnostic]>()
/**
 * controllers holds every restoration controller a generated module has declared. The compiler
 * emits an app definition once at generated-module scope, so a controller outlives every mount,
 * every launch, and every check; only a registry filled by the constructor can reach the one a
 * previous launch left behind. It holds one entry per app declaration per module evaluation, each
 * already alive for the life of the module that declared it, so a real app pays nothing for it.
 */
const controllers = new Set<NavigationRestorationController>()
let storageOverride: TaoKeyValueStorage | undefined
/**
 * Separates persisted navigation per Studio preview cell.
 *
 * The key is otherwise the app declaration, its variant and its data provider — none of which
 * distinguish two scenarios of one app. That is fine for a shipped app, which only ever has one, and
 * wrong for a preview: scenarios differ by fixture, so restoring one scenario's stack into another
 * hands its screens entity handles for rows that do not exist there, and the cell fails to render at
 * all until the stored stack is cleared.
 *
 * A device is where this bites, because one process is assigned every cell in turn and keeps real
 * device storage between them.
 */
let previewScope: string | undefined
let testStorageRestore: (() => void) | undefined
const storageSlot = runtimeTestOverrideSlot({
  read: () => storageOverride,
  write: next => {
    storageOverride = next
  },
})

/**
 * beginNavigationRestorationTest gives one Tao check its own device. Restoration itself stays on —
 * a check observes the policy its app declares, which is the whole point — but it reads and writes
 * a private in-memory store, and every controller forgets the launch it was in the middle of. A
 * position one check reached is therefore unreachable in the next, in both the memoized load and
 * the bytes on the device. A relaunch inside a check deliberately does not come through here.
 */
export function beginNavigationRestorationTest(): void {
  endNavigationRestorationTest()
  testStorageRestore = setNavigationRestorationStorageForTests(memoryKeyValueStorage())
  for (const controller of controllers) {
    controller.resetForLaunch(false)
  }
}

/** endNavigationRestorationTest hands navigation restoration back to the storage that surrounded the check. */
export function endNavigationRestorationTest(): void {
  testStorageRestore?.()
  testStorageRestore = undefined
}

/**
 * beginNavigationRestorationLaunch ends the running launch and prepares the next one on the same
 * device. Everything the launched instance owned — the memoized load, the subscriptions it wrote
 * through, the coalescing memo — is dropped, and the store is kept, so the next instance genuinely
 * reads back what this one wrote. It settles the pending write first, because the read the next
 * instance performs is not ordered behind a write that is still queued.
 *
 * `fresh` opts the next launch out of restoring, which is the launch a device that has never run
 * this app gives.
 */
export async function beginNavigationRestorationLaunch(options: { fresh?: boolean } = {}): Promise<void> {
  for (const controller of controllers) {
    await controller.settleWrites()
  }
  for (const controller of controllers) {
    controller.resetForLaunch(options.fresh === true)
  }
}

/** subscribeNavigationRestorationDiagnostics is host/tooling-only; Tao applications cannot observe it. */
export function subscribeNavigationRestorationDiagnostics(
  listener: (diagnostic: NavigationRestorationDiagnostic) => void,
): () => void {
  return diagnosticsListeners.subscribe(listener)
}

/** setNavigationRestorationStorageForTests installs an isolated host store and returns a restore function. */
export function setNavigationRestorationStorageForTests(storage: TaoKeyValueStorage | undefined): () => void {
  return storageSlot.install(storage)
}

/** NavigationRestorationController owns one app's load-once and coalesced reducer persistence lifecycle. */
export class NavigationRestorationController {
  private attachCount = 0
  private freshLaunch = false
  /**
   * Which launch the live attachments belong to.
   *
   * A launch reset forgets them all at once, and the hosts that made them detach afterwards on
   * their own schedule. Without this, one of those late detachments decrements a count the reset
   * had already zeroed, and the next launch's attach reads as detached, never subscribes, and
   * quietly persists nothing for the rest of the process.
   */
  private launchGeneration = 0
  private lastSerialized: string | undefined
  private loadPromise: Promise<void> | undefined
  private persistQueue: Promise<void> = Promise.resolve()
  private scheduled = false
  private subscriptions: Array<() => void> = []

  constructor(private readonly app: RestorableApp) {
    controllers.add(this)
  }

  /** dispose drops a controller whose app is gone, so a later launch step no longer visits it. */
  dispose(): void {
    this.unsubscribe()
    controllers.delete(this)
  }

  /**
   * resetForLaunch returns this controller to the state a newly started process is in, without
   * touching the device it reads and writes. Forgetting the memoized load is the point: an app
   * definition lives at generated-module scope, so an instance that already loaded would hand the
   * next launch that same resolved read and never look at the store again.
   */
  resetForLaunch(fresh: boolean): void {
    this.unsubscribe()
    this.launchGeneration += 1
    this.attachCount = 0
    this.freshLaunch = fresh
    this.lastSerialized = undefined
    this.loadPromise = undefined
    this.scheduled = false
    // A write still queued against the previous launch captured its storage when it was queued (see
    // persistSnapshot) and settles there; dropping the chain stops the next launch's writes from
    // waiting behind it.
    this.persistQueue = Promise.resolve()
  }

  /** settleWrites persists the coalesced snapshot now and waits until the device holds it. */
  async settleWrites(): Promise<void> {
    if (this.scheduled) {
      this.scheduled = false
      this.persistSnapshot()
    }
    await this.persistQueue
  }

  /** requiresInitialLoad reports whether the host must hide the initial tree while storage is read. */
  requiresInitialLoad(): boolean {
    return this.policy().mode === 'automatic'
      && this.app.declaration.canonicalIdentity?.canonical !== undefined
  }

  async attach(): Promise<() => void> {
    const generation = this.launchGeneration
    this.attachCount += 1
    await (this.loadPromise ??= this.load())
    if (this.attachCount > 0 && this.subscriptions.length === 0 && this.policy().mode === 'automatic') {
      this.subscribe()
    }
    let active = true
    return () => {
      if (!active || generation !== this.launchGeneration) {
        return
      }
      active = false
      this.attachCount -= 1
      if (this.attachCount === 0) {
        this.unsubscribe()
      }
    }
  }

  lanesChanged(): void {
    if (this.subscriptions.length > 0) {
      this.unsubscribe()
      this.subscribe()
      this.scheduleSnapshot()
    }
  }

  capture(): RestorationEnvelope {
    return this.envelope()
  }

  restoreCapture(envelope: RestorationEnvelope): void {
    this.restore(envelope)
  }

  private async load(): Promise<void> {
    const fresh = this.freshLaunch
    this.freshLaunch = false
    if (this.policy().mode === 'fresh') {
      return
    }
    const key = this.storageKey()
    if (!key) {
      this.report('NAV_RESTORE_UNSUPPORTED', 'The app declaration has no canonical identity; restoration is disabled.')
      return
    }
    if (fresh) {
      // A launch asked to start fresh reads nothing back, and then records where it opened. Leaving
      // the previous instance's position on the device would let a later ordinary launch return to
      // a screen this run never visited, which is the quiet divergence the step exists to remove.
      this.scheduleSnapshot()
      return
    }
    try {
      const serialized = await this.storage().getItem(key)
      if (serialized === null) {
        return
      }
      const envelope = parseEnvelope(serialized)
      this.restore(envelope)
      this.lastSerialized = serialized
    } catch (error) {
      this.app.reset()
      this.report('NAV_RESTORE_FALLBACK', errorMessage(error))
    }
  }

  private subscribe(): void {
    this.subscriptions = [this.app.navigator, ...Object.values(this.app.auxiliaries)]
      .map(navigation => navigation.subscribe(() => this.scheduleSnapshot()))
  }

  private unsubscribe(): void {
    for (const unsubscribe of this.subscriptions.splice(0).toReversed()) {
      unsubscribe()
    }
  }

  private scheduleSnapshot(): void {
    if (this.scheduled || this.policy().mode !== 'automatic') {
      return
    }
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      this.persistSnapshot()
    })
  }

  private persistSnapshot(): void {
    const key = this.storageKey()
    if (!key) {
      return
    }
    let serialized: string
    try {
      serialized = JSON.stringify(this.envelope())
    } catch (error) {
      this.report('NAV_RESTORE_UNSUPPORTED', errorMessage(error))
      this.invalidateStoredSnapshot(key)
      return
    }
    if (serialized === this.lastSerialized) {
      return
    }
    this.lastSerialized = serialized
    // The device this snapshot is for is the one that was installed when it was taken, so it is
    // captured here rather than resolved inside the queued callback. A queued write that resolved
    // storage when it finally ran would land on whatever store the process had by then — the next
    // check's private store, for a write a check left queued behind it.
    const targetStorage = this.storage()
    this.persistQueue = this.persistQueue.then(async () => {
      await targetStorage.setItem(key, serialized)
    }).catch(error => {
      // The device did not take this snapshot, so the memo must stop claiming it did. Otherwise the
      // next identical snapshot — the ordinary case, since a failed write leaves navigation exactly
      // where it was — is skipped as already persisted, and a later launch restores a stale
      // position. Only this write's own memo is dropped: a newer snapshot queued while this one was
      // in flight already owns it, and resurrecting this older value would skip that newer write.
      if (this.lastSerialized === serialized) {
        this.lastSerialized = undefined
      }
      this.report('NAV_RESTORE_FALLBACK', `Could not persist navigation state: ${errorMessage(error)}`)
    })
  }

  private invalidateStoredSnapshot(key: string): void {
    this.lastSerialized = undefined
    // Captured for the same reason the write above captures it: the stale entry being removed is on
    // the device that was installed when it was found stale, not on whichever store is installed by
    // the time the queue reaches this callback.
    const storage = this.storage()
    this.persistQueue = this.persistQueue.then(async () => {
      if (storage.removeItem) {
        await storage.removeItem(key)
        return
      }
      // An intentionally invalid envelope is safer than retaining an older valid snapshot that
      // could resurrect state after a later launch.
      await storage.setItem(key, '{"formatVersion":1,"schemaVersion":1,"payload":null}')
    }).catch(error => {
      this.report('NAV_RESTORE_FALLBACK', `Could not invalidate navigation state: ${errorMessage(error)}`)
    })
  }

  private envelope(): RestorationEnvelope {
    const codec = this.codec()
    const navigator = requireRestorable(this.app.navigator)
    const auxiliaries = Object.fromEntries(
      Object.entries(this.app.auxiliaries).map(([key, navigation]) => [
        key,
        requireRestorable(navigation).navigationRestorationSnapshot(codec, codec.exclusions),
      ]),
    )
    return {
      formatVersion: 1,
      payload: {
        auxiliaries,
        navigator: navigator.navigationRestorationSnapshot(codec, codec.exclusions),
      },
      schemaVersion: 1,
    }
  }

  private restore(envelope: RestorationEnvelope): void {
    const codec = this.codec()
    const auxiliaryNames = Object.keys(this.app.auxiliaries).sort()
    const restoredNames = Object.keys(envelope.payload.auxiliaries).sort()
    RuntimeAssert.input(
      JSON.stringify(auxiliaryNames) === JSON.stringify(restoredNames),
      'Restored app auxiliaries do not match the live app.',
      { auxiliaryNames, restoredNames },
    )
    // Validate and rebuild every lane as one transaction. A failure resets the whole app in load().
    requireRestorable(this.app.navigator).restoreNavigationSnapshot(envelope.payload.navigator, codec)
    for (const [key, navigation] of Object.entries(this.app.auxiliaries)) {
      requireRestorable(navigation).restoreNavigationSnapshot(envelope.payload.auxiliaries[key]!, codec)
    }
  }

  private codec(): TaoNavigationRestorationCodec {
    const exclusions = new Set(this.policy().exclusions)
    return {
      exclusions,
      restorePresentable: snapshot => restorePresentable(snapshot, identity => this.app.resolvePresentable(identity)),
      snapshotPresentable: entry =>
        snapshotPresentable(entry, diagnostic =>
          this.report(
            'NAV_RESTORE_ENTRY_SKIPPED',
            diagnostic,
          )),
    }
  }

  private policy() {
    // A check gets an isolated store rather than a pinned mode: `relaunch` claims to model a real
    // relaunch, and a real relaunch restores, so a check has to observe the policy its own app
    // declares — including an app that declares `Restore fresh` and therefore still starts fresh.
    return this.app.definition.restoration ?? {
      exclusions: [] as const,
      mode: 'automatic' as const,
      variant: this.app.definition.name,
    }
  }

  private storageKey(): string | undefined {
    const identity = this.app.declaration.canonicalIdentity?.canonical
    if (!identity) {
      return undefined
    }
    const policy = this.policy()
    const provider = appProviderIdentity(this.app.definition.datasources?.() ?? [])
    if (provider === undefined) {
      return undefined
    }
    const scope = previewScope === undefined ? '' : `:${encodeURIComponent(previewScope)}`
    return `tao-navigation:${encodeURIComponent(identity)}:${encodeURIComponent(policy.variant)}:${
      encodeURIComponent(provider)
    }${scope}`
  }

  private storage(): TaoKeyValueStorage {
    return storageOverride ?? platformKeyValueStorage()
  }

  private report(code: NavigationRestorationDiagnostic['code'], message: string): void {
    const diagnostic: NavigationRestorationDiagnostic = {
      app: this.app.definition.name,
      code,
      message,
      severity: 'warning',
    }
    diagnosticsListeners.notify(diagnostic)
  }
}

function snapshotPresentable(
  entry: PresentableEntry,
  skipped: (message: string) => void,
): TaoPresentableSnapshot | undefined {
  if (entry.presentable.kind !== 'view') {
    skipped(`Navigation '${entry.presentable.name}' cannot be stored as a presented view.`)
    return undefined
  }
  const identity = entry.presentable.definition.identity?.canonical
  if (!identity) {
    skipped(`View '${entry.presentable.name}' has no canonical identity.`)
    return undefined
  }
  try {
    return {
      arguments: Object.fromEntries(
        Object.entries(entry.arguments).map(([name, value]) => [
          name,
          snapshotValue(value.evaluate().jsValue, new Set()),
        ]),
      ),
      view: identity,
    }
  } catch (error) {
    skipped(`View '${entry.presentable.name}' cannot be restored: ${errorMessage(error)}`)
    return undefined
  }
}

function restorePresentable(
  snapshot: TaoPresentableSnapshot,
  resolve: (canonicalIdentity: string) => TaoPresentable,
): {
  arguments: TaoNavigationArguments
  presentable: TaoPresentable
} {
  if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.view !== 'string') {
    throw new UserInputError('Restored presentation entry is invalid.')
  }
  return {
    arguments: Object.fromEntries(
      Object.entries(snapshot.arguments).map(([name, value]) => [
        name,
        new RuntimeNavigationResult(restoreValue(value)),
      ]),
    ),
    presentable: resolve(snapshot.view),
  }
}

function snapshotValue(value: unknown, seen: Set<object>): TaoPersistedValue {
  if (value === null || value === undefined) {
    return ['none']
  }
  if (typeof value === 'string') {
    return ['text', value]
  }
  if (typeof value === 'boolean') {
    return ['boolean', value]
  }
  if (typeof value === 'number') {
    RuntimeAssert.input(Number.isFinite(value), 'a non-finite number does not serialize')
    return ['number', Object.is(value, -0) ? 0 : value]
  }
  if (typeof value !== 'object') {
    throw new UserInputError(`${typeof value} does not serialize`)
  }
  const reference = entityHandle(value) ? serializeEntityReference(value) : undefined
  if (reference) {
    return ['entity', reference]
  }
  RuntimeAssert.input(!seen.has(value), 'cyclic values do not serialize')
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return ['list', ...value.map(item => snapshotValue(item, seen))]
    }
    RuntimeAssert.input(Object.getPrototypeOf(value) === Object.prototype, 'opaque runtime values do not serialize')
    return [
      'item',
      ...Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, item]) => [name, snapshotValue(item, seen)] as const),
    ]
  } finally {
    seen.delete(value)
  }
}

function restoreValue(value: TaoPersistedValue): unknown {
  if (!Array.isArray(value)) {
    throw new UserInputError('Restored argument is not a tagged value.')
  }
  const [tag, ...payload] = value
  if (tag === 'none' && payload.length === 0) {
    return null
  }
  if (tag === 'text' && payload.length === 1 && typeof payload[0] === 'string') {
    return payload[0]
  }
  if (tag === 'boolean' && payload.length === 1 && typeof payload[0] === 'boolean') {
    return payload[0]
  }
  if (tag === 'number' && payload.length === 1 && typeof payload[0] === 'number' && Number.isFinite(payload[0])) {
    return payload[0]
  }
  if (tag === 'list') {
    return payload.map(item => restoreValue(item as TaoPersistedValue))
  }
  if (tag === 'item') {
    return Object.fromEntries(payload.map(field => {
      if (!Array.isArray(field) || field.length !== 2 || typeof field[0] !== 'string') {
        throw new UserInputError('Restored item field is invalid.')
      }
      return [field[0], restoreValue(field[1] as TaoPersistedValue)]
    }))
  }
  if (tag === 'entity' && payload.length === 1 && payload[0] && typeof payload[0] === 'object') {
    return restoreEntityReference(payload[0] as any)
  }
  throw new UserInputError(`Unknown restored argument tag '${String(tag)}'.`, { tag })
}

function parseEnvelope(serialized: string): RestorationEnvelope {
  const value = JSON.parse(serialized) as Partial<RestorationEnvelope>
  if (!value || typeof value !== 'object' || value.formatVersion !== 1) {
    throw new UserInputError(`Unsupported navigation restoration format '${String(value?.formatVersion)}'.`)
  }
  RuntimeAssert.input(
    value.schemaVersion === 1,
    `Navigation restoration schema ${String(value.schemaVersion)} does not match 1.`,
  )
  RuntimeAssert.input(
    value.payload && typeof value.payload === 'object',
    'Navigation restoration payload is invalid.',
  )
  return value as RestorationEnvelope
}

function requireRestorable(navigation: TaoNavigationValue): RestorableNavigation {
  const candidate = navigation as Partial<RestorableNavigation>
  if (
    typeof candidate.navigationRestorationSnapshot !== 'function'
    || typeof candidate.restoreNavigationSnapshot !== 'function'
  ) {
    throw new UnexpectedBehaviorError(`Navigation kind '${navigation.name}' lacks restoration capability.`, {
      details: { navigation: navigation.name },
    })
  }
  return navigation as RestorableNavigation
}

/**
 * Scopes persisted navigation to one Studio preview cell, or clears the scoping with `undefined`.
 *
 * Set by the Studio device host when a cell is assigned. A shipped app never calls this and keeps
 * the unscoped key it has always had.
 */
export function setNavigationPreviewScope(scope: string | undefined): void {
  previewScope = scope
}

/**
 * Starts the next Studio preview cell on the same device, as its own launch.
 *
 * Scoping the stored position per cell was necessary and not sufficient: an app definition lives at
 * generated-module scope, so its mounted navigation and its memoized load both outlive the cell
 * that produced them. The next cell then opened on the previous cell's stack — holding entity
 * handles from a provider generation its own fixture had just replaced. Those screens re-offer
 * their queries on every revision and every offer throws, which is the loop that left the phone
 * frozen with a blank screen and a Back button.
 *
 * Combined with the caller's own reset of mounted navigation, this makes each cell read the store
 * back for itself, exactly as a relaunch would.
 */
export function beginNavigationPreviewCell(scope: string | undefined): void {
  for (const controller of controllers) {
    controller.resetForLaunch(false)
  }
  previewScope = scope
}
