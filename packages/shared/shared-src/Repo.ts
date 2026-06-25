import * as CLI from './CLI'
import * as FS from './FS'
import { runtimeProcess } from './Platform'

const rootByCwd = new Map<string, string>()

/** FilesUnderOptions configures repo-aware file discovery. */
export type FilesUnderOptions = {
  excludeDirectoryNames?: readonly string[]
  extensions?: readonly string[]
}

/** DirectoriesUnderOptions configures repo-aware directory discovery. */
export type DirectoriesUnderOptions = {
  namePrefix?: string
}

/** getRoot returns the root directory of the current Git worktree. */
export function getRoot(cwd = runtimeProcess.cwd()): string {
  const resolvedCwd = FS.resolvePath(cwd)
  const cached = rootByCwd.get(resolvedCwd)
  if (cached !== undefined) {
    return cached
  }

  const markerRoot = findGitMarkerRoot(resolvedCwd)
  if (markerRoot !== undefined) {
    rootByCwd.set(resolvedCwd, markerRoot)
    return markerRoot
  }

  const result = CLI.mustRunSync('git', {
    args: ['rev-parse', '--show-toplevel'],
    cwd: resolvedCwd,
  })

  const root = result.stdout.trim()
  if (root.length === 0) {
    throw new Error(`Git worktree root not found for ${cwd}`)
  }
  rootByCwd.set(resolvedCwd, root)
  return root
}

/** resolvePath resolves a slash-separated path from the Git worktree root for `cwd`. */
export function resolvePath(inputPath = '.', cwd?: string): string {
  return FS.resolvePath(inputPath, getRoot(cwd))
}

/** filesUnder returns files under a path using Git ignore rules when the path is in a Git worktree. */
export async function filesUnder(inputPath: string, options: FilesUnderOptions = {}): Promise<string[]> {
  const root = FS.resolvePath(inputPath)
  if (await FS.isFile(root)) {
    return fileUnder(root, options)
  }
  if (!await FS.isDirectory(root)) {
    return []
  }

  const gitSearchRoot = await realPathOrInput(root)
  const gitRoot = tryGetRoot(gitSearchRoot)
  if (gitRoot !== undefined) {
    return gitFilesUnder(gitRoot, gitSearchRoot, options)
      .map(path => restoreInputPath(path, gitSearchRoot, root))
  }
  return await filesystemFilesUnder(root, options)
}

/** directoriesUnder returns directories under a path by deriving them from discovered files. */
export async function directoriesUnder(inputPath: string, options: DirectoriesUnderOptions = {}): Promise<string[]> {
  const root = FS.resolvePath(inputPath)
  if (!await FS.isDirectory(root)) {
    return []
  }

  const directories = new Set<string>()
  for (const filePath of await filesUnder(root)) {
    let directoryPath = FS.dirname(filePath)
    while (pathIsWithinOrEqual(directoryPath, root) && directoryPath !== root) {
      if (directoryMatches(FS.relativePath(root, directoryPath), directoryPath, options)) {
        directories.add(directoryPath)
      }
      directoryPath = FS.dirname(directoryPath)
    }
  }
  return [...directories].sort()
}

function fileUnder(path: string, options: FilesUnderOptions): string[] {
  if (options.extensions !== undefined && !options.extensions.includes(FS.extname(path))) {
    return []
  }
  return [path]
}

function gitFilesUnder(gitRoot: string, root: string, options: FilesUnderOptions): string[] {
  const relativeRoot = FS.relativePath(gitRoot, root)
  const pathspecs = pathspecsUnder(relativeRoot, filePathspecs(options))
  return gitListFiles(gitRoot, pathspecs)
    .filter(path => pathIsWithinOrEqual(path, root))
    .filter(path => fileMatchesOptions(path, FS.relativePath(root, path), options))
}

function gitListFiles(gitRoot: string, pathspecs: readonly string[]): string[] {
  const result = CLI.mustRunSync('git', {
    args: [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      ...pathspecs.map(pathspec => `:(glob)${pathspec}`),
    ],
    cwd: gitRoot,
  })
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map(path => FS.resolvePath(path, gitRoot))
    .sort()
}

async function filesystemFilesUnder(root: string, options: FilesUnderOptions): Promise<string[]> {
  const files: string[] = []
  for await (
    const filePath of FS.walk(root, {
      excludeDirectory: name => shouldExcludeFilesystemDirectory(name, options),
      extensions: options.extensions,
    })
  ) {
    const relativeFilePath = FS.relativePath(root, filePath)
    if (fileMatchesOptions(filePath, relativeFilePath, options)) {
      files.push(filePath)
    }
  }
  return files.sort()
}

function fileMatchesOptions(path: string, relativePath: string, options: FilesUnderOptions): boolean {
  if (pathIncludesHiddenSegment(relativePath)) {
    return false
  }
  if (pathIncludesExcludedDirectory(relativePath, options.excludeDirectoryNames)) {
    return false
  }
  if (options.extensions !== undefined && !options.extensions.includes(FS.extname(path))) {
    return false
  }
  return true
}

function directoryMatches(relativePath: string, path: string, options: DirectoriesUnderOptions): boolean {
  if (pathIncludesHiddenSegment(relativePath)) {
    return false
  }
  return options.namePrefix === undefined || FS.basename(path).startsWith(options.namePrefix)
}

function filePathspecs(options: FilesUnderOptions): string[] {
  if (options.extensions === undefined || options.extensions.length === 0) {
    return ['*', '**/*']
  }
  return options.extensions.flatMap(extension => [`*${extension}`, `**/*${extension}`])
}

function pathspecsUnder(relativeRoot: string, pathspecs: readonly string[]): string[] {
  return relativeRoot === '' ? [...pathspecs] : pathspecs.map(pathspec => `${relativeRoot}/${pathspec}`)
}

function pathIncludesHiddenSegment(path: string): boolean {
  return path.split('/').some(segment => segment.startsWith('.'))
}

function pathIncludesExcludedDirectory(path: string, excludeDirectoryNames: readonly string[] | undefined): boolean {
  if (excludeDirectoryNames === undefined) {
    return false
  }
  return path.split('/').slice(0, -1)
    .some(segment => excludeDirectoryNames.some(excludedName => excludedName.toLowerCase() === segment.toLowerCase()))
}

function pathIsWithinOrEqual(path: string, root: string): boolean {
  const relative = FS.relativePath(root, path)
  return relative === '' || (!relative.startsWith('..') && relative !== '..')
}

function restoreInputPath(path: string, realRoot: string, inputRoot: string): string {
  if (path === realRoot) {
    return inputRoot
  }
  if (!path.startsWith(`${realRoot}/`)) {
    return path
  }
  return FS.resolvePath(path.slice(realRoot.length + 1), inputRoot)
}

function tryGetRoot(cwd: string): string | undefined {
  try {
    return getRoot(cwd)
  } catch {
    return undefined
  }
}

function findGitMarkerRoot(cwd: string): string | undefined {
  let current = FS.resolvePath(cwd)
  while (true) {
    if (FS.existsSync(FS.resolvePath('.git', current))) {
      return current
    }
    const parent = FS.dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}

async function realPathOrInput(path: string): Promise<string> {
  try {
    return await FS.realPath(path)
  } catch {
    return path
  }
}

function shouldExcludeFilesystemDirectory(name: string, options: FilesUnderOptions): boolean {
  return options.excludeDirectoryNames?.some(excludedName => excludedName.toLowerCase() === name.toLowerCase()) ?? false
}
