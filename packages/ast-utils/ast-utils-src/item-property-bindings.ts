import { AST } from '@parser'
import { Type } from './Type'
import {
  bindUnambiguousPairs,
  type MatchGraph,
  matchGraph,
  reportDuplicateCandidateTypes,
  reportDuplicateTargetTypes,
  typesExactlyMatch,
} from './type-binding-matches'

export type ItemPropertyBindingPair = {
  property: AST.ItemProperty
  expected: AST.TypeProperty
}

export type ItemPropertyBindingDiagnostic =
  | { kind: 'duplicate-property-type'; expected: AST.TypeProperty; type: string }
  | { kind: 'duplicate-provided-property-type'; property: AST.ItemProperty; type: string }
  | { kind: 'unknown-named-property'; property: AST.ItemProperty; name: string }
  | { kind: 'duplicate-named-property'; property: AST.ItemProperty; expected: AST.TypeProperty }
  | { kind: 'named-property-type'; property: AST.ItemProperty; expected: AST.TypeProperty }
  | { kind: 'ambiguous-property'; property: AST.ItemProperty; expected: readonly AST.TypeProperty[] }
  | { kind: 'ambiguous-field'; expected: AST.TypeProperty; properties: readonly AST.ItemProperty[] }
  | { kind: 'unmatched-property'; property: AST.ItemProperty }
  | { kind: 'missing-property'; expected: AST.TypeProperty }

export type ItemPropertyBindingResult = {
  pairs: ItemPropertyBindingPair[]
  diagnostics: ItemPropertyBindingDiagnostic[]
}

type ItemPropertyBindingState = {
  diagnostics: ItemPropertyBindingDiagnostic[]
  pairs: ItemPropertyBindingPair[]
  remainingExpected: Set<AST.TypeProperty>
  remainingProperties: Set<AST.ItemProperty>
}

type ItemPropertyAmbiguities = {
  ambiguousExpected: Set<AST.TypeProperty>
  ambiguousProperties: Set<AST.ItemProperty>
  unresolvedProperties: number
}

/** resolveItemPropertyBindings binds item constructor property values to item type fields by type. */
export function resolveItemPropertyBindings(
  expectedProperties: readonly AST.TypeProperty[],
  properties: readonly AST.ItemProperty[],
): ItemPropertyBindingResult {
  const state: ItemPropertyBindingState = {
    diagnostics: [],
    pairs: [],
    remainingExpected: new Set(expectedProperties),
    remainingProperties: new Set(properties),
  }
  bindNamedItemProperties(state)
  if (state.remainingProperties.size > 0) {
    reportDuplicatePropertyTypes([...state.remainingExpected], state.diagnostics)
  }
  const duplicateProvidedPropertyTypes = reportDuplicateProvidedPropertyTypes(properties, state.diagnostics)
  bindUnlabeledItemProperties(state, duplicateProvidedPropertyTypes)
  reportRemainingItemPropertyDiagnostics(state, duplicateProvidedPropertyTypes)
  return {
    pairs: pairsByExpectedPropertyOrder(expectedProperties, state.pairs),
    diagnostics: state.diagnostics,
  }
}

function bindUnlabeledItemProperties(
  state: ItemPropertyBindingState,
  duplicateProvidedPropertyTypes: ReadonlySet<string>,
): void {
  bindItemProperties(state, {
    matches: propertyTypesExactlyMatch,
    blockedPropertyTypes: duplicateProvidedPropertyTypes,
  })
  bindItemProperties(state, {
    matches: propertyTypesAreAssignable,
    blockedPropertyTypes: duplicateProvidedPropertyTypes,
  })
}

function reportRemainingItemPropertyDiagnostics(
  state: ItemPropertyBindingState,
  duplicateProvidedPropertyTypes: ReadonlySet<string>,
): void {
  const matchGraph = propertyMatchGraph(
    state.remainingProperties,
    state.remainingExpected,
    duplicateProvidedPropertyTypes,
  )
  const ambiguities = reportAmbiguousItemProperties(state, matchGraph, duplicateProvidedPropertyTypes)
  for (const [expected, matches] of matchGraph.candidatesByTarget) {
    if (matches.length > 1) {
      state.diagnostics.push({
        kind: 'ambiguous-field',
        expected,
        properties: matches,
      })
      ambiguities.ambiguousExpected.add(expected)
      for (const property of matches) {
        ambiguities.ambiguousProperties.add(property)
      }
    }
  }
  reportUnmatchedItemProperties(state, matchGraph, duplicateProvidedPropertyTypes, ambiguities)
  reportMissingItemProperties(state, ambiguities)
}

function reportAmbiguousItemProperties(
  state: ItemPropertyBindingState,
  matchGraph: MatchGraph<AST.ItemProperty, AST.TypeProperty>,
  duplicateProvidedPropertyTypes: ReadonlySet<string>,
): ItemPropertyAmbiguities {
  const ambiguities: ItemPropertyAmbiguities = {
    ambiguousProperties: new Set(),
    ambiguousExpected: new Set(),
    unresolvedProperties: 0,
  }
  for (const property of state.remainingProperties) {
    const actualType = Type.ofExpression(property.value)
    if (actualType.kind === 'unresolved') {
      ambiguities.unresolvedProperties += 1
      continue
    }
    const propertyKey = Type.identityKey(actualType)
    if (propertyKey && duplicateProvidedPropertyTypes.has(propertyKey)) {
      continue
    }
    const matches = matchGraph.targetsByCandidate.get(property) ?? []
    if (matches.length > 1) {
      state.diagnostics.push({
        kind: 'ambiguous-property',
        property,
        expected: matches,
      })
      ambiguities.ambiguousProperties.add(property)
      for (const expected of matches) {
        ambiguities.ambiguousExpected.add(expected)
      }
    }
  }
  return ambiguities
}

