import TR from '@runtime/TR'
import { Assert, Switch } from '@shared/core'
import type { InstantMapping } from './instant-schema'

/**
 * Rows in both directions between a Tao store's snapshot envelope and InstantDB namespaces.
 *
 * InstantDB is the authority: it keeps per-attribute last-writer-wins and its own durable offline
 * queue. So a save only has to say what the store changed — rows created, fields changed, links set
 * or cleared, rows deleted — and a subscription result is projected back into a whole snapshot.
 */

type Envelope = {
  formatVersion: 1
  nextId: number
  rows: Record<string, Record<string, unknown>[]>
  schemaVersion: number
}

type Field = TR.DataSchemaDefinition['entities'][string]['fields'][string]

/** InstantRowOperation is one row-level step of the transaction a save becomes. */
export type InstantRowOperation =
  | Readonly<{ attributes: Readonly<Record<string, unknown>>; id: string; kind: 'update'; namespace: string }>
  | Readonly<{ id: string; kind: 'link'; label: string; namespace: string; target: string }>
  | Readonly<{ id: string; kind: 'unlink'; label: string; namespace: string; target: string }>
  | Readonly<{ id: string; kind: 'delete'; namespace: string }>

/** InstantQueryResult is the subscription payload: namespace → rows, links nested by label. */
export type InstantQueryResult = Readonly<Record<string, readonly Readonly<Record<string, unknown>>[] | undefined>>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * RowIdentities pairs the store's row ids with InstantDB's UUIDs. A store id that already is a UUID
 * is used as is; any other id (the runtime's `Note-3`) gets a UUID on its first save, and the row
 * keeps projecting under the store's id for as long as this connection lives. After a relaunch the
 * row simply arrives under its UUID, which is a valid store id too, so nothing needs persisting.
 */
export class RowIdentities {
  private readonly remoteOfLocal = new Map<string, string>()
  private readonly localOfRemote = new Map<string, string>()

  constructor(private readonly mint: () => string) {}

  /** remote returns the UUID for a store id, minting one the first time a row is saved. */
  remote(local: string): string {
    if (uuidPattern.test(local)) {
      return local
    }
    const existing = this.remoteOfLocal.get(local)
    if (existing !== undefined) {
      return existing
    }
    const minted = this.mint()
    Assert(uuidPattern.test(minted), 'InstantDB mints UUID row ids', { minted })
    this.remoteOfLocal.set(local, minted)
    this.localOfRemote.set(minted, local)
    return minted
  }

  /** local returns the store id a UUID projects under. */
  local(remote: string): string {
    return this.localOfRemote.get(remote) ?? remote
  }
}

/** instantQuery subscribes every namespace, with each forward link's target id. */
export function instantQuery(mapping: InstantMapping): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.values(mapping.entities).map(entity => [
      entity.namespace,
      Object.fromEntries(Object.values(entity.relations).map(relation => [relation.label, { $: { fields: ['id'] } }])),
    ]),
  )
}

/**
 * rowOperations turns one committed snapshot into the operations that make InstantDB hold it,
 * diffed against the snapshot the store had consumed before the commit. Intents carry fields an
 * author set to the value they already held, which a diff alone would lose.
 */
export function rowOperations(
  mapping: InstantMapping,
  definition: TR.DataSchemaDefinition,
  previous: string | undefined,
  next: string,
  intents: readonly TR.DataWriteIntent[],
  identities: RowIdentities,
): InstantRowOperation[] {
  return TR.DataRows.rowOperations(definition, previous, next, intents).flatMap(operation => {
    // InstaML unlink names a target id; it has no clear-unknown-target transaction.
    if (operation.kind === 'unlink' && operation.target === null) {
      return []
    }
    const mapped = mapping.entities[operation.entity]!
    const id = identities.remote(operation.id)
    return [Switch.on(operation, 'kind', {
      delete: (): InstantRowOperation => ({ id, kind: 'delete', namespace: mapped.namespace }),
      link: (link): InstantRowOperation => ({
        id,
        kind: 'link',
        label: mapped.relations[link.field]!.label,
        namespace: mapped.namespace,
        target: identities.remote(link.target),
      }),
      unlink: (unlink): InstantRowOperation => ({
        id,
        kind: 'unlink',
        label: mapped.relations[unlink.field]!.label,
        namespace: mapped.namespace,
        target: identities.remote(unlink.target!),
      }),
      update: (update): InstantRowOperation => ({
        attributes: Object.fromEntries(
          Object.entries(update.fields).map(([field, value]) => [mapped.attributes[field]!, value]),
        ),
        id,
        kind: 'update',
        namespace: mapped.namespace,
      }),
    })]
  })
}

/**
 * projectSnapshot builds the store's snapshot from a subscription result.
 *
 * Rows keep the order the store last held, new rows following in the authority's order. A value
 * the store could not accept — absent, or not of the field's type — reads as the field's default,
 * so a row written by an older schema still loads. A relation whose target is absent (deleted, or
 * not readable by this account) reads as empty when optional; otherwise, unless the store accepts
 * absent relations, the row itself is left out until its target returns. A required relation with
 * no link at all always leaves its row out.
 */
