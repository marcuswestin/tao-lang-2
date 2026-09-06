import { Errors } from '@shared/core'
import type { StudioCompileDiagnostic, StudioDiagnosticRange } from './client/StudioApiClient'
import type { StudioSearchResult } from './client/StudioRailPanels'
import { type StudioCanonicalSourceAction, StudioProtocol } from './StudioProtocol'
import type { StudioTestFailure } from './StudioTestRunner'

/** StudioPanelPayloads validates JSON crossing the string-only Tao ProductHost action boundary. */
export const StudioPanelPayloads = {
  compileDiagnostic(payload: string): StudioCompileDiagnostic {
    const value = objectPayload(payload, 'diagnostic')
    if (
      typeof value['message'] !== 'string'
      || !optionalString(value['filePath'])
      || !optionalRange(value['range'])
    ) {
      throw invalidPayload('diagnostic')
    }
    return {
      message: value['message'],
      ...(value['filePath'] === undefined ? {} : { filePath: value['filePath'] }),
      ...(value['range'] === undefined ? {} : { range: value['range'] }),
    }
  },

  searchResult(payload: string): StudioSearchResult {
    const value = objectPayload(payload, 'search result')
    if (
      typeof value['detail'] !== 'string'
      || (value['kind'] !== 'diagnostic' && value['kind'] !== 'text')
      || typeof value['label'] !== 'string'
      || typeof value['path'] !== 'string'
      || !optionalNonNegativeInteger(value['start'])
      || !optionalNonNegativeInteger(value['end'])
      || !optionalString(value['sourceVersion'])
      || !optionalRange(value['range'])
    ) {
      throw invalidPayload('search result')
    }
    return {
      detail: value['detail'],
      kind: value['kind'],
      label: value['label'],
      path: value['path'],
      ...(value['end'] === undefined ? {} : { end: value['end'] }),
      ...(value['range'] === undefined ? {} : { range: value['range'] }),
      ...(value['sourceVersion'] === undefined ? {} : { sourceVersion: value['sourceVersion'] }),
      ...(value['start'] === undefined ? {} : { start: value['start'] }),
    }
  },

  sourceAction(payload: string): StudioCanonicalSourceAction {
    const action = StudioProtocol.parseCanonicalSourceAction(parsePayload(payload, 'inspector action'))
    if (action === undefined) {
      throw invalidPayload('inspector action')
    }
    return action
  },

  testFailure(payload: string): StudioTestFailure {
    const value = objectPayload(payload, 'test failure')
    if (
      typeof value['filePath'] !== 'string'
      || typeof value['message'] !== 'string'
      || typeof value['name'] !== 'string'
      || !optionalPositiveInteger(value['line'])
      || !optionalPositiveInteger(value['column'])
    ) {
      throw invalidPayload('test failure')
    }
    return {
      filePath: value['filePath'],
      message: value['message'],
      name: value['name'],
      ...(value['column'] === undefined ? {} : { column: value['column'] }),
      ...(value['line'] === undefined ? {} : { line: value['line'] }),
    }
  },
} as const

function objectPayload(payload: string, label: string): Record<string, unknown> {
  const value = parsePayload(payload, label)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidPayload(label)
  }
  return value as Record<string, unknown>
}

function parsePayload(payload: string, label: string): unknown {
  try {
    return JSON.parse(payload) as unknown
  } catch {
    throw invalidPayload(label)
  }
}

function optionalRange(value: unknown): value is StudioDiagnosticRange | undefined {
  return value === undefined || diagnosticPositionPair(value)
}

function diagnosticPositionPair(value: unknown): value is StudioDiagnosticRange {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const range = value as Record<string, unknown>
  return diagnosticPosition(range['start']) && diagnosticPosition(range['end'])
}

function diagnosticPosition(value: unknown): value is { character: number; line: number } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const position = value as Record<string, unknown>
  return nonNegativeInteger(position['character']) && nonNegativeInteger(position['line'])
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function optionalNonNegativeInteger(value: unknown): value is number | undefined {
  return value === undefined || nonNegativeInteger(value)
}

function optionalPositiveInteger(value: unknown): value is number | undefined {
  return value === undefined || Number.isInteger(value) && (value as number) > 0
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function invalidPayload(label: string): Error {
  return new Errors.UserInputError(`Tao Studio ${label} actions require a valid structured payload.`)
}
