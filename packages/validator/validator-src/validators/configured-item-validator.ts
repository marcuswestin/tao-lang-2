import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

export const configuredItemValidationMessages = {
  constructorShape: (type: string, expected: string) => `Typed constructor '${type}' expects a ${expected} literal.`,
  constructorValueType: (type: string, expected: string, actual: string) =>
    `Typed constructor '${type}' expects ${expected}, got ${actual}.`,
  shapelessItemConstructor: (type: string) =>
    `Typed constructor '${type}' cannot accept fields because its item type has no declared shape.`,
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
  memberNotItem: (name: string) => `Cannot access member '${name}' on a non-item value.`,
  unknownMember: (type: string, name: string) => `Item type '${type}' has no field '${name}'.`,
  inferredConstructorContext: 'A bare item block requires a same-name type declaration.',
  filledProperty: (name: string) => `Filled slot '${name}' cannot be supplied or reopened.`,
} as const

export const configuredItemValidationChecks = {
  [AST.ConfiguredValue.$type]: (configured, ctx) => {
    if (
      (AST.isTypeDeclaration(configured.type.ref) && !AST.isConfigurableDeclaration(configured.type.ref))
      || AST.isParameterizedDeclaration(configured.type.ref)
    ) {
      validateConfiguredItemConstructor(configured, ctx)
    }
  },
  [AST.InferredConfigurationConstructor.$type]: validateInferredConfiguredItem,
} satisfies NodeValidationChecks

export function constructorLiteralKind(type: ASTUtils.TaoType): string {
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
    const actualKind = Switch.type(value.value, {
      StringLiteral: () => 'text' as const,
      NumberLiteral: () => 'number' as const,
      ListLiteral: () => 'list' as const,
    })
    if (actualKind !== expectedKind) {
      ctx.error(configuredItemValidationMessages.constructorShape(typeName, expectedKind), value)
      return
    }
    const actual = Type.ofExpression(value.value)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, constructed)) {
      ctx.error(
        configuredItemValidationMessages.constructorValueType(
          typeName,
          Type.displayName(constructed),
          Type.displayName(actual),
        ),
        value.value,
      )
    }
    return
  }
  if (constructed.kind !== 'item') {
    ctx.error(configuredItemValidationMessages.constructorShape(typeName, constructorLiteralKind(constructed)), value)
    return
  }
  const block = value.block
  if (!block) {
    return
  }
  if (!constructed.item) {
    if (block.entries.length > 0) {
      ctx.error(configuredItemValidationMessages.shapelessItemConstructor(typeName), block)
    }
    return
  }

  validateConfiguredItemBlock(block, constructed.item, ctx)
}

function validateInferredConfiguredItem(
  value: AST.InferredConfigurationConstructor,
  ctx: ValidationContext,
): void {
  const owner = value.$container
  const inferredName = AST.isAliasDeclaration(owner)
    ? owner.name
    : AST.isAppProperty(owner)
    ? owner.name
    : undefined
  const declaration = inferredName ? Type.visibleDeclaration(value, inferredName) : undefined
  if (declaration && AST.isConfigurableDeclaration(declaration)) {
    return
  }
  const inferred = Type.ofInferredConfiguration(value)
  if (inferred.kind === 'unresolved') {
    ctx.error(configuredItemValidationMessages.inferredConstructorContext, value)
    return
  }
  if (inferred.kind !== 'item') {
    ctx.error(configuredItemValidationMessages.constructorShape('inferred', constructorLiteralKind(inferred)), value)
    return
  }
  if (!inferred.item) {
    if (value.block.entries.length > 0) {
      ctx.error(configuredItemValidationMessages.shapelessItemConstructor('inferred'), value.block)
    }
    return
  }
  validateConfiguredItemBlock(value.block, inferred.item, ctx)
}

/** validateConfiguredItemPatch checks a partial immutable item update against its effective slots. */
export function validateConfiguredItemPatch(
  block: AST.ConfigurationBlock,
  item: ASTUtils.ItemShape,
  ctx: ValidationContext,
): void {
  validateConfiguredItemBlock(block, item, ctx, false)
}

