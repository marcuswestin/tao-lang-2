import { createHash, randomUUID } from 'node:crypto'
import {
  type Dirent,
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
  realpathSync as nodeRealpathSync,
} from 'node:fs'
import * as nodeFs from 'node:fs/promises'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import { messageOf, throwUnexpected, UnexpectedBehaviorError } from './core/Errors'
import { sleep } from './core/Time'
import { processIsAlive, runtimeProcess, spawnSync } from './Platform'

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

/** isSymbolicLink reports on the path entry itself rather than following its target. */
export async function isSymbolicLink(inputPath: string): Promise<boolean> {
  try {
    return (await nodeFs.lstat(inputPath)).isSymbolicLink()
  } catch {
    return false
  }
}

/** realPath resolves symlinks and filesystem indirections for an existing path. */
export async function realPath(inputPath: string): Promise<string> {
  return nodeFs.realpath(inputPath)
}

/** realPathSync resolves symlinks and filesystem indirections for an existing path synchronously. */
export function realPathSync(inputPath: string): string {
  return nodeRealpathSync(inputPath)
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

/**
 * synchronizeDirectoryFiles makes the destination's files match the source without replacing
 * either directory tree. Some managed macOS hosts allow file writes and unlinks inside a checkout
 * but reject directory removal or rename; generated assets still need exact file membership there.
 * Empty destination directories may remain, but no stale file survives.
 */
export type SynchronizeDirectoryFilesOptions = {
  beforeClaimPublish?: (lockPath: string, ownerPath: string) => Promise<void>
  beforeCleanup?: () => Promise<void>
  /** beforeCommit is a test seam for mutations that race the final drift check. */
  beforeCommit?: () => Promise<void>
  beforeLockRelease?: () => Promise<void>
  beforeMkdir?: (path: string) => Promise<void>
  beforeMove?: (fromPath: string, toPath: string) => Promise<void>
  beforeRemove?: (path: string) => Promise<void>
  beforeStaleReclaim?: (lockPath: string) => Promise<void>
  /** boundaryPath is the trusted ancestor from which source and destination symlinks are rejected. */
  boundaryPath?: string
  inspectProcessIdentity?: (pid: number) => Promise<FileMutationProcessIdentity>
}

export async function synchronizeDirectoryFiles(
  fromPath: string,
  toPath: string,
  options: Partial<SynchronizeDirectoryFilesOptions> = {},
): Promise<void> {
  const boundaryPath = resolvePath(options.boundaryPath ?? commonPathAncestor(fromPath, toPath))
  await withFileMutationLock(
    toPath,
    boundaryPath,
    async () => {
      await synchronizeDirectoryFilesLocked(fromPath, toPath, boundaryPath, options)
    },
    {
      beforeClaimPublish: options.beforeClaimPublish,
      beforeRelease: options.beforeLockRelease,
      beforeStaleReclaim: options.beforeStaleReclaim,
      inspectProcessIdentity: options.inspectProcessIdentity,
    },
  )
}

async function synchronizeDirectoryFilesLocked(
  fromPath: string,
  toPath: string,
  boundaryPath: string,
  options: Partial<SynchronizeDirectoryFilesOptions>,
): Promise<void> {
  await assertTreeHasNoSymbolicLinks(boundaryPath, fromPath, 'source')
  await assertTreeHasNoSymbolicLinks(boundaryPath, toPath, 'destination')
  const sourceFiles = await walkedFiles(fromPath)
  const targetFiles = await isDirectory(toPath) ? await walkedFiles(toPath) : []
  const sourceByRelativePath = new Map(sourceFiles.map(path => [relativePath(fromPath, path), path]))
  const targetByRelativePath = new Map(targetFiles.map(path => [relativePath(toPath, path), path]))
  const backupRoot = await mkTmpDir('tao-directory-sync-backup-')
  const stagedFiles: Array<{ path: string; relative: string; targetPath: string }> = []
  const temporaryFiles: string[] = []
  const committedChanges: FileSynchronizationChange[] = []
  let commitStarted = false
  let primaryError: unknown
  try {
    for (const [relative, targetPath] of targetByRelativePath) {
      await copyFile(targetPath, resolvePath(relative, backupRoot))
    }
    const targetSnapshot = await mappedFilesIdentity(
      [...targetByRelativePath].map(([relative]) => [relative, resolvePath(relative, backupRoot)]),
    )
    for (const [index, [relative, sourcePath]] of [...sourceByRelativePath].entries()) {
      const targetPath = resolvePath(relative, toPath)
      const stagedPath = `${toPath}.${randomFileSuffix()}.${index}.tmp`
      await copyFile(sourcePath, stagedPath)
      stagedFiles.push({ path: stagedPath, relative, targetPath })
      temporaryFiles.push(stagedPath)
    }
    const sourceSnapshot = await mappedFilesIdentity(stagedFiles.map(staged => [staged.relative, staged.path]))
    await options.beforeCommit?.()

    // Recheck both trees immediately before the first worktree mutation. The content identities
    // make a concurrent non-cooperating writer fail closed instead of being overwritten or restored.
    await assertTreeHasNoSymbolicLinks(boundaryPath, fromPath, 'source')
    await assertTreeHasNoSymbolicLinks(boundaryPath, toPath, 'destination')
    if (await treeFilesIdentity(fromPath) !== sourceSnapshot) {
      throwUnexpected(`Source files changed while synchronizing ${fromPath}.`)
    }
    if (await treeFilesIdentity(toPath) !== targetSnapshot) {
      throwUnexpected(`Destination files changed while synchronizing ${toPath}.`)
    }

    commitStarted = true
    for (const staged of stagedFiles) {
      const change = await fileSynchronizationChange(staged.targetPath, targetByRelativePath, toPath, backupRoot)
      const expectedIdentity = await fileEntryIdentity(staged.path)
      try {
        await moveFileWithinBoundary(staged.path, staged.targetPath, boundaryPath, options)
      } catch (error) {
        if (await fileEntryIdentity(staged.targetPath) === expectedIdentity) {
          committedChanges.push({ ...change, expectedIdentity })
        }
        throw error
      }
      committedChanges.push({ ...change, expectedIdentity })
    }
    for (const [relative, targetPath] of targetByRelativePath) {
      if (!sourceByRelativePath.has(relative)) {
        const change = await fileSynchronizationChange(targetPath, targetByRelativePath, toPath, backupRoot)
        try {
          await removeFileWithinBoundary(targetPath, boundaryPath, options)
        } catch (error) {
          if (!await exists(targetPath)) {
            committedChanges.push({ ...change, expectedIdentity: 'missing' })
          }
          throw error
        }
        committedChanges.push({ ...change, expectedIdentity: 'missing' })
      }
    }
  } catch (error) {
    primaryError = error
    if (commitStarted) {
      const rollbackIssues = await rollbackDirectorySynchronization(
        committedChanges,
        temporaryFiles,
        toPath,
        boundaryPath,
        options,
      )
      if (rollbackIssues.length > 0) {
        primaryError = combinedFailure(error, 'rollbackIssues', rollbackIssues)
      }
    }
  }
  const cleanupIssues: unknown[] = []
  try {
    await options.beforeCleanup?.()
  } catch (error) {
    cleanupIssues.push(error)
  }
  for (const path of temporaryFiles) {
    try {
      await remove(path)
    } catch (error) {
      cleanupIssues.push(error)
    }
  }
  try {
    await remove(backupRoot)
  } catch (error) {
    cleanupIssues.push(error)
  }
  if (primaryError !== undefined) {
    if (cleanupIssues.length > 0) {
      throw combinedFailure(primaryError, 'stagingCleanupIssues', cleanupIssues.map(messageOf))
    }
    throw primaryError
  }
  if (cleanupIssues.length > 0) {
    throw combinedFailure(cleanupIssues[0], 'additionalCleanupIssues', cleanupIssues.slice(1).map(messageOf))
  }
}

type FileSynchronizationChange = {
  backupPath?: string
  expectedIdentity: string
  path: string
}

async function fileSynchronizationChange(
  path: string,
  targetByRelativePath: ReadonlyMap<string, string>,
  toPath: string,
  backupRoot: string,
): Promise<Omit<FileSynchronizationChange, 'expectedIdentity'>> {
  const relative = relativePath(toPath, path)
  return {
    ...(targetByRelativePath.has(relative) ? { backupPath: resolvePath(relative, backupRoot) } : {}),
    path,
  }
}

async function rollbackDirectorySynchronization(
  changes: readonly FileSynchronizationChange[],
  temporaryFiles: string[],
  toPath: string,
  boundaryPath: string,
  options: Partial<SynchronizeDirectoryFilesOptions>,
): Promise<unknown[]> {
  const issues: unknown[] = []
  for (const [index, change] of [...changes].reverse().entries()) {
    try {
      const currentIdentity = await fileEntryIdentity(change.path)
      if (currentIdentity !== change.expectedIdentity) {
        issues.push(
          `Rollback preserved a concurrent write at ${change.path}; expected ${change.expectedIdentity}, found ${currentIdentity}.`,
        )
        continue
      }
      if (change.backupPath === undefined) {
        if (currentIdentity !== 'missing') {
          await removeFileWithinBoundary(change.path, boundaryPath, options)
        }
        continue
      }
      const restorePath = `${toPath}.${randomFileSuffix()}.${index}.restore`
      temporaryFiles.push(restorePath)
      await copyFile(change.backupPath, restorePath)
      await moveFileWithinBoundary(restorePath, change.path, boundaryPath, options)
    } catch (error) {
      issues.push(error)
    }
  }
  return issues
}

async function fileEntryIdentity(path: string): Promise<string> {
  try {
    const stats = await nodeFs.lstat(path)
    if (stats.isSymbolicLink()) {
      return 'symbolic-link'
    }
    if (stats.isDirectory()) {
      return 'directory'
    }
    if (!stats.isFile()) {
      return 'unsupported'
    }
    return `file:${createHash('sha256').update(await readFile(path)).digest('hex')}`
  } catch (error) {
    if (fileErrorCode(error) === 'ENOENT') {
      return 'missing'
    }
    throw error
  }
}

function combinedFailure(primary: unknown, detailName: string, secondary: unknown): Error {
  return new UnexpectedBehaviorError(messageOf(primary), {
    cause: primary,
    details: { [detailName]: secondary },
  })
}

async function assertTreeHasNoSymbolicLinks(boundaryPath: string, root: string, role: string): Promise<void> {
  await assertNoSymbolicLinkComponents(boundaryPath, root, role)
  if (await isSymbolicLink(root)) {
    throwUnexpected(`Refusing to synchronize a symbolic-link ${role} root: ${root}`)
  }
  if (!await exists(root)) {
    return
  }
  for await (const path of walk(root, { includeDirectories: true, includeHidden: true })) {
    if (await isSymbolicLink(path)) {
      throwUnexpected(`Refusing to synchronize a ${role} symbolic link: ${path}`)
    }
  }
}

async function assertNoSymbolicLinkComponents(boundaryPath: string, path: string, role: string): Promise<void> {
  if (!pathIsWithin(path, boundaryPath)) {
    throwUnexpected(`Refusing to synchronize a ${role} path outside its trusted boundary: ${path}`)
  }
  let currentPath = boundaryPath
  if (await isSymbolicLink(currentPath)) {
    throwUnexpected(`Refusing to synchronize through a ${role} symbolic link: ${currentPath}`)
  }
  for (const component of relativePath(boundaryPath, path).split('/').filter(Boolean)) {
    currentPath = resolvePath(component, currentPath)
    if (await isSymbolicLink(currentPath)) {
      throwUnexpected(`Refusing to synchronize through a ${role} symbolic link: ${currentPath}`)
    }
  }
}

type FileMutationOperationHooks = Pick<
  SynchronizeDirectoryFilesOptions,
  'beforeMkdir' | 'beforeMove' | 'beforeRemove'
>

/** mkdirWithinBoundary creates directories only after hook-driven namespace changes are revalidated. */
export async function mkdirWithinBoundary(
  path: string,
  boundaryPath: string,
  hooks: Partial<FileMutationOperationHooks> = {},
): Promise<void> {
  await assertNoSymbolicLinkComponents(boundaryPath, path, 'directory creation')
  await hooks.beforeMkdir?.(path)
  await assertNoSymbolicLinkComponents(boundaryPath, path, 'directory creation')
  await mkdir(path)
  await assertNoSymbolicLinkComponents(boundaryPath, path, 'directory creation')
}

/** moveFileWithinBoundary performs one file rename without delegating mutation to an injectable hook. */
export async function moveFileWithinBoundary(
  fromPath: string,
  toPath: string,
  boundaryPath: string,
  hooks: Partial<FileMutationOperationHooks> = {},
): Promise<void> {
  await mkdirWithinBoundary(dirname(toPath), boundaryPath, hooks)
  const parentIdentity = await directoryEntryIdentity(dirname(toPath))
  await hooks.beforeMove?.(fromPath, toPath)
  await assertNoSymbolicLinkComponents(boundaryPath, fromPath, 'move source')
  await assertNoSymbolicLinkComponents(boundaryPath, toPath, 'move destination')
  if (await isSymbolicLink(fromPath) || await isSymbolicLink(toPath)) {
    throwUnexpected(`Refusing to move a symbolic link within ${boundaryPath}.`)
  }
  if (await directoryEntryIdentity(dirname(toPath)) !== parentIdentity) {
    throwUnexpected(`The destination namespace changed before moving ${toPath}.`)
  }
  await nodeFs.rename(fromPath, toPath)
  await assertNoSymbolicLinkComponents(boundaryPath, toPath, 'move destination')
}

/** removeFileWithinBoundary unlinks only a checked non-directory entry under the trusted boundary. */
export async function removeFileWithinBoundary(
  path: string,
  boundaryPath: string,
  hooks: Partial<FileMutationOperationHooks> = {},
): Promise<void> {
  const parentIdentity = await directoryEntryIdentity(dirname(path))
  await hooks.beforeRemove?.(path)
  await assertNoSymbolicLinkComponents(boundaryPath, path, 'file removal')
  if (await isSymbolicLink(path)) {
    throwUnexpected(`Refusing to remove a symbolic link within ${boundaryPath}.`)
  }
  if (await isDirectory(path)) {
    throwUnexpected(`Refusing to remove a directory through the file-only mutation path: ${path}`)
  }
  if (await directoryEntryIdentity(dirname(path)) !== parentIdentity) {
    throwUnexpected(`The destination namespace changed before removing ${path}.`)
  }
  await nodeFs.rm(path, { force: true })
}

async function directoryEntryIdentity(path: string): Promise<string> {
  const stats = await nodeFs.lstat(path)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throwUnexpected(`Expected a stable directory namespace at ${path}.`)
  }
  return `${stats.dev}:${stats.ino}`
}

