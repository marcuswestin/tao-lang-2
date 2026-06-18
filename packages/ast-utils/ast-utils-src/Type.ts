import { AST } from '@parser'

/** Type exposes static Tao type resolution and compatibility helpers. */
export namespace Type {
  /** TaoType declares the static Tao type shape used by semantic helpers. */
  export type TaoType =
    | { kind: 'primitive'; primitive: 'text' | 'number' | 'action'; nominal?: AST.TypeDefinition }
    | { kind: 'list'; nominal?: AST.TypeDefinition }
    | { kind: 'item'; item?: AST.ItemTypeExpression; nominal?: AST.TypeDefinition }
    | { kind: 'unresolved' }

  /** parameterName returns the value alias introduced by a parameter declaration. */
  export function parameterName(parameter: AST.ParameterDeclaration): string {
    if (parameter.name) {
      return parameter.name
    }
    if (AST.isNamedTypeReference(parameter.type)) {
      return inferredParameterNameFromNamedType(parameter.type)
    }
    return parameter.type.primitive
  }

  /** referenceName returns the source-facing name of a Tao type reference. */
  export function referenceName(type: AST.TypeReference): string {
    if (AST.isPrimitiveTypeReference(type)) {
      return type.primitive
    }
    const root = namedReferenceRootName(type)
    return [root, ...type.members].join('.')
  }

  /** constructorReferenceName returns the source-facing name of a typed constructor's type prefix. */
  export function constructorReferenceName(type: AST.ConstructorTypeReference): string {
    if (type.primitive) {
      return type.primitive
    }
    return type.target ? crossReferenceDisplayName(type.target) : '<unresolved>'
  }

  /** definitionName returns the qualified source-facing name of a type definition. */
  export function definitionName(type: AST.TypeDefinition): string {
    if (AST.isTypeDeclaration(type)) {
      return type.name
    }
    const owner = owningTypeDeclaration(type)
    return owner ? `${owner.name}.${type.name}` : type.name
  }

  /** ofReference resolves a type reference to the Tao type it denotes. */
  export function ofReference(type: AST.TypeReference): TaoType {
    return ofReferenceSeen(type, new Set())
  }

  /** ofConstructorReference resolves a typed constructor's type prefix. */
  export function ofConstructorReference(type: AST.ConstructorTypeReference): TaoType {
    if (type.primitive) {
      return primitiveType(type.primitive)
    }
    const definition = type.target?.ref
    return definition ? ofDefinitionSeen(definition, new Set()) : unresolvedType()
  }

  /** ofParameter resolves a parameter declaration's accepted Tao type. */
  export function ofParameter(parameter: AST.ParameterDeclaration): TaoType {
    return ofReference(parameter.type)
  }

  /** ofExpression resolves the static Tao type of a value expression. */
  export function ofExpression(expression: AST.Expression): TaoType {
    return ofExpressionSeen(expression, new Set())
  }

  /** constructorReferenceItemType resolves a typed constructor type prefix to an item shape, when it has one. */
  export function constructorReferenceItemType(type: AST.ConstructorTypeReference): AST.ItemTypeExpression | undefined {
    return itemShape(ofConstructorReference(type))
  }

  /** ofProperty resolves the expected value type of one item property declaration. */
  export function ofProperty(property: AST.TypeProperty): TaoType {
    return ofDefinition(property)
  }

  /** isAssignable returns whether an actual value type can satisfy an expected parameter/property type. */
  export function isAssignable(actual: TaoType, expected: TaoType): boolean {
    if (!bothTypesResolved(actual, expected) || !typesShareKind(actual, expected)) {
      return false
    }
    if (primitivesDiffer(actual, expected)) {
      return false
    }
    if (nominalOf(expected)) {
      return actualSatisfiesExpectedNominal(actual, expected)
    }
    return true
  }

