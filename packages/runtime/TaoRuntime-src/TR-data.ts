import React from 'react'
import { entityHandle, metadataOf } from './TR-data-entity'
import { MemoryProvider, UnboundProvider } from './TR-data-provider'
import {
  beginTest as beginDataTest,
  bindConfiguredDataSchema,
  type DataStatus,
  endTest as endDataTest,
  isDataTestMode,
  registerDataSchema,
  revision as dataRevision,
  setTestStatus as setDataTestStatus,
  subscribeAll as subscribeToAllData,
} from './TR-data-registry'
import { RuntimeDataSchema } from './TR-data-schema'
import { type Evaluable, evaluatedFields } from './TR-data-values'

export { DataProviderControls, testProvider } from './TR-data-provider'

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

type TaoDatasourceConfiguration = Readonly<Record<string, unknown>>

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

type RuntimeValueFactory = <T>(value: T) => Evaluable

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
      ?? (isDataTestMode() ? MemoryProvider() : UnboundProvider(definition.name))
    const schema = new RuntimeDataSchema(
      definition,
      selectedProvider,
      isDataTestMode() ? 'test' : provider ? undefined : 'unbound',
      providerStorageKey,
    )
    registerDataSchema(schema)
    return schema
  },

  /** BindConfigured selects a declaration-owned provider while preserving test isolation. */
  BindConfigured(
    schema: RuntimeDataSchema,
    declaration: TaoDatasourceDeclaration,
    storageKey?: string,
  ): void {
    bindConfiguredDataSchema(schema, declaration, storageKey)
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

  /** setTestStatus drives deterministic query loading and provider-error behavior in Tao tests. */
  setTestStatus(status: DataStatus, message = ''): void {
    setDataTestStatus(status, message)
  },
} as const

export type TaoDataSchema = RuntimeDataSchema
