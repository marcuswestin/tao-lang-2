import { RuntimeAssert } from './TR-assert'
import type { TaoDataSchemaDefinition, TaoDataWriteIntent } from './TR-data'

/** One provider-neutral row change in a committed snapshot. */
export type TaoDataRowOperation =
  | Readonly<{ entity: string; fields: Readonly<Record<string, unknown>>; id: string; kind: 'update' }>
  | Readonly<{ entity: string; field: string; id: string; kind: 'link'; target: string }>
  | Readonly<{ entity: string; field: string; id: string; kind: 'unlink'; target: string | null }>
  | Readonly<{ entity: string; id: string; kind: 'delete' }>

type SnapshotRows = Readonly<{ rows: Record<string, Record<string, unknown>[]> }>

function rowsOf(snapshot: string): SnapshotRows {
  const parsed: Partial<SnapshotRows> | null = JSON.parse(snapshot)
  RuntimeAssert(
    parsed !== null && typeof parsed === 'object' && typeof parsed.rows === 'object' && parsed.rows !== null,
    'the runtime hands a hosted provider a snapshot envelope',
  )
  return { rows: parsed.rows }
}

function sameValue(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right)
}

/** Diff two runtime snapshots; authored same-value fields remain explicit writes. */
export function rowOperations(
  definition: TaoDataSchemaDefinition,
  previous: string | undefined,
  next: string,
  intents: readonly TaoDataWriteIntent[],
): TaoDataRowOperation[] {
  const before = previous === undefined ? undefined : rowsOf(previous)
  const after = rowsOf(next)
  const updates: TaoDataRowOperation[] = []
  const links: TaoDataRowOperation[] = []
  const deletes: TaoDataRowOperation[] = []
  for (const [entity, entityDefinition] of Object.entries(definition.entities)) {
    const previousRows = new Map((before?.rows[entity] ?? []).map(row => [row['Id'] as string, row]))
    const nextIds = new Set<string>()
    for (const row of after.rows[entity] ?? []) {
      const id = row['Id'] as string
      nextIds.add(id)
      const old = previousRows.get(id)
      const touched = new Set(
        intents.filter(intent => intent.entity === entity && intent.id === id).flatMap(intent => intent.fields),
      )
      const fields: Record<string, unknown> = {}
      for (const [field, fieldDefinition] of Object.entries(entityDefinition.fields)) {
        if (fieldDefinition.kind === 'relation') {
          const target = (row[field] ?? null) as string | null
          const oldTarget = old === undefined ? null : (old[field] ?? null) as string | null
          if (target === oldTarget && !touched.has(field)) {
            continue
          }
          if (target === null) {
            links.push({ entity, field, id, kind: 'unlink', target: oldTarget })
          } else {
            links.push({ entity, field, id, kind: 'link', target })
          }
          continue
        }
        const value = row[field] ?? null
        if (old === undefined ? value !== null : touched.has(field) || !sameValue(old[field] ?? null, value)) {
          fields[field] = value
        }
      }
      if (old === undefined || Object.keys(fields).length > 0) {
        updates.push({ entity, fields, id, kind: 'update' })
      }
    }
    for (const id of previousRows.keys()) {
      if (!nextIds.has(id)) {
        deletes.push({ entity, id, kind: 'delete' })
      }
    }
  }
  return [...updates, ...links, ...deletes]
}

/** DataRows is the hosted provider seam for translating snapshot commits into row writes. */
export const DataRows = { rowOperations } as const
