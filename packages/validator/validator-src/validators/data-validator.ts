import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { dataWriteValidationChecks, dataWriteValidationMessages } from './data-write-validator'

/** dataValidationMessages declares structural and type diagnostics for Tao data. */
export const dataValidationMessages = {
  dataPlacement: 'Data schemas must be declared at file level.',
  duplicateCollection: (name: string) => `Data collection '${name}' is declared more than once.`,
  duplicateEntity: (name: string) => `Data entity '${name}' is declared more than once.`,
  duplicateField: (entity: string, name: string) => `Entity '${entity}' declares field '${name}' more than once.`,
  reservedField: (entity: string, name: string) =>
    `Entity '${entity}' cannot declare reserved field '${name}'; every entity receives that field automatically.`,
  unknownRelation: (entity: string, name: string) =>
    `Entity '${entity}' references unknown relationship entity '${name}'.`,
  relationModifier: (field: string) => `Primitive or boolean data field '${field}' cannot declare a relation.`,
  relationDefault: (field: string) => `Relationship data field '${field}' cannot declare a default.`,
  optionalDefault: (field: string) => `Field '${field}' is optional, so it cannot also declare a default.`,
  autoDeleteOwner: (field: string) =>
    `Data field '${field}' can use auto-delete only on an inverse collection relationship.`,
  missingInverseRelation: (field: string, relation: string, entity: string) =>
    `Inverse relationship '${field}' requires a stored relationship from '${relation}' back to '${entity}'.`,
  ambiguousInverseRelation: (field: string, relation: string) =>
    `Inverse relationship '${field}' is ambiguous because '${relation}' has more than one stored relationship back to its owner.`,
  booleanDefaultCase: (field: string) => `Boolean data field '${field}' must name a yes/no case as its default.`,
  defaultCase: (name: string, field: string) => `Default case '${name}' is not a boolean case of field '${field}'.`,
  duplicateModifier: (field: string, modifier: string) =>
    `Data field '${field}' declares '${modifier}' more than once.`,
  duplicateBooleanCase: (entity: string, name: string) =>
    `Entity '${entity}' declares boolean case '${name}' more than once.`,
  moduleQuery:
    'A module-level query is not part of the language today. It could be added; nothing strictly prevents it.',
  queryPlacement: 'Queries must be declared directly inside view bodies.',
  currentQueryPlacement: 'Queries must be unconditional statements in a view body or its root render block.',
  queryAfterControl: 'Queries must be declared before the first guard, when, or loop in their block.',
  querySource: 'A query source must be a top-level plural or a plural relationship.',
  unknownCollection: (data: string, name: string) => `Data '${data}' has no collection named '${name}'.`,
  unknownEntity: (data: string, name: string) => `Data '${data}' has no entity named '${name}'.`,
  duplicateIndex: (name: string) => `Index '${name}' is declared more than once.`,
  duplicateLocalOnly: (entity: string) => `Entity '${entity}' declares 'local only' more than once.`,
  crossStorageRelation: (entity: string, field: string, relation: string) =>
    `Relationship '${entity}.${field}' crosses the local-only storage boundary; '${entity}' and '${relation}' must both declare 'local only', or neither.`,
  unknownField: (entity: string, name: string) => `Entity '${entity}' has no field named '${name}'.`,
  duplicateOrder: 'A query may declare only one order clause.',
  duplicateLimit: 'A query may declare only one limit clause.',
  limitCount: 'A query limit must be a whole number of at least 1.',
  uniqueFieldKind: (field: string) => `Only primitive data fields can declare 'unique', not '${field}'.`,
  duplicateUniqueField: (entity: string) =>
    `Entity '${entity}' declares more than one unique field; one field is the reconciliation key.`,
  titleFieldKind: (field: string) => `Only text data fields can declare 'title', not '${field}'.`,
  unknownTrait: (word: string) => `Unknown data field trait '${word}'.`,
  duplicateTitleField: (entity: string) =>
    `Entity '${entity}' declares more than one title field; one field names a row to a person.`,
  relationOrder: (name: string) => `Relationship field '${name}' cannot be used for ordering.`,
  relationComparison: (name: string, operator: string) =>
    `Relationship field '${name}' supports only == and !=, not '${operator}'.`,
  booleanComparison: (name: string, operator: string) =>
    `Boolean field '${name}' supports only == and !=, not '${operator}'.`,
  ...dataWriteValidationMessages,
  defaultType: (field: string, expected: string, actual: string) =>
    `Default for data field '${field}' expects ${expected}, got ${actual}.`,
  nowDefault: (field: string) => `Only time field '${field}' can default to now.`,
} as const