function commonPathAncestor(leftPath: string, rightPath: string): string {
  const right = resolvePath(rightPath)
  let candidate = dirname(resolvePath(leftPath))
  while (!pathIsWithin(right, candidate)) {
    const parent = dirname(candidate)
    if (parent === candidate) {
      return candidate
    }
    candidate = parent
  }
  return candidate
}

async function treeFilesIdentity(root: string): Promise<string> {
  if (!await isDirectory(root)) {
    return hashFileIdentity([])
  }
  return mappedFilesIdentity((await walkedFiles(root)).map(path => [relativePath(root, path), path]))
}

async function mappedFilesIdentity(entries: readonly (readonly [string, string])[]): Promise<string> {
  const identities: string[] = []
  for (const [relative, path] of [...entries].sort(([left], [right]) => left.localeCompare(right))) {
    identities.push(`${relative}\n${createHash('sha256').update(await readFile(path)).digest('hex')}`)
  }
  return hashFileIdentity(identities)
}

function hashFileIdentity(identities: readonly string[]): string {
  return createHash('sha256').update(identities.join('\n')).digest('hex')
}

const FILE_MUTATION_LOCK_POLL_MS = 10
const FILE_MUTATION_LOCK_TIMEOUT_MS = 120_000
const FILE_MUTATION_RECLAIM_GRACE_MS = 2_000

