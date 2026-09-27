import type TR from '@runtime/TR'
import { Assert, Errors, Switch } from '@shared/core'

/**
 * The Tao → InstantDB mapping. Every name is derived, never stored, so the same compiled Tao schema
 * always yields the same InstantDB schema, and the mapping's lookup tables reverse it exactly:
 *
 * - A collection becomes a namespace: `Notes` → `notes`. The account entity is always `accounts`.
 * - A field becomes an attribute: `Body` → `body`. Every attribute is optional on the server:
 *   requiredness is the client's completeness concern, and optional attributes keep a new field an
 *   additive change.
 * - A relation field becomes a link whose forward side is the field (`Note.Owner` → `notes.owner`,
 *   has one) and whose reverse side is the target's inverse field when one is declared
 *   (`Account.Notes` → `accounts.notes`, has many), else `<namespace>By<Field>` (`notesByOwner`).
 *   A relation that an `(owned)` inverse cascades carries `onDelete: 'cascade'`.
 * - The account entity links to `$users` through `accounts.$user` (has one, cascade) and
 *   `$users.account` (has one); an account row's id is its `$users` id.
 *
 * Anything InstantDB cannot represent is refused with an explanation rather than approximated.
 */

/** InstantAttribute is one attribute as InstantDB's schema push and `i.schema` spell it. */
export type InstantAttribute = Readonly<{
  config: Readonly<{ indexed: boolean; unique: boolean }>
  required: false
  valueType: InstantValueType
}>

type InstantValueType = 'boolean' | 'json' | 'number' | 'string'

/** InstantLinkSide is one side of a link: the namespace it sits on, its label, and cardinality. */
type InstantLinkSide = Readonly<{
  has: 'many' | 'one'
  label: string
  on: string
  onDelete?: 'cascade'
}>

/** InstantSchemaJSON is the schema body the push endpoints accept and `i.schema` rebuilds. */
export type InstantSchemaJSON = Readonly<{
  entities: Readonly<Record<string, Readonly<{ attrs: Readonly<Record<string, InstantAttribute>>; links: {} }>>>
  links: Readonly<Record<string, Readonly<{ forward: InstantLinkSide; reverse: InstantLinkSide }>>>
}>

/** InstantRelationMapping is one Tao relation field's link. */
type InstantRelationMapping = Readonly<{
  cascade: boolean
  label: string
  optional: boolean
  reverseLabel: string
  target: string
}>

/** InstantEntityMapping reverses one Tao entity's names in both directions. */
export type InstantEntityMapping = Readonly<{
  /** attributes maps each stored non-relation Tao field to its attribute label. */
  attributes: Readonly<Record<string, string>>
  entity: string
  /** inverseLabels maps each Tao inverse field to the reverse link label it reads. */
  inverseLabels: Readonly<Record<string, string>>
  namespace: string
  relations: Readonly<Record<string, InstantRelationMapping>>
}>

/** InstantMapping is the whole derived mapping of one compiled Tao schema. */
export type InstantMapping = Readonly<{
  accountEntity: string
  entities: Readonly<Record<string, InstantEntityMapping>>
  /** entityOfNamespace reverses a namespace to the Tao entity it stores. */
  entityOfNamespace: Readonly<Record<string, string>>
  schema: InstantSchemaJSON
}>

/** accountNamespace is fixed so a later auth provider finds accounts without the Tao schema. */
export const accountNamespace = 'accounts'
/** accountUserLabel is the account's link to its InstantDB `$users` row. */
export const accountUserLabel = '$user'
const defaultAccountEntity = 'Account'
const usersNamespace = '$users'

