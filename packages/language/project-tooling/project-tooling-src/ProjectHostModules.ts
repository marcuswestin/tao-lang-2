import { FS, HCI, Platform, ProjectLocal, TaoResources } from '@shared'
import * as ts from 'typescript'
import type { ProjectToolingOptions } from './ProjectTooling'

type HostObservation = {
  value: string | boolean | readonly string[] | undefined
  read: () => HostObservation['value']
}

/** Owned by the retained watch, never by standalone config generation or an installation. */
export class ProjectHostModuleSession {
  private last?: { key: string; paths: Record<string, string[]>; observations: ReadonlyMap<string, HostObservation> }

  clear(): void {
    this.last = undefined
  }

  reuse(key: string): Record<string, string[]> | undefined {
    const last = this.last
    if (last === undefined || last.key !== key) {
      return undefined
    }
    try {
      for (const observation of last.observations.values()) {
        if (!sameObservation(observation.value, observation.read())) {
          this.clear()
          return undefined
        }
      }
      return clonePaths(last.paths)
    } catch {
      // Guard failure cannot establish freshness. The cold resolver owns errors.
      this.clear()
      return undefined
    }
  }

  remember(key: string, paths: Record<string, string[]>, observations: ReadonlyMap<string, HostObservation>): void {
    this.last = { key, paths: clonePaths(paths), observations }
  }
}

function clonePaths(paths: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(paths).map(([name, targets]) => [name, [...targets]]))
}

function sameObservation(a: HostObservation['value'], b: HostObservation['value']): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, index) => value === b[index])
  }
  return a === b
}

/** Installed roots are lookup inputs, never a request to install or link packages. */
function resolveHostModuleRoots(options: ProjectToolingOptions): string[] {
  const installed = TaoResources.resolve(`../${TaoResources.HOST_DEPENDENCIES_DIRECTORY}/node_modules`)
  const checkoutRoot = FS.resolvePath('../../../..', import.meta.dir)
  return [
    ...new Set(
      [
        ...(options.hostModulesRoot === undefined ? [] : [options.hostModulesRoot]),
        ...(options.hostModuleRoots ?? []),
        ...(installed === undefined
          ? [
            FS.resolvePath('node_modules', checkoutRoot),
            FS.resolvePath('packages/apps/expo-host/node_modules', checkoutRoot),
            FS.resolvePath('packages/apps/runtime/node_modules', checkoutRoot),
          ]
          : [installed]),
      ].map(root => FS.resolvePath(root)).filter(root => FS.existsSync(root)),
    ),
  ]
}

export function resolveRuntimeRoot(projectRoot: string, options: ProjectToolingOptions): string {
  if (options.runtimeRoot !== undefined) {
    return FS.resolvePath(options.runtimeRoot)
  }
  const projectRuntime = FS.resolvePath('node_modules/@tao/runtime', projectRoot)
  if (FS.existsSync(projectRuntime)) {
    return projectRuntime
  }
  return TaoResources.resolve(TaoResources.RUNTIME_DIRECTORY)
    ?? FS.resolvePath('../../../../packages/apps/runtime', import.meta.dir)
}

/** The requester-owned install root for one physical dependency project. */
export function managedDependencyModulesRoot(requesterRoot: string, namespace: string): string {
  return ProjectLocal.cacheResolve(`install/origins/${namespace}/node_modules`, requesterRoot)
}

export function projectTypeRoots(projectRoot: string): string[] {
  const roots: string[] = []
  let directory = projectRoot
  while (true) {
    roots.push(FS.resolvePath('node_modules/@types', directory))
    const parent = FS.dirname(directory)
    if (parent === directory) {
      return roots
    }
    directory = parent
  }
}

export function hostTypeRoots(options: ProjectToolingOptions): string[] {
  return resolveHostModuleRoots(options).map(root => FS.resolvePath('@types', root))
}

export function ambientTypeNames(typeRoots: readonly string[]): string[] {
  return ['bun', 'node', 'react'].filter(name => typeRoots.some(root => FS.existsSync(FS.resolvePath(name, root))))
}

/**
 * Paths in the base tsconfig let an editor's native TypeScript resolver see installed host peers.
 * A watch may reuse the mapping after discovery and exact consumed-input checks.
 * TypeScript itself always receives a fresh per-enumeration resolution cache on a miss.
 */
