import React from 'react'

type DataStatus = 'error' | 'loading' | 'ready'
type DataPrimitive = 'boolean' | 'number' | 'text' | 'time'
type RelationDeleteBehavior = 'cascade' | 'restrict'

/** TaoEntityAvailability is the provider-neutral live state of one entity handle. */
export type TaoEntityAvailability =
  | { status: 'available' | 'loading' | 'missing' | 'unauthorized' }
  | { message: string; status: 'error' }

export type TaoDataField = {
  defaultNow?: true
  defaultValue?: boolean | number | string
  indexed?: boolean
  kind: DataPrimitive | 'relation'
  onDelete?: RelationDeleteBehavior
  relation?: string
}

export type TaoDataEntity = {
  collection: string
  defaultOrder?: {
    direction: 'asc' | 'desc'
    field: string
  }
  fields: Record<string, TaoDataField>
  inverseFields?: Record<string, { inverseField: string; relation: string }>
}

export type TaoDataSchemaDefinition = {
  entities: Record<string, TaoDataEntity>
  name: string
  schemaVersion?: number
}

export type TaoQueryFilter = {
  field: string
  operator: '!=' | '<' | '<=' | '==' | '>' | '>='
  value: () => Evaluable
}

export type TaoQueryPlan = {
  entity: string
  filters: TaoQueryFilter[]
  order?: {
    direction: 'asc' | 'desc'
    field: string
  }
}

export type TaoDataProvider = {
  load(storageKey: string): Promise<string | undefined> | string | undefined
  persist(storageKey: string, snapshot: string): Promise<void> | void
}

export type TaoDataProviderFactory = () => TaoDataProvider

/** TaoDatasourceDeclaration binds one immutable Tao declaration identity to its injected provider. */
export type TaoDatasourceDeclaration = Readonly<{
  identity: symbol
  name: string
  provider: TaoDataProvider
}>

export type TaoDatasourceConfiguration = Readonly<Record<string, unknown>>

/** TaoConfiguredDatasource is an immutable declaration-owned provider configuration. */
export type TaoConfiguredDatasource = Readonly<{
  config: TaoDatasourceConfiguration
  declaration: TaoDatasourceDeclaration
  evaluate(): TaoConfiguredDatasource
}>

export type TaoKeyValueStorage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

type Evaluable = {
  evaluate(): { jsValue: unknown }
}

type RuntimeValueFactory = <T>(value: T) => Evaluable
type StoredRow = Record<string, unknown> & { Id: string }
type StoredData = {
  nextId: number
  rows: Record<string, StoredRow[]>
}

type PersistedEnvelope = {
  formatVersion: 1
  nextId: number
  rows: Record<string, StoredRow[]>
  schemaVersion: number
}

type DeleteTarget = { entity: string; id: string }

const persistedFormatVersion = 1
let testMode = false
const schemas = new Set<RuntimeDataSchema>()
const activeTestSchemas = new Set<RuntimeDataSchema>()
const globalListeners = new Set<() => void>()
let globalRevision = 0

/** MemoryProvider creates one isolated, storage-keyed provider whose envelopes live only in this process. */
function MemoryProvider(initial?: string): TaoDataProvider {
  const stored = new Map<string, string>()
  let initialStorageKey: string | undefined

  const initialize = (storageKey: string): void => {
    if (initial !== undefined && initialStorageKey === undefined) {
      initialStorageKey = storageKey
      stored.set(storageKey, initial)
    }
  }

  return {
    load: storageKey => {
      initialize(storageKey)
      return stored.get(storageKey)
    },
    persist: (storageKey, value) => {
      initialize(storageKey)
      stored.set(storageKey, value)
    },
  }
}

/** LocalProvider persists envelopes through AsyncStorage without silently degrading to memory. */
function LocalProvider(storage?: TaoKeyValueStorage, keyPrefix = 'tao-data'): TaoDataProvider {
  const keyValueStorage = (): TaoKeyValueStorage => storage ?? asyncStorage()
  return {
    load: async storageKey => (await keyValueStorage().getItem(`${keyPrefix}:${storageKey}`)) ?? undefined,
    persist: async (storageKey, value) => {
      await keyValueStorage().setItem(`${keyPrefix}:${storageKey}`, value)
    },
  }
}

/** DataProviderControls is the published injection API for shipped data-provider implementations. */
export const DataProviderControls = {
  Local: LocalProvider,
  Memory: MemoryProvider,
} as const

/**
 * testProvider checks the full-snapshot provider protocol without importing a test runner.
 * A rejecting factory is explicit so the suite proves failures cross the real provider boundary.
 */
