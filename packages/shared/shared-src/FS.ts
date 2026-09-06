import { type Dirent, existsSync as nodeExistsSync, readFileSync as nodeReadFileSync } from 'node:fs'
import * as nodeFs from 'node:fs/promises'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'

/** WalkOptions declares filters for recursive file walking. */
export type WalkOptions = {
  includeDirectories?: boolean
  includeHidden?: boolean
  followSymlinks?: boolean
  extensions?: readonly string[]
  excludeDirectory?: (name: string) => boolean
}

type WalkContext = {
  openedDirectories: Set<string>
}

/** FileHandle declares an opened filesystem handle. */
export type FileHandle = Awaited<ReturnType<typeof nodeFs.open>>

/**
 * resolvePath resolves a slash-separated path into an absolute host path.
 * Without cwd, relative paths resolve from the current process cwd.
 * When cwd is provided, relative paths resolve from it and absolute paths ignore it.
 * Use this for full filesystem locations; use joinPath only for ungrounded path fragments.
 */
export function resolvePath(inputPath: string, cwd?: string): string {
  return cwd === undefined
    ? nodePath.resolve(normalizePathPart(inputPath))
    : nodePath.resolve(normalizePathPart(cwd), normalizePathPart(inputPath))
}

/**
 * joinPath joins an ungrounded slash-separated path fragment into a host path.
 * ONLY use it before a full filesystem location exists; prefer resolvePath for full paths.
 */
export function joinPath(inputPath: string): string {
  return nodePath.normalize(normalizePathPart(inputPath))
}

/** dirname returns the parent directory for a path. */
export const dirname = (inputPath: string) => nodePath.dirname(inputPath)
/** basename returns the final path segment. */
export const basename = (inputPath: string, suffix?: string) => nodePath.basename(inputPath, suffix)
/** extname returns the extension for a path. */
export const extname = (inputPath: string) => nodePath.extname(inputPath)
/** relativePath returns the slash-separated path from `fromPath` to `toPath`. */
export const relativePath = (fromPath: string, toPath: string) => slashPath(nodePath.relative(fromPath, toPath))
/** pathIsWithin returns whether `path` is `directoryPath` or a path inside it. */
export function pathIsWithin(path: string, directoryPath: string): boolean {
  const relative = relativePath(directoryPath, path)
  return relative === '' || (!relative.startsWith('..') && relative !== '..')
}
/** displayPath returns a path relative to the current working directory for human-readable output. */
export function displayPath(inputPath: string): string {
  const relative = relativePath(resolvePath('.'), inputPath)
  return relative === '' ? '.' : relative
}
/** slashPath returns a path with host separators normalized to slashes. */
export const slashPath = (inputPath: string) =>
  nodePath.sep === '/' ? inputPath : inputPath.replaceAll(nodePath.sep, '/')
/** tmpdir returns the host temporary directory. */
export const tmpdir = () => nodeOs.tmpdir()
/** homeDir returns the host user's home directory. */
export const homeDir = () => nodeOs.homedir()

function normalizePathPart(part: string): string {
  return nodePath.sep === '/' ? part : part.replaceAll('/', nodePath.sep)
}

/**
 * mkTmpDir creates a unique temporary directory with the given prefix. A bare prefix is placed in
 * the platform's temporary directory rather than the process cwd, which a sandbox may not let the
 * process write and which no caller means to litter.
 */
export async function mkTmpDir(prefix: string): Promise<string> {
  return nodeFs.mkdtemp(nodePath.isAbsolute(prefix) ? prefix : nodePath.join(nodeOs.tmpdir(), prefix))
}

/** exists checks whether a path can be accessed. */
export async function exists(inputPath: string): Promise<boolean> {
  try {
    await nodeFs.access(inputPath)
    return true
  } catch {
    return false
  }
}

/** existsSync checks whether a path exists without leaving sync-only callers to import node:fs. */
export function existsSync(inputPath: string): boolean {
  return nodeExistsSync(inputPath)
}

