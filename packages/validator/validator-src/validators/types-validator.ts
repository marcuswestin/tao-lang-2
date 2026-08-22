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
  unknownType: (name: string) => `Unknown type '${name}'.`,
  duplicateItemField: (name: string) => `Item field '${name}' is declared more than once.`,
  slotDefaultType: (name: string, expected: string, actual: string) =>
    `Default for slot '${name}' expects ${expected}, got ${actual}.`,
  derivedBaseShape: (name: string) => `Derived type base '${name}' has no item slot shape.`,
  derivedSlotReopened: (name: string) => `Derived slot '${name}' cannot reopen a filled base slot.`,
  derivedSlotType: (name: string, expected: string, actual: string) =>
    `Derived slot '${name}' must narrow ${expected}, got ${actual}.`,
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
  [AST.TypeDeclaration.$type]: validateTypeDeclaration,
  [AST.DerivedTypeExpression.$type]: validateDerivedType,
  [AST.ItemTypeExpression.$type]: validateItemType,
  [AST.TypeProperty.$type]: validateTypeProperty,
  [AST.NamedTypeReference.$type]: validateNamedTypeReference,
  [AST.ParameterDeclaration.$type]: validateParameter,
  [AST.ParameterizedDeclaration.$type]: validateDefaultParameterOrder,
  [AST.TypedConstructor.$type]: validateTypedConstructor,
  ...configuredItemValidationChecks,
  [AST.MemberAccessExpression.$type]: validateMemberAccess,
} satisfies NodeValidationChecks

function validateTypeDeclaration(declaration: AST.TypeDeclaration, ctx: ValidationContext): void {
  if (typeDefinitionHasCycle(declaration, declaration, new Set())) {
    ctx.error(typeValidationMessages.cyclicType(Type.definitionName(declaration)), declaration)
  }
}

function validateParameter(parameter: AST.ParameterDeclaration, ctx: ValidationContext): void {
  if (parameter.inlineType && typeDefinitionHasCycle(parameter.inlineType, parameter.inlineType, new Set())) {
    ctx.error(typeValidationMessages.cyclicType(Type.definitionName(parameter.inlineType)), parameter.inlineType)
  }
  if (!parameter.defaultValue) {
    return
  }
  const expected = Type.ofParameter(parameter)
  const actual = Type.ofExpression(parameter.defaultValue)
  if (expected.kind !== 'unresolved' && actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
    ctx.error(
      typeValidationMessages.defaultParameterType(
        Type.parameterName(parameter),
        Type.displayName(expected),
        Type.displayName(actual),
      ),
      parameter.defaultValue,
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
      ctx.error(typeValidationMessages.defaultParameterOrder(Type.parameterName(parameter)), parameter)
    }
  }
}

function validateItemType(type: AST.ItemTypeExpression, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const property of type.properties) {
    if (seen.has(property.name)) {
      ctx.error(typeValidationMessages.duplicateItemField(property.name), property)
      continue
    }
    seen.add(property.name)
  }
}