export async function testProvider(
  createProvider: TaoDataProviderFactory,
  createRejectingProvider: TaoDataProviderFactory,
): Promise<void> {
  const run = ++providerConformanceRun
  const key = (name: string): string => `tao-provider-conformance-${run}-${name}`
  const provider = createProvider()

  assertProviderConformance(
    await provider.load(key('empty')) === undefined,
    'load must return undefined for an empty storage key.',
  )

  const roundTripSnapshot = '{"snapshot":"round-trip"}'
  await provider.persist(key('round-trip'), roundTripSnapshot)
  assertProviderConformance(
    await provider.load(key('round-trip')) === roundTripSnapshot,
    'persisted snapshots must round-trip exactly.',
  )

  const firstKey = key('first-schema')
  const secondKey = key('second-schema')
  await provider.persist(firstKey, '{"schema":"first"}')
  await provider.persist(secondKey, '{"schema":"second"}')
  assertProviderConformance(
    await provider.load(firstKey) === '{"schema":"first"}'
      && await provider.load(secondKey) === '{"schema":"second"}',
    'storage keys must remain isolated.',
  )

  const orderedKey = key('ordered')
  await provider.persist(orderedKey, '{"sequence":1}')
  await provider.persist(orderedKey, '{"sequence":2}')
  assertProviderConformance(
    await provider.load(orderedKey) === '{"sequence":2}',
    'later full snapshots must replace earlier snapshots in call order.',
  )

  const firstInstance = createProvider()
  const secondInstance = createProvider()
  const instanceKey = key('instance')
  await firstInstance.persist(instanceKey, '{"instance":"first"}')
  const secondStart = await secondInstance.load(instanceKey)
  assertProviderConformance(
    secondStart === undefined || secondStart === '{"instance":"first"}',
    'provider instances must be isolated or share one stateless storage boundary.',
  )
  await secondInstance.persist(instanceKey, '{"instance":"second"}')
  assertProviderConformance(
    await firstInstance.load(instanceKey) === (
      secondStart === undefined ? '{"instance":"first"}' : '{"instance":"second"}'
    ),
    'provider instances must not partially share state.',
  )

  let rejected = false
  try {
    await createRejectingProvider().persist(key('rejection'), '{"snapshot":"rejected"}')
  } catch {
    rejected = true
  }
  assertProviderConformance(rejected, 'persist must propagate storage rejection.')
}

let providerConformanceRun = 0

function assertProviderConformance(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`DataProvider conformance failed: ${message}`)
  }
}

function UnboundProvider(schemaName: string): TaoDataProvider {
  const message = `Data schema '${schemaName}' has no bound provider.`
  return {
    load: () => {
      throw new Error(message)
    },
    persist: () => {
      throw new Error(message)
    },
  }
}

function useConfiguredProviderBinding(schema: RuntimeDataSchema, source: TaoConfiguredDatasource): void {
  const storageKey = configuredStorageKey(source)
  React.useLayoutEffect(() => {
    DataControls.BindConfigured(schema, source.declaration, storageKey)
  }, [schema, source.declaration, storageKey])
}

function configuredStorageKey(source: TaoConfiguredDatasource): string | undefined {
  const configured = source.config['StorageKey']
  if (configured === undefined) {
    return undefined
  }
  if (!isEvaluable(configured)) {
    throw new Error(`Datasource ${source.declaration.name} configuration 'StorageKey' expects text.`)
  }
  const value = configured.evaluate().jsValue
  if (typeof value !== 'string') {
    throw new Error(`Datasource ${source.declaration.name} configuration 'StorageKey' expects text.`)
  }
  return value
}

function isEvaluable(value: unknown): value is Evaluable {
  return typeof value === 'object' && value !== null && 'evaluate' in value
    && typeof value.evaluate === 'function'
}

