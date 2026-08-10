import React from 'react'
import { runtimeValue } from './TR-value'

/** TaoFieldKind declares the storable kinds a Tao data field can hold. */
export type TaoFieldKind = 'text' | 'number' | 'boolean' | 'time' | 'reference'

/** TaoFieldSchema declares one entity field's storage shape. */
export type TaoFieldSchema = {
  name: string
  kind: TaoFieldKind
  indexed?: boolean
  defaultValue?: unknown | 'now'
}

/** TaoEntitySchema declares one entity and the collection that stores it. */
export type TaoEntitySchema = {
  name: string
  collection: string
  fields: readonly TaoFieldSchema[]
}

/** TaoDataSchema declares a Tao data declaration's collections. */
export type TaoDataSchema = {
  name: string
  entities: readonly TaoEntitySchema[]
}

/** TaoRow declares one stored entity row; every row carries a generated `Id`. */
export type TaoRow = Record<string, unknown> & { Id: string }

/** TaoSnapshot declares stored rows keyed by collection name. */
export type TaoSnapshot = Record<string, TaoRow[]>

/** TaoDataStatus declares whether a store is still loading or failed to load. */
export type TaoDataStatus = { loading: boolean; failed: boolean }

/**
 * TaoDataProvider is the whole boundary between Tao's data semantics and storage: a provider loads
 * one starting snapshot and is told about each committed change. Everything else — defaults,
 * identifiers, query evaluation, reactivity — stays in the runtime so every provider behaves alike.
 */
export type TaoDataProvider = {
  name: string
  load(schema: TaoDataSchema): Promise<TaoSnapshot> | TaoSnapshot
  save?(schema: TaoDataSchema, snapshot: TaoSnapshot): void | Promise<void>
}

/** TaoQuerySpec declares one query's filter and ordering over a collection. */
export type TaoQuerySpec = {
  collection: string
  where?: (row: TaoRow) => boolean
  orderField?: string
  orderDirection?: 'asc' | 'desc'
}

/** TaoDataStore holds one data declaration's rows, status, and subscribers. */
export type TaoDataStore = {
  schema: TaoDataSchema
  snapshot(): TaoSnapshot
  status(): TaoDataStatus
  subscribe(listener: () => void): () => void
  revision(): number
  configure(provider: TaoDataProvider): void
  create(entityName: string, values: Record<string, unknown>): TaoRow
  update(entityName: string, id: string, values: Record<string, unknown>): void
  remove(entityName: string, id: string): void
  query(spec: TaoQuerySpec): TaoRow[]
}

type StoreState = {
  provider: TaoDataProvider
  snapshot: TaoSnapshot
  status: TaoDataStatus
  listeners: Set<() => void>
  revision: number
}

let idCounter = 0

// Any store change also bumps one global revision, so screens holding an entity value re-render
// when that entity changes even though they run no query of their own.
const globalListeners = new Set<() => void>()
let globalRevision = 0

/** subscribeAll notifies a listener whenever any Tao data store commits a change. */
export function subscribeAll(listener: () => void): () => void {
  globalListeners.add(listener)
  return () => globalListeners.delete(listener)
}

/** revision returns the current global data revision. */
export function revision(): number {
  return globalRevision
}

function notifyAll(): void {
  globalRevision += 1
  for (const listener of globalListeners) {
    listener()
  }
}

/** MemoryProvider stores rows for the current process only; it is the deterministic test default. */
export function MemoryProvider(initial: TaoSnapshot = {}): TaoDataProvider {
  let stored = cloneSnapshot(initial)
  return {
    name: 'Memory',
    load: () => cloneSnapshot(stored),
    save: (_schema, snapshot) => {
      stored = cloneSnapshot(snapshot)
    },
  }
}

/**
 * LocalProvider keeps rows on the device through AsyncStorage, the standard React Native key-value
 * store: it needs no credentials, works in Expo Go and on web, and ships an official Jest mock.
 */
export function LocalProvider(key = 'tao-data', storage?: TaoKeyValueStorage): TaoDataProvider {
  const store = (): TaoKeyValueStorage => storage ?? asyncStorage()
  return {
    name: 'Local',
    load: async schema => {
      const stored = await store().getItem(`${key}:${schema.name}`)
      return stored ? (JSON.parse(stored) as TaoSnapshot) : {}
    },
    save: async (schema, snapshot) => {
      await store().setItem(`${key}:${schema.name}`, JSON.stringify(snapshot))
    },
  }
}

