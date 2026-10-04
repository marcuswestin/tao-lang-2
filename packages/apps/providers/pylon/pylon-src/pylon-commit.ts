import type TR from '@runtime/TR'
import { Assert, Switch } from '@shared/core'
import type { TaoDataPolicy } from './generate'

type Row = Record<string, unknown>
type Group = { entity: string; id: string; fields: Row; deletes: boolean; touches: Set<string>; old: Row | null }
type Operation =
  | { entity: string; fields: Row; id: string; kind: 'update' }
  | { entity: string; field: string; id: string; kind: 'link'; target: string }
  | { entity: string; field: string; id: string; kind: 'unlink'; target: string | null }
  | { entity: string; id: string; kind: 'delete' }

type ServerContext = {
  auth: { userId: string | null; isGuest: boolean }
  db: {
    unsafe: {
      get(entity: string, id: string): Promise<Row | null>
      insert(entity: string, data: Row): Promise<string>
      update(entity: string, id: string, data: Row): Promise<boolean>
      delete(entity: string, id: string): Promise<boolean>
      link(entity: string, id: string, relation: string, targetId: string): Promise<boolean>
      unlink(entity: string, id: string, relation: string): Promise<boolean>
      paginate(entity: string, options: { cursor: string | null; numItems: number }): Promise<{
        page: Row[]
        nextCursor: string | null
        isDone: boolean
      }>
    }
  }
  error(code: string, message: string): Error
}