/** DataControls is the provider-neutral generated-code API for Tao schemas, queries, and writes. */
export const DataControls = {
  /** Declaration binds one Tao declaration identity to its package-scope provider implementation. */
  Declaration(name: string, provider: TaoDataProvider): TaoDatasourceDeclaration {
    return Object.freeze({ identity: Symbol(name), name, provider })
  },

  /** Configure creates an immutable declaration-owned datasource value. */
  Configure(
    declaration: TaoDatasourceDeclaration,
    config: Record<string, unknown>,
  ): TaoConfiguredDatasource {
    let configured: TaoConfiguredDatasource
    configured = Object.freeze({
      config: Object.freeze({ ...config }),
      declaration,
      evaluate: () => configured,
    })
    return configured
  },

  /** Patch creates an immutable configured copy without changing its declaration identity. */
  Patch(base: TaoConfiguredDatasource, patch: Record<string, unknown>): TaoConfiguredDatasource {
    return DataControls.Configure(base.declaration, { ...base.config, ...patch })
  },

  Schema(
    definition: TaoDataSchemaDefinition,
    provider?: TaoDataProvider,
    providerStorageKey?: string,
  ): RuntimeDataSchema {
    const selectedProvider = provider
      ?? (testMode ? MemoryProvider() : UnboundProvider(definition.name))
    const schema = new RuntimeDataSchema(
      definition,
      selectedProvider,
      testMode ? 'test' : provider ? undefined : 'unbound',
      providerStorageKey,
    )
    schemas.add(schema)
    return schema
  },

  /** BindConfigured selects a declaration-owned provider while preserving test isolation. */
  BindConfigured(
    schema: RuntimeDataSchema,
    declaration: TaoDatasourceDeclaration,
    storageKey?: string,
  ): void {
    if (testMode) {
      activeTestSchemas.add(schema)
      return
    }
    schema.bindConfigured(declaration, storageKey)
  },

  /** UseConfigured binds a declaration-owned datasource configuration at an app root. */
  UseConfigured: useConfiguredProviderBinding,

  Query(schema: RuntimeDataSchema, plan: TaoQueryPlan, value: RuntimeValueFactory): Evaluable {
    React.useSyncExternalStore(schema.subscribe, schema.snapshot, schema.snapshot)
    return value(schema.query(plan))
  },

  Create(schema: RuntimeDataSchema, entity: string, fields: Record<string, Evaluable>): void {
    schema.create(entity, evaluatedFields(fields))
  },

  Update(row: Evaluable, fields: Record<string, Evaluable>): void {
    const handle = entityHandle(row.evaluate().jsValue)
    if (!handle) {
      throw new Error('Data update expects an entity handle.')
    }
    metadataOf(handle).schema.update(handle, evaluatedFields(fields))
  },

  Delete(row: Evaluable): void {
    const handle = entityHandle(row.evaluate().jsValue)
    if (!handle) {
      throw new Error('Data delete expects an entity handle.')
    }
    metadataOf(handle).schema.delete(handle)
  },

  /** Read returns a handle's current member value, or undefined when it is not a data handle. */
  Read(value: unknown, member: string): unknown {
    const handle = entityHandle(value)
    return handle ? metadataOf(handle).schema.read(handle, member) : undefined
  },

  /** IsEntityHandle lets the TR facade delegate member reads without importing runtime implementation types. */
  IsEntityHandle(value: unknown): boolean {
    return entityHandle(value) !== undefined
  },

  /** EntityAvailability derives the exceptional guard state of a live entity handle. */
  EntityAvailability(value: unknown): TaoEntityAvailability | undefined {
    const handle = entityHandle(value)
    return handle ? metadataOf(handle).schema.availability(handle) : undefined
  },

  /** Settle waits for the active provider load and every save enqueued before this call. */
  async Settle(schema: RuntimeDataSchema): Promise<void> {
    await schema.settle()
  },

  /** subscribeAll is the app/navigation seam for rerendering entity-valued screens after data changes. */
  subscribeAll(listener: () => void): () => void {
    globalListeners.add(listener)
    return () => globalListeners.delete(listener)
  },

  /** revision returns the global data revision used with subscribeAll. */
  revision(): number {
    return globalRevision
  },

  /** beginTest isolates every schema behind a fresh in-memory provider for one Tao check. */
  beginTest(): void {
    testMode = true
    activeTestSchemas.clear()
    for (const schema of schemas) {
      schema.configure(MemoryProvider(), 'test')
    }
  },

  /** endTest restores normal schema creation after a Tao check. */
  endTest(): void {
    testMode = false
    activeTestSchemas.clear()
  },

  /** setTestStatus drives deterministic query loading and provider-error behavior in Tao tests. */
  setTestStatus(status: DataStatus, message = ''): void {
    if (activeTestSchemas.size === 0) {
      throw new Error('A `data` step requires the running app to declare a Datasource.')
    }
    for (const schema of activeTestSchemas) {
      schema.setStatus(status, message)
    }
  },
} as const

export type TaoDataSchema = RuntimeDataSchema

type RuntimeEntityMetadata = {
  entity: string
  generation: number
  id: string
  schema: RuntimeDataSchema
}

const runtimeEntityMetadata = new WeakMap<RuntimeEntityHandle, RuntimeEntityMetadata>()

class RuntimeEntityHandle {
  constructor(
    schema: RuntimeDataSchema,
    entity: string,
    id: string,
    generation: number,
  ) {
    runtimeEntityMetadata.set(this, { entity, generation, id, schema })
    Object.defineProperty(this, 'Id', { enumerable: true, get: () => id })
    const definition = schema.definition.entities[entity]
    const fields = { ...(definition?.fields ?? {}), ...(definition?.inverseFields ?? {}) }
    for (const name of Object.keys(fields)) {
      Object.defineProperty(this, name, {
        enumerable: true,
        get: () => schema.read(this, name),
      })
    }
  }
}

