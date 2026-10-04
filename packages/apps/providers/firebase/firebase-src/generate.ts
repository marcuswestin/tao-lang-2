import type TR from '@runtime/TR'
import { Assert, Switch } from '@shared/core'

type Grant = NonNullable<TR.DataSchemaDefinition['entities'][string]['grants']>[number]

/** The compiler's policy document paired with the same compilation's data schema. */
export type TaoDataPolicy = Readonly<{
  accountEntity: string
  entities: Readonly<Record<string, Readonly<{ grants: readonly Grant[] }>>>
}>

export type FirebaseBackend = Readonly<{
  files: Readonly<{ 'firestore.rules': string; 'firestore.indexes.json': string }>
  documentMatch: string
}>

const identifier = /^[A-Za-z][A-Za-z0-9_]*$/
const reserved = new Set(['Id', '_deleted', 'serverTimestamp'])

/** Generate private, account-scoped Firestore rules for the first Firebase data flow. */
export function generateFirebaseBackend(schema: TR.DataSchemaDefinition, access?: TaoDataPolicy): FirebaseBackend {
  Assert.input(
    schema.schemaVersion === undefined || schema.schemaVersion === 1,
    'Firebase does not yet support schema migrations.',
  )
  Assert.input(
    access === undefined || access.accountEntity === 'Account',
    'Firebase requires Account as its account entity.',
  )
  for (const entity of Object.keys(access?.entities ?? {})) {
    Assert.input(Object.hasOwn(schema.entities, entity), `The data policy names unknown entity '${entity}'.`)
  }

  const matches: string[] = []
  for (const [entity, definition] of Object.entries(schema.entities)) {
    Assert.input(identifier.test(entity), `Firebase cannot use '${entity}' as an entity name.`)
    Assert.input(
      (definition.uniqueConstraints?.length ?? 0) === 0
        && !Object.values(definition.fields).some(field => field.unique),
      `Firebase does not yet enforce unique fields in '${entity}'.`,
    )
    Assert.input(
      Object.keys(definition.inverseFields ?? {}).length === 0,
      `Firebase does not yet support inverse relations in '${entity}'.`,
    )
    Assert.input(
      (definition.grants?.length ?? 0) === 0,
      `Firebase does not yet support authored grants in '${entity}'.`,
    )
    if (access !== undefined) {
      Assert.input(Object.hasOwn(access.entities, entity), `The data policy does not cover '${entity}'.`)
      Assert.input(
        access.entities[entity]!.grants.length === 0,
        `Firebase does not yet support authored grants in '${entity}'.`,
      )
    }

    const required = ['_deleted', 'serverTimestamp']
    const allowed = [...required]
    const checks = ['data._deleted is bool', 'data.serverTimestamp == request.time']
    const ownerRelations: string[] = []
    for (const [name, field] of Object.entries(definition.fields)) {
      Assert.input(identifier.test(name) && !reserved.has(name), `Firebase cannot use '${entity}.${name}' as a field.`)
      allowed.push(name)
      if (entity === 'Account' || field.optional !== true) {
        required.push(name)
      }
      const value = `data[${JSON.stringify(name)}]`
      const present = `data.keys().hasAny([${JSON.stringify(name)}])`
      const valid = Switch<typeof field.kind, string>(field.kind, {
        boolean: () => `${value} is bool`,
        enum: () => {
          Assert.input(
            field.cases !== undefined && field.cases.length > 0 && new Set(field.cases).size === field.cases.length,
            `Firebase needs distinct enum cases in '${entity}.${name}'.`,
          )
          return `${value} is string && ${value} in ${JSON.stringify(field.cases)}`
        },
        number: () => `${value} is number`,
        reference: () => {
          Assert.input(false, `Firebase does not yet support references in '${entity}.${name}'.`)
          return 'false'
        },
        relation: () => {
          Assert.input(
            field.relation === 'Account' && entity !== 'Account',
            `Firebase supports only direct relations to Account in '${entity}.${name}'.`,
          )
          ownerRelations.push(name)
          return `${value} is string && ${value} == userId`
        },
        text: () => `${value} is string`,
        time: () => `${value} is number`,
      })
      checks.push(
        field.optional === true || entity === 'Account' ? `(!${present} || ${value} == null || (${valid}))` : valid,
      )
    }

    const oldOwner = ownerRelations.length === 0
      ? ''
      : ` && !request.resource.data.diff(resource.data).affectedKeys().hasAny(${JSON.stringify(ownerRelations)})`
    const accountId = entity === 'Account' ? ' && id == userId' : ''
    matches.push(`      match /${entity}/{id} {
        function validRow() {
          let data = request.resource.data;
          return data.keys().hasAll(${JSON.stringify(required)})
            && data.keys().hasOnly(${JSON.stringify(allowed)})
            && ${checks.join('\n            && ')};
        }

        allow get, list: if signedInAsOwner();
        allow create: if signedInAsOwner()${accountId} && validRow() && request.resource.data._deleted == false;
        allow update: if signedInAsOwner()${accountId} && validRow()${oldOwner};
        allow delete: if false;
      }`)
  }

  const documentMatch =
    `    match /users/{userId}/stores/{storageKey} {\n      function signedInAsOwner() {\n        return request.auth != null && request.auth.uid == userId;\n      }\n\n${
      matches.join('\n\n')
    }\n    }`
  return {
    documentMatch,
    files: {
      'firestore.rules':
        `rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n${documentMatch}\n  }\n}\n`,
      'firestore.indexes.json': '{\n  "indexes": [],\n  "fieldOverrides": []\n}\n',
    },
  }
}