export async function hostModulePaths(
  projectRoot: string,
  options: ProjectToolingOptions,
  excludedPackages: ReadonlySet<string> = new Set(),
  session?: ProjectHostModuleSession,
): Promise<Record<string, string[]>> {
  const profiling = Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_PROFILE'] === 'true'
    ? {
      startedAt: performance.now(),
      packageNameDiscoveryMs: 0,
      ownershipChecksMs: 0,
      manifestExistenceMs: 0,
      manifestReadMs: 0,
      typeScriptResolutionMs: 0,
      exportMappingMs: 0,
      inputAuditMs: 0,
      reused: false,
      rootCount: 0,
      packageNameCount: 0,
      ownershipCheckCount: 0,
      manifestCheckCount: 0,
      manifestReadCount: 0,
      rootResolutionCount: 0,
      subpathResolutionCount: 0,
    }
    : undefined
  const resolverOptions: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  }
  const roots = resolveHostModuleRoots(options)
  const discovery: { root: string; packages: { name: string; projectOwned: boolean }[] }[] = []
  for (const root of roots) {
    const packageNamesStartedAt = profiling === undefined ? 0 : performance.now()
    const names = await packageNames(root)
    if (profiling !== undefined) {
      profiling.packageNameDiscoveryMs += performance.now() - packageNamesStartedAt
      profiling.packageNameCount += names.length
    }
    const ownershipStartedAt = profiling === undefined ? 0 : performance.now()
    const packages = names.map(name => ({
      name,
      projectOwned: FS.existsSync(FS.resolvePath(`node_modules/${name}`, projectRoot)),
    }))
    discovery.push({ root, packages })
    if (profiling !== undefined) {
      profiling.ownershipChecksMs += performance.now() - ownershipStartedAt
      profiling.ownershipCheckCount += names.length
    }
  }
  const key = JSON.stringify([
    FS.resolvePath(projectRoot),
    resolverOptions,
    options.hostModulesRoot,
    options.hostModuleRoots,
    roots,
    discovery,
    [...excludedPackages].sort(),
    ts.sys.getCurrentDirectory(),
    ts.sys.useCaseSensitiveFileNames,
    [ts.sys.directoryExists, ts.sys.realpath, ts.sys.getDirectories].map(method => method !== undefined),
  ])
  const auditStartedAt = profiling === undefined ? 0 : performance.now()
  let paths = session?.reuse(key)
  if (profiling !== undefined) {
    profiling.rootCount = roots.length
    profiling.inputAuditMs = performance.now() - auditStartedAt
    profiling.reused = paths !== undefined
  }
  if (paths === undefined) {
    session?.clear()
    paths = {}
    const observations = new Map<string, HostObservation>()
    let stable = true
    const observe = <T extends HostObservation['value']>(kind: string, args: readonly unknown[], read: () => T): T => {
      const value = read()
      if (session !== undefined) {
        const id = JSON.stringify([kind, args])
        const previous = observations.get(id)
        if (previous !== undefined && !sameObservation(previous.value, value)) {
          stable = false
        }
        observations.set(id, { value: Array.isArray(value) ? [...value] : value, read })
      }
      return value
    }
    // Supply only the resolver's documented host surface; every filesystem call is observed.
    const host: ts.ModuleResolutionHost = session === undefined ? ts.sys : {
      fileExists: path => observe('fileExists', [path], () => ts.sys.fileExists(path)),
      readFile: path => observe('readFile', [path], () => ts.sys.readFile(path)),
      ...(ts.sys.directoryExists === undefined ? {} : {
        directoryExists: (path: string) => observe('directoryExists', [path], () => ts.sys.directoryExists(path)),
      }),
      ...(ts.sys.realpath === undefined ? {} : {
        realpath: (path: string) => observe('realpath', [path], () => ts.sys.realpath!(path)),
      }),
      ...(ts.sys.getDirectories === undefined ? {} : {
        getDirectories: (path: string) => observe('getDirectories', [path], () => ts.sys.getDirectories(path)),
      }),
      getCurrentDirectory: () => observe('getCurrentDirectory', [], () => ts.sys.getCurrentDirectory()),
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    }
    const compilerHost = ts.createCompilerHost(resolverOptions)
    const resolutionCache = ts.createModuleResolutionCache(
      compilerHost.getCurrentDirectory(),
      compilerHost.getCanonicalFileName,
      resolverOptions,
    )
    const seen = new Set<string>()
    for (const { root, packages } of discovery) {
      for (const { name: packageName, projectOwned } of packages) {
        if (seen.has(packageName) || excludedPackages.has(packageName) || projectOwned) {
          continue
        }
        const packageRoot = FS.resolvePath(packageName, root)
        const manifestPath = FS.resolvePath('package.json', packageRoot)
        // Match the native resolver's synchronous host lookups while rereading each manifest per invocation.
        const manifestExistenceStartedAt = profiling === undefined ? 0 : performance.now()
        const manifestExists = observe('fileExists', [manifestPath], () => ts.sys.fileExists(manifestPath))
        if (profiling !== undefined) {
          profiling.manifestExistenceMs += performance.now() - manifestExistenceStartedAt
          profiling.manifestCheckCount += 1
        }
        if (!manifestExists) {
          continue
        }
        seen.add(packageName)
        const manifestReadStartedAt = profiling === undefined ? 0 : performance.now()
        const manifest = JSON.parse(observe('manifestText', [manifestPath], () => FS.readTextSync(manifestPath))) as {
          exports?: unknown
        }
        if (profiling !== undefined) {
          profiling.manifestReadMs += performance.now() - manifestReadStartedAt
          profiling.manifestReadCount += 1
        }
        const exports = manifest.exports
        const rootResolutionStartedAt = profiling === undefined ? 0 : performance.now()
        const resolvedRoot = resolveInstalledExport(packageName, root, resolverOptions, resolutionCache, host)
        if (profiling !== undefined) {
          profiling.typeScriptResolutionMs += performance.now() - rootResolutionStartedAt
          profiling.rootResolutionCount += 1
        }
        const exportMappingStartedAt = profiling === undefined ? 0 : performance.now()
        if (exports === undefined) {
          if (resolvedRoot !== undefined) {
            paths[packageName] = [resolvedRoot]
          }
          paths[`${packageName}/*`] = [FS.resolvePath('*', packageRoot)]
          if (profiling !== undefined) {
            profiling.exportMappingMs += performance.now() - exportMappingStartedAt
          }
          continue
        }
        if (!isSubpathExports(exports)) {
          if (resolvedRoot !== undefined) {
            paths[packageName] = [resolvedRoot]
          }
          if (profiling !== undefined) {
            profiling.exportMappingMs += performance.now() - exportMappingStartedAt
          }
          continue
        }
        for (const [subpath, target] of Object.entries(exports)) {
          if (subpath !== '.' && !subpath.startsWith('./')) {
            continue
          }
          if (subpath === '.') {
            if (resolvedRoot !== undefined) {
              paths[packageName] = [resolvedRoot]
            }
            continue
          }
          const key = `${packageName}/${subpath.slice(2)}`
          if (!key.includes('*')) {
            const subpathResolutionStartedAt = profiling === undefined ? 0 : performance.now()
            const resolved = resolveInstalledExport(key, root, resolverOptions, resolutionCache, host)
            if (profiling !== undefined) {
              profiling.typeScriptResolutionMs += performance.now() - subpathResolutionStartedAt
              profiling.subpathResolutionCount += 1
            }
            if (resolved !== undefined) {
              paths[key] = [resolved]
            }
            continue
          }
          const selected = exportTarget(target)
          if (selected !== undefined && selected.startsWith('./')) {
            paths[key] = [FS.resolvePath(selected, packageRoot)]
          }
        }
        if (profiling !== undefined) {
          profiling.exportMappingMs += performance.now() - exportMappingStartedAt
        }
      }
    }
    if (stable) {
      session?.remember(key, paths, observations)
    }
  }
  if (profiling !== undefined) {
    HCI.logProcessInfo(
      'project-tooling',
      JSON.stringify({
        type: 'studio-host-module-profile',
        root: projectRoot,
        reused: profiling.reused,
        counts: {
          roots: profiling.rootCount,
          packageNames: profiling.packageNameCount,
          ownershipChecks: profiling.ownershipCheckCount,
          manifestChecks: profiling.manifestCheckCount,
          manifestReads: profiling.manifestReadCount,
          rootResolutions: profiling.rootResolutionCount,
          subpathResolutions: profiling.subpathResolutionCount,
        },
        phases: {
          inputAuditMs: profiling.inputAuditMs,
          packageNameDiscoveryMs: profiling.packageNameDiscoveryMs,
          ownershipChecksMs: profiling.ownershipChecksMs,
          manifestExistenceMs: profiling.manifestExistenceMs,
          manifestReadMs: profiling.manifestReadMs,
          typeScriptResolutionMs: profiling.typeScriptResolutionMs,
          exportMappingMs: profiling.exportMappingMs,
          totalMs: performance.now() - profiling.startedAt,
        },
      }),
    )
  }
  return paths
}

