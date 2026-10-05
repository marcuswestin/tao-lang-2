import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import {
  configuredItemValidationChecks,
  configuredItemValidationMessages,
  constructorLiteralKind,
} from './configured-item-validator'

/** typeValidationMessages declares diagnostics for custom types, constructors is item, and member access. */
export const typeValidationMessages = {
  namedStateBoolean: (name: string) => `Named state '${name}' requires a same-name yes/no type.`,
  unknownType: (name: string) => `Unknown type '${name}'.`,
  duplicateItemField: (name: string) => `Item field '${name}' is declared more than once.`,
  slotDefaultType: (name: string, expected: string, actual: string) =>
    `Default for slot '${name}' expects ${expected}, got ${actual}.`,
  derivedBaseShape: (name: string) => `Derived type base '${name}' has no item slot shape.`,
  derivedSlotReopened: (name: string) => `Derived slot '${name}' cannot reopen a filled base slot.`,
  derivedSlotType: (name: string, expected: string, actual: string) =>
    `Derived slot '${name}' must narrow ${expected}, got ${actual}.`,
  projectedItemBase: () => 'An input type must select fields from a data entity.',
  projectedItemField: (entity: string, name: string) => `Data entity '${entity}' has no field named '${name}'.`,
  duplicateProjectedItemField: (name: string) => `Input type selects field '${name}' more than once.`,
  copyInputSource: (input: string, entity: string) => `Copy as '${input}' expects a ${entity} row.`,
  copyInputField: (input: string, field: string) => `Copy as '${input}' needs a compatible '${field}' field.`,
  copyUnsupportedValue: (type: string) => `Copy cannot directly copy ${type} values in this runtime.`,
  ...configuredItemValidationMessages,
  typeFixIncompatible: (type: string) => `Value cannot be type-fixed as '${type}'.`,
  cyclicType: (name: string) => `Type '${name}' cannot reference itself through its type definition.`,
  defaultParameterOrder: (name: string) => `Required parameter '${name}' cannot follow a defaulted parameter.`,
  defaultParameterType: (name: string, expected: string, actual: string) =>
    `Default value for parameter '${name}' expects ${expected}, got ${actual}.`,
  optionalFieldDefault: (name: string) => `Optional item field '${name}' cannot also declare a default value.`,
  optionalFieldType: (name: string) => `Optional item field '${name}' must declare an explicit type.`,
} as const

/** typeValidationChecks validates custom type declarations and item/list/custom expression forms. */
export const typeValidationChecks = {
  [AST.StateDeclaration.$type]: (state, ctx) => {
    if (!AST.isNamedStateShorthand(state)) {
      return
    }
    const declaration = AST.namedStateTypeDeclaration(state)
    if (!declaration) {
      ctx.error(state, typeValidationMessages.unknownType(state.name))
      return
    }
    const type = Type.ofDefinition(declaration)
    if (type.kind !== 'unresolved' && (type.kind !== 'primitive' || type.primitive !== 'boolean')) {
      ctx.error(state, typeValidationMessages.namedStateBoolean(state.name))
    }
  },
  [AST.TypeDeclaration.$type]: validateTypeDeclaration,
  [AST.DerivedTypeExpression.$type]: validateDerivedType,
  [AST.ItemTypeExpression.$type]: validateItemType,
  [AST.ProjectedItemTypeExpression.$type]: validateProjectedItemType,
  [AST.TypeProperty.$type]: validateTypeProperty,
  [AST.NamedTypeReference.$type]: validateNamedTypeReference,
  [AST.ParameterDeclaration.$type]: validateParameter,
  [AST.ParameterizedDeclaration.$type]: validateDefaultParameterOrder,
  [AST.TypedConstructor.$type]: validateTypedConstructor,
  [AST.CopyExpression.$type]: validateCopyExpression,
  ...configuredItemValidationChecks,
  [AST.MemberAccessExpression.$type]: validateMemberAccess,
} satisfies NodeValidationChecks

