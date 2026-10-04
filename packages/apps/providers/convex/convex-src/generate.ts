import type TR from '@runtime/TR'
import { Assert } from '@shared/core'
import type { BackendPlan, Grant } from './backend'

/** The compiler's policy document is paired with the compiled schema before deployment. */
export type TaoDataPolicy = Readonly<{
  accountEntity: string
  entities: Readonly<Record<string, Readonly<{ grants: readonly Grant[] }>>>
}>

export type ConvexBackend = Readonly<{
  'auth.config.ts': string
  'schema.ts': string
  'tao.ts': string
}>

function tableName(entity: string, collection: string): string {
  return entity === 'Account' ? 'accounts' : `${collection.slice(0, 1).toLowerCase()}${collection.slice(1)}`
}

function validator(field: TR.DataSchemaDefinition['entities'][string]['fields'][string], account: boolean): string {
  const base = field.kind === 'boolean'
    ? 'v.boolean()'
    : field.kind === 'number' || field.kind === 'time'
    ? 'v.number()'
    : field.kind === 'reference'
    ? 'v.union(v.string(), v.number())'
    : 'v.string()'
  return account || field.optional === true ? `v.optional(v.union(${base}, v.null()))` : base
}

/** Generate deployable Convex source from the same schema and grants the Tao compiler emitted. */
export function generateConvexBackend(schema: TR.DataSchemaDefinition, policy?: TaoDataPolicy): ConvexBackend {
  const protectedData = policy !== undefined
  const tables = new Set<string>()
  const plan: {
    accountEntity?: string
    entities: Record<string, BackendPlan['entities'][string]>
    protected: boolean
  } = {
    entities: {},
    protected: protectedData,
    ...(policy === undefined ? {} : { accountEntity: policy.accountEntity }),
  }
  const declarations: string[] = []
  if (protectedData) {
    Assert.input(
      Object.hasOwn(schema.entities, policy.accountEntity),
      `The data policy's Account entity '${policy.accountEntity}' is absent from the schema.`,
    )
  }
  for (const [entity, definition] of Object.entries(schema.entities)) {
    const table = tableName(entity, definition.collection)
    Assert.input(/^[a-z][A-Za-z0-9_]*$/.test(table), `Convex cannot use '${table}' as a table name.`)
    Assert.input(!tables.has(table), `Two Tao entities map to Convex table '${table}'.`)
    tables.add(table)
    Assert.input(
      (definition.uniqueConstraints?.length ?? 0) === 0
        && !Object.values(definition.fields).some(field => field.unique),
      `Convex pilot does not yet enforce unique fields in '${entity}'.`,
    )
    Assert.input(
      !Object.hasOwn(definition.fields, 'taoId') && !Object.hasOwn(definition.fields, 'accountSubject'),
      `Convex reserves the fields taoId and accountSubject in '${entity}'.`,
    )
    if (protectedData) {
      Assert.input(Object.hasOwn(policy.entities, entity), `The data policy does not cover '${entity}'.`)
      const owners = new Set(policy.entities[entity]!.grants.flatMap(grant => grant.principal.slice(0, 1)))
      for (const grant of policy.entities[entity]!.grants) {
        let current = entity
        for (const field of grant.principal) {
          const currentDefinition = schema.entities[current]!
          const relation = currentDefinition.fields[field]?.relation
          const inverse = currentDefinition.inverseFields?.[field]?.relation
          Assert.input(
            relation !== undefined || inverse !== undefined,
            `The data policy path '${entity}.${grant.principal.join('.')}' crosses non-relation '${field}'.`,
          )
          current = (relation ?? inverse)!
        }
        Assert.input(
          current === policy.accountEntity,
          `The data policy path '${entity}.${grant.principal.join('.')}' must end at '${policy.accountEntity}'.`,
        )
        for (const field of grant.updateFields ?? []) {
          Assert.input(
            Object.hasOwn(definition.fields, field),
            `The data policy names unknown update field '${entity}.${field}'.`,
          )
          Assert.input(!owners.has(field), `Convex cannot update the owner relation '${entity}.${field}'.`)
        }
      }
    }
    const isAccount = entity === policy?.accountEntity
    const fields = Object.entries(definition.fields).map(([field, shape]) =>
      `${JSON.stringify(field)}: ${validator(shape, isAccount)}`
    )
    const accountField = isAccount ? ', accountSubject: v.string()' : ''
    declarations.push(
      `  ${JSON.stringify(table)}: defineTable({ taoId: v.string()${accountField}${
        fields.length ? `, ${fields.join(', ')}` : ''
      } }).index('by_taoId', ['taoId'])${accountField ? ".index('by_accountSubject', ['accountSubject'])" : ''},`,
    )
    plan.entities[entity] = {
      table,
      fields: Object.fromEntries(
        Object.entries(definition.fields).map(([name, field]) => [name, {
          kind: field.kind,
          ...(field.optional === undefined ? {} : { optional: field.optional }),
          ...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
          ...(field.defaultNow === undefined ? {} : { defaultNow: field.defaultNow }),
          ...(field.cases === undefined ? {} : { cases: field.cases }),
          ...(field.relation === undefined ? {} : { relation: field.relation }),
          ...(field.onDelete === undefined ? {} : { onDelete: field.onDelete }),
        }]),
      ),
      inverseFields: definition.inverseFields ?? {},
      grants: policy?.entities[entity]?.grants ?? [],
    }
  }
  const sourcePlan = JSON.stringify(plan, null, 2)
  return {
    'auth.config.ts': `import type { AuthConfig } from 'convex/server'\n${
      protectedData ? "import { Platform } from 'tao-shared'\n" : ''
    }\nexport default {\n  providers: ${
      protectedData
        ? "[{ domain: Platform.runtimeProcess.env.CLERK_JWT_ISSUER_DOMAIN!, applicationID: 'convex' }]"
        : '[]'
    },\n} satisfies AuthConfig\n`,
    'schema.ts':
      `import { defineSchema, defineTable } from 'convex/server'\nimport { v } from 'convex/values'\n\nexport default defineSchema({\n${
        declarations.join('\n')
      }\n})\n`,
    'tao.ts':
      `import { query, mutation } from './_generated/server'\nimport { v } from 'convex/values'\nimport { ensureAccount as ensure, listRows, writeRows, type BackendContext, type BackendPlan } from 'tao-convex/backend'\n\nconst plan: BackendPlan = ${sourcePlan}\n\nexport const ensureAccount = mutation({ args: {}, handler: ctx => ensure(ctx as unknown as BackendContext, plan) })\nexport const list = query({ args: {}, handler: ctx => listRows(ctx as unknown as BackendContext, plan) })\nexport const write = mutation({ args: { operations: v.array(v.any()) }, handler: (ctx, args) => writeRows(ctx as unknown as BackendContext, plan, args.operations) })\n`,
  }
}