/** validateConfiguredItemConstruction checks a complete slot fill against one effective shape. */
export function validateConfiguredItemConstruction(
  block: AST.ConfigurationBlock,
  item: ASTUtils.ItemShape,
  ctx: ValidationContext,
): void {
  validateConfiguredItemBlock(block, item, ctx, true)
}

type ConfiguredItemCandidate = { entry: AST.ConfigurationEntry; type: ASTUtils.TaoType }

type ConfiguredItemBindingState = {
  readonly block: AST.ConfigurationBlock
  readonly ctx: ValidationContext
  readonly namedEntries: Map<string, AST.ConfigurationEntry>
  readonly remainingCandidates: Set<ConfiguredItemCandidate>
  readonly remainingExpected: Set<AST.TypeProperty>
}

function validateConfiguredItemBlock(
  block: AST.ConfigurationBlock,
  item: ASTUtils.ItemShape,
  ctx: ValidationContext,
  requireAll = true,
): void {
  const state: ConfiguredItemBindingState = {
    block,
    ctx,
    namedEntries: new Map(),
    remainingCandidates: new Set(),
    remainingExpected: new Set(),
  }
  collectConfiguredItemCandidates(state, item)
  const blockedCandidateTypes = bindUnambiguousConfiguredItemCandidates(state)
  reportRemainingConfiguredItemCandidates(state, blockedCandidateTypes)
  if (requireAll) {
    reportRemainingConfiguredItemFields(state, blockedCandidateTypes)
  }
}

function collectConfiguredItemCandidates(
  state: ConfiguredItemBindingState,
  item: ASTUtils.ItemShape,
): void {
  for (const entry of state.block.entries) {
    if (entry.label && entry.expression) {
      const expected = item.properties.find(property => property.name === entry.label)
      if (!expected) {
        state.ctx.error(configuredItemValidationMessages.unknownNamedProperty(entry.label), entry)
        continue
      }
      if (Type.propertyIsFilled(expected)) {
        state.ctx.error(configuredItemValidationMessages.filledProperty(expected.name), entry)
        continue
      }
      if (state.namedEntries.has(entry.label)) {
        state.ctx.error(configuredItemValidationMessages.duplicateNamedProperty(entry.label), entry)
      }
      state.namedEntries.set(entry.label, entry)
      const actual = Type.ofExpression(entry.expression)
      const expectedType = Type.ofProperty(expected)
      if (actual.kind !== 'unresolved' && !Type.isCastCompatible(actual, expectedType)) {
        state.ctx.error(
          configuredItemValidationMessages.namedPropertyType(
            entry.label,
            Type.displayName(expectedType),
            Type.displayName(actual),
          ),
          entry,
        )
      }
      continue
    }
    const type = configuredItemEntryType(entry, item, state.ctx)
    if (type) {
      state.remainingCandidates.add({ entry, type })
    }
  }
  for (const property of item.properties) {
    if (!Type.propertyIsFilled(property) && !state.namedEntries.has(property.name)) {
      state.remainingExpected.add(property)
    }
  }
}

const configuredItemCandidateType = (candidate: ConfiguredItemCandidate): ASTUtils.TaoType => candidate.type

function bindUnambiguousConfiguredItemCandidates(state: ConfiguredItemBindingState): Set<string> {
  const duplicateExpected = duplicateTypes([...state.remainingExpected], Type.ofProperty)
  for (const property of duplicateExpected.values()) {
    state.ctx.error(configuredItemValidationMessages.duplicatePropertyType(property.name), state.block)
  }
  const duplicateCandidates = duplicateTypes([...state.remainingCandidates], configuredItemCandidateType)
  for (const candidate of duplicateCandidates.values()) {
    state.ctx.error(configuredItemValidationMessages.duplicateProvidedPropertyType, candidate.entry)
  }
  const blockedCandidateTypes = new Set(duplicateCandidates.keys())
  bindConfiguredEntries(state.remainingCandidates, state.remainingExpected, {
    candidateType: configuredItemCandidateType,
    matches: (actual, expected) => Type.identityKey(actual) === Type.identityKey(expected),
    blockedCandidateTypes,
  })
  bindConfiguredEntries(state.remainingCandidates, state.remainingExpected, {
    candidateType: configuredItemCandidateType,
    matches: Type.isAssignable,
    blockedCandidateTypes,
  })
  return blockedCandidateTypes
}

