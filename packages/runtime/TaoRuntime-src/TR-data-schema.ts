import type {
  TaoConfiguredDatasource,
  TaoDataConnection,
  TaoDataEntity,
  TaoDataSchemaDefinition,
  TaoDatasourceDeclaration,
  TaoDescriptorValue,
  TaoEntityAvailability,
  TaoQueryDescriptor,
  TaoQueryPlan,
} from './TR-data'
import {
  configurationValuesEqual,
  evaluatedDatasourceConfiguration,
} from './TR-data'
import { validateDefinition, valueMatchesKind } from './TR-data-definition'
import {
  handleKey,
  metadataOf,
  RuntimeEntityHandle,
  type RuntimeEntityMetadata,
  type TaoEntityReferenceSnapshot,
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
import { reportUnownedFailure } from './TR-errors'
import RuntimeSwitch from './TR-switch'
import { Clock } from './TR-units'

type DeleteTarget = { entity: string; id: string }

/** FillState tracks one activated query descriptor's connection-fill lifecycle. */
type FillState = {
  filledAtMs?: number
  message: string
  status: 'failed' | 'filling' | 'ready'
}

type ConfiguredProviderBinding = Readonly<{
  configuration: Readonly<Record<string, unknown>>
  declaration: TaoDatasourceDeclaration
}>
type ProviderBinding = ConfiguredProviderBinding | 'test' | 'unbound' | undefined

export class RuntimeDataSchema {
  readonly name: string
  private bufferedRemoteSnapshot: { stored: string | undefined } | undefined
  private data: StoredData
  private error = ''
  private errorRecoverable = false
  private failedSaveSequence: number | undefined
  private fills = new Map<string, FillState>()
  private generation = 0
  private pendingFills = new Set<Promise<void>>()
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

  serializeReference(handle: RuntimeEntityHandle): TaoEntityReferenceSnapshot {
    const metadata = this.requireOwnedHandle(handle)
    const token = this.connection.referenceToken?.({ entity: metadata.entity, id: metadata.id, schema: this.name })
    if (token === undefined) {
      throw new Error(`Datasource provider for '${this.name}' does not support restoration references.`)
    }
    return {
      entity: metadata.entity,
      provider: this.referenceProviderIdentity(),
      schema: this.name,
      token,
    }
  }

  restoreReference(reference: TaoEntityReferenceSnapshot): RuntimeEntityHandle | undefined {
    if (reference.schema !== this.name || reference.provider !== this.referenceProviderIdentity()) {
      return undefined
    }
    this.requireEntity(reference.entity)
    const id = this.connection.resolveReference?.({
      entity: reference.entity,
      schema: reference.schema,
      token: reference.token,
    })
    if (id === undefined) {
      throw new Error(`Datasource provider for '${this.name}' cannot resolve restoration references.`)
    }
    return this.handle(reference.entity, id)
  }

  private async recoverAfterLoadFailure(destructive: boolean): Promise<void> {
    const connection = this.connection
    const providerBinding = this.providerBinding
    if (destructive) {
      await connection.reset?.()
    }
    if (this.connection !== connection) {
      return
    }

    this.configure(connection, providerBinding)
    await this.settle()
    if (this.connection === connection && this.status === 'error') {
      throw new Error(this.error)
    }
  }

  /**
   * validateConfigured runs the runtime-owned configuration checks without connecting a provider —
   * how a Tao behavior test surfaces a configuration mistake that would otherwise first fire at a
   * production mount.
   */
  validateConfigured(source: TaoConfiguredDatasource): void {
    this.validatedStorageKey(source.declaration.name, evaluatedDatasourceConfiguration(source))
  }

  bindConfigured(source: TaoConfiguredDatasource): void {
    // A rebind is compared by evaluated configuration value, not object identity: the app root
    // constructs a fresh configured value per render, while a Patch that changes `Adapter` or
    // `StorageKey` under the same declaration must still rebind.
    const configuration = evaluatedDatasourceConfiguration(source)
    if (
      typeof this.providerBinding === 'object'
      && this.providerBinding.declaration === source.declaration
      && configurationValuesEqual(this.providerBinding.configuration, configuration)
    ) {
      return
    }
    const binding = Object.freeze({ configuration, declaration: source.declaration })
    // A configuration or connect failure becomes data error state behind the recovery overlay; a
    // throw would escape into the mounting layout effect, where no error boundary catches it.
    try {
      const storageKey = this.validatedStorageKey(source.declaration.name, configuration)
      const connection = source.declaration.provider.connect(Object.freeze({
        configuration,
        schema: this.definition,
        storageKey,
      }))
      this.configure(connection, binding)
    } catch (error) {
      this.configure(brokenConnection(error), binding)
    }
  }

  configure(
    connection: TaoDataConnection,
    providerBinding?: ProviderBinding,
  ): void {
    const generation = ++this.generation
    this.providerUnsubscribe?.()
    this.providerUnsubscribe = undefined
    const previousConnection = this.connection
    if (previousConnection !== connection) {
      // Queued saves already hold committed data, so the outgoing connection closes only after
      // its save chain settles — a rebind must not reject an in-flight save. The queue never
      // rejects, and a connection still loading has an empty queue, so this cannot dangle.
      void this.saveQueue.then(() => previousConnection.close?.())
    }
    this.connection = connection
    this.providerBinding = providerBinding
    this.bufferedRemoteSnapshot = undefined
    this.data = emptyData(this.definition)
    this.handles.clear()
    this.fills.clear()
    this.error = ''
    this.errorRecoverable = false
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
    const limited = plan.limit !== undefined && rows.length > plan.limit ? rows.slice(0, plan.limit) : rows
    const fill = this.fillState(plan)
    // Availability turns on whether this descriptor has ever filled, not on how many rows it
    // produced: a feed that legitimately filled empty is `empty` content refreshing behind it,
    // never a spinner again. Rows and their absence are both content once a fill has landed.
    const filled = fill?.filledAtMs !== undefined
    Object.defineProperties(limited, {
      Loading: {
        configurable: true,
        value: this.status === 'loading' || (fill?.status === 'filling' && !filled),
      },
      Error: {
        configurable: true,
        value: this.status === 'error'
          ? this.error
          : fill?.status === 'failed' && !filled
          ? fill.message
          : '',
      },
      Refreshing: { configurable: true, value: fill?.status === 'filling' && filled },
      Stale: { configurable: true, value: fill?.status === 'failed' && filled },
    })
    return limited
  }

  /**
   * queryActivationKey identifies one query's fill descriptor, or undefined when the connection
   * has no fill half. The key is what `Query` re-activates on, so it must be stable across renders.
   */
  queryActivationKey(plan: TaoQueryPlan): string | undefined {
    if (!this.connection.fill) {
      return undefined
    }
    const where = Object.entries(this.equalityFilterValues(plan))
      .sort(([left], [right]) => left < right ? -1 : 1)
    const order = this.effectiveOrder(plan)
    return JSON.stringify(
      [plan.entity, order?.field ?? null, order?.direction ?? null, plan.limit ?? null, where],
    )
  }

  /**
   * activateQuery offers one live query's descriptor to the connection's fill, once the initial
   * load settles. Activations are deduplicated by key while a fill runs, and a descriptor filled
   * within the connection's cache window is not re-filled. The release function abandons a pending
   * offer.
   */
  activateQuery(plan: TaoQueryPlan): () => void {
    if (!this.connection.fill) {
      return () => {}
    }
    const generation = this.generation
    let released = false
    void this.loadPromise.then(() => {
      if (released || generation !== this.generation || this.status !== 'ready') {
        return
      }
      // Building the descriptor evaluates the query's filter thunks, which can throw between
      // render and this microtask — a relation filter whose target row was deleted meanwhile.
      // That belongs to the query as a failed fill, never to the platform as an unhandled
      // rejection; a throw before there is a key has no descriptor to attach to.
      let key: string | undefined
      try {
        key = this.queryActivationKey(plan)
        if (key === undefined) {
          return
        }
        const current = this.fills.get(key)
        if (current?.status === 'filling') {
          return
        }
        const cacheForMs = this.connection.fillCacheMs ?? 0
        if (current?.filledAtMs !== undefined && Clock.now() - current.filledAtMs < cacheForMs) {
          return
        }
        this.startFill(key, plan, current)
      } catch (error) {
        if (key === undefined) {
          reportUnownedFailure(error)
          return
        }
        this.fills.set(key, {
          filledAtMs: this.fills.get(key)?.filledAtMs,
          message: errorMessage(error),
          status: 'failed',
        })
        this.emit()
      }
    })
    return () => {
      released = true
    }
  }

  /** fillState reads the fill lifecycle behind one query, or undefined for a fill-less connection. */
  fillState(plan: TaoQueryPlan): FillState | undefined {
    const key = this.queryActivationKey(plan)
    return key === undefined ? undefined : this.fills.get(key)
  }

  private startFill(key: string, plan: TaoQueryPlan, previous: FillState | undefined): void {
    const generation = this.generation
    const fill = this.connection.fill!
    this.fills.set(key, { filledAtMs: previous?.filledAtMs, message: '', status: 'filling' })
    this.emit()
    const request = { descriptor: this.fillDescriptor(plan) }
    const ops = {
      upsert: (entity: string, rows: readonly Record<string, unknown>[]): void => {
        if (generation !== this.generation) {
          return
        }
        this.upsertFromFill(entity, rows)
      },
    }
    const pending = Promise.resolve().then(() => fill(request, ops)).then(
      () => {
        if (generation !== this.generation) {
          return
        }
        this.fills.set(key, { filledAtMs: Clock.now(), message: '', status: 'ready' })
        this.emit()
      },
      error => {
        if (generation !== this.generation) {
          return
        }
        this.fills.set(key, {
          filledAtMs: previous?.filledAtMs,
          message: errorMessage(error),
          status: 'failed',
        })
        this.emit()
      },
    ).finally(() => {
      this.pendingFills.delete(pending)
    })
    this.pendingFills.add(pending)
  }

  private fillDescriptor(plan: TaoQueryPlan): TaoQueryDescriptor {
    const entity = this.requireEntity(plan.entity)
    const where: Record<string, TaoDescriptorValue> = {}
    for (const [field, value] of Object.entries(this.equalityFilterValues(plan))) {
      const definition = entity.fields[field]
      if (definition?.kind === 'relation' && typeof value === 'string') {
        where[field] = this.rowSnapshot(definition.relation!, value)
      } else {
        where[field] = value as TaoDescriptorValue
      }
    }
    const order = this.effectiveOrder(plan)
    return {
      entity: plan.entity,
      ...(plan.limit !== undefined ? { limit: plan.limit } : {}),
      ...(order !== undefined ? { orderBy: order.field, orderDirection: order.direction } : {}),
      where,
    }
  }

  /** effectiveOrder mirrors local evaluation: a query's own order, else the entity's default. */
  private effectiveOrder(plan: TaoQueryPlan): { direction: 'asc' | 'desc'; field: string } | undefined {
    const order = plan.order ?? this.requireEntity(plan.entity).defaultOrder
    return order ? { direction: order.direction, field: order.field } : undefined
  }

  /**
   * equalityFilterValues resolves the `==` filters a descriptor and its key are built from.
   * Non-equality filters stay out deliberately: a fill may land a superset and the store still
   * evaluates the full query locally.
   */
  private equalityFilterValues(plan: TaoQueryPlan): Record<string, unknown> {
    const entity = this.requireEntity(plan.entity)
    const values: Record<string, unknown> = {}
    for (const filter of plan.filters) {
      if (filter.operator === '==') {
        values[filter.field] = queryFilterValue(plan.entity, entity, filter, this)
      }
    }
    return values
  }

  /** rowSnapshot flattens one stored row to its scalar fields for a fill descriptor. */
  private rowSnapshot(entity: string, id: string): Readonly<Record<string, unknown>> {
    const definition = this.requireEntity(entity)
    const row = this.storedRow(entity, id)
    const snapshot: Record<string, unknown> = { Id: id }
    for (const [name, field] of Object.entries(definition.fields)) {
      if (field.kind !== 'relation' && row) {
        snapshot[name] = row[name]
      }
    }
    return Object.freeze(snapshot)
  }

  /**
   * upsertFromFill lands fetched rows, matching existing rows by the entity's unique field so a
   * refetch updates rather than duplicates. A relation value arrives as a plain object naming the
   * target's unique field (`{ HnId: 123 }`) and resolves to the store row; upsert parents before
   * children within one fill.
   */
  upsertFromFill(entityName: string, rows: readonly Record<string, unknown>[]): void {
    this.requireReady('fill')
    const entity = this.requireEntity(entityName)
    const uniqueField = Object.entries(entity.fields).find(([, field]) => field.unique)?.[0]
    if (!uniqueField) {
      throw new Error(`Fill upsert into '${entityName}' requires a field marked (unique).`)
    }
    const next = [...(this.data.rows[entityName] ?? [])]
    for (const raw of rows) {
      const resolved = this.resolveFillRow(entityName, entity, raw)
      const uniqueValue = resolved[uniqueField]
      if (uniqueValue === undefined) {
        throw new Error(`Fill upsert into '${entityName}' is missing unique field '${uniqueField}'.`)
      }
      const index = next.findIndex(row => Object.is(row[uniqueField], uniqueValue))
      if (index >= 0) {
        next[index] = { ...next[index], ...resolved, Id: next[index]!.Id }
      } else {
        next.push({ Id: this.nextAvailableId(entityName), ...this.filledRowDefaults(entityName, entity, resolved) })
      }
    }
    this.data = { nextId: this.data.nextId, rows: { ...this.data.rows, [entityName]: next } }
    this.commit()
  }

  private resolveFillRow(
    entityName: string,
    entity: TaoDataEntity,
    raw: Record<string, unknown>,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(raw)) {
      const field = entity.fields[name]
      if (name === 'Id' || !field) {
        throw new Error(`Entity '${entityName}' has no fillable field '${name}'.`)
      }
      if (field.kind !== 'relation') {
        if (!valueMatchesKind(value, field.kind)) {
          throw new Error(
            `Fill field '${entityName}.${name}' expects ${field.kind}, got ${value === null ? 'null' : typeof value}.`,
          )
        }
        resolved[name] = value
        continue
      }
      if (typeof value !== 'object' || value === null) {
        throw new Error(
          `Fill relation '${entityName}.${name}' expects an object naming the ${field.relation} unique field.`,
        )
      }
      resolved[name] = this.resolveFillRelation(entityName, name, field.relation!, value as Record<string, unknown>)
    }
    return resolved
  }

  private resolveFillRelation(
    entityName: string,
    fieldName: string,
    targetEntity: string,
    reference: Record<string, unknown>,
  ): string {
    const target = this.requireEntity(targetEntity)
    const uniqueField = Object.entries(target.fields).find(([, field]) => field.unique)?.[0]
    if (!uniqueField || reference[uniqueField] === undefined) {
      throw new Error(
        `Fill relation '${entityName}.${fieldName}' must name ${targetEntity}'s unique field.`,
      )
    }
    const expected = reference[uniqueField]
    const row = (this.data.rows[targetEntity] ?? []).find(candidate => Object.is(candidate[uniqueField], expected))
    if (!row) {
      throw new Error(
        `Fill relation '${entityName}.${fieldName}' references no stored ${targetEntity} with `
          + `${uniqueField} '${String(expected)}'. Upsert the ${targetEntity} rows first in the same fill.`,
      )
    }
    return row.Id
  }

  private filledRowDefaults(
    entityName: string,
    entity: TaoDataEntity,
    resolved: Record<string, unknown>,
  ): Record<string, unknown> {
    const row: Record<string, unknown> = {}
    for (const [name, field] of Object.entries(entity.fields)) {
      if (Object.prototype.hasOwnProperty.call(resolved, name)) {
        row[name] = resolved[name]
        continue
      }
      if (field.defaultNow === true) {
        row[name] = Clock.now()
      } else if (Object.prototype.hasOwnProperty.call(field, 'defaultValue')) {
        row[name] = field.defaultValue
      } else {
        throw new Error(`Fill upsert into '${entityName}' is missing required field '${name}'.`)
      }
    }
    return row
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
    while (this.pendingFills.size > 0) {
      await Promise.all([...this.pendingFills])
    }
    await this.saveQueue
  }

  setStatus(status: DataStatus, message: string): void {
    this.failedSaveSequence = undefined
    this.errorRecoverable = false
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
          && this.status === 'error'
          && this.errorRecoverable
          && (this.failedSaveSequence === undefined || saveSequence > this.failedSaveSequence)
        ) {
          this.failedSaveSequence = undefined
          this.errorRecoverable = false
          this.status = 'ready'
          this.error = ''
          this.emit()
        }
      } catch (error) {
        if (generation === this.generation) {
          this.failedSaveSequence = saveSequence
          this.errorRecoverable = true
          this.status = 'error'
          this.error = `Could not save data: ${errorMessage(error)}`
          this.emit()
        }
      } finally {
        if (generation === this.generation) {
          this.completedSaveSequence = saveSequence
          this.replayBufferedSnapshot(generation)
        }
      }
    })
  }

  /** replayBufferedSnapshot re-delivers the latest remote event suppressed during pending saves. */
  private replayBufferedSnapshot(generation: number): void {
    if (this.completedSaveSequence !== this.nextSaveSequence || this.bufferedRemoteSnapshot === undefined) {
      return
    }
    const buffered = this.bufferedRemoteSnapshot
    this.bufferedRemoteSnapshot = undefined
    this.receiveSnapshot(generation, buffered.stored)
  }

  private emit(): void {
    this.version += 1
    emitDataChange(this.listeners)
  }

  private failLoad(generation: number, error: unknown, cause: 'corrupt' | 'load' = 'load'): void {
    if (generation !== this.generation) {
      return
    }
    this.failedSaveSequence = undefined
    this.errorRecoverable = false
    this.status = 'error'
    this.error = `Could not load data: ${errorMessage(error)}`
    if (this.providerBinding !== 'unbound') {
      // A transport failure gets a plain retry; only provably corrupt stored data offers the
      // destructive reset, so a transient outage can never wipe a provider's good snapshot. And
      // the reset exists only where the connection grants it: a connection without `reset` — a
      // shared remote store, deliberately — keeps the retry, because overwriting data this client
      // failed to parse could erase every peer's rows.
      DataLoadRecovery.report(
        this,
        this.error,
        cause === 'corrupt' && this.connection.reset !== undefined
          ? { label: 'Reset app data and reload', run: () => this.recoverAfterLoadFailure(true) }
          : { label: 'Try loading data again', run: () => this.recoverAfterLoadFailure(false) },
      )
    }
    this.emit()
  }

  private finishLoad(generation: number, stored: string | undefined): void {
    if (generation !== this.generation) {
      return
    }
    try {
      this.applySnapshot(stored)
    } catch (error) {
      this.failLoad(generation, error, 'corrupt')
    }
  }

  /** applySnapshot replaces the store with one parsed snapshot; a parse failure throws unapplied. */
  private applySnapshot(stored: string | undefined): void {
    this.data = stored === undefined ? emptyData(this.definition) : parseEnvelope(stored, this.definition)
    this.failedSaveSequence = undefined
    this.errorRecoverable = false
    this.hasUsableSnapshot = true
    this.status = 'ready'
    this.error = ''
    DataLoadRecovery.resolve(this)
    this.emit()
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
    this.errorRecoverable = true
    this.status = 'error'
    this.error = `Could not synchronize data: ${errorMessage(error)}`
    this.emit()
  }

  private receiveSnapshot(generation: number, stored: string | undefined): void {
    if (generation !== this.generation) {
      return
    }
    // A local snapshot already visible in the UI wins over remote events observed while its
    // ordered save is pending. The latest suppressed event replays once the queue drains, so a
    // peer write pushed during the window still lands.
    if (this.completedSaveSequence < this.nextSaveSequence) {
      this.bufferedRemoteSnapshot = { stored }
      return
    }
    const serialized = JSON.stringify(envelope(this.data, this.definition))
    const matchesLocal = stored === serialized || (stored === undefined && this.isEmpty())
    if (matchesLocal && this.status === 'ready') {
      return
    }
    // After a failed save the local write is the only copy; a differing remote snapshot must not
    // silently revert it. The write stays visible with its error until a retried write saves, or
    // the provider echoes this exact snapshot and clears the error through the apply below.
    if (!matchesLocal && this.failedSaveSequence !== undefined) {
      return
    }
    try {
      this.applySnapshot(stored)
    } catch (error) {
      // A mid-session snapshot this client cannot parse — a peer on a newer schema version, or a
      // corrupted payload — degrades to the recoverable sync failure over the last usable data
      // rather than blocking the app behind the load-recovery overlay.
      this.failSubscription(generation, error)
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
    if (this.status === 'ready') {
      return
    }
    // A failed save or a sync outage keeps committed data usable: writes stay allowed so a retry
    // can save the store again while the error stays visible over the rows.
    if (this.status === 'error' && this.errorRecoverable) {
      return
    }
    throw new Error(`Cannot ${operation} data while the provider is ${this.status}.`)
  }

  private validatedStorageKey(
    declarationName: string,
    configuration: Readonly<Record<string, unknown>>,
  ): string {
    const configured = configuration['StorageKey']
    if (configured !== undefined && typeof configured !== 'string') {
      throw new Error(`Datasource ${declarationName} configuration 'StorageKey' expects text.`)
    }
    return configured ?? this.definition.name
  }

  private referenceProviderIdentity(): string {
    const binding = this.providerBinding
    if (typeof binding === 'object') {
      const canonical = binding.declaration.canonicalIdentity?.canonical
      if (canonical) {
        return canonical
      }
      throw new Error(`Datasource declaration '${binding.declaration.name}' has no canonical identity.`)
    }
    return String(binding ?? 'unbound')
  }

  private storedRow(entity: string, id: string): StoredRow | undefined {
    return this.data.rows[entity]?.find(row => row.Id === id)
  }
}

/** brokenConnection carries a configuration or connect failure into load-time error state. */
function brokenConnection(error: unknown): TaoDataConnection {
  return {
    load: () => {
      throw error
    },
    save: () => {
      throw error
    },
  }
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return !!value && typeof (value as Promise<T>).then === 'function'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