/** instantMapping derives the InstantDB schema and name tables from one compiled Tao schema. */
export function instantMapping(
  definition: TR.DataSchemaDefinition,
  accountEntity: string = defaultAccountEntity,
): InstantMapping {
  const namespaces = new Map<string, string>()
  for (const [entity, declaration] of Object.entries(definition.entities)) {
    const namespace = entity === accountEntity ? accountNamespace : lowerFirst(declaration.collection)
    refuse(
      !namespace.startsWith('$'),
      `The collection '${declaration.collection}' maps to InstantDB namespace '${namespace}', which InstantDB reserves.`,
    )
    const claimed = [...namespaces].find(([, other]) => other === namespace)
    refuse(
      claimed === undefined,
      `Entities '${claimed?.[0]}' and '${entity}' both map to InstantDB namespace '${namespace}'.`,
    )
    namespaces.set(entity, namespace)
  }

  const entities: Record<string, InstantEntityMapping> = {}
  const labelsByNamespace = new Map<string, Map<string, string>>()
  const claimLabel = (namespace: string, label: string, owner: string): void => {
    refuse(
      label !== 'id',
      `${owner} maps to InstantDB label 'id' on '${namespace}', which InstantDB reserves for row identity.`,
    )
    const labels = labelsByNamespace.get(namespace) ?? new Map<string, string>()
    labelsByNamespace.set(namespace, labels)
    const existing = labels.get(label)
    refuse(
      existing === undefined,
      `${existing} and ${owner} both map to InstantDB label '${namespace}.${label}'.`,
    )
    labels.set(label, owner)
  }

  const attrsByNamespace: Record<string, Record<string, InstantAttribute>> = {}
  const links: Record<string, { forward: InstantLinkSide; reverse: InstantLinkSide }> = {}
  for (const [entity, declaration] of Object.entries(definition.entities)) {
    const namespace = namespaces.get(entity)!
    const attributes: Record<string, string> = {}
    const relations: Record<string, InstantRelationMapping> = {}
    const attrs: Record<string, InstantAttribute> = {}
    for (const constraint of declaration.uniqueConstraints ?? []) {
      refuse(
        constraint.length <= 1,
        `InstantDB cannot enforce the compound unique constraint '${entity}.${constraint.join(' + ')}': `
          + 'it enforces uniqueness one attribute at a time.',
      )
    }
    for (const [field, fieldDefinition] of Object.entries(declaration.fields)) {
      const label = lowerFirst(field)
      claimLabel(namespace, label, `'${entity}.${field}'`)
      if (fieldDefinition.kind !== 'relation') {
        attributes[field] = label
        attrs[label] = {
          config: {
            indexed: fieldDefinition.indexed === true,
            unique: fieldDefinition.unique === true || isSingleFieldConstraint(declaration, field),
          },
          required: false,
          valueType: valueTypeOf(fieldDefinition),
        }
        continue
      }
      const target = fieldDefinition.relation ?? ''
      const targetNamespace = namespaces.get(target)
      refuse(
        targetNamespace !== undefined,
        `The relation '${entity}.${field}' targets '${target}', which is not in the same datasource.`,
      )
      refuse(
        fieldDefinition.unique !== true && !isSingleFieldConstraint(declaration, field),
        `InstantDB cannot enforce the unique relation '${entity}.${field}': a one-to-one link replaces `
          + 'the earlier row instead of refusing the second.',
      )
      const inverse = Object.entries(definition.entities[target]!.inverseFields ?? {}).find(([, candidate]) =>
        candidate.relation === entity && candidate.inverseField === field
      )
      const reverseLabel = inverse === undefined ? `${namespace}By${field}` : lowerFirst(inverse[0])
      const cascade = fieldDefinition.onDelete === 'cascade'
      relations[field] = {
        cascade,
        label,
        optional: fieldDefinition.optional === true,
        reverseLabel,
        target,
      }
      links[`${namespace}_${label}`] = {
        forward: { has: 'one', label, on: namespace, ...(cascade ? { onDelete: 'cascade' as const } : {}) },
        reverse: { has: 'many', label: reverseLabel, on: targetNamespace! },
      }
    }
    attrsByNamespace[namespace] = attrs
    entities[entity] = { attributes, entity, inverseLabels: {}, namespace, relations }
  }

  // Reverse labels are claimed after every forward label, so a collision names both declarations.
  for (const [entity, mapping] of Object.entries(entities)) {
    for (const [field, relation] of Object.entries(mapping.relations)) {
      claimLabel(
        namespaces.get(relation.target)!,
        relation.reverseLabel,
        `the reverse of '${entity}.${field}'`,
      )
    }
  }
  for (const [entity, declaration] of Object.entries(definition.entities)) {
    const inverseLabels: Record<string, string> = {}
    for (const [field, inverse] of Object.entries(declaration.inverseFields ?? {})) {
      const relation = entities[inverse.relation]?.relations[inverse.inverseField]
      if (relation !== undefined) {
        inverseLabels[field] = relation.reverseLabel
      }
    }
    entities[entity] = { ...entities[entity]!, inverseLabels }
  }

  const accountMapping = entities[accountEntity]
  if (accountMapping !== undefined) {
    claimLabel(accountNamespace, accountUserLabel, `the account's '${usersNamespace}' link`)
    links[`${accountNamespace}_${accountUserLabel}`] = {
      forward: { has: 'one', label: accountUserLabel, on: accountNamespace, onDelete: 'cascade' },
      reverse: { has: 'one', label: 'account', on: usersNamespace },
    }
  }

  return {
    accountEntity,
    entities,
    entityOfNamespace: Object.fromEntries([...namespaces].map(([entity, namespace]) => [namespace, entity])),
    schema: {
      entities: {
        ...(accountMapping === undefined ? {} : { [usersNamespace]: { attrs: usersAttributes, links: {} } }),
        ...Object.fromEntries(
          Object.entries(attrsByNamespace).map(([namespace, attrs]) => [namespace, { attrs, links: {} }]),
        ),
      },
      links,
    },
  }
}

// `$users` is InstantDB's own namespace; a schema that links to it restates its system attribute
// exactly so the plan never proposes changing it.
const usersAttributes: Readonly<Record<string, InstantAttribute>> = {
  email: { config: { indexed: true, unique: true }, required: false, valueType: 'string' },
}

function isSingleFieldConstraint(entity: TR.DataSchemaDefinition['entities'][string], field: string): boolean {
  return (entity.uniqueConstraints ?? []).some(constraint => constraint.length === 1 && constraint[0] === field)
}

function valueTypeOf(field: TR.DataSchemaDefinition['entities'][string]['fields'][string]): InstantValueType {
  return Switch(field.kind, {
    boolean: () => 'boolean' as const,
    enum: () => 'string' as const,
    number: () => 'number' as const,
    // A reference stores the target's unique value, which is text or a number.
    reference: () => 'json' as const,
    relation: () => Errors.throwUnexpected('relations map to links, not attributes'),
    text: () => 'string' as const,
    time: () => 'number' as const,
  })
}

function lowerFirst(name: string): string {
  return `${name.slice(0, 1).toLowerCase()}${name.slice(1)}`
}

function refuse(condition: boolean, message: string): asserts condition {
  Assert.input(condition, `InstantDB cannot store this Tao data: ${message}`)
}
