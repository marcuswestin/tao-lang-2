import { Switch } from '@shared/core'
import { ConvexError } from 'convex/values'

function deny(message: string): never {
  throw new ConvexError(message)
}

/** Server-only operations imported by the generated Convex functions. All access checks run here. */
export type Grant = Readonly<{
  operations: readonly ('read' | 'create' | 'update' | 'delete')[]
  principal: readonly string[]
  updateFields?: readonly string[]
}>

export type BackendEntity = Readonly<{
  fields: Readonly<
    Record<
      string,
      Readonly<{
        cases?: readonly string[]
        defaultNow?: true
        defaultValue?: boolean | number | string
        kind: 'boolean' | 'enum' | 'number' | 'reference' | 'relation' | 'text' | 'time'
        onDelete?: string
        optional?: boolean
        relation?: string
      }>
    >
  >
  inverseFields: Readonly<Record<string, Readonly<{ relation: string; inverseField: string }>>>
  grants: readonly Grant[]
  table: string
}>

export type BackendPlan = Readonly<{
  accountEntity?: string
  entities: Readonly<Record<string, BackendEntity>>
  protected: boolean
}>

type Row = Record<string, unknown> & { taoId: string; _id?: string; accountSubject?: string }
type Identity = Readonly<{ tokenIdentifier: string }> | null
type Query = { collect(): Promise<Row[]> }
export type BackendContext = Readonly<{
  auth: { getUserIdentity(): Promise<Identity> }
  db: {
    query(table: string): Query
    insert(table: string, value: Record<string, unknown>): Promise<string>
    patch(id: string, value: Record<string, unknown>): Promise<void>
    delete(id: string): Promise<void>
  }
}>

export type RowOperation =
  | Readonly<{ entity: string; fields: Readonly<Record<string, unknown>>; id: string; kind: 'update' }>
  | Readonly<{ entity: string; field: string; id: string; kind: 'link'; target: string }>
  | Readonly<{ entity: string; field: string; id: string; kind: 'unlink'; target: string | null }>
  | Readonly<{ entity: string; id: string; kind: 'delete' }>

type Rows = Map<string, Map<string, Row>>
type Field = BackendEntity['fields'][string]

function validField(value: unknown, field: Field): boolean {
  if (value === null) {
    return field.optional === true
  }
  if (value === undefined) {
    return false
  }
  return Switch(field.kind, {
    boolean: () => typeof value === 'boolean',
    enum: () => typeof value === 'string' && field.cases?.includes(value) === true,
    number: () => typeof value === 'number' && Number.isFinite(value),
    reference: () => typeof value === 'string' || typeof value === 'number',
    relation: () => typeof value === 'string' && value.length > 0,
    text: () => typeof value === 'string',
    time: () => typeof value === 'number' && Number.isFinite(value),
  })
}

function fallbackValue(field: Field): unknown {
  if (field.optional === true) {
    return field.defaultValue ?? null
  }
  if (field.defaultValue !== undefined) {
    return field.defaultValue
  }
  return Switch(field.kind, {
    boolean: () => false,
    enum: () => field.cases?.[0] ?? '',
    number: () => 0,
    reference: () => null,
    relation: () => null,
    text: () => '',
    time: () => 0,
  })
}

function projectedValue(value: unknown, field: Field): unknown {
  if (validField(value, field)) {
    return value
  }
  const fallback = fallbackValue(field)
  if (!validField(fallback, field)) {
    deny('Convex cannot project a missing required relation or reference.')
  }
  return fallback
}

function fillDefaults(row: Row, definition: BackendEntity): void {
  for (const [name, field] of Object.entries(definition.fields)) {
    if (row[name] !== undefined) {
      continue
    }
    if (field.defaultNow === true) {
      row[name] = Date.now()
    } else if (field.defaultValue !== undefined) {
      row[name] = field.defaultValue
    } else if (field.optional === true) {
      row[name] = null
    }
  }
}

function validateRow(row: Row, definition: BackendEntity, incompleteAccount: boolean): void {
  for (const [name, field] of Object.entries(definition.fields)) {
    if (row[name] === undefined && incompleteAccount) {
      continue
    }
    if (!validField(row[name], field)) {
      deny(`Convex requires a valid '${name}' field.`)
    }
  }
}

