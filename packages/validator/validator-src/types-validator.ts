import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import type { ValidationContext } from './validation'

/** typeValidationMessages declares diagnostics for custom types, constructors is item, and member access. */
export const typeValidationMessages = {
  unknownType: (name: string) => `Unknown type '${name}'.`,
  duplicateItemField: (name: string) => `Item field '${name}' is declared more than once.`,
  constructorShape: (type: string, expected: string) => `Typed constructor '${type}' expects a ${expected} literal.`,
  shapelessItemConstructor: (type: string) =>
    `Typed constructor '${type}' cannot accept fields because its item type has no declared shape.`,
  typeFixIncompatible: (type: string) => `Value cannot be type-fixed as '${type}'.`,
  missingProperty: (name: string) => `Item constructor is missing required field '${name}'.`,
  unmatchedProperty: 'Item constructor value does not match any unbound field by type.',
  ambiguousProperty: (names: readonly string[]) =>
    `Item constructor value matches multiple fields by type: ${names.join(', ')}.`,
  ambiguousField: (name: string) => `Item constructor has multiple values that match field '${name}' by type.`,
  duplicatePropertyType: (name: string) => `Item type has more than one field with the same type near '${name}'.`,
  duplicateProvidedPropertyType: 'Item constructor has more than one value with the same exact type.',
  cyclicType: (name: string) => `Type '${name}' cannot reference itself through its type definition.`,
  memberNotItem: (name: string) => `Cannot access member '${name}' on a non-item value.`,
  unknownMember: (type: string, name: string) => `Item type '${type}' has no field '${name}'.`,
} as const

/** validateTypes validates custom type declarations and item/list/custom expression forms. */
export function validateTypes(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const declaration of AST.streamAllContents(file).filter(AST.isTypeDeclaration)) {
    validateTypeDeclaration(declaration, ctx)
  }
  for (const type of AST.streamAllContents(file).filter(AST.isItemTypeExpression)) {
    validateItemType(type, ctx)
  }
  for (const property of AST.streamAllContents(file).filter(AST.isTypeProperty)) {
    validateTypeProperty(property, ctx)
  }
  for (const reference of AST.streamAllContents(file).filter(AST.isNamedTypeReference)) {
    validateNamedTypeReference(reference, ctx)
  }
  for (const parameter of AST.streamAllContents(file).filter(AST.isParameterDeclaration)) {
    validateParameter(parameter, ctx)
  }
  for (const argument of AST.streamAllContents(file).filter(AST.isArgument)) {
    validateTypedArgument(argument, ctx)
  }
  for (const constructor of AST.streamAllContents(file).filter(AST.isTypedConstructor)) {
    validateTypedConstructor(constructor, ctx)
  }
  for (const memberAccess of AST.streamAllContents(file).filter(AST.isMemberAccessExpression)) {
    validateMemberAccess(memberAccess, ctx)
  }
}

function validateTypeDeclaration(declaration: AST.TypeDeclaration, ctx: ValidationContext): void {
  if (typeDefinitionHasCycle(declaration, declaration, new Set())) {
    ctx.error(typeValidationMessages.cyclicType(Type.definitionName(declaration)), declaration)
  }
}

