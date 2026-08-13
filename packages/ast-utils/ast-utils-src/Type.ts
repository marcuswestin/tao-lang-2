import { AST } from '@parser'
import { Switch } from '@shared'

/** TaoType declares the static Tao type shape used by semantic helpers. */
export type TaoType =
  | {
    kind: 'primitive'
    primitive: 'text' | 'number' | 'boolean' | 'time' | 'none' | 'ui' | 'nav'
    nominal?: AST.TypeDefinition
  }
  | {
    kind: 'primitive'
    primitive: 'action'
    parameters: readonly TaoActionParameter[]
    nominal?: AST.TypeDefinition
  }
  | { kind: 'list'; element?: TaoType; nominal?: AST.TypeDefinition }
  | { kind: 'item'; item?: AST.ItemTypeExpression; nominal?: AST.TypeDefinition }
  | { kind: 'entity'; entity: DataEntityDefinition }
  | { kind: 'enum'; declaration: AST.EnumDeclaration }
  | { kind: 'union'; members: readonly TaoType[] }
  | { kind: 'unresolved' }

export type DataEntityDefinition = AST.EntityDataDeclaration
export type DataFieldDefinition = AST.EntityDataField
export type QueryDefinition = AST.EntityQueryDeclaration

/** TaoActionParameter declares one positional input accepted by an action value. */
export type TaoActionParameter = {
  type: TaoType
  optional: boolean
}

/** TypeReferenceRoot declares the root definition and remaining member path for a named type reference. */
export type TypeReferenceRoot = {
  definition?: AST.TypeDefinition
  remainingMembers: readonly string[]
}

type AnyTypeReference = AST.TypeReference | AST.ConstructablePrimitiveTypeReference

/** Type exposes static Tao type resolution and compatibility helpers. */
export class Type {
  private constructor() {}

  /** parameterName returns the value alias introduced by a parameter declaration. */
  static parameterName(parameter: AST.ParameterDeclaration): string {
    if (parameter.inlineType) {
      return parameter.inlineType.name
    }
    return parameter.type ? inferredParameterNameFromNamedType(parameter.type) : 'Value'
  }

  /** declarationName returns the source-facing name of a named declaration. */
  static declarationName(declaration: AST.NamedDeclaration): string {
    return AST.isParameterDeclaration(declaration) ? Type.parameterName(declaration) : declaration.name
  }

  /** referenceName returns the source-facing name of a Tao type reference. */
  static referenceName(type: AnyTypeReference): string {
    return Switch.type(type, {
      ActionTypeReference: reference =>
        `action(${reference.parameterTypes.map(parameter => Type.referenceName(parameter)).join(', ')})`,
      ConstructablePrimitiveTypeReference: reference => reference.primitive,
      NamedTypeReference: reference => {
        return [reference.root, ...reference.members].join('.')
      },
      PrimitiveTypeReference: reference => reference.primitive,
    })
  }

  /** constructorReferenceName returns the source-facing name of a typed constructor's type prefix. */
  static constructorReferenceName(type: AST.ConstructablePrimitiveTypeReference): string {
    return Type.referenceName(type)
  }

  static definitionName(type: AST.TypeDefinition): string {
    return Switch.type(type, {
      TypeDeclaration: declaration => declaration.name,
      TypeProperty: property => {
        const owner = owningTypePropertyDefinition(property)
        return owner ? `${Type.definitionName(owner)}.${property.name}` : property.name
      },
      ParameterTypeDeclaration: parameterType => {
        const owner = owningParameterizedDeclaration(parameterType)
        return owner ? `${owner.name}.${parameterType.name}` : parameterType.name
      },
    })
  }

  /** displayName renders a resolved Tao type to a human-facing name for diagnostics. */
  static displayName(type: TaoType): string {
    return Switch.kind(type, {
      unresolved: () => 'unresolved',
      primitive: type => {
        if (type.nominal) {
          return Type.definitionName(type.nominal)
        }
        return type.primitive === 'action' ? actionDisplayName(type) : type.primitive
      },
      list: () => 'list',
      item: type => type.nominal ? Type.definitionName(type.nominal) : type.kind,
      entity: type => dataEntityName(type.entity),
      enum: type => type.declaration.name,
      union: type => type.members.map(Type.displayName).join(' | '),
    })
  }

  /** ofReference resolves a type reference to the Tao type it denotes. */
  static ofReference(type: AST.TypeReference): TaoType {
    return new TypeResolutionContext().ofReference(type)
  }

  /** ofDefinition resolves a type definition to the Tao type it denotes. */
  static ofDefinition(type: AST.TypeDefinition): TaoType {
    return new TypeResolutionContext().ofDefinition(type)
  }

  /** ofConstructorReference resolves a typed constructor's type prefix. */
  static ofConstructorReference(type: AST.ConstructablePrimitiveTypeReference): TaoType {
    return new TypeResolutionContext().ofConstructorReference(type)
  }