export type FileMutationProcessIdentity = {
  evidence: 'alive' | 'gone' | 'unknown'
  startedAt?: string
}

export type FileMutationLockOptions = {
  beforeClaimPublish?: (lockPath: string, ownerPath: string) => Promise<void>
  beforeRelease?: () => Promise<void>
  beforeStaleReclaim?: (lockPath: string) => Promise<void>
  inspectProcessIdentity?: (pid: number) => Promise<FileMutationProcessIdentity>
}

type FileMutationLockOwner = { pid: number; processStartedAt?: string; token: string }
type FileMutationLockSnapshot = FileMutationLockOwner & { device: string; inode: string }

/** withFileMutationLock serializes file-only mutations by the canonical identity of their target. */
export async function withFileMutationLock<Value>(
  targetPath: string,
  boundaryPath: string,
  work: () => Promise<Value>,
  options: FileMutationLockOptions = {},
): Promise<Value> {
  const resolvedBoundary = resolvePath(boundaryPath)
  const resolvedTarget = resolvePath(targetPath)
  await assertNoSymbolicLinkComponents(resolvedBoundary, resolvedTarget, 'mutation target')
  const canonicalBoundary = await realPath(resolvedBoundary)
  const canonicalTarget = resolvePath(relativePath(resolvedBoundary, resolvedTarget), canonicalBoundary)
  const lockPath = `${canonicalTarget}.tao-file-mutation.lock`
  await mkdirWithinBoundary(dirname(lockPath), canonicalBoundary)
  return await withMutationLockFile(lockPath, work, options)
}

