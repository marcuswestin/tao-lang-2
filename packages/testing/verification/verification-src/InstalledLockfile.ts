import { FS, Text } from '@shared'

type LockedPackages = Record<string, readonly unknown[]>

/**
 * Bun records a nested resolution as a path through the package graph. Its installed tree puts
 * that child beneath the resolved parent's .bun directory. Compare the actual package version,
 * not just the presence of the link: a successful frozen install can leave an older link behind.
 */
export async function installedLockfileError(repositoryRoot: string): Promise<string | undefined> {
  const lockPath = FS.resolvePath('bun.lock', repositoryRoot)
  if (!await FS.isFile(lockPath)) {
    return undefined // RepositoryDoctor owns the missing-lockfile diagnosis.
  }
  const lock = JSON.parse(Text.stripJsonc(await FS.readText(lockPath))) as { packages?: LockedPackages }
  if (lock.packages === undefined) {
    return 'bun.lock has no package resolutions'
  }
  const store = FS.resolvePath('node_modules/.bun', repositoryRoot)
  if (!await FS.isDirectory(store)) {
    return 'node_modules/.bun is missing'
  }
  const installedDirectories = await FS.listDir(store)
  const lockedKeys = new Set(Object.keys(lock.packages))

  for (const key of lockedKeys) {
    const parentKey = parentResolutionKey(key, lockedKeys)
    if (parentKey === undefined) {
      continue
    }
    const parent = resolution(lock.packages[parentKey])
    const child = resolution(lock.packages[key])
    if (parent === undefined || child === undefined) {
      continue // Workspace links and non-registry resolutions have no .bun package directory.
    }
    const parentPrefix = `${parent.name.replaceAll('/', '+')}@${parent.version}`
    const childName = key.slice(parentKey.length + 1)
    for (const directory of installedDirectories) {
      if (directory !== parentPrefix && !directory.startsWith(`${parentPrefix}+`)) {
        continue
      }
      const installedPackage = FS.resolvePath(`${directory}/node_modules/${childName}`, store)
      const installedManifest = FS.resolvePath('package.json', installedPackage)
      if (!await FS.isFile(installedManifest)) {
        // Bun omits optional children on unsupported platforms. Only inspect links it installed.
        if (await FS.isSymbolicLink(installedPackage) || await FS.isDirectory(installedPackage)) {
          return `${key}: bun.lock expects ${child.name}@${child.version}, but the installed link has no package.json`
        }
        continue
      }
      const installed = await FS.readJson<{ name?: string; version?: string }>(installedManifest)
      if (installed.name !== child.name || installed.version !== child.version) {
        return `${key}: bun.lock expects ${child.name}@${child.version}, installed ${installed.name ?? '?'}@${
          installed.version ?? '?'
        }`
      }
    }
  }
  return undefined
}

function parentResolutionKey(key: string, lockedKeys: ReadonlySet<string>): string | undefined {
  let slash = key.lastIndexOf('/')
  while (slash > 0) {
    const candidate = key.slice(0, slash)
    if (lockedKeys.has(candidate)) {
      return candidate
    }
    slash = key.lastIndexOf('/', slash - 1)
  }
  return undefined
}

function resolution(entry: readonly unknown[] | undefined): { name: string; version: string } | undefined {
  const value = entry?.[0]
  if (typeof value !== 'string' || value.includes('@workspace')) {
    return undefined
  }
  const separator = value.lastIndexOf('@')
  if (separator < 1 || !/^\d+\.\d+\.\d+/u.test(value.slice(separator + 1))) {
    return undefined
  }
  return { name: value.slice(0, separator), version: value.slice(separator + 1) }
}
