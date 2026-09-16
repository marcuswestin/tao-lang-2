import { AST, codeProjectRoot } from '@parser'
import { FS } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

/** projectValidationMessages declares diagnostics for local project metadata blocks. */
export const projectValidationMessages = {
  topLevelOnly: () => `Project metadata blocks are only allowed at the top level.`,
  duplicateProject: () => `Only one project metadata block is allowed per file.`,
  requiredId: () => `Project metadata requires exactly one id. Run 'tao project id <id> [path]' to add it.`,
  duplicateId: () => `Project metadata can declare id only once.`,
  requiredName: () => `Project metadata requires exactly one name.`,
  duplicateName: () => `Project metadata can declare name only once.`,
  duplicateVersion: () => `Project metadata can declare version only once.`,
  invalidVersion: () => `Project version must be numeric SemVer core (for example, "1.2.3").`,
  duplicateDefaultApp: () => `Project metadata can declare DefaultApp only once.`,
  duplicateRemote: () => `Project metadata can declare remote only once.`,
  duplicateLicense: () => `Project metadata can declare license only once.`,
  missingProject: () =>
    `Project identity is missing. Run 'tao project id <id> [path]' to create checked-in project metadata.`,
  duplicateProjectId: (id: string) =>
    `Project id '${id}' belongs to more than one project in this workspace. Dependency resolution cannot safely alias their declarations.`,
  unsupportedRequires: () => `Project requires entries are not supported yet.`,
} as const

/** validateProjectWorkspace enforces identity ownership across all files participating in one build. */
export function validateProjectWorkspace(ctx: ValidationContext): void {
  if (ctx.entryFilePath.startsWith(`${codeProjectRoot}/`)) {
    return
  }
  const identityFiles = ctx.projectFiles ?? ctx.workspaceFiles
  const projects = identityFiles.flatMap(file =>
    file.statements.filter(AST.isProjectDeclaration).flatMap(project => {
      const id = AST.blockStatementOf(project, { filter: AST.isProjectId })[0]
      return id ? [{ id, project, root: FS.dirname(AST.getDocument(project).uri.path) }] : []
    })
  )
  const owner = projects
    .filter(project => FS.pathIsWithin(ctx.entryFilePath, project.root))
    .toSorted((left, right) => right.root.length - left.root.length)[0]
  if (!owner) {
    const entry = identityFiles.find(file => AST.getDocument(file).uri.path === ctx.entryFilePath)
    if (entry) {
      ctx.error(entry, projectValidationMessages.missingProject())
    }
  }

  const firstById = new Map<string, typeof projects[number]>()
  for (const project of projects.toSorted((left, right) => left.root.localeCompare(right.root))) {
    const first = firstById.get(project.id.value)
    if (first && first.root !== project.root) {
      ctx.error(project.id, projectValidationMessages.duplicateProjectId(project.id.value))
    } else {
      firstById.set(project.id.value, project)
    }
  }
}

/** projectValidationChecks validates project metadata nodes. */
export const projectValidationChecks = {
  [AST.ProjectDeclaration.$type]: validateProject,
} satisfies NodeValidationChecks

/** validateProjectFile validates file-level project metadata constraints. */
export function validateProjectFile(file: AST.TaoFile, ctx: ValidationContext): void {
  const topLevelProjects = file.statements.filter(AST.isProjectDeclaration)
  for (const project of topLevelProjects.slice(1)) {
    ctx.error(project, projectValidationMessages.duplicateProject())
  }
}

function validateProject(project: AST.ProjectDeclaration, ctx: ValidationContext): void {
  if (!AST.isTaoFile(project.$container)) {
    ctx.error(project, projectValidationMessages.topLevelOnly())
  }
  validateProjectBlock(project, ctx)
}

function validateProjectBlock(project: AST.ProjectDeclaration, ctx: ValidationContext): void {
  const ids = AST.blockStatementOf(project, { filter: AST.isProjectId })
  const names = AST.blockStatementOf(project, { filter: AST.isProjectName })
  const versions = AST.blockStatementOf(project, { filter: AST.isProjectVersion })
  const defaultApps = AST.blockStatementOf(project, { filter: AST.isProjectDefaultApp })
  const remotes = AST.blockStatementOf(project, { filter: AST.isProjectRemote })
  const licenses = AST.blockStatementOf(project, { filter: AST.isProjectLicense })
  const requires = AST.blockStatementOf(project, { filter: AST.isProjectRequires })

  if (ids.length === 0) {
    ctx.error(project, projectValidationMessages.requiredId())
  }
  for (const id of ids.slice(1)) {
    ctx.error(id, projectValidationMessages.duplicateId())
  }
  if (names.length === 0) {
    ctx.error(project, projectValidationMessages.requiredName())
  }
  for (const name of names.slice(1)) {
    ctx.error(name, projectValidationMessages.duplicateName())
  }
  for (const version of versions) {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version.value)) {
      ctx.error(version, projectValidationMessages.invalidVersion())
    }
  }
  for (const version of versions.slice(1)) {
    ctx.error(version, projectValidationMessages.duplicateVersion())
  }
  for (const defaultApp of defaultApps.slice(1)) {
    ctx.error(defaultApp, projectValidationMessages.duplicateDefaultApp())
  }
  for (const remote of remotes.slice(1)) {
    ctx.error(remote, projectValidationMessages.duplicateRemote())
  }
  for (const license of licenses.slice(1)) {
    ctx.error(license, projectValidationMessages.duplicateLicense())
  }
  for (const requireStatement of requires) {
    ctx.error(requireStatement, projectValidationMessages.unsupportedRequires())
  }
}
