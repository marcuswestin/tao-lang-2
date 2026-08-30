import type { TaoKeyValueStorage } from './TR-data'
import { entityHandle } from './TR-data-entity'
import { platformKeyValueStorage } from './TR-data-provider'
import { restoreEntityReference, serializeEntityReference } from './TR-data-registry'
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

type RestorationEnvelope = Readonly<{
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

const diagnosticsListeners = new Set<(diagnostic: NavigationRestorationDiagnostic) => void>()
let storageOverride: TaoKeyValueStorage | undefined
let restorationTestMode = false

export function beginNavigationRestorationTest(): void {
  restorationTestMode = true
}

export function endNavigationRestorationTest(): void {
  restorationTestMode = false
}

/** subscribeNavigationRestorationDiagnostics is host/tooling-only; Tao applications cannot observe it. */
export function subscribeNavigationRestorationDiagnostics(
  listener: (diagnostic: NavigationRestorationDiagnostic) => void,
): () => void {
  diagnosticsListeners.add(listener)
  return () => diagnosticsListeners.delete(listener)
}

/** setNavigationRestorationStorageForTests installs an isolated host store and returns a restore function. */
export function setNavigationRestorationStorageForTests(storage: TaoKeyValueStorage | undefined): () => void {
  const previous = storageOverride
  storageOverride = storage
  return () => {
    storageOverride = previous
  }
}

/** NavigationRestorationController owns one app's load-once and coalesced reducer persistence lifecycle. */
export class NavigationRestorationController {
  private attachCount = 0
  private lastSerialized: string | undefined
  private loadPromise: Promise<void> | undefined
  private persistQueue: Promise<void> = Promise.resolve()
  private scheduled = false
  private subscriptions: Array<() => void> = []

  constructor(private readonly app: RestorableApp) {}

  /** requiresInitialLoad reports whether the host must hide the initial tree while storage is read. */
  requiresInitialLoad(): boolean {
    return this.policy().mode === 'automatic'
      && this.app.declaration.canonicalIdentity?.canonical !== undefined
  }

  async attach(): Promise<() => void> {
    this.attachCount += 1
    await (this.loadPromise ??= this.load())
    if (this.attachCount > 0 && this.subscriptions.length === 0 && this.policy().mode === 'automatic') {
      this.subscribe()
    }
    let active = true
    return () => {
      if (!active) {
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

  private async load(): Promise<void> {
    if (this.policy().mode === 'fresh') {
      return
    }
    const key = this.storageKey()
    if (!key) {
      this.report('NAV_RESTORE_UNSUPPORTED', 'The app declaration has no canonical identity; restoration is disabled.')
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
    this.persistQueue = this.persistQueue.then(async () => {
      await this.storage().setItem(key, serialized)
    }).catch(error => {
      this.report('NAV_RESTORE_FALLBACK', `Could not persist navigation state: ${errorMessage(error)}`)
    })
  }

  private invalidateStoredSnapshot(key: string): void {
    this.lastSerialized = undefined
    this.persistQueue = this.persistQueue.then(async () => {
      const storage = this.storage()
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
    if (JSON.stringify(auxiliaryNames) !== JSON.stringify(restoredNames)) {
      throw new Error('Restored app auxiliaries do not match the live app.')
    }
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
    if (restorationTestMode) {
      return {
        exclusions: [] as const,
        mode: 'fresh' as const,
        variant: this.app.definition.name,
      }
    }
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
    const provider = policy.providerIdentity ? policy.providerIdentity() : 'none'
    if (provider === undefined) {
      return undefined
    }
    return `tao-navigation:${encodeURIComponent(identity)}:${encodeURIComponent(policy.variant)}:${
      encodeURIComponent(provider)
    }`
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
    for (const listener of diagnosticsListeners) {
      listener(diagnostic)
    }
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
    throw new Error('Restored presentation entry is invalid.')
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
    if (!Number.isFinite(value)) {
      throw new Error('a non-finite number does not serialize')
    }
    return ['number', Object.is(value, -0) ? 0 : value]
  }
  if (typeof value !== 'object') {
    throw new Error(`${typeof value} does not serialize`)
  }
  const reference = entityHandle(value) ? serializeEntityReference(value) : undefined
  if (reference) {
    return ['entity', reference]
  }
  if (seen.has(value)) {
    throw new Error('cyclic values do not serialize')
  }
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return ['list', ...value.map(item => snapshotValue(item, seen))]
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new Error('opaque runtime values do not serialize')
    }
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
    throw new Error('Restored argument is not a tagged value.')
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
        throw new Error('Restored item field is invalid.')
      }
      return [field[0], restoreValue(field[1] as TaoPersistedValue)]
    }))
  }
  if (tag === 'entity' && payload.length === 1 && payload[0] && typeof payload[0] === 'object') {
    return restoreEntityReference(payload[0] as any)
  }
  throw new Error(`Unknown restored argument tag '${String(tag)}'.`)
}

function parseEnvelope(serialized: string): RestorationEnvelope {
  const value = JSON.parse(serialized) as Partial<RestorationEnvelope>
  if (!value || typeof value !== 'object' || value.formatVersion !== 1) {
    throw new Error(`Unsupported navigation restoration format '${String(value?.formatVersion)}'.`)
  }
  if (value.schemaVersion !== 1) {
    throw new Error(`Navigation restoration schema ${String(value.schemaVersion)} does not match 1.`)
  }
  if (!value.payload || typeof value.payload !== 'object') {
    throw new Error('Navigation restoration payload is invalid.')
  }
  return value as RestorationEnvelope
}

function requireRestorable(navigation: TaoNavigationValue): RestorableNavigation {
  const candidate = navigation as Partial<RestorableNavigation>
  if (
    typeof candidate.navigationRestorationSnapshot !== 'function'
    || typeof candidate.restoreNavigationSnapshot !== 'function'
  ) {
    throw new Error(`Navigation kind '${navigation.name}' lacks restoration capability.`)
  }
  return navigation as RestorableNavigation
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
