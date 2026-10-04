import type { DependencyEnvironment } from '@compiler'
import { BridgeMetadata } from '@compiler/bridge-metadata'
import { type Diagnostic, FS, Json, Platform, ProjectLocal, Text } from '@shared'
import { managedDependencyModulesRoot } from './ProjectHostModules'

const ProjectManagedDependencyValidationMessages = {
  missing: (alias: string, projectRoot: string, scope: 'project' | 'private' = 'private') =>
    `Declared TypeScript dependency '${alias}' for ${projectRoot} is not installed in its ${scope} environment.`,
  wrongPackage: (alias: string, actual: string, expected: string, projectRoot: string) =>
    `Installed TypeScript dependency '${alias}' for ${projectRoot} is ${actual}, but ${expected} was declared.`,
  wrongVersion: (alias: string, version: string, range: string, projectRoot: string) =>
    `Installed TypeScript dependency '${alias}' has version ${version}, but ${projectRoot} requires ${range}.`,
  wrongLockPackage: (alias: string, actual: string, expected: string) =>
    `Installed TypeScript dependency '${alias}' is pinned as ${actual}, but ${expected} was declared.`,
  wrongLockRange: (alias: string, actual: string, expected: string) =>
    `Installed TypeScript dependency '${alias}' is pinned for ${actual}, but ${expected} was declared.`,
  wrongPinnedVersion: (alias: string, actual: string, expected: string) =>
    `Installed TypeScript dependency '${alias}' has version ${actual}, but the Tao lock pins ${expected}.`,
  invalidLock: (path: string) => `Tao project lock at ${path} is not valid JSONC.`,
  missingSnapshotLink: (alias: string, projectRoot: string) =>
    `Declared TypeScript dependency '${alias}' for ${projectRoot} is not linked beside its dependency snapshots.`,
  wrongSnapshotLink: (alias: string, projectRoot: string) =>
    `TypeScript dependency '${alias}' beside ${projectRoot}'s snapshots points to a different install.`,
} as const

/** Diagnostics a `tao install` of the requesting project would clear carry this code. */
export const DEPENDENCY_NOT_INSTALLED = 'dependency-not-installed'

/** The remedy every not-installed diagnostic ends with, naming the project to install. */
export function installRemedy(requesterRoot: string): string {
  const path = FS.displayPath(requesterRoot)
  // Quoted when needed so the command pastes as is; project folders often contain spaces.
  const argument = /^[\w./~@+-]+$/u.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`
  return `Run \`tao install ${argument}\` to install the project's dependencies.`
}

/**
 * uninstalledLockedDependencies lists the npm aliases the project's lock pins whose installed
 * package is missing or at another version. It reads only the lock and installed manifests, so a
 * command can ask before compiling; aliases a source declares but no lock pins yet are left to the
 * compile diagnostics.
 */
export async function uninstalledLockedDependencies(projectRoot: string): Promise<string[]> {
  const lockPath = ProjectLocal.storeResolve('lock.jsonc', projectRoot)
  if (!await FS.isFile(lockPath)) {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Text.stripJsonc(await FS.readText(lockPath)))
  } catch {
    return []
  }
  const installs = Json.isRecord(parsed) ? parsed['installs'] : undefined
  const environments = Json.isRecord(installs) ? installs['environments'] : undefined
  if (!Json.isRecord(environments)) {
    return []
  }
  const root = FS.resolvePath(projectRoot)
  const missing: string[] = []
  for (const environment of Object.values(environments)) {
    if (!Json.isRecord(environment) || !Json.isRecord(environment['npm'])) {
      continue
    }
    const origin = FS.resolvePath(
      typeof environment['projectRoot'] === 'string' ? environment['projectRoot'] : '.',
      root,
    )
    const modulesRoot = origin === root
      ? FS.resolvePath('node_modules', root)
      : managedDependencyModulesRoot(root, BridgeMetadata.dependencyNamespace(origin))
    for (const [alias, pin] of Object.entries(environment['npm'])) {
      if (!Json.isRecord(pin) || typeof pin['version'] !== 'string') {
        continue
      }
      const manifest = FS.resolvePath(`${alias}/package.json`, modulesRoot)
      if (
        !await FS.isFile(manifest) || (await FS.readJson<{ version?: string }>(manifest)).version !== pin['version']
      ) {
        missing.push(alias)
      }
    }
  }
  return missing.toSorted()
}

