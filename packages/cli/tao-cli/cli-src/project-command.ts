import { Errors } from '@shared'

/** Validate an app id supplied to `tao create` before using it as a directory name. */
export function validateProjectId(id: string): void {
  if (id.length === 0 || /[\u0000-\u001f\u007f]/u.test(id)) {
    Errors.throwUserInput('An app id must be non-empty text without control characters.')
  }
}
