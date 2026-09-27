import { Arrays } from './core/RuntimeCore'
import { existingTransactionResource, type TaoDebugPendingWrite, transactionResource } from './TR-action-transactions'
import { RuntimeAssert } from './TR-assert'
import type { TaoDataAuthBinding } from './TR-auth'
import type {
  TaoConfiguredDatasource,
  TaoDataConnection,
  TaoDataEntity,
  TaoDataField,
  TaoDataSchemaDefinition,
  TaoDatasourceDeclaration,
  TaoDataWriteIntent,
  TaoDescriptorValue,
  TaoEntityAvailability,
  TaoQueryDescriptor,
  TaoQueryPlan,
} from './TR-data'
import { dataAccessAllowed } from './TR-data-access'
import { validateDefinition, validateUniqueRows, valueMatchesField } from './TR-data-definition'
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
  type Evaluable,
  matchesFilter,
  matchesSearch,
  partialRowValues,
  queryFilterValue,
  querySearchTerm,
  rowValues,
  searchFieldNames,
} from './TR-data-values'
import {
  errorMessage,
  HostEnvironmentError,
  reportUnownedFailure,
  UnexpectedBehaviorError,
  UserInputError,
} from './TR-errors'
import RuntimeSwitch from './TR-switch'
import { TestWorld } from './TR-test-world'
import { Clock } from './TR-units'

type DeleteTarget = { entity: string; id: string }

/** An invalidated account connection can never start another queued save or fill. */
function accountConnection(connection: TaoDataConnection, auth: TaoDataAuthBinding): TaoDataConnection {
  const active = (): void => {
    RuntimeAssert.input(!auth.signal.aborted, 'This account data connection is no longer active.')
  }
  let invalidation: Promise<void> | undefined
  const invalidateAuth = (): Promise<void> => {
    if (!invalidation) {
      try {
        invalidation = Promise.resolve(connection.invalidateAuth?.())
      } catch (error) {
        invalidation = Promise.reject(error)
      }
    }
    return invalidation
  }
  auth.onInvalidate?.(invalidateAuth)
  return {
    ...connection,
    invalidateAuth,
    load: () => {
      active()
      return connection.load()
    },
    save: (snapshot, intents, context) => {
      active()
      return connection.save(snapshot, intents, context)
    },
    ...(connection.submit
      ? {
        submit: (snapshot, intents, context) => {
          active()
          return connection.submit!(snapshot, intents, context)
        },
      }
      : {}),
    ...(connection.writes
      ? {
        writes: {
          ...connection.writes,
          retry: (entity, id) => {
            active()
            connection.writes!.retry(entity, id)
          },
        },
      }
      : {}),
    ...(connection.fill
      ? {
        fill: async (request, ops) => {
          active()
          await connection.fill!(request, {
            upsert: (entity, rows) => {
              active()
              ops.upsert(entity, rows)
            },
          })
        },
      }
      : {}),
  }
}

/** FillState tracks one activated query descriptor's connection-fill lifecycle. */
type FillState = {
  filledAtMs?: number
  message: string
  status: 'failed' | 'filling' | 'ready'
}

type ConfiguredProviderBinding = Readonly<{
  auth?: TaoDataAuthBinding
  configuration: Readonly<Record<string, unknown>>
  declaration: TaoDatasourceDeclaration
  /** storageName is the bound datasource's own name, the storage key it defaults to. */
  storageName?: string
}>
type ProviderBinding = ConfiguredProviderBinding | 'test' | 'unbound' | undefined

type ActionDataOverlay = {
  generation: number
  base: StoredData
  intents: Map<string, TaoDataWriteIntent>
  prepared?: StoredData
  previous?: StoredData
  working: StoredData
}

/** TaoEntityWriteStatus is the row-local view of a provider's durable mutation recovery records. */
type TaoEntityWriteStatus = Readonly<{
  Failed: number
  Message: string
  Queued: number
  Supported: boolean
}>

/** evaluatedDatasourceConfiguration collapses runtime Tao values before crossing the provider boundary. */
export function evaluatedDatasourceConfiguration(
  source: TaoConfiguredDatasource,
): Readonly<Record<string, unknown>> {
  return Object.freeze(Object.fromEntries(
    Object.entries(source.config).map(([name, value]) => [name, evaluatedConfigurationValue(value)]),
  ))
}

/**
 * configurationValuesEqual compares evaluated configuration values so equivalent values
 * reconstructed during React renders do not rebind. Plain values compare structurally; anything
 * else — an adapter object's fill functions, for instance — compares by identity, so swapping a
 * variant's adapter rebinds even when the shapes serialize alike.
 */
export function configurationValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => configurationValuesEqual(value, right[index]))
  }
  if (isRecord(left) && isRecord(right)) {
    const names = Object.keys(left)
    return names.length === Object.keys(right).length
      && names.every(name => name in right && configurationValuesEqual(left[name], right[name]))
  }
  return false
}

function evaluatedConfigurationValue(value: unknown): unknown {
  if (isEvaluable(value)) {
    return evaluatedConfigurationValue(value.evaluate().jsValue)
  }
  if (Array.isArray(value)) {
    return value.map(evaluatedConfigurationValue)
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([name, nested]) => [name, evaluatedConfigurationValue(nested)]),
    )
  }
  return value
}

function isEvaluable(value: unknown): value is Evaluable {
  return isRecord(value) && 'evaluate' in value && typeof value['evaluate'] === 'function'
}

