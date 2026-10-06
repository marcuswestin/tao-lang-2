import React from 'react'
import { RuntimeAssert } from './TR-assert'
import type { TaoAuthPrincipal, TaoAuthProof, TaoDataAuthBinding } from './TR-auth'
import { entityHandle, metadataOf } from './TR-data-entity'
import { emptyData, envelope, parseEnvelope, type StoredData } from './TR-data-persistence'
import { UnboundConnection } from './TR-data-provider'
import { nativeQueryContext } from './TR-data-query-context'
import {
  beginTest as beginDataTest,
  bindConfiguredDataSchema,
  canResetAllDataSchemas,
  captureDataSchemas,
  endTest as endDataTest,
  interactionEntityHandles,
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
import type { TaoSyncWriteRecovery } from './TR-data-sync'
import { type Evaluable, evaluatedFields } from './TR-data-values'
import type { TaoDeclarationIdentity } from './TR-navigation-identity'
import { canonicalDescriptor } from './TR-navigation-identity'
import type { TaoAuthProofKind, TaoDataPairing } from './TR-pairing'
import { registerRuntimeCaptureDomain, type TaoRuntimeJson } from './TR-runtime-capture'
import { StudioEnvironmentControls } from './TR-studio-environment'
import { useStudioLensScope } from './TR-studio-lens'
import { TestWorld } from './TR-test-world'

export { testProvider } from './TR-data-provider'

type DataPrimitive = 'boolean' | 'number' | 'text' | 'time'
type RelationDeleteBehavior = 'cascade' | 'restrict'

/** TaoEntityAvailability is the provider-neutral live state of one entity handle. */
export type TaoEntityAvailability =
  | { status: 'available' | 'loading' | 'missing' }
  | { reason?: 'signed-out' | 'access-denied'; status: 'unauthorized' }
  | { message: string; status: 'error' }

export type TaoDataField = {
  cases?: readonly string[]
  enumValues?: () => Readonly<Record<string, Evaluable>>
  optional?: boolean
  required?: string
  defaultNow?: true
  defaultValue?: boolean | number | string
  indexed?: boolean
  /**
   * A `relation` is stored as the target row's id and resolves inside this schema's rows. A
   * `reference` is stored as the target's unique field value instead, so it still names one row when
   * that row lives in a store this schema knows nothing about; it resolves through the schema
   * registry and reads as `missing` when no store holds it.
   */
  kind: DataPrimitive | 'enum' | 'reference' | 'relation'
  onDelete?: RelationDeleteBehavior
  /** referenceField is the target entity's unique field, the value a reference stores. */
  referenceField?: string
  relation?: string
  /** search marks a text field a query's `search` clause matches a term against. */
  search?: boolean
  /** store names the store a reference's target lives in, among the stores its project links. */
  store?: string
  /** title marks the one text field that names a row to a person: a label of last resort. */
  title?: boolean
  unique?: boolean
}

export type TaoDataEntity = {
  grants?: readonly Readonly<{
    operations: readonly ('read' | 'create' | 'update' | 'delete')[]
    principal: readonly string[]
    updateFields?: readonly string[]
  }>[]
  uniqueConstraints?: readonly (readonly string[])[]
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
  /** Bounds each provider request while retaining every acquired row in the local projection. */
  pageSize?: number
  order?: {
    direction: 'asc' | 'desc'
    field: string
  }
  /**
   * search is the query's own reactive term, matched against every `(search)` field the same
   * way keyboard narrowing and the command palette match: locale-aware word-prefix subsequence.
   * It is evaluated locally over the store for every provider, never offered to a fill connection.
   */
  search?: () => Evaluable
}

/** TaoQueryDescriptor is the serializable shape of one active query offered to a fill connection. */
export type TaoQueryDescriptor = {
  entity: string
  limit?: number
  pageSize?: number
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
  /** Whether this account has a durable complete cache for its declared offline scope. */
  offline?: {
    status(): Readonly<{ state: 'loading' | 'ready' | 'unavailable'; reason?: string }>
    subscribe(listener: () => void): () => void
  }
  /** Local durable write records, when the provider implements recorded mutation recovery. */
  writes?: TaoSyncWriteRecovery
  /**
   * automaticReset lets the runtime run `reset` itself when a starting snapshot fails to parse,
   * instead of offering that destructive reset through the recovery overlay. Only a disposable
   * store declares it: the development datasource, where a schema edit is the ordinary cause and
   * clearing the app's development data is the expected answer. It requires `reset`.
   */
  automaticReset?: true
  close?(): void
  /** Stop account work immediately; resolve once durable cache removal/outbox sealing finishes. */
  invalidateAuth?(): Promise<void> | void
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
  /** The adapter owns bounded continuations; a local result limit alone makes no such promise. */
  pagedQueries?: true
  /** fillCacheMs suppresses re-fills of a descriptor filled within the window (default 0: always). */
  fillCacheMs?: number
  load(): Promise<string | undefined> | string | undefined
  /** reset is optional because remote providers may not permit destructive recovery. */
  reset?(): Promise<void> | void
  save(snapshot: string, intents?: readonly TaoDataWriteIntent[], context?: TaoDataWriteContext): Promise<void> | void
  /** A supplied form applies its local input only after the transport reports a confirmed receipt. */
  submit?(
    snapshot: string,
    intents?: readonly TaoDataWriteIntent[],
    context?: TaoDataWriteContext,
  ): Promise<{ status: 'queued' | 'saved' }>
  subscribe?(observer: TaoDataConnectionObserver): () => void
}

/** The baseline is the snapshot the runtime actually consumed, not a transport's last publication. */
export type TaoDataWriteContext = Readonly<{ previousSnapshot: string }>

/** TaoDataWriteIntent preserves an authored same-value update through a snapshot-backed sync bridge. */
export type TaoDataWriteIntent = Readonly<{
  entity: string
  fields: readonly string[]
  id: string
}>

/** TaoDataConnectionObserver receives provider snapshots and failures after the initial load. */
export type TaoDataConnectionObserver = Readonly<{
  error(error: unknown): void
  snapshot(value: string | undefined): void
  /** Cached provider metadata can change while the stored entity snapshot remains identical. */
  metadataChanged?(): void
}>

/** TaoDataProviderContext is the provider-neutral mount passed to a package implementation. */
export type TaoDataProviderContext = Readonly<{
  auth?: TaoDataAuthBinding
  /** Device-local account custody fences persistence without granting remote authority. */
  signal?: AbortSignal
  configuration: Readonly<Record<string, unknown>>
  schema: TaoDataSchemaDefinition
  storageKey: string
}>

/**
 * TaoDataAuthenticationContext is what the datasource holding `Account` receives once the auth
 * provider reports a signed-in principal. `provider` is the auth declaration's name; `proof` pulls a
 * fresh sign-in proof the runtime has checked against the principal, the declaration, and expiry.
 * `signal` aborts when this principal's data access ends; `testing` marks a testing auth provider.
 */
export type TaoDataAuthenticationContext = Readonly<{
  configuration: Readonly<Record<string, unknown>>
  schema: TaoDataSchemaDefinition
  principal: TaoAuthPrincipal
  provider: string
  proof<KindT extends TaoAuthProofKind>(
    kind: KindT,
    signal: AbortSignal,
  ): Promise<Extract<TaoAuthProof, { kind: KindT }>>
  signal: AbortSignal
  testing?: true
}>

/**
 * TaoDataAuthentication is the application account a datasource resolved. `credential` is the
 * datasource's own transport credential source, and `release` ends any backend session the exchange
 * created; the runtime calls it before the auth provider signs out and retries it after a failure.
 */
export type TaoDataAuthentication = Readonly<{
  accountId: string
  credential?(signal: AbortSignal): Promise<string>
  release?(signal: AbortSignal): Promise<void>
}>

/** TaoDataProvider is the clean package boundary implemented by Local, Memory, and remote providers. */
export type TaoDataProvider = {
  /**
   * Opt in only after verifying the principal, binding storage to its account ID, and enforcing
   * that private namespace remotely. Grant-free rows then belong to the bound account.
   */
  authenticatedAccess?: 'private-account'
  /** Resolves a signed-in principal to an account; a datasource without it cannot hold an Auth app's data. */
  authenticate?(context: TaoDataAuthenticationContext): Promise<TaoDataAuthentication>
  connect(context: TaoDataProviderContext): TaoDataConnection
  /** Test stand-ins model remote saves or local snapshots awaiting background upload. */
  testNetwork?: 'deferred' | 'remote'
  /** Declares that this provider supports recorded per-write recovery in behavior tests. */
  testWriteRecovery?: true
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
  pairing?: TaoDataPairing
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

/** TaoAppDatasourceBinding is one store an app mounts and the datasource filling it. */
export type TaoAppDatasourceBinding = Readonly<{
  /** Compiler-owned local companion custody, keyed by the app's canonical declaration identity. */
  localOnly?: string
  source: TaoConfiguredDatasource
  /** storageName is the bound declaration's name, present only for a store a `Data` slot declares. */
  storageName?: string
  store: RuntimeDataSchema
}>

/**
 * appProviderIdentity keys an app's restoration by the providers its state was written against. An
 * app with no store keys under `none`; one store keeps the identity it always had; several list every
 * member, and a member that cannot be represented leaves the whole app unkeyed, because restoring
 * against a provider that cannot be recognised again would restore handles into the wrong data.
 */
export function appProviderIdentity(bindings: readonly TaoAppDatasourceBinding[]): string | undefined {
  if (bindings.length === 0) {
    return 'none'
  }
  if (bindings.length === 1) {
    return bindings[0]!.source.bindingIdentity()
  }
  const identities = bindings.map(binding => binding.source.bindingIdentity())
  return identities.every(identity => identity !== undefined) ? JSON.stringify(identities) : undefined
}

export type TaoKeyValueStorage = {
  getItem(key: string): Promise<string | null>
  removeItem?(key: string): Promise<void>
  setItem(key: string, value: string): Promise<void>
}

type RuntimeValueFactory = <T>(value: T) => Evaluable

function useConfiguredProviderBinding(
  schema: RuntimeDataSchema,
  source: TaoConfiguredDatasource,
  storageName?: string,
): void {
  // A generated app can remount beneath one Studio cell Host during Fast Refresh. Its datasource
  // wrapper must survive that child remount, or binding starts a new provider generation and the
  // Host's existing fixture handles become inactive.
  const requestedStudioProvider = StudioEnvironmentControls.useProvider(source.declaration.provider)
  // A Tao check uses the Studio fixture seeding seam, but snapshot providers get their behavior
  // from the provider-faithful test world. The Studio overlay would erase their recovery/network
  // capabilities. Fill providers still need its cell-local persistence and controlled fills.
  const studioProvider = isDataTestMode() && source.declaration.provider.fills === undefined
    ? source.declaration.provider
    : requestedStudioProvider
  const declaration = StudioEnvironmentControls.useDatasourceDeclaration(source.declaration, studioProvider)
  // The effect re-runs on each render's fresh `config` object and BindConfigured compares
  // evaluated configuration values to make an unchanged rebind a cheap no-op.
  React.useLayoutEffect(() => {
    DataControls.BindConfigured(
      schema,
      declaration === source.declaration ? source : DataControls.Configure(declaration, { ...source.config }),
      storageName,
    )
  }, [schema, declaration, source.config, storageName])
}

/** DataControls is the provider-neutral generated-code API for Tao schemas, queries, and writes. */
export const DataControls = {
  /** NativeQueryContext preserves query ownership without reserving public field names. */
  NativeQueryContext: nativeQueryContext,
  /** NativeEntityContext authenticates a live row before an adapter accesses its connection. */
  NativeEntityContext(value: unknown): Readonly<{
    connection: TaoDataConnection
    entity: string
    id: string
    notifyMetadataChanged(): void
  }> {
    const handle = entityHandle(value)
    RuntimeAssert.input(handle, 'This operation expects a live data item.')
    return metadataOf(handle).schema.nativeEntityContext(handle)
  },
  /** NativeSnapshots shares the runtime's checked wire format with datasource implementations. */
  NativeSnapshots: {
    empty: emptyData,
    decode: parseEnvelope,
    encode(data: StoredData, definition: TaoDataSchemaDefinition): string {
      const serialized = JSON.stringify(envelope(data, definition))
      parseEnvelope(serialized, definition)
      return serialized
    },
  },
  /** interactionCandidates is the internal pending-command picker seam over active stores. */
  interactionCandidates(entity: string, scope?: { ownsStore(store: TaoDataSchema): boolean }): readonly unknown[] {
    return interactionEntityHandles(entity, scope)
  },

  /** interactionCandidateIdentity keeps same-id rows from different stores distinct in a picker. */
  interactionCandidateIdentity(value: unknown): string | undefined {
    const handle = entityHandle(value)
    if (!handle) {
      return undefined
    }
    const metadata = metadataOf(handle)
    return JSON.stringify([metadata.schema.captureIdentity(), metadata.entity, metadata.id])
  },

  /** interactionCandidateLabel reads the authored title field, falling back to the stable id. */
  interactionCandidateLabel(value: unknown): string | undefined {
    const handle = entityHandle(value)
    if (!handle) {
      return undefined
    }
    const metadata = metadataOf(handle)
    const definition = metadata.schema.definition.entities[metadata.entity]
    const title = Object.entries(definition?.fields ?? {}).find(([, field]) => field.title)?.[0]
    const label = title === undefined ? undefined : metadata.schema.read(handle, title)
    return label === undefined || label === null || String(label).trim().length === 0
      ? metadata.id
      : String(label)
  },

  /** Declaration binds one Tao declaration identity to its package-scope provider implementation. */
  Declaration(
    name: string,
    provider: TaoDataProvider,
    canonicalIdentity?: TaoDeclarationIdentity,
    pairing?: TaoDataPairing,
  ): TaoDatasourceDeclaration {
    return Object.freeze({
      ...(canonicalIdentity ? { canonicalIdentity } : {}),
      identity: Symbol(name),
      name,
      ...(pairing ? { pairing } : {}),
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
      ?? (isDataTestMode() ? TestWorld.connection() : UnboundConnection(definition.name))
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
    storageName?: string,
  ): void {
    const before = schema.bindingGeneration()
    bindConfiguredDataSchema(schema, source, storageName)
    if (schema.bindingGeneration() !== before) {
      schema.recordConfiguredAppBinding()
    }
  },

  /** UseConfigured binds a declaration-owned datasource configuration at an app root. */
  UseConfigured: useConfiguredProviderBinding,

  /**
   * UseAppDatasources mounts every store an app definition binds. A definition's binding count is
   * fixed when it is compiled, so the hooks called here keep their order across renders.
   */
  UseAppDatasources(definition: Readonly<{ datasources?(): readonly TaoAppDatasourceBinding[] }>): void {
    for (const binding of definition.datasources?.() ?? []) {
      useConfiguredProviderBinding(binding.store, binding.source, binding.storageName)
    }
  },

  /**
   * PatchBindings layers a variant's own patches onto the bindings it inherits from a base in another
   * module: one list of patches per inherited binding, in the order the base binds them.
   */
  PatchBindings(
    bindings: readonly TaoAppDatasourceBinding[],
    patches: readonly (readonly Record<string, unknown>[])[],
  ): readonly TaoAppDatasourceBinding[] {
    RuntimeAssert(bindings.length === patches.length, 'an inherited datasource patch for every inherited binding', {
      bindings: bindings.length,
      patches: patches.length,
    })
    return bindings.map((binding, index) => ({
      ...binding,
      source: patches[index]!.reduce<TaoConfiguredDatasource>(DataControls.Patch, binding.source),
    }))
  },

  Query(schema: RuntimeDataSchema, plan: TaoQueryPlan, value: RuntimeValueFactory): Evaluable {
    const lensScope = useStudioLensScope()
    const observedPlan = React.useRef(plan)
    const fillStartedAt = React.useRef<number | undefined>(undefined)
    observedPlan.current = plan
    const subscribe = React.useCallback((notify: () => void) => {
      if (lensScope === undefined) {
        return schema.subscribe(notify)
      }
      return schema.subscribe(() => {
        const activePlan = observedPlan.current
        const fill = schema.fillState(activePlan)
        let providerWaitMs: number | undefined
        if (fill?.status === 'filling' && fillStartedAt.current === undefined) {
          fillStartedAt.current = performance.now()
        } else if (fill?.status !== 'filling' && fillStartedAt.current !== undefined) {
          providerWaitMs = Math.max(0, performance.now() - fillStartedAt.current)
          fillStartedAt.current = undefined
        }
        lensScope?.mark({
          entity: activePlan.entity,
          kind: 'data',
          ...(providerWaitMs === undefined ? {} : { providerWaitMs }),
          schema: schema.name,
        })
        notify()
      })
    }, [lensScope, schema])
    React.useSyncExternalStore(subscribe, schema.snapshot, schema.snapshot)
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

  /** CreateWith creates one row from every own field of a projected input item. */
  CreateWith(schema: RuntimeDataSchema, entity: string, input: Evaluable): void {
    const fields = input.evaluate().jsValue
    RuntimeAssert.input(
      fields !== null && typeof fields === 'object' && !Array.isArray(fields),
      'Data create expects an input item.',
    )
    schema.create(entity, Object.fromEntries(Object.entries(fields)))
  },

  Update(row: Evaluable, fields: Record<string, Evaluable>): void {
    const handle = entityHandle(row.evaluate().jsValue)
    RuntimeAssert.input(handle, 'Data update expects an entity handle.')
    metadataOf(handle).schema.update(handle, evaluatedFields(fields))
  },

  /** Toggle reads the transaction's current row once and records one concrete field update. */
  Toggle(row: Evaluable, field: string): void {
    const handle = entityHandle(row.evaluate().jsValue)
    RuntimeAssert.input(handle, 'Data toggle expects an entity handle.')
    const schema = metadataOf(handle).schema
    const current = schema.read(handle, field)
    RuntimeAssert.input(typeof current === 'boolean', `Data toggle expects a yes/no field '${field}'.`)
    schema.update(handle, { [field]: !current })
  },

  /** UpdateWith submits every own supplied input field and preserves omitted fields. */
  UpdateWith(row: Evaluable, input: Evaluable): void {
    const handle = entityHandle(row.evaluate().jsValue)
    RuntimeAssert.input(handle, 'Data update expects an entity handle.')
    const fields = input.evaluate().jsValue
    RuntimeAssert.input(
      fields !== null && typeof fields === 'object' && !Array.isArray(fields),
      'Data update expects an input item.',
    )
    metadataOf(handle).schema.update(handle, Object.fromEntries(Object.entries(fields)))
  },

  /** Retry repeats the provider's original recorded write, without rerunning its Tao action. */
  Retry(row: Evaluable): void {
    const handle = entityHandle(row.evaluate().jsValue)
    RuntimeAssert.input(handle, 'Data retry expects an entity handle.')
    metadataOf(handle).schema.retryWrites(handle)
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

  /**
   * LinkStores records the stores one compiled project mounts. A reference resolves only among the
   * stores linked with the one holding it, so two projects mounted in one process never answer each
   * other's references.
   */
  LinkStores(stores: readonly RuntimeDataSchema[]): void {
    for (const store of stores) {
      store.linkStores(stores)
    }
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

  /** TestWorld controls the deterministic provider stand-in for the current check. */
  TestWorld,

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
  module: 'TR-data',
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