class RuntimeDataSchema {
  readonly name: string
  private data: StoredData
  private error = ''
  private failedSaveSequence: number | undefined
  private generation = 0
  private handles = new Map<string, RuntimeEntityHandle>()
  private listeners = new Set<() => void>()
  private loadPromise: Promise<void> = Promise.resolve()
  private nextSaveSequence = 0
  private provider: TaoDataProvider
  private providerBinding: TaoDatasourceDeclaration | 'test' | 'unbound' | undefined
  private storageKeyBinding: string | undefined
  private saveQueue: Promise<void> = Promise.resolve()
  private status: DataStatus = 'loading'
  private version = 0

  constructor(
    readonly definition: TaoDataSchemaDefinition,
    provider: TaoDataProvider,
    providerBinding?: TaoDatasourceDeclaration | 'test' | 'unbound',
    storageKeyBinding?: string,
  ) {
    validateDefinition(definition)
    this.name = definition.name
    this.provider = provider
    this.providerBinding = providerBinding
    this.storageKeyBinding = storageKeyBinding
    this.data = emptyData(definition)
    this.configure(provider, providerBinding)
  }

  readonly subscribe = (listener: () => void): () => void => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly snapshot = (): number => this.version

  bindConfigured(declaration: TaoDatasourceDeclaration, storageKey?: string): void {
    if (this.providerBinding === declaration && this.storageKeyBinding === storageKey) {
      return
    }
    this.storageKeyBinding = storageKey
    this.configure(declaration.provider, declaration)
  }

  configure(
    provider: TaoDataProvider,
    providerBinding?: TaoDatasourceDeclaration | 'test' | 'unbound',
  ): void {
    const generation = ++this.generation
    this.provider = provider
    this.providerBinding = providerBinding
    this.data = emptyData(this.definition)
    this.handles.clear()
    this.error = ''
    this.status = 'loading'
    this.failedSaveSequence = undefined
    this.nextSaveSequence = 0
    this.saveQueue = Promise.resolve()
    this.emit()

    try {
      const loaded = provider.load(this.storageKey())
      if (isPromise(loaded)) {
        this.loadPromise = loaded.then(
          value => this.finishLoad(generation, value),
          error => this.failLoad(generation, error),
        )
        return
      }
      this.finishLoad(generation, loaded)
      this.loadPromise = Promise.resolve()
    } catch (error) {
      this.failLoad(generation, error)
      this.loadPromise = Promise.resolve()
    }
  }

  query(plan: TaoQueryPlan): unknown[] {
    const entity = this.requireEntity(plan.entity)
    const filters = plan.filters.map(filter => ({
      filter,
      expected: queryFilterValue(plan.entity, entity, filter, this),
    }))
    const source = this.data.rows[plan.entity] ?? []
    const rows = source
      .filter(row => filters.every(({ filter, expected }) => matchesFilter(row, filter, expected)))
      .map(row => this.handle(plan.entity, row.Id))
    const order = plan.order ?? entity.defaultOrder
    if (order) {
      const multiplier = order.direction === 'desc' ? -1 : 1
      rows.sort((left, right) => compare(this.read(left, order.field), this.read(right, order.field)) * multiplier)
    }
    Object.defineProperties(rows, {
      Loading: { configurable: true, value: this.status === 'loading' },
      Error: { configurable: true, value: this.status === 'error' ? this.error : '' },
    })
    return rows
  }

  create(entityName: string, values: Record<string, unknown>): RuntimeEntityHandle {
    this.requireReady('create')
    const entity = this.requireEntity(entityName)
    const fields = rowValues(entityName, entity, values, this)
    const id = this.nextAvailableId(entityName)
    const row: StoredRow = { Id: id, ...fields }
    this.data = {
      nextId: this.data.nextId,
      rows: {
        ...this.data.rows,
        [entityName]: [...(this.data.rows[entityName] ?? []), row],
      },
    }
    this.commit()
    return this.handle(entityName, id)
  }

  update(handle: RuntimeEntityHandle, values: Record<string, unknown>): void {
    this.requireReady('update')
    const metadata = this.requireOwnedHandle(handle)
    const entity = this.requireEntity(metadata.entity)
    const existing = this.storedRow(metadata.entity, metadata.id)
    if (!existing) {
      throw new Error(`Cannot update deleted ${metadata.entity} '${metadata.id}'.`)
    }
    const fields = partialRowValues(metadata.entity, entity, values, this)
    this.data = {
      nextId: this.data.nextId,
      rows: {
        ...this.data.rows,
        [metadata.entity]: (this.data.rows[metadata.entity] ?? []).map(row =>
          row.Id === metadata.id ? { ...row, ...fields, Id: row.Id } : row
        ),
      },
    }
    this.commit()
  }

