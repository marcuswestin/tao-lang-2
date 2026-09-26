import { Errors } from '@shared'
import type { AccountProtocol } from 'tao-shared/auth'

/** AccountPolicy is trusted deployment metadata, never supplied by an HTTP caller. */
export type AccountPolicy = {
  accountEntity: string
  entities: Record<string, {
    fields: readonly string[]
    fieldTypes?: Record<string, 'boolean' | 'number' | 'text' | 'time'>
    enumCases?: Record<string, readonly string[]>
    grants: readonly {
      operations: readonly ('read' | 'create' | 'update' | 'delete')[]
      principal: readonly string[]
      updateFields?: readonly string[]
    }[]
    relations?: Record<string, { entity: string; inverse?: string; many?: boolean }>
    unique?: readonly (readonly string[])[]
  }>
}

/** Read only server deployment metadata; absent grants are rejected instead of inferred. */
export function accountPolicyFromJSON(value: unknown): AccountPolicy {
  const policy = value as Partial<AccountPolicy> | null
  if (
    policy === null || typeof policy !== 'object' || typeof policy.accountEntity !== 'string'
    || policy.entities === null || typeof policy.entities !== 'object' || Array.isArray(policy.entities)
    || !Object.hasOwn(policy.entities, policy.accountEntity)
  ) {
    Errors.throwUserInput('The account policy requires a declared Account entity.')
  }
  for (const [name, entity] of Object.entries(policy.entities)) {
    if (
      entity === null || typeof entity !== 'object' || !Array.isArray(entity.fields)
      || !entity.fields.every(field => typeof field === 'string') || !Array.isArray(entity.grants)
    ) {
      Errors.throwUserInput(`The account policy entity '${name}' requires fields and explicit grants.`)
    }
    for (const grant of entity.grants) {
      if (
        grant === null || typeof grant !== 'object' || !Array.isArray(grant.operations)
        || !grant.operations.every((operation: unknown) =>
          typeof operation === 'string' && ['read', 'create', 'update', 'delete'].includes(operation)
        )
        || !Array.isArray(grant.principal) || !grant.principal.every((field: unknown) => typeof field === 'string')
        || (grant.updateFields !== undefined && (!Array.isArray(grant.updateFields)
          || !grant.updateFields.every((field: unknown) => typeof field === 'string' && entity.fields.includes(field))))
      ) {
        Errors.throwUserInput(`The account policy entity '${name}' has an invalid grant.`)
      }
    }
  }
  return policy as AccountPolicy
}

export function rejectAccountRequest(code: AccountProtocol.Failure['error']['code'], message: string): never {
  return Errors.throwUserInput(message, { accountProtocolCode: code })
}

export function canAccess(
  policy: AccountPolicy,
  rows: readonly AccountProtocol.Row[],
  row: AccountProtocol.Row,
  accountId: string,
  operation: 'read' | 'create' | 'update' | 'delete',
  changedFields: readonly string[] = [],
): boolean {
  if (!Object.hasOwn(policy.entities, row.entity)) {
    return false
  }
  const grants = policy.entities[row.entity]?.grants.filter(grant =>
    grant.operations.includes(operation)
    && resolvePrincipals(policy, rows, row, grant.principal).includes(accountId)
  ) ?? []
  return operation === 'update'
    ? grants.length > 0 && changedFields.every(field => grants.some(grant => grant.updateFields?.includes(field)))
    : grants.length > 0
}

function resolvePrincipals(
  policy: AccountPolicy,
  rows: readonly AccountProtocol.Row[],
  row: AccountProtocol.Row,
  path: readonly string[],
): string[] {
  let current = [row]
  for (const field of path) {
    current = current.flatMap(source => {
      const relation = policy.entities[source.entity]?.relations?.[field]
      if (relation === undefined) {
        return []
      }
      if (relation.inverse !== undefined) {
        return rows.filter(candidate =>
          candidate.entity === relation.entity && (
            candidate.fields[relation.inverse!] === source.id
            || (Array.isArray(candidate.fields[relation.inverse!])
              && (candidate.fields[relation.inverse!] as unknown[]).includes(source.id))
          )
        )
      }
      const ids = source.fields[field]
      return rows.filter(candidate =>
        candidate.entity === relation.entity
        && (Array.isArray(ids) ? ids.includes(candidate.id) : ids === candidate.id)
      )
    })
  }
  return current.filter(candidate => candidate.entity === policy.accountEntity).map(candidate => candidate.id)
}

export function validateAccountRows(policy: AccountPolicy, rows: readonly AccountProtocol.Row[]): void {
  for (const row of rows) {
    const schema = Object.hasOwn(policy.entities, row.entity) ? policy.entities[row.entity] : undefined
    if (schema === undefined || Object.keys(row.fields).some(field => !schema.fields.includes(field))) {
      rejectAccountRequest('invalid', 'Unknown entity or field.')
    }
    for (const [field, kind] of Object.entries(schema.fieldTypes ?? {})) {
      const value = row.fields[field]
      if (value === undefined || value === null) {
        continue
      }
      const valid = kind === 'text'
        ? typeof value === 'string'
        : kind === 'boolean'
        ? typeof value === 'boolean'
        : typeof value === 'number' && Number.isFinite(value)
      if (!valid) {
        rejectAccountRequest('invalid', 'Field value does not match its declared type.')
      }
    }
    for (const [field, cases] of Object.entries(schema.enumCases ?? {})) {
      const value = row.fields[field]
      if (value !== undefined && value !== null && (typeof value !== 'string' || !cases.includes(value))) {
        rejectAccountRequest('invalid', 'Field value is not a declared enum case.')
      }
    }
    for (const [field, relation] of Object.entries(schema.relations ?? {})) {
      if (relation.inverse !== undefined) {
        if (Object.hasOwn(row.fields, field)) {
          rejectAccountRequest('invalid', 'Inverse relations cannot be stored.')
        }
        continue
      }
      const raw = row.fields[field]
      if (raw === undefined || raw === null) {
        continue
      }
      if (relation.many === true ? !Array.isArray(raw) : typeof raw !== 'string') {
        rejectAccountRequest('invalid', 'Relation cardinality does not match the schema.')
      }
      for (const id of Array.isArray(raw) ? raw : [raw]) {
        if (typeof id !== 'string' || !rows.some(target => target.entity === relation.entity && target.id === id)) {
          rejectAccountRequest('conflict', 'Related row does not exist.')
        }
      }
    }
  }
  for (const [entity, schema] of Object.entries(policy.entities)) {
    for (const fields of schema.unique ?? []) {
      const seen = new Set<string>()
      for (const row of rows.filter(candidate => candidate.entity === entity)) {
        const tuple = fields.map(field => row.fields[field] ?? null)
        // Match runtime null-distinct uniqueness: incomplete tuples do not collide. Required
        // fields are a completeness concern, not permission to reject incomplete profiles.
        if (tuple.some(value => value === null)) {
          continue
        }
        if (tuple.some(value => !['string', 'number', 'boolean'].includes(typeof value))) {
          rejectAccountRequest('invalid', 'Unique fields must be scalar values or relation IDs.')
        }
        const key = JSON.stringify(tuple)
        if (seen.has(key)) {
          rejectAccountRequest('conflict', 'A unique constraint would be violated.')
        }
        seen.add(key)
      }
    }
  }
}