async function allRows(ctx: BackendContext, plan: BackendPlan): Promise<Rows> {
  const rows: Rows = new Map()
  for (const [entity, definition] of Object.entries(plan.entities)) {
    rows.set(entity, new Map((await ctx.db.query(definition.table).collect()).map(row => [row.taoId, row])))
  }
  return rows
}

async function accountId(ctx: BackendContext, plan: BackendPlan, rows: Rows): Promise<string | undefined> {
  if (!plan.protected) {
    return undefined
  }
  const identity = await ctx.auth.getUserIdentity()
  if (identity === null) {
    return undefined
  }
  const account = rows.get(plan.accountEntity ?? '')
  return [...(account?.values() ?? [])].find(row => row.accountSubject === identity.tokenIdentifier)?.taoId
}

function principalRows(plan: BackendPlan, rows: Rows, entity: string, row: Row, path: readonly string[]): Row[] {
  let candidates: { entity: string; row: Row }[] = [{ entity, row }]
  for (const field of path) {
    const next: { entity: string; row: Row }[] = []
    for (const candidate of candidates) {
      const definition = plan.entities[candidate.entity]!
      const forward = definition.fields[field]
      if (forward?.kind === 'relation' && forward.relation !== undefined) {
        const target = rows.get(forward.relation)?.get(candidate.row[field] as string)
        if (target !== undefined) {
          next.push({ entity: forward.relation, row: target })
        }
      } else {
        const inverse = definition.inverseFields[field]
        if (inverse !== undefined) {
          for (const target of rows.get(inverse.relation)?.values() ?? []) {
            if (target[inverse.inverseField] === candidate.row.taoId) {
              next.push({ entity: inverse.relation, row: target })
            }
          }
        }
      }
    }
    candidates = next
  }
  return candidates.filter(candidate => candidate.entity === plan.accountEntity).map(candidate => candidate.row)
}

/** Server authorization, including principal paths and per-field update grants. */
export function permits(
  plan: BackendPlan,
  rows: Rows,
  account: string | undefined,
  entity: string,
  row: Row,
  operation: Grant['operations'][number],
  fields: readonly string[] = [],
): boolean {
  if (!plan.protected) {
    return true
  }
  if (account === undefined) {
    return false
  }
  if (entity === plan.accountEntity && operation === 'create') {
    return false
  }
  const definition = plan.entities[entity]
  if (definition === undefined) {
    return false
  }
  const matches = (grant: Grant): boolean =>
    grant.operations.includes(operation)
    && principalRows(plan, rows, entity, row, grant.principal).some(principal => principal.taoId === account)
  if (operation === 'update') {
    return fields.length > 0
      && fields.every(field =>
        definition.grants.some(grant => matches(grant) && grant.updateFields?.includes(field) === true)
      )
  }
  return definition.grants.some(matches)
}

function requireAccess(allowed: boolean): void {
  if (!allowed) {
    deny('Convex denied access to this row.')
  }
}

/** Resolve or create the signed-in user's Account inside one server mutation. */
export async function ensureAccount(ctx: BackendContext, plan: BackendPlan): Promise<string> {
  if (!plan.protected || plan.accountEntity === undefined) {
    deny('This datasource has no Account.')
  }
  const identity = await ctx.auth.getUserIdentity()
  if (identity === null) {
    deny('Sign in to access account data.')
  }
  const definition = plan.entities[plan.accountEntity]!
  const existing = (await ctx.db.query(definition.table).collect()).find(
    row => row.accountSubject === identity.tokenIdentifier,
  )
  if (existing !== undefined) {
    return existing.taoId
  }
  const taoId = `account:${identity.tokenIdentifier}`
  const account: Row = { accountSubject: identity.tokenIdentifier, taoId }
  fillDefaults(account, definition)
  for (const [field, shape] of Object.entries(definition.fields)) {
    if (account[field] === undefined) {
      account[field] = fallbackValue(shape)
    }
  }
  validateRow(account, definition, false)
  await ctx.db.insert(definition.table, account)
  return taoId
}

