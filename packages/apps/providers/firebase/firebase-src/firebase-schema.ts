import type TR from '@runtime/TR'
import { Assert } from '@shared/core'
import type { RxJsonSchema } from 'rxdb'

export type FirebaseRow = Readonly<Record<string, unknown> & { Id: string }>

/** Validate the subset whose account-scoped Firestore rules can protect for every writer. */
export function validateFirebaseSchema(definition: TR.DataSchemaDefinition): void {
  Assert.input(definition.entities['Account'] !== undefined, 'Firebase data must declare Account.')
  for (const [entityName, entity] of Object.entries(definition.entities)) {
    Assert.input(
      entity.grants === undefined || entity.grants.length === 0,
      `Firebase cannot enforce authored access grants on ${entityName}.`,
    )
    Assert.input(
      entity.uniqueConstraints === undefined || entity.uniqueConstraints.length === 0,
      `Firebase cannot enforce unique constraints on ${entityName}.`,
    )
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      Assert.input(
        !['Id', '_deleted', 'serverTimestamp'].includes(fieldName),
        `Firebase field ${entityName}.${fieldName} conflicts with replication metadata.`,
      )
      Assert.input(!field.unique, `Firebase cannot enforce the unique field ${entityName}.${fieldName}.`)
      Assert.input(field.kind !== 'reference', `Firebase cannot enforce reference ${entityName}.${fieldName}.`)
      Assert.input(
        field.kind !== 'relation' || field.relation === 'Account',
        `Firebase only supports a relation to Account, not ${entityName}.${fieldName}.`,
      )
      Assert.input(
        entityName !== 'Account' || field.kind !== 'relation',
        'Firebase Account fields cannot be relations.',
      )
    }
  }
}

/** Store declared scalar fields directly, so rules can validate the same names and types. */
export function firebaseRowSchema(entity: TR.DataSchemaDefinition['entities'][string]): RxJsonSchema<FirebaseRow> {
  const properties: Record<string, unknown> = {
    Id: { type: 'string', maxLength: 512 },
  }
  for (const [name, field] of Object.entries(entity.fields)) {
    const kind = field.kind === 'number' || field.kind === 'time'
      ? 'number'
      : field.kind === 'boolean'
      ? 'boolean'
      : 'string'
    properties[name] = { type: [kind, 'null'] }
  }
  return {
    version: 0,
    primaryKey: 'Id',
    type: 'object',
    properties,
    required: ['Id'],
    additionalProperties: false,
  } as RxJsonSchema<FirebaseRow>
}

export function emptyAccount(uid: string, entity: TR.DataSchemaDefinition['entities'][string]): FirebaseRow {
  return {
    Id: uid,
    ...Object.fromEntries(Object.keys(entity.fields).map(field => [field, null])),
  }
}