  /** isCastCompatible returns whether a value can be type-fixed with `as`. */
  export function isCastCompatible(actual: TaoType, target: TaoType): boolean {
    if (!bothTypesResolved(actual, target) || !typesShareKind(actual, target)) {
      return false
    }
    if (primitivesDiffer(actual, target)) {
      return false
    }
    const actualNominal = nominalOf(actual)
    const targetNominal = nominalOf(target)
    if (actualNominal && targetNominal) {
      return nominalsAreCastCompatible(actualNominal, targetNominal)
    }
    return true
  }

  /** identityKey returns a stable identity for exact type matching and duplicate checks. */
  export function identityKey(type: TaoType): string | undefined {
    if (isUnresolvedType(type)) {
      return undefined
    }
    const nominal = nominalOf(type)
    if (nominal) {
      return `${type.kind}:${definitionName(nominal)}`
    }
    if (isPrimitiveKind(type)) {
      return `${type.kind}:${type.primitive}`
    }
    return type.kind
  }

  /** ofMemberAccess resolves the static type reached by a member access expression. */
  export function ofMemberAccess(expression: AST.MemberAccessExpression): TaoType {
    const rootType = valueDeclarationType(expression.target.ref)
    return atMemberPath(rootType, expression.members)
  }

  /** definitionOfReference resolves a named type reference, including qualified item fields. */
  export function definitionOfReference(reference: AST.NamedTypeReference): AST.TypeDefinition | undefined {
    let current = reference.target.ref
    if (!current) {
      return undefined
    }
    for (const member of reference.members) {
      const itemType = itemTypeOfDefinition(current)
      if (!itemType) {
        return undefined
      }
      current = propertyNamed(itemType, member)
      if (!current) {
        return undefined
      }
    }
    return current
  }

  function inferredParameterNameFromNamedType(type: AST.NamedTypeReference): string {
    return lastQualifiedMemberName(type.members) ?? crossReferenceDisplayName(type.target, 'Value')
  }

  function lastQualifiedMemberName(members: readonly string[]): string | undefined {
    return members.at(-1)
  }

  function crossReferenceDisplayName(
    reference: { $refText?: string; ref?: { name?: string } | undefined },
    fallback = '<unresolved>',
  ): string {
    return reference.$refText ?? reference.ref?.name ?? fallback
  }

  function namedReferenceRootName(reference: AST.NamedTypeReference): string {
    return crossReferenceDisplayName(reference.target)
  }

  function isUnresolvedType(type: TaoType): type is Extract<TaoType, { kind: 'unresolved' }> {
    return type.kind === 'unresolved'
  }

  function isPrimitiveKind(type: TaoType): type is Extract<TaoType, { kind: 'primitive' }> {
    return type.kind === 'primitive'
  }

  function isItemKind(type: TaoType): type is Extract<TaoType, { kind: 'item' }> {
    return type.kind === 'item'
  }

  function resolvedItemShape(type: TaoType): AST.ItemTypeExpression | undefined {
    if (!isItemKind(type) || !type.item) {
      return undefined
    }
    return type.item
  }

  function itemShape(type: TaoType): AST.ItemTypeExpression | undefined {
    return isItemKind(type) ? type.item : undefined
  }

  function bothTypesResolved(actual: TaoType, expected: TaoType): boolean {
    return !isUnresolvedType(actual) && !isUnresolvedType(expected)
  }

  function typesShareKind(actual: TaoType, expected: TaoType): boolean {
    return actual.kind === expected.kind
  }

  function primitivesDiffer(actual: TaoType, expected: TaoType): boolean {
    return isPrimitiveKind(actual) && isPrimitiveKind(expected) && actual.primitive !== expected.primitive
  }

  function nominalOf(type: TaoType): AST.TypeDefinition | undefined {
    return isUnresolvedType(type) ? undefined : type.nominal
  }