function validateTypeDeclaration(declaration: AST.TypeDeclaration, ctx: ValidationContext): void {
  if (typeDefinitionHasCycle(declaration, declaration, new Set())) {
    ctx.error(declaration, typeValidationMessages.cyclicType(Type.definitionName(declaration)))
  }
}

function validateParameter(parameter: AST.ParameterDeclaration, ctx: ValidationContext): void {
  if (parameter.inlineType && typeDefinitionHasCycle(parameter.inlineType, parameter.inlineType, new Set())) {
    ctx.error(parameter.inlineType, typeValidationMessages.cyclicType(Type.definitionName(parameter.inlineType)))
  }
  if (parameter.copy && isUnsupportedCopyValueType(Type.ofParameter(parameter))) {
    ctx.error(parameter, typeValidationMessages.copyUnsupportedValue(copyValueTypeName(Type.ofParameter(parameter))))
  }
  if (!parameter.defaultValue) {
    return
  }
  const expected = Type.ofParameter(parameter)
  const actual = Type.ofExpression(parameter.defaultValue)
  if (expected.kind !== 'unresolved' && actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
    ctx.error(
      parameter.defaultValue,
      typeValidationMessages.defaultParameterType(
        Type.parameterName(parameter),
        Type.displayName(expected),
        Type.displayName(actual),
      ),
    )
  }
}

function validateDefaultParameterOrder(declaration: AST.ParameterizedDeclaration, ctx: ValidationContext): void {
  let foundDefault = false
  for (const parameter of AST.parametersOf(declaration)) {
    if (parameter.defaultValue !== undefined) {
      foundDefault = true
      continue
    }
    if (foundDefault) {
      ctx.error(parameter, typeValidationMessages.defaultParameterOrder(Type.parameterName(parameter)))
    }
  }
}

function validateItemType(type: AST.ItemTypeExpression, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const property of type.properties) {
    if (seen.has(property.name)) {
      ctx.error(property, typeValidationMessages.duplicateItemField(property.name))
      continue
    }
    seen.add(property.name)
  }
}

function validateProjectedItemType(type: AST.ProjectedItemTypeExpression, ctx: ValidationContext): void {
  const base = Type.ofReference(type.base)
  if (base.kind !== 'entity') {
    ctx.error(type.base, typeValidationMessages.projectedItemBase())
    return
  }
  const selected = type.fields.length > 0 ? type.fields : type.excludedFields
  const seen = new Set<string>()
  for (const name of selected) {
    if (seen.has(name)) {
      ctx.error(type, typeValidationMessages.duplicateProjectedItemField(name))
      continue
    }
    seen.add(name)
    if (!Type.dataFields(base.entity).some(field => field.name === name)) {
      ctx.error(type, typeValidationMessages.projectedItemField(Type.dataEntityName(base.entity), name))
    }
  }
}

function validateCopyExpression(copy: AST.CopyExpression, ctx: ValidationContext): void {
  const source = Type.ofExpression(copy.value)
  if (isUnsupportedCopyValueType(source)) {
    ctx.error(copy, typeValidationMessages.copyUnsupportedValue(copyValueTypeName(source)))
    return
  }
  if (!copy.type) {
    return
  }
  const target = Type.ofReference(copy.type)
  const entity = Type.projectedEntityOf(target)
  if (!entity) {
    if (!Type.isCastCompatible(source, target)) {
      ctx.error(copy.value, typeValidationMessages.typeFixIncompatible(Type.displayName(target)))
    }
    return
  }
  if (source.kind === 'entity') {
    if (source.entity !== entity) {
      ctx.error(
        copy.value,
        typeValidationMessages.copyInputSource(Type.displayName(target), Type.dataEntityName(entity)),
      )
    }
    return
  }
  const sourceEntity = Type.projectedEntityOf(source)
  if (sourceEntity && sourceEntity !== entity) {
    ctx.error(copy.value, typeValidationMessages.copyInputSource(Type.displayName(target), Type.dataEntityName(entity)))
    return
  }
  if (source.kind !== 'item' || !source.item) {
    ctx.error(copy.value, typeValidationMessages.copyInputSource(Type.displayName(target), Type.dataEntityName(entity)))
    return
  }
  if (target.kind !== 'item' || !target.item) {
    return
  }
  for (const targetField of target.item.dataFields ?? []) {
    const sourceField = Type.itemFields(source.item).find(field => field.name === targetField.name)
    if (!sourceField || !Type.isAssignable(Type.itemFieldType(sourceField), Type.dataFieldType(targetField))) {
      ctx.error(copy.value, typeValidationMessages.copyInputField(Type.displayName(target), targetField.name))
    }
  }
}