/** dataValidationChecks validates reactive queries and strict row writes. */
export const dataValidationChecks = {
  [AST.EntityQueryDeclaration.$type]: validateEntityQuery,
  ...dataWriteValidationChecks,
} satisfies NodeValidationChecks

/** validateDataFile validates the top-level data entity catalog. */
export function validateDataFile(file: AST.TaoFile, ctx: ValidationContext): void {
  validateEntityCatalog(file, ctx)
}

function validateEntityCatalog(file: AST.TaoFile, ctx: ValidationContext): void {
  const entities = file.statements.filter(AST.isEntityDataDeclaration)
  reportDuplicates(entities, entity => entity.name, dataValidationMessages.duplicateCollection, ctx)
  reportDuplicates(entities, entity => entity.singularName, dataValidationMessages.duplicateEntity, ctx)
  for (const entity of entities) {
    validateEntityDefinition(entity, ctx)
  }
}

function validateEntityDefinition(entity: AST.EntityDataDeclaration, ctx: ValidationContext): void {
  const fields = entity.block.entries.filter(AST.isEntityDataField)
  reportDuplicates(
    fields,
    field => field.name,
    name => dataValidationMessages.duplicateField(entity.singularName, name),
    ctx,
  )
  validateBooleanCaseNames(entity, fields, ctx)
  const indexes = entity.block.entries.filter(AST.isDataIndex)
  reportDuplicates(indexes, index => index.fieldName, dataValidationMessages.duplicateIndex, ctx)
  for (const index of indexes) {
    if (!fields.some(field => field.name === index.fieldName)) {
      ctx.error(index, dataValidationMessages.unknownField(entity.singularName, index.fieldName))
    }
  }
  const orders = entity.block.entries.filter(AST.isDataDefaultOrder)
  for (const duplicate of orders.slice(1)) {
    ctx.error(duplicate, dataValidationMessages.duplicateOrder)
  }
  for (const duplicate of entity.block.entries.filter(AST.isDataLocalOnly).slice(1)) {
    ctx.error(duplicate, dataValidationMessages.duplicateLocalOnly(entity.singularName))
  }
  const uniqueFields = fields.filter(field => (field.traits?.traits ?? []).some(trait => trait.unique))
  for (const extra of uniqueFields.slice(1)) {
    ctx.error(extra, dataValidationMessages.duplicateUniqueField(entity.singularName))
  }
  const titleFields = fields.filter(field => (field.traits?.traits ?? []).some(AST.traitIsTitle))
  for (const extra of titleFields.slice(1)) {
    ctx.error(extra, dataValidationMessages.duplicateTitleField(entity.singularName))
  }
  for (const field of fields) {
    validateEntityField(entity, field, ctx)
  }
  for (const order of orders) {
    const field = fields.find(candidate => candidate.name === order.fieldName)
    if (!field) {
      ctx.error(order, dataValidationMessages.unknownField(entity.singularName, order.fieldName))
    } else if (Type.dataFieldType(field).kind === 'list') {
      ctx.error(order, dataValidationMessages.relationOrder(field.name))
    }
  }
}

function validateEntityField(
  entity: AST.EntityDataDeclaration,
  field: AST.EntityDataField,
  ctx: ValidationContext,
): void {
  if (field.name === 'Id') {
    ctx.error(field, dataValidationMessages.reservedField(entity.singularName, field.name))
  }
  const traits = field.traits?.traits ?? []
  const defaults = traits.filter(trait => trait.defaultValue || trait.defaultCase)
  for (const duplicate of defaults.slice(1)) {
    ctx.error(duplicate, dataValidationMessages.duplicateModifier(field.name, 'default'))
  }
  if (field.optional && defaults.length > 0) {
    ctx.error(field, dataValidationMessages.optionalDefault(field.name))
  }
  const owned = traits.filter(trait => trait.owned)
  for (const duplicate of owned.slice(1)) {
    ctx.error(duplicate, dataValidationMessages.duplicateModifier(field.name, 'owned'))
  }
  const uniques = traits.filter(trait => trait.unique)
  for (const duplicate of uniques.slice(1)) {
    ctx.error(duplicate, dataValidationMessages.duplicateModifier(field.name, 'unique'))
  }
  if (!field.primitive) {
    for (const trait of uniques) {
      ctx.error(trait, dataValidationMessages.uniqueFieldKind(field.name))
    }
  }
  for (const trait of traits) {
    if (trait.word !== undefined && !AST.wordTraitNames.includes(trait.word)) {
      ctx.error(trait, dataValidationMessages.unknownTrait(trait.word))
    }
  }
  const titles = traits.filter(AST.traitIsTitle)
  for (const duplicate of titles.slice(1)) {
    ctx.error(duplicate, dataValidationMessages.duplicateModifier(field.name, 'title'))
  }
  if (field.primitive !== 'text') {
    for (const trait of titles) {
      ctx.error(trait, dataValidationMessages.titleFieldKind(field.name))
    }
  }
  if (field.primitive || field.boolean) {
    for (const trait of owned) {
      ctx.error(trait, dataValidationMessages.autoDeleteOwner(field.name))
    }
  } else {
    validateRelationshipDataField(entity, field, defaults, ctx)
  }
  validateEntityFieldDefault(field, ctx)
}