/** Read only rows authorized by the generated policy. No device-side filtering grants access. */
export async function listRows(
  ctx: BackendContext,
  plan: BackendPlan,
): Promise<Record<string, Record<string, unknown>[]>> {
  const rows = await allRows(ctx, plan)
  const account = await accountId(ctx, plan, rows)
  return Object.fromEntries(
    Object.entries(plan.entities).map(([entity, definition]) => [
      entity,
      [...rows.get(entity)!.values()].filter(row => permits(plan, rows, account, entity, row, 'read')).map(row => ({
        Id: row.taoId,
        ...Object.fromEntries(
          Object.entries(definition.fields).map(([field, shape]) => {
            const value = projectedValue(row[field], shape)
            if (shape.kind !== 'relation' || value === null || shape.relation === undefined) {
              return [field, value]
            }
            const target = rows.get(shape.relation)?.get(value as string)
            return [
              field,
              target !== undefined && permits(plan, rows, account, shape.relation, target, 'read') ? value : null,
            ]
          }),
        ),
      })),
    ]),
  )
}

/** Apply one Tao commit atomically, validating the old and resulting row before each write. */
export async function writeRows(
  ctx: BackendContext,
  plan: BackendPlan,
  operations: readonly RowOperation[],
): Promise<void> {
  const rows = await allRows(ctx, plan)
  const beforeRows: Rows = new Map(
    [...rows].map(([entity, entries]) => [entity, new Map([...entries].map(([id, row]) => [id, { ...row }]))]),
  )
  const account = await accountId(ctx, plan, rows)
  const changed = new Map<string, { entity: string; id: string; fields: Set<string>; deleted: boolean; old?: Row }>()
  const operationKinds = new Map<string, 'delete' | 'mutation'>()
  for (const operation of operations) {
    if (!['update', 'link', 'unlink', 'delete'].includes(operation.kind)) {
      deny('Unknown Tao row operation.')
    }
    const definition = plan.entities[operation.entity]
    if (definition === undefined) {
      deny('Unknown Tao entity.')
    }
    if (typeof operation.id !== 'string' || operation.id.length === 0) {
      deny('Invalid Tao row id.')
    }
    const key = `${operation.entity}\0${operation.id}`
    const operationKind = operation.kind === 'delete' ? 'delete' : 'mutation'
    const previousKind = operationKinds.get(key)
    if (previousKind !== undefined && previousKind !== operationKind) {
      deny('Cannot delete and mutate the same Tao row in one commit.')
    }
    operationKinds.set(key, operationKind)
    const current = rows.get(operation.entity)!.get(operation.id)
    const record = changed.get(key) ?? {
      entity: operation.entity,
      id: operation.id,
      fields: new Set<string>(),
      deleted: false,
      ...(current === undefined ? {} : { old: { ...current } }),
    }
    changed.set(key, record)
    if (operation.kind === 'delete') {
      if (current === undefined) {
        deny('Cannot delete a missing row.')
      }
      record.deleted = true
      rows.get(operation.entity)!.delete(operation.id)
      continue
    }
    const next = current ?? { taoId: operation.id }
    if (operation.kind === 'update') {
      for (const [field, value] of Object.entries(operation.fields)) {
        const fieldDefinition = definition.fields[field]
        if (fieldDefinition === undefined || fieldDefinition.kind === 'relation') {
          deny('Unknown Tao field.')
        }
        if (!validField(value, fieldDefinition)) {
          deny('Invalid Tao field value.')
        }
        next[field] = value
        record.fields.add(field)
      }
    } else {
      const fieldDefinition = definition.fields[operation.field]
      if (fieldDefinition?.kind !== 'relation' || fieldDefinition.relation === undefined) {
        deny('Unknown Tao relation.')
      }
      if (operation.kind === 'link') {
        if (typeof operation.target !== 'string' || operation.target.length === 0) {
          deny('Invalid Tao relation target.')
        }
        next[operation.field] = operation.target
      } else {
        const present = next[operation.field] ?? null
        if (
          !(operation.target === null && present === null)
          && !(typeof operation.target === 'string' && operation.target.length > 0 && present === operation.target)
        ) {
          deny('Invalid Tao relation target.')
        }
        next[operation.field] = null
      }
      record.fields.add(operation.field)
    }
    rows.get(operation.entity)!.set(operation.id, next)
  }
  for (const record of changed.values()) {
    if (record.deleted) {
      continue
    }
    const row = rows.get(record.entity)!.get(record.id)!
    for (const field of record.fields) {
      const shape = plan.entities[record.entity]!.fields[field]
      if (shape?.kind !== 'relation' || row[field] == null) {
        continue
      }
      const target = rows.get(shape.relation!)?.get(row[field] as string)
      requireAccess(target !== undefined && permits(plan, rows, account, shape.relation!, target, 'read'))
    }
  }
  const deleted = new Set(
    [...changed.values()].filter(record => record.deleted).map(record => `${record.entity}\0${record.id}`),
  )
  const implicitDeletes = new Set<string>()
  let foundCascade = true
  while (foundCascade) {
    foundCascade = false
    for (const [entity, definition] of Object.entries(plan.entities)) {
      for (const row of rows.get(entity)!.values()) {
        const cascades = Object.entries(definition.fields).some(([field, shape]) =>
          shape.kind === 'relation' && shape.onDelete === 'cascade' && shape.relation !== undefined
          && deleted.has(`${shape.relation}\0${String(row[field])}`)
        )
        if (!cascades) {
          continue
        }
        const key = `${entity}\0${row.taoId}`
        const prior = changed.get(key)
        if (prior?.old === undefined && prior !== undefined) {
          deny('Cannot create a row beneath a deleted parent.')
        }
        changed.set(
          key,
          prior ?? {
            entity,
            id: row.taoId,
            fields: new Set<string>(),
            deleted: true,
            old: { ...row },
          },
        )
        if (prior !== undefined) {
          prior.deleted = true
        }
        rows.get(entity)!.delete(row.taoId)
        deleted.add(key)
        implicitDeletes.add(key)
        foundCascade = true
      }
    }
  }
  for (const [entity, definition] of Object.entries(plan.entities)) {
    for (const row of rows.get(entity)!.values()) {
      for (const [field, shape] of Object.entries(definition.fields)) {
        if (
          shape.kind === 'relation' && shape.relation !== undefined
          && deleted.has(`${shape.relation}\0${String(row[field])}`)
        ) {
          deny(`Cannot delete the referenced row because ${entity}.${field} still refers to it.`)
        }
      }
    }
  }
  for (const [entity, definition] of Object.entries(plan.entities)) {
    for (const row of rows.get(entity)!.values()) {
      for (const [field, shape] of Object.entries(definition.fields)) {
        if (shape.kind === 'relation' && row[field] != null) {
          requireAccess(shape.relation !== undefined && rows.get(shape.relation)?.has(row[field] as string) === true)
        }
      }
    }
  }
  for (const record of changed.values()) {
    const definition = plan.entities[record.entity]!
    const next = rows.get(record.entity)!.get(record.id)
    if (next !== undefined) {
      if (record.old === undefined) {
        fillDefaults(next, definition)
      }
      validateRow(next, definition, record.entity === plan.accountEntity && record.old !== undefined)
    }
    if (record.old === undefined) {
      requireAccess(next !== undefined && permits(plan, rows, account, record.entity, next, 'create'))
    } else if (record.deleted) {
      if (!implicitDeletes.has(`${record.entity}\0${record.id}`)) {
        requireAccess(permits(plan, beforeRows, account, record.entity, record.old, 'delete'))
      }
    } else {
      requireAccess(
        next !== undefined && permits(plan, rows, account, record.entity, record.old, 'update', [...record.fields]),
      )
      requireAccess(
        next !== undefined && permits(plan, rows, account, record.entity, next, 'update', [...record.fields]),
      )
      for (const field of record.fields) {
        if (
          definition.fields[field]?.kind === 'relation' && definition.grants.some(grant => grant.principal[0] === field)
        ) {
          requireAccess(record.old[field] === next?.[field])
        }
      }
    }
  }
  for (const record of changed.values()) {
    const definition = plan.entities[record.entity]!
    const next = rows.get(record.entity)!.get(record.id)
    if (record.deleted) {
      await ctx.db.delete(record.old!._id!)
    } else if (record.old?._id !== undefined) {
      await ctx.db.patch(record.old._id, Object.fromEntries([...record.fields].map(field => [field, next![field]])))
    } else {
      await ctx.db.insert(definition.table, next!)
    }
  }
}
