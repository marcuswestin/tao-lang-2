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
    excludeDirectory: isGeneratedOrVendoredTaoDirectory,
  })
  for await (const filePath of files) {
    results.push(await operation(filePath))
  }
  return results
}

/** workspaceRootForInPlacePath returns the package-aware workspace root for an in-place command root. */
export async function workspaceRootForInPlacePath(path: string): Promise<string> {
  const root = FS.resolvePath(path)
  if (!await FS.isFile(root)) {
    return root
  }
  const cwd = FS.resolvePath('.')
  if (pathIsWithin(root, cwd)) {
    return cwd
  }
  return packageAwareFileRoot(root)
}

/** compareOnly reports whether `after` differs from `before` without writing the file. */
export function compareOnly(path: string, before: string, after: string): InPlaceFileResult {
  return { path, status: after === before ? 'unchanged' : 'changed' }
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

function isGeneratedOrVendoredTaoDirectory(name: string): boolean {
  return name === 'node_modules' || name.startsWith('_gen_') || name.startsWith('old-')
}

function packageAwareFileRoot(filePath: string): string {
  const parts = FS.slashPath(filePath).split('/')
  for (let index = parts.length - 2; index >= 0; index--) {
    const part = parts[index]!
    if (part.startsWith('@') && part.length > 1) {
      return FS.resolvePath(parts.slice(0, index).join('/'))
    }
  }
  return FS.dirname(filePath)
}

function pathIsWithin(path: string, directoryPath: string): boolean {
  const relative = FS.relativePath(directoryPath, path)
  return relative === '' || (!relative.startsWith('..') && relative !== '..')
}
