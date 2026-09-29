import { Packages } from '@ast-utils'
import { Assert, FS } from '@shared'
import type { WorkspaceServices } from './langium-services'

/** ProjectContext declares cross-stage state owned by a Workspace. */
export type ProjectContext<ServicesT extends WorkspaceServices = WorkspaceServices> = {
  root: string
  packagesContext: Packages.Context
  services: ServicesT
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
  return {
    root,
    packagesContext,
    services: createServices(packagesContext),
  }
}