/** Called inside a Pylon mutation transaction. Every unsafe DB access is gated here. */
export function createPylonCommitHandler(schema: TR.DataSchemaDefinition, access: TaoDataPolicy) {
  return async (ctx: ServerContext, args: { id: string; operations: unknown[] }): Promise<{ status: 'saved' }> => {
    const userId = ctx.auth.userId
    if (!userId || ctx.auth.isGuest) {
      throw ctx.error('UNAUTHENTICATED', 'Sign in to save data.')
    }
    if (typeof args.id !== 'string' || !args.id || args.id.length > 200 || !Array.isArray(args.operations)) {
      throw ctx.error('INVALID_INPUT', 'Invalid commit.')
    }
    // The receipt is private and checked against the authenticated owner before deduplication.
    const prior = await ctx.db.unsafe.get('TaoCommit', args.id)
    if (prior) {
      if (prior['UserId'] !== userId) {
        throw ctx.error('FORBIDDEN', 'Commit belongs to another account.')
      }
      return { status: 'saved' }
    }
    const operations = args.operations.map(value => operationOf(ctx, schema, value))
    const groups = new Map<string, Group>()
    for (const operation of operations) {
      const key = `${operation.entity}\0${operation.id}`
      let group = groups.get(key)
      if (!group) {
        group = {
          entity: operation.entity,
          id: operation.id,
          fields: {},
          deletes: false,
          touches: new Set(),
          old: null,
        }
        groups.set(key, group)
      }
      if (operation.kind === 'delete') {
        group.deletes = true
      } else if (operation.kind === 'update') {
        Object.assign(group.fields, operation.fields)
        for (const field of Object.keys(operation.fields)) {
          group.touches.add(field)
        }
      } else {
        group.fields[operation.field] = operation.kind === 'link' ? operation.target : null
        group.touches.add(operation.field)
      }
    }
    if (groups.size > 100) {
      throw ctx.error('INVALID_INPUT', 'Commit is too large.')
    }
    // Preflight every explicit row before the first write. Mutation transactions roll back on any
    // later failure too, but this makes authorization independent of operation ordering.
    for (const group of groups.values()) {
      if (group.deletes && group.touches.size > 0) {
        throw ctx.error('INVALID_INPUT', 'Cannot change and delete the same row.')
      }
      // Unsafe read is necessary because raw writes are denied and authorization is checked below.
      group.old = await ctx.db.unsafe.get(group.entity, group.id)
      const operation = group.deletes ? 'delete' : group.old ? 'update' : 'create'
      if (operation === 'create' && group.entity === access.accountEntity) {
        throw ctx.error('FORBIDDEN', 'Accounts are created by sign-in.')
      }
      if (operation !== 'create' && !group.old) {
        throw ctx.error('NOT_FOUND', 'Row no longer exists.')
      }
      if (operation === 'create') {
        completeCreateFields(schema, group)
      }
      const candidate = { ...(group.old ?? {}), ...group.fields, id: group.id }
      if (operation === 'create') {
        validateCompleteRow(ctx, schema, group.entity, candidate)
      }
      if (!await permitted(ctx, schema, access, group.entity, operation, group.old, candidate, group.touches, userId)) {
        throw ctx.error('FORBIDDEN', 'Data access denied.')
      }
    }
    const deletionOrder = await plannedDeletes(ctx, schema, groups)
    const deleted = new Set(deletionOrder.map(group => rowKey(group.entity, group.id)))
    for (const group of groups.values()) {
      if (group.deletes || deleted.has(rowKey(group.entity, group.id))) {
        continue
      }
      for (const [fieldName, field] of Object.entries(schema.entities[group.entity]!.fields)) {
        if (field.kind !== 'relation') {
          continue
        }
        if (group.old && !Object.hasOwn(group.fields, fieldName)) {
          continue
        }
        const targetId = Object.hasOwn(group.fields, fieldName) ? group.fields[fieldName] : group.old?.[fieldName]
        if (typeof targetId !== 'string') {
          continue
        }
        const target = field.relation!
        const key = rowKey(target, targetId)
        if (deleted.has(key)) {
          throw ctx.error('INVALID_INPUT', 'Relation target is being deleted.')
        }
        const planned = groups.get(key)
        let targetRow: Row | null
        if (planned) {
          if (planned.deletes) {
            throw ctx.error('INVALID_INPUT', 'Relation target is being deleted.')
          }
          targetRow = { ...(planned.old ?? {}), ...planned.fields, id: targetId }
        } else {
          // Unsafe target lookup is only used to establish referential existence.
          targetRow = await ctx.db.unsafe.get(target, targetId)
        }
        if (!targetRow) {
          throw ctx.error('INVALID_INPUT', 'Relation target does not exist.')
        }
        if (!await readable(ctx, schema, access, target, targetRow, userId)) {
          throw ctx.error('FORBIDDEN', 'Relation target is not readable.')
        }
      }
    }
    // Insert dependencies first so required relation IDs refer to rows already present.
    const creates = [...groups.values()].filter(group =>
      !group.deletes && !group.old && !deleted.has(rowKey(group.entity, group.id))
    )
    const pending = new Map(creates.map(group => [rowKey(group.entity, group.id), group]))
    while (pending.size > 0) {
      const ready = [...pending.values()].find(group =>
        Object.entries(group.fields).every(([field, value]) =>
          schema.entities[group.entity]!.fields[field]?.kind !== 'relation'
          || typeof value !== 'string'
          || !pending.has(rowKey(schema.entities[group.entity]!.fields[field]!.relation!, value))
        )
      )
      if (!ready) {
        throw ctx.error('INVALID_INPUT', 'New relations contain a cycle.')
      }
      // Unsafe insert follows complete-row, grant, and target validation above.
      await ctx.db.unsafe.insert(ready.entity, { id: ready.id, ...ready.fields })
      pending.delete(rowKey(ready.entity, ready.id))
    }
    for (const group of groups.values()) {
      if (!group.old || group.deletes || deleted.has(rowKey(group.entity, group.id))) {
        continue
      }
      const scalar: Row = {}
      for (const [field, value] of Object.entries(group.fields)) {
        if (schema.entities[group.entity]!.fields[field]?.kind === 'relation') {
          // Unsafe relation write is gated by old/new owner, field grant, and target existence.
          if (typeof value === 'string') {
            await ctx.db.unsafe.link(group.entity, group.id, field, value)
          } else {
            await ctx.db.unsafe.unlink(group.entity, group.id, field)
          }
        } else {
          scalar[field] = value
        }
      }
      // Unsafe update is gated by old/new owner and each touched field above.
      if (Object.keys(scalar).length > 0) {
        await ctx.db.unsafe.update(group.entity, group.id, scalar)
      }
    }
    for (const group of deletionOrder) {
      // A cascade follows the explicitly authorized parent along an onDelete cascade relation.
      await ctx.db.unsafe.delete(group.entity, group.id)
    }
    // Receipt insertion shares this transaction with all row writes.
    await ctx.db.unsafe.insert('TaoCommit', { id: args.id, UserId: userId })
    return { status: 'saved' }
  }
}

export function createPylonEnsureAccountHandler(schema: TR.DataSchemaDefinition, accountEntity: string) {
  return async (ctx: ServerContext): Promise<{ accountId: string }> => {
    const userId = ctx.auth.userId
    if (!userId || ctx.auth.isGuest) {
      throw ctx.error('UNAUTHENTICATED', 'Sign in to access account data.')
    }
    // The Account id is the authenticated user id; no caller-supplied id is accepted.
    const existing = await ctx.db.unsafe.get(accountEntity, userId)
    if (!existing) {
      const fields = accountBootstrapFields(schema, accountEntity, Date.now())
      await ctx.db.unsafe.insert(accountEntity, { id: userId, ...fields })
    }
    return { accountId: userId }
  }
}

