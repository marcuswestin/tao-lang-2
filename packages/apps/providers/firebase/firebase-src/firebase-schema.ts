import TR from '@runtime/TR'
import { Assert, Switch } from '@shared/core'
import type { RxJsonSchema } from 'rxdb'

export type FirebaseRow = Readonly<Record<string, unknown> & { Id: string }>
const replicationMetadata = new Set(['_deleted', '_attachments', '_meta', '_rev'])

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

/**
 * Legacy version-0 compatibility envelope. Keep its nullable fields and required Id unchanged so
 * existing account databases (including notes) reopen without a physical RxDB migration. The
 * authored logical schema is enforced at replication, write, and snapshot publication boundaries.
 */
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
  const row = {
    Id: uid,
    ...Object.fromEntries(
      Object.entries(entity.fields).map(([name, field]) => {
        Assert.input(
          field.optional === true || field.defaultNow === true || Object.hasOwn(field, 'defaultValue'),
          `Firebase Account.${name} needs a declared default to initialize a signed-in account.`,
        )
        return [name, field.defaultNow === true ? TR.Clock.now() : field.defaultValue ?? null]
      }),
    ),
  }
  validateFirebaseRow('Account', entity, row, uid)
  return row
}

/** Repair only the old bootstrap's missing/null required literals; never invent historic times. */
export function repairFirebaseAccount<Row extends FirebaseRow>(
  row: Row,
  entity: TR.DataSchemaDefinition['entities'][string],
): Row {
  const defaults = Object.entries(entity.fields).filter(([name, field]) =>
    field.optional !== true && field.defaultNow !== true && Object.hasOwn(field, 'defaultValue')
    && row[name] == null
  )
  return defaults.length === 0
    ? row
    : { ...row, ...Object.fromEntries(defaults.map(([name, field]) => [name, field.defaultValue])) }
}

export function validateFirebaseRow(
  name: string,
  entity: TR.DataSchemaDefinition['entities'][string],
  row: FirebaseRow,
  uid: string,
  wire = false,
): void {
  Assert.input(typeof row.Id === 'string' && row.Id.length > 0, `Firebase ${name} needs a row Id.`)
  Assert.input(name !== 'Account' || row.Id === uid, 'Firebase Account must belong to the signed-in account.')
  for (const key of Object.keys(row)) {
    Assert.input(
      key === 'Id' || Object.hasOwn(entity.fields, key) || wire && replicationMetadata.has(key),
      `Firebase ${name} has unknown field '${key}'.`,
    )
  }
  for (const [fieldName, field] of Object.entries(entity.fields)) {
    const value = row[fieldName]
    const valid = field.optional === true && value == null || Switch(field.kind, {
      text: () => typeof value === 'string',
      enum: () => typeof value === 'string' && field.cases?.includes(value) === true,
      number: () => typeof value === 'number' && Number.isFinite(value),
      time: () => typeof value === 'number' && Number.isFinite(value),
      boolean: () => typeof value === 'boolean',
      relation: () => typeof value === 'string' && value === uid,
      reference: () => false,
    })
    Assert.input(
      valid,
      `Firebase ${name}.${fieldName} expects ${field.kind}${field.optional === true ? ' or null' : ''}.`,
    )
  }
}

/** Runtime snapshots require every authored key and must not contain replication metadata. */
export function firebaseRuntimeRow(
  name: string,
  entity: TR.DataSchemaDefinition['entities'][string],
  row: FirebaseRow,
  uid: string,
  wire = false,
): FirebaseRow {
  validateFirebaseRow(name, entity, row, uid, wire)
  return {
    Id: row.Id,
    ...Object.fromEntries(
      Object.entries(entity.fields).map(([key, field]) => [
        key,
        field.optional === true && row[key] === undefined ? null : row[key],
      ]),
    ),
  }
}