function reportUnmatchedItemProperties(
  state: ItemPropertyBindingState,
  matchGraph: MatchGraph<AST.ItemProperty, AST.TypeProperty>,
  duplicateProvidedPropertyTypes: ReadonlySet<string>,
  ambiguities: ItemPropertyAmbiguities,
): void {
  for (const property of state.remainingProperties) {
    if (ambiguities.ambiguousProperties.has(property)) {
      continue
    }
    const actualType = Type.ofExpression(property.value)
    const propertyKey = Type.identityKey(actualType)
    const propertyIsUnmatched = actualType.kind !== 'unresolved'
      && !(propertyKey && duplicateProvidedPropertyTypes.has(propertyKey))
      && !(matchGraph.targetsByCandidate.get(property)?.length)
    if (propertyIsUnmatched) {
      state.diagnostics.push({
        kind: 'unmatched-property',
        property,
      })
    }
  }
}

function reportMissingItemProperties(
  state: ItemPropertyBindingState,
  ambiguities: ItemPropertyAmbiguities,
): void {
  for (const expected of state.remainingExpected) {
    if (ambiguities.ambiguousExpected.has(expected)) {
      continue
    }
    if (ambiguities.unresolvedProperties > 0) {
      ambiguities.unresolvedProperties -= 1
      continue
    }
    state.diagnostics.push({
      kind: 'missing-property',
      expected,
    })
  }
}

function reportDuplicatePropertyTypes(
  properties: readonly AST.TypeProperty[],
  diagnostics: ItemPropertyBindingDiagnostic[],
): void {
  reportDuplicateTargetTypes(
    properties,
    property => Type.identityKey(Type.ofProperty(property)),
    (expected, type) =>
      diagnostics.push({
        kind: 'duplicate-property-type',
        expected,
        type,
      }),
  )
}

function bindNamedItemProperties(state: ItemPropertyBindingState): void {
  for (const property of [...state.remainingProperties]) {
    const name = property.label
    if (!name) {
      continue
    }
    const expected = [...state.remainingExpected].find(candidate => candidate.name === name)
    if (!expected) {
      const declared = state.pairs.find(pair => pair.expected.name === name)?.expected
      state.diagnostics.push(
        declared
          ? { kind: 'duplicate-named-property', property, expected: declared }
          : { kind: 'unknown-named-property', property, name },
      )
      state.remainingProperties.delete(property)
      continue
    }
    const actualType = Type.ofExpression(property.value)
    const expectedType = Type.ofProperty(expected)
    if (
      actualType.kind !== 'unresolved'
      && expectedType.kind !== 'unresolved'
      && !Type.isCastCompatible(actualType, expectedType)
    ) {
      state.diagnostics.push({ kind: 'named-property-type', property, expected })
    }
    state.pairs.push({ property, expected })
    state.remainingProperties.delete(property)
    state.remainingExpected.delete(expected)
  }
}

function pairsByExpectedPropertyOrder(
  expectedProperties: readonly AST.TypeProperty[],
  pairs: readonly ItemPropertyBindingPair[],
): ItemPropertyBindingPair[] {
  // Item properties bind by type, not source position. Return pairs in the declared item
  // shape order so compiler output is stable and object fields follow the expected type.
  return pairs.toSorted((left, right) =>
    expectedProperties.indexOf(left.expected) - expectedProperties.indexOf(right.expected)
  )
}

function bindItemProperties(
  state: ItemPropertyBindingState,
  { matches, blockedPropertyTypes }: {
    matches: (property: AST.ItemProperty, expected: AST.TypeProperty) => boolean
    blockedPropertyTypes: ReadonlySet<string>
  },
): void {
  bindUnambiguousPairs({
    candidates: state.remainingProperties,
    targets: state.remainingExpected,
    isCandidateBlocked: property => {
      const propertyType = Type.identityKey(Type.ofExpression(property.value))
      return !!propertyType && blockedPropertyTypes.has(propertyType)
    },
    matches,
    bind: (property, expected) => {
      state.pairs.push({ property, expected })
      state.remainingProperties.delete(property)
      state.remainingExpected.delete(expected)
    },
  })
}

function propertyTypesExactlyMatch(property: AST.ItemProperty, expected: AST.TypeProperty): boolean {
  return typesExactlyMatch(Type.ofExpression(property.value), Type.ofProperty(expected))
}

function propertyTypesAreAssignable(property: AST.ItemProperty, expected: AST.TypeProperty): boolean {
  return Type.isAssignable(Type.ofExpression(property.value), Type.ofProperty(expected))
}

function propertyMatchGraph(
  remainingProperties: Set<AST.ItemProperty>,
  remainingExpected: Set<AST.TypeProperty>,
  duplicateProvidedPropertyTypes: ReadonlySet<string>,
): MatchGraph<AST.ItemProperty, AST.TypeProperty> {
  return matchGraph(
    remainingProperties,
    remainingExpected,
    property => {
      const type = Type.ofExpression(property.value)
      const key = Type.identityKey(type)
      return type.kind === 'unresolved' || (!!key && duplicateProvidedPropertyTypes.has(key))
    },
    propertyTypesAreAssignable,
  )
}

function reportDuplicateProvidedPropertyTypes(
  properties: readonly AST.ItemProperty[],
  diagnostics: ItemPropertyBindingDiagnostic[],
): Set<string> {
  return reportDuplicateCandidateTypes(
    properties,
    property => !!property.label,
    property => Type.identityKey(Type.ofExpression(property.value)),
    (property, type) =>
      diagnostics.push({
        kind: 'duplicate-provided-property-type',
        property,
        type,
      }),
  )
}