  delete(handle: RuntimeEntityHandle): void {
    this.requireReady('delete')
    const metadata = this.requireOwnedHandle(handle)
    if (!this.storedRow(metadata.entity, metadata.id)) {
      throw new Error(`Cannot delete missing ${metadata.entity} '${metadata.id}'.`)
    }
    const targets = new Map<string, DeleteTarget>()
    this.collectDeleteTargets(metadata.entity, metadata.id, targets)
    const rows = Object.fromEntries(
      Object.entries(this.data.rows).map(([entity, entityRows]) => {
        return [entity, entityRows.filter(row => !targets.has(handleKey(entity, row.Id)))]
      }),
    )
    this.data = { nextId: this.data.nextId, rows }
    for (const target of targets.values()) {
      this.handles.delete(handleKey(target.entity, target.id))
    }
    this.commit()
  }

  read(handle: RuntimeEntityHandle, member: string): unknown {
    const metadata = this.requireOwnedHandle(handle)
    if (member === 'Id') {
      return metadata.id
    }
    const row = this.storedRow(metadata.entity, metadata.id)
    const entity = this.definition.entities[metadata.entity]
    const inverse = entity?.inverseFields?.[member]
    if (inverse) {
      return (this.data.rows[inverse.relation] ?? [])
        .filter(candidate => candidate[inverse.inverseField] === metadata.id)
        .map(candidate => this.handle(inverse.relation, candidate.Id))
    }
    const field = entity?.fields[member]
    const value = row?.[member]
    if (field?.kind !== 'relation' || typeof value !== 'string' || !field.relation) {
      return value
    }
    return this.storedRow(field.relation, value) ? this.handle(field.relation, value) : undefined
  }

  relationId(handle: RuntimeEntityHandle, expectedEntity: string, context: string): string {
    const candidate = metadataOf(handle)
    if (candidate.schema !== this) {
      throw new Error(
        `${context} expects ${expectedEntity} from data schema '${this.name}', but received ${candidate.entity} `
          + `'${candidate.id}' from a different data schema instance named '${candidate.schema.name}'.`,
      )
    }
    const metadata = this.requireOwnedHandle(handle)
    if (metadata.entity !== expectedEntity) {
      throw new Error(`${context} expects ${expectedEntity}, got ${metadata.entity}.`)
    }
    if (!this.storedRow(metadata.entity, metadata.id)) {
      throw new Error(`${context} refers to missing ${expectedEntity} '${metadata.id}'.`)
    }
    return metadata.id
  }

  availability(handle: RuntimeEntityHandle): TaoEntityAvailability {
    const metadata = metadataOf(handle)
    if (metadata.schema !== this) {
      return { status: 'missing' }
    }
    if (this.status === 'loading') {
      return { status: 'loading' }
    }
    if (this.status === 'error') {
      return { message: this.error, status: 'error' }
    }
    if (metadata.generation !== this.generation) {
      return { status: 'missing' }
    }
    return this.storedRow(metadata.entity, metadata.id)
      ? { status: 'available' }
      : { status: 'missing' }
  }

  async settle(): Promise<void> {
    await this.loadPromise
    await this.saveQueue
  }

  setStatus(status: DataStatus, message: string): void {
    this.failedSaveSequence = undefined
    this.status = status
    this.error = status === 'error' ? message || 'Local data provider failed.' : ''
    this.emit()
  }

  private collectDeleteTargets(entity: string, id: string, targets: Map<string, DeleteTarget>): void {
    const key = handleKey(entity, id)
    if (targets.has(key)) {
      return
    }
    targets.set(key, { entity, id })
    for (const [relatedEntityName, relatedEntity] of Object.entries(this.definition.entities)) {
      for (const [fieldName, field] of Object.entries(relatedEntity.fields)) {
        if (field.kind !== 'relation' || field.relation !== entity) {
          continue
        }
        const referringRows = (this.data.rows[relatedEntityName] ?? []).filter(row => row[fieldName] === id)
        if (referringRows.length === 0) {
          continue
        }
        if ((field.onDelete ?? 'restrict') !== 'cascade') {
          throw new Error(
            `Cannot delete ${entity} '${id}' because ${relatedEntityName}.${fieldName} still refers to it.`,
          )
        }
        for (const row of referringRows) {
          this.collectDeleteTargets(relatedEntityName, row.Id, targets)
        }
      }
    }
  }