/** Mirrors the hosted InstantDB account's type-zero projection for incomplete profiles. */
export function accountBootstrapFields(schema: TR.DataSchemaDefinition, accountEntity: string, now: number): Row {
  const fields: Row = {}
  for (const [name, field] of Object.entries(schema.entities[accountEntity]!.fields)) {
    if (field.defaultNow) {
      fields[name] = now
    } else if (field.defaultValue !== undefined) {
      fields[name] = field.defaultValue
    } else if (field.optional) {
      fields[name] = null
    } else {
      fields[name] = Switch(field.kind, {
        text: () => '',
        boolean: () => false,
        number: () => 0,
        time: () => 0,
        enum: () => {
          const first = field.cases?.[0]
          Assert.input(
            first !== undefined,
            `Pylon cannot bootstrap Account field '${accountEntity}.${name}' without a default.`,
          )
          return first
        },
        reference: () => {
          Assert.input(false, `Pylon cannot bootstrap Account field '${accountEntity}.${name}' without a default.`)
        },
        relation: () => {
          Assert.input(false, `Pylon cannot bootstrap Account field '${accountEntity}.${name}' without a default.`)
        },
      })
    }
  }
  return fields
}

function rowKey(entity: string, id: string): string {
  return `${entity}\0${id}`
}

/** Examine every incoming relation before deletion; Pylon has no schema-level onDelete option. */
async function plannedDeletes(
  ctx: ServerContext,
  schema: TR.DataSchemaDefinition,
  groups: Map<string, Group>,
): Promise<Group[]> {
  const rowsByEntity = new Map<string, Row[]>()
  const allRows = async (entity: string): Promise<Row[]> => {
    const cached = rowsByEntity.get(entity)
    if (cached) {
      return cached
    }
    const rows: Row[] = []
    let cursor: string | null = null
    const seen = new Set<string>()
    for (;;) {
      // Unsafe pagination scans the complete table so restrict/cascade cannot miss later pages.
      const page = await ctx.db.unsafe.paginate(entity, { cursor, numItems: 1000 })
      rows.push(...page.page)
      if (page.isDone) {
        break
      }
      if (!page.nextCursor || seen.has(page.nextCursor)) {
        throw ctx.error('HOST_ERROR', 'Relation scan did not advance.')
      }
      cursor = page.nextCursor
      seen.add(cursor)
    }
    rowsByEntity.set(entity, rows)
    return rows
  }
  const order: Group[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = async (group: Group): Promise<void> => {
    const key = rowKey(group.entity, group.id)
    if (visited.has(key)) {
      return
    }
    if (visiting.has(key)) {
      throw ctx.error('INVALID_INPUT', 'Cyclic deletion is not supported.')
    }
    visiting.add(key)
    for (const [childEntity, childDefinition] of Object.entries(schema.entities)) {
      for (const [fieldName, field] of Object.entries(childDefinition.fields)) {
        if (field.kind !== 'relation' || field.relation !== group.entity) {
          continue
        }
        for (const child of await allRows(childEntity)) {
          if (child[fieldName] !== group.id || typeof child['id'] !== 'string') {
            continue
          }
          const childId = child['id']
          const childKey = rowKey(childEntity, childId)
          const planned = groups.get(childKey)
          if (
            planned && !planned.deletes && Object.hasOwn(planned.fields, fieldName)
            && planned.fields[fieldName] !== group.id
          ) {
            continue
          }
          if (planned?.deletes) {
            await visit(planned)
          } else if (field.onDelete === 'cascade') {
            if (planned) {
              throw ctx.error('INVALID_INPUT', 'Cannot change and cascade-delete the same row.')
            }
            const cascade: Group = {
              entity: childEntity,
              id: childId,
              fields: {},
              deletes: true,
              touches: new Set(),
              old: child,
            }
            groups.set(childKey, cascade)
            await visit(cascade)
          } else {
            throw ctx.error(
              'RELATION_RESTRICTED',
              `Cannot delete ${group.entity} while ${childEntity}.${fieldName} refers to it.`,
            )
          }
        }
      }
    }
    visiting.delete(key)
    visited.add(key)
    order.push(group)
  }
  for (const group of [...groups.values()]) {
    if (group.deletes) {
      await visit(group)
    }
  }
  return order
}

function validateCompleteRow(ctx: ServerContext, schema: TR.DataSchemaDefinition, entity: string, row: Row): void {
  for (const [name, field] of Object.entries(schema.entities[entity]!.fields)) {
    const value = row[name]
    if (value === null || value === undefined) {
      if (field.optional) {
        continue
      }
      throw ctx.error('INVALID_INPUT', `Create of ${entity} is missing required field ${name}.`)
    }
    if (field.kind === 'relation' ? typeof value !== 'string' : !validFieldValue(field, value)) {
      throw ctx.error('INVALID_INPUT', `Create of ${entity} has invalid field ${name}.`)
    }
  }
}

function completeCreateFields(schema: TR.DataSchemaDefinition, group: Group): void {
  for (const [name, field] of Object.entries(schema.entities[group.entity]!.fields)) {
    if (Object.hasOwn(group.fields, name)) {
      continue
    }
    if (field.defaultNow) {
      group.fields[name] = Date.now()
    } else if (field.defaultValue !== undefined) {
      group.fields[name] = field.defaultValue
    } else if (field.optional) {
      group.fields[name] = null
    }
  }
}

function operationOf(ctx: ServerContext, schema: TR.DataSchemaDefinition, value: unknown): Operation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw ctx.error('INVALID_INPUT', 'Invalid row operation.')
  }
  const input = value as Record<string, unknown>
  const entity = input['entity']
  const id = input['id']
  const kind = input['kind']
  if (typeof entity !== 'string' || !schema.entities[entity] || typeof id !== 'string' || !id || id.length > 200) {
    throw ctx.error('INVALID_INPUT', 'Unknown row.')
  }
  if (kind === 'delete') {
    return { entity, id, kind }
  }
  if (kind === 'update') {
    const fields = input['fields']
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      throw ctx.error('INVALID_INPUT', 'Invalid row fields.')
    }
    for (const [field, fieldValue] of Object.entries(fields)) {
      const definition = schema.entities[entity]!.fields[field]
      if (!definition || definition.kind === 'relation' || !validFieldValue(definition, fieldValue)) {
        throw ctx.error('INVALID_INPUT', 'Invalid row field.')
      }
    }
    return { entity, id, kind, fields: fields as Row }
  }
  const field = input['field']
  const target = input['target']
  if (
    (kind !== 'link' && kind !== 'unlink') || typeof field !== 'string'
    || schema.entities[entity]!.fields[field]?.kind !== 'relation'
    || (kind === 'link' && (typeof target !== 'string' || !target))
    || (kind === 'unlink' && target !== null && (typeof target !== 'string' || !target))
    || (kind === 'unlink' && !schema.entities[entity]!.fields[field]?.optional)
  ) {
    throw ctx.error('INVALID_INPUT', 'Invalid relation operation.')
  }
  return { entity, id, kind, field, target } as Operation
}

