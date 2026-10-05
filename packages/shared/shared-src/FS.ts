import {
  closeSync as nodeCloseSync,
  type Dirent,
  existsSync as nodeExistsSync,
  fsyncSync as nodeFsyncSync,
  lstatSync as nodeLstatSync,
  mkdirSync as nodeMkdirSync,
  openSync as nodeOpenSync,
  readdirSync as nodeReaddirSync,
  readFileSync as nodeReadFileSync,
  realpathSync as nodeRealpathSync,
  renameSync as nodeRenameSync,
  rmSync as nodeRmSync,
  writeFileSync as nodeWriteFileSync,
} from 'node:fs'
import * as nodeFs from 'node:fs/promises'
import * as nodeOs from 'node:os'
import * as nodePath from 'node:path'
import { fileURLToPath as nodeFileURLToPath, pathToFileURL } from 'node:url'
import { messageOf, throwUnexpected, UnexpectedBehaviorError } from './core/Errors'
import * as Json from './core/Json'
import { sleep } from './core/Time'
import { processIsAlive, randomUUID, runtimeProcess, sha256Hex, spawnSync } from './Platform'

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

/** fileUrlToPath converts an import-resolved local module URL to a filesystem path. */
export function fileUrlToPath(url: string): string {
  return nodeFileURLToPath(url)
}

