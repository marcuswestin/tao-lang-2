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
  autoDeleteOwner: (field: string) =>
    `Data field '${field}' can use auto-delete only on an inverse collection relationship.`,
  ambiguousInverseRelation: (field: string, relation: string) =>
    `Inverse relationship '${field}' is ambiguous because '${relation}' has more than one stored relationship back to its owner.`,
  booleanDefaultCase: (field: string) => `Boolean data field '${field}' must name a yes/no case as its default.`,
  duplicateModifier: (field: string, modifier: string) =>
    `Data field '${field}' declares '${modifier}' more than once.`,
  duplicateBooleanCase: (entity: string, name: string) =>
    `Entity '${entity}' declares boolean case '${name}' more than once.`,
  queryPlacement: 'Queries must be declared directly inside view bodies.',
  currentQueryPlacement: 'Queries must be unconditional statements in a view body or its root render block.',
  queryAfterControl: 'Queries must be declared before the first guard, when, or loop in their block.',
  querySource: 'A query source must be a top-level plural or a plural relationship.',
  unknownCollection: (data: string, name: string) => `Data '${data}' has no collection named '${name}'.`,
  unknownEntity: (data: string, name: string) => `Data '${data}' has no entity named '${name}'.`,
  duplicateIndex: (name: string) => `Index '${name}' is declared more than once.`,
  unknownField: (entity: string, name: string) => `Entity '${entity}' has no field named '${name}'.`,
  duplicateOrder: 'A query may declare only one order clause.',
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
      ctx.error(dataValidationMessages.unknownField(entity.singularName, index.fieldName), index)
    }
  }
  const orders = entity.block.entries.filter(AST.isDataDefaultOrder)
  for (const duplicate of orders.slice(1)) {
    ctx.error(dataValidationMessages.duplicateOrder, duplicate)
  }
  for (const field of fields) {
    validateEntityField(entity, field, ctx)
  }
  for (const order of orders) {
    const field = fields.find(candidate => candidate.name === order.fieldName)
    if (!field) {
      ctx.error(dataValidationMessages.unknownField(entity.singularName, order.fieldName), order)
    } else if (Type.dataFieldType(field).kind === 'list') {
      ctx.error(dataValidationMessages.relationOrder(field.name), order)
    }
  }
}

function validateEntityField(
  entity: AST.EntityDataDeclaration,
  field: AST.EntityDataField,
  ctx: ValidationContext,
): void {
  if (field.name === 'Id') {
    ctx.error(dataValidationMessages.reservedField(entity.singularName, field.name), field)
  }
  const traits = field.traits?.traits ?? []
  const defaults = traits.filter(trait => trait.defaultValue || trait.defaultCase)
  for (const duplicate of defaults.slice(1)) {
    ctx.error(dataValidationMessages.duplicateModifier(field.name, 'default'), duplicate)
  }
  if (field.optional && defaults.length > 0) {
    ctx.error(`Field '${field.name}' is optional, so it cannot also declare a default.`, field)
  }
  const owned = traits.filter(trait => trait.owned)
  for (const duplicate of owned.slice(1)) {
    ctx.error(dataValidationMessages.duplicateModifier(field.name, 'owned'), duplicate)
  }
  if (field.primitive || field.boolean) {
    for (const trait of owned) {
      ctx.error(dataValidationMessages.autoDeleteOwner(field.name), trait)
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
    ctx.error(dataValidationMessages.unknownRelation(entity.singularName, relationName), field)
  }
  for (const modifier of defaults) {
    ctx.error(dataValidationMessages.relationDefault(field.name), modifier)
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
      `Inverse relationship '${entity.singularName}.${field.name}' requires a stored relationship from '${relation.singularName}' back to '${entity.singularName}'.`,
      field,
    )
  } else if (inverseFields.length > 1) {
    ctx.error(
      dataValidationMessages.ambiguousInverseRelation(
        `${entity.singularName}.${field.name}`,
        relation.singularName,
      ),
      field,
    )
  }
}