async function withMutationLockFile<Value>(
  lockPath: string,
  work: () => Promise<Value>,
  options: FileMutationLockOptions,
): Promise<Value> {
  const token = `${runtimeProcess.pid}-${randomUUID()}`
  const deadline = Date.now() + FILE_MUTATION_LOCK_TIMEOUT_MS
  const inspect = options.inspectProcessIdentity ?? inspectFileMutationProcessIdentity
  const ownIdentity = await inspect(runtimeProcess.pid)
  const owner: FileMutationLockOwner = {
    pid: runtimeProcess.pid,
    ...(ownIdentity.evidence === 'alive' && ownIdentity.startedAt !== undefined
      ? { processStartedAt: ownIdentity.startedAt }
      : {}),
    token,
  }
  let acquired: FileMutationLockSnapshot | undefined
  let claimCleanupError: unknown
  while (true) {
    try {
      claimCleanupError = await publishFileMutationClaim(lockPath, owner, options)
      acquired = await readFileMutationLockSnapshot(lockPath)
      if (acquired?.token !== token) {
        throwUnexpected(`The file mutation lock changed while ${lockPath} was being acquired.`)
      }
      break
    } catch (error) {
      if (fileErrorCode(error) !== 'EEXIST') {
        throw error
      }
      const existing = await readFileMutationLockSnapshot(lockPath)
      if (Date.now() >= deadline) {
        throwUnexpected(`Timed out waiting for the file mutation lock ${lockPath}.`)
      }
      if (existing === undefined) {
        await sleep(FILE_MUTATION_LOCK_POLL_MS)
        continue
      }
      if (await fileMutationLockOwnerIsLive(existing, inspect)) {
        await sleep(FILE_MUTATION_LOCK_POLL_MS)
        continue
      }
      await options.beforeStaleReclaim?.(lockPath)
      await reclaimFileMutationLock(lockPath, existing)
    }
  }
  let value: Value | undefined
  let primaryError: unknown
  try {
    value = await work()
  } catch (error) {
    primaryError = error
  }
  const releaseErrors: unknown[] = []
  try {
    await options.beforeRelease?.()
  } catch (error) {
    releaseErrors.push(error)
  }
  try {
    await releaseFileMutationLock(lockPath, acquired!)
  } catch (error) {
    releaseErrors.push(error)
  }
  if (primaryError !== undefined) {
    const cleanupErrors = [
      ...(claimCleanupError === undefined
        ? []
        : [{ phase: 'claim-owner cleanup', error: messageOf(claimCleanupError) }]),
      ...releaseErrors.map(error => ({ phase: 'lock release', error: messageOf(error) })),
    ]
    if (cleanupErrors.length > 0) {
      throwCombinedFailure(primaryError, 'cleanupErrors', cleanupErrors)
    }
    throw primaryError
  }
  if (releaseErrors.length > 0) {
    throwCombinedFailure(releaseErrors[0], 'additionalReleaseErrors', releaseErrors.slice(1).map(messageOf))
  }
  if (claimCleanupError !== undefined) {
    throw claimCleanupError
  }
  return value as Value
}

