import { FS, ProjectLocal, TaoResources, TaoStdlib } from '@shared'
import * as ts from 'typescript'
import type { ProjectToolingOptions } from './ProjectTooling'

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

/** Paths in the base tsconfig let an editor's native TypeScript resolver see installed host peers. */
export async function hostModulePaths(
  projectRoot: string,
  options: ProjectToolingOptions,
  excludedPackages: ReadonlySet<string> = new Set(),
): Promise<Record<string, string[]>> {
  const paths: Record<string, string[]> = {}
  const seen = new Set<string>()
  for (const root of [...resolveHostModuleRoots(options), ...await nativeBindingModuleRoots(options)]) {
    for (const packageName of await packageNames(root)) {
      if (
        seen.has(packageName) || excludedPackages.has(packageName)
        || FS.existsSync(FS.resolvePath(`node_modules/${packageName}`, projectRoot))
      ) {
        continue
      }
      const packageRoot = FS.resolvePath(packageName, root)
      const manifestPath = FS.resolvePath('package.json', packageRoot)
      if (!await FS.isFile(manifestPath)) {
        continue
      }
      seen.add(packageName)
      const manifest = await FS.readJson<{ exports?: unknown }>(manifestPath)
      const exports = manifest.exports
      const resolvedRoot = resolveInstalledExport(packageName, root)
      if (exports === undefined) {
        if (resolvedRoot !== undefined) {
          paths[packageName] = [resolvedRoot]
        }
        paths[`${packageName}/*`] = [FS.resolvePath('*', packageRoot)]
        continue
      }
      if (!isSubpathExports(exports)) {
        if (resolvedRoot !== undefined) {
          paths[packageName] = [resolvedRoot]
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
          const resolved = resolveInstalledExport(key, root)
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
    }
  }
  return paths
}

/** Verified portable declarations remain available before a project installs its native peers. */
export async function nativeBindingModuleRoots(options: ProjectToolingOptions = {}): Promise<string[]> {
  const stdlibRoot = options.nativeBindings?.stdlibRoot ?? TaoStdlib.declaredRoot()
    ?? FS.resolvePath('../../../../packages/apps/stdlib', import.meta.dir)
  const nativeRoot = FS.resolvePath('.tao-ts/native-bindings', stdlibRoot)
  if (!await FS.isDirectory(nativeRoot)) {
    return []
  }
  const roots: string[] = []
  for (const capability of await FS.listDir(nativeRoot)) {
    const root = FS.resolvePath(`${capability}/inputs/node_modules`, nativeRoot)
    if (await FS.isDirectory(root)) {
      roots.push(root)
    }
  }
  return roots
}

function resolveInstalledExport(specifier: string, nodeModulesRoot: string): string | undefined {
  return ts.resolveModuleName(
    specifier,
    FS.resolvePath('__tao_host_resolution__.ts', FS.dirname(nodeModulesRoot)),
    { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
    ts.sys,
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
  return names
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
