import { ASTUtils, Packages } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Errors, FS } from '@shared'
import { findTaoFiles } from './tao-files'

/** TaoDevApp identifies one runnable app declaration and its project grouping. */
export type TaoDevApp = {
  appId: string
  appName: string
  appPath: string
  projectName: string
  projectRoot: string
}

/** TaoDevProject groups runnable app declarations for selector output. */
export type TaoDevProject = {
  apps: TaoDevApp[]
  name: string
  root: string
}

/** discoverTaoDevProjects finds runnable apps recursively under one CLI target. */
export async function discoverTaoDevProjects(targetPath: string): Promise<TaoDevProject[]> {
  const taoFiles = (await findTaoFiles(targetPath)).filter(path => !path.endsWith('.test.tao'))
  const discovered = await Promise.all(taoFiles.map(discoverAppsInFile))
  const projects = new Map<string, TaoDevProject>()

  for (const appFile of discovered) {
    for (const app of appFile) {
      const projectKey = app.projectRoot
      const project = projects.get(projectKey) ?? {
        apps: [],
        name: app.projectName,
        root: app.projectRoot,
      }
      project.apps.push(app)
      projects.set(projectKey, project)
    }
  }

  return [...projects.values()].toSorted((left, right) => left.name.localeCompare(right.name))
}

async function discoverAppsInFile(appPath: string): Promise<TaoDevApp[]> {
  const parsed = await Workspace.parse(appPath)
  const declarations = AST.appValueDeclarationsInFile(parsed.entry.ast)
  if (declarations.length === 0) {
    return []
  }

  const containingRoot = await Packages.containingProjectRoot(FS.dirname(appPath))
  if (containingRoot === undefined) {
    return []
  }
  // Resolve the project root through realpath so a symlink does not create a second app authority.
  const projectRoot = await FS.realPath(containingRoot)
  const projectName = FS.basename(projectRoot)
  return declarations.map(declaration => {
    const id = ASTUtils.effectiveAppConfiguration(declaration).get('id')?.value
    if (id === undefined || !AST.isStringLiteral(id)) {
      Errors.throwUserInput(`App '${declaration.name}' in ${appPath} requires a literal id before running.`)
    }
    return { appId: id.value, appName: declaration.name, appPath, projectName, projectRoot }
  })
}