/** fileUrl converts a filesystem path into an escaped file URL for local module imports. */
export function fileUrl(inputPath: string): string {
  return pathToFileURL(inputPath).href
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
/** isAbsolute reports whether a path is already grounded at the host filesystem root. */
export const isAbsolute = (inputPath: string) => nodePath.isAbsolute(normalizePathPart(inputPath))
/** relativePath returns the slash-separated path from `fromPath` to `toPath`. */
export const relativePath = (fromPath: string, toPath: string) => slashPath(nodePath.relative(fromPath, toPath))
/** matchesGlob matches a path using the host's standard glob syntax, including brace alternatives. */
export const matchesGlob = (inputPath: string, pattern: string) =>
  nodePath.matchesGlob(normalizePathPart(inputPath), normalizePathPart(pattern))
/** pathIsWithin returns whether `path` is `directoryPath` or a path inside it. */
export function pathIsWithin(path: string, directoryPath: string): boolean {
  const relative = relativePath(directoryPath, path)
  return relative === '' || (!nodePath.isAbsolute(relative) && !relative.startsWith('../') && relative !== '..')
}
/**
 * displayPath returns a readable spelling of a path: relative to the current working directory,
 * or absolute with the home directory written as `~`. A path outside the cwd never renders as a
 * run of `../` segments, which can obscure the location a diagnostic names.
 */
export function displayPath(inputPath: string): string {
  return displayPathFrom(resolvePath(inputPath), resolvePath('.'), homeDir())
}

/** displayPathFrom renders an absolute path against explicit cwd and home locations. */
export function displayPathFrom(absolutePath: string, cwd: string, home: string): string {
  const relative = relativePath(cwd, absolutePath)
  if (relative === '') {
    return '.'
  }
  return pathIsWithin(absolutePath, cwd) ? relative : homeShortenedPath(absolutePath, home)
}

/** homeShortenedPath writes an absolute path under the home directory as `~/…`. */
function homeShortenedPath(absolutePath: string, home: string): string {
  const fromHome = relativePath(home, absolutePath)
  if (fromHome === '') {
    return '~'
  }
  return pathIsWithin(absolutePath, home) ? `~/${fromHome}` : slashPath(absolutePath)
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

/** removeSync is for process-exit cleanup, when there is no event loop to await. */
export function removeSync(path: string): void {
  nodeRmSync(path, { force: true, recursive: true })
}

/** catching runs `check`, returning `fallback` instead of throwing when it fails. */
async function catching<Value>(check: () => Promise<Value>, fallback: Value): Promise<Value> {
  try {
    return await check()
  } catch {
    return fallback
  }
}

/** exists checks whether a path can be accessed. */
export async function exists(inputPath: string): Promise<boolean> {
  return catching(async () => {
    await nodeFs.access(inputPath)
    return true
  }, false)
}

/** existsSync checks whether a path exists without leaving sync-only callers to import node:fs. */
export function existsSync(inputPath: string): boolean {
  return nodeExistsSync(inputPath)
}

/** isFile checks whether a path exists and is a file. */
export async function isFile(inputPath: string): Promise<boolean> {
  return catching(async () => (await nodeFs.stat(inputPath)).isFile(), false)
}

/** isDirectory checks whether a path exists and is a directory. */
export async function isDirectory(inputPath: string): Promise<boolean> {
  return catching(async () => (await nodeFs.stat(inputPath)).isDirectory(), false)
}

/** isSymbolicLink reports on the path entry itself rather than following its target. */
export async function isSymbolicLink(inputPath: string): Promise<boolean> {
  return catching(async () => (await nodeFs.lstat(inputPath)).isSymbolicLink(), false)
}

/** entryMetadata describes one directory entry without following a symlink or mounted path. */
export async function entryMetadata(inputPath: string): Promise<{
  device: number
  gid: number
  kind: 'directory' | 'file' | 'other' | 'symlink'
  linkTarget?: string
  mode: number
  modifiedMs: number
  size: number
  uid: number
}> {
  const stats = await nodeFs.lstat(inputPath)
  const kind = stats.isDirectory()
    ? 'directory'
    : stats.isFile()
    ? 'file'
    : stats.isSymbolicLink()
    ? 'symlink'
    : 'other'
  return {
    device: stats.dev,
    gid: stats.gid,
    kind,
    ...(kind === 'symlink' ? { linkTarget: await nodeFs.readlink(inputPath) } : {}),
    mode: stats.mode,
    modifiedMs: stats.mtimeMs,
    size: stats.size,
    uid: stats.uid,
  }
}

/** entryMetadataSync inspects a synchronous ownership record without following symlinks. */
export function entryMetadataSync(inputPath: string): {
  device: number
  inode: number
  kind: 'directory' | 'file' | 'other' | 'symlink'
  mode: number
  modifiedMs: number
  size: number
  uid: number
} {
  const stats = nodeLstatSync(inputPath)
  return {
    device: stats.dev,
    inode: stats.ino,
    kind: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : stats.isSymbolicLink() ? 'symlink' : 'other',
    mode: stats.mode,
    modifiedMs: stats.mtimeMs,
    size: stats.size,
    uid: stats.uid,
  }
}

/** ensureDirSync creates parents for synchronous resource registration. */
export function ensureDirSync(inputPath: string, options: { mode?: number } = {}): void {
  nodeMkdirSync(inputPath, { recursive: true, mode: options.mode })
}

/** writeTextSync flushes a resource record before the caller publishes its child process. */
export function writeTextSync(
  inputPath: string,
  content: string,
  options: WriteOptions & { exclusive?: boolean } = {},
): void {
  const descriptor = nodeOpenSync(inputPath, options.exclusive ? 'wx' : 'w', options.mode)
  try {
    nodeWriteFileSync(descriptor, content, { encoding: 'utf8' })
    nodeFsyncSync(descriptor)
  } finally {
    nodeCloseSync(descriptor)
  }
}

/** renameSync publishes a completely written resource record in its existing directory. */
export function renameSync(fromPath: string, toPath: string): void {
  nodeRenameSync(fromPath, toPath)
}

/** realPath resolves symlinks and filesystem indirections for an existing path. */
export async function realPath(inputPath: string): Promise<string> {
  return nodeFs.realpath(inputPath)
}

/** realPathSync resolves symlinks and filesystem indirections for an existing path synchronously. */
export function realPathSync(inputPath: string): string {
  return nodeRealpathSync(inputPath)
}

/**
 * resolvePackageDirectory finds the real directory of the package a bare import of `packageName`
 * reaches from `fromDirectory`, walking up `node_modules` directories the way Node does and through
 * a workspace symlink; undefined when it is not installed. It reads the directories rather than
 * resolving `<name>/package.json`, which a package's `exports` map is free to hide.
 */
export async function resolvePackageDirectory(packageName: string, fromDirectory: string): Promise<string | undefined> {
  let directory = resolvePath(fromDirectory)
  for (;;) {
    const candidate = nodePath.join(directory, 'node_modules', packageName)
    if (await isFile(nodePath.join(candidate, 'package.json'))) {
      return await realPath(candidate)
    }
    const parent = nodePath.dirname(directory)
    if (parent === directory) {
      return undefined
    }
    directory = parent
  }
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

/** Read at most maxBytes from the start of a UTF-8 file, without loading the rest. */
export async function readTextPrefix(inputPath: string, maxBytes: number): Promise<string> {
  const handle = await nodeFs.open(inputPath, 'r')
  try {
    const bytes = Buffer.alloc(maxBytes)
    const { bytesRead } = await handle.read(bytes, 0, maxBytes, 0)
    return bytes.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

/** Read at most maxBytes from the end of a UTF-8 file, without loading the rest. The first line may be partial. */
export async function readTextSuffix(inputPath: string, maxBytes: number): Promise<string> {
  const handle = await nodeFs.open(inputPath, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, maxBytes)
    const bytes = Buffer.alloc(length)
    const { bytesRead } = await handle.read(bytes, 0, length, size - length)
    return bytes.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

/** readTextSync reads UTF-8 text for synchronous compiler and validator passes. */
export function readTextSync(inputPath: string): string {
  return nodeReadFileSync(inputPath, 'utf8')
}

/** readFile reads a file as bytes. */
export async function readFile(inputPath: string): Promise<Uint8Array> {
  return nodeFs.readFile(inputPath)
}

/** setModifiedTimeMs sets a path's last modified timestamp, leaving its access time alone. */
export async function setModifiedTimeMs(inputPath: string, modifiedMs: number): Promise<void> {
  const stats = await nodeFs.stat(inputPath)
  await nodeFs.utimes(inputPath, stats.atime, new Date(modifiedMs))
}

/** modifiedTimeMs reads the last modified timestamp for a path. */
export async function modifiedTimeMs(inputPath: string): Promise<number> {
  return (await nodeFs.stat(inputPath)).mtimeMs
}

/** byteSize reads how many bytes of content a file holds. */
export async function byteSize(inputPath: string): Promise<number> {
  return (await nodeFs.stat(inputPath)).size
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

/** writeExclusiveFile creates a new file without creating parents or replacing an existing entry. */
export async function writeExclusiveFile(
  inputPath: string,
  content: string | Uint8Array,
  options: WriteOptions = {},
): Promise<void> {
  await nodeFs.writeFile(inputPath, content, { flag: 'wx', mode: options.mode })
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

/** Remove a directory only while it is empty; retain a concurrently added entry. */
export async function removeEmptyDirectory(inputPath: string): Promise<void> {
  try {
    await nodeFs.rmdir(inputPath)
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(fileErrorCode(error) ?? '')) {
      throw error
    }
  }
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
type SynchronizeDirectoryFilesOptions = {
  beforeClaimPublish?: (lockPath: string, ownerPath: string) => Promise<void>
  beforeCleanup?: () => Promise<void>
  /** beforeCommit is a test seam for mutations that race the final drift check. */
  beforeCommit?: () => Promise<void>
  beforeLockRelease?: () => Promise<void>
  beforeMkdir?: (path: string) => Promise<void>
  beforeMove?: (fromPath: string, toPath: string) => Promise<void>
  beforeRemove?: (path: string) => Promise<void>
  beforeStaleReclaim?: (lockPath: string) => Promise<void>
  /** boundaryPath is the trusted ancestor for a single synchronization's source and destination. */
  boundaryPath?: string
  inspectProcessIdentity?: (pid: number) => Promise<FileMutationProcessIdentity>
  /** validateDestination runs under the destination lock before staging and again before publication. */
  validateDestination?: () => Promise<void>
}

type DirectoryFileSynchronization = {
  fromPath: string
  toPath: string
}

export type SynchronizeDirectoryFileSetsOptions = Omit<SynchronizeDirectoryFilesOptions, 'boundaryPath'> & {
  /** boundaryPath is the trusted ancestor for every persistent destination and the shared lock. */
  boundaryPath?: string
  /** lockPath is the target whose mutation lock serializes the complete multi-root publication. */
  lockPath?: string
  /** sourceBoundaryPath is the trusted ancestor for staged sources outside boundaryPath. */
  sourceBoundaryPath?: string
}

export async function synchronizeDirectoryFiles(
  fromPath: string,
  toPath: string,
  options: Partial<SynchronizeDirectoryFilesOptions> = {},
): Promise<void> {
  const boundaryPath = resolvePath(options.boundaryPath ?? commonPathAncestor(fromPath, toPath))
  await synchronizeDirectoryFileSets([{ fromPath, toPath }], {
    ...options,
    boundaryPath,
    sourceBoundaryPath: boundaryPath,
  })
}

/** synchronizeDirectoryFileSets publishes disjoint directory roots in one rollback-safe transaction. */
export async function synchronizeDirectoryFileSets(
  fileSets: readonly DirectoryFileSynchronization[],
  options: Partial<SynchronizeDirectoryFileSetsOptions> = {},
): Promise<void> {
  if (fileSets.length === 0) {
    throwUnexpected('At least one directory file set is required for synchronization.')
  }
  const resolvedFileSets = fileSets.map(fileSet => ({
    fromPath: resolvePath(fileSet.fromPath),
    toPath: resolvePath(fileSet.toPath),
  }))
  assertDisjointSynchronizationTargets(resolvedFileSets)
  const boundaryPath = resolvePath(
    options.boundaryPath ?? commonPathAncestorOf(resolvedFileSets.map(fileSet => fileSet.toPath)),
  )
  const sourceBoundaryPath = resolvePath(
    options.sourceBoundaryPath ?? commonPathAncestorOf(resolvedFileSets.map(fileSet => fileSet.fromPath)),
  )
  const lockPath = resolvePath(options.lockPath ?? resolvedFileSets[0]!.toPath)
  await withFileMutationLock(
    lockPath,
    boundaryPath,
    async () => {
      await synchronizeDirectoryFileSetsLocked(
        resolvedFileSets,
        sourceBoundaryPath,
        boundaryPath,
        options,
      )
    },
    {
      beforeClaimPublish: options.beforeClaimPublish,
      beforeRelease: options.beforeLockRelease,
      beforeStaleReclaim: options.beforeStaleReclaim,
      inspectProcessIdentity: options.inspectProcessIdentity,
    },
  )
}

function assertDisjointSynchronizationTargets(fileSets: readonly DirectoryFileSynchronization[]): void {
  for (const [index, fileSet] of fileSets.entries()) {
    for (const other of fileSets.slice(index + 1)) {
      if (pathIsWithin(fileSet.toPath, other.toPath) || pathIsWithin(other.toPath, fileSet.toPath)) {
        throwUnexpected(`Directory synchronization targets overlap: ${fileSet.toPath} and ${other.toPath}.`)
      }
    }
  }
}

type SynchronizedFile = {
  fileSetIndex: number
  label: string
  path: string
  relative: string
  root: string
}

async function synchronizeDirectoryFileSetsLocked(
  fileSets: readonly DirectoryFileSynchronization[],
  sourceBoundaryPath: string,
  boundaryPath: string,
  options: Partial<SynchronizeDirectoryFileSetsOptions>,
): Promise<void> {
  await options.validateDestination?.()
  for (const fileSet of fileSets) {
    await assertTreeHasNoSymbolicLinks(sourceBoundaryPath, fileSet.fromPath, 'source')
    await assertTreeHasNoSymbolicLinks(boundaryPath, fileSet.toPath, 'destination')
    await removeOrphanedSynchronizationFiles(fileSet.toPath, boundaryPath, options)
  }
  const sourceFiles = await synchronizedFiles(fileSets, 'fromPath')
  const targetFiles = await synchronizedFiles(fileSets, 'toPath')
  const sourceByLabel = new Map(sourceFiles.map(file => [file.label, file]))
  const backupRoot = await mkTmpDir('tao-directory-sync-backup-')
  const backupByTargetPath = new Map<string, string>()
  const stagedFiles: Array<{
    label: string
    path: string
    publish: boolean
    targetPath: string
    targetRoot: string
  }> = []
  const temporaryFiles: string[] = []
  const committedChanges: FileSynchronizationChange[] = []
  let commitStarted = false
  let primaryError: unknown
  try {
    for (const target of targetFiles) {
      const backupPath = resolvePath(target.label, backupRoot)
      await copyFile(target.path, backupPath)
      backupByTargetPath.set(target.path, backupPath)
    }
    const targetSnapshot = await filesIdentity(
      targetFiles.map(target => [target.label, backupByTargetPath.get(target.path)!]),
    )
    for (const [index, source] of sourceFiles.entries()) {
      const fileSet = fileSets[source.fileSetIndex]!
      const targetPath = resolvePath(source.relative, fileSet.toPath)
      const stagedPath = `${fileSet.toPath}.${randomFileSuffix()}.${index}.tmp`
      await copyFile(source.path, stagedPath)
      const backupPath = backupByTargetPath.get(targetPath)
      const publish = backupPath === undefined
        || await fileEntryIdentity(stagedPath) !== await fileEntryIdentity(backupPath)
      stagedFiles.push({ label: source.label, path: stagedPath, publish, targetPath, targetRoot: fileSet.toPath })
      temporaryFiles.push(stagedPath)
    }
    const sourceSnapshot = await filesIdentity(stagedFiles.map(staged => [staged.label, staged.path]))
    await options.beforeCommit?.()
    await options.validateDestination?.()

    // Recheck both trees immediately before the first worktree mutation. The content identities
    // make a concurrent non-cooperating writer fail closed instead of being overwritten or restored.
    for (const fileSet of fileSets) {
      await assertTreeHasNoSymbolicLinks(sourceBoundaryPath, fileSet.fromPath, 'source')
      await assertTreeHasNoSymbolicLinks(boundaryPath, fileSet.toPath, 'destination')
    }
    if (await synchronizedFilesIdentity(fileSets, 'fromPath') !== sourceSnapshot) {
      throwUnexpected('Source files changed while synchronizing directory file sets.')
    }
    if (await synchronizedFilesIdentity(fileSets, 'toPath') !== targetSnapshot) {
      throwUnexpected('Destination files changed while synchronizing directory file sets.')
    }

    commitStarted = true
    for (const staged of stagedFiles) {
      if (!staged.publish) {
        continue
      }
      const change = fileSynchronizationChange(staged.targetPath, staged.targetRoot, backupByTargetPath)
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
    for (const target of targetFiles) {
      if (!sourceByLabel.has(target.label)) {
        const change = fileSynchronizationChange(target.path, target.root, backupByTargetPath)
        try {
          await removeFileWithinBoundary(target.path, boundaryPath, options)
        } catch (error) {
          if (!await exists(target.path)) {
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
        boundaryPath,
        options,
      )
      if (rollbackIssues.length > 0) {
        primaryError = combinedFailure(error, 'rollbackIssues', rollbackIssues)
      }
    }
  }
  const cleanupIssues: unknown[] = []
  await collectingFailures(cleanupIssues, async () => {
    await options.beforeCleanup?.()
  })
  for (const path of temporaryFiles) {
    await collectingFailures(cleanupIssues, () => remove(path))
  }
  await collectingFailures(cleanupIssues, () => remove(backupRoot))
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

async function synchronizedFiles(
  fileSets: readonly DirectoryFileSynchronization[],
  side: 'fromPath' | 'toPath',
): Promise<SynchronizedFile[]> {
  const files: SynchronizedFile[] = []
  for (const [index, fileSet] of fileSets.entries()) {
    const root = fileSet[side]
    if (!await isDirectory(root)) {
      continue
    }
    for (const path of await walkedFiles(root)) {
      if (isFileMutationAuxiliaryPath(path)) {
        continue
      }
      const relative = relativePath(root, path)
      files.push({ fileSetIndex: index, label: `${index}/${relative}`, path, relative, root })
    }
  }
  return files
}

async function synchronizedFilesIdentity(
  fileSets: readonly DirectoryFileSynchronization[],
  side: 'fromPath' | 'toPath',
): Promise<string> {
  return filesIdentity((await synchronizedFiles(fileSets, side)).map(file => [file.label, file.path]))
}

type FileSynchronizationChange = {
  backupPath?: string
  expectedIdentity: string
  path: string
  targetRoot: string
}

function fileSynchronizationChange(
  path: string,
  targetRoot: string,
  backupByTargetPath: ReadonlyMap<string, string>,
): Omit<FileSynchronizationChange, 'expectedIdentity'> {
  const backupPath = backupByTargetPath.get(path)
  return {
    ...(backupPath === undefined ? {} : { backupPath }),
    path,
    targetRoot,
  }
}

async function rollbackDirectorySynchronization(
  changes: readonly FileSynchronizationChange[],
  temporaryFiles: string[],
  boundaryPath: string,
  options: Partial<SynchronizeDirectoryFileSetsOptions>,
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
      const restorePath = `${change.targetRoot}.${randomFileSuffix()}.${index}.restore`
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
    return `file:${sha256Hex(await readFile(path))}`
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

/** collectingFailures runs `action`, pushing a thrown error onto `issues` instead of propagating it. */
async function collectingFailures(issues: unknown[], action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    issues.push(error)
  }
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

function commonPathAncestorOf(paths: readonly string[]): string {
  let ancestor = dirname(resolvePath(paths[0]!))
  for (const path of paths.slice(1)) {
    const resolved = resolvePath(path)
    while (!pathIsWithin(resolved, ancestor)) {
      const parent = dirname(ancestor)
      if (parent === ancestor) {
        return ancestor
      }
      ancestor = parent
    }
  }
  return ancestor
}

/** Mutation ownership and synchronization sidecars are coordination state, never source inputs. */
export function isFileMutationAuxiliaryPath(path: string): boolean {
  const name = basename(path)
  return /\.tao-file-mutation\.lock(?:$|\.reclaim$|\.(?:owner|stale|release)-[^/]+$)/u.test(name)
    || /\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.\d+\.(?:tmp|restore)$/u.test(name)
}

/**
 * filesIdentity is the content identity of a labelled set of files: the label a caller gives each
 * file, paired with the hash of its bytes, in label order. Callers that discover files in an
 * unstable order therefore still agree, and a file that moves between two labels changes it.
 */
export async function filesIdentity(entries: readonly (readonly [string, string])[]): Promise<string> {
  const identities: string[] = []
  for (const [relative, path] of [...entries].sort(([left], [right]) => left.localeCompare(right))) {
    identities.push(`${relative}\n${sha256Hex(await readFile(path))}`)
  }
  return contentIdentity(identities)
}

/** contentIdentity is the content identity of ordered parts; order is part of what it identifies. */
export function contentIdentity(identities: readonly string[]): string {
  return sha256Hex(identities.join('\n'))
}

const FILE_MUTATION_LOCK_POLL_MS = 50
// Large publications can queue behind a live mutation on a busy host. Keep a bounded wait
// with margin for publication; owner identity and stale reclamation remain mandatory.
const FILE_MUTATION_LOCK_TIMEOUT_MS = 300_000
const FILE_MUTATION_RECLAIM_GRACE_MS = 2_000

type FileMutationProcessIdentity = {
  evidence: 'alive' | 'gone' | 'unknown'
  startedAt?: string
}

type FileMutationLockOptions = {
  /** Keep lock, owner, and reclaim files in this directory instead of beside the target. */
  lockDirectory?: string
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
  const lockPath = options.lockDirectory === undefined
    ? `${canonicalTarget}.tao-file-mutation.lock`
    : resolvePath(`${sha256Hex(canonicalTarget)}.tao-file-mutation.lock`, options.lockDirectory)
  await assertNoSymbolicLinkComponents(canonicalBoundary, lockPath, 'mutation lock')
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
    let existing = await readFileMutationLockSnapshot(lockPath)
    // A known claim needs an ownership check, not another fsynced claim file. The atomic
    // hard-link publication still arbitrates acquisition if the lock changes after this read.
    if (existing === undefined) {
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
        existing = await readFileMutationLockSnapshot(lockPath)
      }
    }
    if (Date.now() >= deadline) {
      throwUnexpected(`Timed out waiting for the file mutation lock ${lockPath}.`)
    }
    if (existing === undefined || await fileMutationLockOwnerIsLive(existing, inspect)) {
      await sleep(FILE_MUTATION_LOCK_POLL_MS)
      continue
    }
    await options.beforeStaleReclaim?.(lockPath)
    await reclaimFileMutationLock(lockPath, existing)
  }
  let value: Value | undefined
  let primaryError: unknown
  try {
    value = await work()
  } catch (error) {
    primaryError = error
  }
  const releaseErrors: unknown[] = []
  await collectingFailures(releaseErrors, async () => {
    await options.beforeRelease?.()
  })
  await collectingFailures(releaseErrors, () => releaseFileMutationLock(lockPath, acquired!))
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
  throwIfPrimaryFailed(primaryError, cleanupError, 'claimOwnerCleanupError')
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
      Json.isRecord(value)
      && Number.isInteger(value['pid'])
      && (value['pid'] as number) > 0
      && (value['processStartedAt'] === undefined || typeof value['processStartedAt'] === 'string')
      && typeof value['token'] === 'string'
    ) {
      return {
        device: String(stats.dev),
        inode: String(stats.ino),
        pid: value['pid'] as number,
        ...(typeof value['processStartedAt'] === 'string' ? { processStartedAt: value['processStartedAt'] } : {}),
        token: value['token'],
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
      await nodeFs.unlink(await renameLockToTombstone(lockPath, observed, 'stale', 'reclaimed'))
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
  throwIfPrimaryFailed(primaryError, cleanupError, 'reclaimLinkCleanupError')
  if (cleanupError !== undefined) {
    throw cleanupError
  }
}

async function releaseFileMutationLock(lockPath: string, acquired: FileMutationLockSnapshot): Promise<void> {
  const current = await readFileMutationLockSnapshot(lockPath)
  if (current === undefined || !sameLockIdentity(current, acquired)) {
    throwUnexpected(`The file mutation lock changed before ${lockPath} could be released.`)
  }
  await nodeFs.unlink(await renameLockToTombstone(lockPath, acquired, 'release', 'released'))
}

/**
 * renameLockToTombstone claims a lock file for disposal by renaming it to a private path, verifying
 * the rename kept its identity, and returns the tombstone for the caller to remove.
 */
async function renameLockToTombstone(
  lockPath: string,
  expected: FileMutationLockSnapshot,
  tombstonePrefix: string,
  verb: string,
): Promise<string> {
  const tombstone = `${lockPath}.${tombstonePrefix}-${expected.token}-${randomUUID()}`
  await nodeFs.rename(lockPath, tombstone)
  const moved = await readFileMutationLockSnapshot(tombstone)
  if (moved === undefined || !sameLockIdentity(moved, expected)) {
    await restoreDisplacedFileMutationClaim(tombstone, lockPath)
    throwUnexpected(`The file mutation lock changed while ${lockPath} was being ${verb}.`)
  }
  return tombstone
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
  return catching(async () => Math.max(0, Date.now() - (await nodeFs.stat(path)).ctimeMs), Number.POSITIVE_INFINITY)
}

function fileErrorCode(error: unknown): string | undefined {
  if (!Json.isRecord(error)) {
    return undefined
  }
  return error['code'] !== undefined ? String(error['code']) : fileErrorCode(error['cause'])
}

function throwCombinedFailure(primary: unknown, detailName: string, secondary: unknown): never {
  throw combinedFailure(primary, detailName, secondary instanceof Error ? secondary.message : secondary)
}

/** throwIfPrimaryFailed rethrows a primary failure, folding in a cleanup failure alongside it. */
function throwIfPrimaryFailed(primaryError: unknown, cleanupError: unknown, detailName: string): void {
  if (primaryError !== undefined) {
    if (cleanupError !== undefined) {
      throwCombinedFailure(primaryError, detailName, cleanupError)
    }
    throw primaryError
  }
}

function randomFileSuffix(): string {
  return randomUUID()
}

/**
 * A synchronization stages and rolls back through files named for the destination and sitting
 * beside it, not inside it, so neither the walk of the destination nor its content identity can
 * see them. A process killed mid-synchronization therefore leaves them in the destination's parent
 * directory for good, where whatever reads that directory next picks them up — the packaged
 * IDE-extension VSIX shipped them, because its file list names the parent directory as a whole.
 *
 * Sweeping them here is safe precisely because the caller holds the destination's mutation lock:
 * no other synchronization into this destination can be staging, so every match is dead.
 */
async function removeOrphanedSynchronizationFiles(
  toPath: string,
  boundaryPath: string,
  options: Partial<SynchronizeDirectoryFilesOptions>,
): Promise<void> {
  const parentPath = dirname(toPath)
  if (!await isDirectory(parentPath)) {
    return
  }
  const orphanPattern = new RegExp(
    `^${escapeRegularExpression(basename(toPath))}\\.[0-9a-f-]{36}\\.\\d+\\.(tmp|restore)$`,
  )
  for (const entry of await listDir(parentPath)) {
    if (!orphanPattern.test(entry)) {
      continue
    }
    const orphanPath = resolvePath(entry, parentPath)
    if (await isDirectory(orphanPath) || await isSymbolicLink(orphanPath)) {
      continue
    }
    await removeFileWithinBoundary(orphanPath, boundaryPath, options)
  }
}

/** escapeRegularExpression quotes a literal for use inside a pattern. */
function escapeRegularExpression(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
 * replaceSymlink points a symlink at `targetPath`, replacing whatever the link path held, without
 * ever leaving the link path empty.
 *
 * Unlinking and recreating would be simpler and is wrong: between the two calls the link does not
 * exist, so a concurrent reader resolves nothing, and two writers racing make the loser's create
 * fail outright. Creating the new link under a unique name in the same directory and renaming it
 * over the old one is atomic — a reader sees the old target or the new one, never neither. Removing
 * a symlink never follows it, so an existing link is replaced rather than its target deleted.
 */
export async function replaceSymlink(targetPath: string, linkPath: string): Promise<void> {
  const stagedPath = `${linkPath}.${randomUUID()}.tmp`
  try {
    await symlink(targetPath, stagedPath)
    await move(stagedPath, linkPath)
  } catch (error) {
    await remove(stagedPath).catch(() => {})
    throw error
  }
}

/** listDir lists direct child names for a directory, sorted for platform-independent order. */
export async function listDir(inputPath: string): Promise<string[]> {
  return (await nodeFs.readdir(inputPath)).sort()
}

/** listDirSync lists direct child names for synchronous host inspection. */
export function listDirSync(inputPath: string): string[] {
  return nodeReaddirSync(inputPath).sort()
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
  return catching(async () => (await nodeFs.stat(entryPath)).isDirectory(), false)
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
