import { Packages } from '@ast-utils'
import { Assert, FS } from '@shared'
import type { WorkspaceServices } from './langium-services'

/** ProjectContext declares cross-stage state owned by a Workspace. */
export type ProjectContext<ServicesT extends WorkspaceServices = WorkspaceServices> = {
  root: string
  packagesContext: Packages.Context
  services: ServicesT
}

const projectTopologies = new WeakMap<ProjectContext, string>()

function topologyOf(context: Packages.Context): string {
  return JSON.stringify({
    root: context.index.projectRoot,
    roots: [...context.index.projectRoots].sort(),
    packages: [...context.index.packages].map(([name, paths]) => [name, [...paths].sort()]).sort(),
    sources: [...context.sourcePaths ?? []].sort(),
  })
}

/** createProjectContext creates root, package, and service state for one Workspace. */
export async function createProjectContext<ServicesT extends WorkspaceServices>(
  directoryPath: string,
  createServices: (packagesContext: Packages.Context) => ServicesT,
  sourcePaths?: readonly string[],
  stdlibRoot?: string,
): Promise<ProjectContext<ServicesT>> {
  const root = FS.resolvePath(directoryPath)
  Assert(await FS.isDirectory(root), 'workspace root is an existing directory', { root })
  const packagesContext = await Packages.createContext(root, {
    sourcePaths,
    ...(stdlibRoot === undefined ? {} : { stdlibRoot }),
  })
  const project = {
    root,
    packagesContext,
    services: createServices(packagesContext),
  }
  projectTopologies.set(project, topologyOf(packagesContext))
  return project
}

/** Refresh mutable package topology without retiring the parser services that read this context. */
export async function refreshProjectContext(project: ProjectContext): Promise<boolean> {
  const previous = project.packagesContext
  const fresh = await Packages.createContext(project.root, {
    sourcePaths: Object.keys(project.services.sourceOverrides ?? {}),
    stdlibRoot: project.packagesContext.stdlibRoot,
  })
  const physicalChanges = await Promise.all([...previous.physicalPaths].map(async ([path, held]) => {
    let ancestor = path
    while (!await FS.exists(ancestor) && !await FS.isSymbolicLink(ancestor)) {
      ancestor = FS.dirname(ancestor)
    }
    const current = await FS.realPath(ancestor).catch(() => undefined)
    return current === undefined || FS.resolvePath(FS.relativePath(ancestor, path), current) !== held
  }))
  // Parser loading expands the mutable index with intrinsic and required external projects. Compare
  // disk scans with the last disk scan, rather than mistaking those loaded additions for a change.
  const freshTopology = topologyOf(fresh)
  const changed = (projectTopologies.get(project) ?? topologyOf(previous)) !== freshTopology
    || physicalChanges.some(Boolean)
  projectTopologies.set(project, freshTopology)
  Object.assign(project.packagesContext, fresh)
  return changed
}
