import { AST } from '@parser'
import { Switch } from '@shared'

/** TaoType declares the static Tao type shape used by semantic helpers. */
export type TaoType =
  | { kind: 'primitive'; primitive: 'text' | 'number' | 'boolean' | 'action' | 'none'; nominal?: AST.TypeDefinition }
  | { kind: 'list'; element?: TaoType; nominal?: AST.TypeDefinition }
  | { kind: 'item'; item?: AST.ItemTypeExpression; nominal?: AST.TypeDefinition }
  | { kind: 'entity'; entity: AST.DataEntity }
  | { kind: 'unresolved' }

/** TypeReferenceRoot declares the root definition and remaining member path for a named type reference. */
export type TypeReferenceRoot = {
  definition?: AST.TypeDefinition
  remainingMembers: readonly string[]
}

type AnyTypeReference = AST.TypeReference | AST.ConstructorTypeReference

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
      ConstructablePrimitiveTypeReference: reference => reference.primitive,
      NamedTypeReference: reference => {
        return [reference.root, ...reference.members].join('.')
      },
      PrimitiveTypeReference: reference => reference.primitive,
    })
  }

  /** constructorReferenceName returns the source-facing name of a typed constructor's type prefix. */
  static constructorReferenceName(type: AST.ConstructorTypeReference): string {
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
      primitive: type => type.nominal ? Type.definitionName(type.nominal) : type.primitive,
      list: () => 'list',
      item: type => type.nominal ? Type.definitionName(type.nominal) : type.kind,
      entity: type => type.entity.name,
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
  static ofConstructorReference(type: AST.ConstructorTypeReference): TaoType {
    return new TypeResolutionContext().ofConstructorReference(type)
  }

  /** ofParameter resolves a parameter declaration's accepted Tao type. */
  static ofParameter(parameter: AST.ParameterDeclaration): TaoType {
    return new TypeResolutionContext().ofParameter(parameter)
  }

  /** ofExpression resolves the static Tao type of a value expression. */
  static ofExpression(expression: AST.Expression): TaoType {
    return new TypeResolutionContext().ofExpression(expression)
  }

  /** ofArgument resolves the static Tao type an invocation argument contributes for binding. */
  static ofArgument(argument: AST.Argument): TaoType {
    if (argument.type) {
      return Type.ofReference(argument.type)
    }
    return AST.isExpression(argument.value) ? Type.ofExpression(argument.value) : unresolvedType()
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

  /** shorthandPropertyDefinition resolves the same-name type used by a shorthand item field. */
  static shorthandPropertyDefinition(property: AST.TypeProperty): AST.TypeDeclaration | undefined {
    return property.type ? undefined : visibleTypeDeclaration(property, property.name)
  }

  /** isAssignable returns whether an actual value type can satisfy an expected parameter/property type. */
  static isAssignable(actual: TaoType, expected: TaoType): boolean {
    if (!typesHaveCompatibleBase(actual, expected)) {
      return false
    }
    if (nominalOf(expected)) {
      return actualSatisfiesExpectedNominal(actual, expected)
    }
    return true
  }

  /** isCastCompatible returns whether a value can be type-fixed through typed value creation. */
  static isCastCompatible(actual: TaoType, target: TaoType): boolean {
    if (!typesHaveCompatibleBase(actual, target)) {
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
      return `${type.kind}:${type.primitive}`
    }
    if (type.kind === 'entity') {
      return `entity:${AST.getDocument(type.entity).uri.path}#${type.entity.name}`
    }
    return type.kind
  }

  /** ofMemberAccess resolves the static type reached by a member access expression. */
  static ofMemberAccess(expression: AST.MemberAccessExpression): TaoType {
    return new TypeResolutionContext().ofMemberAccess(expression)
  }

  /** queryEntity resolves the entity selected by one query declaration. */
  static queryEntity(query: AST.QueryDeclaration): AST.DataEntity | undefined {
    return query.data.ref?.block.entities.find(entity => entity.collectionName === query.collectionName)
  }

  /** dataEntity resolves a schema entity by its singular source name. */
  static dataEntity(data: AST.DataDeclaration | undefined, name: string): AST.DataEntity | undefined {
    return data?.block.entities.find(entity => entity.name === name)
  }

  /** dataFieldType resolves the value type stored by a schema field. */
  static dataFieldType(field: AST.DataField): TaoType {
    if (field.primitive === 'text') {
      return primitiveType('text')
    }
    if (field.primitive === 'number') {
      return primitiveType('number')
    }
    if (field.primitive === 'boolean') {
      return primitiveType('boolean')
    }
    return field.relationName ? primitiveType('text') : unresolvedType()
  }

  /** definitionOfReference resolves a named type reference, including qualified item fields. */
  static definitionOfReference(reference: AST.NamedTypeReference): AST.TypeDefinition | undefined {
    const root = Type.rootOfReference(reference)
    return root.definition ? definitionAtMemberPath(root.definition, root.remainingMembers) : undefined
  }

  /** rootOfReference resolves the root definition and unresolved suffix of a named type reference. */
  static rootOfReference(reference: AST.NamedTypeReference): TypeReferenceRoot {
    const localParameterType = localInvocationParameterType(reference, reference.root)
    if (localParameterType) {
      return { definition: localParameterType, remainingMembers: reference.members }
    }

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

function isItemKind(type: TaoType): type is Extract<TaoType, { kind: 'item' }> {
  return type.kind === 'item'
}

function itemShape(type: TaoType): AST.ItemTypeExpression | undefined {
  return isItemKind(type) ? type.item : undefined
}

function typesHaveCompatibleBase(actual: TaoType, expected: TaoType): boolean {
  const bothTypesAreResolved = !isUnresolvedType(actual) && !isUnresolvedType(expected)
  const typesShareKind = actual.kind === expected.kind
  return bothTypesAreResolved && typesShareKind && !primitivesDiffer(actual, expected)
}

function primitivesDiffer(actual: TaoType, expected: TaoType): boolean {
  return isPrimitiveKind(actual) && isPrimitiveKind(expected) && actual.primitive !== expected.primitive
}

function nominalOf(type: TaoType): AST.TypeDefinition | undefined {
  return isUnresolvedType(type) || type.kind === 'entity' ? undefined : type.nominal
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
      NamedTypeReference: reference => {
        const definition = Type.definitionOfReference(reference)
        return definition ? this.ofDefinition(definition) : unresolvedType()
      },
      PrimitiveTypeReference: reference => primitiveType(reference.primitive),
    })
  }

  ofConstructorReference(type: AST.ConstructorTypeReference): TaoType {
    return Switch.type(type, {
      ConstructablePrimitiveTypeReference: reference => primitiveType(reference.primitive),
      NamedTypeReference: reference => {
        const definition = Type.definitionOfReference(reference)
        return definition ? this.ofDefinition(definition) : unresolvedType()
      },
    })
  }

  ofParameter(parameter: AST.ParameterDeclaration): TaoType {
    if (parameter.inlineType) {
      return this.ofDefinition(parameter.inlineType)
    }
    return parameter.type ? this.ofReference(parameter.type) : unresolvedType()
  }

  ofExpression(expression: AST.Expression): TaoType {
    return Switch.type(expression, {
      ActionExpression: () => primitiveType('action'),
      BinaryExpression: binary => this.binaryExpressionType(binary),
      BooleanLiteral: () => primitiveType('boolean'),
      ConditionalExpression: conditional => this.conditionalExpressionType(conditional),
      FunctionCallExpression: call =>
        call.function.ref ? this.ofReference(call.function.ref.returnType) : unresolvedType(),
      InterpolationExpression: () => primitiveType('text'),
      ListLiteral: list => this.listLiteralType(list),
      MemberAccessExpression: access => this.ofMemberAccess(access),
      NoneLiteral: () => primitiveType('none'),
      NumberLiteral: () => primitiveType('number'),
      StringLiteral: () => primitiveType('text'),
      TypedConstructor: constructor => this.ofConstructorReference(constructor.type),
      UnaryExpression: unary => unary.operator === 'not' ? primitiveType('boolean') : primitiveType('number'),
      ValueReference: reference => this.valueDeclarationType(reference.target.ref),
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

  private conditionalExpressionType(expression: AST.ConditionalExpression): TaoType {
    const whenTrue = this.ofExpression(expression.whenTrue)
    const whenFalse = this.ofExpression(expression.whenFalse)
    if (Type.isAssignable(whenTrue, whenFalse)) {
      return whenFalse
    }
    if (Type.isAssignable(whenFalse, whenTrue)) {
      return whenTrue
    }
    return unresolvedType()
  }

  private listLiteralType(list: AST.ListLiteral): TaoType {
    const first = list.elements[0]
    if (!first) {
      return { kind: 'list' }
    }
    const element = this.ofExpression(first)
    const homogeneous = list.elements.slice(1).every(candidate => {
      const candidateType = this.ofExpression(candidate)
      return Type.isAssignable(candidateType, element) || Type.isAssignable(element, candidateType)
    })
    return homogeneous && element.kind !== 'unresolved' ? { kind: 'list', element } : { kind: 'list' }
  }

  ofProperty(property: AST.TypeProperty): TaoType {
    return this.ofDefinition(property)
  }

  ofMemberAccess(expression: AST.MemberAccessExpression): TaoType {
    if (AST.isQueryDeclaration(expression.target.ref)) {
      const [first, ...remaining] = expression.members
      if (first === 'Loading') {
        return remaining.length === 0 ? primitiveType('boolean') : unresolvedType()
      }
      if (first === 'Error') {
        return this.atMemberPath(primitiveType('text'), remaining)
      }
    }
    const rootType = this.valueDeclarationType(expression.target.ref)
    return this.atMemberPath(rootType, expression.members)
  }

  private valueDeclarationType(declaration: AST.ValueDeclaration | undefined): TaoType {
    return Switch.typeMaybe<AST.ValueDeclaration | undefined, TaoType>(declaration, {
      ActionDeclaration: () => primitiveType('action'),
      AliasDeclaration: alias => this.aliasDeclarationType(alias),
      ForStatement: statement => this.forStatementBindingType(statement),
      ParameterDeclaration: parameter => this.ofParameter(parameter),
      QueryDeclaration: query => this.queryDeclarationType(query),
      StateDeclaration: state => this.stateDeclarationType(state),
      undefined: unresolvedType,
    })
  }

  private queryDeclarationType(query: AST.QueryDeclaration): TaoType {
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
    return this.ofExpression(alias.value)
  }

  private stateDeclarationType(state: AST.StateDeclaration): TaoType {
    if (this.stateAlreadySeen(state)) {
      return unresolvedType()
    }
    this.seenStates.add(state)
    return this.ofExpression(state.value)
  }

  private aliasAlreadySeen(declaration: AST.AliasDeclaration): boolean {
    return this.seenAliases.has(declaration)
  }

  private stateAlreadySeen(declaration: AST.StateDeclaration): boolean {
    return this.seenStates.has(declaration)
  }

  private atMemberPath(root: TaoType, members: readonly string[]): TaoType {
    let current = root
    for (const member of members) {
      if (
        (current.kind === 'list' || (current.kind === 'primitive' && current.primitive === 'text'))
        && member === 'Empty'
      ) {
        current = primitiveType('boolean')
        continue
      }
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
        const field = current.entity.block.fields.find(candidate => candidate.name === member)
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
    return Switch.type(definition, {
      ParameterTypeDeclaration: declaration => withNominal(this.ofExpressionType(declaration.type), declaration),
      TypeDeclaration: declaration => withNominal(this.ofExpressionType(declaration.type), declaration),
      TypeProperty: property => this.typePropertyType(property),
    })
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
      ItemTypeExpression: item => ({ kind: 'item', item }),
      NamedTypeReference: reference => this.ofReference(reference),
      PrimitiveTypeReference: reference => this.ofReference(reference),
    })
  }
}

function primitiveType(primitive: AST.PrimitiveType | 'none'): TaoType {
  return Switch(primitive, {
    text: () => ({ kind: 'primitive', primitive: 'text' }),
    number: () => ({ kind: 'primitive', primitive: 'number' }),
    boolean: () => ({ kind: 'primitive', primitive: 'boolean' }),
    action: () => ({ kind: 'primitive', primitive: 'action' }),
    none: () => ({ kind: 'primitive', primitive: 'none' }),
    list: () => ({ kind: 'list' }),
    item: () => ({ kind: 'item' }),
  })
}

function definitionIdentityName(type: AST.TypeDefinition): string {
  return `${AST.getDocument(type).uri.path}#${Type.definitionName(type)}`
}

function unresolvedType(): TaoType {
  return { kind: 'unresolved' }
}

function withNominal(type: TaoType, nominal: AST.TypeDefinition): TaoType {
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

function localInvocationParameterType(
  reference: AST.NamedTypeReference,
  name: string,
): AST.ParameterTypeDeclaration | undefined {
  const argument = owningArgumentTypeReference(reference)
  if (!argument) {
    return undefined
  }
  const invocation = argument.$container.$container
  const declaration = invocationTargetDeclaration(invocation)
  return declaration ? parameterTypeDeclarationNamed(declaration, name) : undefined
}

function owningArgumentTypeReference(reference: AST.NamedTypeReference): AST.Argument | undefined {
  const argument = reference.$container
  return AST.isArgument(argument) && argument.type === reference ? argument : undefined
}

function invocationTargetDeclaration(
  invocation: AST.Render | AST.DoStatement | AST.FunctionCallExpression | AST.PresentStatement,
): AST.ParameterizedDeclaration | undefined {
  if (AST.isRender(invocation)) {
    return invocation.view?.ref
  }
  if (AST.isFunctionCallExpression(invocation)) {
    return invocation.function.ref
  }
  if (AST.isPresentStatement(invocation)) {
    return invocation.stack.ref?.block.destinations.find(destination =>
      destination.view.$refText === invocation.destinationName
    )?.view.ref
  }
  const action = invocation.action
  if (!AST.isValueReference(action)) {
    return undefined
  }
  const target = action.target.ref
  return AST.isActionDeclaration(target) ? target : undefined
}

function itemConstructorProperty(reference: AST.NamedTypeReference, name: string): AST.TypeProperty | undefined {
  const itemType = owningItemLiteralType(reference)
  return itemType ? propertyNamed(itemType, name) : undefined
}

function owningItemLiteralType(reference: AST.NamedTypeReference): AST.ItemTypeExpression | undefined {
  let current: AST.Node | undefined = reference.$container
  if (AST.isTypedConstructor(current) && current.type === reference && AST.isItemLiteral(current.value)) {
    return undefined
  }
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
  if (AST.isArgument(parent) && parent.type && parent.value === item) {
    return itemShape(Type.ofReference(parent.type))
  }
  return undefined
}