function validateEntityQuery(query: AST.EntityQueryDeclaration, ctx: ValidationContext): void {
  validateEntityQueryPlacement(query, ctx)
  const entity = Type.queryEntity(query)
  if (!entity) {
    ctx.error(dataValidationMessages.querySource, query.source ?? query)
    return
  }
  const clauses = query.block?.clauses ?? []
  const orders = clauses.filter(AST.isOrderClause)
  for (const duplicate of orders.slice(1)) {
    ctx.error(dataValidationMessages.duplicateOrder, duplicate)
  }
  const fields = Type.dataFields(entity)
  for (const clause of clauses) {
    if (AST.isBooleanWhereClause(clause)) {
      const field = clause.case.ref
      if (field && !fields.includes(field)) {
        ctx.error(dataValidationMessages.unknownField(Type.dataEntityName(entity), field.name), clause)
      }
      continue
    }
    const field = fields.find(candidate => candidate.name === clause.fieldName)
    if (!field) {
      ctx.error(dataValidationMessages.unknownField(Type.dataEntityName(entity), clause.fieldName), clause)
      continue
    }
    const fieldType = Type.dataFieldType(field)
    if (AST.isOrderClause(clause)) {
      if (fieldType.kind === 'list' || fieldType.kind === 'entity') {
        ctx.error(dataValidationMessages.relationOrder(field.name), clause)
      }
      continue
    }
    const usesUnsupportedBooleanComparison = fieldType.kind === 'primitive'
      && fieldType.primitive === 'boolean'
      && clause.operator !== '=='
      && clause.operator !== '!='
    if (usesUnsupportedBooleanComparison) {
      ctx.error(dataValidationMessages.booleanComparison(field.name, clause.operator), clause)
    }
    if (fieldType.kind === 'entity' && clause.operator !== '==' && clause.operator !== '!=') {
      ctx.error(dataValidationMessages.relationComparison(field.name, clause.operator), clause)
    }
    validateFieldValue(field, clause.value, ctx)
  }
}

function validateEntityQueryPlacement(query: AST.EntityQueryDeclaration, ctx: ValidationContext): void {
  const block = query.$container
  if (!AST.isBlock(block)) {
    ctx.error(dataValidationMessages.currentQueryPlacement, query)
    return
  }
  const owner = block.$container
  const directView = AST.isVisualDeclaration(owner)
  const directRootRender = AST.isRender(owner)
    && AST.isBlock(owner.$container)
    && AST.isVisualDeclaration(owner.$container.$container)
  if (!directView && !directRootRender) {
    ctx.error(dataValidationMessages.currentQueryPlacement, query)
  }
  const queryIndex = block.statements.indexOf(query)
  const controlIndex = block.statements.findIndex(statement =>
    AST.isGuardRenderStatement(statement)
    || AST.isWhenRenderStatement(statement)
    || AST.isIfRenderStatement(statement)
    || AST.isForStatement(statement)
  )
  if (controlIndex >= 0 && queryIndex > controlIndex) {
    ctx.error(dataValidationMessages.queryAfterControl, query)
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
      ctx.error(`Default case '${modifier.defaultCase}' is not a boolean case of field '${field.name}'.`, modifier)
    }
    return
  }
  const defaultValue = modifier.defaultValue
  if (!defaultValue) {
    return
  }
  if (field.boolean) {
    ctx.error(dataValidationMessages.booleanDefaultCase(field.name), modifier)
    return
  }
  if (AST.isNowExpression(defaultValue)) {
    if (field.primitive !== 'time') {
      ctx.error(dataValidationMessages.nowDefault(field.name), defaultValue)
    }
    return
  }
  const expected = Type.dataFieldType(field)
  const actual = Type.ofExpression(defaultValue)
  if (expected.kind !== 'unresolved' && actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
    ctx.error(
      dataValidationMessages.defaultType(field.name, Type.displayName(expected), Type.displayName(actual)),
      defaultValue,
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
      ctx.error(dataValidationMessages.duplicateBooleanCase(entity.singularName, field.negativeName), field)
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
    ctx.error(dataValidationMessages.fieldType(field.name, Type.displayName(expected), Type.displayName(actual)), value)
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
      ctx.error(message(name), item)
    }
    seen.add(name)
  }
}