/** TaoKeyValueStorage is the device key-value surface LocalProvider persists through. */
export type TaoKeyValueStorage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

type AsyncStorageModule = TaoKeyValueStorage

function asyncStorage(): AsyncStorageModule {
  const required = require('@react-native-async-storage/async-storage') as
    | AsyncStorageModule
    | { default: AsyncStorageModule }
  return 'default' in required ? required.default : required
}

/** LoadingProvider never resolves, so tests can assert an app's loading surface. */
export function LoadingProvider(): TaoDataProvider {
  return {
    name: 'Loading',
    load: () => new Promise<TaoSnapshot>(() => {}),
  }
}

/** FailingProvider rejects its load, so tests can assert an app's provider-error surface. */
export function FailingProvider(): TaoDataProvider {
  return {
    name: 'Failing',
    load: () => Promise.reject(new Error('Tao test data provider failed')),
  }
}

/** define creates the runtime store for one Tao data declaration. */
export function define(schema: TaoDataSchema): TaoDataStore {
  const state: StoreState = {
    provider: MemoryProvider(),
    snapshot: emptySnapshot(schema),
    status: { loading: false, failed: false },
    listeners: new Set(),
    revision: 0,
  }

  const notify = (): void => {
    state.revision += 1
    for (const listener of state.listeners) {
      listener()
    }
    notifyAll()
  }

  const commit = (): void => {
    void state.provider.save?.(schema, state.snapshot)
    notify()
  }

  const store: TaoDataStore = {
    schema,
    snapshot: () => state.snapshot,
    status: () => state.status,
    revision: () => state.revision,
    subscribe: listener => {
      state.listeners.add(listener)
      return () => state.listeners.delete(listener)
    },
    configure: provider => {
      state.provider = provider
      state.snapshot = emptySnapshot(schema)
      state.status = { loading: true, failed: false }
      const loaded = provider.load(schema)
      if (isPromise(loaded)) {
        loaded.then(
          snapshot => {
            state.snapshot = withEmptyCollections(schema, snapshot)
            state.status = { loading: false, failed: false }
            notify()
          },
          () => {
            state.status = { loading: false, failed: true }
            notify()
          },
        )
        notify()
        return
      }
      state.snapshot = withEmptyCollections(schema, loaded)
      state.status = { loading: false, failed: false }
      notify()
    },
    create: (entityName, values) => {
      const entity = entitySchema(schema, entityName)
      const row = { ...defaultRow(entity), ...values, Id: nextId(entityName) } as TaoRow
      state.snapshot = {
        ...state.snapshot,
        [entity.collection]: [...(state.snapshot[entity.collection] ?? []), row],
      }
      commit()
      return row
    },
    update: (entityName, id, values) => {
      const entity = entitySchema(schema, entityName)
      // An entity value is a reference, so an update writes into the existing row rather than
      // replacing it; a screen already holding that row keeps seeing the current values.
      state.snapshot = {
        ...state.snapshot,
        [entity.collection]: (state.snapshot[entity.collection] ?? []).map(row =>
          row.Id === id ? Object.assign(row, values, { Id: row.Id }) : row
        ),
      }
      commit()
    },
    remove: (entityName, id) => {
      const entity = entitySchema(schema, entityName)
      state.snapshot = {
        ...state.snapshot,
        [entity.collection]: (state.snapshot[entity.collection] ?? []).filter(row => row.Id !== id),
      }
      commit()
    },
    query: spec => evaluateQuery(state.snapshot[spec.collection] ?? [], spec),
  }
  return store
}

/**
 * useQuery subscribes a rendering view to one query's rows. The rows array also carries the store's
 * `Loading` and `Failed` status, so a query value answers both "what rows" and "is it ready".
 */