  function actualSatisfiesExpectedNominal(actual: TaoType, expected: TaoType): boolean {
    const actualNominal = nominalOf(actual)
    const expectedNominal = nominalOf(expected)
    return actualNominal && expectedNominal ? nominalChainReaches(actualNominal, expectedNominal) : false
  }

  function nominalsAreCastCompatible(from: AST.TypeDefinition, target: AST.TypeDefinition): boolean {
    return nominalChainReaches(from, target) || nominalChainReaches(target, from)
  }

  function propertyNamed(itemType: AST.ItemTypeExpression, name: string): AST.TypeProperty | undefined {
    return itemType.properties.find(property => property.name === name)
  }

  function ofReferenceSeen(type: AST.TypeReference, seen: Set<AST.TypeDefinition>): TaoType {
    if (AST.isPrimitiveTypeReference(type)) {
      return primitiveType(type.primitive)
    }
    const definition = definitionOfReference(type)
    return definition ? ofDefinitionSeen(definition, seen) : unresolvedType()
  }

  function ofExpressionSeen(expression: AST.Expression, seenAliases: Set<AST.AliasDeclaration>): TaoType {
    if (AST.isStringLiteral(expression)) {
      return primitiveType('text')
    }
    if (AST.isNumberLiteral(expression)) {
      return primitiveType('number')
    }
    if (AST.isListLiteral(expression)) {
      return { kind: 'list' }
    }
    if (AST.isTypedConstructor(expression)) {
      return ofConstructorReference(expression.type)
    }
    if (AST.isTypeCastExpression(expression)) {
      return ofReference(expression.type)
    }
    if (AST.isMemberAccessExpression(expression)) {
      return ofMemberAccess(expression)
    }
    if (AST.isValueReference(expression)) {
      return valueDeclarationType(expression.target.ref, seenAliases)
    }
    if (AST.isActionExpression(expression)) {
      return primitiveType('action')
    }
    return unresolvedType()
  }

  function valueDeclarationType(
    declaration: AST.ValueDeclaration | undefined,
    seenAliases: Set<AST.AliasDeclaration> = new Set(),
  ): TaoType {
    if (AST.isParameterDeclaration(declaration)) {
      return ofParameter(declaration)
    }
    if (AST.isStateDeclaration(declaration)) {
      return ofExpressionSeen(declaration.value, seenAliases)
    }
    if (AST.isActionDeclaration(declaration)) {
      return primitiveType('action')
    }
    if (AST.isAliasDeclaration(declaration)) {
      if (aliasAlreadySeen(declaration, seenAliases)) {
        return unresolvedType()
      }
      seenAliases.add(declaration)
      return ofExpressionSeen(declaration.value, seenAliases)
    }
    return unresolvedType()
  }

  function aliasAlreadySeen(declaration: AST.AliasDeclaration, seenAliases: Set<AST.AliasDeclaration>): boolean {
    return seenAliases.has(declaration)
  }

  function atMemberPath(root: TaoType, members: readonly string[]): TaoType {
    let current = root
    for (const member of members) {
      const itemType = resolvedItemShape(current)
      if (!itemType) {
        return unresolvedType()
      }
      const property = propertyNamed(itemType, member)
      if (!property) {
        return unresolvedType()
      }
      current = ofProperty(property)
    }
    return current
  }

  function isPrimitiveValueType(primitive: AST.PrimitiveType): primitive is 'text' | 'number' | 'action' {
    return primitive === 'text' || primitive === 'number' || primitive === 'action'
  }

  function isListPrimitive(primitive: AST.PrimitiveType): boolean {
    return primitive === 'list'
  }

  function primitiveType(primitive: AST.PrimitiveType): TaoType {
    if (isPrimitiveValueType(primitive)) {
      return { kind: 'primitive', primitive }
    }
    if (isListPrimitive(primitive)) {
      return { kind: 'list' }
    }
    return { kind: 'item' }
  }

  function unresolvedType(): TaoType {
    return { kind: 'unresolved' }
  }

