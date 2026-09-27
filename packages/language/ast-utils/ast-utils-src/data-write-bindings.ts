import { AST } from '@parser'
import { Switch } from '@shared'
import { Type } from './Type'
import type { DataEntityDefinition, DataFieldDefinition } from './Type'
import { type BindingDiagnostic, resolveBindings } from './type-binding-matches'

export type DataWriteBindingPair = {
  write: AST.DataWriteField
  field: DataFieldDefinition
}

export type DataWriteBindingDiagnostic =
  | { kind: 'duplicate-field-type'; field: DataFieldDefinition; type: string }
  | { kind: 'duplicate-write-type'; write: AST.DataWriteField; type: string }
  | { kind: 'unknown-named-field'; write: AST.DataWriteField; name: string }
  | { kind: 'duplicate-named-field'; write: AST.DataWriteField; field: DataFieldDefinition }
  | { kind: 'named-field-type'; write: AST.DataWriteField; field: DataFieldDefinition }
  | { kind: 'ambiguous-write'; write: AST.DataWriteField; fields: readonly DataFieldDefinition[] }
  | { kind: 'ambiguous-data-field'; field: DataFieldDefinition; writes: readonly AST.DataWriteField[] }
  | { kind: 'unmatched-write'; write: AST.DataWriteField }
  | { kind: 'missing-data-field'; field: DataFieldDefinition }

export type DataWriteBindingResult = {
  pairs: DataWriteBindingPair[]
  diagnostics: DataWriteBindingDiagnostic[]
}

/** resolveDataWriteBindings binds create/update values to the target entity's fields by label or type. */
export function resolveDataWriteBindings(
  entity: DataEntityDefinition,
  writes: readonly AST.DataWriteField[],
  requireAll: boolean,
): DataWriteBindingResult {
  const resolution = resolveBindings<AST.DataWriteField, DataFieldDefinition>({
    candidates: writes,
    targets: Type.dataFields(entity).filter(field => Type.dataFieldType(field).kind !== 'list'),
    candidateLabel: write => write.label,
    targetName: field => field.name,
    candidateType: write => Type.ofExpression(write.value),
    targetType: field => Type.dataFieldValueType(field),
    namedTypeAccepts: (actual, expected) => Type.isCastCompatible(actual, expected),
    afterNamedBinding: ({ bind, remainingCandidates, remainingTargets }) => {
      // A boolean case written by reference names its field by declaration identity, before types.
      for (const write of [...remainingCandidates]) {
        if (!AST.isValueReference(write.value) || !AST.isEntityDataField(write.value.target.ref)) {
          continue
        }
        const field = write.value.target.ref
        if (remainingTargets.has(field)) {
          bind(write, field)
        }
      }
      // Defaulted fields may be omitted and are not eligible for unlabeled type binding. They can
      // still be written explicitly by label, which the named pass has already done.
      for (const field of [...remainingTargets]) {
        if (hasDataFieldDefault(field)) {
          remainingTargets.delete(field)
        }
      }
    },
    duplicateTargetTypesOnlyWithCandidates: true,
    targetRequiresValue: field => requireAll && !field.optional && !hasDataFieldDefault(field),
    unresolvedCandidatesExcuseMissing: false,
  })
  return {
    pairs: resolution.pairs.map(([write, field]) => ({ write, field })),
    diagnostics: resolution.diagnostics.map(dataWriteDiagnostic),
  }
}

/** createRequiresField is whether a create must supply this field: a stored value with no default. */
export function createRequiresField(field: DataFieldDefinition): boolean {
  return Type.dataFieldType(field).kind !== 'list' && !field.optional && !hasDataFieldDefault(field)
}

function hasDataFieldDefault(field: DataFieldDefinition): boolean {
  return field.boolean
    || (field.traits?.traits ?? []).some(trait => trait.defaultValue !== undefined || trait.defaultCase !== undefined)
}

function dataWriteDiagnostic(
  diagnostic: BindingDiagnostic<AST.DataWriteField, DataFieldDefinition>,
): DataWriteBindingDiagnostic {
  return Switch.kind<BindingDiagnostic<AST.DataWriteField, DataFieldDefinition>, DataWriteBindingDiagnostic>(
    diagnostic,
    {
      'duplicate-target-type': ({ target, type }) => ({ kind: 'duplicate-field-type', field: target, type }),
      'duplicate-candidate-type': ({ candidate, type }) => ({ kind: 'duplicate-write-type', write: candidate, type }),
      'unknown-named': ({ candidate, name }) => ({ kind: 'unknown-named-field', write: candidate, name }),
      'duplicate-named': ({ candidate, target }) => ({
        kind: 'duplicate-named-field',
        write: candidate,
        field: target,
      }),
      'named-type': ({ candidate, target }) => ({ kind: 'named-field-type', write: candidate, field: target }),
      'ambiguous-candidate': ({ candidate, targets }) => ({
        kind: 'ambiguous-write',
        write: candidate,
        fields: targets,
      }),
      'ambiguous-target': ({ target, candidates }) => ({
        kind: 'ambiguous-data-field',
        field: target,
        writes: candidates,
      }),
      unmatched: ({ candidate }) => ({ kind: 'unmatched-write', write: candidate }),
      missing: ({ target }) => ({ kind: 'missing-data-field', field: target }),
    },
  )
}
