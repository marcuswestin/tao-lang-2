import React from 'react'
import { RuntimeAssert } from './TR-assert'
import { entityHandle, metadataOf } from './TR-data-entity'
import { testDataConnection, UnboundConnection } from './TR-data-provider'
import {
  beginTest as beginDataTest,
  bindConfiguredDataSchema,
  canResetAllDataSchemas,
  captureDataSchemas,
  endTest as endDataTest,
  isDataTestMode,
  registerDataSchema,
  resetAllDataSchemas,
  restoreDataSchemas,
  revision as dataRevision,
  settleAllDataSchemas,
  subscribeAll as subscribeToAllData,
} from './TR-data-registry'
import type { TaoDataCapture } from './TR-data-registry'
import { RuntimeDataSchema } from './TR-data-schema'
import { type Evaluable, evaluatedFields } from './TR-data-values'
import type { TaoDeclarationIdentity } from './TR-navigation-identity'
import { canonicalDescriptor } from './TR-navigation-identity'
import { registerRuntimeCaptureDomain, type TaoRuntimeJson } from './TR-runtime-capture'
import { StudioEnvironmentControls } from './TR-studio-environment'

export { testProvider } from './TR-data-provider'

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
  /** title marks the one text field that names a row to a person: a label of last resort. */
  title?: boolean
  unique?: boolean
}

export type TaoDataEntity = {
  collection: string
  commandPolicy?: TaoEntityCommandPolicy
  defaultOrder?: {
    direction: 'asc' | 'desc'
    field: string
  }
  fields: Record<string, TaoDataField>
  inverseFields?: Record<string, { inverseField: string; relation: string }>
}

/** TaoEntityCommandPolicy is the generated default and withheld verb order for one entity. */
export type TaoEntityCommandPolicy = Readonly<{
  hidden: readonly string[]
  surfaced: readonly string[]
}>

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
  limit?: number
  order?: {
    direction: 'asc' | 'desc'
    field: string
  }
}

/** TaoQueryDescriptor is the serializable shape of one active query offered to a fill connection. */
export type TaoQueryDescriptor = {
  entity: string
  limit?: number
  orderBy?: string
  orderDirection?: 'asc' | 'desc'
  where: Record<string, TaoDescriptorValue>
}

/**
 * TaoDescriptorValue carries an equality filter's plain value. A related row travels as a plain
 * snapshot of its scalar fields, so an adapter reads `where.Story.HnId` without holding a handle.
 */
export type TaoDescriptorValue = boolean | number | string | Readonly<Record<string, unknown>>

export type TaoFillRequest = {
  descriptor: TaoQueryDescriptor
}

export type TaoFillOps = {
  /** upsert lands fetched rows in the store, matching existing rows by the entity's unique field. */
  upsert(entity: string, rows: readonly Record<string, unknown>[]): void
}

/**
 * TaoDataConnection is one provider connection bound to a schema and evaluated datasource config.
 *
 * The protocol deliberately exchanges complete serialized snapshots:
 * - load returns one starting snapshot or undefined for an empty mount.
 * - save receives every committed snapshot in call order and must propagate rejection.
 * - subscribe, when present, publishes complete replacement snapshots after load.
 * - close, when present, synchronously releases connection-owned resources and must not throw;
 *   the runtime calls it only after the connection's queued saves settle.
 *
 * The runtime owns schema validation, queries, identity, defaults, relationships, status, and
 * notifications. Providers own persistence and transport only. A provider must either isolate its
 * instances or share one coherent stateless storage boundary. Incremental change or sync protocols
 * belong to a future provider family rather than leaking into this full-snapshot contract.
 */
export type TaoDataConnection = {
  close?(): void
  /** referenceToken and resolveReference are the optional, versioned restoration capability. */
  referenceToken?(reference: { entity: string; id: string; schema: string }): string
  resolveReference?(reference: { entity: string; schema: string; token: string }): string | undefined
  /**
   * fill is the remote half of a query-driven connection: the schema offers each activated query
   * descriptor, and the connection fetches and upserts rows. The store keeps evaluating every
   * query locally over its rows; a fill may land a superset. Rejections become the query's failed
   * state (`stale` over cached rows, `error` over none), never a thrown render.
   */
  fill?(request: TaoFillRequest, ops: TaoFillOps): Promise<void>
  /** fillCacheMs suppresses re-fills of a descriptor filled within the window (default 0: always). */
  fillCacheMs?: number
  load(): Promise<string | undefined> | string | undefined
  /** reset is optional because remote providers may not permit destructive recovery. */
  reset?(): Promise<void> | void
  save(snapshot: string): Promise<void> | void
  subscribe?(observer: TaoDataConnectionObserver): () => void
}

