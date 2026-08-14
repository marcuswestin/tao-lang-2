import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

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
  unknownNamedProperty: (name: string) =>
    `Item constructor has no field named '${name}'; labels resolve only the constructed owner's fields, not visible types.`,
  duplicateNamedProperty: (name: string) => `Item constructor provides field '${name}' more than once.`,
  namedPropertyType: (name: string, expected: string, actual: string) =>
    `Labeled item field '${name}:' expects ${expected}, got ${actual}.`,
  cyclicType: (name: string) => `Type '${name}' cannot reference itself through its type definition.`,
  memberNotItem: (name: string) => `Cannot access member '${name}' on a non-item value.`,
  unknownMember: (type: string, name: string) => `Item type '${type}' has no field '${name}'.`,
  defaultParameterOrder: (name: string) => `Required parameter '${name}' cannot follow a defaulted parameter.`,
  defaultParameterType: (name: string, expected: string, actual: string) =>
    `Default value for parameter '${name}' expects ${expected}, got ${actual}.`,
} as const

/** typeValidationChecks validates custom type declarations and item/list/custom expression forms. */
export const typeValidationChecks = {
  [AST.TypeDeclaration.$type]: validateTypeDeclaration,
  [AST.ItemTypeExpression.$type]: validateItemType,
  [AST.TypeProperty.$type]: validateTypeProperty,
  [AST.NamedTypeReference.$type]: validateNamedTypeReference,
  [AST.ParameterDeclaration.$type]: validateParameter,
  [AST.ParameterizedDeclaration.$type]: validateDefaultParameterOrder,
  [AST.TypedConstructor.$type]: validateTypedConstructor,
  [AST.ConfiguredValue.$type]: (configured, ctx) => {
    if (AST.isTypeDeclaration(configured.type.ref) || AST.isParameterizedDeclaration(configured.type.ref)) {
      validateConfiguredItemConstructor(configured, ctx)
    }
  },
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

function validateTypeProperty(property: AST.TypeProperty, ctx: ValidationContext): void {
  if (!property.type && Type.ofProperty(property).kind === 'unresolved') {
    ctx.error(typeValidationMessages.unknownType(property.name), property)
  }
}

function validateNamedTypeReference(reference: AST.NamedTypeReference, ctx: ValidationContext): void {
  if (
    AST.isConfigurationPropertyDeclaration(reference.$container)
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

function constructorLiteralKind(type: ASTUtils.TaoType): string {
  return Switch.kind(type, {
    primitive: type => type.primitive,
    list: () => 'list',
    item: () => 'item',
    entity: type => Type.dataEntityName(type.entity),
    enum: type => type.declaration.name,
    unresolved: () => 'unresolved',
    union: type => type.members.map(Type.displayName).join(' | '),
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
  expected: AST.ItemTypeExpression,
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

function validateConfiguredItemConstructor(
  value: AST.ConfigurationConstructor,
  ctx: ValidationContext,
): void {
  const constructed = Type.ofConfiguredValue(value)
  if (!AST.isTypeDeclaration(value.type.ref) && !AST.isParameterizedDeclaration(value.type.ref)) {
    return
  }
  if (!validateConfiguredConstructorMembers(value, ctx)) {
    return
  }
  const typeName = [value.type.ref?.name ?? value.type.$refText, ...(value.members ?? [])].join('.')
  if (value.value) {
    const expectedKind = constructorLiteralKind(constructed)
    const actualKind = AST.isStringLiteral(value.value)
      ? 'text'
      : AST.isNumberLiteral(value.value)
      ? 'number'
      : 'list'
    if (actualKind !== expectedKind) {
      ctx.error(typeValidationMessages.constructorShape(typeName, expectedKind), value)
    }
    return
  }
  if (constructed.kind !== 'item') {
    ctx.error(typeValidationMessages.constructorShape(typeName, constructorLiteralKind(constructed)), value)
    return
  }
  const block = value.block
  if (!block) {
    return
  }
  if (!constructed.item) {
    if (block.entries.length > 0) {
      ctx.error(typeValidationMessages.shapelessItemConstructor(typeName), block)
    }
    return
  }

  validateConfiguredItemBlock(block, constructed.item, ctx)
}

function validateConfiguredItemBlock(
  block: AST.ConfigurationBlock,
  item: AST.ItemTypeExpression,
  ctx: ValidationContext,
): void {
  const namedEntries = new Map<string, AST.ConfigurationEntry>()
  const candidates = block.entries.flatMap(entry => {
    if (entry.label && entry.expression) {
      const expected = item.properties.find(property => property.name === entry.label)
      if (!expected) {
        ctx.error(typeValidationMessages.unknownNamedProperty(entry.label), entry)
        return []
      }
      if (namedEntries.has(entry.label)) {
        ctx.error(typeValidationMessages.duplicateNamedProperty(entry.label), entry)
      }
      namedEntries.set(entry.label, entry)
      const actual = Type.ofExpression(entry.expression)
      const expectedType = Type.ofProperty(expected)
      if (actual.kind !== 'unresolved' && !Type.isCastCompatible(actual, expectedType)) {
        ctx.error(
          typeValidationMessages.namedPropertyType(
            entry.label,
            Type.displayName(expectedType),
            Type.displayName(actual),
          ),
          entry,
        )
      }
      return []
    }
    const type = configuredItemEntryType(entry, item, ctx)
    return type ? [{ entry, type }] : []
  })

  const remainingExpected = new Set(item.properties.filter(property => !namedEntries.has(property.name)))
  const remainingCandidates = new Set(candidates)
  const candidateType = (candidate: typeof candidates[number]) => candidate.type
  const duplicateExpected = duplicateTypes([...remainingExpected], property => Type.ofProperty(property))
  for (const property of duplicateExpected.values()) {
    ctx.error(typeValidationMessages.duplicatePropertyType(property.name), block)
  }
  const duplicateCandidates = duplicateTypes([...remainingCandidates], candidateType)
  for (const candidate of duplicateCandidates.values()) {
    ctx.error(typeValidationMessages.duplicateProvidedPropertyType, candidate.entry)
  }
  const blockedCandidateTypes = new Set(duplicateCandidates.keys())

  bindConfiguredEntries(
    remainingCandidates,
    remainingExpected,
    candidateType,
    (actual, expected) => Type.identityKey(actual) === Type.identityKey(expected),
    blockedCandidateTypes,
  )
  bindConfiguredEntries(
    remainingCandidates,
    remainingExpected,
    candidateType,
    Type.isAssignable,
    blockedCandidateTypes,
  )

  for (const candidate of remainingCandidates) {
    const actual = candidateType(candidate)
    const identity = Type.identityKey(actual)
    if (actual.kind === 'unresolved' || (identity && blockedCandidateTypes.has(identity))) {
      continue
    }
    const matches = [...remainingExpected].filter(property => Type.isAssignable(actual, Type.ofProperty(property)))
    if (matches.length > 1) {
      ctx.error(typeValidationMessages.ambiguousProperty(matches.map(property => property.name)), candidate.entry)
    } else if (matches.length === 0) {
      ctx.error(typeValidationMessages.unmatchedProperty, candidate.entry)
    }
  }
  let unresolvedCandidates = [...remainingCandidates]
    .filter(candidate => candidateType(candidate).kind === 'unresolved')
    .length
  for (const property of remainingExpected) {
    const matches = [...remainingCandidates].filter(candidate =>
      !candidateTypeIsBlocked(candidateType(candidate), blockedCandidateTypes)
      && Type.isAssignable(candidateType(candidate), Type.ofProperty(property))
    )
    if (matches.length > 1) {
      ctx.error(typeValidationMessages.ambiguousField(property.name), block)
    } else if (matches.length === 0) {
      if (unresolvedCandidates > 0) {
        unresolvedCandidates -= 1
      } else {
        ctx.error(typeValidationMessages.missingProperty(property.name), block)
      }
    }
  }
}

function configuredItemEntryType(
  entry: AST.ConfigurationEntry,
  item: AST.ItemTypeExpression,
  ctx: ValidationContext,
): ASTUtils.TaoType | undefined {
  if (entry.expression) {
    return Type.ofExpression(entry.expression)
  }
  if (entry.reference) {
    return entry.reference.ref ? Type.ofValueDeclaration(entry.reference.ref) : { kind: 'unresolved' }
  }
  if (!entry.name || (!entry.block && !entry.value)) {
    return undefined
  }
  const ownerProperty = item.properties.find(property => property.name === entry.name)
  const expected = ownerProperty
    ? Type.ofProperty(ownerProperty)
    : Type.visibleDeclaration(entry, entry.name)
    ? Type.ofDefinition(Type.visibleDeclaration(entry, entry.name)!)
    : undefined
  if (!expected) {
    return undefined
  }
  validateConfiguredEntryLiteral(entry, expected, ctx)
  return expected
}

function validateConfiguredEntryLiteral(
  entry: AST.ConfigurationEntry,
  expected: ASTUtils.TaoType,
  ctx: ValidationContext,
): void {
  if (entry.block) {
    if (expected.kind !== 'item') {
      ctx.error(typeValidationMessages.constructorShape(entry.name ?? '', constructorLiteralKind(expected)), entry)
      return
    }
    if (!expected.item) {
      if (entry.block.entries.length > 0) {
        ctx.error(typeValidationMessages.shapelessItemConstructor(entry.name ?? ''), entry.block)
      }
      return
    }
    validateConfiguredItemBlock(entry.block, expected.item, ctx)
    return
  }
  if (!entry.value) {
    return
  }
  const actual = configurationValueType(entry.value)
  if (actual.kind !== 'unresolved' && !Type.isCastCompatible(actual, expected)) {
    ctx.error(typeValidationMessages.constructorShape(entry.name ?? '', constructorLiteralKind(expected)), entry)
  }
}

function configurationValueType(value: AST.ConfigurationValue): ASTUtils.TaoType {
  if (AST.isConfigurationReference(value)) {
    const target = value.target.ref
    return AST.isAliasDeclaration(target) || AST.isUiDeclaration(target)
      ? Type.ofValueDeclaration(target)
      : { kind: 'unresolved' }
  }
  if (AST.isConfigurationKeyValue(value) || AST.isPropertyConfigurationPatch(value)) {
    return { kind: 'unresolved' }
  }
  return Type.ofValue(value)
}

function validateConfiguredConstructorMembers(
  value: AST.ConfigurationConstructor,
  ctx: ValidationContext,
): boolean {
  const declaration = value.type.ref
  let members = value.members ?? []
  let ownerName = declaration?.name ?? value.type.$refText
  let current: ASTUtils.TaoType
  if (AST.isTypeDeclaration(declaration)) {
    current = Type.ofDefinition(declaration)
  } else if (AST.isParameterizedDeclaration(declaration)) {
    const [parameterName, ...remaining] = members
    const parameterType = parameterName
      ? AST.parametersOf(declaration).find(parameter => parameter.inlineType?.name === parameterName)?.inlineType
      : undefined
    if (!parameterName || !parameterType) {
      if (parameterName) {
        ctx.error(typeValidationMessages.unknownMember(ownerName, parameterName), value)
      }
      return false
    }
    ownerName = `${ownerName}.${parameterName}`
    current = Type.ofDefinition(parameterType)
    members = remaining
  } else {
    return true
  }
  for (const member of members) {
    if (current.kind !== 'item' || !current.item) {
      ctx.error(typeValidationMessages.memberNotItem(member), value)
      return false
    }
    const property = current.item.properties.find(candidate => candidate.name === member)
    if (!property) {
      ctx.error(typeValidationMessages.unknownMember(ownerName, member), value)
      return false
    }
    current = Type.ofProperty(property)
    ownerName = `${ownerName}.${member}`
  }
  return true
}

function duplicateTypes<T>(values: readonly T[], getType: (value: T) => ASTUtils.TaoType): Map<string, T> {
  const first = new Map<string, T>()
  const duplicates = new Map<string, T>()
  for (const value of values) {
    const key = Type.identityKey(getType(value))
    if (!key) {
      continue
    }
    if (first.has(key)) {
      duplicates.set(key, value)
    } else {
      first.set(key, value)
    }
  }
  return duplicates
}

function bindConfiguredEntries<T extends { entry: AST.ConfigurationEntry }>(
  candidates: Set<T>,
  expected: Set<AST.TypeProperty>,
  candidateType: (candidate: T) => ASTUtils.TaoType,
  matches: (actual: ASTUtils.TaoType, expected: ASTUtils.TaoType) => boolean,
  blockedCandidateTypes: ReadonlySet<string>,
): void {
  for (const candidate of [...candidates]) {
    const actual = candidateType(candidate)
    if (candidateTypeIsBlocked(actual, blockedCandidateTypes)) {
      continue
    }
    const matching = [...expected].filter(property => matches(actual, Type.ofProperty(property)))
    if (matching.length === 1) {
      const property = matching[0]!
      const competing = [...candidates].filter(other =>
        other !== candidate && matches(candidateType(other), Type.ofProperty(property))
      )
      if (competing.length === 0) {
        candidates.delete(candidate)
        expected.delete(property)
      }
    }
  }
}

function candidateTypeIsBlocked(type: ASTUtils.TaoType, blocked: ReadonlySet<string>): boolean {
  const identity = Type.identityKey(type)
  return type.kind === 'unresolved' || (!!identity && blocked.has(identity))
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
  if (AST.isUnionTypeExpression(type)) {
    return type.members.some(member => typeReferenceReferencesRoot(root, member, new Set(seen)))
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
  if (AST.isActionTypeReference(type)) {
    return type.parameterTypes.some(parameter => typeReferenceReferencesRoot(root, parameter, new Set(seen)))
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
    current = Type.ofProperty(property)
    if (current.kind === 'unresolved') {
      return
    }
    typeName = Type.displayName(current)
  }
}

function declarationType(declaration: AST.ValueDeclaration | undefined): ASTUtils.TaoType {
  return Switch.typeMaybe<AST.ValueDeclaration | undefined, ASTUtils.TaoType>(declaration, {
    ParameterDeclaration: Type.ofParameter,
    AliasDeclaration: declaration => Type.ofExpression(declaration.value),
    AppDeclaration: () => ({ kind: 'unresolved' }),
    AskStatement: Type.ofValueDeclaration,
    StateDeclaration: declaration => Type.ofExpression(declaration.value),
    ActionDeclaration: Type.ofAction,
    CasePayload: () => ({ kind: 'primitive', primitive: 'text' }),
    EntityDataField: field => field.negativeName ? { kind: 'primitive', primitive: 'boolean' } : { kind: 'unresolved' },
    EnumCase: enumCase => ({ kind: 'enum', declaration: AST.enumOwningCase(enumCase) }),
    EntityQueryDeclaration: declaration => {
      const entity = Type.queryEntity(declaration)
      return entity ? { kind: 'list', element: { kind: 'entity', entity } } : { kind: 'list' }
    },
    ForStatement: statement => {
      const collection = Type.ofExpression(statement.collection)
      return collection.kind === 'list' ? collection.element ?? { kind: 'unresolved' } : { kind: 'unresolved' }
    },
    UiDeclaration: () => ({ kind: 'primitive', primitive: 'ui' }),
    undefined: () => ({ kind: 'unresolved' }),
  })
}