  /** ofParameter resolves a parameter declaration's accepted Tao type. */
  static ofParameter(parameter: AST.ParameterDeclaration): TaoType {
    return new TypeResolutionContext().ofParameter(parameter)
  }

  /** ofExpression resolves the static Tao type of a value expression. */
  static ofExpression(expression: AST.Expression | AST.ConfiguredValue): TaoType {
    return AST.isConfiguredValue(expression)
      ? Type.ofConfiguredValue(expression)
      : new TypeResolutionContext().ofExpression(expression)
  }

  /** ofValueDeclaration resolves the runtime value type introduced by one linked value declaration. */
  static ofValueDeclaration(declaration: AST.ValueDeclaration | undefined): TaoType {
    return new TypeResolutionContext().ofValueDeclaration(declaration)
  }

  /** atMemberPath resolves a member suffix from an already-resolved root type. */
  static atMemberPath(root: TaoType, members: readonly string[]): TaoType {
    return new TypeResolutionContext().atMemberPath(root, members)
  }

  /** ofConfiguredValue resolves one declaration-linked named constructor. */
  static ofConfiguredValue(value: AST.ConfiguredValue): TaoType {
    const declaration = value.type.ref
    if (AST.isTypeDeclaration(declaration)) {
      return Type.atMemberPath(Type.ofDefinition(declaration), value.members ?? [])
    }
    if (AST.isParameterizedDeclaration(declaration)) {
      const [member, ...remainingMembers] = value.members ?? []
      const parameterType = member
        ? AST.parametersOf(declaration).find(parameter => parameter.inlineType?.name === member)?.inlineType
        : undefined
      return parameterType
        ? Type.atMemberPath(Type.ofDefinition(parameterType), remainingMembers)
        : unresolvedType()
    }
    if (AST.isNavDeclaration(declaration)) {
      return primitiveType('nav')
    }
    if (AST.isDatasourceDeclaration(declaration)) {
      return { kind: 'item' }
    }
    return unresolvedType()
  }

  /** ofValue resolves an ordinary expression or configured runtime value. */
  static ofValue(value: AST.Expression | AST.ConfiguredValue): TaoType {
    return AST.isConfiguredValue(value) ? Type.ofConfiguredValue(value) : Type.ofExpression(value)
  }

  /** ofAction resolves the positional callback signature of a named Tao action. */
  static ofAction(action: AST.ActionDeclaration): TaoType {
    return new TypeResolutionContext().ofAction(action)
  }

  /** ofArgument resolves the static Tao type an invocation argument contributes for binding. */
  static ofArgument(argument: AST.Argument): TaoType {
    return Type.ofExpression(argument.value)
  }

  /** constructorReferenceItemType resolves a typed constructor type prefix to an item shape, when it has one. */
  static constructorReferenceItemType(type: AnyTypeReference): AST.ItemTypeExpression | undefined {
    const resolved = AST.isConstructablePrimitiveTypeReference(type)
      ? Type.ofConstructorReference(type)
      : Type.ofReference(type)
    return itemShape(resolved)
  }

  /** ofProperty resolves the expected value type of one item property declaration. */
  static ofProperty(property: AST.TypeProperty): TaoType {
    return new TypeResolutionContext().ofProperty(property)
  }

  /** ofConfigurationProperty resolves a nav/datasource contract property's accepted Tao type. */
  static ofConfigurationProperty(property: AST.ConfigurationPropertyDeclaration): TaoType {
    return AST.configurationPropertyIsKey(property)
      ? primitiveType('text')
      : Type.ofReference(property.type)
  }

  /** shorthandPropertyDefinition resolves the same-name type used by a shorthand item field. */
  static shorthandPropertyDefinition(property: AST.TypeProperty): AST.TypeDeclaration | undefined {
    return property.type ? undefined : visibleTypeDeclaration(property, property.name)
  }

  /** visibleDeclaration resolves a type name in the lexical file/import scope of a node. */
  static visibleDeclaration(node: AST.Node, name: string): AST.TypeDeclaration | undefined {
    return visibleTypeDeclaration(node, name)
  }

  /** isAssignable returns whether an actual value type can satisfy an expected parameter/property type. */
  static isAssignable(actual: TaoType, expected: TaoType): boolean {
    if (expected.kind === 'union') {
      return expected.members.some(member => Type.isAssignable(actual, member))
    }
    if (actual.kind === 'union') {
      return actual.members.every(member => Type.isAssignable(member, expected))
    }
    if (!typesHaveCompatibleBase(actual, expected)) {
      return false
    }
    if (actual.kind === 'list' && expected.kind === 'list' && !listTypeIsAssignable(actual, expected)) {
      return false
    }
    if (isActionType(actual) && isActionType(expected) && !actionTypeIsAssignable(actual, expected)) {
      return false
    }
    if (nominalOf(expected)) {
      return actualSatisfiesExpectedNominal(actual, expected)
    }
    return true
  }

