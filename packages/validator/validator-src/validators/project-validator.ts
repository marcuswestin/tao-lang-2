import { AST } from '@parser'
import type { ValidationContext } from '../validation'

/** projectValidationMessages declares diagnostics for local project metadata blocks. */
export const projectValidationMessages = {
  topLevelOnly: () => `Project metadata blocks are only allowed at the top level.`,
  duplicateProject: () => `Only one project metadata block is allowed per file.`,
  requiredName: () => `Project metadata requires exactly one name.`,
  duplicateName: () => `Project metadata can declare name only once.`,
  duplicateRemote: () => `Project metadata can declare remote only once.`,
  duplicateLicense: () => `Project metadata can declare license only once.`,
  unsupportedRequires: () => `Project requires entries are not supported yet.`,
} as const

/** validateProject validates local project metadata blocks. */
export function validateProject(file: AST.TaoFile, ctx: ValidationContext): void {
  const topLevelProjects = file.statements.filter(AST.isProjectDeclaration)
  for (const project of topLevelProjects.slice(1)) {
    ctx.error(projectValidationMessages.duplicateProject(), project)
  }

  for (const project of AST.streamAllContents(file).filter(AST.isProjectDeclaration)) {
    if (!AST.isTaoFile(project.$container)) {
      ctx.error(projectValidationMessages.topLevelOnly(), project)
    }
    validateProjectBlock(project, ctx)
  }
}

function validateProjectBlock(project: AST.ProjectDeclaration, ctx: ValidationContext): void {
  const names = AST.blockStatementOf(project, { filter: AST.isProjectName })
  const remotes = AST.blockStatementOf(project, { filter: AST.isProjectRemote })
  const licenses = AST.blockStatementOf(project, { filter: AST.isProjectLicense })
  const requires = AST.blockStatementOf(project, { filter: AST.isProjectRequires })

  if (names.length === 0) {
    ctx.error(projectValidationMessages.requiredName(), project)
  }
  for (const name of names.slice(1)) {
    ctx.error(projectValidationMessages.duplicateName(), name)
  }
  for (const remote of remotes.slice(1)) {
    ctx.error(projectValidationMessages.duplicateRemote(), remote)
  }
  for (const license of licenses.slice(1)) {
    ctx.error(projectValidationMessages.duplicateLicense(), license)
  }
  for (const requireStatement of requires) {
    ctx.error(projectValidationMessages.unsupportedRequires(), requireStatement)
  }
}
