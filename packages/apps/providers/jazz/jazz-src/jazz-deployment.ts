import type TR from '@runtime/TR'
import { Assert } from '@shared/core'
import { schema as s } from 'jazz-tools'

type Definition = TR.DataSchemaDefinition
type Grant = NonNullable<Definition['entities'][string]['grants']>[number]
export type TaoDataPolicy = Readonly<{
  accountEntity: string
  entities: Readonly<Record<string, Readonly<{ grants: readonly Grant[] }>>>
}>

const lowerFirst = (name: string): string => `${name[0]?.toLowerCase() ?? ''}${name.slice(1)}`
const tableOf = (definition: Definition, entity: string): string =>
  entity === 'Account' ? 'accounts' : lowerFirst(definition.entities[entity]!.collection)

/** A Jazz row is one Tao entity row; relation fields are UUID foreign keys. */
export function jazzMapping(definition: Definition): Readonly<
  Record<
    string,
    Readonly<{
      table: string
      fields: Readonly<Record<string, string>>
    }>
  >
> {
  const mapping: Record<string, { table: string; fields: Record<string, string> }> = {}
  const tables = new Set<string>()
  for (const [entity, declaration] of Object.entries(definition.entities)) {
    const table = tableOf(definition, entity)
    Assert.input(
      /^[a-z][A-Za-z0-9_]*$/.test(table) && !tables.has(table),
      `Jazz needs a distinct identifier for collection '${declaration.collection}'.`,
    )
    tables.add(table)
    const fields: Record<string, string> = {}
    const columns = new Set(['id'])
    Assert.input(
      (declaration.uniqueConstraints ?? []).length === 0
        && Object.values(declaration.fields).every(field => field.unique !== true),
      `Jazz cannot yet enforce Tao unique constraints on '${entity}'.`,
    )
    for (const [field, shape] of Object.entries(declaration.fields)) {
      Assert.input(
        shape.kind !== 'reference' && shape.kind !== 'enum',
        `Jazz cannot yet store '${entity}.${field}' of kind '${shape.kind}'.`,
      )
      if (shape.kind === 'relation') {
        Assert.input(
          shape.relation !== undefined && definition.entities[shape.relation] !== undefined,
          `Jazz relation '${entity}.${field}' needs a target in the same datasource.`,
        )
      }
      const column = shape.kind === 'relation' ? `${lowerFirst(field)}Id` : lowerFirst(field)
      Assert.input(
        /^[a-z][A-Za-z0-9_]*$/.test(column) && !columns.has(column),
        `Jazz needs a distinct column for '${entity}.${field}'.`,
      )
      columns.add(column)
      fields[field] = column
    }
    mapping[entity] = { table, fields }
  }
  return mapping
}

/** Build the same structural app used by the client and by Jazz's deploy command. */
export function jazzApp(definition: Definition): ReturnType<typeof s.defineApp> {
  const mapping = jazzMapping(definition)
  const tables: Record<string, unknown> = {}
  for (const [entity, declaration] of Object.entries(definition.entities)) {
    const columns: Record<string, unknown> = {}
    const relations: Record<string, unknown> = {}
    for (const [field, shape] of Object.entries(declaration.fields)) {
      const column = mapping[entity]!.fields[field]!
      const scalar: Record<string, () => ReturnType<typeof s.string>> = {
        boolean: () => s.boolean() as never,
        number: () => s.float() as never,
        text: () => s.string(),
        time: () => s.float() as never,
        relation: () => s.uuid() as never,
      }
      const value = scalar[shape.kind]!()
      columns[column] = shape.optional || entity === 'Account' ? value.optional() : value
      if (shape.kind === 'relation') {
        relations[lowerFirst(field)] = s.rel(mapping[shape.relation!]!.table, column)
      }
    }
    // Names are generated from a compiled schema; their relation validity is checked above.
    tables[mapping[entity]!.table] = (s.table as any)(columns, relations)
  }
  return (s.defineApp as any)(tables)
}

