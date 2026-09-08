import { AST } from '@parser'
import { FS } from '@shared'
import { Workspace } from '@workspace'
import { findTaoFiles } from './tao-files'

/** TaoDevApp identifies one runnable app declaration and its project grouping. */
export type TaoDevApp = {
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
      const projectKey = `${app.projectRoot}\u0000${app.projectName}`
      const project = projects.get(projectKey) ?? {
        apps: [],
        name: app.projectName,
        root: app.projectRoot,
      }
      project.apps.push(app)
      projects.set(projectKey, project)
    }
  }

  return [...projects.values()]
}

async function discoverAppsInFile(appPath: string): Promise<TaoDevApp[]> {
  const parsed = await Workspace.parse(appPath)
  const appNames = AST.appValueDeclarationsInFile(parsed.entry.ast).map(statement => statement.name)
  if (appNames.length === 0) {
    return []
  }

  const projectFile = parsed.files
    .flatMap(file => file.ast.statements.filter(AST.isProjectDeclaration).map(project => ({ file, project })))
    .filter(candidate => FS.pathIsWithin(appPath, FS.dirname(candidate.file.path)))
    .toSorted((left, right) => right.file.path.length - left.file.path.length)[0]
  const project = projectFile?.project
  const declaredName = project?.block.statements.find(AST.isProjectName)?.value
  const projectRoot = projectFile ? FS.dirname(projectFile.file.path) : FS.dirname(appPath)
  const projectName = declaredName ?? FS.basename(projectRoot)
  return appNames.map(appName => ({ appName, appPath, projectName, projectRoot }))
}