  function ofDefinition(definition: AST.TypeDefinition): TaoType {
    return ofDefinitionSeen(definition, new Set())
  }

  function ofDefinitionSeen(definition: AST.TypeDefinition, seen: Set<AST.TypeDefinition>): TaoType {
    if (definitionAlreadySeen(definition, seen)) {
      return unresolvedType()
    }
    seen.add(definition)
    if (AST.isTypeDeclaration(definition)) {
      const base = ofExpressionType(definition.type, seen)
      return withNominal(base, definition)
    }
    if (!definition.type) {
      const declaration = visibleTypeDeclaration(definition, definition.name)
      return declaration ? ofDefinitionSeen(declaration, seen) : unresolvedType()
    }
    return withNominal(ofReferenceSeen(definition.type, seen), definition)
  }

  function definitionAlreadySeen(definition: AST.TypeDefinition, seen: Set<AST.TypeDefinition>): boolean {
    return seen.has(definition)
  }

  function ofExpressionType(type: AST.TypeExpression, seen: Set<AST.TypeDefinition>): TaoType {
    if (AST.isItemTypeExpression(type)) {
      return { kind: 'item', item: type }
    }
    return ofReferenceSeen(type, seen)
  }

  function withNominal(type: TaoType, nominal: AST.TypeDefinition): TaoType {
    if (canCarryNominal(type)) {
      return { ...type, nominal }
    }
    return type
  }

  function canCarryNominal(type: TaoType): type is Exclude<TaoType, { kind: 'unresolved' }> {
    return isPrimitiveKind(type) || type.kind === 'list' || isItemKind(type)
  }

  function itemTypeOfDefinition(definition: AST.TypeDefinition): AST.ItemTypeExpression | undefined {
    return itemShape(ofDefinition(definition))
  }

  function nominalChainReaches(
    from: AST.TypeDefinition,
    target: AST.TypeDefinition,
    seen: Set<AST.TypeDefinition> = new Set(),
  ): boolean {
    if (from === target) {
      return true
    }
    if (definitionAlreadySeen(from, seen)) {
      return false
    }
    seen.add(from)
    const parent = parentTypeDefinition(from)
    return parent ? nominalChainReaches(parent, target, seen) : false
  }

  function parentTypeDefinition(definition: AST.TypeDefinition): AST.TypeDefinition | undefined {
    if (AST.isTypeDeclaration(definition)) {
      return namedParentDefinition(definition.type)
    }
    return definition.type ? namedParentDefinition(definition.type) : undefined
  }

  function namedParentDefinition(type: AST.TypeExpression): AST.TypeDefinition | undefined {
    return AST.isNamedTypeReference(type) ? definitionOfReference(type) : undefined
  }

  function visibleTypeDeclaration(node: AST.Node, name: string): AST.TypeDeclaration | undefined {
    const root = findRoot(node)
    if (!AST.isTaoFile(root)) {
      return undefined
    }
    return typeDeclarationsInFile(root).find(type => type.name === name)
  }

  function typeDeclarationsInFile(file: AST.TaoFile): AST.TypeDeclaration[] {
    return [
      ...file.statements.filter(AST.isTypeDeclaration),
      ...file.statements
        .filter(AST.isUseStatement)
        .flatMap(useStatement =>
          useStatement.importedDeclarations.map(reference => reference.ref).filter(AST.isTypeDeclaration)
        ),
    ]
  }

  function owningTypeDeclaration(property: AST.TypeProperty): AST.TypeDeclaration | undefined {
    const itemType = property.$container
    return isTypeDeclarationContainer(itemType.$container) ? itemType.$container : undefined
  }

  function isTypeDeclarationContainer(container: AST.Node): container is AST.TypeDeclaration {
    return AST.isTypeDeclaration(container)
  }

  function findRoot(node: AST.Node): AST.Node {
    let current = node
    while (current.$container) {
      current = current.$container
    }
    return current
  }
}
