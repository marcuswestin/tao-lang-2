import { type AppManifest, buildManifest, entity, field, policy } from '@pylonsync/sdk'
import type TR from '@runtime/TR'
import { Assert, Switch } from '@shared/core'
import { accountBootstrapFields, createPylonCommitHandler, createPylonEnsureAccountHandler } from './pylon-commit'

type Grant = NonNullable<TR.DataSchemaDefinition['entities'][string]['grants']>[number]

/** The compiler's TaoDataPolicy.json, paired with the same compilation's TaoDataSchema.json. */
export type TaoDataPolicy = Readonly<{
  accountEntity: string
  entities: Readonly<Record<string, Readonly<{ grants: readonly Grant[] }>>>
}>

/** Generate a Pylon app and guarded transaction functions from compiled Tao data. */
export function generatePylonBackend(
  schema: TR.DataSchemaDefinition,
  access: TaoDataPolicy,
  options: Readonly<{ name?: string; version?: string }> = {},
): Readonly<{ files: Readonly<Record<string, string>> }> {
  const manifest = pylonManifest(schema, access, options)
  const schemaLiteral = JSON.stringify(schema)
  const policyLiteral = JSON.stringify(access)
  return {
    files: {
      'app.ts': `const manifest = ${JSON.stringify(manifest, null, 2)}\nexport default manifest\n`,
      'functions/taoCommit.ts':
        `import { mutation, v } from '@pylonsync/functions'\nimport { createPylonCommitHandler } from 'tao-pylon/generate'\nconst schema = ${schemaLiteral} as const\nconst access = ${policyLiteral} as const\nexport default mutation({ args: { id: v.string(), operations: v.array(v.json()) }, handler: createPylonCommitHandler(schema, access) })\n`,
      'functions/taoEnsureAccount.ts':
        `import { mutation } from '@pylonsync/functions'\nimport { createPylonEnsureAccountHandler } from 'tao-pylon/generate'\nconst schema = ${schemaLiteral} as const\nexport default mutation({ handler: createPylonEnsureAccountHandler(schema, ${
          JSON.stringify(access.accountEntity)
        }) })\n`,
    },
  }
}

/** Pylon stores Tao entities as rows. Direct client writes are denied; taoCommit checks grants. */
export function pylonManifest(
  schema: TR.DataSchemaDefinition,
  access: TaoDataPolicy,
  options: Readonly<{ name?: string; version?: string }> = {},
): AppManifest {
  Assert.input(
    schema.entities[access.accountEntity] !== undefined,
    'The Pylon data policy names an unknown Account entity.',
  )
  accountBootstrapFields(schema, access.accountEntity, 0)
  const entities = Object.entries(schema.entities).map(([name, declaration]) => {
    const fields: Record<string, ReturnType<typeof field.string>> = {}
    const relations: Array<{ name: string; target: string; field: string }> = []
    const indexes: Array<{ name: string; fields: string[]; unique: boolean }> = []
    for (const [nameOfField, definition] of Object.entries(declaration.fields)) {
      let builder = fieldOf(nameOfField, definition)
      if (definition.optional) {
        builder = builder.optional()
      }
      if (definition.unique) {
        builder = builder.unique()
      }
      if (definition.defaultNow) {
        // Tao time is a numeric epoch value; its runtime supplies defaults before saving.
      } else if (definition.defaultValue !== undefined) {
        builder = builder.default(definition.defaultValue)
      }
      if (definition.kind === 'relation') {
        builder = builder.readonly()
        relations.push({ name: nameOfField, field: nameOfField, target: definition.relation! })
      }
      fields[nameOfField] = builder
      if (definition.indexed) {
        indexes.push({ name: `${name}_${nameOfField}_idx`, fields: [nameOfField], unique: false })
      }
    }
    for (const [index, fieldsOfConstraint] of (declaration.uniqueConstraints ?? []).entries()) {
      Assert.input(
        fieldsOfConstraint.every(nameOfField => declaration.fields[nameOfField] !== undefined),
        `The unique constraint on '${name}' names an unknown field.`,
      )
      indexes.push({ name: `${name}_unique_${index}`, fields: [...fieldsOfConstraint], unique: true })
    }
    return entity(name, fields, { indexes, relations })
  })
  const policies = Object.entries(schema.entities).map(([name]) => {
    const grants = access.entities[name]?.grants
    Assert.input(grants !== undefined, `The Pylon data policy does not cover '${name}'.`)
    return policy({
      name: `tao_${name}_access`,
      entity: name,
      allowRead: readExpression(schema, access.accountEntity, name, grants),
      allowInsert: 'false',
      allowUpdate: 'false',
      allowDelete: 'false',
    })
  })
  // A receipt makes retries safe when a successful transaction's HTTP response is lost.
  entities.push(entity('TaoCommit', {
    UserId: field.string(),
  }, { sync: false }))
  policies.push(policy({
    name: 'tao_commit_private',
    entity: 'TaoCommit',
    allowRead: 'false',
    allowInsert: 'false',
    allowUpdate: 'false',
    allowDelete: 'false',
  }))
  return buildManifest({
    name: options.name ?? schema.name,
    version: options.version ?? `${schema.schemaVersion ?? 1}.0.0`,
    entities,
    routes: [],
    policies,
  })
}

function fieldOf(
  name: string,
  definition: TR.DataSchemaDefinition['entities'][string]['fields'][string],
): ReturnType<typeof field.string> {
  return Switch(definition.kind, {
    text: () => field.string(),
    boolean: () => field.bool(),
    number: () => field.float(),
    time: () => field.float(),
    enum: () => field.enum(definition.cases ?? []),
    reference: () => field.json(),
    relation: () => {
      Assert.input(definition.relation !== undefined, `The relation '${name}' has no target.`)
      return field.id(definition.relation)
    },
  })
}

function readExpression(
  schema: TR.DataSchemaDefinition,
  account: string,
  name: string,
  grants: readonly Grant[],
): string {
  const terms = grants.filter(grant => grant.operations.includes('read')).map(grant =>
    principalExpression(schema, account, name, grant.principal)
  )
  return terms.length === 0 ? 'false' : `auth.userId != null && (${[...new Set(terms)].join(' || ')})`
}

/** Only direct and one intermediate forward relation are expressible in Pylon's documented DSL. */
function principalExpression(
  schema: TR.DataSchemaDefinition,
  account: string,
  name: string,
  path: readonly string[],
): string {
  if (path.length === 0) {
    Assert.input(name === account, `The grant path '${name}' must end at '${account}'.`)
    return 'data.id == auth.userId'
  }
  Assert.input(path.length <= 2, `Pylon cannot enforce the grant path '${[name, ...path].join('.')}'.`)
  let current = name
  for (const part of path) {
    const target = schema.entities[current]?.fields[part]?.relation
    Assert.input(
      target !== undefined,
      `The grant path '${[name, ...path].join('.')}' crosses a field that is not a forward relation.`,
    )
    current = target
  }
  Assert.input(current === account, `The grant path '${[name, ...path].join('.')}' must end at '${account}'.`)
  if (path.length === 1) {
    return `data.${path[0]} == auth.userId`
  }
  const intermediate = schema.entities[name]!.fields[path[0]!]!.relation!
  return `exists(${intermediate} where id == data.${path[0]} and ${path[1]} == auth.userId)`
}

export { createPylonCommitHandler, createPylonEnsureAccountHandler }
