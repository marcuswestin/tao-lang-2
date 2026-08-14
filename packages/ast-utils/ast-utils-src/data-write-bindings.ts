import { AST } from '@parser'
import { Type } from './Type'
import type { DataEntityDefinition, DataFieldDefinition } from './Type'
import {
  bindUnambiguousPairs,
  type MatchGraph,
  matchGraph,
  typesExactlyMatch,
} from './type-binding-matches'

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
  const fields = Type.dataFields(entity).filter(field => Type.dataFieldType(field).kind !== 'list')
  const diagnostics: DataWriteBindingDiagnostic[] = []
  const pairs: DataWriteBindingPair[] = []
  const remainingFields = new Set(fields)
  const remainingWrites = new Set(writes)

  bindNamedDataWriteFields(remainingWrites, remainingFields, pairs, diagnostics)
  bindBooleanCaseDataWriteFields(remainingWrites, remainingFields, pairs)
  // Defaulted fields may be omitted and are not eligible for unlabeled type binding. They can
  // still be written explicitly by label, while boolean cases bind by declaration identity above.
  for (const field of remainingFields) {
    if (hasDataFieldDefault(field)) {
      remainingFields.delete(field)
    }
  }
  if (remainingWrites.size > 0) {
    reportDuplicateDataFieldTypes([...remainingFields], diagnostics)
  }
  const duplicateWriteTypes = reportDuplicateWriteTypes([...remainingWrites], diagnostics)
  bindDataWriteFields(remainingWrites, remainingFields, pairs, dataWriteTypesExactlyMatch, duplicateWriteTypes)
  bindDataWriteFields(remainingWrites, remainingFields, pairs, dataWriteTypesAreAssignable, duplicateWriteTypes)

  const graph = dataWriteMatchGraph(remainingWrites, remainingFields, duplicateWriteTypes)
  const ambiguousWrites = new Set<AST.DataWriteField>()
  const ambiguousFields = new Set<DataFieldDefinition>()
  for (const write of remainingWrites) {
    const actual = Type.ofExpression(write.value)
    if (actual.kind === 'unresolved') {
      continue
    }
    const key = Type.identityKey(actual)
    if (key && duplicateWriteTypes.has(key)) {
      continue
    }
    const matches = graph.targetsByCandidate.get(write) ?? []
    if (matches.length > 1) {
      diagnostics.push({ kind: 'ambiguous-write', write, fields: matches })
      ambiguousWrites.add(write)
      matches.forEach(field => ambiguousFields.add(field))
    }
  }
  for (const [field, matches] of graph.candidatesByTarget) {
    if (matches.length > 1) {
      diagnostics.push({ kind: 'ambiguous-data-field', field, writes: matches })
      ambiguousFields.add(field)
      matches.forEach(write => ambiguousWrites.add(write))
    }
  }
  for (const write of remainingWrites) {
    if (ambiguousWrites.has(write)) {
      continue
    }
    const actual = Type.ofExpression(write.value)
    const key = Type.identityKey(actual)
    const writeIsUnmatched = actual.kind !== 'unresolved'
      && !(key && duplicateWriteTypes.has(key))
      && !(graph.targetsByCandidate.get(write)?.length)
    if (writeIsUnmatched) {
      diagnostics.push({ kind: 'unmatched-write', write })
    }
  }
  if (requireAll) {
    for (const field of remainingFields) {
      if (!ambiguousFields.has(field) && !hasDataFieldDefault(field)) {
        diagnostics.push({ kind: 'missing-data-field', field })
      }
    }
  }

  return {
    pairs: pairs.toSorted((left, right) => fields.indexOf(left.field) - fields.indexOf(right.field)),
    diagnostics,
  }
}

function bindBooleanCaseDataWriteFields(
  writes: Set<AST.DataWriteField>,
  fields: Set<DataFieldDefinition>,
  pairs: DataWriteBindingPair[],
): void {
  for (const write of [...writes]) {
    if (!AST.isValueReference(write.value) || !AST.isEntityDataField(write.value.target.ref)) {
      continue
    }
    const field = write.value.target.ref
    if (!fields.has(field)) {
      continue
    }
    pairs.push({ write, field })
    writes.delete(write)
    fields.delete(field)
  }
}

