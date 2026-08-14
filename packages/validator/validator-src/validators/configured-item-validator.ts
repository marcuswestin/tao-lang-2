import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

export const configuredItemValidationMessages = {
  constructorShape: (type: string, expected: string) => `Typed constructor '${type}' expects a ${expected} literal.`,
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
} as const

export const configuredItemValidationChecks = {
  [AST.ConfiguredValue.$type]: (configured, ctx) => {
    if (AST.isTypeDeclaration(configured.type.ref) || AST.isParameterizedDeclaration(configured.type.ref)) {
      validateConfiguredItemConstructor(configured, ctx)
    }
  },
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
        ctx.error(configuredItemValidationMessages.unknownNamedProperty(entry.label), entry)
        return []
      }
      if (namedEntries.has(entry.label)) {
        ctx.error(configuredItemValidationMessages.duplicateNamedProperty(entry.label), entry)
      }
      namedEntries.set(entry.label, entry)
      const actual = Type.ofExpression(entry.expression)
      const expectedType = Type.ofProperty(expected)
      if (actual.kind !== 'unresolved' && !Type.isCastCompatible(actual, expectedType)) {
        ctx.error(
          configuredItemValidationMessages.namedPropertyType(
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
    ctx.error(configuredItemValidationMessages.duplicatePropertyType(property.name), block)
  }
  const duplicateCandidates = duplicateTypes([...remainingCandidates], candidateType)
  for (const candidate of duplicateCandidates.values()) {
    ctx.error(configuredItemValidationMessages.duplicateProvidedPropertyType, candidate.entry)
  }
  const blockedCandidateTypes = new Set(duplicateCandidates.keys())

  bindConfiguredEntries(
    remainingCandidates,
    remainingExpected,
    {
      candidateType,
      matches: (actual, expected) => Type.identityKey(actual) === Type.identityKey(expected),
      blockedCandidateTypes,
    },
  )
  bindConfiguredEntries(
    remainingCandidates,
    remainingExpected,
    { candidateType, matches: Type.isAssignable, blockedCandidateTypes },
  )

  for (const candidate of remainingCandidates) {
    const actual = candidateType(candidate)
    const identity = Type.identityKey(actual)
    if (actual.kind === 'unresolved' || (identity && blockedCandidateTypes.has(identity))) {
      continue
    }
    const matches = [...remainingExpected].filter(property => Type.isAssignable(actual, Type.ofProperty(property)))
    if (matches.length > 1) {
      ctx.error(
        configuredItemValidationMessages.ambiguousProperty(matches.map(property => property.name)),
        candidate.entry,
      )
    } else if (matches.length === 0) {
      ctx.error(configuredItemValidationMessages.unmatchedProperty, candidate.entry)
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
      ctx.error(configuredItemValidationMessages.ambiguousField(property.name), block)
    } else if (matches.length === 0) {
      if (unresolvedCandidates > 0) {
        unresolvedCandidates -= 1
      } else {
        ctx.error(configuredItemValidationMessages.missingProperty(property.name), block)
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
  if (actual.kind !== 'unresolved' && !Type.isCastCompatible(actual, expected)) {
    ctx.error(
      configuredItemValidationMessages.constructorShape(entry.name ?? '', constructorLiteralKind(expected)),
      entry,
    )
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
