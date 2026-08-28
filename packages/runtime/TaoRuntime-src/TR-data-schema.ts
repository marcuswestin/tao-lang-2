import type {
  TaoConfiguredDatasource,
  TaoDataConnection,
  TaoDataEntity,
  TaoDataSchemaDefinition,
  TaoDatasourceDeclaration,
  TaoEntityAvailability,
  TaoQueryPlan,
} from './TR-data'
import {
  configuredDatasourceSignature,
  evaluatedDatasourceConfiguration,
} from './TR-data'
import { validateDefinition } from './TR-data-definition'
import {
  handleKey,
  metadataOf,
  RuntimeEntityHandle,
  type RuntimeEntityMetadata,
} from './TR-data-entity'
import { DataLoadRecovery } from './TR-data-load-recovery'
import {
  emptyData,
  envelope,
  parseEnvelope,
  type StoredData,
  type StoredRow,
} from './TR-data-persistence'
import { type DataStatus, emitDataChange } from './TR-data-registry'
import {
  compare,
  matchesFilter,
  partialRowValues,
  queryFilterValue,
  rowValues,
} from './TR-data-values'
import RuntimeSwitch from './TR-switch'

type DeleteTarget = { entity: string; id: string }
type ConfiguredProviderBinding = Readonly<{
  declaration: TaoDatasourceDeclaration
  signature: string
}>
type ProviderBinding = ConfiguredProviderBinding | 'test' | 'unbound' | undefined

export class RuntimeDataSchema {
  readonly name: string
  private data: StoredData
  private error = ''
  private failedSaveSequence: number | undefined
  private generation = 0
  private handles = new Map<string, RuntimeEntityHandle>()
  private listeners = new Set<() => void>()
  private loadPromise: Promise<void> = Promise.resolve()
  private nextSaveSequence = 0
  private connection: TaoDataConnection
  private completedSaveSequence = 0
  private hasUsableSnapshot = false
  private providerBinding: ProviderBinding
  private providerUnsubscribe: (() => void) | undefined
  private saveQueue: Promise<void> = Promise.resolve()
  private status: DataStatus = 'loading'
  private version = 0

  constructor(
    readonly definition: TaoDataSchemaDefinition,
    connection: TaoDataConnection,
    providerBinding?: ProviderBinding,
  ) {
    validateDefinition(definition)
    this.name = definition.name
    this.connection = connection
    this.providerBinding = providerBinding
    this.data = emptyData(definition)
    this.configure(connection, providerBinding)
  }

  readonly subscribe = (listener: () => void): () => void => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly snapshot = (): number => this.version

  private async recoverAfterLoadFailure(): Promise<void> {
    const connection = this.connection
    const providerBinding = this.providerBinding
    await connection.reset?.()
    if (this.connection !== connection) {
      return
    }

    this.configure(connection, providerBinding)
    await this.settle()
    if (this.connection === connection && this.status === 'error') {
      throw new Error(this.error)
    }
  }

  bindConfigured(source: TaoConfiguredDatasource): void {
    const signature = configuredDatasourceSignature(source)
    if (
      typeof this.providerBinding === 'object'
      && this.providerBinding.declaration === source.declaration
      && this.providerBinding.signature === signature
    ) {
      return
    }
    const configuration = evaluatedDatasourceConfiguration(source)
    const configuredStorageKey = configuration['StorageKey']
    if (configuredStorageKey !== undefined && typeof configuredStorageKey !== 'string') {
      throw new Error(`Datasource ${source.declaration.name} configuration 'StorageKey' expects text.`)
    }
    const storageKey = configuredStorageKey ?? this.definition.name
    const connection = source.declaration.provider.connect(Object.freeze({
      configuration,
      schema: this.definition,
      storageKey,
    }))
    this.configure(connection, Object.freeze({ declaration: source.declaration, signature }))
  }