function validFieldValue(
  field: TR.DataSchemaDefinition['entities'][string]['fields'][string],
  value: unknown,
): boolean {
  if (value === null) {
    return field.optional === true
  }
  return Switch(field.kind, {
    text: () => typeof value === 'string',
    boolean: () => typeof value === 'boolean',
    number: () => typeof value === 'number' && Number.isFinite(value),
    time: () => typeof value === 'number' && Number.isFinite(value),
    enum: () => typeof value === 'string' && (field.cases ?? []).includes(value),
    reference: () => typeof value === 'string' || typeof value === 'number',
    relation: () => false,
  })
}

async function permitted(
  ctx: ServerContext,
  schema: TR.DataSchemaDefinition,
  access: TaoDataPolicy,
  entity: string,
  operation: 'create' | 'update' | 'delete',
  old: Row | null,
  candidate: Row,
  touches: ReadonlySet<string>,
  userId: string,
): Promise<boolean> {
  const grants = access.entities[entity]?.grants ?? []
  const matching: (typeof grants)[number][] = []
  for (const grant of grants) {
    if (!grant.operations.includes(operation)) {
      continue
    }
    if (old && !await owns(ctx, schema, entity, old, grant.principal, userId)) {
      continue
    }
    if (operation !== 'delete' && !await owns(ctx, schema, entity, candidate, grant.principal, userId)) {
      continue
    }
    matching.push(grant)
  }
  if (matching.length === 0) {
    return false
  }
  if (operation !== 'update') {
    return true
  }
  return [...touches].every(field => matching.some(grant => !grant.updateFields || grant.updateFields.includes(field)))
}

async function readable(
  ctx: ServerContext,
  schema: TR.DataSchemaDefinition,
  access: TaoDataPolicy,
  entity: string,
  row: Row,
  userId: string,
): Promise<boolean> {
  for (const grant of access.entities[entity]?.grants ?? []) {
    if (grant.operations.includes('read') && await owns(ctx, schema, entity, row, grant.principal, userId)) {
      return true
    }
  }
  return false
}

async function owns(
  ctx: ServerContext,
  schema: TR.DataSchemaDefinition,
  entity: string,
  row: Row,
  path: readonly string[],
  userId: string,
): Promise<boolean> {
  if (path.length === 0) {
    return row['id'] === userId
  }
  let current = row
  let currentEntity = entity
  for (const [index, part] of path.entries()) {
    const target = schema.entities[currentEntity]?.fields[part]?.relation
    const id = current[part]
    if (!target || typeof id !== 'string') {
      return false
    }
    if (index === path.length - 1) {
      return id === userId
    }
    // Intermediate owner path is checked from actual server rows, not client submissions.
    const related = await ctx.db.unsafe.get(target, id)
    if (!related) {
      return false
    }
    current = related
    currentEntity = target
  }
  return false
}
