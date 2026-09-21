import { AST } from '@parser'
import { Switch } from '@shared'
import { Type } from './Type'
import { type BindingDiagnostic, resolveBindings } from './type-binding-matches'

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
  const resolution = resolveBindings<AST.ItemProperty, AST.TypeProperty>({
    candidates: properties,
    targets: expectedProperties.filter(property => !Type.propertyIsFilled(property)),
    targetOrder: expectedProperties,
    candidateLabel: property => property.label,
    targetName: expected => expected.name,
    candidateType: property => Type.ofExpression(property.value),
    targetType: expected => Type.ofProperty(expected),
    namedTypeAccepts: (actual, expected) => Type.isCastCompatible(actual, expected),
    duplicateTargetTypesOnlyWithCandidates: true,
    targetRequiresValue: expected => Type.propertyRequiresValue(expected),
    unresolvedCandidatesExcuseMissing: true,
  })
  return {
    pairs: resolution.pairs.map(([property, expected]) => ({ property, expected })),
    diagnostics: resolution.diagnostics.map(itemPropertyDiagnostic),
  }
}

function itemPropertyDiagnostic(
  diagnostic: BindingDiagnostic<AST.ItemProperty, AST.TypeProperty>,
): ItemPropertyBindingDiagnostic {
  return Switch.kind<BindingDiagnostic<AST.ItemProperty, AST.TypeProperty>, ItemPropertyBindingDiagnostic>(diagnostic, {
    'duplicate-target-type': ({ target, type }) => ({ kind: 'duplicate-property-type', expected: target, type }),
    'duplicate-candidate-type': ({ candidate, type }) => ({
      kind: 'duplicate-provided-property-type',
      property: candidate,
      type,
    }),
    'unknown-named': ({ candidate, name }) => ({ kind: 'unknown-named-property', property: candidate, name }),
    'duplicate-named': ({ candidate, target }) => ({
      kind: 'duplicate-named-property',
      property: candidate,
      expected: target,
    }),
    'named-type': ({ candidate, target }) => ({ kind: 'named-property-type', property: candidate, expected: target }),
    'ambiguous-candidate': ({ candidate, targets }) => ({
      kind: 'ambiguous-property',
      property: candidate,
      expected: targets,
    }),
    'ambiguous-target': ({ target, candidates }) => ({
      kind: 'ambiguous-field',
      expected: target,
      properties: candidates,
    }),
    unmatched: ({ candidate }) => ({ kind: 'unmatched-property', property: candidate }),
    missing: ({ target }) => ({ kind: 'missing-property', expected: target }),
  })
}