/** isFile checks whether a path exists and is a file. */
export async function isFile(inputPath: string): Promise<boolean> {
  try {
    return (await nodeFs.stat(inputPath)).isFile()
  } catch {
    return false
  }
}

/** isDirectory checks whether a path exists and is a directory. */
export async function isDirectory(inputPath: string): Promise<boolean> {
  try {
    return (await nodeFs.stat(inputPath)).isDirectory()
  } catch {
    return false
  }
}

/** realPath resolves symlinks and filesystem indirections for an existing path. */
export async function realPath(inputPath: string): Promise<string> {
  return nodeFs.realpath(inputPath)
}

/** isEmptyDirectory checks whether a directory contains any entries. */
export async function isEmptyDirectory(inputPath: string): Promise<boolean> {
  if (!await isDirectory(inputPath)) {
    return false
  }
  const dir = await nodeFs.opendir(inputPath)
  try {
    return (await dir.read()) === null
  } finally {
    await dir.close()
  }
}

/** readText reads a UTF-8 file. */
export async function readText(inputPath: string): Promise<string> {
  return nodeFs.readFile(inputPath, 'utf8')
}

/** readTextSync reads UTF-8 text for synchronous compiler and validator passes. */
export function readTextSync(inputPath: string): string {
  return nodeReadFileSync(inputPath, 'utf8')
}

/** readFile reads a file as bytes. */
export async function readFile(inputPath: string): Promise<Uint8Array> {
  return nodeFs.readFile(inputPath)
}

/** modifiedTimeMs reads the last modified timestamp for a path. */
export async function modifiedTimeMs(inputPath: string): Promise<number> {
  return (await nodeFs.stat(inputPath)).mtimeMs
}

/** fileMode reads the portable permission bits for a filesystem entry. */
export async function fileMode(inputPath: string): Promise<number> {
  return (await nodeFs.stat(inputPath)).mode & 0o777
}

/** chmod replaces the permission bits for a filesystem entry. */
export async function chmod(inputPath: string, mode: number): Promise<void> {
  await nodeFs.chmod(inputPath, mode)
}

/** readJson reads and parses a JSON file. */
export async function readJson<T = unknown>(inputPath: string): Promise<T> {
  return JSON.parse(await readText(inputPath)) as T
}

/** WriteOptions carries the permission bits a new file should be created with, such as 0o600. */
export type WriteOptions = {
  mode?: number
}

/** writeText writes a UTF-8 file, creating parent directories. */
export async function writeText(inputPath: string, content: string, options: WriteOptions = {}): Promise<void> {
  await mkdir(dirname(inputPath))
  await nodeFs.writeFile(inputPath, content, { encoding: 'utf8', mode: options.mode })
}

/** writeFile writes file content, creating parent directories. */
export async function writeFile(inputPath: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(inputPath))
  await nodeFs.writeFile(inputPath, content)
}

/** writeJson writes formatted JSON, creating parent directories. */
export async function writeJson(inputPath: string, content: unknown, options: WriteOptions = {}): Promise<void> {
  await writeText(inputPath, `${JSON.stringify(content, null, 2)}\n`, options)
}

/** openAppend opens a file for appending, creating parent directories. */
export async function openAppend(inputPath: string): Promise<FileHandle> {
  await mkdir(dirname(inputPath))
  return nodeFs.open(inputPath, 'a')
}

/** mkdir creates a directory and any missing parents. */
export async function mkdir(inputPath: string): Promise<void> {
  await nodeFs.mkdir(inputPath, { recursive: true })
}

/** remove deletes a path recursively if it exists. */
export async function remove(inputPath: string): Promise<void> {
  await nodeFs.rm(inputPath, { force: true, recursive: true })
}

/** copyFile copies a file, creating the destination parent directory. */
export async function copyFile(fromPath: string, toPath: string): Promise<void> {
  await mkdir(dirname(toPath))
  await nodeFs.copyFile(fromPath, toPath)
}

