import { Errors } from '@shared'
import type { StudioProjectFile } from '../StudioProtocol'

export type StudioSourceActionConflictCode =
  | 'checkpoint-identity-mismatch'
  | 'node-kind-mismatch'
  | 'render-owner-mismatch'
  | 'measurement-unavailable'
  | 'scenario-action-mismatch'
  | 'stale-preview'
  | 'stale-scenario'
  | 'stale-source'

export type StudioSourceActionConflictDetails = {
  actual?: string
  checkpointId?: string
  expected?: string
  path?: string
  renderId?: string
}

/** StudioSourceActionConflictError carries stable, UI-safe conflict details across the Studio server boundary. */
export class StudioSourceActionConflictError extends Errors.UserInputError {
  constructor(
    readonly code: StudioSourceActionConflictCode,
    message: string,
    override readonly details: StudioSourceActionConflictDetails,
  ) {
    super(message, details)
  }
}

/** StudioSourceConflictError reports optimistic source-version mismatches as HTTP 409 at the server boundary. */
export class StudioSourceConflictError extends StudioSourceActionConflictError {
  constructor(
    readonly path: string,
    readonly expectedSourceVersion: string,
    readonly actualSourceVersion: string,
  ) {
    super('stale-source', `Studio source changed before the edit was applied: ${path}`, {
      actual: actualSourceVersion,
      expected: expectedSourceVersion,
      path,
    })
  }
}

/** requireSourceVersion rejects a request computed against a source version the disk no longer holds. */
export function requireSourceVersion(file: StudioProjectFile, expected: string): void {
  if (file.sourceVersion !== expected) {
    throw new StudioSourceConflictError(file.path, expected, file.sourceVersion)
  }
}