function isUnsupportedCopyValueType(type: ASTUtils.TaoType): boolean {
  return type.kind === 'primitive'
    && ['app', 'data', 'datasource', 'design', 'nav', 'scene', 'view'].includes(type.primitive)
}

function copyValueTypeName(type: ASTUtils.TaoType): string {
  return type.kind === 'primitive' ? type.primitive : Type.displayName(type)
}

function validateDerivedType(derived: AST.DerivedTypeExpression, ctx: ValidationContext): void {
  if (AST.isTypeDeclaration(derived.$container) && AST.isConfigurableDeclaration(derived.$container)) {
    return
  }
  const base = Type.ofReference(derived.base)
  if (base.kind === 'unresolved') {
    return
  }
  // Numeric with-bodies carry directly owned unit tables. Their shape and scales are checked
  // by the numeric-units validator rather than the item-slot inheritance rules below.
  if (base.kind === 'primitive' && base.primitive === 'numeric') {
    return
  }
  if (
    base.kind === 'primitive' && ['text', 'number'].includes(base.primitive)
    && derived.slots.properties.length === 0
    && (derived.slots.methods.length > 0 || derived.slots.converters.length > 0)
  ) {
    return
  }
  if (base.kind !== 'item' || !base.item) {
    ctx.error(derived.base, typeValidationMessages.derivedBaseShape(Type.referenceName(derived.base)))
    return
  }
  for (const slot of derived.slots.properties) {
    const baseSlot = base.item.properties.find(candidate => candidate.name === slot.name)
    if (!baseSlot) {
      continue
    }
    if (baseSlot.value && !slot.value) {
      ctx.error(slot, typeValidationMessages.derivedSlotReopened(slot.name))
      continue
    }
    const expected = slotConstraintType(baseSlot)
    const actual = slotConstraintType(slot)
    if (
      expected.kind !== 'unresolved'
      && actual.kind !== 'unresolved'
      && !Type.isAssignable(actual, expected)
    ) {
      ctx.error(
        slot,
        typeValidationMessages.derivedSlotType(
          slot.name,
          Type.displayName(expected),
          Type.displayName(actual),
        ),
      )
    }
  }
}

function slotConstraintType(slot: AST.TypeProperty): ASTUtils.TaoType {
  if (slot.type) {
    return Type.ofReference(slot.type)
  }
  return slot.value ? Type.ofExpression(slot.value) : Type.ofProperty(slot)
}

function validateTypeProperty(property: AST.TypeProperty, ctx: ValidationContext): void {
  if (property.optional && !property.type) {
    ctx.error(property, typeValidationMessages.optionalFieldType(property.name))
    return
  }
  if (property.optional && property.value) {
    ctx.error(property.value, typeValidationMessages.optionalFieldDefault(property.name))
    return
  }
  const itemOwner = property.$container.$container
  if (AST.isPrimitiveDeclaration(itemOwner) && property.name === 'implement' && !property.type && !property.value) {
    return
  }
  if (!property.type && !property.value && Type.ofProperty(property).kind === 'unresolved') {
    ctx.error(property, typeValidationMessages.unknownType(property.name))
    return
  }
  if (!property.type || !property.value) {
    return
  }
  const expected = Type.ofReference(property.type)
  const actual = Type.ofExpression(property.value)
  const defaultIsAbsent = actual.kind === 'primitive' && actual.primitive === 'none'
  if (
    !defaultIsAbsent
    && expected.kind !== 'unresolved'
    && actual.kind !== 'unresolved'
    && !Type.isAssignable(actual, expected)
  ) {
    ctx.error(
      property.value,
      typeValidationMessages.slotDefaultType(
        property.name,
        Type.displayName(expected),
        Type.displayName(actual),
      ),
    )
  }
}