/** TaoDataConnectionObserver receives provider snapshots and failures after the initial load. */
export type TaoDataConnectionObserver = Readonly<{
  error(error: unknown): void
  snapshot(value: string | undefined): void
}>

/** TaoDataProviderContext is the provider-neutral mount passed to a package implementation. */
export type TaoDataProviderContext = Readonly<{
  configuration: Readonly<Record<string, unknown>>
  schema: TaoDataSchemaDefinition
  storageKey: string
}>

/** TaoDataProvider is the clean package boundary implemented by Local, Memory, and remote providers. */
export type TaoDataProvider = {
  connect(context: TaoDataProviderContext): TaoDataConnection
  /**
   * fills marks a query-driven provider whose connections offer fill. Tao behavior tests keep the
   * fresh test Memory store for snapshot providers but bind a fill-capable provider anyway: fills
   * are how a query-driven datasource has any rows at all, and determinism is the running app
   * variant's responsibility — a test runs the variant whose adapter is a deterministic stub,
   * never the network (Decisions §11, §16).
   */
  fills?: true
}

export type TaoDataProviderFactory = () => TaoDataProvider

/** TaoDatasourceDeclaration binds one immutable Tao declaration identity to its injected provider. */
export type TaoDatasourceDeclaration = Readonly<{
  canonicalIdentity?: TaoDeclarationIdentity
  identity: symbol
  name: string
  provider: TaoDataProvider
}>

type TaoDatasourceConfiguration = Readonly<Record<string, unknown>>

/** TaoConfiguredDatasource is an immutable declaration-owned provider configuration. */
export type TaoConfiguredDatasource = Readonly<{
  bindingIdentity(): string | undefined
  config: TaoDatasourceConfiguration
  declaration: TaoDatasourceDeclaration
  evaluate(): TaoConfiguredDatasource
}>

export type TaoKeyValueStorage = {
  getItem(key: string): Promise<string | null>
  removeItem?(key: string): Promise<void>
  setItem(key: string, value: string): Promise<void>
}

type RuntimeValueFactory = <T>(value: T) => Evaluable

function useConfiguredProviderBinding(schema: RuntimeDataSchema, source: TaoConfiguredDatasource): void {
  // The wrapped declaration must be stable across renders: the app root reconstructs the
  // configured value per render, and bindConfigured treats a new declaration object as a full
  // rebind. Only `source.declaration` and the studio overlay are stable inputs.
  const studioProvider = StudioEnvironmentControls.useProvider(source.declaration.provider)
  const declaration = React.useMemo<TaoDatasourceDeclaration>(() =>
    studioProvider === source.declaration.provider
      ? source.declaration
      : Object.freeze({ ...source.declaration, provider: studioProvider }), [source.declaration, studioProvider])
  // The effect re-runs on each render's fresh `config` object and BindConfigured compares
  // evaluated configuration values to make an unchanged rebind a cheap no-op.
  React.useLayoutEffect(() => {
    DataControls.BindConfigured(
      schema,
      declaration === source.declaration ? source : DataControls.Configure(declaration, { ...source.config }),
    )
  }, [schema, declaration, source.config])
}