/** copyDirectory copies a directory recursively. */
export async function copyDirectory(fromPath: string, toPath: string): Promise<void> {
  await mkdir(dirname(toPath))
  await nodeFs.cp(fromPath, toPath, { recursive: true })
}

/** move renames a path, creating the destination parent directory. */
export async function move(fromPath: string, toPath: string): Promise<void> {
  await mkdir(dirname(toPath))
  await nodeFs.rename(fromPath, toPath)
}

/** symlink creates a filesystem symlink, creating the destination parent directory. */
export async function symlink(targetPath: string, linkPath: string): Promise<void> {
  await mkdir(dirname(linkPath))
  await nodeFs.symlink(targetPath, linkPath)
}

/**
 * replaceSymlink points a symlink at `targetPath`, replacing whatever the link path held. Removing
 * a symlink never follows it, so an existing link is unlinked rather than its target deleted.
 */
export async function replaceSymlink(targetPath: string, linkPath: string): Promise<void> {
  await remove(linkPath)
  await symlink(targetPath, linkPath)
}

/** listDir lists direct child names for a directory, sorted for platform-independent order. */
export async function listDir(inputPath: string): Promise<string[]> {
  return (await nodeFs.readdir(inputPath)).sort()
}

/** walk yields files under a path according to the provided filters. */
export async function* walk(inputPath: string, options: WalkOptions = {}): AsyncGenerator<string> {
  const absolutePath = resolvePath(inputPath)
  const stats = options.followSymlinks === true ? await nodeFs.stat(absolutePath) : await nodeFs.lstat(absolutePath)

  if (stats.isDirectory()) {
    yield* walkDirectory(absolutePath, options, createWalkContext())
    return
  }

  if (shouldYield(absolutePath, false, options)) {
    yield absolutePath
  }
}

async function* walkDirectory(
  directoryPath: string,
  options: WalkOptions,
  context: WalkContext,
): AsyncGenerator<string> {
  const realDirectoryPath = await nodeFs.realpath(directoryPath)
  if (context.openedDirectories.has(realDirectoryPath)) {
    return
  }
  context.openedDirectories.add(realDirectoryPath)

  const dir = await nodeFs.opendir(directoryPath)
  try {
    while (true) {
      const entry = await dir.read()
      if (entry === null) {
        break
      }

      const entryPath = resolvePath(entry.name, directoryPath)
      const isDirectoryEntry = entry.isDirectory() || await isFollowedSymlinkDirectory(entry, entryPath, options)

      if (shouldYield(entryPath, isDirectoryEntry, options)) {
        yield entryPath
      }
      if (isDirectoryEntry && shouldWalkDirectory(entry.name, options)) {
        yield* walkDirectory(entryPath, options, context)
      }
    }
  } finally {
    await dir.close()
  }
}

function createWalkContext(): WalkContext {
  return { openedDirectories: new Set() }
}

async function isFollowedSymlinkDirectory(
  entry: Dirent,
  entryPath: string,
  options: WalkOptions,
): Promise<boolean> {
  if (options.followSymlinks !== true || !entry.isSymbolicLink()) {
    return false
  }
  try {
    return (await nodeFs.stat(entryPath)).isDirectory()
  } catch {
    return false
  }
}

function shouldWalkDirectory(name: string, options: WalkOptions): boolean {
  if (options.excludeDirectory?.(name)) {
    return false
  }
  return options.includeHidden === true || !name.startsWith('.')
}

function shouldYield(inputPath: string, isDirectoryPath: boolean, options: WalkOptions): boolean {
  const name = basename(inputPath)

  if (!options.includeHidden && name.startsWith('.')) {
    return false
  }
  if (isDirectoryPath) {
    return options.includeDirectories === true
  }
  if (options.extensions && !options.extensions.includes(extname(name))) {
    return false
  }
  return true
}