function resolveInstalledExport(
  specifier: string,
  nodeModulesRoot: string,
  compilerOptions: ts.CompilerOptions,
  resolutionCache: ts.ModuleResolutionCache,
  host: ts.ModuleResolutionHost,
): string | undefined {
  return ts.resolveModuleName(
    specifier,
    FS.resolvePath('__tao_host_resolution__.ts', FS.dirname(nodeModulesRoot)),
    compilerOptions,
    host,
    resolutionCache,
  ).resolvedModule?.resolvedFileName
}

async function packageNames(root: string): Promise<string[]> {
  const names: string[] = []
  for (const entry of await FS.listDir(root)) {
    if (entry.startsWith('@')) {
      const scope = FS.resolvePath(entry, root)
      if (await FS.isDirectory(scope)) {
        for (const name of await FS.listDir(scope)) {
          if (validName(name)) {
            names.push(`${entry}/${name}`)
          }
        }
      }
    } else if (validName(entry)) {
      names.push(entry)
    }
  }
  return names.sort()
}

function validName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)
}

function isSubpathExports(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).some(key => key === '.' || key.startsWith('./'))
}

/** Choose the declaration-bearing branch TypeScript checks in bundler mode. */
function exportTarget(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(exportTarget).find(target => target !== undefined)
  }
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const branches = value as Record<string, unknown>
  for (const key of ['types', 'import', 'default']) {
    const selected = exportTarget(branches[key])
    if (selected !== undefined) {
      return selected
    }
  }
  return undefined
}