  private commit(): void {
    const generation = this.generation
    const provider = this.provider
    const saveSequence = ++this.nextSaveSequence
    const serialized = JSON.stringify(envelope(this.data, this.definition))
    this.emit()
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        await provider.persist(this.storageKey(), serialized)
        if (
          generation === this.generation
          && this.failedSaveSequence !== undefined
          && saveSequence > this.failedSaveSequence
        ) {
          this.failedSaveSequence = undefined
          this.status = 'ready'
          this.error = ''
          this.emit()
        }
      } catch (error) {
        if (generation === this.generation) {
          this.failedSaveSequence = saveSequence
          this.status = 'error'
          this.error = `Could not save local data: ${errorMessage(error)}`
          this.emit()
        }
      }
    })
  }

  private emit(): void {
    this.version += 1
    globalRevision += 1
    for (const listener of this.listeners) {
      listener()
    }
    for (const listener of globalListeners) {
      listener()
    }
  }

  private failLoad(generation: number, error: unknown): void {
    if (generation !== this.generation) {
      return
    }
    this.failedSaveSequence = undefined
    this.status = 'error'
    this.error = `Could not load local data: ${errorMessage(error)}`
    this.emit()
  }

  private finishLoad(generation: number, stored: string | undefined): void {
    if (generation !== this.generation) {
      return
    }
    try {
      this.data = stored === undefined ? emptyData(this.definition) : parseEnvelope(stored, this.definition)
      this.failedSaveSequence = undefined
      this.status = 'ready'
      this.error = ''
      this.emit()
    } catch (error) {
      this.failLoad(generation, error)
    }
  }

  private handle(entity: string, id: string): RuntimeEntityHandle {
    const key = handleKey(entity, id)
    const existing = this.handles.get(key)
    if (existing) {
      return existing
    }
    const handle = new RuntimeEntityHandle(this, entity, id, this.generation)
    this.handles.set(key, handle)
    return handle
  }

  private nextAvailableId(entity: string): string {
    let id: string
    do {
      id = `${entity}-${this.data.nextId++}`
    } while (this.storedRow(entity, id))
    return id
  }

  private requireEntity(entity: string): TaoDataEntity {
    const definition = this.definition.entities[entity]
    if (!definition) {
      throw new Error(`Data schema '${this.name}' has no entity '${entity}'.`)
    }
    return definition
  }

  private requireOwnedHandle(handle: RuntimeEntityHandle): RuntimeEntityMetadata {
    const metadata = metadataOf(handle)
    if (metadata.schema !== this) {
      throw new Error(`Entity handle '${metadata.id}' belongs to a different data schema.`)
    }
    if (metadata.generation !== this.generation) {
      throw new Error(`Entity handle '${metadata.id}' belongs to an inactive provider generation.`)
    }
    return metadata
  }

  private requireReady(operation: string): void {
    if (this.status !== 'ready') {
      throw new Error(`Cannot ${operation} data while the provider is ${this.status}.`)
    }
  }

  private storageKey(): string {
    return this.storageKeyBinding ?? this.definition.name
  }

  private storedRow(entity: string, id: string): StoredRow | undefined {
    return this.data.rows[entity]?.find(row => row.Id === id)
  }
}

function evaluatedFields(fields: Record<string, Evaluable>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, value.evaluate().jsValue]))
}

function rowValues(
  entityName: string,
  entity: TaoDataEntity,
  values: Record<string, unknown>,
  schema: RuntimeDataSchema,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  assertKnownFields(entityName, entity, values)
  for (const [name, field] of Object.entries(entity.fields)) {
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      result[name] = storedFieldValue(entityName, name, field, values[name], schema)
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(field, 'defaultValue') && field.defaultNow !== true) {
      throw new Error(`Create of '${entityName}' is missing required field '${name}'.`)
    }
    const value = field.defaultNow === true ? Date.now() : field.defaultValue
    result[name] = storedFieldValue(entityName, name, field, value, schema)
  }
  return result
}

function partialRowValues(
  entityName: string,
  entity: TaoDataEntity,
  values: Record<string, unknown>,
  schema: RuntimeDataSchema,
): Record<string, unknown> {
  assertKnownFields(entityName, entity, values)
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => {
      return [name, storedFieldValue(entityName, name, entity.fields[name]!, value, schema)]
    }),
  )
}

function assertKnownFields(entityName: string, entity: TaoDataEntity, values: Record<string, unknown>): void {
  for (const name of Object.keys(values)) {
    if (name === 'Id' || !entity.fields[name]) {
      throw new Error(`Entity '${entityName}' has no writable field '${name}'.`)
    }
  }
}

