import { AST } from '@parser'
import { Switch } from '@shared'
import { parameterRequiresWritable } from './reactive-parameters'
import { type UnitFamily, Units } from './Units'

/** TaoType declares the static Tao type shape used by semantic helpers. */
export type TaoType =
  | {
    kind: 'primitive'
    primitive:
      | 'text'
      | 'number'
      | 'boolean'
      | 'time'
      | 'duration'
      | 'color'
      | 'none'
      | 'shortcut'
      | 'command'
      | 'design'
      | 'view'
      | 'scene'
      | 'nav'
      | 'datasource'
      | 'data'
      | 'app'
    nominal?: AST.TypeDefinition
    slots?: ItemShape
  }
  | {
    kind: 'primitive'
    primitive: 'action'
    parameters: readonly TaoActionParameter[]
    nominal?: AST.TypeDefinition
  }
  | { kind: 'list'; element?: TaoType; nominal?: AST.TypeDefinition }
  | { kind: 'item'; item?: ItemShape; nominal?: AST.TypeDefinition }
  | { kind: 'entity'; entity: DataEntityDefinition }
  | { kind: 'enum'; declaration: AST.TypeDeclaration }
  | { kind: 'union'; members: readonly TaoType[] }
  | { kind: 'unresolved' }

export type ItemShapeField = AST.TypeProperty | AST.EntityDataField

/** ItemShape is the effective slot surface of an item type, including projected data fields. */
export type ItemShape = {
  readonly properties: readonly AST.TypeProperty[]
  readonly dataFields?: readonly DataFieldDefinition[]
  readonly projectedEntity?: DataEntityDefinition
}

export type DataEntityDefinition = AST.EntityDataDeclaration
export type DataFieldDefinition = AST.EntityDataField
type QueryDefinition = AST.EntityQueryDeclaration

/** TaoActionParameter declares one positional input accepted by an action value. */
type TaoActionParameter = {
  name?: string
  type: TaoType
  optional: boolean
  /** writable stays internal: written action(...) contracts always promise readonly inputs. */
  writable: boolean
}