function validateDerivedType(derived: AST.DerivedTypeExpression, ctx: ValidationContext): void {
  if (AST.isTypeDeclaration(derived.$container) && AST.isConfigurableDeclaration(derived.$container)) {
    return
  }
  const base = Type.ofReference(derived.base)
  if (base.kind === 'unresolved') {
    return
  }
  if (base.kind !== 'item' || !base.item) {
    ctx.error(typeValidationMessages.derivedBaseShape(Type.referenceName(derived.base)), derived.base)
    return
  }
  for (const slot of derived.slots.properties) {
    const baseSlot = base.item.properties.find(candidate => candidate.name === slot.name)
    if (!baseSlot) {
      continue
    }
    if (baseSlot.value && !slot.value) {
      ctx.error(typeValidationMessages.derivedSlotReopened(slot.name), slot)
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
        typeValidationMessages.derivedSlotType(
          slot.name,
          Type.displayName(expected),
          Type.displayName(actual),
        ),
        slot,
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
    ctx.error(typeValidationMessages.optionalFieldType(property.name), property)
    return
  }
  if (property.optional && property.value) {
    ctx.error(typeValidationMessages.optionalFieldDefault(property.name), property.value)
    return
  }
  const itemOwner = property.$container.$container
  if (AST.isPrimitiveDeclaration(itemOwner) && property.name === 'implement' && !property.type && !property.value) {
    return
  }
  if (!property.type && !property.value && Type.ofProperty(property).kind === 'unresolved') {
    ctx.error(typeValidationMessages.unknownType(property.name), property)
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
      typeValidationMessages.slotDefaultType(
        property.name,
        Type.displayName(expected),
        Type.displayName(actual),
      ),
      property.value,
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
    ctx.error(typeValidationMessages.unknownType(Type.referenceName(reference)), reference)
    return
  }

  let currentDefinition = root.definition
  for (const member of root.remainingMembers) {
    const currentType = Type.ofDefinition(currentDefinition)
    if (currentType.kind !== 'item' || !currentType.item) {
      ctx.error(typeValidationMessages.memberNotItem(member), reference)
      return
    }
    const property = currentType.item.properties.find(candidate => candidate.name === member)
    if (!property) {
      ctx.error(typeValidationMessages.unknownMember(Type.definitionName(currentDefinition), member), reference)
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
            typeValidationMessages.shapelessItemConstructor(
              Type.referenceName(constructor.type),
            ),
            value,
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
      typeValidationMessages.constructorShape(Type.constructorReferenceName(constructor.type), expected),
      constructor,
    )
  }
}

function validateItemConstructor(
  item: AST.ItemLiteral,
  expected: ASTUtils.ItemShape,
  ctx: ValidationContext,
): void {
  const result = ASTUtils.resolveItemPropertyBindings(expected.properties, item.properties)
  for (const diagnostic of result.diagnostics) {
    Switch.kind(diagnostic, {
      'missing-property': diagnostic => {
        ctx.error(typeValidationMessages.missingProperty(diagnostic.expected.name), item)
      },
      'unmatched-property': diagnostic => {
        ctx.error(typeValidationMessages.unmatchedProperty, diagnostic.property)
      },
      'ambiguous-property': diagnostic => {
        ctx.error(
          typeValidationMessages.ambiguousProperty(diagnostic.expected.map(property => property.name)),
          diagnostic.property,
        )
      },
      'ambiguous-field': diagnostic => {
        ctx.error(typeValidationMessages.ambiguousField(diagnostic.expected.name), item)
      },
      'duplicate-provided-property-type': diagnostic => {
        ctx.error(typeValidationMessages.duplicateProvidedPropertyType, diagnostic.property)
      },
      'duplicate-property-type': diagnostic => {
        ctx.error(typeValidationMessages.duplicatePropertyType(diagnostic.expected.name), item)
      },
      'unknown-named-property': diagnostic => {
        ctx.error(typeValidationMessages.unknownNamedProperty(diagnostic.name), diagnostic.property)
      },
      'duplicate-named-property': diagnostic => {
        ctx.error(typeValidationMessages.duplicateNamedProperty(diagnostic.expected.name), diagnostic.property)
      },
      'named-property-type': diagnostic => {
        ctx.error(
          typeValidationMessages.namedPropertyType(
            diagnostic.expected.name,
            Type.displayName(Type.ofProperty(diagnostic.expected)),
            Type.displayName(Type.ofExpression(diagnostic.property.value)),
          ),
          diagnostic.property,
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
  if (AST.isTypeDeclaration(current) || AST.isParameterTypeDeclaration(current)) {
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
  type: AST.TypeExpression,
  seen: Set<AST.TypeDefinition>,
): boolean {
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
  let current = declarationType(memberAccess.target.ref)
  if (current.kind === 'unresolved') {
    return
  }
  let typeName = Type.displayName(current)
  for (const member of memberAccess.members) {
    if (
      (current.kind === 'list' || (current.kind === 'primitive' && current.primitive === 'text')) && member === 'Count'
    ) {
      current = { kind: 'primitive', primitive: 'number' }
      typeName = 'number'
      continue
    }
    if (current.kind === 'entity') {
      if (member === 'Id') {
        current = { kind: 'primitive', primitive: 'text' }
        typeName = 'text'
        continue
      }
      const field = Type.dataFields(current.entity).find(candidate => candidate.name === member)
      if (!field) {
        ctx.error(typeValidationMessages.unknownMember(typeName, member), memberAccess)
        return
      }
      current = Type.dataFieldType(field)
      typeName = Type.displayName(current)
      continue
    }
    if (current.kind !== 'item' || !current.item) {
      ctx.error(typeValidationMessages.memberNotItem(member), memberAccess)
      return
    }
    const property = current.item.properties.find(candidate => candidate.name === member)
    if (!property) {
      ctx.error(typeValidationMessages.unknownMember(typeName, member), memberAccess)
      return
    }
    current = Type.ofPropertyRead(property)
    if (current.kind === 'unresolved') {
      return
    }
    typeName = Type.displayName(current)
  }
}

function declarationType(declaration: AST.ValueDeclaration | undefined): ASTUtils.TaoType {
  return Switch.typeMaybe<AST.ValueDeclaration | undefined, ASTUtils.TaoType>(declaration, {
    ParameterDeclaration: Type.ofParameter,
    AliasDeclaration: Type.ofValueDeclaration,
    AppDeclaration: Type.ofValueDeclaration,
    AskStatement: Type.ofValueDeclaration,
    StateDeclaration: declaration => Type.ofExpression(declaration.value),
    ActionDeclaration: Type.ofAction,
    CasePayload: () => ({ kind: 'primitive', primitive: 'text' }),
    EntityDataField: field => field.negativeName ? { kind: 'primitive', primitive: 'boolean' } : { kind: 'unresolved' },
    CaseSetCase: caseSetCase => ({ kind: 'enum', declaration: AST.caseSetOwningCase(caseSetCase) }),
    EntityQueryDeclaration: declaration => {
      const entity = Type.queryEntity(declaration)
      return entity ? { kind: 'list', element: { kind: 'entity', entity } } : { kind: 'list' }
    },
    ForStatement: statement => {
      const collection = Type.ofExpression(statement.collection)
      return collection.kind === 'list' ? collection.element ?? { kind: 'unresolved' } : { kind: 'unresolved' }
    },
    DatasourceDeclaration: Type.ofValueDeclaration,
    DesignDeclaration: Type.ofValueDeclaration,
    NavDeclaration: Type.ofValueDeclaration,
    UiDeclaration: () => ({ kind: 'primitive', primitive: 'ui' }),
    undefined: () => ({ kind: 'unresolved' }),
  })
}