  configure(
    connection: TaoDataConnection,
    providerBinding?: ProviderBinding,
  ): void {
    const generation = ++this.generation
    this.providerUnsubscribe?.()
    this.providerUnsubscribe = undefined
    if (this.connection !== connection) {
      this.connection.close?.()
    }
    this.connection = connection
    this.providerBinding = providerBinding
    this.data = emptyData(this.definition)
    this.handles.clear()
    this.error = ''
    this.status = 'loading'
    this.failedSaveSequence = undefined
    this.completedSaveSequence = 0
    this.hasUsableSnapshot = false
    this.nextSaveSequence = 0
    this.saveQueue = Promise.resolve()
    this.emit()

    try {
      const loaded = connection.load()
      if (isPromise(loaded)) {
        this.loadPromise = loaded.then(
          value => this.finishLoad(generation, value),
          error => this.failLoad(generation, error),
        ).then(() => this.startSubscription(generation, connection))
        return
      }
      this.finishLoad(generation, loaded)
      this.startSubscription(generation, connection)
      this.loadPromise = Promise.resolve()
    } catch (error) {
      this.failLoad(generation, error)
      this.startSubscription(generation, connection)
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
    return RuntimeSwitch<DataStatus, TaoEntityAvailability>(this.status, {
      error: () => ({ message: this.error, status: 'error' }),
      loading: () => ({ status: 'loading' }),
      ready: () => {
        if (metadata.generation !== this.generation) {
          return { status: 'missing' }
        }
        return this.storedRow(metadata.entity, metadata.id)
          ? { status: 'available' }
          : { status: 'missing' }
      },
      unauthorized: () => ({ status: 'unauthorized' }),
    })
  }

  async settle(): Promise<void> {
    await this.loadPromise
    await this.saveQueue
  }

  setStatus(status: DataStatus, message: string): void {
    this.failedSaveSequence = undefined
    this.status = status
    this.error = status === 'error' ? message || 'Data provider failed.' : ''
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
    const connection = this.connection
    const saveSequence = ++this.nextSaveSequence
    const serialized = JSON.stringify(envelope(this.data, this.definition))
    this.emit()
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        await connection.save(serialized)
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
          this.error = `Could not save data: ${errorMessage(error)}`
          this.emit()
        }
      } finally {
        if (generation === this.generation) {
          this.completedSaveSequence = saveSequence
        }
      }
    })
  }

  private emit(): void {
    this.version += 1
    emitDataChange(this.listeners)
  }

  private failLoad(generation: number, error: unknown): void {
    if (generation !== this.generation) {
      return
    }
    this.failedSaveSequence = undefined
    this.status = 'error'
    this.error = `Could not load data: ${errorMessage(error)}`
    if (this.providerBinding !== 'unbound') {
      DataLoadRecovery.report(this, this.error, {
        label: this.connection.reset === undefined ? 'Try loading data again' : 'Reset app data and reload',
        run: () => this.recoverAfterLoadFailure(),
      })
    }
    this.emit()
  }

  private finishLoad(generation: number, stored: string | undefined): void {
    if (generation !== this.generation) {
      return
    }
    try {
      this.data = stored === undefined ? emptyData(this.definition) : parseEnvelope(stored, this.definition)
      this.failedSaveSequence = undefined
      this.hasUsableSnapshot = true
      this.status = 'ready'
      this.error = ''
      DataLoadRecovery.resolve(this)
      this.emit()
    } catch (error) {
      this.failLoad(generation, error)
    }
  }

  private startSubscription(generation: number, connection: TaoDataConnection): void {
    if (generation !== this.generation || connection !== this.connection || !connection.subscribe) {
      return
    }
    try {
      this.providerUnsubscribe = connection.subscribe({
        error: error => this.failSubscription(generation, error),
        snapshot: value => this.receiveSnapshot(generation, value),
      })
    } catch (error) {
      this.failSubscription(generation, error)
    }
  }

  private failSubscription(generation: number, error: unknown): void {
    if (!this.hasUsableSnapshot) {
      this.failLoad(generation, error)
      return
    }
    if (generation !== this.generation) {
      return
    }
    this.status = 'error'
    this.error = `Could not synchronize data: ${errorMessage(error)}`
    this.emit()
  }

  private receiveSnapshot(generation: number, stored: string | undefined): void {
    if (generation !== this.generation) {
      return
    }
    // A local snapshot already visible in the UI wins over remote events observed while its ordered
    // save is pending. Applying those events would briefly replace local state before the queued save
    // writes that same local snapshot back to the provider.
    if (this.completedSaveSequence < this.nextSaveSequence) {
      return
    }
    try {
      const serialized = JSON.stringify(envelope(this.data, this.definition))
      if (stored === serialized || (stored === undefined && this.isEmpty())) {
        return
      }
      this.data = stored === undefined ? emptyData(this.definition) : parseEnvelope(stored, this.definition)
      this.failedSaveSequence = undefined
      this.hasUsableSnapshot = true
      this.status = 'ready'
      this.error = ''
      DataLoadRecovery.resolve(this)
      this.emit()
    } catch (error) {
      this.failLoad(generation, error)
    }
  }

  private isEmpty(): boolean {
    return Object.values(this.data.rows).every(rows => rows.length === 0)
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

  private storedRow(entity: string, id: string): StoredRow | undefined {
    return this.data.rows[entity]?.find(row => row.Id === id)
  }
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return !!value && typeof (value as Promise<T>).then === 'function'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
