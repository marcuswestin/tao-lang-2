import Formatter from '@formatter'
import { AST, Parser } from '@parser'
import { Errors, FS } from '@shared'

type SetProjectIdOptions = {
  replace?: boolean
}

type ProjectSource = {
  path: string
  project: AST.ProjectDeclaration
  source: string
}

/** createProject creates a minimal runnable Tao project in a new directory named by its checked-in id. */
export async function createProject(id: string): Promise<string> {
  validateProjectId(id)
  validateDirectoryName(id)

  const directory = FS.resolvePath(id)
  if (await FS.exists(directory)) {
    Errors.throwUserInput(`Cannot create project '${id}': ${FS.displayPath(directory)} already exists.`)
  }

  const appPath = FS.resolvePath('App.tao', directory)
  const generatedPackageMarker = FS.resolvePath('@/.gitkeep', directory)
  await FS.writeText(appPath, projectTemplate(id))
  await FS.writeText(generatedPackageMarker, '')
  return appPath
}

/** setProjectId deliberately adds or replaces the checked-in id in one existing project declaration. */
export async function setProjectId(id: string, target = '.', options: SetProjectIdOptions = {}): Promise<string> {
  validateProjectId(id)
  const resolvedTarget = FS.resolvePath(target)
  const projectSource = await findProjectSource(resolvedTarget)
  if (!projectSource) {
    if (await FS.isFile(resolvedTarget)) {
      Errors.throwUserInput(`No project metadata block found in ${FS.displayPath(resolvedTarget)}.`)
    }
    const projectPath = FS.resolvePath('Project.tao', resolvedTarget)
    const name = FS.basename(resolvedTarget)
    await FS.writeText(projectPath, projectMetadataTemplate(id, name))
    return projectPath
  }
  const existing = AST.blockStatementOf(projectSource.project, { filter: AST.isProjectId })

  if (existing.length > 1) {
    Errors.throwUserInput(`Project metadata in ${FS.displayPath(projectSource.path)} declares id more than once.`)
  }

  const current = existing[0]
  if (current) {
    if (current.value === id) {
      return projectSource.path
    }
    if (options.replace !== true) {
      Errors.throwUserInput(
        `Project id is already '${current.value}'. Use 'tao project id ${quoteForCommand(id)} ${
          quoteForCommand(target)
        } --replace' only when making an independent project; replacement severs persisted-state compatibility.`,
      )
    }
    await FS.writeText(projectSource.path, replaceNode(projectSource.source, current, `id ${taoString(id)}`))
    return projectSource.path
  }

  const withId = insertProjectId(projectSource.source, projectSource.project, id)
  await FS.writeText(projectSource.path, await Formatter.formatCode(withId))
  return projectSource.path
}

async function findProjectSource(target: string): Promise<ProjectSource | undefined> {
  if (!await FS.exists(target)) {
    Errors.throwUserInput(`No file or directory found at ${target}`)
  }

  const paths: string[] = []
  if (await FS.isFile(target)) {
    if (FS.extname(target) !== '.tao') {
      Errors.throwUserInput(`Project metadata must be stored in a .tao file, not ${FS.displayPath(target)}.`)
    }
    paths.push(target)
  } else {
    for await (const path of FS.walk(target, { extensions: ['.tao'] })) {
      paths.push(path)
    }
  }

  const projects: ProjectSource[] = []
  for (const path of paths.toSorted()) {
    const source = await FS.readText(path)
    const parsed = await Parser.parseCode(source, { validation: false })
    for (const project of parsed.entry.ast.statements.filter(AST.isProjectDeclaration)) {
      projects.push({ path, project, source })
    }
  }

  if (projects.length === 0) {
    return undefined
  }
  if (projects.length > 1) {
    Errors.throwUserInput(
      `More than one project metadata block was found at ${
        FS.displayPath(target)
      }; pass the .tao file containing the project to update.`,
    )
  }
  return projects[0]!
}

function insertProjectId(source: string, project: AST.ProjectDeclaration, id: string): string {
  const block = project.block.$cstNode
  if (!block) {
    Errors.throwUnexpected('Parsed project metadata has no source location.')
  }
  const open = source.indexOf('{', block.offset)
  if (open < 0 || open >= block.end) {
    Errors.throwUnexpected('Parsed project metadata has no opening brace.')
  }
  return `${source.slice(0, open + 1)} id ${taoString(id)}${source.slice(open + 1)}`
}

function replaceNode(source: string, node: AST.Node, replacement: string): string {
  const cst = node.$cstNode
  if (!cst) {
    Errors.throwUnexpected('Parsed project metadata has no source location.')
  }
  return `${source.slice(0, cst.offset)}${replacement}${source.slice(cst.end)}`
}

function validateProjectId(id: string): void {
  if (id.length === 0 || /[\u0000-\u001f\u007f]/u.test(id)) {
    Errors.throwUserInput('A project id must be non-empty text without control characters.')
  }
}

function validateDirectoryName(id: string): void {
  if (id === '.' || id === '..' || id.includes('/') || id.includes('\\')) {
    Errors.throwUserInput(`Project id '${id}' cannot be used as a directory name.`)
  }
}

function projectTemplate(id: string): string {
  const value = taoString(id)
  return `project {\n   id ${value}\n   name ${value}\n   version "0.1.0"\n   DefaultApp App\n}\n\napp App { view Main }\n\nview Main() { }\n`
}

/**
 * The same three fields `projectTemplate` writes. Metadata added to an existing directory used to carry only
 * an id and a name, so the project it described could never ship: shipping needs a version, and the failure
 * surfaced only at the point of shipping, long after the metadata was written.
 */
function projectMetadataTemplate(id: string, name: string): string {
  return `project {\n   id ${taoString(id)}\n   name ${taoString(name)}\n   version "0.1.0"\n}\n`
}

function taoString(value: string): string {
  return JSON.stringify(value)
}

function quoteForCommand(value: string): string {
  return /\s/u.test(value) ? JSON.stringify(value) : value
}
