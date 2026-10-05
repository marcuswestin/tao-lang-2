import { AST } from '@parser'
import { Switch } from '@shared'
import { type ItemShapeField, Type } from './Type'
import { type BindingDiagnostic, resolveBindings } from './type-binding-matches'

export type ItemPropertyBindingPair = {
  property: AST.ItemProperty
  expected: ItemShapeField
}

export type ItemPropertyBindingDiagnostic =
  | { kind: 'duplicate-property-type'; expected: ItemShapeField; type: string }
  | { kind: 'duplicate-provided-property-type'; property: AST.ItemProperty; type: string }
  | { kind: 'unknown-named-property'; property: AST.ItemProperty; name: string }
  | { kind: 'duplicate-named-property'; property: AST.ItemProperty; expected: ItemShapeField }
  | { kind: 'named-property-type'; property: AST.ItemProperty; expected: ItemShapeField }
  | { kind: 'ambiguous-property'; property: AST.ItemProperty; expected: readonly ItemShapeField[] }
  | { kind: 'ambiguous-field'; expected: ItemShapeField; properties: readonly AST.ItemProperty[] }
  | { kind: 'unmatched-property'; property: AST.ItemProperty }
  | { kind: 'missing-property'; expected: ItemShapeField }

export type ItemPropertyBindingResult = {
  pairs: ItemPropertyBindingPair[]
  diagnostics: ItemPropertyBindingDiagnostic[]
}

/** resolveItemPropertyBindings binds item constructor property values to item type fields by type. */
export function resolveItemPropertyBindings(
  expectedProperties: readonly ItemShapeField[],
  properties: readonly AST.ItemProperty[],
): ItemPropertyBindingResult {
  const resolution = resolveBindings<AST.ItemProperty, ItemShapeField>({
    candidates: properties,
    targets: expectedProperties.filter(property => !Type.itemFieldIsFilled(property)),
    targetOrder: expectedProperties,
    candidateLabel: property => property.label,
    targetName: expected => expected.name,
    candidateType: property => Type.ofExpression(property.value),
    targetType: expected => Type.itemFieldType(expected),
    namedTypeAccepts: (actual, expected) => Type.isCastCompatible(actual, expected),
    duplicateTargetTypesOnlyWithCandidates: true,
    compatibleTypeAccepts: Type.isAssignableToConstruction,
    targetRequiresValue: expected => Type.itemFieldRequiresValue(expected),
    unresolvedCandidatesExcuseMissing: true,
  })
  return {
    pairs: resolution.pairs.map(([property, expected]) => ({ property, expected })),
    diagnostics: resolution.diagnostics.map(itemPropertyDiagnostic),
  }
}

function itemPropertyDiagnostic(
  diagnostic: BindingDiagnostic<AST.ItemProperty, ItemShapeField>,
): ItemPropertyBindingDiagnostic {
  return Switch.kind<BindingDiagnostic<AST.ItemProperty, ItemShapeField>, ItemPropertyBindingDiagnostic>(diagnostic, {
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
