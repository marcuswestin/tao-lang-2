import { Errors, FS } from '@shared'

/** InPlaceFileResult declares the outcome of one in-place Tao file operation. */
export type InPlaceFileResult = {
  path: string
  status: 'changed' | 'unchanged' | 'error'
  error?: string
}

/** runOnTaoFiles runs an in-place operation over every .tao file at or under `path`. */
export async function runOnTaoFiles(
  path: string,
  operation: (filePath: string) => Promise<InPlaceFileResult>,
): Promise<InPlaceFileResult[]> {
  const root = FS.resolvePath(path)
  if (!await FS.exists(root)) {
    Errors.throwUserInput(`No file or directory found at ${root}`)
  }
  // An explicitly named file is an opt-in; walk filters only apply to directory recursion.
  if (await FS.isFile(root)) {
    return [await operation(root)]
  }
  const results: InPlaceFileResult[] = []
  const files = FS.walk(root, {
    extensions: ['.tao'],
    excludeDirectoryNames: ['node_modules'],
  })
  for await (const filePath of files) {
    results.push(await operation(filePath))
  }
  return results
}

/** writeWhenChanged writes `after` over the file at `path` when it differs from `before`. */
export async function writeWhenChanged(path: string, before: string, after: string): Promise<InPlaceFileResult> {
  if (after === before) {
    return { path, status: 'unchanged' }
  }
  await FS.writeText(path, after)
  return { path, status: 'changed' }
}

/** inPlaceError returns an error result for one in-place file operation. */
export function inPlaceError(path: string, error: unknown): InPlaceFileResult {
  return { path, status: 'error', error: Errors.formatForUser(error) }
}