export function useQuery(store: TaoDataStore, spec: TaoQuerySpec): ReturnType<typeof runtimeValue<TaoRow[]>> {
  // Results are cached per rendering view, keyed by the store's revision: two views running the
  // same query with different captured values must not share one result.
  const storeRevision = useStoreRevision(store)
  const cache = React.useRef<{ revision: number; rows: TaoRow[] } | undefined>(undefined)
  if (!cache.current || cache.current.revision !== storeRevision) {
    cache.current = { revision: storeRevision, rows: withStatus(store.query(spec), store.status()) }
  }
  return runtimeValue(cache.current.rows)
}

function withStatus(rows: TaoRow[], status: TaoDataStatus): TaoRow[] {
  return Object.defineProperties(rows, {
    Loading: { value: status.loading, enumerable: false },
    Failed: { value: status.failed, enumerable: false },
  })
}

/** useStatus subscribes a rendering view to the store's load status. */
export function useStatus(store: TaoDataStore): TaoDataStatus {
  useStoreRevision(store)
  return store.status()
}

let testProviderKind: 'memory' | 'loading' | 'failing' | undefined

/**
 * setTestProvider makes Tao tests deterministic: every checked app loads through a fresh in-memory
 * provider, or through the loading/failing providers a check asks for. Cleared between checks.
 */
export function setTestProvider(kind: 'memory' | 'loading' | 'failing' | undefined): void {
  testProviderKind = kind
}

/** useConfigure attaches a provider to a store once per app mount. */
export function useConfigure(store: TaoDataStore, provider: TaoDataProvider): void {
  const configured = React.useRef(false)
  if (!configured.current) {
    configured.current = true
    store.configure(testProvider() ?? provider)
  }
}

function testProvider(): TaoDataProvider | undefined {
  if (testProviderKind === 'memory') {
    return MemoryProvider()
  }
  if (testProviderKind === 'loading') {
    return LoadingProvider()
  }
  return testProviderKind === 'failing' ? FailingProvider() : undefined
}

function useStoreRevision(store: TaoDataStore): number {
  return React.useSyncExternalStore(
    listener => store.subscribe(listener),
    () => store.revision(),
    () => store.revision(),
  )
}

function evaluateQuery(rows: readonly TaoRow[], spec: TaoQuerySpec): TaoRow[] {
  const filtered = spec.where ? rows.filter(spec.where) : [...rows]
  if (!spec.orderField) {
    return filtered
  }
  const field = spec.orderField
  const descending = spec.orderDirection === 'desc'
  return filtered.sort((left, right) => compareValues(left[field], right[field]) * (descending ? -1 : 1))
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right
  }
  return String(left ?? '').localeCompare(String(right ?? ''))
}

function defaultRow(entity: TaoEntitySchema): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const field of entity.fields) {
    row[field.name] = field.defaultValue === 'now' ? Date.now() : field.defaultValue ?? emptyValue(field.kind)
  }
  return row
}

function emptyValue(kind: TaoFieldKind): unknown {
  if (kind === 'number' || kind === 'time') {
    return 0
  }
  if (kind === 'boolean') {
    return false
  }
  return ''
}

function entitySchema(schema: TaoDataSchema, entityName: string): TaoEntitySchema {
  const entity = schema.entities.find(candidate => candidate.name === entityName)
  if (!entity) {
    throw new Error(`Tao data schema '${schema.name}' has no entity '${entityName}'.`)
  }
  return entity
}

function emptySnapshot(schema: TaoDataSchema): TaoSnapshot {
  return Object.fromEntries(schema.entities.map(entity => [entity.collection, []]))
}

function withEmptyCollections(schema: TaoDataSchema, snapshot: TaoSnapshot): TaoSnapshot {
  return { ...emptySnapshot(schema), ...cloneSnapshot(snapshot) }
}

function cloneSnapshot(snapshot: TaoSnapshot): TaoSnapshot {
  return Object.fromEntries(Object.entries(snapshot).map(([collection, rows]) => [collection, [...rows]]))
}

function nextId(entityName: string): string {
  idCounter += 1
  return `${entityName.toLowerCase()}-${idCounter}`
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>).then === 'function'
}

/** DataControls exposes the generated-code data runtime surface. */
export const DataControls = {
  define,
  FailingProvider,
  LoadingProvider,
  LocalProvider,
  MemoryProvider,
  revision,
  setTestProvider,
  subscribeAll,
  useConfigure,
  useQuery,
  useStatus,
} as const
