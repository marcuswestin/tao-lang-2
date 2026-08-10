import React from 'react'

type DataProvider = 'local' | 'memory'
type DataStatus = 'error' | 'loading' | 'ready'
type DataPrimitive = 'boolean' | 'number' | 'text'

export type TaoDataField = {
  kind: DataPrimitive | 'relation'
  relation?: string
}

export type TaoDataEntity = {
  collection: string
  fields: Record<string, TaoDataField>
}

export type TaoDataSchemaDefinition = {
  entities: Record<string, TaoDataEntity>
  name: string
  provider: DataProvider
  storageKey?: string
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

type Evaluable = {
  evaluate(): { jsValue: unknown }
}

type RuntimeValueFactory = <T>(value: T) => Evaluable

type StoredRow = Record<string, unknown> & { Id: string }
type StoredData = {
  nextId: number
  rows: Record<string, StoredRow[]>
}

type RuntimeRow = StoredRow & {
  readonly __taoDataEntity: string
  readonly __taoDataSchema: RuntimeDataSchema
}

type Persistence = {
  read(): string | undefined
  write(value: string): void
}

let testMode = false
const schemas = new Set<RuntimeDataSchema>()

/** DataControls is the provider-neutral generated-code API for Tao schemas, queries, and writes. */
export const DataControls = {
  Schema(definition: TaoDataSchemaDefinition): RuntimeDataSchema {
    const schema = new RuntimeDataSchema(
      definition,
      testMode || definition.provider === 'memory' ? memoryPersistence() : persistenceFor(definition),
    )
    schemas.add(schema)
    return schema
  },

  Query(schema: RuntimeDataSchema, plan: TaoQueryPlan, value: RuntimeValueFactory): Evaluable {
    React.useSyncExternalStore(schema.subscribe, schema.snapshot, schema.snapshot)
    return value(schema.query(plan))
  },

  Create(schema: RuntimeDataSchema, entity: string, fields: Record<string, Evaluable>): void {
    schema.create(entity, evaluatedFields(fields))
  },

  Update(row: Evaluable, fields: Record<string, Evaluable>): void {
    const runtimeRow = row.evaluate().jsValue as RuntimeRow | undefined
    runtimeRow?.__taoDataSchema.update(runtimeRow, evaluatedFields(fields))
  },

  Delete(row: Evaluable): void {
    const runtimeRow = row.evaluate().jsValue as RuntimeRow | undefined
    runtimeRow?.__taoDataSchema.delete(runtimeRow)
  },

  /** beginTest isolates every schema behind a fresh in-memory store for one Tao check. */
  beginTest(): void {
    testMode = true
    for (const schema of schemas) {
      schema.reset()
    }
  },

  /** endTest restores normal schema creation after a Tao check. */
  endTest(): void {
    testMode = false
  },

  /** setTestStatus drives deterministic query loading and provider-error behavior in Tao tests. */
  setTestStatus(schemaName: string, status: DataStatus, message = ''): void {
    for (const schema of schemas) {
      if (schema.name === schemaName) {
        schema.setStatus(status, message)
      }
    }
  },
} as const

export type TaoDataSchema = RuntimeDataSchema

class RuntimeDataSchema {
  readonly name: string
  private data: StoredData
  private error = ''
  private listeners = new Set<() => void>()
  private status: DataStatus = 'ready'
  private version = 0

  constructor(
    readonly definition: TaoDataSchemaDefinition,
    private readonly persistence: Persistence,
  ) {
    this.name = definition.name
    this.data = emptyData(definition)
    this.load()
  }

  readonly subscribe = (listener: () => void): () => void => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly snapshot = (): number => this.version

  query(plan: TaoQueryPlan): unknown[] {
    const source = this.data.rows[plan.entity] ?? []
    const rows = this.status === 'ready'
      ? source.filter(row => plan.filters.every(filter => matchesFilter(row, filter))).map(row =>
        this.runtimeRow(plan.entity, row)
      )
      : []
    if (plan.order) {
      const multiplier = plan.order.direction === 'desc' ? -1 : 1
      rows.sort((left, right) => compare(left[plan.order!.field], right[plan.order!.field]) * multiplier)
    }
    Object.defineProperties(rows, {
      Loading: { configurable: true, value: this.status === 'loading' },
      Error: { configurable: true, value: this.status === 'error' ? this.error : '' },
    })
    return rows
  }

  create(entity: string, fields: Record<string, unknown>): void {
    if (this.status !== 'ready') {
      return
    }
    const rows = this.data.rows[entity]
    if (!rows) {
      return
    }
    const row: StoredRow = { Id: `${entity}-${this.data.nextId++}`, ...fields }
    rows.push(row)
    this.commit()
  }

  update(row: RuntimeRow, fields: Record<string, unknown>): void {
    if (this.status !== 'ready') {
      return
    }
    const stored = this.data.rows[row.__taoDataEntity]?.find(candidate => candidate.Id === row.Id)
    if (!stored) {
      return
    }
    Object.assign(stored, fields)
    this.commit()
  }

  delete(row: RuntimeRow): void {
    if (this.status !== 'ready') {
      return
    }
    const rows = this.data.rows[row.__taoDataEntity]
    if (!rows) {
      return
    }
    this.data.rows[row.__taoDataEntity] = rows.filter(candidate => candidate.Id !== row.Id)
    for (const [entityName, entity] of Object.entries(this.definition.entities)) {
      const relationFields = Object.entries(entity.fields)
        .filter(([, field]) => field.kind === 'relation' && field.relation === row.__taoDataEntity)
        .map(([name]) => name)
      if (relationFields.length > 0) {
        this.data.rows[entityName] = (this.data.rows[entityName] ?? []).filter(candidate =>
          relationFields.every(field => candidate[field] !== row.Id)
        )
      }
    }
    this.commit()
  }

  reset(): void {
    this.data = emptyData(this.definition)
    this.status = 'ready'
    this.error = ''
    this.emit()
  }

  setStatus(status: DataStatus, message: string): void {
    this.status = status
    this.error = status === 'error' ? message || 'Local data provider failed.' : ''
    this.emit()
  }

  private runtimeRow(entity: string, stored: StoredRow): RuntimeRow {
    const row = { ...stored } as RuntimeRow
    Object.defineProperties(row, {
      __taoDataEntity: { value: entity },
      __taoDataSchema: { value: this },
    })
    return row
  }

  private load(): void {
    try {
      const stored = this.persistence.read()
      if (stored) {
        this.data = normalizeStoredData(JSON.parse(stored), this.definition)
      }
    } catch (error) {
      this.status = 'error'
      this.error = `Could not load local data: ${errorMessage(error)}`
    }
  }

  private commit(): void {
    try {
      this.persistence.write(JSON.stringify(this.data))
    } catch (error) {
      this.status = 'error'
      this.error = `Could not save local data: ${errorMessage(error)}`
    }
    this.emit()
  }

  private emit(): void {
    this.version += 1
    for (const listener of this.listeners) {
      listener()
    }
  }
}

function evaluatedFields(fields: Record<string, Evaluable>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, value.evaluate().jsValue]))
}