// Mirrors `isRecord` in packages/shared/shared-src/core/Json.ts; `runtime-mirrors.test.ts` keeps them in step.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class RuntimeDataSchema {
  readonly name: string
  private automaticResetAttempted = false
  private automaticResetPromise: Promise<void> | undefined
  private bufferedRemoteSnapshot: { stored: string | undefined } | undefined
  private committedData: StoredData
  private writeBaseline = ''
  private error = ''
  private errorRecoverable = false
  private failedSaveSequence: number | undefined
  private fills = new Map<string, FillState>()
  private generation = 0
  private sealed = false
  private fixtureActor: string | undefined
  private pendingFills = new Set<Promise<void>>()
  private pendingWriteIntents = new Map<string, TaoDataWriteIntent>()
  private handles = new Map<string, RuntimeEntityHandle>()
  /**
   * linkedStores are the stores compiled into the same project as this one, which is the only set a
   * reference may resolve into. Resolving against every schema in the process would let two projects
   * mounted side by side — Studio does this — answer each other's references.
   */
  private linkedStores: readonly RuntimeDataSchema[] = [this]
  /** referencePlaceholders are the absent rows references have named, by synthetic handle id. */
  private referencePlaceholders = new Map<string, { entity: string; field: string; value: string | number }>()
  private listeners = new Set<() => void>()
  private loadPromise: Promise<void> = Promise.resolve()
  private nextSaveSequence = 0
  private connection: TaoDataConnection
  private completedSaveSequence = 0
  private committedAccessDepth = 0
  private hasUsableSnapshot = false
  private providerBinding: ProviderBinding
  private providerUnsubscribe: (() => void) | undefined
  private writeUnsubscribe: (() => void) | undefined
  private saveQueue: Promise<void> = Promise.resolve()
  private status: DataStatus = 'loading'
  private version = 0

  constructor(
    readonly definition: TaoDataSchemaDefinition,
    connection: TaoDataConnection,
    providerBinding?: ProviderBinding,
    private readonly createId?: () => string,
  ) {
    validateDefinition(definition)
    this.name = definition.name
    this.connection = connection
    this.providerBinding = providerBinding
    this.committedData = emptyData(definition)
    this.configure(connection, providerBinding)
  }

  readonly subscribe = (listener: () => void): () => void => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly snapshot = (): number => this.version

  /** captureSnapshot returns the exact runtime-owned provider envelope without provider secrets. */
  captureSnapshot(): string {
    return JSON.stringify(envelope(this.committedData, this.definition))
  }

  canReset(): boolean {
    return this.connection.reset !== undefined
  }

  captureIdentity(): string {
    const binding = this.providerBinding
    if (typeof binding !== 'object') {
      return `${String(binding ?? 'unbound')}:${this.name}`
    }
    const declaration = binding.declaration.canonicalIdentity?.canonical ?? binding.declaration.name
    const storageKey = this.validatedStorageKey(binding.declaration.name, binding.configuration, binding.storageName)
    return JSON.stringify([declaration, storageKey, this.name, ...(binding.auth ? [binding.auth.accountId] : [])])
  }

  async resetFromRecovery(): Promise<void> {
    RuntimeAssert.defined(
      this.connection.reset,
      `datasource '${this.name}' exposes the provider reset its recovery offer promised`,
      { datasource: this.name },
    )
    await this.connection.reset()
    this.configure(this.connection, this.providerBinding)
    await this.settle()
  }

  async restoreCapturedSnapshot(snapshot: string): Promise<void> {
    const previous = this.captureSnapshot()
    try {
      await this.connection.save(snapshot)
      this.applySnapshot(snapshot)
    } catch (error) {
      this.applySnapshot(previous)
      throw error
    }
  }

  private get data(): StoredData {
    return this.committedAccessDepth > 0
      ? this.committedData
      : existingTransactionResource<ActionDataOverlay>(this)?.working ?? this.committedData
  }

  private set data(value: StoredData) {
    this.validateUnique(value)
    if (this.committedAccessDepth > 0) {
      this.committedData = value
      return
    }
    const overlay = existingTransactionResource<ActionDataOverlay>(this)
    if (overlay) {
      overlay.working = value
      return
    }
    this.committedData = value
  }

  serializeReference(handle: RuntimeEntityHandle): TaoEntityReferenceSnapshot {
    const metadata = this.requireOwnedHandle(handle)
    const token = this.connection.referenceToken?.({ entity: metadata.entity, id: metadata.id, schema: this.name })
    if (token === undefined) {
      throw new UserInputError(`Datasource provider for '${this.name}' does not support restoration references.`, {
        datasource: this.name,
      })
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
      throw new UserInputError(`Datasource provider for '${this.name}' cannot resolve restoration references.`, {
        datasource: this.name,
      })
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
      // `this.error` is the provider's own load or save failure sentence, already user-facing.
      throw new HostEnvironmentError(this.error, { details: { datasource: this.name } })
    }
  }

  /**
   * validateConfigured runs the runtime-owned configuration checks without connecting a provider —
   * how a Tao behavior test surfaces a configuration mistake that would otherwise first fire at a
   * production mount.
   */
  validateConfigured(source: TaoConfiguredDatasource, storageName?: string): void {
    this.validatedStorageKey(source.declaration.name, evaluatedDatasourceConfiguration(source), storageName)
  }

  /**
   * bindConfigured connects the datasource an app binds to this store. `storageName` is the name of the
   * bound `datasource` declaration when there is one: it is the storage key a provider defaults to, so
   * a store keeps its saved rows when collections or alternatives are added, and a stub standing in for
   * the real datasource keeps rows of its own.
   */
  bindConfigured(source: TaoConfiguredDatasource, storageName?: string, auth?: TaoDataAuthBinding): void {
    // A rebind is compared by evaluated configuration value, not object identity: the app root
    // constructs a fresh configured value per render, while a Patch that changes `Adapter` or
    // `StorageKey` under the same declaration must still rebind.
    const configuration = evaluatedDatasourceConfiguration(source)
    if (
      typeof this.providerBinding === 'object'
      && this.providerBinding.declaration === source.declaration
      && this.providerBinding.storageName === storageName
      && this.providerBinding.auth === auth
      && configurationValuesEqual(this.providerBinding.configuration, configuration)
    ) {
      return
    }
    const binding = Object.freeze({
      configuration,
      declaration: source.declaration,
      ...(auth === undefined ? {} : { auth }),
      ...(storageName === undefined ? {} : { storageName }),
    })
    // A configuration or connect failure becomes data error state behind the recovery overlay; a
    // throw would escape into the mounting layout effect, where no error boundary catches it.
    try {
      // The auth scope binds an account only after this datasource's `authenticate` resolved it, or
      // for TestAuth fixtures; the pairing check lives there, where both declarations are known.
      const baseStorageKey = this.validatedStorageKey(source.declaration.name, configuration, storageName)
      const storageKey = auth ? JSON.stringify([baseStorageKey, auth.accountId]) : baseStorageKey
      const connection = source.declaration.provider.connect(Object.freeze({
        ...(auth === undefined ? {} : { auth }),
        configuration,
        schema: this.definition,
        storageKey,
      }))
      this.configure(auth ? accountConnection(connection, auth) : connection, binding)
    } catch (error) {
      this.configure(brokenConnection(error), binding)
    }
  }

  configure(
    connection: TaoDataConnection,
    providerBinding?: ProviderBinding,
  ): void {
    this.sealed = false
    const generation = ++this.generation
    this.providerUnsubscribe?.()
    this.providerUnsubscribe = undefined
    this.writeUnsubscribe?.()
    this.writeUnsubscribe = undefined
    const previousConnection = this.connection
    if (previousConnection !== connection) {
      // Queued saves already hold committed data, so the outgoing connection closes only after
      // its save chain settles — a rebind must not reject an in-flight save. The queue never
      // rejects, and a connection still loading has an empty queue, so this cannot dangle.
      void this.saveQueue.then(() => previousConnection.close?.())
    }
    this.connection = connection
    this.providerBinding = providerBinding
    this.writeUnsubscribe = connection.writes?.subscribe(() => {
      if (generation === this.generation && connection === this.connection) {
        this.emit()
      }
    })
    this.bufferedRemoteSnapshot = undefined
    this.committedData = emptyData(this.definition)
    this.writeBaseline = JSON.stringify(envelope(this.committedData, this.definition))
    this.handles.clear()
    this.fills.clear()
    this.pendingWriteIntents.clear()
    // A placeholder belongs to the connection that was asked for its row; a new one asks again.
    this.referencePlaceholders.clear()
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

  /** seal clears live handles immediately and disables writes while an account is absent. */
  seal(): void {
    if (this.sealed) {
      return
    }
    this.configure({ load: () => undefined, save: () => undefined })
    this.sealed = true
    this.status = 'unauthorized'
    this.emit()
  }

  /** invalidateAuth begins provider cleanup before dropping every live account row. */
  invalidateAuth(): Promise<void> {
    try {
      return Promise.resolve(this.connection.invalidateAuth?.())
    } catch (error) {
      return Promise.reject(error)
    } finally {
      this.seal()
    }
  }

  /** entity returns an availability-aware handle even before its trusted account row arrives. */
  entity(entity: string, id: string): RuntimeEntityHandle {
    this.requireEntity(entity)
    return this.handle(entity, id)
  }

  /** TestAuth alone can select a one-operation actor without changing the mounted session. */
  withFixtureActor<ResultT>(accountId: string, body: () => ResultT): ResultT {
    RuntimeAssert.input(
      typeof this.providerBinding === 'object' && this.providerBinding.auth?.testing === true,
      'Fixture actor overrides require TestAuth.',
    )
    const previous = this.fixtureActor
    this.fixtureActor = accountId
    try {
      return body()
    } finally {
      this.fixtureActor = previous
    }
  }

  query(plan: TaoQueryPlan): unknown[] {
    const entity = this.requireEntity(plan.entity)
    const filters = plan.filters.map(filter => ({
      filter,
      expected: queryFilterValue(plan.entity, entity, filter, this),
    }))
    const searchFields = plan.search ? searchFieldNames(entity) : undefined
    const searchTerm = plan.search ? querySearchTerm(plan.search) : undefined
    const source = this.data.rows[plan.entity] ?? []
    const rows = source
      .filter(row =>
        this.canAccess(plan.entity, row, 'read')
        && filters.every(({ filter, expected }) => matchesFilter(row, filter, expected))
        && (searchTerm === undefined || matchesSearch(row, searchFields!, searchTerm))
      )
      .map(row => this.handle(plan.entity, row.Id))
    const order = plan.order ?? entity.defaultOrder
    if (order) {
      const multiplier = order.direction === 'desc' ? -1 : 1
      Arrays.sortInPlace(
        rows,
        (left, right) => compare(this.read(left, order.field), this.read(right, order.field)) * multiplier,
      )
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

  /** interactionCandidates exposes real stored handles, never cold-reference placeholders. */
  interactionCandidates(entity: string): readonly unknown[] {
    return this.definition.entities[entity] === undefined ? [] : this.query({ entity, filters: [] })
  }

  /**
   * queryActivationKey identifies one query's fill descriptor, or undefined when the connection
   * has no fill half. The key is what `Query` re-activates on, so it must be stable across renders.
   */
  queryActivationKey(plan: TaoQueryPlan): string | undefined {
    if (!this.connection.fill) {
      return undefined
    }
    const where = Arrays.sorted(
      Object.entries(this.equalityFilterValues(plan)),
      ([left], [right]) => left < right ? -1 : 1,
    )
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
    this.withCommittedData(() => this.upsertFromFillIntoCommittedStore(entityName, rows))
  }

  private upsertFromFillIntoCommittedStore(entityName: string, rows: readonly Record<string, unknown>[]): void {
    this.requireReady('fill')
    const entity = this.requireEntity(entityName)
    const uniqueField = Object.entries(entity.fields).find(([, field]) => field.unique)?.[0]
    RuntimeAssert.input(uniqueField, `Fill upsert into '${entityName}' requires a field marked (unique).`, {
      entityName,
    })
    const next = [...(this.data.rows[entityName] ?? [])]
    for (const raw of rows) {
      const resolved = this.resolveFillRow(entityName, entity, raw)
      const uniqueValue: unknown = resolved[uniqueField]
      RuntimeAssert.input(
        uniqueValue !== undefined,
        `Fill upsert into '${entityName}' is missing unique field '${uniqueField}'.`,
        { entityName },
      )
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
        throw new UserInputError(`Entity '${entityName}' has no fillable field '${name}'.`, {
          entityName,
          fieldName: name,
        })
      }
      // A reference arrives as the target's unique value, which is what it is stored as: the fill
      // cannot resolve a row this store does not hold, and does not need to.
      if (field.kind === 'reference') {
        RuntimeAssert.input(
          typeof value === 'string' || typeof value === 'number',
          `Fill reference '${entityName}.${name}' expects the ${field.relation} ${field.referenceField} value.`,
          { entityName, fieldName: name },
        )
        resolved[name] = value
        continue
      }
      if (field.kind !== 'relation') {
        RuntimeAssert.input(
          valueMatchesField(value, field),
          `Fill field '${entityName}.${name}' expects ${field.kind}, got ${value === null ? 'null' : typeof value}.`,
          { entityName, fieldName: name },
        )
        resolved[name] = value
        continue
      }
      RuntimeAssert.input(
        typeof value === 'object' && value !== null,
        `Fill relation '${entityName}.${name}' expects an object naming the ${field.relation} unique field.`,
        { entityName, fieldName: name },
      )
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
      throw new UserInputError(`Fill relation '${entityName}.${fieldName}' must name ${targetEntity}'s unique field.`, {
        entityName,
        fieldName,
      })
    }
    const expected = reference[uniqueField]
    const row = (this.data.rows[targetEntity] ?? []).find(candidate => Object.is(candidate[uniqueField], expected))
    RuntimeAssert.input(
      row,
      `Fill relation '${entityName}.${fieldName}' references no stored ${targetEntity} with `
        + `${uniqueField} '${String(expected)}'. Upsert the ${targetEntity} rows first in the same fill.`,
      { entityName, fieldName },
    )
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
        throw new UserInputError(`Fill upsert into '${entityName}' is missing required field '${name}'.`, {
          entityName,
          fieldName: name,
        })
      }
    }
    return row
  }

  create(entityName: string, values: Record<string, unknown>): RuntimeEntityHandle {
    this.ensureActionOverlay()
    this.requireReady('create')
    const entity = this.requireEntity(entityName)
    const fields = rowValues(entityName, entity, values, this)
    const id = this.nextAvailableId(entityName)
    const row: StoredRow = { Id: id, ...fields }
    this.requireAccess(entityName, row, 'create')
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
    this.ensureActionOverlay()
    this.requireReady('update')
    const metadata = this.requireOwnedHandle(handle)
    const entity = this.requireEntity(metadata.entity)
    const existing = this.storedRow(metadata.entity, metadata.id)
    RuntimeAssert.input(existing, `Cannot update deleted ${metadata.entity} '${metadata.id}'.`, {
      entity: metadata.entity,
    })
    const fields = partialRowValues(metadata.entity, entity, values, this)
    this.requireAccess(metadata.entity, { ...existing, ...fields }, 'update', Object.keys(fields))
    this.recordWriteIntent(metadata.entity, metadata.id, Object.keys(fields))
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

  /** submitUpdate keeps form inputs private until its transport confirms the submitted fields. */
  async submitUpdate(
    handle: RuntimeEntityHandle,
    values: Record<string, unknown>,
  ): Promise<{ status: 'queued' | 'saved' }> {
    this.requireReady('submit')
    const metadata = this.requireOwnedHandle(handle)
    const definition = this.requireEntity(metadata.entity)
    const existing = this.committedData.rows[metadata.entity]?.find(row => row.Id === metadata.id)
    RuntimeAssert.input(existing !== undefined, `Cannot submit missing ${metadata.entity} '${metadata.id}'.`)
    const submit = this.connection.submit
    RuntimeAssert.input(submit !== undefined, 'This datasource cannot confirm a submitted profile change.')
    const fields = partialRowValues(metadata.entity, definition, values, this)
    this.requireAccess(metadata.entity, { ...existing, ...fields }, 'update', Object.keys(fields))
    const base = cloneStoredData(this.committedData)
    const candidate = cloneStoredData(base)
    candidate.rows[metadata.entity] = candidate.rows[metadata.entity]!.map(row =>
      row.Id === metadata.id ? { ...row, ...fields } : row
    )
    this.validateUnique(candidate)
    const snapshot = JSON.stringify(envelope(candidate, this.definition))
    const context = { previousSnapshot: JSON.stringify(envelope(base, this.definition)) }
    const intents = [{ entity: metadata.entity, id: metadata.id, fields: Object.keys(fields) }]
    const generation = this.generation
    const connection = this.connection
    const sequence = ++this.nextSaveSequence
    const submission = this.saveQueue.then(async () => {
      RuntimeAssert.input(generation === this.generation, 'This session is no longer active.')
      const receipt = await submit.call(connection, snapshot, intents, context)
      RuntimeAssert.input(generation === this.generation, 'This session is no longer active.')
      if (receipt.status === 'saved') {
        const current = cloneStoredData(this.committedData)
        current.rows[metadata.entity] = (current.rows[metadata.entity] ?? []).map(row => {
          if (row.Id !== metadata.id) {
            return row
          }
          const confirmed = Object.fromEntries(
            Object.entries(fields).filter(([name]) => Object.is(row[name], existing[name])),
          )
          return { ...row, ...confirmed }
        })
        this.validateUnique(current)
        this.committedData = current
        this.writeBaseline = JSON.stringify(envelope(current, this.definition))
        this.emit()
      }
      return receipt
    })
    this.saveQueue = submission.then(() => undefined, () => undefined).finally(() => {
      if (generation === this.generation) {
        this.completedSaveSequence = sequence
        this.replayBufferedSnapshot(generation)
      }
    })
    return submission
  }

  delete(handle: RuntimeEntityHandle): void {
    this.ensureActionOverlay()
    this.requireReady('delete')
    const metadata = this.requireOwnedHandle(handle)
    RuntimeAssert.input(
      this.storedRow(metadata.entity, metadata.id),
      `Cannot delete missing ${metadata.entity} '${metadata.id}'.`,
      { entity: metadata.entity },
    )
    this.requireAccess(metadata.entity, this.storedRow(metadata.entity, metadata.id)!, 'delete')
    const targets = new Map<string, DeleteTarget>()
    this.collectDeleteTargets(metadata.entity, metadata.id, targets)
    const rows = Object.fromEntries(
      Object.entries(this.data.rows).map(([entity, entityRows]) => {
        return [entity, entityRows.filter(row => !targets.has(handleKey(entity, row.Id)))]
      }),
    )
    this.data = { nextId: this.data.nextId, rows }
    if (!existingTransactionResource<ActionDataOverlay>(this)) {
      for (const target of targets.values()) {
        this.handles.delete(handleKey(target.entity, target.id))
      }
    }
    this.commit()
  }

  read(handle: RuntimeEntityHandle, member: string): unknown {
    const metadata = this.requireOwnedHandle(handle)
    if (member === 'Id') {
      return metadata.id
    }
    if (
      member === 'WritesQueued' || member === 'WritesFailed' || member === 'WriteError' || member === 'CanRetryWrites'
    ) {
      const writeStatus = this.writeStatus(handle)
      if (member === 'WritesQueued') {
        return writeStatus.Queued
      }
      if (member === 'WritesFailed') {
        return writeStatus.Failed
      }
      if (member === 'WriteError') {
        return writeStatus.Message
      }
      return writeStatus.Supported && writeStatus.Failed > 0
    }
    const row = this.storedRow(metadata.entity, metadata.id)
    if (row && !this.canAccess(metadata.entity, row, 'read')) {
      return undefined
    }
    const entity = this.definition.entities[metadata.entity]
    const inverse = entity?.inverseFields?.[member]
    if (inverse) {
      return (this.data.rows[inverse.relation] ?? [])
        .filter(candidate => candidate[inverse.inverseField] === metadata.id)
        .filter(candidate => this.canAccess(inverse.relation, candidate, 'read'))
        .map(candidate => this.handle(inverse.relation, candidate.Id))
    }
    const field = entity?.fields[member]
    const value = row?.[member]
    if (!field) {
      return value
    }
    return RuntimeSwitch(field.kind, {
      boolean: () => value,
      number: () => value,
      text: () => value,
      time: () => value,
      enum: () => typeof value === 'string' ? field.enumValues?.()[value]?.evaluate().jsValue ?? value : value,
      reference: () => this.resolveReference(field, value),
      relation: () => {
        if (typeof value !== 'string' || !field.relation) {
          return value
        }
        return this.authenticated || this.storedRow(field.relation, value)
          ? this.handle(field.relation, value)
          : undefined
      },
    })
  }

  writeStatus(handle: RuntimeEntityHandle): TaoEntityWriteStatus {
    const metadata = this.requireOwnedHandle(handle)
    const writes = this.connection.writes
    if (writes === undefined) {
      return { Failed: 0, Message: '', Queued: 0, Supported: false }
    }
    const status = writes.status(metadata.entity, metadata.id)
    return {
      Failed: status.failed,
      Message: status.records.flatMap(record => record.message === undefined ? [] : [record.message]).join('\n'),
      Queued: status.queued,
      Supported: true,
    }
  }

  retryWrites(handle: RuntimeEntityHandle): void {
    const metadata = this.requireOwnedHandle(handle)
    const writes = this.connection.writes
    if (writes === undefined) {
      throw new UserInputError(
        `Cannot retry writes for data schema '${this.name}' because its provider does not record them.`,
        {
          datasource: this.name,
        },
      )
    }
    writes.retry(metadata.entity, metadata.id)
  }

  /** linkStores records the stores one compiled project mounts, so references resolve among them. */
  linkStores(stores: readonly RuntimeDataSchema[]): void {
    this.linkedStores = stores.includes(this) ? stores : [this, ...stores]
  }

  /**
   * A reference reads as a handle whenever it holds a value, whether or not its target row is present,
   * so a guard can say which it is: the row itself when the store holds it, and otherwise a stable
   * placeholder whose availability is `loading` while the store loads or fetches it, `error` when that
   * fetch failed, and `missing` once there is nothing left to wait for. A cleared reference is `none`.
   */
  private resolveReference(field: TaoDataField, value: unknown): unknown {
    if (value === null || value === undefined) {
      return undefined
    }
    const target = this.linkedStores.find(store =>
      field.store === undefined ? store.definition.entities[field.relation!] !== undefined : store.name === field.store
    )
    RuntimeAssert.input(
      target,
      `Reference to ${field.relation} names store '${field.store ?? ''}', which this project does not mount.`,
      { entity: field.relation },
    )
    return target.referencedHandle(field.relation!, field.referenceField!, value as string | number)
  }

  /**
   * referencedHandle returns this store's row whose unique field holds the value, or a placeholder for
   * it. The first time a placeholder is named, a fill-capable connection is offered the one-row query
   * that would bring it, which is how a bookmark opens a story the feed has not served yet.
   */
  referencedHandle(entity: string, uniqueField: string, value: string | number): RuntimeEntityHandle {
    const row = (this.data.rows[entity] ?? []).find(candidate => candidate[uniqueField] === value)
    if (row) {
      return this.handle(entity, row.Id)
    }
    // Entity is part of the identity: two collections routinely use the same unique field name and
    // value, and their cold handles must neither alias nor share one fill request.
    const id = `@reference:${entity}.${uniqueField}=${JSON.stringify(value)}`
    if (!this.referencePlaceholders.has(id)) {
      this.referencePlaceholders.set(id, { entity, field: uniqueField, value })
      this.activateQuery(this.referencePlan(entity, uniqueField, value))
    }
    return this.handle(entity, id)
  }

  /** referencePlaceholderValue returns the unique value a placeholder handle stands for. */
  referencePlaceholderValue(handle: RuntimeEntityHandle): string | number | undefined {
    const metadata = metadataOf(handle)
    return metadata.schema === this ? this.referencePlaceholders.get(metadata.id)?.value : undefined
  }

  /** referencePlan is the one-row query a placeholder stands for, shaped as a live query would be. */
  private referencePlan(entity: string, uniqueField: string, value: string | number): TaoQueryPlan {
    const evaluated = { evaluate: () => evaluated, jsValue: value }
    return { entity, filters: [{ field: uniqueField, operator: '==', value: () => evaluated }], limit: 1 }
  }

  relationId(handle: RuntimeEntityHandle, expectedEntity: string, context: string): string {
    const candidate = metadataOf(handle)
    RuntimeAssert.input(
      candidate.schema === this,
      `${context} expects ${expectedEntity} from data schema '${this.name}', but received ${candidate.entity} `
        + `'${candidate.id}' from a different data schema instance named '${candidate.schema.name}'.`,
      { context },
    )
    const metadata = this.requireOwnedHandle(handle)
    RuntimeAssert.input(
      metadata.entity === expectedEntity,
      `${context} expects ${expectedEntity}, got ${metadata.entity}.`,
      { context },
    )
    RuntimeAssert.input(
      this.storedRow(metadata.entity, metadata.id),
      `${context} refers to missing ${expectedEntity} '${metadata.id}'.`,
      { context },
    )
    return metadata.id
  }

  availability(handle: RuntimeEntityHandle): TaoEntityAvailability {
    const metadata = metadataOf(handle)
    if (metadata.schema !== this) {
      return { status: 'missing' }
    }
    const placeholder = this.referencePlaceholders.get(metadata.id)
    if (placeholder) {
      return this.placeholderAvailability(metadata.entity, placeholder)
    }
    return RuntimeSwitch<DataStatus, TaoEntityAvailability>(this.status, {
      error: () =>
        this.errorRecoverable
          && (!TestWorld.isSnapshotConnection(this.connection) || this.failedSaveSequence === undefined)
          && metadata.generation === this.generation
          && this.storedRow(metadata.entity, metadata.id)
          ? this.canAccess(metadata.entity, this.storedRow(metadata.entity, metadata.id)!, 'read')
            ? { status: 'available' }
            : { status: 'unauthorized' }
          : { message: this.error, status: 'error' },
      loading: () => ({ status: 'loading' }),
      ready: () => {
        if (metadata.generation !== this.generation) {
          return { status: 'missing' }
        }
        const row = this.storedRow(metadata.entity, metadata.id)
        return row
          ? this.canAccess(metadata.entity, row, 'read') ? { status: 'available' } : { status: 'unauthorized' }
          : { status: 'missing' }
      },
      unauthorized: () => ({ status: 'unauthorized' }),
    })
  }

  /**
   * A placeholder is never `available`: once its row lands, the next read of the reference returns the
   * row's own handle, so until that re-render the placeholder still reads as loading.
   */
  private placeholderAvailability(
    entity: string,
    placeholder: { entity: string; field: string; value: string | number },
  ): TaoEntityAvailability {
    if (this.status === 'loading') {
      return { status: 'loading' }
    }
    if (this.status === 'error') {
      return { message: this.error, status: 'error' }
    }
    const present = (this.data.rows[entity] ?? []).some(row => row[placeholder.field] === placeholder.value)
    const fill = this.fillState(this.referencePlan(entity, placeholder.field, placeholder.value))
    if (present || fill?.status === 'filling') {
      return { status: 'loading' }
    }
    if (fill?.status === 'failed') {
      return { message: fill.message, status: 'error' }
    }
    return { status: 'missing' }
  }

  async settle(): Promise<void> {
    // A corrupt disposable snapshot can replace this load with an automatic reset and a new load.
    // Settle owns that whole lifecycle, not merely the load that discovered the corruption.
    while (true) {
      await this.loadPromise
      while (this.pendingFills.size > 0) {
        await Promise.all([...this.pendingFills])
      }
      await this.saveQueue
      const automaticReset = this.automaticResetPromise
      if (automaticReset === undefined) {
        return
      }
      await automaticReset
    }
  }

  /** Await this selected app store and surface provider failures swallowed by its save queue. */
  async settleForCommand(): Promise<void> {
    let pending: Promise<void>
    do {
      pending = this.saveQueue
      await this.settle()
    } while (pending !== this.saveQueue)
    if (this.status !== 'ready') {
      throw new HostEnvironmentError(this.error || `Datasource '${this.name}' is ${this.status}.`, {
        details: { datasource: this.name, status: this.status },
      })
    }
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
        RuntimeAssert.input(
          (field.onDelete ?? 'restrict') === 'cascade',
          `Cannot delete ${entity} '${id}' because ${relatedEntityName}.${fieldName} still refers to it.`,
          { entity },
        )
        for (const row of referringRows) {
          this.collectDeleteTargets(relatedEntityName, row.Id, targets)
        }
      }
    }
  }

  private commit(intents?: ReadonlyMap<string, TaoDataWriteIntent>): void {
    if (this.committedAccessDepth === 0 && existingTransactionResource<ActionDataOverlay>(this)) {
      return
    }
    const generation = this.generation
    const connection = this.connection
    const saveSequence = ++this.nextSaveSequence
    const serialized = JSON.stringify(envelope(this.data, this.definition))
    const context = { previousSnapshot: this.writeBaseline }
    this.writeBaseline = serialized
    const submitted = intents === undefined ? [...this.pendingWriteIntents.values()] : [...intents.values()]
    if (intents === undefined) {
      this.pendingWriteIntents.clear()
    }
    this.emit()
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        await connection.save(serialized, submitted, context)
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

  private ensureActionOverlay(): void {
    transactionResource<ActionDataOverlay>(
      this,
      () => ({
        generation: this.generation,
        base: cloneStoredData(this.committedData),
        intents: new Map(),
        working: cloneStoredData(this.committedData),
      }),
      overlay => {
        RuntimeAssert.defined(overlay.prepared, 'an action data transaction prepares its deltas before committing')
        overlay.previous = this.committedData
        this.committedData = overlay.prepared
        this.commit(overlay.intents)
      },
      overlay => {
        RuntimeAssert.input(
          overlay.generation === this.generation,
          'This data action belongs to a session that is no longer active.',
        )
        overlay.prepared = applyStoredDataDelta(overlay.base, overlay.working, this.committedData, overlay.intents)
        this.validateUnique(overlay.prepared)
        this.validateAccessDelta(this.committedData, overlay.prepared, overlay.intents)
      },
      overlay => {
        if (overlay.previous) {
          this.committedData = overlay.previous
          this.commit()
        }
      },
      overlay => describeDataOverlay(overlay),
      // Writes replace `working` and its row lists rather than editing them, so the rows it held are
      // the savepoint. The id counter is deliberately not restored: ids stay monotonic, so a row the
      // rolled-back verb created never lends its id, or a handle cached for it, to a later row.
      overlay => {
        const rows = overlay.working.rows
        const intents = new Map(overlay.intents)
        return () => {
          overlay.working = { ...overlay.working, rows }
          overlay.intents.clear()
          for (const [key, intent] of intents) {
            overlay.intents.set(key, intent)
          }
        }
      },
    )
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

  private recordWriteIntent(entity: string, id: string, fields: readonly string[]): void {
    if (fields.length === 0) {
      return
    }
    const key = handleKey(entity, id)
    const intents = existingTransactionResource<ActionDataOverlay>(this)?.intents ?? this.pendingWriteIntents
    const prior = intents.get(key)
    intents.set(key, {
      entity,
      fields: [...new Set([...(prior?.fields ?? []), ...fields])],
      id,
    })
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
      const connection = this.connection
      // A transport failure gets a plain retry; only provably corrupt stored data offers the
      // destructive reset, so a transient outage can never wipe a provider's good snapshot. And
      // the reset exists only where the connection grants it: a connection without `reset` — a
      // shared remote store, deliberately — keeps the retry, because overwriting data this client
      // failed to parse could erase every peer's rows.
      if (
        cause === 'corrupt' && connection.reset !== undefined && connection.automaticReset
        && !this.automaticResetAttempted
      ) {
        // A disposable store resets itself once per corrupt load. Should the emptied store still
        // fail to parse, the second failure lands here with the attempt spent and offers the
        // ordinary overlay instead of looping.
        this.automaticResetAttempted = true
        const automaticReset = this.resetAutomatically(connection, this.providerBinding)
        const trackedReset = automaticReset.finally(() => {
          if (this.automaticResetPromise === trackedReset) {
            this.automaticResetPromise = undefined
          }
        })
        this.automaticResetPromise = trackedReset
        this.emit()
        return
      }
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

  /** resetAutomatically wipes a disposable store and reloads it; a failed wipe falls back to the overlay. */
  private async resetAutomatically(connection: TaoDataConnection, providerBinding: ProviderBinding): Promise<void> {
    try {
      await connection.reset?.()
    } catch (error) {
      if (this.connection !== connection) {
        return
      }
      this.error = `Could not reset data: ${errorMessage(error)}`
      DataLoadRecovery.report(this, this.error, {
        label: 'Reset app data and reload',
        run: () => this.recoverAfterLoadFailure(true),
      })
      this.emit()
      return
    }
    if (this.connection === connection) {
      this.configure(connection, providerBinding)
    }
  }

  /** applySnapshot replaces the store with one parsed snapshot; a parse failure throws unapplied. */
  private applySnapshot(stored: string | undefined): void {
    this.committedData = stored === undefined
      ? emptyData(this.definition)
      : parseEnvelope(stored, this.definition, this.authenticated)
    this.writeBaseline = JSON.stringify(envelope(this.committedData, this.definition))
    this.automaticResetAttempted = false
    this.failedSaveSequence = undefined
    this.errorRecoverable = false
    this.hasUsableSnapshot = true
    this.status = 'ready'
    this.error = ''
    DataLoadRecovery.resolve(this)
    this.emit()
  }

  private get authenticated(): boolean {
    return typeof this.providerBinding === 'object' && this.providerBinding.auth !== undefined
  }

  private canAccess(
    entity: string,
    row: StoredRow,
    operation: 'read' | 'create' | 'update' | 'delete',
    fields: readonly string[] = [],
  ): boolean {
    const auth = typeof this.providerBinding === 'object' ? this.providerBinding.auth : undefined
    return !auth
      || (!auth.signal.aborted
        && dataAccessAllowed(
          this.definition,
          this.data,
          this.fixtureActor ?? auth.accountId,
          entity,
          row,
          operation,
          fields,
        ))
  }

  private requireAccess(
    entity: string,
    row: StoredRow,
    operation: 'create' | 'update' | 'delete',
    fields: readonly string[] = [],
  ): void {
    RuntimeAssert.input(
      this.canAccess(entity, row, operation, fields),
      `You do not have permission to ${operation} this ${entity}.`,
    )
  }

  private validateAccessDelta(
    before: StoredData,
    after: StoredData,
    intents: ReadonlyMap<string, TaoDataWriteIntent>,
  ): void {
    const auth = typeof this.providerBinding === 'object' ? this.providerBinding.auth : undefined
    if (!auth) {
      return
    }
    const check = (
      entity: string,
      row: StoredRow,
      operation: 'create' | 'update' | 'delete',
      fields: readonly string[] = [],
    ): void => {
      RuntimeAssert.input(
        !auth.signal.aborted
          && dataAccessAllowed(
            this.definition,
            after,
            this.fixtureActor ?? auth.accountId,
            entity,
            row,
            operation,
            fields,
          ),
        `You do not have permission to ${operation} this ${entity}.`,
      )
    }
    for (const entity of Object.keys(this.definition.entities)) {
      const previous = new Map((before.rows[entity] ?? []).map(row => [row.Id, row]))
      const current = new Map((after.rows[entity] ?? []).map(row => [row.Id, row]))
      for (const row of current.values()) {
        const old = previous.get(row.Id)
        if (!old) {
          check(entity, row, 'create')
          continue
        }
        const fields = new Set(Object.keys(row).filter(field => field !== 'Id' && !Object.is(old[field], row[field])))
        for (const intent of intents.values()) {
          if (intent.entity === entity && intent.id === row.Id) {
            for (const field of intent.fields) {
              fields.add(field)
            }
          }
        }
        if (fields.size) {
          check(entity, row, 'update', [...fields])
        }
      }
      for (const row of previous.values()) {
        if (!current.has(row.Id)) {
          check(entity, row, 'delete')
        }
      }
    }
  }

  private validateUnique(data: StoredData): void {
    for (const [name, entity] of Object.entries(this.definition.entities)) {
      validateUniqueRows(name, entity, data.rows[name] ?? [])
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
    const serialized = JSON.stringify(envelope(this.committedData, this.definition))
    const matchesLocal = stored === serialized || (
      stored === undefined && Object.values(this.committedData.rows).every(rows => rows.length === 0)
    )
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
      id = this.createId?.() ?? `${entity}-${this.data.nextId++}`
    } while (this.storedRow(entity, id))
    return id
  }

  private requireEntity(entity: string): TaoDataEntity {
    const definition = this.definition.entities[entity]
    RuntimeAssert.input(definition, `Data schema '${this.name}' has no entity '${entity}'.`, {
      entity,
      schema: this.name,
    })
    return definition
  }

  private requireOwnedHandle(handle: RuntimeEntityHandle): RuntimeEntityMetadata {
    const metadata = metadataOf(handle)
    RuntimeAssert.input(
      metadata.schema === this,
      `Entity handle '${metadata.id}' belongs to a different data schema.`,
      { schema: this.name },
    )
    RuntimeAssert.input(
      metadata.generation === this.generation,
      `Entity handle '${metadata.id}' belongs to an inactive provider generation.`,
      { schema: this.name },
    )
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
    throw new UserInputError(`Cannot ${operation} data while the provider is ${this.status}.`, {
      operation,
      status: this.status,
    })
  }

  private validatedStorageKey(
    declarationName: string,
    configuration: Readonly<Record<string, unknown>>,
    storageName?: string,
  ): string {
    const configured = configuration['StorageKey']
    if (configured !== undefined && typeof configured !== 'string') {
      throw new UserInputError(`Datasource ${declarationName} configuration 'StorageKey' expects text.`, {
        datasource: declarationName,
      })
    }
    return configured ?? storageName ?? this.definition.name
  }

  private referenceProviderIdentity(): string {
    const binding = this.providerBinding
    if (typeof binding === 'object') {
      const canonical = binding.declaration.canonicalIdentity?.canonical
      if (canonical) {
        return binding.auth ? JSON.stringify([canonical, binding.auth.accountId]) : canonical
      }
      throw new UnexpectedBehaviorError(
        `Datasource declaration '${binding.declaration.name}' has no canonical identity.`,
        { details: { datasource: binding.declaration.name } },
      )
    }
    return String(binding ?? 'unbound')
  }

  private storedRow(entity: string, id: string): StoredRow | undefined {
    return this.data.rows[entity]?.find(row => row.Id === id)
  }

  private withCommittedData<ResultT>(body: () => ResultT): ResultT {
    this.committedAccessDepth += 1
    try {
      return body()
    } finally {
      this.committedAccessDepth -= 1
    }
  }
}

/** describeDataOverlay lists the rows an action transaction would create, change, or delete at commit. */
function describeDataOverlay(overlay: ActionDataOverlay): TaoDebugPendingWrite[] {
  const writes: TaoDebugPendingWrite[] = []
  const entities = new Set([...Object.keys(overlay.base.rows), ...Object.keys(overlay.working.rows)])
  for (const entity of entities) {
    const before = new Map((overlay.base.rows[entity] ?? []).map(row => [row.Id, row]))
    const after = new Map((overlay.working.rows[entity] ?? []).map(row => [row.Id, row]))
    for (const [id, row] of after) {
      const previous = before.get(id)
      if (previous === undefined) {
        writes.push({ kind: 'data', target: `${entity}/${id}`, committed: undefined, pending: row })
      } else if (JSON.stringify(previous) !== JSON.stringify(row)) {
        writes.push({ kind: 'data', target: `${entity}/${id}`, committed: previous, pending: row })
      }
    }
    for (const [id, row] of before) {
      if (!after.has(id)) {
        writes.push({ kind: 'data', target: `${entity}/${id}`, committed: row, pending: undefined })
      }
    }
  }
  return writes
}

function cloneStoredData(data: StoredData): StoredData {
  return {
    nextId: data.nextId,
    rows: Object.fromEntries(
      Object.entries(data.rows).map(([entity, rows]) => [
        entity,
        rows.map(row => ({ ...row })),
      ]),
    ),
  }
}

/** Applies field/row deltas to the latest committed snapshot, never publishing the private overlay. */
function applyStoredDataDelta(
  base: StoredData,
  working: StoredData,
  current: StoredData,
  intents: ReadonlyMap<string, TaoDataWriteIntent>,
): StoredData {
  const rows: Record<string, StoredRow[]> = {}
  for (const entity of Object.keys(current.rows)) {
    const baseRows = new Map((base.rows[entity] ?? []).map(row => [row.Id, row]))
    const workingRows = new Map((working.rows[entity] ?? []).map(row => [row.Id, row]))
    const currentRows = new Map((current.rows[entity] ?? []).map(row => [row.Id, { ...row }]))

    for (const [id, baseRow] of baseRows) {
      const workingRow = workingRows.get(id)
      if (!workingRow) {
        currentRows.delete(id)
        continue
      }
      const currentRow = currentRows.get(id)
      RuntimeAssert.input(
        currentRow,
        `Cannot commit action update because ${entity} '${id}' was deleted concurrently.`,
        { entity },
      )
      const submitted = new Set(intents.get(handleKey(entity, id))?.fields)
      for (const [field, value] of Object.entries(workingRow)) {
        if (!Object.is(value, baseRow[field]) || submitted.has(field)) {
          currentRow[field] = value
        }
      }
    }

    for (const [id, workingRow] of workingRows) {
      if (baseRows.has(id)) {
        continue
      }
      RuntimeAssert.input(
        !currentRows.has(id),
        `Cannot commit action create because ${entity} '${id}' now exists.`,
        { entity },
      )
      currentRows.set(id, { ...workingRow })
    }
    rows[entity] = [...currentRows.values()]
  }
  return { nextId: Math.max(current.nextId, working.nextId), rows }
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