export function projectSnapshot(
  mapping: InstantMapping,
  definition: TR.DataSchemaDefinition,
  result: InstantQueryResult,
  identities: RowIdentities,
  options: Readonly<{ allowAbsentRelations: boolean; nextId: number; order?: string | undefined }>,
): string {
  const order = options.order === undefined ? undefined : parseRows(options.order)
  const rows: Record<string, Record<string, unknown>[]> = {}
  for (const [entityName, entity] of Object.entries(definition.entities)) {
    const mapped = mapping.entities[entityName]!
    const projected = (result[mapped.namespace] ?? []).flatMap(remote => {
      if (typeof remote['id'] !== 'string') {
        return []
      }
      const row: Record<string, unknown> = { Id: identities.local(remote['id']) }
      for (const [field, definitionOfField] of Object.entries(entity.fields)) {
        const relation = mapped.relations[field]
        if (relation !== undefined) {
          const target = linkedId(remote[relation.label])
          row[field] = target === undefined ? null : identities.local(target)
          continue
        }
        const value = remote[mapped.attributes[field]!]
        row[field] = acceptedValue(value, definitionOfField) ? value ?? null : defaultValue(definitionOfField)
      }
      return [row]
    })
    const position = new Map((order?.rows[entityName] ?? []).map((row, index) => [row['Id'], index]))
    rows[entityName] = projected
      .map((row, index) => ({ index: position.get(row['Id']) ?? Number.MAX_SAFE_INTEGER, row, serverIndex: index }))
      .sort((left, right) => left.index - right.index || left.serverIndex - right.serverIndex)
      .map(entry => entry.row)
  }
  resolveRelations(definition, rows, options.allowAbsentRelations)
  const envelope: Envelope = {
    formatVersion: 1,
    nextId: options.nextId,
    rows,
    schemaVersion: definition.schemaVersion ?? 1,
  }
  return JSON.stringify(envelope)
}

/** snapshotNextId reads a snapshot's id counter, so the projection never hands out an id twice. */
export function snapshotNextId(snapshot: string): number {
  return parseRows(snapshot).nextId
}

function resolveRelations(
  definition: TR.DataSchemaDefinition,
  rows: Record<string, Record<string, unknown>[]>,
  allowAbsentRelations: boolean,
): void {
  // Leaving out a row can strand rows that refer to it, so repeat until nothing changes.
  let changed = true
  while (changed) {
    changed = false
    for (const [entityName, entity] of Object.entries(definition.entities)) {
      rows[entityName] = rows[entityName]!.filter(row => {
        for (const [field, fieldDefinition] of Object.entries(entity.fields)) {
          const target = row[field]
          if (fieldDefinition.kind !== 'relation') {
            continue
          }
          if (target === null) {
            if (fieldDefinition.optional === true) {
              continue
            }
            changed = true
            return false
          }
          const present = rows[fieldDefinition.relation!]!.some(candidate => candidate['Id'] === target)
          if (present) {
            continue
          }
          if (fieldDefinition.optional === true) {
            row[field] = null
            changed = true
            continue
          }
          if (!allowAbsentRelations) {
            changed = true
            return false
          }
        }
        return true
      })
    }
  }
}

function linkedId(value: unknown): string | undefined {
  const linked = Array.isArray(value) ? value[0] : value
  return typeof linked === 'object' && linked !== null && typeof (linked as { id?: unknown }).id === 'string'
    ? (linked as { id: string }).id
    : undefined
}

function acceptedValue(value: unknown, field: Field): boolean {
  if (value === null || value === undefined) {
    return field.optional === true
  }
  const kinds: Record<Field['kind'], () => boolean> = {
    boolean: () => typeof value === 'boolean',
    enum: () => typeof value === 'string' && field.cases?.includes(value) === true,
    number: () => typeof value === 'number' && Number.isFinite(value),
    reference: () => typeof value === 'string' || typeof value === 'number',
    relation: () => typeof value === 'string',
    text: () => typeof value === 'string',
    time: () => typeof value === 'number' && Number.isFinite(value),
  }
  return kinds[field.kind]()
}

function defaultValue(field: Field): unknown {
  if (field.optional === true || field.kind === 'reference') {
    return field.defaultValue ?? null
  }
  if (field.defaultValue !== undefined) {
    return field.defaultValue
  }
  const zero: Record<Field['kind'], unknown> = {
    boolean: false,
    enum: field.cases?.[0] ?? '',
    number: 0,
    reference: null,
    relation: null,
    text: '',
    time: 0,
  }
  return zero[field.kind]
}

function parseRows(snapshot: string): Envelope {
  const parsed = JSON.parse(snapshot) as Partial<Envelope> | null
  Assert(
    parsed !== null && typeof parsed === 'object' && typeof parsed.rows === 'object' && parsed.rows !== null,
    'the runtime hands InstantDB a snapshot envelope',
  )
  return { formatVersion: 1, nextId: parsed.nextId ?? 1, rows: parsed.rows, schemaVersion: parsed.schemaVersion ?? 1 }
}
