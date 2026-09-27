import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'

/**
 * The stored shape of a project's data: for each synced store, the entities, fields, links, and
 * unique constraints a backend keeps. Codegen emits it inside each generated schema with the
 * runtime-only keys (defaults, titles, required sentences, grants, command policy) beside it, and
 * the compiler writes it to `TaoDataSchema.json`, so a tool that provisions a backend, such as
 * `tao instantdb push`, reads the compiler's lowering rather than restating it.
 */

/** storedDataSchemaFile is the compiled sidecar holding every synced store's stored schema. */
export const storedDataSchemaFile = 'TaoDataSchema.json'

/** StoredDataField is what a backend stores for one field. */
export type StoredDataField = Readonly<{
  kind: 'boolean' | 'enum' | 'number' | 'reference' | 'relation' | 'text' | 'time'
  cases?: readonly string[]
  optional?: true
  indexed?: true
  unique?: true
  /** relation names the target entity of a relation or reference. */
  relation?: string
  /** referenceField is the target's unique field, the value a reference stores. */
  referenceField?: string
  /** store names the store a reference's target lives in. */
  store?: string
  onDelete?: 'cascade'
}>

/** StoredInverseField is a relation read from the other side, stored only as its target's field. */
type StoredInverseField = Readonly<{ relation: string; inverseField: string }>

/** StoredDataEntity is what a backend stores for one entity. */
export type StoredDataEntity = Readonly<{
  collection: string
  fields: Readonly<Record<string, StoredDataField>>
  inverseFields: Readonly<Record<string, StoredInverseField>>
  uniqueConstraints?: readonly (readonly string[])[]
}>

/** StoredDataSchema is one store's stored schema, named as its generated schema is. */
type StoredDataSchema = Readonly<{
  name: string
  schemaVersion: 1
  entities: Readonly<Record<string, StoredDataEntity>>
}>

/** StoredDataSchemas is the content of `TaoDataSchema.json`: each synced store's schema by store name. */
export type StoredDataSchemas = Readonly<{ stores: Readonly<Record<string, StoredDataSchema>> }>

/**
 * storedDataSchemas lowers every synced store in the plan. Device stores are left out: their rows
 * never leave the device, so no backend provisions them.
 */
export function storedDataSchemas(plan: ASTUtils.DataStorePlan): StoredDataSchemas {
  return {
    stores: Object.fromEntries(
      plan.stores
        .filter(store => store.kind !== 'device' && store.collections.length > 0)
        .map(store => [store.name, storedDataSchema(store.name, store.collections, plan)]),
    ),
  }
}

function storedDataSchema(
  name: string,
  entities: readonly AST.EntityDataDeclaration[],
  plan: ASTUtils.DataStorePlan | undefined,
): StoredDataSchema {
  return {
    name,
    schemaVersion: 1,
    entities: Object.fromEntries(entities.map(entity => [entity.singularName, storedDataEntity(entity, plan)])),
  }
}

/** storedDataEntity lowers one entity; `plan` places a reference's target in its store. */
export function storedDataEntity(
  entity: AST.EntityDataDeclaration,
  plan: ASTUtils.DataStorePlan | undefined,
): StoredDataEntity {
  const fields = entity.block.entries.filter(AST.isEntityDataField)
  const unique = entity.block.entries.filter(AST.isDataUnique).map(entry => entry.fieldNames)
  return {
    collection: entity.name,
    fields: Object.fromEntries(
      fields.filter(field => !Type.dataFieldIsInverseRelation(field))
        .map(field => [field.name, storedDataField(entity, field, plan)]),
    ),
    inverseFields: Object.fromEntries(
      fields.filter(Type.dataFieldIsInverseRelation).map(field => [field.name, storedInverseField(entity, field)]),
    ),
    ...(unique.length > 0 ? { uniqueConstraints: unique } : {}),
  }
}

function storedDataField(
  owner: AST.EntityDataDeclaration,
  field: AST.EntityDataField,
  plan: ASTUtils.DataStorePlan | undefined,
): StoredDataField {
  const traits = field.traits?.traits ?? []
  const optional = field.optional ? { optional: true as const } : {}
  const type = Type.dataFieldType(field)
  if (type.kind === 'enum') {
    return { kind: 'enum', cases: AST.caseSetCasesOf(type.declaration).map(AST.caseSetCaseName), ...optional }
  }
  if (type.kind === 'primitive') {
    const indexed = owner.block.entries.some(entry => AST.isDataIndex(entry) && entry.fieldName === field.name)
    return {
      kind: type.primitive as StoredDataField['kind'],
      ...optional,
      ...(indexed ? { indexed: true as const } : {}),
      ...(traits.some(trait => trait.unique) ? { unique: true as const } : {}),
    }
  }
  const target = Type.dataFieldRelationEntity(field)
  Assert.defined(target, 'validated stored field resolves its entity', { field: `${owner.singularName}.${field.name}` })
  if (Type.dataFieldIsReference(field)) {
    // A reference is stored as the target's unique value, so it survives the target living in
    // another store; the runtime resolves it to a handle in whichever store holds that entity.
    const unique = Type.dataFields(target).find(candidate =>
      (candidate.traits?.traits ?? []).some(trait => trait.unique)
    )
    Assert.defined(unique, 'validated reference target declares a unique field')
    const store = plan ? ASTUtils.storeOfCollection(plan, target) : undefined
    return {
      kind: 'reference',
      ...optional,
      relation: target.singularName,
      referenceField: unique.name,
      ...(store ? { store: store.name } : {}),
    }
  }
  return {
    kind: 'relation',
    ...optional,
    relation: target.singularName,
    ...(relationCascades(owner, target) ? { onDelete: 'cascade' as const } : {}),
  }
}

function storedInverseField(owner: AST.EntityDataDeclaration, field: AST.EntityDataField): StoredInverseField {
  const inverse = Type.dataFieldRelationEntity(field)
  Assert.defined(inverse, 'validated inferred inverse relation resolves its entity')
  const inverseField = inverse.block.entries.filter(AST.isEntityDataField).find(candidate => {
    const candidateType = Type.dataFieldType(candidate)
    return candidateType.kind === 'entity' && candidateType.entity === owner
  })
  Assert.defined(inverseField, 'validated inverse relation resolves its stored field')
  return { relation: inverse.singularName, inverseField: inverseField.name }
}

/** relationCascades is true when the relation's target owns the collection this relation fills. */
function relationCascades(owner: AST.EntityDataDeclaration, target: AST.EntityDataDeclaration): boolean {
  return Type.dataFields(target).some(candidate =>
    Type.dataFieldIsInverseRelation(candidate)
    && Type.dataFieldRelationEntity(candidate) === owner
    && (candidate.traits?.traits ?? []).some(trait => trait.owned)
  )
}
