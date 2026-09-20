import { Arrays } from './core/RuntimeCore'
import { RuntimeAssert } from './TR-assert'
import type { TaoDataSchemaDefinition } from './TR-data'
import { valueMatchesKind } from './TR-data-definition'
import { UserInputError } from './TR-errors'

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
  RuntimeAssert.input(value && typeof value === 'object', 'Persisted data is not an object envelope.')
  const candidate = value as Partial<PersistedEnvelope>
  RuntimeAssert.input(
    candidate.formatVersion === persistedFormatVersion,
    `Unsupported persisted data format '${String(candidate.formatVersion)}'.`,
  )
  const schemaVersion = definition.schemaVersion ?? 1
  RuntimeAssert.input(
    candidate.schemaVersion === schemaVersion,
    `Persisted schema version ${String(candidate.schemaVersion)} does not match ${schemaVersion}.`,
  )
  RuntimeAssert.input(
    Number.isSafeInteger(candidate.nextId) && (candidate.nextId ?? 0) >= 1,
    'Persisted data has an invalid nextId.',
  )
  if (!candidate.rows || typeof candidate.rows !== 'object' || Array.isArray(candidate.rows)) {
    throw new UserInputError('Persisted data has invalid rows.')
  }
  const entityNames = Object.keys(definition.entities)
  RuntimeAssert.input(
    sameNames(Object.keys(candidate.rows), entityNames),
    'Persisted data entity collections do not match the current schema.',
  )
  const rows: Record<string, StoredRow[]> = {}
  for (const entityName of entityNames) {
    // Both locals carry an explicit type: TypeScript requires one for every `const` whose narrowing
    // flows through an assertion call, and this loop ends in one.
    const entityRows: unknown = candidate.rows[entityName]
    if (!Array.isArray(entityRows)) {
      throw new UserInputError(`Persisted entity '${entityName}' is not a row list.`, { entityName })
    }
    const validated: StoredRow[] = entityRows.map((row: unknown) => validatedStoredRow(entityName, row, definition))
    rows[entityName] = validated
    const ids: readonly string[] = validated.map(row => row.Id)
    RuntimeAssert.input(
      new Set(ids).size === ids.length,
      `Persisted entity '${entityName}' contains duplicate Id values.`,
      { entityName },
    )
  }
  validatePersistedRelations(rows, definition)
  return { nextId: candidate.nextId!, rows }
}

function validatedStoredRow(entityName: string, value: unknown, definition: TaoDataSchemaDefinition): StoredRow {
  RuntimeAssert.input(
    value && typeof value === 'object' && !Array.isArray(value),
    `Persisted ${entityName} row is not an object.`,
    { entityName },
  )
  const row = value as Record<string, unknown>
  if (typeof row['Id'] !== 'string') {
    throw new UserInputError(`Persisted ${entityName} row has no text Id.`, { entityName })
  }
  const entity = definition.entities[entityName]!
  RuntimeAssert.input(
    sameNames(Object.keys(row), ['Id', ...Object.keys(entity.fields)]),
    `Persisted ${entityName} row fields do not match the current schema.`,
    { entityName },
  )
  for (const [name, field] of Object.entries(entity.fields)) {
    const value = row[name]
    // A reference is stored as the target's unique value, which is whatever primitive that field
    // holds, and the target row may be in a store this snapshot does not contain.
    const valid = field.kind === 'relation'
      ? typeof value === 'string'
      : field.kind === 'reference'
      ? value === null || typeof value === 'string' || typeof value === 'number'
      : valueMatchesKind(value, field.kind)
    RuntimeAssert.input(
      valid,
      `Persisted field '${entityName}.${name}' has an invalid ${field.kind} value.`,
      { entityName, fieldName: name },
    )
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
        RuntimeAssert.input(
          relatedIds.has(row[name] as string),
          `Persisted relationship '${entityName}.${name}' refers to missing ${field.relation}.`,
          { entityName, fieldName: name },
        )
      }
    }
  }
}

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  const sortedActual = Arrays.sorted(actual)
  const sortedExpected = Arrays.sorted(expected)
  return sortedActual.length === sortedExpected.length
    && sortedActual.every((name, index) => name === sortedExpected[index])
}
