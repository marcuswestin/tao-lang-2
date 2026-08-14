import { AST } from '@parser'
import { Type } from './Type'
import {
  bindUnambiguousPairs,
  type MatchGraph,
  matchGraph,
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

/** resolveItemPropertyBindings binds item constructor property values to item type fields by type. */
export function resolveItemPropertyBindings(
  expectedProperties: readonly AST.TypeProperty[],
  properties: readonly AST.ItemProperty[],
): ItemPropertyBindingResult {
  const diagnostics: ItemPropertyBindingDiagnostic[] = []
  const pairs: ItemPropertyBindingPair[] = []
  const remainingExpected = new Set(expectedProperties)
  const remainingProperties = new Set(properties)

  bindNamedItemProperties(remainingProperties, remainingExpected, pairs, diagnostics)
  if (remainingProperties.size > 0) {
    reportDuplicatePropertyTypes([...remainingExpected], diagnostics)
  }
  const duplicateProvidedPropertyTypes = reportDuplicateProvidedPropertyTypes(properties, diagnostics)

  bindItemProperties(
    remainingProperties,
    remainingExpected,
    pairs,
    propertyTypesExactlyMatch,
    duplicateProvidedPropertyTypes,
  )
  bindItemProperties(
    remainingProperties,
    remainingExpected,
    pairs,
    propertyTypesAreAssignable,
    duplicateProvidedPropertyTypes,
  )

  const matchGraph = propertyMatchGraph(remainingProperties, remainingExpected, duplicateProvidedPropertyTypes)
  const ambiguousProperties = new Set<AST.ItemProperty>()
  const ambiguousExpected = new Set<AST.TypeProperty>()
  let unresolvedProperties = 0
  for (const property of remainingProperties) {
    const actualType = Type.ofExpression(property.value)
    if (actualType.kind === 'unresolved') {
      unresolvedProperties += 1
      continue
    }
    const propertyKey = Type.identityKey(actualType)
    if (propertyKey && duplicateProvidedPropertyTypes.has(propertyKey)) {
      continue
    }
    const matches = matchGraph.targetsByCandidate.get(property) ?? []
    if (matches.length > 1) {
      diagnostics.push({
        kind: 'ambiguous-property',
        property,
        expected: matches,
      })
      ambiguousProperties.add(property)
      for (const expected of matches) {
        ambiguousExpected.add(expected)
      }
    }
  }
  for (const [expected, matches] of matchGraph.candidatesByTarget) {
    if (matches.length > 1) {
      diagnostics.push({
        kind: 'ambiguous-field',
        expected,
        properties: matches,
      })
      ambiguousExpected.add(expected)
      for (const property of matches) {
        ambiguousProperties.add(property)
      }
    }
  }
  for (const property of remainingProperties) {
    if (ambiguousProperties.has(property)) {
      continue
    }
    const actualType = Type.ofExpression(property.value)
    const propertyKey = Type.identityKey(actualType)
    const propertyIsUnmatched = actualType.kind !== 'unresolved'
      && !(propertyKey && duplicateProvidedPropertyTypes.has(propertyKey))
      && !(matchGraph.targetsByCandidate.get(property)?.length)
    if (propertyIsUnmatched) {
      diagnostics.push({
        kind: 'unmatched-property',
        property,
      })
    }
  }

  for (const expected of remainingExpected) {
    if (ambiguousExpected.has(expected)) {
      continue
    }
    if (unresolvedProperties > 0) {
      unresolvedProperties -= 1
      continue
    }
    diagnostics.push({
      kind: 'missing-property',
      expected,
    })
  }

  return { pairs: pairsByExpectedPropertyOrder(expectedProperties, pairs), diagnostics }
}

function reportDuplicatePropertyTypes(
  properties: readonly AST.TypeProperty[],
  diagnostics: ItemPropertyBindingDiagnostic[],
): void {
  const seen = new Map<string, AST.TypeProperty>()
  for (const property of properties) {
    const key = Type.identityKey(Type.ofProperty(property))
    if (!key) {
      continue
    }
    if (seen.has(key)) {
      diagnostics.push({
        kind: 'duplicate-property-type',
        expected: property,
        type: key,
      })
      continue
    }
    seen.set(key, property)
  }
}

function bindNamedItemProperties(
  remainingProperties: Set<AST.ItemProperty>,
  remainingExpected: Set<AST.TypeProperty>,
  pairs: ItemPropertyBindingPair[],
  diagnostics: ItemPropertyBindingDiagnostic[],
): void {
  for (const property of [...remainingProperties]) {
    const name = property.label
    if (!name) {
      continue
    }
    const expected = [...remainingExpected].find(candidate => candidate.name === name)
    if (!expected) {
      const declared = pairs.find(pair => pair.expected.name === name)?.expected
      diagnostics.push(
        declared
          ? { kind: 'duplicate-named-property', property, expected: declared }
          : { kind: 'unknown-named-property', property, name },
      )
      remainingProperties.delete(property)
      continue
    }
    const actualType = Type.ofExpression(property.value)
    const expectedType = Type.ofProperty(expected)
    if (
      actualType.kind !== 'unresolved'
      && expectedType.kind !== 'unresolved'
      && !Type.isCastCompatible(actualType, expectedType)
    ) {
      diagnostics.push({ kind: 'named-property-type', property, expected })
    }
    pairs.push({ property, expected })
    remainingProperties.delete(property)
    remainingExpected.delete(expected)
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
  remainingProperties: Set<AST.ItemProperty>,
  remainingExpected: Set<AST.TypeProperty>,
  pairs: ItemPropertyBindingPair[],
  matches: (property: AST.ItemProperty, expected: AST.TypeProperty) => boolean,
  blockedPropertyTypes: ReadonlySet<string> = new Set(),
): void {
  bindUnambiguousPairs({
    candidates: remainingProperties,
    targets: remainingExpected,
    isCandidateBlocked: property => {
      const propertyType = Type.identityKey(Type.ofExpression(property.value))
      return !!propertyType && blockedPropertyTypes.has(propertyType)
    },
    matches,
    bind: (property, expected) => {
      pairs.push({ property, expected })
      remainingProperties.delete(property)
      remainingExpected.delete(expected)
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
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const property of properties) {
    if (property.label) {
      continue
    }
    const key = Type.identityKey(Type.ofExpression(property.value))
    if (!key) {
      continue
    }
    if (seen.has(key)) {
      duplicates.add(key)
      diagnostics.push({
        kind: 'duplicate-provided-property-type',
        property,
        type: key,
      })
      continue
    }
    seen.add(key)
  }
  return duplicates
}