function validateNamedTypeReference(reference: AST.NamedTypeReference, ctx: ValidationContext): void {
  if (
    (AST.isConfigurationPropertyDeclaration(reference.$container) || AST.isTypeProperty(reference.$container))
    && AST.configurationPropertyIsKey(reference.$container)
  ) {
    return
  }
  if (Type.entityOfReference(reference)) {
    return
  }
  const root = Type.rootOfReference(reference)
  if (!root.definition) {
    if (Type.ofReference(reference).kind !== 'unresolved') {
      return
    }
    ctx.error(reference, typeValidationMessages.unknownType(Type.referenceName(reference)))
    return
  }

  let currentDefinition = root.definition
  for (const member of root.remainingMembers) {
    const currentType = Type.ofDefinition(currentDefinition)
    if (currentType.kind !== 'item' || !currentType.item) {
      ctx.error(reference, typeValidationMessages.memberNotItem(member))
      return
    }
    const property = currentType.item.properties.find(candidate => candidate.name === member)
    if (!property) {
      ctx.error(reference, typeValidationMessages.unknownMember(Type.definitionName(currentDefinition), member))
      return
    }
    currentDefinition = property
  }
}

function validateTypedConstructor(constructor: AST.TypedConstructor, ctx: ValidationContext): void {
  const expected = Type.ofConstructorReference(constructor.type)
  if (expected.kind === 'unresolved') {
    return
  }
  if (Type.isAbstractDomain(expected)) {
    ctx.error(
      constructor,
      typeValidationMessages.abstractTypeConstruction(Type.referenceName(constructor.type)),
    )
    return
  }
  const expectedKind = constructorLiteralKind(expected)
  Switch.type(constructor.value, {
    ItemLiteral: value => {
      validateConstructorKind(constructor, expectedKind === 'item', expectedKind, ctx)
      if (expected.kind !== 'item') {
        return
      }
      if (!expected.item) {
        if (value.properties.length > 0) {
          ctx.error(
            value,
            typeValidationMessages.shapelessItemConstructor(
              Type.referenceName(constructor.type),
            ),
          )
        }
        return
      }
      validateItemConstructor(value, expected.item, ctx)
    },
    ListLiteral: () => validateConstructorKind(constructor, expectedKind === 'list', expectedKind, ctx),
    NumberLiteral: () => validateConstructorKind(constructor, expectedKind === 'number', expectedKind, ctx),
    StringLiteral: () => validateConstructorKind(constructor, expectedKind === 'text', expectedKind, ctx),
  })
}

function validateConstructorKind(
  constructor: AST.TypedConstructor,
  valid: boolean,
  expected: string,
  ctx: ValidationContext,
): void {
  if (!valid) {
    ctx.error(
      constructor,
      typeValidationMessages.constructorShape(Type.referenceName(constructor.type), expected),
    )
  }
}