/** DataControls is the provider-neutral generated-code API for Tao schemas, queries, and writes. */
export const DataControls = {
  /** Declaration binds one Tao declaration identity to its package-scope provider implementation. */
  Declaration(
    name: string,
    provider: TaoDataProvider,
    canonicalIdentity?: TaoDeclarationIdentity,
  ): TaoDatasourceDeclaration {
    return Object.freeze({
      ...(canonicalIdentity ? { canonicalIdentity } : {}),
      identity: Symbol(name),
      name,
      provider,
    })
  },

  /** Configure creates an immutable declaration-owned datasource value. */
  Configure(
    declaration: TaoDatasourceDeclaration,
    config: Record<string, unknown>,
  ): TaoConfiguredDatasource {
    let configured: TaoConfiguredDatasource
    configured = Object.freeze({
      bindingIdentity: () => datasourceBindingIdentity(declaration, config),
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
    connection?: TaoDataConnection,
  ): RuntimeDataSchema {
    const selectedConnection = connection
      ?? (isDataTestMode() ? testDataConnection() : UnboundConnection(definition.name))
    const schema = new RuntimeDataSchema(
      definition,
      selectedConnection,
      isDataTestMode() ? 'test' : connection ? undefined : 'unbound',
    )
    registerDataSchema(schema)
    return schema
  },

  /** BindConfigured selects a declaration-owned provider while preserving test isolation. */
  BindConfigured(
    schema: RuntimeDataSchema,
    source: TaoConfiguredDatasource,
  ): void {
    bindConfiguredDataSchema(schema, source)
  },

  /** UseConfigured binds a declaration-owned datasource configuration at an app root. */
  UseConfigured: useConfiguredProviderBinding,

  Query(schema: RuntimeDataSchema, plan: TaoQueryPlan, value: RuntimeValueFactory): Evaluable {
    React.useSyncExternalStore(schema.subscribe, schema.snapshot, schema.snapshot)
    // A fill-capable provider is offered each live query's descriptor: on mount, and again
    // whenever the descriptor itself changes (a different row, order, or limit).
    const activationKey = schema.queryActivationKey(plan)
    const livePlan = React.useRef(plan)
    livePlan.current = plan
    React.useEffect(() => {
      if (activationKey === undefined) {
        return
      }

      return schema.activateQuery(livePlan.current)
    }, [schema, activationKey])
    return value(schema.query(plan))
  },

  Create(schema: RuntimeDataSchema, entity: string, fields: Record<string, Evaluable>): void {
    schema.create(entity, evaluatedFields(fields))
  },

  Update(row: Evaluable, fields: Record<string, Evaluable>): void {
    const handle = entityHandle(row.evaluate().jsValue)
    RuntimeAssert.input(handle, 'Data update expects an entity handle.')
    metadataOf(handle).schema.update(handle, evaluatedFields(fields))
  },

  Delete(row: Evaluable): void {
    const handle = entityHandle(row.evaluate().jsValue)
    RuntimeAssert.input(handle, 'Data delete expects an entity handle.')
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

  /** EntityInteraction exposes only the generated interaction facts carried by a live entity handle. */
  EntityInteraction(value: unknown):
    | Readonly<{
      entity: string
      policy?: TaoEntityCommandPolicy
    }>
    | undefined
  {
    const handle = entityHandle(value)
    if (!handle) {
      return undefined
    }
    const metadata = metadataOf(handle)
    const policy = metadata.schema.definition.entities[metadata.entity]?.commandPolicy
    return { entity: metadata.entity, ...(policy === undefined ? {} : { policy }) }
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

  /** SettleAll waits out every schema's load, in-flight query fills, and queued saves — the test
   * harness's determinism point between steps. */
  async SettleAll(): Promise<void> {
    await settleAllDataSchemas()
  },

  /** subscribeAll is the app/navigation seam for rerendering entity-valued screens after data changes. */
  subscribeAll(listener: () => void): () => void {
    return subscribeToAllData(listener)
  },

  /** revision returns the global data revision used with subscribeAll. */
  revision(): number {
    return dataRevision()
  },

  /** beginTest isolates every schema behind a fresh in-memory provider for one Tao check. */
  beginTest(): void {
    beginDataTest()
  },

  /** endTest restores normal schema creation after a Tao check. */
  endTest(): void {
    endDataTest()
  },

  Capture(): TaoDataCapture {
    return captureDataSchemas()
  },

  Restore(captured: TaoDataCapture): Promise<void> {
    return restoreDataSchemas(captured)
  },

  CanResetAll(): boolean {
    return canResetAllDataSchemas()
  },

  /** ResetAll returns the pre-reset backup and never starts unless every provider supports reset. */
  ResetAll(): Promise<TaoDataCapture> {
    return resetAllDataSchemas()
  },
} as const

registerRuntimeCaptureDomain({
  capture: () => captureDataSchemas() as TaoRuntimeJson,
  domain: 'data',
  restore: value => restoreDataSchemas(value as unknown as TaoDataCapture),
  version: 1,
})

function datasourceBindingIdentity(
  declaration: TaoDatasourceDeclaration,
  config: Record<string, unknown>,
): string | undefined {
  if (!declaration.canonicalIdentity) {
    return undefined
  }
  try {
    return canonicalDescriptor(
      declaration.canonicalIdentity,
      canonicalDatasourceValue(config, new Set()) as Readonly<Record<string, unknown>>,
    ).canonical
  } catch {
    // An opaque provider configuration cannot safely share persisted entity tokens with another
    // binding, so restoration is disabled instead of falling back to declaration-only identity.
    return undefined
  }
}

function canonicalDatasourceValue(value: unknown, ancestors: Set<object>): unknown {
  if (typeof value !== 'object' || value === null) {
    return value
  }
  if ('evaluate' in value && typeof value.evaluate === 'function') {
    return canonicalDatasourceValue(value.evaluate().jsValue, ancestors)
  }
  RuntimeAssert.input(!ancestors.has(value), 'Datasource configuration is cyclic.')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map(item => canonicalDatasourceValue(item, ancestors))
    }
    const prototype = Object.getPrototypeOf(value)
    RuntimeAssert.input(
      prototype === Object.prototype || prototype === null,
      'Datasource configuration contains an opaque host value.',
    )
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        canonicalDatasourceValue(item, ancestors),
      ]),
    )
  } finally {
    ancestors.delete(value)
  }
}

export type TaoDataSchema = RuntimeDataSchema