function reportRemainingConfiguredItemCandidates(
  state: ConfiguredItemBindingState,
  blockedCandidateTypes: ReadonlySet<string>,
): void {
  for (const candidate of state.remainingCandidates) {
    const actual = configuredItemCandidateType(candidate)
    const identity = Type.identityKey(actual)
    if (actual.kind === 'unresolved' || (identity && blockedCandidateTypes.has(identity))) {
      continue
    }
    const matches = [...state.remainingExpected].filter(property =>
      Type.isAssignable(actual, Type.ofProperty(property))
    )
    if (matches.length > 1) {
      state.ctx.error(
        configuredItemValidationMessages.ambiguousProperty(matches.map(property => property.name)),
        candidate.entry,
      )
    } else if (matches.length === 0) {
      state.ctx.error(configuredItemValidationMessages.unmatchedProperty, candidate.entry)
    }
  }
}

function reportRemainingConfiguredItemFields(
  state: ConfiguredItemBindingState,
  blockedCandidateTypes: ReadonlySet<string>,
): void {
  let unresolvedCandidates = [...state.remainingCandidates]
    .filter(candidate => configuredItemCandidateType(candidate).kind === 'unresolved')
    .length
  for (const property of state.remainingExpected) {
    const matches = [...state.remainingCandidates].filter(candidate =>
      !candidateTypeIsBlocked(configuredItemCandidateType(candidate), blockedCandidateTypes)
      && Type.isAssignable(configuredItemCandidateType(candidate), Type.ofProperty(property))
    )
    if (matches.length > 1) {
      state.ctx.error(configuredItemValidationMessages.ambiguousField(property.name), state.block)
      continue
    }
    if (matches.length > 0) {
      continue
    }
    if (unresolvedCandidates > 0) {
      unresolvedCandidates -= 1
      continue
    }
    if (!Type.propertyRequiresValue(property)) {
      continue
    }
    state.ctx.error(configuredItemValidationMessages.missingProperty(property.name), state.block)
  }
}

function configuredItemEntryType(
  entry: AST.ConfigurationEntry,
  item: ASTUtils.ItemShape,
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
  if (ownerProperty && Type.propertyIsFilled(ownerProperty)) {
    ctx.error(configuredItemValidationMessages.filledProperty(ownerProperty.name), entry)
    return { kind: 'unresolved' }
  }
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
      ctx.error(
        configuredItemValidationMessages.constructorShape(entry.name ?? '', constructorLiteralKind(expected)),
        entry,
      )
      return
    }
    if (!expected.item) {
      if (entry.block.entries.length > 0) {
        ctx.error(configuredItemValidationMessages.shapelessItemConstructor(entry.name ?? ''), entry.block)
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
  const isCompatible = AST.isConfigurationReference(entry.value)
    ? Type.isAssignable(actual, expected)
    : Type.isCastCompatible(actual, expected)
  if (actual.kind !== 'unresolved' && !isCompatible) {
    ctx.error(
      configuredItemValidationMessages.constructorShape(entry.name ?? '', constructorLiteralKind(expected)),
      entry,
    )
  }
}

function configurationValueType(value: AST.ConfigurationValue): ASTUtils.TaoType {
  if (AST.isConfigurationReference(value)) {
    const target = value.target.ref
    return AST.isValueDeclaration(target)
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
        ctx.error(configuredItemValidationMessages.unknownMember(ownerName, parameterName), value)
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
      ctx.error(configuredItemValidationMessages.memberNotItem(member), value)
      return false
    }
    const property = current.item.properties.find(candidate => candidate.name === member)
    if (!property) {
      ctx.error(configuredItemValidationMessages.unknownMember(ownerName, member), value)
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
  { candidateType, matches, blockedCandidateTypes }: {
    candidateType: (candidate: T) => ASTUtils.TaoType
    matches: (actual: ASTUtils.TaoType, expected: ASTUtils.TaoType) => boolean
    blockedCandidateTypes: ReadonlySet<string>
  },
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
