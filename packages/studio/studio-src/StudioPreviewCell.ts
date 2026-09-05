import { Errors, Json, Switch } from '@shared/core'
import type {
  StudioCellIdentity,
  StudioParameterSchema,
  StudioPreviewCell,
  StudioPreviewManifestV2,
  StudioTaoSource,
} from './StudioPreviewManifest'
import type { StudioJsonValue } from './StudioProtocol'

/*
 * Helpers over one preview cell and its source anchors, shared by the server manifest and the
 * browser matrix. This module imports nothing Node-only, which is what lets the browser bundle
 * carry it; `StudioPreviewManifest` itself reaches the state library and stays server-side.
 */

/** cellIdentity names one cell of a manifest revision; the browser matrix and the server share it. */
export function cellIdentity(manifest: StudioPreviewManifestV2, cell: StudioPreviewCell): StudioCellIdentity {
  return {
    appName: manifest.project.appName,
    cellId: cell.cellId,
    cellRevision: cell.cellRevision,
    compileRevision: manifest.compileRevision,
    manifestRevision: manifest.manifestRevision,
    project: manifest.project.root,
  }
}

/** valueMatchesParameter checks one scenario argument against its parameter schema. */
export function valueMatchesParameter(value: StudioJsonValue, parameter: StudioParameterSchema): boolean {
  return Switch.kind(parameter.type, {
    boolean: () => typeof value === 'boolean',
    choice: type => type.values.some(candidate => Object.is(candidate, value)),
    json: type => type.entity === undefined || Json.isRecord(value),
    number: type =>
      typeof value === 'number'
      && Number.isFinite(value)
      && (type.minimum === undefined || value >= type.minimum)
      && (type.maximum === undefined || value <= type.maximum),
    text: () => typeof value === 'string',
    time: () => typeof value === 'string',
  })
}

/** validateTaoSource rejects a source anchor that is not a well-formed Tao range. */
export function validateTaoSource(source: StudioTaoSource, label: string): void {
  if (source.kind !== 'tao') {
    throw new Errors.UserInputError(`${label} must be Tao source.`)
  }
  requireText(source.path, `${label} path`)
  if (
    !Number.isSafeInteger(source.range.start)
    || !Number.isSafeInteger(source.range.end)
    || source.range.start < 0
    || source.range.end < source.range.start
  ) {
    throw new Errors.UserInputError(`${label} range is invalid.`)
  }
}

/** requireText rejects an empty or blank string where a label, path, or id is required. */
export function requireText(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Errors.UserInputError(`${label} must not be empty.`)
  }
  return value
}