function matchesFilter(row: StoredRow, filter: TaoQueryFilter): boolean {
  const actual = row[filter.field]
  const expected = filter.value().evaluate().jsValue
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

function normalizeStoredData(value: unknown, definition: TaoDataSchemaDefinition): StoredData {
  if (!value || typeof value !== 'object') {
    return emptyData(definition)
  }
  const candidate = value as Partial<StoredData>
  const data = emptyData(definition)
  data.nextId = typeof candidate.nextId === 'number' ? candidate.nextId : 1
  if (candidate.rows && typeof candidate.rows === 'object') {
    for (const entity of Object.keys(definition.entities)) {
      const rows = candidate.rows[entity]
      data.rows[entity] = Array.isArray(rows) ? rows.filter(isStoredRow) : []
    }
  }
  return data
}

function isStoredRow(value: unknown): value is StoredRow {
  return !!value && typeof value === 'object' && typeof (value as { Id?: unknown }).Id === 'string'
}

function persistenceFor(definition: TaoDataSchemaDefinition): Persistence {
  const key = `tao-data-${definition.storageKey ?? definition.name}`
  const browserStorage = browserLocalStorage()
  if (browserStorage) {
    return {
      read: () => browserStorage.getItem(key) ?? undefined,
      write: value => browserStorage.setItem(key, value),
    }
  }
  try {
    const fileSystem = require('expo-file-system') as ExpoFileSystem
    const file = new fileSystem.File(fileSystem.Paths.document, `${safeFileName(key)}.json`)
    return {
      read: () => file.exists ? file.textSync() : undefined,
      write(value) {
        if (!file.exists) {
          file.create({ intermediates: true })
        }
        file.write(value)
      },
    }
  } catch {
    return memoryPersistence()
  }
}

function memoryPersistence(): Persistence {
  let value: string | undefined
  return {
    read: () => value,
    write: next => {
      value = next
    },
  }
}

function browserLocalStorage(): StorageLike | undefined {
  try {
    return (globalThis as typeof globalThis & { localStorage?: StorageLike }).localStorage
  } catch {
    return undefined
  }
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

type ExpoFileSystem = {
  File: new(directory: unknown, name: string) => {
    readonly exists: boolean
    create(options?: { intermediates?: boolean }): void
    textSync(): string
    write(value: string): void
  }
  Paths: { document: unknown }
}