function storedFieldValue(
  entityName: string,
  fieldName: string,
  field: TaoDataField,
  value: unknown,
  schema: RuntimeDataSchema,
): unknown {
  if (field.kind === 'relation') {
    const handle = entityHandle(value)
    if (!handle) {
      throw new Error(`Relationship '${entityName}.${fieldName}' expects a live ${field.relation} entity handle.`)
    }
    return schema.relationId(
      handle,
      field.relation!,
      `Relationship '${entityName}.${fieldName}'`,
    )
  }
  if (!valueMatchesKind(value, field.kind)) {
    throw new Error(`Field '${entityName}.${fieldName}' expects ${field.kind}, got ${valueType(value)}.`)
  }
  return value
}

function queryFilterValue(
  entityName: string,
  entity: TaoDataEntity,
  filter: TaoQueryFilter,
  schema: RuntimeDataSchema,
): unknown {
  const field = entity.fields[filter.field]
  if (!field) {
    throw new Error(`Entity '${entityName}' has no queryable field '${filter.field}'.`)
  }
  const value = filter.value().evaluate().jsValue
  if (field.kind !== 'relation') {
    return value
  }
  const handle = entityHandle(value)
  if (!handle) {
    throw new Error(`Query filter '${entityName}.${filter.field}' expects a live ${field.relation} entity handle.`)
  }
  return schema.relationId(
    handle,
    field.relation!,
    `Query filter '${entityName}.${filter.field}'`,
  )
}

function matchesFilter(row: StoredRow, filter: TaoQueryFilter, expected: unknown): boolean {
  const actual = row[filter.field]
  if (filter.operator === '==') {
    return Object.is(actual, expected)
  }
  if (filter.operator === '!=') {
    return !Object.is(actual, expected)
  }
  if (filter.operator === '<') {
    return compare(actual, expected) < 0
  }
  if (filter.operator === '<=') {
    return compare(actual, expected) <= 0
  }
  if (filter.operator === '>') {
    return compare(actual, expected) > 0
  }
  return compare(actual, expected) >= 0
}

function compare(left: unknown, right: unknown): number {
  if (Object.is(left, right)) {
    return 0
  }
  if (left === undefined || left === null) {
    return -1
  }
  if (right === undefined || right === null) {
    return 1
  }
  return left < right ? -1 : 1
}

function emptyData(definition: TaoDataSchemaDefinition): StoredData {
  return {
    nextId: 1,
    rows: Object.fromEntries(Object.keys(definition.entities).map(entity => [entity, []])),
  }
}

function envelope(data: StoredData, definition: TaoDataSchemaDefinition): PersistedEnvelope {
  return {
    formatVersion: persistedFormatVersion,
    schemaVersion: definition.schemaVersion ?? 1,
    nextId: data.nextId,
    rows: data.rows,
  }
}

function parseEnvelope(serialized: string, definition: TaoDataSchemaDefinition): StoredData {
  const value = JSON.parse(serialized) as unknown
  if (!value || typeof value !== 'object') {
    throw new Error('Persisted data is not an object envelope.')
  }
  const candidate = value as Partial<PersistedEnvelope>
  if (candidate.formatVersion !== persistedFormatVersion) {
    throw new Error(`Unsupported persisted data format '${String(candidate.formatVersion)}'.`)
  }
  const schemaVersion = definition.schemaVersion ?? 1
  if (candidate.schemaVersion !== schemaVersion) {
    throw new Error(`Persisted schema version ${String(candidate.schemaVersion)} does not match ${schemaVersion}.`)
  }
  if (!Number.isSafeInteger(candidate.nextId) || (candidate.nextId ?? 0) < 1) {
    throw new Error('Persisted data has an invalid nextId.')
  }
  if (!candidate.rows || typeof candidate.rows !== 'object' || Array.isArray(candidate.rows)) {
    throw new Error('Persisted data has invalid rows.')
  }
  const entityNames = Object.keys(definition.entities)
  if (!sameNames(Object.keys(candidate.rows), entityNames)) {
    throw new Error('Persisted data entity collections do not match the current schema.')
  }
  const rows: Record<string, StoredRow[]> = {}
  for (const entityName of entityNames) {
    const entityRows = candidate.rows[entityName]
    if (!Array.isArray(entityRows)) {
      throw new Error(`Persisted entity '${entityName}' is not a row list.`)
    }
    rows[entityName] = entityRows.map(row => validatedStoredRow(entityName, row, definition))
    const ids = rows[entityName].map(row => row.Id)
    if (new Set(ids).size !== ids.length) {
      throw new Error(`Persisted entity '${entityName}' contains duplicate Id values.`)
    }
  }
  validatePersistedRelations(rows, definition)
  return { nextId: candidate.nextId!, rows }
}