/** Compile conservative Tao grants into Jazz server-enforced row policies. Unsupported paths fail. */
export function jazzPermissions(definition: Definition, policy: TaoDataPolicy): ReturnType<typeof s.definePermissions> {
  Assert.input(
    policy.accountEntity === 'Account' && definition.entities['Account'] !== undefined,
    'Jazz authenticated data needs an Account entity in its compiled policy.',
  )
  const mapping = jazzMapping(definition)
  const app = jazzApp(definition)
  for (const entity of Object.keys(definition.entities)) {
    Assert.input(
      policy.entities[entity] !== undefined,
      `The Jazz policy does not cover '${entity}'; recompile so policy and schema agree.`,
    )
  }
  for (const [entity, declaration] of Object.entries(definition.entities)) {
    for (const [field, shape] of Object.entries(declaration.fields)) {
      if (shape.kind !== 'relation' || shape.onDelete !== 'cascade') {
        continue
      }
      const target = shape.relation!
      Assert.input(
        !policy.entities[target]!.grants.some(grant => grant.operations.includes('delete')),
        `Jazz cannot enforce cascading '${entity}.${field}' while '${target}' may be deleted.`,
      )
    }
  }
  return s.definePermissions(app, ({ policy: rules, session, anyOf, allOf }) => {
    for (const [entity, declaration] of Object.entries(definition.entities)) {
      const table = mapping[entity]!.table
      const rule = (rules as Record<string, any>)[table]
      const grants = policy.entities[entity]!.grants
      const condition = (grant: Grant): object => {
        const path = grant.principal
        if (path.length === 0) {
          Assert.input(entity === 'Account', `Jazz grant path '${entity}' must end at Account.`)
          return { id: session.user.account }
        }
        Assert.input(path.length === 1, `Jazz cannot yet enforce multi-hop grant '${entity}.${path.join('.')}'.`)
        const field = declaration.fields[path[0]!]!
        Assert.input(
          field?.kind === 'relation' && field.relation === 'Account',
          `Jazz grant path '${entity}.${path[0]}' must be a direct Account relation.`,
        )
        return { [mapping[entity]!.fields[path[0]!]!]: session.user.account }
      }
      const forOperation = (operation: Grant['operations'][number]): object => {
        const matches = grants.filter(grant => grant.operations.includes(operation)).map(condition)
        return anyOf(matches)
      }
      rule.allowRead.where(forOperation('read'))
      // Account creation is a bootstrap operation. The id must equal the verified Jazz account.
      rule.allowInsert.where(entity === 'Account' ? { id: session.user.account } : forOperation('create'))
      rule.allowDelete.where(forOperation('delete'))
      const updates = grants.filter(grant => grant.operations.includes('update'))
      const protectedFields = (grant: Grant): string[] => {
        const allowed = new Set(grant.updateFields ?? [])
        for (const field of allowed) {
          Assert.input(
            declaration.fields[field] !== undefined,
            `Jazz update grant names unknown field '${entity}.${field}'.`,
          )
        }
        return Object.keys(declaration.fields).filter(field => !allowed.has(field))
      }
      for (const grant of updates) {
        protectedFields(grant)
      }
      rule.allowUpdate.whereOld(forOperation('update')).whereNew((row: Record<string, unknown>) =>
        anyOf(
          updates.map(grant => {
            const unchanged = Object.fromEntries(
              protectedFields(grant).map(field => {
                const column = mapping[entity]!.fields[field]!
                return [column, row[column]]
              }),
            )
            return allOf([
              condition(grant),
              ...(Object.keys(unchanged).length === 0 ? [] : [rule.exists.where({ id: row['id'], ...unchanged })]),
            ])
          }),
        )
      )
    }
  })
}

/** Write these two files into a deployment directory, then run Jazz validate and deploy there. */
export function jazzDeploymentFiles(definition: Definition, policy: TaoDataPolicy): Readonly<{
  'schema.ts': string
  'permissions.ts': string
}> {
  jazzPermissions(definition, policy)
  const schema = JSON.stringify(definition)
  const rules = JSON.stringify(policy)
  return {
    'schema.ts':
      `import { jazzApp } from 'tao-jazz/deployment'\nexport const definition = ${schema}\nexport const app = jazzApp(definition)\n`,
    'permissions.ts':
      `import { jazzPermissions } from 'tao-jazz/deployment'\nimport { definition } from './schema.js'\nexport default jazzPermissions(definition, ${rules})\n`,
  }
}