/** TypeReferenceRoot declares the root definition and remaining member path for a named type reference. */
type TypeReferenceRoot = {
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
    if (AST.isParameterDeclaration(declaration)) {
      return Type.parameterName(declaration)
    }
    return declaration.name ?? (AST.isCaseSetCase(declaration) ? declaration.literal ?? '' : '')
  }

  /** referenceName returns the source-facing name of a Tao type reference. */
  static referenceName(type: AnyTypeReference): string {
    return Switch.type(type, {
      ActionTypeReference: reference =>
        `action(${reference.parameterTypes.map(parameter => Type.referenceName(parameter)).join(', ')})`,
      ConstructablePrimitiveTypeReference: reference => reference.primitive,
      ListTypeReference: reference => `list of ${Type.referenceName(reference.elementType)}`,
      NamedTypeReference: reference => {
        return [reference.root, ...reference.members].join('.')
      },
      PrimitiveTypeReference: reference => reference.primitive,
    })
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
    const nominal = nominalOf(type)
    if (nominal) {
      return Type.definitionName(nominal)
    }
    return Switch.kind(type, {
      unresolved: () => 'unresolved',
      primitive: type => isActionType(type) ? actionDisplayName(type) : type.primitive,
      list: type => type.element ? `list of ${Type.displayName(type.element)}` : 'list',
      item: type => type.kind,
      entity: type => Type.dataEntityName(type.entity),
      enum: type => type.declaration.name,
      union: type => type.members.map(Type.displayName).join(' | '),
    })
  }

  /** ofReference resolves a type reference to the Tao type it denotes. */
  static ofReference(type: AST.TypeReference): TaoType {
    return new TypeResolutionContext().ofReference(type)
  }

  /** ofTypeExpression resolves any type expression, including inline item and case-set types. */
  static ofTypeExpression(type: AST.TypeExpression): TaoType {
    return new TypeResolutionContext().ofTypeExpression(type)
  }

  /** ofDefinition resolves a type definition to the Tao type it denotes. */
  static ofDefinition(type: AST.TypeDefinition): TaoType {
    return new TypeResolutionContext().ofDefinition(type)
  }

  /** ofConstructorReference resolves a typed constructor's type prefix. */
  static ofConstructorReference(type: AST.ConstructablePrimitiveTypeReference): TaoType {
    return primitiveType(type.primitive)
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
  static ofValueDeclaration(declaration: AST.ValueDeclaration | undefined, context?: AST.Node): TaoType {
    const resolution = new TypeResolutionContext()
    return context ? resolution.ofContextualValue(declaration, context) : resolution.ofValueDeclaration(declaration)
  }

  /** ofFunctionReturn resolves an explicit function result or infers it from every return statement. */
  static ofFunctionReturn(declaration: AST.FunctionDeclaration): TaoType {
    return new TypeResolutionContext().ofFunctionReturn(declaration)
  }

  /** atMemberPath resolves a member suffix from an already-resolved root type. */
  static atMemberPath(root: TaoType, members: readonly string[]): TaoType {
    return new TypeResolutionContext().atMemberPath(root, members)
  }

  /** ofConfiguredValue resolves one declaration-linked named constructor. */
  static ofConfiguredValue(value: AST.ConfiguredValue): TaoType {
    const declaration = value.type.ref
    const typeOfParameterizedDeclaration = (declaration: AST.ParameterizedDeclaration): TaoType => {
      const [member, ...remainingMembers] = value.members ?? []
      const parameterType = member ? parameterTypeDeclarationNamed(declaration, member) : undefined
      return parameterType
        ? Type.atMemberPath(Type.ofDefinition(parameterType), remainingMembers)
        : unresolvedType()
    }
    return Switch.typeMaybe<typeof declaration, TaoType>(declaration, {
      TypeDeclaration: declaration => Type.atMemberPath(Type.ofDefinition(declaration), value.members ?? []),
      ActionDeclaration: typeOfParameterizedDeclaration,
      CommandDeclaration: typeOfParameterizedDeclaration,
      FunctionDeclaration: typeOfParameterizedDeclaration,
      PhraseDeclaration: typeOfParameterizedDeclaration,
      ViewDeclaration: typeOfParameterizedDeclaration,
      undefined: unresolvedType,
    })
  }

  /** ofInferredConfiguration resolves a bare block from its same-name declaration context. */
  static ofInferredConfiguration(value: AST.InferredConfigurationConstructor): TaoType {
    const declaration = Type.inferredConfigurationDeclaration(value)
    return declaration ? Type.ofDefinition(declaration) : unresolvedType()
  }

  /** inferredConfigurationDeclaration resolves a bare block's same-name visible type declaration
   * from its alias or app-property owner. */
  static inferredConfigurationDeclaration(
    value: AST.InferredConfigurationConstructor,
  ): AST.TypeDeclaration | undefined {
    const owner = value.$container
    const name = AST.isAliasDeclaration(owner) || AST.isAppProperty(owner) ? owner.name : undefined
    return name ? visibleTypeDeclaration(value, name) : undefined
  }

  /** ofValue resolves an ordinary expression or configured runtime value. */
  static ofValue(value: AST.Expression | AST.ConfiguredValue): TaoType {
    return Type.ofExpression(value)
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
  static constructorReferenceItemType(type: AnyTypeReference): ItemShape | undefined {
    const resolved = AST.isConstructablePrimitiveTypeReference(type)
      ? Type.ofConstructorReference(type)
      : Type.ofReference(type)
    return itemShape(resolved)
  }

  /** slotsOf returns the supplied-slot shape carried by an item or primitive-family type. */
  static slotsOf(type: TaoType): ItemShape | undefined {
    return slotShape(type)
  }

  static itemFields(shape: ItemShape): readonly ItemShapeField[] {
    return [...shape.properties, ...(shape.dataFields ?? [])]
  }

  static itemFieldType(field: ItemShapeField): TaoType {
    return AST.isEntityDataField(field) ? Type.dataFieldType(field) : Type.ofProperty(field)
  }

  static itemFieldIsFilled(field: ItemShapeField): field is AST.TypeProperty {
    return AST.isTypeProperty(field) && Type.propertyIsFilled(field)
  }

  static itemFieldRequiresValue(field: ItemShapeField): boolean {
    return AST.isEntityDataField(field) ? !field.optional : Type.propertyRequiresValue(field)
  }

  static projectedEntityOf(type: TaoType): DataEntityDefinition | undefined {
    return type.kind === 'item' ? type.item?.projectedEntity : undefined
  }

  /** ofProperty resolves the expected value type of one item property declaration. */
  static ofProperty(property: AST.TypeProperty): TaoType {
    return new TypeResolutionContext().ofProperty(property)
  }

  /**
   * ofDeclarationFamily returns the family a declaration belongs to when it is *named* rather than
   * read. The two differ wherever naming a declaration is not the same as evaluating it: a command
   * named on a toolbar is a `command`, though invoking it yields an action, and a collection named
   * in a datasource's membership is `data`, though reading it yields a list of rows. Reference
   * blocks list declarations, so this is the type their entries are checked against.
   */
  static ofDeclarationFamily(declaration: AST.Node): TaoType {
    if (AST.isCommandDeclaration(declaration)) {
      return primitiveType('command')
    }
    if (AST.isEntityDataDeclaration(declaration)) {
      return primitiveType('data')
    }
    return AST.isValueDeclaration(declaration) ? Type.ofValueDeclaration(declaration) : unresolvedType()
  }

  /** ofNone is the type of absence, the value an optional member takes when it has none. */
  static ofNone(): TaoType {
    return primitiveType('none')
  }

  /** ofPropertyRead resolves a field read, including absence for an optional field. */
  static ofPropertyRead(property: AST.TypeProperty): TaoType {
    const declared = Type.ofProperty(property)
    return property.optional
      ? { kind: 'union', members: [declared, primitiveType('none')] }
      : declared
  }

  /** propertyIsFilled identifies a slot whose declaration fixes its value rather than only its type. */
  static propertyIsFilled(property: AST.TypeProperty): boolean {
    return property.type === undefined && property.value !== undefined
  }

  /** propertyHasDefault identifies a typed slot whose declared value can be overridden by construction. */
  static propertyHasDefault(property: AST.TypeProperty): boolean {
    return property.type !== undefined && property.value !== undefined
  }

  /** propertyRequiresValue identifies an open supplied slot that construction must fill. */
  static propertyRequiresValue(property: AST.TypeProperty): boolean {
    return !property.optional && property.value === undefined
  }

  /** ofConfigurationProperty resolves a nav/datasource contract property's accepted Tao type. */
  static ofConfigurationProperty(property: AST.ConfigurationProperty): TaoType {
    return AST.configurationPropertyIsKey(property)
      ? primitiveType('text')
      : property.type
      ? Type.ofReference(property.type)
      : 'value' in property && property.value
      ? Type.ofExpression(property.value)
      : unresolvedType()
  }

  /** shorthandPropertyDefinition resolves the same-name type used by a shorthand item field. */
  static shorthandPropertyDefinition(property: AST.TypeProperty): AST.TypeDeclaration | undefined {
    return property.type || property.value ? undefined : visibleTypeDeclaration(property, property.name)
  }

  /** visibleDeclaration resolves a type name in the lexical file/import scope of a node. */
  static visibleDeclaration(node: AST.Node, name: string): AST.TypeDeclaration | undefined {
    return visibleTypeDeclaration(node, name)
  }

  /**
   * isAssignableToSlot is assignability at a supplied slot, where a slot that takes a list also
   * takes a single value as a one-element list. That is what keeps `Datasource Local { … }` legal
   * beside `Datasource { News, Personal }`: an app binding one datasource is the ordinary case, and
   * writing braces around it would be ceremony. It is a slot rule rather than a rule of the type
   * system, so nothing else silently widens a value into a list.
   */
  static isAssignableToSlot(actual: TaoType, expected: TaoType): boolean {
    if (Type.isAssignable(actual, expected)) {
      return true
    }
    return expected.kind === 'list' && expected.element !== undefined
      && Type.isAssignable(actual, expected.element)
  }

  /** isAssignable returns whether an actual value type can satisfy an expected parameter/property type. */
  static isAssignable(actual: TaoType, expected: TaoType): boolean {
    // A bare key is written as text and read as the shortcut it names, the way a bare number in
    // size position is read as a size. The reverse is not true: a shortcut is not text.
    if (isPrimitiveNamed(expected, 'shortcut') && isPrimitiveNamed(actual, 'text')) {
      return true
    }
    // Every value the actual can be must be one the expected accepts. Distributing the actual side
    // first is what lets an optional satisfy an optional: asking instead whether the whole actual
    // union fits one member of the expected union would reject it.
    if (actual.kind === 'union') {
      return actual.members.every(member => Type.isAssignable(member, expected))
    }
    if (expected.kind === 'union') {
      return expected.members.some(member => Type.isAssignable(actual, member))
    }
    if (!typesHaveCompatibleBase(actual, expected)) {
      return false
    }
    if (actual.kind === 'list' && expected.kind === 'list' && !listTypeIsAssignable(actual, expected)) {
      return false
    }
    return nominalOf(expected) ? actualSatisfiesExpectedNominal(actual, expected) : true
  }

  /** commonType returns a branch-safe type that every resolved input can satisfy. */
  static commonType(types: readonly TaoType[]): TaoType | undefined {
    if (types.length === 0 || types.some(isUnresolvedType)) {
      return undefined
    }

    const candidates = types.filter(candidate => types.every(actual => Type.isAssignable(actual, candidate)))
    const best = candidates.reduce<TaoType | undefined>((best, candidate) => {
      if (!best) {
        return candidate
      }
      return commonTypeCandidateIsPreferred(candidate, best) ? candidate : best
    }, undefined)
    if (best) {
      return best
    }
    // Absence unifies with any one value type, because that is what an optional already is: an
    // optional field reads as `union(declared, none)`. So a conditional whose branches are a value
    // and `none` produces the optional of that value rather than nothing at all.
    const present = types.filter(type => !isPrimitiveNamed(type, 'none'))
    if (present.length === types.length || present.length === 0) {
      return undefined
    }
    const common = Type.commonType(present)
    return common && { kind: 'union', members: [common, primitiveType('none')] }
  }

  /** entityOfReference resolves a top-level entity's singular type name. */
  static entityOfReference(reference: AST.NamedTypeReference): DataEntityDefinition | undefined {
    return reference.members.length === 0
      ? Type.visibleDataEntities(reference).find(entity => entity.singularName === reference.root)
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
    return Switch.kind(type, {
      primitive: type =>
        isActionType(type)
          ? `primitive:action(${type.parameters.map(actionParameterIdentityKey).join(',')})`
          : `${type.kind}:${type.primitive}`,
      list: type => `list:${type.element ? Type.identityKey(type.element) ?? 'unresolved' : 'unknown'}`,
      item: type => type.kind,
      entity: type => `entity:${AST.getDocument(type.entity).uri.path}#${Type.dataEntityName(type.entity)}`,
      enum: type => `enum:${AST.getDocument(type.declaration).uri.path}#${type.declaration.name}`,
      union: type => `union:${type.members.map(member => Type.identityKey(member) ?? 'unresolved').join('|')}`,
    })
  }

  /** unitFamilyOf returns the unit family a resolved type belongs to, if it is a unit value. */
  static unitFamilyOf(type: TaoType): UnitFamily | undefined {
    return primitiveUnitFamily(type)
  }

  /**
   * unitMemberType resolves one member read on a unit value: a unit of the family reads back as a
   * number, and a declared reading has its own type.
   */
  static unitMemberType(family: UnitFamily, member: string): TaoType | undefined {
    if (Units.readingOf(family, member)) {
      return primitiveType('text')
    }
    return Units.ratioToBase(family, member) === undefined ? undefined : primitiveType('number')
  }

  /** requiredSentence returns the sentence a field's `required` trait states, when it has one. */
  static requiredSentence(field: DataFieldDefinition): string | undefined {
    return (field.traits?.traits ?? []).find(AST.traitIsRequired)?.sentence
  }

  /**
   * completenessFieldsOf returns the fields whose `required` sentences a value's `Incomplete` and
   * `Problems` read: an entity row's own fields, or the ones a projection selected. Any other type
   * has no completeness members.
   */
  static completenessFieldsOf(type: TaoType): readonly DataFieldDefinition[] | undefined {
    if (type.kind === 'entity') {
      return Type.dataFields(type.entity)
    }
    return type.kind === 'item' && type.item?.projectedEntity ? type.item.dataFields ?? [] : undefined
  }

  /**
   * isCompletenessMember is whether reading `member` on `type` is a derived completeness read. Such a
   * member is computed from the `required` fields, never stored, so it is not a writable path.
   */
  static isCompletenessMember(type: TaoType, member: string): boolean {
    return Type.completenessFieldsOf(type) !== undefined && Type.completenessMemberType(member) !== undefined
  }

  /** completenessMemberDepth returns how many members a path reads up to a completeness member. */
  static completenessMemberDepth(root: TaoType, members: readonly string[]): number | undefined {
    let type = root
    for (const [index, member] of members.entries()) {
      if (Type.isCompletenessMember(type, member)) {
        return index + 1
      }
      type = Type.atMemberPath(type, [member])
    }
    return undefined
  }

  /** completenessMemberType resolves completeness flags and problems derived from required fields. */
  static completenessMemberType(member: string): TaoType | undefined {
    if (member === 'Incomplete' || member === 'IsIncomplete' || member === 'IsComplete') {
      return primitiveType('boolean')
    }
    return member === 'Problems' ? { kind: 'list', element: primitiveType('text') } : undefined
  }

  /** entityBuiltinMemberType resolves the runtime write-status members available on every entity. */
  static entityBuiltinMemberType(member: string): TaoType | undefined {
    if (member === 'WritesQueued' || member === 'WritesFailed') {
      return primitiveType('number')
    }
    if (member === 'WriteError') {
      return primitiveType('text')
    }
    return member === 'CanRetryWrites' ? primitiveType('boolean') : undefined
  }

  /** dimensionalResult returns the type an operator yields over unit values, or none when illegal. */
  static dimensionalResult(left: TaoType, operator: string, right: TaoType): TaoType | undefined {
    return left.kind === 'unresolved' || right.kind === 'unresolved'
      ? { kind: 'unresolved' }
      : dimensionalResultType(left, operator, right)
  }

  /** ofMemberAccess resolves the static type reached by a member access expression. */
  static ofMemberAccess(expression: AST.MemberAccessExpression): TaoType {
    return new TypeResolutionContext().ofMemberAccess(expression)
  }

  /** dataFieldOfMemberAccess returns the declaration reached by an entity member path. */
  static dataFieldOfMemberAccess(expression: AST.MemberAccessExpression): DataFieldDefinition | undefined {
    let current = Type.ofValueDeclaration(expression.target.ref)
    let reached: DataFieldDefinition | undefined
    for (const member of expression.members) {
      reached = current.kind === 'entity' ? dataFieldNamed(current.entity, member) : undefined
      if (!reached) {
        return undefined
      }
      current = Type.dataFieldType(reached)
    }
    return reached
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

  /** dataFields returns the stored and inferred field declarations of one entity. */
  static dataFields(entity: DataEntityDefinition): DataFieldDefinition[] {
    return entity.block.entries.filter(AST.isEntityDataField)
  }

  /**
   * dataEntityTitleField returns the one field an entity marks `(title)`: the text that names a row
   * to a person, which the outline prefers as a row's label and reads when no rendered text is.
   */
  static dataEntityTitleField(entity: DataEntityDefinition): DataFieldDefinition | undefined {
    return Type.dataFields(entity).find(field => (field.traits?.traits ?? []).some(AST.traitIsTitle))
  }

  /** dataEntityIsLocalOnly returns whether an entity declares the device-local storage fact. */
  static dataEntityIsLocalOnly(entity: DataEntityDefinition): boolean {
    return entity.block.entries.some(AST.isDataLocalOnly)
  }

  /** dataFieldRelationName returns the explicit relation target, or the field name when it is
   * the same as the entity it references. */
  static dataFieldRelationName(field: DataFieldDefinition): string {
    const traits = field.traits?.traits ?? []
    return field.typeName
      ?? traits.find(trait => trait.relationName)?.relationName
      ?? traits.find(trait => trait.referenceName)?.referenceName
      ?? field.name
  }

  /**
   * dataFieldIsReference identifies the weaker cross-store link. A `relation` resolves inside one
   * store's rows; a `reference` stores the target's `unique` value and resolves to a live handle in
   * whichever store owns that entity, so it is the only link a bookmark in one datasource can hold
   * to a story in another.
   */
  static dataFieldIsReference(field: DataFieldDefinition): boolean {
    return (field.traits?.traits ?? []).some(trait => trait.reference)
  }

  /** dataFieldRelationEntity resolves a stored or inverse relationship target. */
  static dataFieldRelationEntity(field: DataFieldDefinition): DataEntityDefinition | undefined {
    if (field.primitive || field.boolean) {
      return undefined
    }
    const relationName = Type.dataFieldRelationName(field)
    return Type.visibleDataEntities(field).find(entity =>
      entity.singularName === relationName || entity.name === relationName
    )
  }

  /** dataFieldIsInverseRelation distinguishes plural owner-side relations from stored handles. */
  static dataFieldIsInverseRelation(field: DataFieldDefinition): boolean {
    if (field.primitive || field.boolean) {
      return false
    }
    const relationName = Type.dataFieldRelationName(field)
    return Type.visibleDataEntities(field).some(entity => entity.name === relationName)
  }

  /** topLevelDataEntities returns the current provider-neutral catalog declarations in a file. */
  static topLevelDataEntities(node: AST.Node): AST.EntityDataDeclaration[] {
    const root = AST.findRoot(node)
    return AST.isTaoFile(root) ? root.statements.filter(AST.isEntityDataDeclaration) : []
  }

  /** visibleDataEntities returns local plus use-imported catalog declarations for a node. */
  static visibleDataEntities(node: AST.Node): AST.EntityDataDeclaration[] {
    return AST.visibleFileDeclarations(node, AST.isEntityDataDeclaration)
  }

  /** dataFieldType resolves the value type stored by a schema field. */
  static dataFieldType(field: DataFieldDefinition): TaoType {
    if (field.primitive || field.boolean) {
      return primitiveType(field.primitive ?? 'boolean')
    }
    const relation = Type.dataFieldRelationEntity(field)
    if (!relation) {
      const definition = visibleTypeDeclaration(field, field.typeName ?? field.name)
      return definition ? Type.ofDefinition(definition) : unresolvedType()
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

/** unitFamilyOfPrimitive returns the unit family a primitive type names, if it is one. */
function unitFamilyOfPrimitive(primitive: string): UnitFamily | undefined {
  return Units.isFamily(primitive) ? primitive : undefined
}

/**
 * Dimensional analysis (Decisions §2): a unit value added to or subtracted from its own family stays
 * in it, scaling by a bare number stays in it, dividing two of a family yields a number, and the
 * calendar pairs relate `time` and `duration`. Everything else is rejected by the validator.
 */
function dimensionalResultType(
  left: TaoType,
  operator: string,
  right: TaoType,
): TaoType | undefined {
  const leftFamily = primitiveUnitFamily(left)
  const rightFamily = primitiveUnitFamily(right)
  const leftIsTime = isPrimitiveNamed(left, 'time')
  const rightIsTime = isPrimitiveNamed(right, 'time')
  if (leftIsTime && rightIsTime) {
    return operator === '-' ? primitiveType('duration') : undefined
  }
  if (leftIsTime && rightFamily === 'duration') {
    return operator === '+' || operator === '-' ? primitiveType('time') : undefined
  }
  if (!leftFamily && !rightFamily) {
    return undefined
  }
  if (leftFamily && leftFamily === rightFamily) {
    return operator === '+' || operator === '-'
      ? primitiveType(leftFamily)
      : operator === '/'
      ? primitiveType('number')
      : undefined
  }
  if (leftFamily && isPrimitiveNamed(right, 'number')) {
    return operator === '*' || operator === '/' ? primitiveType(leftFamily) : undefined
  }
  if (rightFamily && isPrimitiveNamed(left, 'number')) {
    return operator === '*' ? primitiveType(rightFamily) : undefined
  }
  return undefined
}

function primitiveUnitFamily(type: TaoType): UnitFamily | undefined {
  return isPrimitiveKind(type) ? unitFamilyOfPrimitive(type.primitive) : undefined
}

function isPrimitiveNamed(type: TaoType, primitive: string): boolean {
  return isPrimitiveKind(type) && type.primitive === primitive
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

function itemShape(type: TaoType): ItemShape | undefined {
  return isItemKind(type) ? type.item : undefined
}

function slotShape(type: TaoType): ItemShape | undefined {
  return type.kind === 'item'
    ? type.item
    : type.kind === 'primitive' && 'slots' in type
    ? type.slots
    : undefined
}

/** typesHaveCompatibleBase is the agreement on kind, declaration, and callback signature that both
 * assignability and casting require before either applies its own rules. */
function typesHaveCompatibleBase(actual: TaoType, expected: TaoType): boolean {
  const bothTypesAreResolved = !isUnresolvedType(actual) && !isUnresolvedType(expected)
  const typesShareKind = actual.kind === expected.kind
  if (!bothTypesAreResolved || !typesShareKind || !primitiveFamilyIsAssignable(actual, expected)) {
    return false
  }
  if (actual.kind === 'entity' && expected.kind === 'entity') {
    return actual.entity === expected.entity
  }
  if (actual.kind === 'enum' && expected.kind === 'enum') {
    return actual.declaration === expected.declaration
  }
  if (isActionType(actual) && isActionType(expected)) {
    return actionTypeIsAssignable(actual, expected)
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

  // One of them is the more specific exactly when assignability runs one way and not the other.
  const currentAcceptsCandidate = Type.isAssignable(candidate, current)
  const candidateAcceptsCurrent = Type.isAssignable(current, candidate)
  if (currentAcceptsCandidate !== candidateAcceptsCurrent) {
    return currentAcceptsCandidate
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
    return actualParameter !== undefined
      && (!actualParameter.writable || parameter.writable)
      && Type.isAssignable(parameter.type, actualParameter.type)
  })
}

function actionDisplayName(type: Extract<TaoType, { kind: 'primitive'; primitive: 'action' }>): string {
  const parameters = type.parameters.map(parameter =>
    `${parameter.writable ? 'writable ' : ''}${Type.displayName(parameter.type)}${parameter.optional ? '?' : ''}`
  )
  return `action(${parameters.join(', ')})`
}

function actionParameterIdentityKey(parameter: TaoActionParameter): string {
  return `${Type.identityKey(parameter.type) ?? 'unresolved'}${parameter.optional ? '?' : ''}${
    parameter.writable ? '!' : ''
  }`
}

function primitiveFamilyIsAssignable(actual: TaoType, expected: TaoType): boolean {
  if (!isPrimitiveKind(actual) || !isPrimitiveKind(expected)) {
    return true
  }
  if (actual.primitive === expected.primitive) {
    return true
  }
  // The primitive lattice mirrors the Prelude's `is` chain: `nav` refines `scene` refines `view`,
  // and nothing else refines anything. The walk below follows the whole chain, so a nav stays
  // assignable to a view through scene.
  const parents: Partial<Record<Extract<TaoType, { kind: 'primitive' }>['primitive'], string>> = {
    nav: 'scene',
    scene: 'view',
  }
  return chainFrom(actual.primitive as string, current => parents[current as keyof typeof parents])
    .includes(expected.primitive)
}

/** chainFrom walks a parent link from `start` upwards, stopping where the chain repeats itself. */
function chainFrom<ValueT>(start: ValueT, parentOf: (value: ValueT) => ValueT | undefined): ValueT[] {
  const chain: ValueT[] = []
  for (
    let current: ValueT | undefined = start;
    current !== undefined && !chain.includes(current);
    current = parentOf(current)
  ) {
    chain.push(current)
  }
  return chain
}

function nominalOf(type: TaoType): AST.TypeDefinition | undefined {
  return canCarryNominal(type) ? type.nominal : undefined
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
  return (AST.isParameterTypeDeclaration(expected) && isStructuralTypeReference(expected.type))
    || (
      AST.isTypeProperty(expected)
      && AST.isPrimitiveDeclaration(expected.$container.$container)
      && expected.type !== undefined
      && isStructuralTypeReference(expected.type)
    )
}

function isStructuralTypeReference(type: AST.TypeExpression): boolean {
  return AST.isPrimitiveTypeReference(type) || AST.isListTypeReference(type)
}

function nominalsAreCastCompatible(from: AST.TypeDefinition, target: AST.TypeDefinition): boolean {
  return nominalChain(from).includes(target) || nominalChain(target).includes(from)
}

function propertyNamed(itemType: ItemShape, name: string): ItemShapeField | undefined {
  return Type.itemFields(itemType).find(property => property.name === name)
}

function typePropertyNamed(itemType: ItemShape, name: string): AST.TypeProperty | undefined {
  return itemType.properties.find(property => property.name === name)
}

function dataFieldNamed(entity: DataEntityDefinition, name: string): DataFieldDefinition | undefined {
  return Type.dataFields(entity).find(field => field.name === name)
}

/**
 * memberType resolves one member read on an already-resolved type, or nothing where the type has no
 * such member: a count, a unit reading, an entity field, or an item property.
 */
function memberType(current: TaoType, member: string): TaoType | undefined {
  if (member === 'Count' && (current.kind === 'list' || isPrimitiveNamed(current, 'text'))) {
    return primitiveType('number')
  }
  const family = primitiveUnitFamily(current)
  if (family) {
    return Type.unitMemberType(family, member)
  }
  const completeness = Type.completenessFieldsOf(current) && Type.completenessMemberType(member)
  if (completeness) {
    return completeness
  }
  if (current.kind === 'entity') {
    if (member === 'Id') {
      return primitiveType('text')
    }
    const builtin = Type.entityBuiltinMemberType(member)
    if (builtin) {
      return builtin
    }
    const field = dataFieldNamed(current.entity, member)
    return field && Type.dataFieldType(field)
  }
  const property = isItemKind(current) && current.item ? propertyNamed(current.item, member) : undefined
  return property && (AST.isEntityDataField(property) ? Type.dataFieldType(property) : Type.ofPropertyRead(property))
}

class TypeResolutionContext {
  /** resolving holds what this context is already resolving, so a declaration that reaches itself
   * resolves to unresolved instead of recursing forever. */
  private readonly resolving = new Set<AST.Node>()

  /** withoutCycles resolves one declaration, yielding unresolved when it is already being resolved. */
  private withoutCycles(declaration: AST.Node, resolve: () => TaoType): TaoType {
    if (this.resolving.has(declaration)) {
      return unresolvedType()
    }
    this.resolving.add(declaration)
    try {
      return resolve()
    } finally {
      this.resolving.delete(declaration)
    }
  }

  ofReference(type: AST.TypeReference): TaoType {
    return Switch.type(type, {
      ActionTypeReference: reference =>
        actionType(
          reference.parameterTypes.map(parameter => ({
            type: this.ofReference(parameter),
            optional: false,
            writable: false,
          })),
        ),
      ListTypeReference: reference => ({ kind: 'list', element: this.ofReference(reference.elementType) }),
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

  ofParameter(parameter: AST.ParameterDeclaration): TaoType {
    if (parameter.inlineType) {
      return this.ofDefinition(parameter.inlineType)
    }
    const declared = parameter.type ? this.ofReference(parameter.type) : unresolvedType()
    return parameter.optional
      ? { kind: 'union', members: [declared, primitiveType('none')] }
      : declared
  }

  ofExpression(expression: AST.Expression): TaoType {
    return Switch.type(expression, {
      ActionExpression: () => actionType([]),
      BinaryExpression: binary => this.binaryExpressionType(binary),
      NowExpression: () => primitiveType('time'),
      // A bridged value has no Tao expression to read a type from; its declaration states one.
      FromExpression: () => unresolvedType(),
      PostfixMemberAccess: access => this.postfixMemberAccessType(access),
      BooleanLiteral: () => primitiveType('boolean'),
      CaseTestExpression: () => primitiveType('boolean'),
      ConfigurationConstructor: value => Type.ofConfiguredValue(value),
      InferredConfigurationConstructor: value => Type.ofInferredConfiguration(value),
      PrimitiveConfigurationConstructor: value => primitiveType(value.primitive),
      CopyExpression: copy => copy.type ? this.ofReference(copy.type) : this.ofExpression(copy.value),
      RefinementExpression: reference => {
        const target = reference.target.ref
        if (AST.isCommandDeclaration(target)) {
          return this.ofCommandBinding(target, reference.patchBlock)
        }
        return AST.isTypeDeclaration(target)
          ? this.ofDefinition(target)
          : AST.isValueDeclaration(target)
          ? this.ofValueDeclaration(target)
          : unresolvedType()
      },
      WhenExpression: when => this.whenExpressionType(when),
      FunctionCallExpression: call => this.functionCallExpressionType(call),
      InterpolatedString: () => primitiveType('text'),
      ListLiteral: list => this.listLiteralType(list),
      MemberAccessExpression: access => this.ofMemberAccess(access),
      NoneLiteral: () => primitiveType('none'),
      NumberLiteral: () => primitiveType('number'),
      StringLiteral: () => primitiveType('text'),
      TypedConstructor: constructor => Type.ofConstructorReference(constructor.type),
      UnaryExpression: unary => this.unaryExpressionType(unary),
      ValueReference: reference => this.ofContextualValue(reference.target.ref, reference),
    })
  }

  /**
   * A postfix member on a number constructs a unit value of that unit's family, and the same member
   * on a value of the family reads it back as a number. A family may also expose named readings.
   */
  private postfixMemberAccessType(access: AST.PostfixMemberAccess): TaoType {
    const receiver = this.ofExpression(access.receiver)
    if (!isPrimitiveKind(receiver)) {
      return unresolvedType()
    }
    if (receiver.primitive === 'number') {
      const family = Units.familyOf(access.member)
      return family ? primitiveType(family) : unresolvedType()
    }
    const family = unitFamilyOfPrimitive(receiver.primitive)
    return family ? Type.unitMemberType(family, access.member) ?? unresolvedType() : unresolvedType()
  }

  /** Negating a unit value keeps its family; every other unary result is fixed by its operator. */
  private unaryExpressionType(expression: AST.UnaryExpression): TaoType {
    if (expression.operator === 'not') {
      return primitiveType('boolean')
    }
    const operand = this.ofExpression(expression.operand)
    return primitiveUnitFamily(operand) ? operand : primitiveType('number')
  }

  private binaryExpressionType(expression: AST.BinaryExpression): TaoType {
    if (['==', '!=', '<', '<=', '>', '>=', 'and', 'or'].includes(expression.operator)) {
      return primitiveType('boolean')
    }
    const left = this.ofExpression(expression.left)
    if (expression.operator === '+' && left.kind === 'primitive' && left.primitive === 'shortcut') {
      return primitiveType('shortcut')
    }
    if (expression.operator === '+' && left.kind === 'primitive' && left.primitive === 'text') {
      return primitiveType('text')
    }
    const right = this.ofExpression(expression.right)
    return dimensionalResultType(left, expression.operator, right) ?? primitiveType('number')
  }

  private whenExpressionType(expression: AST.WhenExpression): TaoType {
    const outcomes = AST.whenExpressionOutcomes(expression)
    const types = outcomes.values.map(value => this.ofExpression(value))
    return Type.commonType(outcomes.total ? types : [...types, primitiveType('none')]) ?? unresolvedType()
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
    const target = expression.target.ref
    // A shade is a design color family member (`schemeAccent.20`); nothing else has one.
    if (expression.shade !== undefined) {
      return AST.isDesignColorEntry(target) && AST.designColorShade(target, expression.shade)
        ? primitiveType('color')
        : unresolvedType()
    }
    return this.atMemberPath(this.ofContextualValue(target, expression), expression.members)
  }

  ofContextualValue(declaration: AST.ValueDeclaration | undefined, context: AST.Node): TaoType {
    if (AST.isAuthLibraryDeclaration(declaration, 'Account')) {
      const entity = Type.visibleDataEntities(context).find(candidate => candidate.singularName === 'Account')
      return entity ? { kind: 'entity', entity } : unresolvedType()
    }
    return this.ofValueDeclaration(declaration)
  }

  ofValueDeclaration(declaration: AST.ValueDeclaration | undefined): TaoType {
    return Switch.typeMaybe<AST.ValueDeclaration | undefined, TaoType>(declaration, {
      ActionDeclaration: declaration => this.ofAction(declaration),
      CommandDeclaration: command => this.ofAction(command),
      AliasDeclaration: alias => this.aliasDeclarationType(alias),
      AppDeclaration: declaration => declaration.value ? this.ofExpression(declaration.value) : primitiveType('app'),
      AskStatement: ask =>
        ask.view.ref?.response?.ref
          ? { kind: 'enum', declaration: ask.view.ref.response.ref }
          : unresolvedType(),
      CasePayload: () => primitiveType('text'),
      EntityDataField: field => field.negativeName ? primitiveType('boolean') : unresolvedType(),
      EntityQueryDeclaration: query => this.queryDeclarationType(query),
      CaseSetCase: caseSetCase => ({ kind: 'enum', declaration: AST.caseSetOwningCase(caseSetCase) }),
      ForStatement: statement => this.forStatementBindingType(statement),
      ParameterDeclaration: parameter => this.ofParameter(parameter),
      DatasourceDeclaration: declaration =>
        declaration.value ? this.ofExpression(declaration.value) : primitiveType('datasource'),
      DesignDeclaration: () => primitiveType('design'),
      DesignColorEntry: () => primitiveType('color'),
      DesignToken: () => primitiveType('color'),
      NavDeclaration: declaration => declaration.value ? this.ofExpression(declaration.value) : primitiveType('nav'),
      PhraseDeclaration: () => primitiveType('text'),
      StateDeclaration: state => this.stateDeclarationType(state),
      ViewDeclaration: declaration => primitiveType(declaration.scene ? 'scene' : 'view'),
      undefined: unresolvedType,
    })
  }

  /** A command invokes exactly as an action does: its parameters are its slots. */
  ofAction(declaration: AST.ActionDeclaration | AST.CommandDeclaration): TaoType {
    return this.actionTypeOfParameters(AST.parametersOf(declaration))
  }

  /**
   * A command bound with `with { ... }` still invokes as an action, but only over the slots the
   * binding left open, so what a surface or a later `do` hands it is exactly what it still needs.
   */
  private ofCommandBinding(command: AST.CommandDeclaration, block: AST.ConfigurationBlock): TaoType {
    const filled = new Set(block.entries.map(AST.configurationEntryName))
    return this.actionTypeOfParameters(
      AST.parametersOf(command).filter(parameter => !filled.has(Type.parameterName(parameter))),
    )
  }

  private actionTypeOfParameters(parameters: readonly AST.ParameterDeclaration[]): TaoType {
    return actionType(
      parameters.map(parameter => ({
        name: Type.parameterName(parameter),
        type: this.ofParameter(parameter),
        optional: parameter.defaultValue !== undefined,
        writable: parameterRequiresWritable(parameter),
      })),
    )
  }

  /** A call's target links to a pure function or a phrase; a phrase always returns text. */
  private functionCallExpressionType(call: AST.FunctionCallExpression): TaoType {
    const target = call.function.ref
    if (!target) {
      return unresolvedType()
    }
    return AST.isPhraseDeclaration(target) ? primitiveType('text') : this.ofFunctionReturn(target)
  }

  ofFunctionReturn(declaration: AST.FunctionDeclaration): TaoType {
    if (declaration.returnType) {
      return this.ofTypeExpression(declaration.returnType)
    }
    return this.withoutCycles(declaration, () => {
      const returnTypes = AST.returnStatementsOf(declaration).map(statement => this.ofExpression(statement.value))
      return Type.commonType(returnTypes) ?? unresolvedType()
    })
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
    if (alias.type) {
      return this.ofReference(alias.type)
    }
    return this.withoutCycles(alias, () =>
      AST.isConfiguredValue(alias.value)
        ? Type.ofConfiguredValue(alias.value)
        : this.ofExpression(alias.value))
  }

  private stateDeclarationType(state: AST.StateDeclaration): TaoType {
    if (state.type) {
      return this.ofReference(state.type)
    }
    return this.withoutCycles(state, () => this.ofExpression(state.value))
  }

  atMemberPath(root: TaoType, members: readonly string[]): TaoType {
    let current = root
    for (const member of members) {
      const next = memberType(current, member)
      if (!next) {
        return unresolvedType()
      }
      current = next
    }
    return current
  }

  ofDefinition(definition: AST.TypeDefinition): TaoType {
    return this.withoutCycles(definition, () =>
      Switch.type(definition, {
        ParameterTypeDeclaration: declaration => {
          const declared = withNominal(this.ofTypeExpression(declaration.type), declaration)
          return declaration.optional
            ? { kind: 'union', members: [declared, primitiveType('none')] }
            : declared
        },
        TypeDeclaration: declaration => {
          const target = declaration.aliasTarget?.member.ref
          if (AST.isTypeDeclaration(target)) {
            return this.ofDefinition(target)
          }
          return declaration.type
            ? withNominal(this.ofTypeExpression(declaration.type), declaration)
            : unresolvedType()
        },
        TypeProperty: property => this.typePropertyType(property),
      }))
  }

  private typePropertyType(property: AST.TypeProperty): TaoType {
    return withNominal(this.typePropertyUnderlyingType(property), property)
  }

  private typePropertyUnderlyingType(property: AST.TypeProperty): TaoType {
    if (property.type) {
      return this.ofReference(property.type)
    }
    if (property.value) {
      return this.ofExpression(property.value)
    }
    const shorthandType = Type.shorthandPropertyDefinition(property)
    return shorthandType ? this.ofDefinition(shorthandType) : unresolvedType()
  }

  ofTypeExpression(type: AST.TypeExpression): TaoType {
    if (AST.isTypeReference(type)) {
      return this.ofReference(type)
    }
    return Switch.type(type, {
      DerivedTypeExpression: derived => this.derivedType(derived),
      CaseSetTypeExpression: caseSet => ({ kind: 'enum', declaration: caseSet.$container as AST.TypeDeclaration }),
      ItemTypeExpression: item => ({ kind: 'item', item }),
      ProjectedItemTypeExpression: projected => this.projectedItemType(projected),
      YesNoTypeExpression: () => primitiveType('boolean'),
      UnionTypeExpression: union => ({
        kind: 'union',
        members: union.members.map(member => this.ofReference(member)),
      }),
    })
  }

  private derivedType(derived: AST.DerivedTypeExpression): TaoType {
    const base = this.ofReference(derived.base)
    const baseShape = slotShape(base)
    if (base.kind !== 'item' && base.kind !== 'primitive') {
      return base
    }
    if (base.kind === 'primitive' && base.primitive === 'action') {
      return base
    }
    const properties = [...(baseShape?.properties ?? [])]
    for (const property of derived.slots.properties) {
      const existing = properties.findIndex(candidate => candidate.name === property.name)
      if (existing === -1) {
        properties.push(property)
      } else {
        properties[existing] = property
      }
    }
    return base.kind === 'item'
      ? { ...base, item: { properties } }
      : { ...base, slots: { properties } }
  }

  private projectedItemType(projected: AST.ProjectedItemTypeExpression): TaoType {
    const base = this.ofReference(projected.base)
    if (base.kind !== 'entity') {
      return unresolvedType()
    }
    const excluded = new Set(projected.excludedFields)
    const selected = projected.fields.length > 0 ? new Set(projected.fields) : undefined
    const dataFields = Type.dataFields(base.entity).filter(field =>
      selected ? selected.has(field.name) : !excluded.has(field.name)
    )
    return { kind: 'item', item: { properties: [], dataFields, projectedEntity: base.entity } }
  }
}

/**
 * Three primitive names denote a shape rather than a leaf value: `action` carries its parameters,
 * and `list` and `item` are kinds of their own. Every other name is its own primitive type.
 */
function primitiveType(primitive: AST.PrimitiveType | 'none'): TaoType {
  if (primitive === 'action') {
    return actionType([])
  }
  if (primitive === 'list' || primitive === 'item') {
    return { kind: primitive }
  }
  return { kind: 'primitive', primitive }
}

function actionType(parameters: readonly TaoActionParameter[]): TaoType {
  return { kind: 'primitive', primitive: 'action', parameters }
}

function definitionIdentityName(type: AST.TypeDefinition): string {
  return `${AST.getDocument(type).uri.path}#${Type.definitionName(type)}`
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

function nominalChainsIntersect(left: AST.TypeDefinition, right: AST.TypeDefinition): boolean {
  const rightChain = new Set(nominalChain(right))
  return nominalChain(left).some(definition => rightChain.has(definition))
}

function nominalChain(definition: AST.TypeDefinition): AST.TypeDefinition[] {
  return chainFrom(definition, parentTypeDefinition)
}

function parentTypeDefinition(definition: AST.TypeDefinition): AST.TypeDefinition | undefined {
  return Switch.type(definition, {
    ParameterTypeDeclaration: declaration => parentDefinitionOfExpression(declaration.type),
    TypeDeclaration: declaration => {
      const target = declaration.aliasTarget?.member.ref
      return AST.isTypeDeclaration(target)
        ? target
        : declaration.type
        ? parentDefinitionOfExpression(declaration.type)
        : undefined
    },
    TypeProperty: property =>
      property.type
        ? namedParentDefinition(property.type)
        : Type.shorthandPropertyDefinition(property),
  })
}

function parentDefinitionOfExpression(type: AST.TypeExpression): AST.TypeDefinition | undefined {
  return AST.isDerivedTypeExpression(type)
    ? namedParentDefinition(type.base)
    : namedParentDefinition(type)
}

function namedParentDefinition(type: AST.TypeExpression): AST.TypeDefinition | undefined {
  return AST.isNamedTypeReference(type) ? Type.definitionOfReference(type) : undefined
}

function visibleTypeDeclaration(node: AST.Node, name: string): AST.TypeDeclaration | undefined {
  return AST.visibleFileDeclarations(node, AST.isTypeDeclaration).find(type => type.name === name)
}

function visibleParameterizedDeclaration(node: AST.Node, name: string): AST.ParameterizedDeclaration | undefined {
  return AST.visibleFileDeclarations(node, AST.isParameterizedDeclaration).find(declaration =>
    declaration.name === name
  )
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
    const itemType = itemShape(Type.ofDefinition(current))
    if (!itemType) {
      return undefined
    }
    current = typePropertyNamed(itemType, member)
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
  return itemType ? typePropertyNamed(itemType, name) : undefined
}

function owningItemLiteralType(reference: AST.NamedTypeReference): ItemShape | undefined {
  let current: AST.Node | undefined = reference.$container
  while (current) {
    if (AST.isItemLiteral(current)) {
      return itemLiteralType(current)
    }
    current = current.$container
  }
  return undefined
}

function itemLiteralType(item: AST.ItemLiteral): ItemShape | undefined {
  const parent = item.$container
  if (AST.isTypedConstructor(parent)) {
    return Type.constructorReferenceItemType(parent.type)
  }
  return undefined
}