/** Verify private aliases without falling back to requester or host node_modules. */
export async function validateManagedDependencyEnvironments(
  requesterRoot: string,
  environments: readonly DependencyEnvironment[],
  options: { moduleLinkRoot?: string; checkSnapshotLinks?: boolean } = {},
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  const moduleLinkRoot = options.moduleLinkRoot ?? requesterRoot
  const lockPath = ProjectLocal.storeResolve('lock.jsonc', requesterRoot)
  const lock = await readInstallPins(lockPath, requesterRoot)
  diagnostics.push(...lock.diagnostics)
  for (const environment of environments) {
    const requesterOwned = FS.resolvePath(environment.projectRoot) === FS.resolvePath(requesterRoot)
    const modulesRoot = requesterOwned
      ? FS.resolvePath('node_modules', moduleLinkRoot)
      : managedDependencyModulesRoot(moduleLinkRoot, environment.namespace)
    const snapshotModulesRoot = FS.resolvePath(
      `.tao-ts/.dependencies/${environment.namespace}/node_modules`,
      requesterRoot,
    )
    const checkSnapshotLink = !requesterOwned && options.checkSnapshotLinks !== false
    const snapshotLinkMatches = checkSnapshotLink && await FS.isDirectory(modulesRoot)
      && await FS.isSymbolicLink(snapshotModulesRoot)
      && await FS.isDirectory(snapshotModulesRoot)
      && await FS.realPath(snapshotModulesRoot) === await FS.realPath(modulesRoot)
    for (const requirement of environment.npm) {
      const pin = (lock.byNamespace.get(environment.namespace)
        ?? lock.byProjectRoot.get(FS.resolvePath(environment.projectRoot))
        ?? undefined)?.get(requirement.alias)
      if (pin !== undefined && pin.name !== requirement.packageName) {
        diagnostics.push(error(
          lockPath,
          ProjectManagedDependencyValidationMessages.wrongLockPackage(
            requirement.alias,
            pin.name,
            requirement.packageName,
          ),
        ))
      }
      if (pin !== undefined && pin.requested !== requirement.versionRange) {
        diagnostics.push(error(
          lockPath,
          ProjectManagedDependencyValidationMessages.wrongLockRange(
            requirement.alias,
            pin.requested,
            requirement.versionRange,
          ),
        ))
      }
      const managedPackage = FS.resolvePath(requirement.alias, modulesRoot)
      const manifestPath = FS.resolvePath('package.json', managedPackage)
      if (!await FS.isFile(manifestPath)) {
        diagnostics.push(notInstalled(
          manifestPath,
          ProjectManagedDependencyValidationMessages.missing(
            requirement.alias,
            environment.projectRoot,
            requesterOwned ? 'project' : 'private',
          ),
          requesterRoot,
        ))
        continue
      }
      const manifest = await FS.readJson<{ name?: string; version?: string }>(manifestPath)
      if (manifest.name !== requirement.packageName) {
        diagnostics.push(error(
          manifestPath,
          ProjectManagedDependencyValidationMessages.wrongPackage(
            requirement.alias,
            manifest.name ?? '(missing)',
            requirement.packageName,
            environment.projectRoot,
          ),
        ))
      }
      if (manifest.version === undefined || !Platform.semverSatisfies(manifest.version, requirement.versionRange)) {
        diagnostics.push(notInstalled(
          manifestPath,
          ProjectManagedDependencyValidationMessages.wrongVersion(
            requirement.alias,
            manifest.version ?? '(missing)',
            requirement.versionRange,
            environment.projectRoot,
          ),
          requesterRoot,
        ))
      }
      if (pin !== undefined && manifest.version !== pin.version) {
        diagnostics.push(notInstalled(
          manifestPath,
          ProjectManagedDependencyValidationMessages.wrongPinnedVersion(
            requirement.alias,
            manifest.version ?? '(missing)',
            pin.version,
          ),
          requesterRoot,
        ))
      }
      if (!checkSnapshotLink) {
        continue
      }
      if (!await FS.isSymbolicLink(snapshotModulesRoot)) {
        diagnostics.push(error(
          snapshotModulesRoot,
          ProjectManagedDependencyValidationMessages.missingSnapshotLink(
            requirement.alias,
            environment.projectRoot,
          ),
        ))
      } else if (!snapshotLinkMatches) {
        diagnostics.push(error(
          snapshotModulesRoot,
          ProjectManagedDependencyValidationMessages.wrongSnapshotLink(
            requirement.alias,
            environment.projectRoot,
          ),
        ))
      }
    }
  }
  return diagnostics
}

type InstallPin = { name: string; requested: string; version: string }

async function readInstallPins(path: string, requesterRoot: string): Promise<{
  byNamespace: Map<string, Map<string, InstallPin>>
  byProjectRoot: Map<string, Map<string, InstallPin> | null>
  diagnostics: Diagnostic[]
}> {
  const byNamespace = new Map<string, Map<string, InstallPin>>()
  const byProjectRoot = new Map<string, Map<string, InstallPin> | null>()
  if (!await FS.isFile(path)) {
    return { byNamespace, byProjectRoot, diagnostics: [] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Text.stripJsonc(await FS.readText(path)))
  } catch {
    return {
      byNamespace,
      byProjectRoot,
      diagnostics: [error(path, ProjectManagedDependencyValidationMessages.invalidLock(path))],
    }
  }
  if (!Json.isRecord(parsed) || !Json.isRecord(parsed['installs'])) {
    return { byNamespace, byProjectRoot, diagnostics: [] }
  }
  const environments = parsed['installs']['environments']
  if (!Json.isRecord(environments)) {
    return { byNamespace, byProjectRoot, diagnostics: [] }
  }
  for (const [namespace, environment] of Object.entries(environments)) {
    if (!Json.isRecord(environment) || !Json.isRecord(environment['npm'])) {
      continue
    }
    const npm = new Map<string, InstallPin>()
    for (const [alias, value] of Object.entries(environment['npm'])) {
      if (
        Json.isRecord(value) && typeof value['name'] === 'string'
        && typeof value['requested'] === 'string' && typeof value['version'] === 'string'
      ) {
        npm.set(alias, { name: value['name'], requested: value['requested'], version: value['version'] })
      }
    }
    byNamespace.set(namespace, npm)
    if (typeof environment['projectRoot'] === 'string') {
      const root = FS.resolvePath(environment['projectRoot'], requesterRoot)
      byProjectRoot.set(root, byProjectRoot.has(root) ? null : npm)
    }
  }
  return { byNamespace, byProjectRoot, diagnostics: [] }
}

function notInstalled(filePath: string, message: string, requesterRoot: string): Diagnostic {
  return { ...error(filePath, `${message} ${installRemedy(requesterRoot)}`), code: DEPENDENCY_NOT_INSTALLED }
}

function error(filePath: string, message: string): Diagnostic {
  return { filePath, message, severity: 'error', source: 'compiler' }
}