async function publishFileMutationClaim(
  lockPath: string,
  owner: FileMutationLockOwner,
  options: FileMutationLockOptions,
): Promise<unknown> {
  const ownerPath = `${lockPath}.owner-${owner.token}-${randomUUID()}`
  let primaryError: unknown
  try {
    const handle = await nodeFs.open(ownerPath, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(owner)}\n`)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await options.beforeClaimPublish?.(lockPath, ownerPath)
    await nodeFs.link(ownerPath, lockPath)
  } catch (error) {
    primaryError = error
  }
  let cleanupError: unknown
  try {
    await nodeFs.unlink(ownerPath)
  } catch (error) {
    if (fileErrorCode(error) !== 'ENOENT') {
      cleanupError = error
    }
  }
  if (primaryError !== undefined) {
    if (cleanupError !== undefined) {
      throwCombinedFailure(primaryError, 'claimOwnerCleanupError', cleanupError)
    }
    throw primaryError
  }
  // The claim itself is valid and complete. Return an owner-link cleanup failure so the caller can
  // release the lock first and then surface it without stranding a live claim.
  return cleanupError
}

async function readFileMutationLockSnapshot(path: string): Promise<FileMutationLockSnapshot | undefined> {
  let handle: FileHandle | undefined
  try {
    handle = await nodeFs.open(path, 'r')
    const stats = await handle.stat()
    const value: unknown = JSON.parse(await handle.readFile('utf8'))
    if (
      typeof value === 'object'
      && value !== null
      && 'pid' in value
      && Number.isInteger(value.pid)
      && (value.pid as number) > 0
      && (!('processStartedAt' in value) || typeof value.processStartedAt === 'string')
      && 'token' in value
      && typeof value.token === 'string'
    ) {
      return {
        device: String(stats.dev),
        inode: String(stats.ino),
        pid: value.pid as number,
        ...('processStartedAt' in value ? { processStartedAt: value.processStartedAt as string } : {}),
        token: value.token,
      }
    }
  } catch {
    return undefined
  } finally {
    await handle?.close().catch(() => {})
  }
  return undefined
}

async function fileMutationLockOwnerIsLive(
  owner: FileMutationLockOwner,
  inspect: (pid: number) => Promise<FileMutationProcessIdentity>,
): Promise<boolean> {
  const identity = await inspect(owner.pid)
  if (identity.evidence === 'gone') {
    return false
  }
  return !(
    identity.evidence === 'alive'
    && owner.processStartedAt !== undefined
    && identity.startedAt !== undefined
    && owner.processStartedAt !== identity.startedAt
  )
}

async function inspectFileMutationProcessIdentity(pid: number): Promise<FileMutationProcessIdentity> {
  try {
    // `lstart` follows locale and time zone; pin both so every process compares the same spelling.
    const result = spawnSync('ps', {
      args: ['-o', 'lstart=', '-p', String(pid)],
      env: { ...runtimeProcess.env, LC_ALL: 'C', TZ: 'UTC' },
    })
    const startedAt = result.stdout.toString().trim()
    if (result.error === undefined && result.status === 0 && startedAt.length > 0) {
      return { evidence: 'alive', startedAt }
    }
  } catch {
    // An unreadable process table is uncertainty, never permission to steal another process's lock.
  }
  return processIsAlive(pid) ? { evidence: 'unknown' } : { evidence: 'gone' }
}

async function reclaimFileMutationLock(lockPath: string, observed: FileMutationLockSnapshot): Promise<void> {
  const claimPath = `${lockPath}.reclaim`
  let claimed: FileMutationLockSnapshot | undefined
  try {
    // A hard link atomically claims this exact inode. Competing reclaimers cannot claim a fresh
    // replacement under the same pathname, and cleanup never unlinks the live lock pathname.
    await nodeFs.link(lockPath, claimPath)
    claimed = await readFileMutationLockSnapshot(claimPath)
  } catch (error) {
    if (fileErrorCode(error) !== 'EEXIST' && fileErrorCode(error) !== 'ENOENT') {
      throw error
    }
    const age = await reclaimLinkAgeMs(claimPath)
    if (age >= FILE_MUTATION_RECLAIM_GRACE_MS) {
      const claim = await readFileMutationLockSnapshot(claimPath)
      const current = await readFileMutationLockSnapshot(lockPath)
      if (claim !== undefined && current !== undefined && sameLockIdentity(claim, current)) {
        // An abandoned reclaim link names the same stale inode. Removing only that auxiliary link
        // cannot touch a fresh lock claim; the next loop can claim it again.
        await nodeFs.unlink(claimPath)
      }
    }
    await sleep(FILE_MUTATION_LOCK_POLL_MS)
    return
  }

  let primaryError: unknown
  try {
    const claim = await readFileMutationLockSnapshot(claimPath)
    const current = await readFileMutationLockSnapshot(lockPath)
    const ownsObservedLock = !(
      claim === undefined
      || current === undefined
      || !sameLockIdentity(claim, observed)
      || !sameLockIdentity(current, observed)
    )
    if (ownsObservedLock) {
      const tombstone = `${lockPath}.stale-${observed.token}-${randomUUID()}`
      await nodeFs.rename(lockPath, tombstone)
      const moved = await readFileMutationLockSnapshot(tombstone)
      if (moved === undefined || !sameLockIdentity(moved, observed)) {
        await restoreDisplacedFileMutationClaim(tombstone, lockPath)
        throwUnexpected(`The file mutation lock changed while ${lockPath} was being reclaimed.`)
      }
      await nodeFs.unlink(tombstone)
    }
  } catch (error) {
    primaryError = error
  }
  let cleanupError: unknown
  try {
    const claim = await readFileMutationLockSnapshot(claimPath)
    if (claim !== undefined && claimed !== undefined && sameLockIdentity(claim, claimed)) {
      await nodeFs.unlink(claimPath)
    }
  } catch (error) {
    cleanupError = error
  }
  if (primaryError !== undefined) {
    if (cleanupError !== undefined) {
      throwCombinedFailure(primaryError, 'reclaimLinkCleanupError', cleanupError)
    }
    throw primaryError
  }
  if (cleanupError !== undefined) {
    throw cleanupError
  }
}

async function releaseFileMutationLock(lockPath: string, acquired: FileMutationLockSnapshot): Promise<void> {
  const current = await readFileMutationLockSnapshot(lockPath)
  if (current === undefined || !sameLockIdentity(current, acquired)) {
    throwUnexpected(`The file mutation lock changed before ${lockPath} could be released.`)
  }
  const tombstone = `${lockPath}.release-${acquired.token}-${randomUUID()}`
  await nodeFs.rename(lockPath, tombstone)
  const moved = await readFileMutationLockSnapshot(tombstone)
  if (moved === undefined || !sameLockIdentity(moved, acquired)) {
    await restoreDisplacedFileMutationClaim(tombstone, lockPath)
    throwUnexpected(`The file mutation lock changed while ${lockPath} was being released.`)
  }
  await nodeFs.unlink(tombstone)
}

async function restoreDisplacedFileMutationClaim(fromPath: string, lockPath: string): Promise<void> {
  try {
    await nodeFs.link(fromPath, lockPath)
    await nodeFs.unlink(fromPath)
  } catch (error) {
    if (fileErrorCode(error) !== 'EEXIST') {
      throw error
    }
  }
}

function sameLockIdentity(left: FileMutationLockSnapshot, right: FileMutationLockSnapshot): boolean {
  return left.device === right.device && left.inode === right.inode && left.token === right.token
}

/**
 * reclaimLinkAgeMs dates a reclaim hard link by its inode change time. The link shares the stale
 * lock's inode, so its modification time is the old lock's age; creating the link updates ctime, so a
 * reclaimer that has just claimed the lock is not mistaken for an abandoned one.
 */
async function reclaimLinkAgeMs(path: string): Promise<number> {
  try {
    return Math.max(0, Date.now() - (await nodeFs.stat(path)).ctimeMs)
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function fileErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }
  if ('code' in error && (error as { code?: unknown }).code !== undefined) {
    return String((error as { code?: unknown }).code)
  }
  return 'cause' in error ? fileErrorCode((error as { cause?: unknown }).cause) : undefined
}

function throwCombinedFailure(primary: unknown, detailName: string, secondary: unknown): never {
  throwUnexpected(messageOf(primary), {
    cause: primary,
    details: { [detailName]: secondary instanceof Error ? secondary.message : secondary },
  })
}

function randomFileSuffix(): string {
  return randomUUID()
}

async function walkedFiles(root: string): Promise<string[]> {
  const files: string[] = []
  for await (const path of walk(root, { includeHidden: true })) {
    files.push(path)
  }
  return files.sort()
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
