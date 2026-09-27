import type TR from '@runtime/TR'
import { Assert } from '@shared/core'
import { accountNamespace, accountUserLabel, type InstantEntityMapping, type InstantMapping } from './instant-schema'

/**
 * InstantDB permission rules generated from Tao's compiled grants.
 *
 * Without a policy every Tao namespace is public. With one, each grant's principal path becomes a
 * CEL membership test that walks the path's links to the account and on to its `$users` row:
 * `Note can read by Owner` reads `auth.id in data.ref('owner.$user.id')`.
 *
 * Link semantics the rules rely on, observed on InstantDB rather than assumed:
 * - linking an existing row names the link label in `request.modifiedFields`, unlinking does not,
 *   so each forward relation also gets an `unlink` rule;
 * - an explicit `link` rule replaces the forward row's update check, so none is ever emitted;
 * - a create and its links are checked together against the created row.
 *
 * The first hop of every principal path is an owner, and owners are immutable: nothing may unlink
 * one, and no grant may list one as updatable.
 *
 * A relation that does not cascade restricts deleting its target, and the runtime refuses such a
 * delete before saving. The rules do not repeat that check: a delete rule sees the rows as they were
 * before the transaction, so it would also refuse one commit that deletes the referring rows and
 * then their target. A row left referring to a deleted target, which only a concurrent writer can
 * cause, projects as an empty optional relation or, when required, as an absent row.
 */

/** InstantRules is the permission document InstantDB's perms endpoint accepts. */
export type InstantRules = Readonly<Record<string, InstantNamespaceRules>>

type InstantNamespaceRules = Readonly<{
  allow: Readonly<Record<string, string | Readonly<Record<string, string>>>>
  bind?: readonly string[]
}>

type Grant = NonNullable<TR.DataSchemaDefinition['entities'][string]['grants']>[number]

/** TaoDataPolicy is the part of the compiler's `TaoDataPolicy.json` rule generation reads. */
export type TaoDataPolicy = Readonly<{
  accountEntity: string
  entities: Readonly<Record<string, Readonly<{ grants: readonly Grant[] }>>>
}>

const denied = 'false'
const allowed = 'true'

/** instantRules derives InstantDB permissions from the mapped schema and, when given, the policy. */
export function instantRules(mapping: InstantMapping, policy?: TaoDataPolicy): InstantRules {
  const rules: Record<string, InstantNamespaceRules> = {
    // Unknown namespaces and new attributes are refused, so a client can never widen the schema.
    $default: { allow: { $default: denied } },
    attrs: { allow: { $default: denied } },
  }
  for (const entity of Object.values(mapping.entities)) {
    if (policy === undefined) {
      rules[entity.namespace] = { allow: { create: allowed, delete: allowed, update: allowed, view: allowed } }
      continue
    }
    Assert.input(
      Object.hasOwn(policy.entities, entity.entity),
      `The data policy does not cover '${entity.entity}'; recompile so the policy and schema agree.`,
    )
    rules[entity.namespace] = policyRules(mapping, entity, policy.entities[entity.entity]!.grants)
  }
  return rules
}

function policyRules(
  mapping: InstantMapping,
  entity: InstantEntityMapping,
  grants: readonly Grant[],
): InstantNamespaceRules {
  const bindings: string[] = []
  const aliasOf = new Map<string, string>()
  const principal = (grant: Grant): string => {
    const expression = principalExpression(mapping, entity, grant.principal)
    const existing = aliasOf.get(expression)
    if (existing !== undefined) {
      return existing
    }
    // Aliases never equal a link label, which InstantDB would read as a reference instead.
    const alias = `principal${aliasOf.size}`
    aliasOf.set(expression, alias)
    bindings.push(alias, expression)
    return alias
  }
  const granting = (operation: Grant['operations'][number]) =>
    grants.filter(grant => grant.operations.includes(operation))
  const anyOf = (operation: Grant['operations'][number]): string => disjunction(granting(operation).map(principal))

  const owners = new Set(
    grants.flatMap(grant => grant.principal.slice(0, 1)).filter(field => entity.relations[field] !== undefined),
  )
  const updates = granting('update')
  for (const grant of updates) {
    for (const field of grant.updateFields ?? []) {
      Assert.input(
        !owners.has(field),
        `InstantDB cannot enforce updating the owner '${entity.entity}.${field}': owners are immutable there.`,
      )
    }
  }
  const labelOf = (field: string): string => {
    const label = entity.attributes[field] ?? entity.relations[field]?.label
    Assert.input(label !== undefined, `The data policy names unknown field '${entity.entity}.${field}'.`)
    return label
  }
  const fieldAllowed = updates.map(grant => {
    const labels = (grant.updateFields ?? []).map(labelOf)
    return labels.length === 0 ? denied : `(${principal(grant)} && f in ${celList(labels)})`
  })
  const update = updates.length === 0
    ? denied
    : conjunction([
      disjunction(updates.map(principal)),
      `request.modifiedFields.all(f, ${disjunction(fieldAllowed)})`,
    ])

  const unlink: Record<string, string> = {}
  for (const [field, relation] of Object.entries(entity.relations)) {
    unlink[relation.label] = owners.has(field)
      ? denied
      : disjunction(updates.filter(grant => grant.updateFields?.includes(field)).map(principal))
  }
  const isAccount = entity.namespace === accountNamespace
  if (isAccount) {
    unlink[accountUserLabel] = denied
  }
  // An account row is its own `$users` row's account: only that user creates it, linked to itself.
  const create = isAccount
    ? `auth.id == data.id && auth.id in data.ref('${accountUserLabel}.id')`
    : anyOf('create')
  const view = anyOf('read')
  return {
    allow: { create, delete: anyOf('delete'), unlink, update, view },
    ...(bindings.length === 0 ? {} : { bind: bindings }),
  }
}

function principalExpression(
  mapping: InstantMapping,
  entity: InstantEntityMapping,
  path: readonly string[],
): string {
  let current = entity
  const labels: string[] = []
  for (const field of path) {
    const relation = current.relations[field]
    const inverse = current.inverseLabels[field]
    const target = relation?.target
      ?? Object.values(mapping.entities).find(candidate =>
        Object.values(candidate.relations).some(link => link.reverseLabel === inverse && link.target === current.entity)
      )?.entity
    Assert.input(
      target !== undefined,
      `The grant path '${[entity.entity, ...path].join('.')}' crosses '${field}', which is not a relation.`,
    )
    labels.push(relation?.label ?? inverse!)
    current = mapping.entities[target]!
  }
  Assert.input(
    current.entity === mapping.accountEntity,
    `The grant path '${[entity.entity, ...path].join('.')}' must end at '${mapping.accountEntity}'.`,
  )
  return `auth.id in data.ref('${[...labels, accountUserLabel, 'id'].join('.')}')`
}

function celList(values: readonly string[]): string {
  return `[${values.map(value => `'${value}'`).join(', ')}]`
}

function disjunction(terms: readonly string[]): string {
  const live = [...new Set(terms.filter(term => term !== denied))]
  return live.length === 0 ? denied : live.length === 1 ? live[0]! : `(${live.join(' || ')})`
}

function conjunction(terms: readonly string[]): string {
  if (terms.includes(denied)) {
    return denied
  }
  const live = [...new Set(terms.filter(term => term !== allowed))]
  return live.length === 0 ? allowed : live.join(' && ')
}
