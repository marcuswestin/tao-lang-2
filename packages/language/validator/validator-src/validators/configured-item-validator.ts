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
  listedNotValue: (name: string) =>
    `'${name}' names a data collection, which a list of declarations can hold but an item cannot.`,
  filledProperty: (name: string) => `Filled slot '${name}' cannot be supplied or reopened.`,
} as const

export const configuredItemValidationChecks = {
  [AST.ConfiguredValue.$type]: (configured, ctx) => {
    if (
      (AST.isTypeDeclaration(configured.type.ref) && !AST.isConfigurableDeclaration(configured.type.ref))
      || AST.isParameterizedDeclaration(configured.type.ref)
      || AST.isParameterTypeDeclaration(configured.type.ref)
    ) {
      validateConfiguredItemConstructor(configured, ctx)
    }
  },
  [AST.InferredConfigurationConstructor.$type]: validateInferredConfiguredItem,
} satisfies NodeValidationChecks

export function constructorLiteralKind(type: ASTUtils.TaoType): string {
  return Switch.kind(type, {
    capability: type => type.declaration.name,
    primitive: type => type.primitive === 'numeric' ? 'number' : type.primitive,
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
  if (
    !AST.isTypeDeclaration(value.type.ref) && !AST.isParameterizedDeclaration(value.type.ref)
    && !AST.isParameterTypeDeclaration(value.type.ref)
  ) {
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
      ctx.error(value, configuredItemValidationMessages.constructorShape(typeName, expectedKind))
      return
    }
    const actual = Type.ofExpression(value.value)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, constructed)) {
      ctx.error(
        value.value,
        configuredItemValidationMessages.constructorValueType(
          typeName,
          Type.displayName(constructed),
          Type.displayName(actual),
        ),
      )
    }
    return
  }
  if (constructed.kind !== 'item') {
    ctx.error(value, configuredItemValidationMessages.constructorShape(typeName, constructorLiteralKind(constructed)))
    return
  }
  const block = value.block
  if (!block) {
    return
  }
  if (!constructed.item) {
    if (block.entries.length > 0) {
      ctx.error(block, configuredItemValidationMessages.shapelessItemConstructor(typeName))
    }
    return
  }

  validateConfiguredItemBlock(block, constructed.item, ctx)
}

function validateInferredConfiguredItem(
  value: AST.InferredConfigurationConstructor,
  ctx: ValidationContext,
): void {
  // A block of bare names in a slot lists declarations rather than constructing a value; the owning
  // slot's contract checks what it may list, so there is no same-name type for it to resolve.
  if (AST.isAppProperty(value.$container) && ASTUtils.referenceBlockOf(value)) {
    return
  }
  const declaration = Type.inferredConfigurationDeclaration(value)
  if (declaration && AST.isConfigurableDeclaration(declaration)) {
    return
  }
  const inferred = Type.ofInferredConfiguration(value)
  if (inferred.kind === 'unresolved') {
    ctx.error(value, configuredItemValidationMessages.inferredConstructorContext)
    return
  }
  if (inferred.kind !== 'item') {
    ctx.error(value, configuredItemValidationMessages.constructorShape('inferred', constructorLiteralKind(inferred)))
    return
  }
  if (!inferred.item) {
    if (value.block.entries.length > 0) {
      ctx.error(value.block, configuredItemValidationMessages.shapelessItemConstructor('inferred'))
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
  readonly remainingExpected: Set<ASTUtils.ItemShapeField>
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
      const expected = Type.itemFields(item).find(property => property.name === entry.label)
      if (!expected) {
        state.ctx.error(entry, configuredItemValidationMessages.unknownNamedProperty(entry.label))
        continue
      }
      if (Type.itemFieldIsFilled(expected)) {
        state.ctx.error(entry, configuredItemValidationMessages.filledProperty(expected.name))
        continue
      }
      if (state.namedEntries.has(entry.label)) {
        state.ctx.error(entry, configuredItemValidationMessages.duplicateNamedProperty(entry.label))
      }
      state.namedEntries.set(entry.label, entry)
      const actual = Type.ofExpression(entry.expression)
      const expectedType = Type.itemFieldType(expected)
      if (actual.kind !== 'unresolved' && !Type.isCastCompatible(actual, expectedType)) {
        state.ctx.error(
          entry,
          configuredItemValidationMessages.namedPropertyType(
            entry.label,
            Type.displayName(expectedType),
            Type.displayName(actual),
          ),
        )
      }
      continue
    }
    const type = configuredItemEntryType(entry, item, state.ctx)
    if (type) {
      state.remainingCandidates.add({ entry, type })
    }
  }
  for (const property of Type.itemFields(item)) {
    if (!Type.itemFieldIsFilled(property) && !state.namedEntries.has(property.name)) {
      state.remainingExpected.add(property)
    }
  }
}

const configuredItemCandidateType = (candidate: ConfiguredItemCandidate): ASTUtils.TaoType => candidate.type

