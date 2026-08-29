import { Errors, FS } from '@shared'
import { findTaoFiles } from './tao-files'

/** InPlace groups shared Tao CLI in-place file processing types. */
export namespace InPlace {
  /** Result declares the outcome of one in-place Tao file operation. */
  export type Result = {
    path: string
    status: 'changed' | 'unchanged' | 'error'
    error?: string
  }

  /** PathOptions configures path resolution for in-place Tao file commands. */
  export type PathOptions = {
    cwd?: string
  }

  /** ProcessOptions configures how an in-place file transform applies its output. */
  export type ProcessOptions = {
    write: boolean
  }

  /** Operation processes one Tao file and returns its in-place result. */
  export type Operation = (filePath: string) => Promise<Result>
}

/** inPlace owns common Tao CLI in-place file processing helpers. */
export const inPlace = {
  processFile,
  runOnTaoFiles,
  workspaceRootForPath,
} as const

/** runOnTaoFiles runs an in-place operation over every .tao file at or under `path`. */
async function runOnTaoFiles(path: string, operation: InPlace.Operation): Promise<InPlace.Result[]> {
  const results: InPlace.Result[] = []
  for (const filePath of await findTaoFiles(path)) {
    results.push(await operation(filePath))
  }
  return results
}

/** processFile reads a file, transforms it, and writes or checks the result. */
async function processFile(
  path: string,
  transform: (before: string) => Promise<string>,
  options: InPlace.ProcessOptions,
): Promise<InPlace.Result> {
  try {
    const before = await FS.readText(path)
    const after = await transform(before)
    return options.write ? await writeWhenChanged(path, before, after) : compareOnly(path, before, after)
  } catch (error) {
    return inPlaceError(path, error)
  }
}

/** workspaceRootForPath returns the package-aware workspace root for an in-place command root. */
async function workspaceRootForPath(path: string, options: InPlace.PathOptions = {}): Promise<string> {
  const root = FS.resolvePath(path, options.cwd)
  const cwd = FS.resolvePath('.', options.cwd)
  if (FS.pathIsWithin(root, cwd)) {
    return packageContainerRoot(cwd) ?? cwd
  }
  return packageAwarePathRoot(root, await FS.isFile(root))
}

/** compareOnly reports whether `after` differs from `before` without writing the file. */
function compareOnly(path: string, before: string, after: string): InPlace.Result {
  return { path, status: after === before ? 'unchanged' : 'changed' }
}

/** writeWhenChanged writes `after` over the file at `path` when it differs from `before`. */
async function writeWhenChanged(path: string, before: string, after: string): Promise<InPlace.Result> {
  if (after === before) {
    return { path, status: 'unchanged' }
  }
  await FS.writeText(path, after)
  return { path, status: 'changed' }
}

/** inPlaceError returns an error result for one in-place file operation. */
function inPlaceError(path: string, error: unknown): InPlace.Result {
  return { path, status: 'error', error: Errors.formatForUser(error) }
}

function packageAwarePathRoot(path: string, isFile: boolean): string {
  const packageRoot = packageContainerRoot(isFile ? FS.dirname(path) : path)
  if (packageRoot !== undefined) {
    return packageRoot
  }
  return isFile ? FS.dirname(path) : path
}

function packageContainerRoot(directoryPath: string): string | undefined {
  const parts = FS.slashPath(directoryPath).split('/')
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index]!
    if (part.startsWith('@') && part.length > 1) {
      return FS.resolvePath(parts.slice(0, index).join('/'))
    }
  }
  return undefined
}
