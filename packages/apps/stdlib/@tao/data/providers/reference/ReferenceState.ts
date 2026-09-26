import type TR from '@runtime/TR'
import type { AccountProtocol } from '@shared/auth/AuthProtocol'
import { Assert } from '@shared/core'

export type ReferenceEnvelope = {
  formatVersion: 1
  nextId: number
  rows: Record<string, Array<Record<string, unknown> & { Id: string }>>
  schemaVersion: number
}

export type ReferencePending = {
  failure?: { message: string; permanent: boolean }
  optimistic?: boolean
  transaction: AccountProtocol.Transaction
}

/** ReferenceCheckpoint is encrypted as a unit; credentials and encryption keys never enter it. */
export type ReferenceCheckpoint = {
  accountId: string
  complete: boolean
  coverage: string
  formatVersion: 1
  pending: ReferencePending[]
  revision: number
  snapshot: ReferenceEnvelope
}

export type ReferenceOfflineScope = { actor: 'account'; entity: string; field: string }

export function referenceOfflineScopes(value: unknown, schema: TR.DataSchemaDefinition): ReferenceOfflineScope[] {
  if (value === undefined) {
    return []
  }
  Assert.input(Array.isArray(value), 'Reference Offline requires working-set descriptors.')
  return value.map((item: unknown) => {
    Assert.input(
      item !== null && typeof item === 'object' && !Array.isArray(item),
      'Reference Offline requires a working-set descriptor.',
    )
    const descriptor = item as Partial<ReferenceOfflineScope>
    Assert.input(
      descriptor.actor === 'account' && typeof descriptor.entity === 'string' && typeof descriptor.field === 'string',
      'Reference Offline supports current-account working sets.',
    )
    const entity = schema.entities[descriptor.entity]
    Assert.input(
      entity !== undefined && (descriptor.field === 'id' || entity.fields[descriptor.field] !== undefined),
      'Reference Offline names an unknown entity or field.',
    )
    return { actor: 'account', entity: descriptor.entity, field: descriptor.field }
  })
}

export function retainReferenceWorkingSet(
  snapshot: ReferenceEnvelope,
  scopes: readonly ReferenceOfflineScope[],
  accountId: string,
): ReferenceEnvelope {
  return {
    ...snapshot,
    rows: Object.fromEntries(
      Object.entries(snapshot.rows).map(([entity, rows]) => [
        entity,
        rows.filter(row =>
          scopes.some(scope =>
            scope.entity === entity && (scope.field === 'id' ? row.Id : row[scope.field]) === accountId
          )
        ),
      ]),
    ),
  }
}

export function referenceEnvelope(
  snapshot: AccountProtocol.Snapshot,
  schema: TR.DataSchemaDefinition,
): ReferenceEnvelope {
  const rows: ReferenceEnvelope['rows'] = Object.fromEntries(Object.keys(schema.entities).map(name => [name, []]))
  for (const row of snapshot.rows) {
    Assert.input(
      typeof row.id === 'string' && typeof row.entity === 'string' && row.fields !== null
        && typeof row.fields === 'object',
      'The account server returned an invalid row.',
    )
    const definition = schema.entities[row.entity]
    if (definition === undefined) {
      continue
    }
    const fields = Object.fromEntries(
      Object.entries(definition.fields).map(([name, field]) => [
        name,
        Object.hasOwn(row.fields, name)
          ? row.fields[name]
          : field.defaultValue ?? (field.kind === 'text'
            ? ''
            : field.kind === 'boolean'
            ? false
            : field.kind === 'relation' || field.kind === 'reference'
            ? null
            : 0),
      ]),
    )
    rows[row.entity]!.push({ ...fields, Id: row.id })
  }
  return { formatVersion: 1, nextId: 1, rows, schemaVersion: schema.schemaVersion ?? 1 }
}

export function parseReferenceEnvelope(serialized: string): ReferenceEnvelope {
  const value = JSON.parse(serialized) as ReferenceEnvelope
  Assert.input(
    value?.formatVersion === 1 && value.rows !== null && typeof value.rows === 'object' && !Array.isArray(value.rows),
    'Reference data requires a valid snapshot.',
  )
  return value
}

/** Writes compare only the runtime's captured authoring baseline, never a later remote snapshot. */
export function referenceOperations(
  previous: ReferenceEnvelope,
  next: ReferenceEnvelope,
  intents: readonly { entity: string; fields: readonly string[]; id: string }[],
): AccountProtocol.Operation[] {
  const operations: AccountProtocol.Operation[] = []
  for (const [entity, rows] of Object.entries(next.rows)) {
    const oldRows = new Map((previous.rows[entity] ?? []).map(row => [row.Id, row]))
    for (const row of rows) {
      const before = oldRows.get(row.Id)
      const { Id: id, ...fields } = row
      if (before === undefined) {
        operations.push({ entity, fields, id, kind: 'create' })
      } else {
        const written = new Set(
          intents.filter(intent => intent.entity === entity && intent.id === id).flatMap(intent => intent.fields),
        )
        const changed = Object.fromEntries(
          Object.entries(fields).filter(([key, value]) =>
            written.has(key) || JSON.stringify(value) !== JSON.stringify(before[key])
          ),
        )
        if (Object.keys(changed).length > 0) {
          operations.push({ entity, fields: changed, id, kind: 'update' })
        }
        oldRows.delete(id)
      }
    }
    for (const id of oldRows.keys()) {
      operations.push({ entity, id, kind: 'delete' })
    }
  }
  return operations
}

/** Preserve recoverable drafts over refreshed authorized rows until each write is acknowledged. */
export function projectReferenceWrites(
  snapshot: ReferenceEnvelope,
  pending: readonly ReferencePending[],
): ReferenceEnvelope {
  const projected = structuredClone(snapshot)
  for (const { transaction } of pending) {
    for (const operation of transaction.operations) {
      const rows = projected.rows[operation.entity]
      if (rows === undefined) {
        continue
      }
      const index = rows.findIndex(row => row.Id === operation.id)
      if (operation.kind === 'delete') {
        if (index >= 0) {
          rows.splice(index, 1)
        }
      } else if (index >= 0) {
        rows[index] = { ...rows[index]!, ...operation.fields }
      } else if (operation.kind === 'create') {
        rows.push({ ...operation.fields, Id: operation.id })
      }
    }
  }
  return projected
}