  /** commonType returns a branch-safe type that every resolved input can satisfy. */
  static commonType(types: readonly TaoType[]): TaoType | undefined {
    if (types.length === 0 || types.some(isUnresolvedType)) {
      return undefined
    }

    const candidates = types.filter(candidate => types.every(actual => Type.isAssignable(actual, candidate)))
    return candidates.reduce<TaoType | undefined>((best, candidate) => {
      if (!best) {
        return candidate
      }
      return commonTypeCandidateIsPreferred(candidate, best) ? candidate : best
    }, undefined)
  }

  /** entityOfReference resolves a top-level entity's singular type name. */
  static entityOfReference(reference: AST.NamedTypeReference): DataEntityDefinition | undefined {
    return reference.members.length === 0
      ? visibleEntityDataDeclarations(reference).find(entity => entity.singularName === reference.root)
      : undefined
  }

  /** isCastCompatible returns whether a value can be type-fixed through typed value creation. */
  static isCastCompatible(actual: TaoType, target: TaoType): boolean {
    if (target.kind === 'union') {
      return target.members.some(member => Type.isCastCompatible(actual, member))
    }
    if (actual.kind === 'union') {
      return actual.members.every(member => Type.isCastCompatible(member, target))
    }
    if (!typesHaveCompatibleBase(actual, target)) {
      return false
    }
    if (isActionType(actual) && isActionType(target) && !actionTypeIsAssignable(actual, target)) {
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
  static identityKey(type: TaoType): string | undefined {
    if (isUnresolvedType(type)) {
      return undefined
    }
    const nominal = nominalOf(type)
    if (nominal) {
      return `${type.kind}:${definitionIdentityName(nominal)}`
    }
    if (isPrimitiveKind(type)) {
      if (isActionType(type)) {
        return `primitive:action(${type.parameters.map(actionParameterIdentityKey).join(',')})`
      }
      return `${type.kind}:${type.primitive}`
    }
    if (type.kind === 'entity') {
      return `entity:${AST.getDocument(type.entity).uri.path}#${dataEntityName(type.entity)}`
    }
    if (type.kind === 'enum') {
      return `enum:${AST.getDocument(type.declaration).uri.path}#${type.declaration.name}`
    }
    if (type.kind === 'union') {
      return `union:${type.members.map(member => Type.identityKey(member) ?? 'unresolved').join('|')}`
    }
    return type.kind
  }

  /** ofMemberAccess resolves the static type reached by a member access expression. */
  static ofMemberAccess(expression: AST.MemberAccessExpression): TaoType {
    return new TypeResolutionContext().ofMemberAccess(expression)
  }

  /** dataFieldOfMemberAccess returns the declaration reached by an entity member path. */
  static dataFieldOfMemberAccess(expression: AST.MemberAccessExpression): DataFieldDefinition | undefined {
    let current = Type.ofValueDeclaration(expression.target.ref)
    for (const [index, member] of expression.members.entries()) {
      if (current.kind !== 'entity') {
        return undefined
      }
      const field = Type.dataFields(current.entity).find(candidate => candidate.name === member)
      if (!field) {
        return undefined
      }
      if (index === expression.members.length - 1) {
        return field
      }
      current = Type.dataFieldType(field)
    }
    return undefined
  }

  /** queryEntity resolves the entity selected by one query declaration. */
  static queryEntity(query: QueryDefinition): DataEntityDefinition | undefined {
    if (query.source) {
      const source = Type.ofMemberAccess(query.source)
      return source.kind === 'list' && source.element?.kind === 'entity' ? source.element.entity : undefined
    }
    const sourceName = query.sourceName ?? query.name
    return Type.visibleDataEntities(query).find(entity => entity.name === sourceName)
  }

  /** dataEntityName returns the durable singular name stored in provider envelopes. */
  static dataEntityName(entity: DataEntityDefinition): string {
    return entity.singularName
  }

  /** dataCollectionName returns the plural source name exposed to queries. */
  static dataCollectionName(entity: DataEntityDefinition): string {
    return entity.name
  }

  /** dataFields returns the stored and inferred field declarations of one entity. */
  static dataFields(entity: DataEntityDefinition): DataFieldDefinition[] {
    return entity.block.entries.filter(AST.isEntityDataField)
  }

  /** dataFieldRelationName returns the explicit relation target or the field-name inference key. */
  static dataFieldRelationName(field: DataFieldDefinition): string {
    return field.modifiers.find(modifier => modifier.relationName)?.relationName ?? field.name
  }

  /** dataFieldRelationEntity resolves a stored or inverse relationship target. */
  static dataFieldRelationEntity(field: DataFieldDefinition): DataEntityDefinition | undefined {
    if (field.primitive || field.boolean) {
      return undefined
    }
    const relationName = Type.dataFieldRelationName(field)
    return Type.topLevelDataEntities(field).find(entity =>
      entity.singularName === relationName || entity.name === relationName
    )
  }

  /** dataFieldIsInverseRelation distinguishes plural owner-side relations from stored handles. */
  static dataFieldIsInverseRelation(field: DataFieldDefinition): boolean {
    if (field.primitive || field.boolean) {
      return false
    }
    const relationName = Type.dataFieldRelationName(field)
    return Type.topLevelDataEntities(field).some(entity => entity.name === relationName)
  }

  /** topLevelDataEntities returns the current provider-neutral catalog declarations in a file. */
  static topLevelDataEntities(node: AST.Node): AST.EntityDataDeclaration[] {
    const root = AST.findRoot(node)
    return AST.isTaoFile(root) ? root.statements.filter(AST.isEntityDataDeclaration) : []
  }

  /** visibleDataEntities returns local plus use-imported catalog declarations for a node. */
  static visibleDataEntities(node: AST.Node): AST.EntityDataDeclaration[] {
    const root = AST.findRoot(node)
    if (!AST.isTaoFile(root)) {
      return []
    }
    return [
      ...root.statements.filter(AST.isEntityDataDeclaration),
      ...root.statements
        .filter(AST.isUseStatement)
        .flatMap(useStatement =>
          useStatement.importedDeclarations.map(reference => reference.ref).filter(AST.isEntityDataDeclaration)
        ),
    ]
  }

  /** dataFieldType resolves the value type stored by a schema field. */
  static dataFieldType(field: DataFieldDefinition): TaoType {
    if (field.primitive === 'text') {
      return primitiveType('text')
    }
    if (field.primitive === 'number') {
      return primitiveType('number')
    }
    if (field.primitive === 'boolean') {
      return primitiveType('boolean')
    }
    if (field.primitive === 'time') {
      return primitiveType('time')
    }
    if (field.boolean) {
      return primitiveType('boolean')
    }
    const relation = Type.dataFieldRelationEntity(field)
    if (!relation) {
      return unresolvedType()
    }
    return Type.dataFieldIsInverseRelation(field)
      ? { kind: 'list', element: { kind: 'entity', entity: relation } }
      : { kind: 'entity', entity: relation }
  }

  /** definitionOfReference resolves a named type reference, including qualified item fields. */
  static definitionOfReference(reference: AST.NamedTypeReference): AST.TypeDefinition | undefined {
    const root = Type.rootOfReference(reference)
    return root.definition ? definitionAtMemberPath(root.definition, root.remainingMembers) : undefined
  }

  /** rootOfReference resolves the root definition and unresolved suffix of a named type reference. */
  static rootOfReference(reference: AST.NamedTypeReference): TypeReferenceRoot {
    const owner = visibleParameterizedDeclaration(reference, reference.root)
    if (owner) {
      const [member, ...remainingMembers] = reference.members
      if (member) {
        const parameterType = parameterTypeDeclarationNamed(owner, member)
        if (parameterType) {
          return { definition: parameterType, remainingMembers }
        }
      }
    }

    const root = itemConstructorProperty(reference, reference.root)
      ?? visibleTypeDeclaration(reference, reference.root)
    return { definition: root, remainingMembers: reference.members }
  }
}

function inferredParameterNameFromNamedType(type: AST.NamedTypeReference): string {
  const lastQualifiedMemberName = type.members.at(-1)
  return lastQualifiedMemberName ?? type.root
}

function isUnresolvedType(type: TaoType): type is Extract<TaoType, { kind: 'unresolved' }> {
  return type.kind === 'unresolved'
}

function isPrimitiveKind(type: TaoType): type is Extract<TaoType, { kind: 'primitive' }> {
  return type.kind === 'primitive'
}

function isActionType(
  type: TaoType,
): type is Extract<TaoType, { kind: 'primitive'; primitive: 'action' }> {
  return type.kind === 'primitive' && type.primitive === 'action'
}

function isItemKind(type: TaoType): type is Extract<TaoType, { kind: 'item' }> {
  return type.kind === 'item'
}

function itemShape(type: TaoType): AST.ItemTypeExpression | undefined {
  return isItemKind(type) ? type.item : undefined
}

function typesHaveCompatibleBase(actual: TaoType, expected: TaoType): boolean {
  const bothTypesAreResolved = !isUnresolvedType(actual) && !isUnresolvedType(expected)
  const typesShareKind = actual.kind === expected.kind
  if (!bothTypesAreResolved || !typesShareKind || primitivesDiffer(actual, expected)) {
    return false
  }
  if (actual.kind === 'entity' && expected.kind === 'entity') {
    return actual.entity === expected.entity
  }
  if (actual.kind === 'enum' && expected.kind === 'enum') {
    return actual.declaration === expected.declaration
  }
  return true
}

function listTypeIsAssignable(
  actual: Extract<TaoType, { kind: 'list' }>,
  expected: Extract<TaoType, { kind: 'list' }>,
): boolean {
  if (!actual.element || !expected.element) {
    return true
  }
  return Type.isAssignable(actual.element, expected.element)
}

function commonTypeCandidateIsPreferred(candidate: TaoType, current: TaoType): boolean {
  if (candidate.kind === 'list' && current.kind === 'list') {
    if (candidate.element && !current.element) {
      return true
    }
    if (!candidate.element && current.element) {
      return false
    }
  }

  const candidateIsMoreSpecific = Type.isAssignable(candidate, current)
    && !Type.isAssignable(current, candidate)
  const currentIsMoreSpecific = Type.isAssignable(current, candidate)
    && !Type.isAssignable(candidate, current)
  if (candidateIsMoreSpecific !== currentIsMoreSpecific) {
    return candidateIsMoreSpecific
  }

  return commonTypeCandidateKey(candidate) < commonTypeCandidateKey(current)
}

function commonTypeCandidateKey(type: TaoType): string {
  if (type.kind === 'list') {
    return `list(${type.element ? commonTypeCandidateKey(type.element) : ''})`
  }
  return Type.identityKey(type) ?? Type.displayName(type)
}

function actionTypeIsAssignable(
  actual: Extract<TaoType, { kind: 'primitive'; primitive: 'action' }>,
  expected: Extract<TaoType, { kind: 'primitive'; primitive: 'action' }>,
): boolean {
  const actualRequired = actual.parameters.filter(parameter => !parameter.optional).length
  const expectedRequired = expected.parameters.filter(parameter => !parameter.optional).length
  if (actualRequired > expectedRequired || actual.parameters.length < expected.parameters.length) {
    return false
  }
  return expected.parameters.every((parameter, index) => {
    const actualParameter = actual.parameters[index]
    // Callback inputs are contravariant: an implementation must accept every value
    // its declared callback contract permits the caller to provide.
    return actualParameter !== undefined && Type.isAssignable(parameter.type, actualParameter.type)
  })
}

function actionDisplayName(type: Extract<TaoType, { kind: 'primitive'; primitive: 'action' }>): string {
  const parameters = type.parameters.map(parameter =>
    `${Type.displayName(parameter.type)}${parameter.optional ? '?' : ''}`
  )
  return `action(${parameters.join(', ')})`
}

function actionParameterIdentityKey(parameter: TaoActionParameter): string {
  return `${Type.identityKey(parameter.type) ?? 'unresolved'}${parameter.optional ? '?' : ''}`
}

function primitivesDiffer(actual: TaoType, expected: TaoType): boolean {
  return isPrimitiveKind(actual) && isPrimitiveKind(expected) && actual.primitive !== expected.primitive
}

function nominalOf(type: TaoType): AST.TypeDefinition | undefined {
  return isUnresolvedType(type) || type.kind === 'entity' || type.kind === 'enum' || type.kind === 'union'
    ? undefined
    : type.nominal
}

function actualSatisfiesExpectedNominal(actual: TaoType, expected: TaoType): boolean {
  const actualNominal = nominalOf(actual)
  const expectedNominal = nominalOf(expected)
  if (!actualNominal && expectedNominal) {
    return true
  }
  if (
    actualNominal
    && expectedNominal
    && expectedNominalAcceptsBaseCompatibleNominals(expectedNominal)
  ) {
    return true
  }
  return actualNominal && expectedNominal
    ? nominalChainsIntersect(actualNominal, expectedNominal)
    : false
}

function expectedNominalAcceptsBaseCompatibleNominals(expected: AST.TypeDefinition): boolean {
  return AST.isParameterTypeDeclaration(expected) && AST.isPrimitiveTypeReference(expected.type)
}

function nominalsAreCastCompatible(from: AST.TypeDefinition, target: AST.TypeDefinition): boolean {
  return nominalChainReaches(from, target) || nominalChainReaches(target, from)
}

function propertyNamed(itemType: AST.ItemTypeExpression, name: string): AST.TypeProperty | undefined {
  return itemType.properties.find(property => property.name === name)
}

class TypeResolutionContext {
  private readonly seenAliases = new Set<AST.AliasDeclaration>()
  private readonly seenStates = new Set<AST.StateDeclaration>()
  private readonly seenTypeDefinitions = new Set<AST.TypeDefinition>()

  ofReference(type: AST.TypeReference): TaoType {
    return Switch.type(type, {
      ActionTypeReference: reference =>
        actionType(
          reference.parameterTypes.map(parameter => ({ type: this.ofReference(parameter), optional: false })),
        ),
      NamedTypeReference: reference => {
        const entity = Type.entityOfReference(reference)
        if (entity) {
          return { kind: 'entity', entity }
        }
        const definition = Type.definitionOfReference(reference)
        return definition ? this.ofDefinition(definition) : unresolvedType()
      },
      PrimitiveTypeReference: reference => primitiveType(reference.primitive),
    })
  }

  ofConstructorReference(type: AST.ConstructablePrimitiveTypeReference): TaoType {
    return primitiveType(type.primitive)
  }

  ofParameter(parameter: AST.ParameterDeclaration): TaoType {
    if (parameter.inlineType) {
      return this.ofDefinition(parameter.inlineType)
    }
    return parameter.type ? this.ofReference(parameter.type) : unresolvedType()
  }

  ofExpression(expression: AST.Expression): TaoType {
    return Switch.type(expression, {
      ActionExpression: () => actionType([]),
      BinaryExpression: binary => this.binaryExpressionType(binary),
      BooleanLiteral: () => primitiveType('boolean'),
      CaseTestExpression: () => primitiveType('boolean'),
      ConfigurationConstructor: value => Type.ofConfiguredValue(value),
      WhenExpression: when => this.whenExpressionType(when),
      FunctionCallExpression: call =>
        call.function.ref ? this.ofReference(call.function.ref.returnType) : unresolvedType(),
      InterpolatedString: () => primitiveType('text'),
      ListLiteral: list => this.listLiteralType(list),
      MemberAccessExpression: access => this.ofMemberAccess(access),
      NoneLiteral: () => primitiveType('none'),
      NumberLiteral: () => primitiveType('number'),
      StringLiteral: () => primitiveType('text'),
      TypedConstructor: constructor => this.ofConstructorReference(constructor.type),
      UnaryExpression: unary => unary.operator === 'not' ? primitiveType('boolean') : primitiveType('number'),
      ValueReference: reference => this.ofValueDeclaration(reference.target.ref),
    })
  }

  private binaryExpressionType(expression: AST.BinaryExpression): TaoType {
    if (['==', '!=', '<', '<=', '>', '>=', 'and', 'or'].includes(expression.operator)) {
      return primitiveType('boolean')
    }
    const left = this.ofExpression(expression.left)
    return expression.operator === '+' && left.kind === 'primitive' && left.primitive === 'text'
      ? primitiveType('text')
      : primitiveType('number')
  }

  private whenExpressionType(expression: AST.WhenExpression): TaoType {
    const values = [...expression.branches.map(branch => branch.value), expression.otherwise.value]
    return Type.commonType(values.map(value => this.ofExpression(value))) ?? unresolvedType()
  }

  private listLiteralType(list: AST.ListLiteral): TaoType {
    if (list.elements.length === 0) {
      return { kind: 'list' }
    }
    const element = Type.commonType(list.elements.map(candidate => this.ofExpression(candidate)))
    return element ? { kind: 'list', element } : { kind: 'list' }
  }

  ofProperty(property: AST.TypeProperty): TaoType {
    return this.ofDefinition(property)
  }

  ofMemberAccess(expression: AST.MemberAccessExpression): TaoType {
    const rootType = this.ofValueDeclaration(expression.target.ref)
    return this.atMemberPath(rootType, expression.members)
  }

  ofValueDeclaration(declaration: AST.ValueDeclaration | undefined): TaoType {
    return Switch.typeMaybe<AST.ValueDeclaration | undefined, TaoType>(declaration, {
      ActionDeclaration: declaration => this.ofAction(declaration),
      AliasDeclaration: alias => this.aliasDeclarationType(alias),
      AppDeclaration: () => unresolvedType(),
      AskStatement: ask =>
        ask.dialogue.ref?.response.ref
          ? { kind: 'enum', declaration: ask.dialogue.ref.response.ref }
          : unresolvedType(),
      CasePayload: () => primitiveType('text'),
      EntityDataField: field => field.negativeName ? primitiveType('boolean') : unresolvedType(),
      EntityQueryDeclaration: query => this.queryDeclarationType(query),
      EnumCase: enumCase => ({ kind: 'enum', declaration: AST.enumOwningCase(enumCase) }),
      ForStatement: statement => this.forStatementBindingType(statement),
      ParameterDeclaration: parameter => this.ofParameter(parameter),
      StateDeclaration: state => this.stateDeclarationType(state),
      UiDeclaration: () => primitiveType('ui'),
      undefined: unresolvedType,
    })
  }

  ofAction(declaration: AST.ActionDeclaration): TaoType {
    return actionType(
      AST.parametersOf(declaration).map(parameter => ({
        type: this.ofParameter(parameter),
        optional: parameter.defaultValue !== undefined,
      })),
    )
  }

  private queryDeclarationType(query: QueryDefinition): TaoType {
    const entity = Type.queryEntity(query)
    return entity ? { kind: 'list', element: { kind: 'entity', entity } } : { kind: 'list' }
  }

  private forStatementBindingType(statement: AST.ForStatement): TaoType {
    const collection = this.ofExpression(statement.collection)
    return collection.kind === 'list' ? collection.element ?? unresolvedType() : unresolvedType()
  }

  private aliasDeclarationType(alias: AST.AliasDeclaration): TaoType {
    if (this.aliasAlreadySeen(alias)) {
      return unresolvedType()
    }
    this.seenAliases.add(alias)
    try {
      return AST.isConfiguredValue(alias.value)
        ? Type.ofConfiguredValue(alias.value)
        : this.ofExpression(alias.value)
    } finally {
      this.seenAliases.delete(alias)
    }
  }

  private stateDeclarationType(state: AST.StateDeclaration): TaoType {
    if (this.stateAlreadySeen(state)) {
      return unresolvedType()
    }
    this.seenStates.add(state)
    try {
      return this.ofExpression(state.value)
    } finally {
      this.seenStates.delete(state)
    }
  }

  private aliasAlreadySeen(declaration: AST.AliasDeclaration): boolean {
    return this.seenAliases.has(declaration)
  }

  private stateAlreadySeen(declaration: AST.StateDeclaration): boolean {
    return this.seenStates.has(declaration)
  }

  atMemberPath(root: TaoType, members: readonly string[]): TaoType {
    let current = root
    for (const member of members) {
      if (
        (current.kind === 'list' || (current.kind === 'primitive' && current.primitive === 'text'))
        && member === 'Count'
      ) {
        current = primitiveType('number')
        continue
      }
      if (current.kind === 'entity') {
        if (member === 'Id') {
          current = primitiveType('text')
          continue
        }
        const field = Type.dataFields(current.entity).find(candidate => candidate.name === member)
        if (!field) {
          return unresolvedType()
        }
        current = Type.dataFieldType(field)
        continue
      }
      const itemType = isItemKind(current) ? current.item : undefined
      if (!itemType) {
        return unresolvedType()
      }
      const property = propertyNamed(itemType, member)
      if (!property) {
        return unresolvedType()
      }
      current = this.ofProperty(property)
    }
    return current
  }

  ofDefinition(definition: AST.TypeDefinition): TaoType {
    if (this.definitionAlreadySeen(definition)) {
      return unresolvedType()
    }
    this.seenTypeDefinitions.add(definition)
    try {
      return Switch.type(definition, {
        ParameterTypeDeclaration: declaration => withNominal(this.ofExpressionType(declaration.type), declaration),
        TypeDeclaration: declaration => withNominal(this.ofExpressionType(declaration.type), declaration),
        TypeProperty: property => this.typePropertyType(property),
      })
    } finally {
      this.seenTypeDefinitions.delete(definition)
    }
  }

  private typePropertyType(property: AST.TypeProperty): TaoType {
    return withNominal(this.typePropertyUnderlyingType(property), property)
  }

  private typePropertyUnderlyingType(property: AST.TypeProperty): TaoType {
    if (property.type) {
      return this.ofReference(property.type)
    }
    const shorthandType = Type.shorthandPropertyDefinition(property)
    return shorthandType ? this.ofDefinition(shorthandType) : unresolvedType()
  }

  private definitionAlreadySeen(definition: AST.TypeDefinition): boolean {
    return this.seenTypeDefinitions.has(definition)
  }

  private ofExpressionType(type: AST.TypeExpression): TaoType {
    return Switch.type(type, {
      ActionTypeReference: reference => this.ofReference(reference),
      ItemTypeExpression: item => ({ kind: 'item', item }),
      NamedTypeReference: reference => this.ofReference(reference),
      PrimitiveTypeReference: reference => this.ofReference(reference),
      UnionTypeExpression: union => ({
        kind: 'union',
        members: union.members.map(member => this.ofReference(member)),
      }),
    })
  }
}

function primitiveType(primitive: AST.PrimitiveType | 'none'): TaoType {
  return Switch(primitive, {
    text: () => ({ kind: 'primitive', primitive: 'text' }),
    number: () => ({ kind: 'primitive', primitive: 'number' }),
    boolean: () => ({ kind: 'primitive', primitive: 'boolean' }),
    time: () => ({ kind: 'primitive', primitive: 'time' }),
    action: () => actionType([]),
    none: () => ({ kind: 'primitive', primitive: 'none' }),
    list: () => ({ kind: 'list' }),
    item: () => ({ kind: 'item' }),
    nav: () => ({ kind: 'primitive', primitive: 'nav' }),
    ui: () => ({ kind: 'primitive', primitive: 'ui' }),
  })
}

function actionType(parameters: readonly TaoActionParameter[]): TaoType {
  return { kind: 'primitive', primitive: 'action', parameters }
}

function definitionIdentityName(type: AST.TypeDefinition): string {
  return `${AST.getDocument(type).uri.path}#${Type.definitionName(type)}`
}

function dataEntityName(entity: DataEntityDefinition): string {
  return entity.singularName
}

function unresolvedType(): TaoType {
  return { kind: 'unresolved' }
}

function withNominal(type: TaoType, nominal: AST.TypeDefinition): TaoType {
  // Callback contracts are structural. Scoped parameter names must not prevent
  // a matching named action from satisfying action(...) at another call site.
  if (isActionType(type)) {
    return type
  }
  if (canCarryNominal(type)) {
    return { ...type, nominal }
  }
  return type
}

function canCarryNominal(
  type: TaoType,
): type is Extract<TaoType, { kind: 'primitive' | 'list' | 'item' }> {
  return isPrimitiveKind(type) || type.kind === 'list' || isItemKind(type)
}

function itemTypeOfDefinition(definition: AST.TypeDefinition): AST.ItemTypeExpression | undefined {
  return itemShape(new TypeResolutionContext().ofDefinition(definition))
}

function nominalChainReaches(
  from: AST.TypeDefinition,
  target: AST.TypeDefinition,
  seen: Set<AST.TypeDefinition> = new Set(),
): boolean {
  if (from === target) {
    return true
  }
  if (seen.has(from)) {
    return false
  }
  seen.add(from)
  const parent = parentTypeDefinition(from)
  return parent ? nominalChainReaches(parent, target, seen) : false
}

function nominalChainsIntersect(left: AST.TypeDefinition, right: AST.TypeDefinition): boolean {
  const rightChain = new Set(nominalChain(right))
  return nominalChain(left).some(definition => rightChain.has(definition))
}

function nominalChain(
  definition: AST.TypeDefinition,
  seen: Set<AST.TypeDefinition> = new Set(),
): AST.TypeDefinition[] {
  if (seen.has(definition)) {
    return []
  }
  seen.add(definition)
  const parent = parentTypeDefinition(definition)
  return parent ? [definition, ...nominalChain(parent, seen)] : [definition]
}

function parentTypeDefinition(definition: AST.TypeDefinition): AST.TypeDefinition | undefined {
  return Switch.type(definition, {
    ParameterTypeDeclaration: declaration => namedParentDefinition(declaration.type),
    TypeDeclaration: declaration => namedParentDefinition(declaration.type),
    TypeProperty: property =>
      property.type
        ? namedParentDefinition(property.type)
        : Type.shorthandPropertyDefinition(property),
  })
}

function namedParentDefinition(type: AST.TypeExpression): AST.TypeDefinition | undefined {
  return AST.isNamedTypeReference(type) ? Type.definitionOfReference(type) : undefined
}

function visibleTypeDeclaration(node: AST.Node, name: string): AST.TypeDeclaration | undefined {
  const root = AST.findRoot(node)
  if (!AST.isTaoFile(root)) {
    return undefined
  }
  return typeDeclarationsInFile(root).find(type => type.name === name)
}

function visibleEntityDataDeclarations(node: AST.Node): AST.EntityDataDeclaration[] {
  const root = AST.findRoot(node)
  if (!AST.isTaoFile(root)) {
    return []
  }
  return [
    ...root.statements.filter(AST.isEntityDataDeclaration),
    ...root.statements
      .filter(AST.isUseStatement)
      .flatMap(useStatement =>
        useStatement.importedDeclarations.map(reference => reference.ref).filter(AST.isEntityDataDeclaration)
      ),
  ]
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

function visibleParameterizedDeclaration(node: AST.Node, name: string): AST.ParameterizedDeclaration | undefined {
  const root = AST.findRoot(node)
  if (!AST.isTaoFile(root)) {
    return undefined
  }
  return parameterizedDeclarationsInFile(root).find(declaration => declaration.name === name)
}

function parameterizedDeclarationsInFile(file: AST.TaoFile): AST.ParameterizedDeclaration[] {
  return [
    ...file.statements.filter(AST.isParameterizedDeclaration),
    ...file.statements
      .filter(AST.isUseStatement)
      .flatMap(useStatement =>
        useStatement.importedDeclarations.map(reference => reference.ref).filter(AST.isParameterizedDeclaration)
      ),
  ]
}

function owningTypePropertyDefinition(property: AST.TypeProperty): AST.TypeDefinition | undefined {
  const itemType = property.$container
  const owner = itemType?.$container
  return AST.isTypeDeclaration(owner) || AST.isParameterTypeDeclaration(owner) ? owner : undefined
}

function owningParameterizedDeclaration(
  parameterType: AST.ParameterTypeDeclaration,
): AST.ParameterizedDeclaration | undefined {
  const parameter = parameterType.$container
  const parameterList = parameter.$container
  const owner = parameterList.$container
  return AST.isParameterizedDeclaration(owner) ? owner : undefined
}

function definitionAtMemberPath(
  root: AST.TypeDefinition,
  members: readonly string[],
): AST.TypeDefinition | undefined {
  let current: AST.TypeDefinition | undefined = root
  for (const member of members) {
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

function parameterTypeDeclarationNamed(
  declaration: AST.ParameterizedDeclaration,
  name: string,
): AST.ParameterTypeDeclaration | undefined {
  return AST.parametersOf(declaration).find(parameter => parameter.inlineType?.name === name)?.inlineType
}

function itemConstructorProperty(reference: AST.NamedTypeReference, name: string): AST.TypeProperty | undefined {
  const itemType = owningItemLiteralType(reference)
  return itemType ? propertyNamed(itemType, name) : undefined
}

function owningItemLiteralType(reference: AST.NamedTypeReference): AST.ItemTypeExpression | undefined {
  let current: AST.Node | undefined = reference.$container
  while (current) {
    if (AST.isItemLiteral(current)) {
      return itemLiteralType(current)
    }
    current = current.$container
  }
  return undefined
}

function itemLiteralType(item: AST.ItemLiteral): AST.ItemTypeExpression | undefined {
  const parent = item.$container
  if (AST.isTypedConstructor(parent)) {
    return Type.constructorReferenceItemType(parent.type)
  }
  return undefined
}
