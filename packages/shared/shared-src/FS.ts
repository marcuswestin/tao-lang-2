import { nodeFs, nodeOs, nodePath } from './Platform'

/** WalkOptions declares filters for recursive file walking. */
export type WalkOptions = {
  includeDirectories?: boolean
  includeHidden?: boolean
  extensions?: readonly string[]
}

/** resolvePath resolves path segments into an absolute path. */
export const resolvePath = (...paths: string[]) => nodePath.resolve(...paths)
/** joinPath joins path segments with the host path separator. */
export const joinPath = (...paths: string[]) => nodePath.join(...paths)
/** dirname returns the parent directory for a path. */
export const dirname = (path: string) => nodePath.dirname(path)
/** basename returns the final path segment. */
export const basename = (path: string, suffix?: string) => nodePath.basename(path, suffix)
/** extname returns the extension for a path. */
export const extname = (path: string) => nodePath.extname(path)
/** tmpdir returns the host temporary directory. */
export const tmpdir = () => nodeOs.tmpdir()

/** mkTmpDir creates a unique temporary directory with the given prefix. */
export async function mkTmpDir(prefix: string): Promise<string> {
  return nodeFs.mkdtemp(prefix)
}

/** exists checks whether a path can be accessed. */
export async function exists(path: string): Promise<boolean> {
  try {
    await nodeFs.access(path)
    return true
  } catch {
    return false
  }
}

/** isFile checks whether a path exists and is a file. */
export async function isFile(path: string): Promise<boolean> {
  try {
    return (await nodeFs.stat(path)).isFile()
  } catch {
    return false
  }
}

/** isDirectory checks whether a path exists and is a directory. */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await nodeFs.stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** readText reads a UTF-8 file. */
export async function readText(path: string): Promise<string> {
  return nodeFs.readFile(path, 'utf8')
}

/** modifiedTimeMs reads the last modified timestamp for a path. */
export async function modifiedTimeMs(path: string): Promise<number> {
  return (await nodeFs.stat(path)).mtimeMs
}

/** readJson reads and parses a JSON file. */
export async function readJson<T = unknown>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T
}

/** writeText writes a UTF-8 file, creating parent directories. */
export async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path))
  await nodeFs.writeFile(path, content, 'utf8')
}

/** writeJson writes formatted JSON, creating parent directories. */
export async function writeJson(path: string, content: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(content, null, 2)}\n`)
}

/** mkdir creates a directory and any missing parents. */
export async function mkdir(path: string): Promise<void> {
  await nodeFs.mkdir(path, { recursive: true })
}

/** remove deletes a path recursively if it exists. */
export async function remove(path: string): Promise<void> {
  await nodeFs.rm(path, { force: true, recursive: true })
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

/** listDir lists direct child names for a directory. */
export async function listDir(path: string): Promise<string[]> {
  return nodeFs.readdir(path)
}

/** walk yields files under a path according to the provided filters. */
export async function* walk(path: string, options: WalkOptions = {}): AsyncGenerator<string> {
  const absolutePath = resolvePath(path)
  const stats = await nodeFs.stat(absolutePath)

  if (stats.isDirectory()) {
    yield* walkDirectory(absolutePath, options)
    return
  }

  if (shouldYield(absolutePath, false, options)) {
    yield absolutePath
  }
}

async function* walkDirectory(path: string, options: WalkOptions): AsyncGenerator<string> {
  for (const entry of await nodeFs.readdir(path, { withFileTypes: true })) {
    const entryPath = joinPath(path, entry.name)
    const isDirectoryEntry = entry.isDirectory()

    if (shouldYield(entryPath, isDirectoryEntry, options)) {
      yield entryPath
    }
    if (isDirectoryEntry && shouldWalkDirectory(entry.name, options)) {
      yield* walkDirectory(entryPath, options)
    }
  }
}

function shouldWalkDirectory(name: string, options: WalkOptions): boolean {
  return options.includeHidden === true || !name.startsWith('.')
}

function shouldYield(path: string, isDirectoryPath: boolean, options: WalkOptions): boolean {
  const name = basename(path)

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