function validateItemConstructor(
  item: AST.ItemLiteral,
  expected: ASTUtils.ItemShape,
  ctx: ValidationContext,
): void {
  const result = ASTUtils.resolveItemPropertyBindings(Type.itemFields(expected), item.properties)
  for (const diagnostic of result.diagnostics) {
    Switch.kind(diagnostic, {
      'missing-property': diagnostic => {
        ctx.error(item, typeValidationMessages.missingProperty(diagnostic.expected.name))
      },
      'unmatched-property': diagnostic => {
        ctx.error(diagnostic.property, typeValidationMessages.unmatchedProperty)
      },
      'ambiguous-property': diagnostic => {
        ctx.error(
          diagnostic.property,
          typeValidationMessages.ambiguousProperty(diagnostic.expected.map(property => property.name)),
        )
      },
      'ambiguous-field': diagnostic => {
        ctx.error(item, typeValidationMessages.ambiguousField(diagnostic.expected.name))
      },
      'duplicate-provided-property-type': diagnostic => {
        ctx.error(diagnostic.property, typeValidationMessages.duplicateProvidedPropertyType)
      },
      'duplicate-property-type': diagnostic => {
        ctx.error(item, typeValidationMessages.duplicatePropertyType(diagnostic.expected.name))
      },
      'unknown-named-property': diagnostic => {
        ctx.error(diagnostic.property, typeValidationMessages.unknownNamedProperty(diagnostic.name))
      },
      'duplicate-named-property': diagnostic => {
        ctx.error(diagnostic.property, typeValidationMessages.duplicateNamedProperty(diagnostic.expected.name))
      },
      'named-property-type': diagnostic => {
        ctx.error(
          diagnostic.property,
          typeValidationMessages.namedPropertyType(
            diagnostic.expected.name,
            Type.displayName(Type.itemFieldType(diagnostic.expected)),
            Type.displayName(Type.ofExpression(diagnostic.property.value)),
          ),
        )
      },
    })
  }
}

function typeDefinitionHasCycle(
  root: AST.TypeDefinition,
  current: AST.TypeDefinition,
  seen: Set<AST.TypeDefinition>,
): boolean {
  return typeDefinitionReferencesRoot(root, current, new Set(seen))
}

function typeDefinitionReferencesRoot(
  root: AST.TypeDefinition,
  current: AST.TypeDefinition,
  seen: Set<AST.TypeDefinition>,
): boolean {
  if (seen.has(current)) {
    return typeDefinitionOwnedBy(current, root)
  }
  seen.add(current)
  if (AST.isTypeDeclaration(current)) {
    const aliasTarget = current.aliasTarget?.member.ref
    if (AST.isTypeDeclaration(aliasTarget)) {
      return typeDefinitionReferencesRoot(root, aliasTarget, seen)
    }
    return current.type ? typeExpressionReferencesRoot(root, current.type, seen) : false
  }
  if (AST.isParameterTypeDeclaration(current)) {
    return typeExpressionReferencesRoot(root, current.type, seen)
  }
  const propertyType = current.type
  if (propertyType) {
    return typeReferenceReferencesRoot(root, propertyType, seen)
  }
  if (current.value) {
    return false
  }
  const shorthandType = Type.shorthandPropertyDefinition(current)
  return shorthandType ? typeDefinitionReferencesRoot(root, shorthandType, seen) : false
}

function typeExpressionReferencesRoot(
  root: AST.TypeDefinition,
  type: AST.TypeExpression | AST.CapabilityTypeExpression,
  seen: Set<AST.TypeDefinition>,
): boolean {
  // Callable domains/results may refer to their owner; this is not a stored-value type cycle.
  if (AST.isCapabilityTypeExpression(type)) {
    return false
  }
  if (AST.isItemTypeExpression(type)) {
    return type.properties.some(property => typeDefinitionReferencesRoot(root, property, new Set(seen)))
  }
  if (AST.isUnionTypeExpression(type)) {
    return type.members.some(member => typeReferenceReferencesRoot(root, member, new Set(seen)))
  }
  if (AST.isDerivedTypeExpression(type)) {
    return typeReferenceReferencesRoot(root, type.base, new Set(seen))
      || type.slots.properties.some(property => typeDefinitionReferencesRoot(root, property, new Set(seen)))
  }
  if (AST.isProjectedItemTypeExpression(type)) {
    return typeReferenceReferencesRoot(root, type.base, seen)
  }
  if (AST.isCaseSetTypeExpression(type) || AST.isYesNoTypeExpression(type)) {
    return false
  }
  return typeReferenceReferencesRoot(root, type, seen)
}