function validateRelationshipDataField(
  entity: AST.EntityDataDeclaration,
  field: AST.EntityDataField,
  defaults: readonly AST.Trait[],
  ctx: ValidationContext,
): void {
  const relationName = Type.dataFieldRelationName(field)
  const relation = Type.dataFieldRelationEntity(field)
  const inverse = Type.dataFieldIsInverseRelation(field)
  if (!relation) {
    ctx.error(field, dataValidationMessages.unknownRelation(entity.singularName, relationName))
  }
  // The two storage facts partition the catalog into a synced store and a device-local one, and a
  // relation resolves inside one store's rows. Say so here rather than as an unresolved relation.
  if (relation && Type.dataEntityIsLocalOnly(entity) !== Type.dataEntityIsLocalOnly(relation)) {
    ctx.error(
      field,
      dataValidationMessages.crossStorageRelation(entity.singularName, field.name, relation.singularName),
    )
  }
  for (const modifier of defaults) {
    ctx.error(modifier, dataValidationMessages.relationDefault(field.name))
  }
  if (relation && inverse) {
    validateInverseRelationship(entity, field, relation, ctx)
  }
}

function validateInverseRelationship(
  entity: AST.EntityDataDeclaration,
  field: AST.EntityDataField,
  relation: AST.EntityDataDeclaration,
  ctx: ValidationContext,
): void {
  const inverseFields = Type.dataFields(relation).filter(candidate => {
    const candidateType = Type.dataFieldType(candidate)
    return candidateType.kind === 'entity' && candidateType.entity === entity
  })
  if (inverseFields.length === 0) {
    ctx.error(
      field,
      dataValidationMessages.missingInverseRelation(
        `${entity.singularName}.${field.name}`,
        relation.singularName,
        entity.singularName,
      ),
    )
  } else if (inverseFields.length > 1) {
    ctx.error(
      field,
      dataValidationMessages.ambiguousInverseRelation(
        `${entity.singularName}.${field.name}`,
        relation.singularName,
      ),
    )
  }
}

function validateEntityQuery(query: AST.EntityQueryDeclaration, ctx: ValidationContext): void {
  // File-level query syntax is retained only as validator-owned diagnostic recovery. Stop after
  // this one tailored error so details of an unsupported query cannot add secondary diagnostics.
  if (AST.isTaoFile(query.$container)) {
    ctx.error(query, dataValidationMessages.moduleQuery)
    return
  }
  validateEntityQueryPlacement(query, ctx)
  const entity = Type.queryEntity(query)
  if (!entity) {
    ctx.error(query.source ?? query, dataValidationMessages.querySource)
    return
  }
  const clauses = query.block?.clauses ?? []
  const orders = clauses.filter(AST.isOrderClause)
  for (const duplicate of orders.slice(1)) {
    ctx.error(duplicate, dataValidationMessages.duplicateOrder)
  }
  const limits = clauses.filter(AST.isLimitClause)
  for (const duplicate of limits.slice(1)) {
    ctx.error(duplicate, dataValidationMessages.duplicateLimit)
  }
  for (const limit of limits) {
    const count = Number(limit.count.value)
    if (!Number.isInteger(count) || count < 1) {
      ctx.error(limit, dataValidationMessages.limitCount)
    }
  }
  const fields = Type.dataFields(entity)
  for (const clause of clauses) {
    if (AST.isLimitClause(clause)) {
      continue
    }
    if (AST.isBooleanWhereClause(clause)) {
      const field = clause.case.ref
      if (field && !fields.includes(field)) {
        ctx.error(clause, dataValidationMessages.unknownField(Type.dataEntityName(entity), field.name))
      }
      continue
    }
    const field = fields.find(candidate => candidate.name === clause.fieldName)
    if (!field) {
      ctx.error(clause, dataValidationMessages.unknownField(Type.dataEntityName(entity), clause.fieldName))
      continue
    }
    const fieldType = Type.dataFieldType(field)
    if (AST.isOrderClause(clause)) {
      if (fieldType.kind === 'list' || fieldType.kind === 'entity') {
        ctx.error(clause, dataValidationMessages.relationOrder(field.name))
      }
      continue
    }
    const usesUnsupportedBooleanComparison = fieldType.kind === 'primitive'
      && fieldType.primitive === 'boolean'
      && clause.operator !== '=='
      && clause.operator !== '!='
    if (usesUnsupportedBooleanComparison) {
      ctx.error(clause, dataValidationMessages.booleanComparison(field.name, clause.operator))
    }
    if (fieldType.kind === 'entity' && clause.operator !== '==' && clause.operator !== '!=') {
      ctx.error(clause, dataValidationMessages.relationComparison(field.name, clause.operator))
    }
    validateFieldValue(field, clause.value, ctx)
  }
}

