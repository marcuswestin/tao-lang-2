import { nodeFs, nodeOs, nodePath, nodeUrl } from './Runtime'

export type WalkOptions = {
  includeDirectories?: boolean
  includeHidden?: boolean
  extensions?: readonly string[]
}

export const resolvePath = (...paths: string[]) => nodePath.resolve(...paths)
export const joinPath = (...paths: string[]) => nodePath.join(...paths)
export const dirname = (path: string) => nodePath.dirname(path)
export const basename = (path: string, suffix?: string) => nodePath.basename(path, suffix)
export const extname = (path: string) => nodePath.extname(path)
export const normalizePath = (path: string) => nodePath.normalize(path)
export const pathToFileURL = (path: string) => nodeUrl.pathToFileURL(path)
export const tmpdir = () => nodeOs.tmpdir()

export async function mkTmpDir(prefix: string): Promise<string> {
  return nodeFs.mkdtemp(prefix)
}

export async function exists(path: string): Promise<boolean> {
  try {
    await nodeFs.access(path)
    return true
  } catch {
    return false
  }
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await nodeFs.stat(path)).isFile()
  } catch {
    return false
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await nodeFs.stat(path)).isDirectory()
  } catch {
    return false
  }
}

export async function readText(path: string): Promise<string> {
  return nodeFs.readFile(path, 'utf8')
}

export async function readJson<T = unknown>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T
}

export async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path))
  await nodeFs.writeFile(path, content, 'utf8')
}

export async function writeJson(path: string, content: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(content, null, 2)}\n`)
}

export async function mkdir(path: string): Promise<void> {
  await nodeFs.mkdir(path, { recursive: true })
}

export async function remove(path: string): Promise<void> {
  await nodeFs.rm(path, { force: true, recursive: true })
}

export async function copyFile(fromPath: string, toPath: string): Promise<void> {
  await mkdir(dirname(toPath))
  await nodeFs.copyFile(fromPath, toPath)
}

export async function copyDirectory(fromPath: string, toPath: string): Promise<void> {
  await mkdir(dirname(toPath))
  await nodeFs.cp(fromPath, toPath, { recursive: true })
}

export async function move(fromPath: string, toPath: string): Promise<void> {
  await mkdir(dirname(toPath))
  await nodeFs.rename(fromPath, toPath)
}

export async function listDir(path: string): Promise<string[]> {
  return nodeFs.readdir(path)
}

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