function typeReferenceReferencesRoot(
  root: AST.TypeDefinition,
  type: AST.TypeReference,
  seen: Set<AST.TypeDefinition>,
): boolean {
  return Switch.type(type, {
    ActionTypeReference: type =>
      type.parameterTypes.some(parameter => typeReferenceReferencesRoot(root, parameter, new Set(seen))),
    ListTypeReference: type => typeReferenceReferencesRoot(root, type.elementType, new Set(seen)),
    NamedTypeReference: type => {
      const target = Type.definitionOfReference(type)
      if (!target) {
        return false
      }
      if (target === root) {
        return true
      }
      return typeDefinitionReferencesRoot(root, target, seen)
    },
    PrimitiveTypeReference: () => false,
    YesNoTypeExpression: () => false,
  })
}

function typeDefinitionOwnedBy(definition: AST.TypeDefinition, root: AST.TypeDefinition): boolean {
  if (definition === root) {
    return true
  }
  return AST.isTypeProperty(definition) && typePropertyOwner(definition) === root
}

function typePropertyOwner(property: AST.TypeProperty): AST.TypeDefinition | undefined {
  const owner = property.$container.$container
  return AST.isTypeDeclaration(owner) || AST.isParameterTypeDeclaration(owner) ? owner : undefined
}

function validateMemberAccess(memberAccess: AST.MemberAccessExpression, ctx: ValidationContext): void {
  let current = Type.ofReferenceRoot(memberAccess)
  if (current.kind === 'unresolved') {
    return
  }
  let typeName = Type.displayName(current)
  const parent = memberAccess.$container
  const action = ASTUtils.resolveAssociatedActionTarget(memberAccess)
  const members = action?.associated?.receiver.kind === 'member-path'
    ? action.associated.receiver.members
    : AST.isMethodCallExpression(parent) && parent.callee === memberAccess
    ? memberAccess.members.slice(0, -1)
    : memberAccess.members
  for (const member of members) {
    if (
      (current.kind === 'list' || (current.kind === 'primitive' && current.primitive === 'text')) && member === 'Count'
    ) {
      current = { kind: 'primitive', primitive: 'number' }
      typeName = 'number'
      continue
    }
    const unitFamily = Type.unitFamilyOf(current)
    if (unitFamily) {
      const memberType = Type.unitMemberType(unitFamily, member)
      if (!memberType) {
        ctx.error(memberAccess, typeValidationMessages.unknownMember(typeName, member))
        return
      }
      current = memberType
      typeName = Type.displayName(current)
      continue
    }
    const completeness = Type.completenessFieldsOf(current) && Type.completenessMemberType(member)
    if (completeness) {
      current = completeness
      typeName = Type.displayName(current)
      continue
    }
    if (current.kind === 'entity') {
      if (member === 'Id') {
        current = { kind: 'primitive', primitive: 'text' }
        typeName = 'text'
        continue
      }
      const builtin = Type.entityBuiltinMemberType(member)
      if (builtin) {
        current = builtin
        typeName = Type.displayName(current)
        continue
      }
      const field = Type.dataFields(current.entity).find(candidate => candidate.name === member)
      if (!field) {
        ctx.error(memberAccess, typeValidationMessages.unknownMember(typeName, member))
        return
      }
      current = Type.dataFieldValueType(field)
      typeName = Type.displayName(current)
      continue
    }
    if (current.kind !== 'item' || !current.item) {
      ctx.error(memberAccess, typeValidationMessages.memberNotItem(member))
      return
    }
    const property = Type.itemFields(current.item).find(candidate => candidate.name === member)
    if (!property) {
      ctx.error(memberAccess, typeValidationMessages.unknownMember(typeName, member))
      return
    }
    current = AST.isEntityDataField(property) ? Type.dataFieldValueType(property) : Type.ofPropertyRead(property)
    if (current.kind === 'unresolved') {
      return
    }
    typeName = Type.displayName(current)
  }
}
