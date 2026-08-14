import type { TaoDataSchemaDefinition } from './TR-data'
import { valueMatchesKind } from './TR-data-definition'

export type StoredRow = Record<string, unknown> & { Id: string }
export type StoredData = {
  nextId: number
  rows: Record<string, StoredRow[]>
}

type PersistedEnvelope = {
  formatVersion: 1
  nextId: number
  rows: Record<string, StoredRow[]>
  schemaVersion: number
}

const persistedFormatVersion = 1

export function emptyData(definition: TaoDataSchemaDefinition): StoredData {
  return {
    nextId: 1,
    rows: Object.fromEntries(Object.keys(definition.entities).map(entity => [entity, []])),
  }
}

export function envelope(data: StoredData, definition: TaoDataSchemaDefinition): PersistedEnvelope {
  return {
    formatVersion: persistedFormatVersion,
    schemaVersion: definition.schemaVersion ?? 1,
    nextId: data.nextId,
    rows: data.rows,
  }
}

export function parseEnvelope(serialized: string, definition: TaoDataSchemaDefinition): StoredData {
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

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  const sortedActual = [...actual].sort()
  const sortedExpected = [...expected].sort()
  return sortedActual.length === sortedExpected.length
    && sortedActual.every((name, index) => name === sortedExpected[index])
}