function validatedStoredRow(entityName: string, value: unknown, definition: TaoDataSchemaDefinition): StoredRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Persisted ${entityName} row is not an object.`)
  }
  const row = value as Record<string, unknown>
  if (typeof row['Id'] !== 'string') {
    throw new Error(`Persisted ${entityName} row has no text Id.`)
  }
  const entity = definition.entities[entityName]!
  if (!sameNames(Object.keys(row), ['Id', ...Object.keys(entity.fields)])) {
    throw new Error(`Persisted ${entityName} row fields do not match the current schema.`)
  }
  for (const [name, field] of Object.entries(entity.fields)) {
    const value = row[name]
    if (field.kind === 'relation' ? typeof value !== 'string' : !valueMatchesKind(value, field.kind)) {
      throw new Error(`Persisted field '${entityName}.${name}' has an invalid ${field.kind} value.`)
    }
  }
  return { ...row, Id: row['Id'] }
}

function validatePersistedRelations(rows: Record<string, StoredRow[]>, definition: TaoDataSchemaDefinition): void {
  for (const [entityName, entity] of Object.entries(definition.entities)) {
    for (const [name, field] of Object.entries(entity.fields)) {
      if (field.kind !== 'relation') {
        continue
      }
      const relatedIds = new Set((rows[field.relation ?? ''] ?? []).map(row => row.Id))
      for (const row of rows[entityName] ?? []) {
        if (!relatedIds.has(row[name] as string)) {
          throw new Error(`Persisted relationship '${entityName}.${name}' refers to missing ${field.relation}.`)
        }
      }
    }
  }
}

function validateDefinition(definition: TaoDataSchemaDefinition): void {
  if (!Number.isSafeInteger(definition.schemaVersion ?? 1) || (definition.schemaVersion ?? 1) < 1) {
    throw new Error(`Data schema '${definition.name}' has an invalid schema version.`)
  }
  for (const [entityName, entity] of Object.entries(definition.entities)) {
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (fieldName === 'Id') {
        throw new Error(`Entity '${entityName}' cannot declare reserved field 'Id'.`)
      }
      if (field.kind === 'relation') {
        if (!field.relation || !definition.entities[field.relation]) {
          throw new Error(`Relationship '${entityName}.${fieldName}' has an unknown target '${field.relation ?? ''}'.`)
        }
        if (Object.prototype.hasOwnProperty.call(field, 'defaultValue') || field.defaultNow !== undefined) {
          throw new Error(`Relationship '${entityName}.${fieldName}' cannot declare a default value.`)
        }
        continue
      }
      if (field.onDelete || field.relation) {
        throw new Error(`Primitive field '${entityName}.${fieldName}' cannot declare relationship metadata.`)
      }
      const hasLiteralDefault = Object.prototype.hasOwnProperty.call(field, 'defaultValue')
      if (field.defaultNow !== undefined) {
        if (field.defaultNow !== true) {
          throw new Error(`Field '${entityName}.${fieldName}' has invalid now-default metadata.`)
        }
        if (hasLiteralDefault) {
          throw new Error(`Field '${entityName}.${fieldName}' cannot declare two defaults.`)
        }
        if (field.kind !== 'time') {
          throw new Error(`Only time field '${entityName}.${fieldName}' can default to now.`)
        }
        continue
      }
      if (!hasLiteralDefault) {
        continue
      }
      if (!valueMatchesKind(field.defaultValue, field.kind)) {
        throw new Error(`Default for '${entityName}.${fieldName}' does not match ${field.kind}.`)
      }
    }
  }
}

function valueMatchesKind(value: unknown, kind: DataPrimitive): boolean {
  if (kind === 'boolean') {
    return typeof value === 'boolean'
  }
  if (kind === 'number' || kind === 'time') {
    return typeof value === 'number' && Number.isFinite(value)
  }
  return typeof value === 'string'
}

function valueType(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'list' : typeof value
}

function entityHandle(value: unknown): RuntimeEntityHandle | undefined {
  return value instanceof RuntimeEntityHandle ? value : undefined
}

function metadataOf(handle: RuntimeEntityHandle): RuntimeEntityMetadata {
  const metadata = runtimeEntityMetadata.get(handle)
  if (!metadata) {
    throw new Error('Invalid Tao data entity handle.')
  }
  return metadata
}

function handleKey(entity: string, id: string): string {
  return `${entity}\u0000${id}`
}

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  const sortedActual = [...actual].sort()
  const sortedExpected = [...expected].sort()
  return sortedActual.length === sortedExpected.length
    && sortedActual.every((name, index) => name === sortedExpected[index])
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return !!value && typeof (value as Promise<T>).then === 'function'
}

function asyncStorage(): TaoKeyValueStorage {
  const required = require('@react-native-async-storage/async-storage') as
    | TaoKeyValueStorage
    | { default: TaoKeyValueStorage }
  return 'default' in required ? required.default : required
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