function validateParameter(parameter: AST.ParameterDeclaration, ctx: ValidationContext): void {
  if (!parameter.inlineType) {
    return
  }
  if (typeDefinitionHasCycle(parameter.inlineType, parameter.inlineType, new Set())) {
    ctx.error(typeValidationMessages.cyclicType(Type.definitionName(parameter.inlineType)), parameter.inlineType)
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

function validateTypeProperty(property: AST.TypeProperty, ctx: ValidationContext): void {
  if (!property.type && Type.ofProperty(property).kind === 'unresolved') {
    ctx.error(typeValidationMessages.unknownType(property.name), property)
  }
}

function validateNamedTypeReference(reference: AST.NamedTypeReference, ctx: ValidationContext): void {
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

function validateTypedArgument(argument: AST.Argument, ctx: ValidationContext): void {
  if (!argument.type) {
    return
  }
  if (AST.isItemLiteral(argument.value)) {
    validateTypedItemLiteral(argument.value, argument.type, ctx)
    return
  }
  validateValueCanBeFixedAs(argument.value, argument.type, argument, ctx)
}

function validateValueCanBeFixedAs(
  value: AST.Expression,
  type: AST.TypeReference,
  node: AST.Node,
  ctx: ValidationContext,
): void {
  const actual = Type.ofExpression(value)
  const target = Type.ofReference(type)
  if (actual.kind === 'unresolved' || target.kind === 'unresolved') {
    return
  }
  if (!Type.isCastCompatible(actual, target)) {
    ctx.error(typeValidationMessages.typeFixIncompatible(Type.referenceName(type)), node)
  }
}

function validateTypedConstructor(constructor: AST.TypedConstructor, ctx: ValidationContext): void {
  const expected = Type.ofConstructorReference(constructor.type)
  if (expected.kind === 'unresolved') {
    return
  }
  const expectedKind = constructorLiteralKind(expected)
  if (AST.isStringLiteral(constructor.value)) {
    validateConstructorKind(constructor, expectedKind === 'text', expectedKind, ctx)
    return
  }
  if (AST.isNumberLiteral(constructor.value)) {
    validateConstructorKind(constructor, expectedKind === 'number', expectedKind, ctx)
    return
  }
  if (AST.isListLiteral(constructor.value)) {
    validateConstructorKind(constructor, expectedKind === 'list', expectedKind, ctx)
    return
  }
  validateConstructorKind(constructor, expectedKind === 'item', expectedKind, ctx)
  if (expected.kind !== 'item') {
    return
  }
  if (!expected.item) {
    if (constructor.value.properties.length > 0) {
      ctx.error(
        typeValidationMessages.shapelessItemConstructor(
          Type.referenceName(constructor.type),
        ),
        constructor.value,
      )
    }
    return
  }
  validateItemConstructor(constructor.value, expected.item, ctx)
}

function validateTypedItemLiteral(item: AST.ItemLiteral, type: AST.TypeReference, ctx: ValidationContext): void {
  const expected = Type.ofReference(type)
  if (expected.kind === 'unresolved') {
    return
  }
  if (expected.kind !== 'item') {
    ctx.error(typeValidationMessages.constructorShape(Type.referenceName(type), constructorLiteralKind(expected)), item)
    return
  }
  if (!expected.item) {
    if (item.properties.length > 0) {
      ctx.error(typeValidationMessages.shapelessItemConstructor(Type.referenceName(type)), item)
    }
    return
  }
  validateItemConstructor(item, expected.item, ctx)
}

function constructorLiteralKind(type: ASTUtils.TaoType): string {
  if (type.kind === 'primitive') {
    return type.primitive
  }
  return type.kind
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
  expected: AST.ItemTypeExpression,
  ctx: ValidationContext,
): void {
  const result = ASTUtils.resolveItemPropertyBindings(expected.properties, item.properties)
  for (const diagnostic of result.diagnostics) {
    if (diagnostic.kind === 'missing-property') {
      ctx.error(typeValidationMessages.missingProperty(diagnostic.expected.name), item)
      continue
    }
    if (diagnostic.kind === 'unmatched-property') {
      ctx.error(typeValidationMessages.unmatchedProperty, diagnostic.property)
      continue
    }
    if (diagnostic.kind === 'ambiguous-property') {
      ctx.error(
        typeValidationMessages.ambiguousProperty(diagnostic.expected.map(property => property.name)),
        diagnostic.property,
      )
      continue
    }
    if (diagnostic.kind === 'ambiguous-field') {
      ctx.error(typeValidationMessages.ambiguousField(diagnostic.expected.name), item)
      continue
    }
    if (diagnostic.kind === 'duplicate-provided-property-type') {
      ctx.error(typeValidationMessages.duplicateProvidedPropertyType, diagnostic.property)
      continue
    }
    ctx.error(typeValidationMessages.duplicatePropertyType(diagnostic.expected.name), item)
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
    return typeExpressionReferencesRoot(root, current.type, seen)
  }
  if (AST.isParameterTypeDeclaration(current)) {
    return typeExpressionReferencesRoot(root, current.type, seen)
  }
  const propertyType = current.type
  if (propertyType) {
    return typeReferenceReferencesRoot(root, propertyType, seen)
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
  return typeReferenceReferencesRoot(root, type, seen)
}

function typeReferenceReferencesRoot(
  root: AST.TypeDefinition,
  type: AST.TypeReference,
  seen: Set<AST.TypeDefinition>,
): boolean {
  if (AST.isPrimitiveTypeReference(type)) {
    return false
  }
  const target = Type.definitionOfReference(type)
  if (!target) {
    return false
  }
  if (target === root) {
    return true
  }
  return typeDefinitionReferencesRoot(root, target, seen)
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
    if (current.kind !== 'item' || !current.item) {
      ctx.error(typeValidationMessages.memberNotItem(member), memberAccess)
      return
    }
    const property = current.item.properties.find(candidate => candidate.name === member)
    if (!property) {
      ctx.error(typeValidationMessages.unknownMember(typeName, member), memberAccess)
      return
    }
    current = Type.ofProperty(property)
    if (current.kind === 'unresolved') {
      return
    }
    typeName = Type.displayName(current)
  }
}

function declarationType(declaration: AST.ValueDeclaration | undefined): ASTUtils.TaoType {
  if (AST.isParameterDeclaration(declaration)) {
    return Type.ofParameter(declaration)
  }
  if (AST.isAliasDeclaration(declaration)) {
    return Type.ofExpression(declaration.value)
  }
  if (AST.isStateDeclaration(declaration)) {
    return Type.ofExpression(declaration.value)
  }
  if (AST.isActionDeclaration(declaration)) {
    return { kind: 'primitive', primitive: 'action' }
  }
  return { kind: 'unresolved' }
}
