import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { validateAliases } from './aliases-validator'
import { validateApp } from './app-validator'
import { validateTypirProblems } from './expressions-validator'
import { validateInjections } from './injections-validator'
import { validateInvocations } from './invocations-validator'
import { validateProject } from './project-validator'
import { validateUseStatements, validateVisibleDeclarations } from './use-validator'
import type { ValidationContext } from './validation'
import { validateViews } from './views-validator'

function validateTaoFile(file: AST.TaoFile, ctx: ValidationContext): void {
  validateApp(file, ctx)
  validateProject(file, ctx)
  validateViews(file, ctx)
  validateAliases(file, ctx)
  validateInjections(file, ctx)
  validateInvocations(file, ctx)

  const document = ASTUtils.getDocument(file)
  if (document.uri.scheme === 'file') {
    validateVisibleDeclarations(ctx, file)
    validateUseStatements(file, ctx)
  }
}

/** Validate exposes Tao AST validation passes. */
export const Validate = {
  Aliases: validateAliases,
  App: validateApp,
  Injections: validateInjections,
  Invocations: validateInvocations,
  Project: validateProject,
  TaoFile: validateTaoFile,
  TypirProblems: validateTypirProblems,
  UseStatements: validateUseStatements,
  VisibleDeclarations: validateVisibleDeclarations,
  Views: validateViews,
} as const