function bindUnambiguousConfiguredItemCandidates(state: ConfiguredItemBindingState): Set<string> {
  const duplicateExpected = duplicateTypes([...state.remainingExpected], Type.itemFieldType)
  for (const property of duplicateExpected.values()) {
    state.ctx.error(state.block, configuredItemValidationMessages.duplicatePropertyType(property.name))
  }
  const duplicateCandidates = duplicateTypes([...state.remainingCandidates], configuredItemCandidateType)
  for (const candidate of duplicateCandidates.values()) {
    state.ctx.error(candidate.entry, configuredItemValidationMessages.duplicateProvidedPropertyType)
  }
  const blockedCandidateTypes = new Set(duplicateCandidates.keys())
  bindConfiguredEntries(state.remainingCandidates, state.remainingExpected, {
    candidateType: configuredItemCandidateType,
    matches: (actual, expected) => Type.identityKey(actual) === Type.identityKey(expected),
    blockedCandidateTypes,
  })
  bindConfiguredEntries(state.remainingCandidates, state.remainingExpected, {
    candidateType: configuredItemCandidateType,
    matches: Type.isAssignableToConstruction,
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
      Type.isAssignableToConstruction(actual, Type.itemFieldType(property))
    )
    if (matches.length > 1) {
      state.ctx.error(
        candidate.entry,
        configuredItemValidationMessages.ambiguousProperty(matches.map(property => property.name)),
      )
    } else if (matches.length === 0) {
      state.ctx.error(candidate.entry, configuredItemValidationMessages.unmatchedProperty)
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
      && Type.isAssignableToConstruction(configuredItemCandidateType(candidate), Type.itemFieldType(property))
    )
    if (matches.length > 1) {
      state.ctx.error(state.block, configuredItemValidationMessages.ambiguousField(property.name))
      continue
    }
    if (matches.length > 0) {
      continue
    }
    if (unresolvedCandidates > 0) {
      unresolvedCandidates -= 1
      continue
    }
    if (!Type.itemFieldRequiresValue(property)) {
      continue
    }
    state.ctx.error(state.block, configuredItemValidationMessages.missingProperty(property.name))
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
    const target = entry.reference.ref
    // A reference entry may name a data collection so `Data { Stories }` resolves; anywhere a value is
    // expected that name is a mistake, and saying so here keeps it from reaching the compiler.
    if (target && !AST.isValueDeclaration(target)) {
      ctx.error(entry, configuredItemValidationMessages.listedNotValue(entry.reference.$refText))
    }
    return target && AST.isValueDeclaration(target) ? Type.ofValueDeclaration(target) : { kind: 'unresolved' }
  }
  if (!entry.name || (!entry.block && !entry.value)) {
    return undefined
  }
  const ownerProperty = Type.itemFields(item).find(property => property.name === entry.name)
  if (ownerProperty && Type.itemFieldIsFilled(ownerProperty)) {
    ctx.error(entry, configuredItemValidationMessages.filledProperty(ownerProperty.name))
    return { kind: 'unresolved' }
  }
  const expected = ownerProperty
    ? Type.itemFieldType(ownerProperty)
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
        entry,
        configuredItemValidationMessages.constructorShape(entry.name ?? '', constructorLiteralKind(expected)),
      )
      return
    }
    if (!expected.item) {
      if (entry.block.entries.length > 0) {
        ctx.error(entry.block, configuredItemValidationMessages.shapelessItemConstructor(entry.name ?? ''))
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
      entry,
      configuredItemValidationMessages.constructorShape(entry.name ?? '', constructorLiteralKind(expected)),
    )
  }
}

function configurationValueType(value: AST.ConfigurationValue): ASTUtils.TaoType {
  if (AST.isViewBinding(value)) {
    return { kind: 'primitive', primitive: 'view' }
  }
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
  if (AST.isTypeDeclaration(declaration) || AST.isParameterTypeDeclaration(declaration)) {
    current = Type.ofDefinition(declaration)
  } else if (AST.isParameterizedDeclaration(declaration)) {
    const [parameterName, ...remaining] = members
    const parameterType = parameterName ? Type.signatureParameterDefinition(declaration, parameterName) : undefined
    if (!parameterName || !parameterType) {
      if (parameterName) {
        ctx.error(value, configuredItemValidationMessages.unknownMember(ownerName, parameterName))
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
      ctx.error(value, configuredItemValidationMessages.memberNotItem(member))
      return false
    }
    const property = Type.itemFields(current.item).find(candidate => candidate.name === member)
    if (!property) {
      ctx.error(value, configuredItemValidationMessages.unknownMember(ownerName, member))
      return false
    }
    current = Type.itemFieldType(property)
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
  expected: Set<ASTUtils.ItemShapeField>,
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
    const matching = [...expected].filter(property => matches(actual, Type.itemFieldType(property)))
    if (matching.length === 1) {
      const property = matching[0]!
      const competing = [...candidates].filter(other =>
        other !== candidate && matches(candidateType(other), Type.itemFieldType(property))
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