function hasDataFieldDefault(field: DataFieldDefinition): boolean {
  return field.boolean
    || field.modifiers.some(modifier => modifier.defaultValue !== undefined || modifier.defaultCase !== undefined)
}

function bindNamedDataWriteFields(
  remainingWrites: Set<AST.DataWriteField>,
  remainingFields: Set<DataFieldDefinition>,
  pairs: DataWriteBindingPair[],
  diagnostics: DataWriteBindingDiagnostic[],
): void {
  for (const write of [...remainingWrites]) {
    const name = write.label
    if (!name) {
      continue
    }
    const field = [...remainingFields].find(candidate => candidate.name === name)
    if (!field) {
      const declared = pairs.find(pair => pair.field.name === name)?.field
      diagnostics.push(
        declared
          ? { kind: 'duplicate-named-field', write, field: declared }
          : { kind: 'unknown-named-field', write, name },
      )
      remainingWrites.delete(write)
      continue
    }
    const actual = Type.ofExpression(write.value)
    const expected = Type.dataFieldType(field)
    if (
      actual.kind !== 'unresolved'
      && expected.kind !== 'unresolved'
      && !Type.isCastCompatible(actual, expected)
    ) {
      diagnostics.push({ kind: 'named-field-type', write, field })
    }
    pairs.push({ write, field })
    remainingWrites.delete(write)
    remainingFields.delete(field)
  }
}

function bindDataWriteFields(
  remainingWrites: Set<AST.DataWriteField>,
  remainingFields: Set<DataFieldDefinition>,
  pairs: DataWriteBindingPair[],
  matches: (write: AST.DataWriteField, field: DataFieldDefinition) => boolean,
  blockedWriteTypes: ReadonlySet<string>,
): void {
  bindUnambiguousPairs({
    candidates: remainingWrites,
    targets: remainingFields,
    isCandidateBlocked: write => {
      const key = Type.identityKey(Type.ofExpression(write.value))
      return !!key && blockedWriteTypes.has(key)
    },
    matches,
    bind: (write, field) => {
      pairs.push({ write, field })
      remainingWrites.delete(write)
      remainingFields.delete(field)
    },
  })
}

function dataWriteTypesExactlyMatch(write: AST.DataWriteField, field: DataFieldDefinition): boolean {
  return typesExactlyMatch(Type.ofExpression(write.value), Type.dataFieldType(field))
}

function dataWriteTypesAreAssignable(write: AST.DataWriteField, field: DataFieldDefinition): boolean {
  return Type.isAssignable(Type.ofExpression(write.value), Type.dataFieldType(field))
}

function dataWriteMatchGraph(
  remainingWrites: Set<AST.DataWriteField>,
  remainingFields: Set<DataFieldDefinition>,
  duplicateWriteTypes: ReadonlySet<string>,
): MatchGraph<AST.DataWriteField, DataFieldDefinition> {
  return matchGraph(
    remainingWrites,
    remainingFields,
    write => {
      const type = Type.ofExpression(write.value)
      const key = Type.identityKey(type)
      return type.kind === 'unresolved' || (!!key && duplicateWriteTypes.has(key))
    },
    dataWriteTypesAreAssignable,
  )
}

function reportDuplicateDataFieldTypes(
  fields: readonly DataFieldDefinition[],
  diagnostics: DataWriteBindingDiagnostic[],
): void {
  const seen = new Map<string, DataFieldDefinition>()
  for (const field of fields) {
    const key = Type.identityKey(Type.dataFieldType(field))
    if (!key) {
      continue
    }
    if (seen.has(key)) {
      diagnostics.push({ kind: 'duplicate-field-type', field, type: key })
      continue
    }
    seen.set(key, field)
  }
}

function reportDuplicateWriteTypes(
  writes: readonly AST.DataWriteField[],
  diagnostics: DataWriteBindingDiagnostic[],
): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const write of writes) {
    if (write.label) {
      continue
    }
    const key = Type.identityKey(Type.ofExpression(write.value))
    if (!key) {
      continue
    }
    if (seen.has(key)) {
      duplicates.add(key)
      diagnostics.push({ kind: 'duplicate-write-type', write, type: key })
      continue
    }
    seen.add(key)
  }
  return duplicates
}
