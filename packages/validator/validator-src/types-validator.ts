import ASTUtils, { Type } from '@ast-utils'
import { AST } from '@parser'
import type { ValidationContext } from './validation'

/** typeValidationMessages declares diagnostics for custom types, item constructors, and member access. */
export const typeValidationMessages = {
  primitiveParameterAlias: (type: string) => `Primitive parameter '${type}' must declare a value alias with 'as'.`,
  unknownPropertyType: (name: string) => `Item field '${name}' must reference a visible type or declare one with 'is'.`,
  duplicateItemField: (name: string) => `Item field '${name}' is declared more than once.`,
  constructorShape: (type: string, expected: string) => `Typed constructor '${type}.' expects a ${expected} literal.`,
  shapelessItemConstructor: (type: string) =>
    `Typed constructor '${type}.' cannot accept fields because its item type has no declared shape.`,
  castIncompatible: (type: string) => `Value cannot be type-fixed as '${type}'.`,
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
  for (const declaration of ASTUtils.streamAllContents(file).filter(AST.isTypeDeclaration)) {
    validateTypeDeclaration(declaration, ctx)
  }
  for (const type of ASTUtils.streamAllContents(file).filter(AST.isItemTypeExpression)) {
    validateItemType(type, ctx)
  }
  for (const property of ASTUtils.streamAllContents(file).filter(AST.isTypeProperty)) {
    validateTypeProperty(property, ctx)
  }
  for (const parameter of ASTUtils.streamAllContents(file).filter(AST.isParameterDeclaration)) {
    validateParameter(parameter, ctx)
  }
  for (const cast of ASTUtils.streamAllContents(file).filter(AST.isTypeCastExpression)) {
    validateTypeCast(cast, ctx)
  }
  for (const constructor of ASTUtils.streamAllContents(file).filter(AST.isTypedConstructor)) {
    validateTypedConstructor(constructor, ctx)
  }
  for (const memberAccess of ASTUtils.streamAllContents(file).filter(AST.isMemberAccessExpression)) {
    validateMemberAccess(memberAccess, ctx)
  }
}

function validateTypeDeclaration(declaration: AST.TypeDeclaration, ctx: ValidationContext): void {
  if (typeDeclarationHasCycle(declaration, declaration, new Set())) {
    ctx.error(typeValidationMessages.cyclicType(declaration.name), declaration)
  }
}

function validateParameter(parameter: AST.ParameterDeclaration, ctx: ValidationContext): void {
  if (AST.isPrimitiveTypeReference(parameter.type) && !parameter.name) {
    ctx.error(typeValidationMessages.primitiveParameterAlias(parameter.type.primitive), parameter)
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
    ctx.error(typeValidationMessages.unknownPropertyType(property.name), property)
  }
}

function validateTypeCast(cast: AST.TypeCastExpression, ctx: ValidationContext): void {
  const actual = Type.ofExpression(cast.value)
  const target = Type.ofReference(cast.type)
  if (actual.kind === 'unresolved' || target.kind === 'unresolved') {
    return
  }
  if (!Type.isCastCompatible(actual, target)) {
    ctx.error(typeValidationMessages.castIncompatible(Type.referenceName(cast.type)), cast)
  }
}

function validateTypedConstructor(constructor: AST.TypedConstructor, ctx: ValidationContext): void {
  const expected = Type.ofConstructorReference(constructor.type)
  if (expected.kind === 'unresolved') {
    return
  }
  if (AST.isStringLiteral(constructor.value)) {
    validateConstructorKind(constructor, expected.kind === 'primitive' && expected.primitive === 'text', 'text', ctx)
    return
  }
  if (AST.isNumberLiteral(constructor.value)) {
    validateConstructorKind(
      constructor,
      expected.kind === 'primitive' && expected.primitive === 'number',
      'number',
      ctx,
    )
    return
  }
  if (AST.isListLiteral(constructor.value)) {
    validateConstructorKind(constructor, expected.kind === 'list', 'list', ctx)
    return
  }
  validateConstructorKind(constructor, expected.kind === 'item', 'item', ctx)
  if (expected.kind !== 'item') {
    return
  }
  if (!expected.item) {
    if (constructor.value.properties.length > 0) {
      ctx.error(
        typeValidationMessages.shapelessItemConstructor(
          Type.constructorReferenceName(constructor.type),
        ),
        constructor.value,
      )
    }
    return
  }
  validateItemConstructor(constructor.value, expected.item, ctx)
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

function typeDeclarationHasCycle(
  root: AST.TypeDeclaration,
  current: AST.TypeDefinition,
  seen: Set<AST.TypeDefinition>,
): boolean {
  return typeDefinitionReferencesRoot(root, current, new Set(seen))
}

function typeDefinitionReferencesRoot(
  root: AST.TypeDeclaration,
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
  if (!current.type) {
    const declaration = visibleTypeDeclaration(current, current.name)
    return declaration ? typeDefinitionReferencesRoot(root, declaration, seen) : false
  }
  return typeReferenceReferencesRoot(root, current.type, seen)
}

function typeExpressionReferencesRoot(
  root: AST.TypeDeclaration,
  type: AST.TypeExpression,
  seen: Set<AST.TypeDefinition>,
): boolean {
  if (AST.isItemTypeExpression(type)) {
    return type.properties.some(property => typeDefinitionReferencesRoot(root, property, seen))
  }
  return typeReferenceReferencesRoot(root, type, seen)
}

function typeReferenceReferencesRoot(
  root: AST.TypeDeclaration,
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

function typeDefinitionOwnedBy(definition: AST.TypeDefinition, root: AST.TypeDeclaration): boolean {
  if (definition === root) {
    return true
  }
  return AST.isTypeProperty(definition) && definition.$container.$container === root
}

function visibleTypeDeclaration(node: AST.Node, name: string): AST.TypeDeclaration | undefined {
  const root = findRoot(node)
  if (!AST.isTaoFile(root)) {
    return undefined
  }
  return [
    ...root.statements.filter(AST.isTypeDeclaration),
    ...root.statements
      .filter(AST.isUseStatement)
      .flatMap(useStatement =>
        useStatement.importedDeclarations.map(reference => reference.ref).filter(AST.isTypeDeclaration)
      ),
  ].find(type => type.name === name)
}

function findRoot(node: AST.Node): AST.Node {
  let current = node
  while (current.$container) {
    current = current.$container
  }
  return current
}

function validateMemberAccess(memberAccess: AST.MemberAccessExpression, ctx: ValidationContext): void {
  let current = declarationType(memberAccess.target.ref)
  if (current.kind === 'unresolved') {
    return
  }
  let typeName = taoTypeName(current)
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
    typeName = taoTypeName(current)
  }
}

function taoTypeName(type: Type.TaoType): string {
  if (type.kind === 'unresolved') {
    return 'unresolved'
  }
  return type.nominal ? Type.definitionName(type.nominal) : type.kind
}

function declarationType(declaration: AST.ValueDeclaration | undefined): Type.TaoType {
  if (AST.isParameterDeclaration(declaration)) {
    return Type.ofParameter(declaration)
  }
  if (AST.isAliasDeclaration(declaration)) {
    return Type.ofExpression(declaration.value)
  }
  return { kind: 'unresolved' }
}