function validateEntityQueryPlacement(query: AST.EntityQueryDeclaration, ctx: ValidationContext): void {
  const block = query.$container
  if (!AST.isBlock(block)) {
    ctx.error(query, dataValidationMessages.currentQueryPlacement)
    return
  }
  const owner = block.$container
  const directView = AST.isViewDeclaration(owner)
  const directRootRender = AST.isRender(owner)
    && AST.isBlock(owner.$container)
    && AST.isViewDeclaration(owner.$container.$container)
  if (!directView && !directRootRender) {
    ctx.error(query, dataValidationMessages.currentQueryPlacement)
  }
  const queryIndex = block.statements.indexOf(query)
  const controlIndex = block.statements.findIndex(statement =>
    AST.isGuardRenderStatement(statement)
    || AST.isWhenRenderStatement(statement)
    || AST.isIfRenderStatement(statement)
    || AST.isForStatement(statement)
  )
  if (controlIndex >= 0 && queryIndex > controlIndex) {
    ctx.error(query, dataValidationMessages.queryAfterControl)
  }
}

function validateEntityFieldDefault(field: AST.EntityDataField, ctx: ValidationContext): void {
  const defaults = (field.traits?.traits ?? []).filter(trait => trait.defaultValue || trait.defaultCase)
  const modifier = defaults[0]
  if (!modifier) {
    return
  }
  if (modifier.defaultCase) {
    if (!field.boolean || (modifier.defaultCase !== field.name && modifier.defaultCase !== field.negativeName)) {
      ctx.error(modifier, dataValidationMessages.defaultCase(modifier.defaultCase, field.name))
    }
    return
  }
  const defaultValue = modifier.defaultValue
  if (!defaultValue) {
    return
  }
  if (field.boolean) {
    ctx.error(modifier, dataValidationMessages.booleanDefaultCase(field.name))
    return
  }
  if (AST.isNowExpression(defaultValue)) {
    if (field.primitive !== 'time') {
      ctx.error(defaultValue, dataValidationMessages.nowDefault(field.name))
    }
    return
  }
  const expected = Type.dataFieldType(field)
  const actual = Type.ofExpression(defaultValue)
  if (expected.kind !== 'unresolved' && actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
    ctx.error(
      defaultValue,
      dataValidationMessages.defaultType(field.name, Type.displayName(expected), Type.displayName(actual)),
    )
  }
}

function validateBooleanCaseNames(
  entity: AST.EntityDataDeclaration,
  fields: readonly AST.EntityDataField[],
  ctx: ValidationContext,
): void {
  const owners = new Map(fields.map(field => [field.name, field]))
  for (const field of fields) {
    if (!field.boolean || !field.negativeName) {
      continue
    }
    if (owners.has(field.negativeName)) {
      ctx.error(field, dataValidationMessages.duplicateBooleanCase(entity.singularName, field.negativeName))
      continue
    }
    owners.set(field.negativeName, field)
  }
}

function validateFieldValue(field: ASTUtils.DataFieldDefinition, value: AST.Expression, ctx: ValidationContext): void {
  const expected = Type.dataFieldType(field)
  const actual = Type.ofExpression(value)
  if (expected.kind === 'unresolved' || actual.kind === 'unresolved') {
    return
  }
  if (!Type.isAssignable(actual, expected)) {
    ctx.error(value, dataValidationMessages.fieldType(field.name, Type.displayName(expected), Type.displayName(actual)))
  }
}

function reportDuplicates<Item extends AST.Node>(
  items: readonly Item[],
  nameOf: (item: Item) => string,
  message: (name: string) => string,
  ctx: ValidationContext,
): void {
  const seen = new Set<string>()
  for (const item of items) {
    const name = nameOf(item)
    if (seen.has(name)) {
      ctx.error(item, message(name))
    }
    seen.add(name)
  }
}
