import ASTUtils from '@ast-utils'
import { AST } from '@parser'
import { ActionsValidator } from './ActionsValidator'
import { AliasesValidator } from './aliases-validator'
import { AppValidator } from './app-validator'
import { ExpressionsValidator } from './expressions-validator'
import { validateInjections } from './injections-validator'
import { InvocationsValidator } from './invocations-validator'
import { LayoutValidator } from './layout-validator'
import { validateProject } from './project-validator'
import { StateValidator } from './StateValidator'
import { validateTypes } from './types-validator'
import { validateUseStatements, validateVisibleDeclarations } from './use-validator'
import type { ValidationContext } from './validation'
import { ViewsValidator } from './views-validator'

function validateTaoFile(file: AST.TaoFile, ctx: ValidationContext): void {
  AppValidator.validate(file, ctx)
  validateProject(file, ctx)
  ViewsValidator.validate(file, ctx)
  ActionsValidator.validate(file, ctx)
  StateValidator.validate(file, ctx)
  AliasesValidator.validate(file, ctx)
  LayoutValidator.validate(file, ctx)
  validateInjections(file, ctx)
  validateTypes(file, ctx)
  InvocationsValidator.validate(file, ctx)

  const document = ASTUtils.getDocument(file)
  if (document.uri.scheme === 'file') {
    validateVisibleDeclarations(ctx, file)
    validateUseStatements(file, ctx)
  }
}

/** Validate exposes Tao AST validation passes. */
export const Validate = {
  Aliases: AliasesValidator.validate,
  App: AppValidator.validate,
  Actions: ActionsValidator.validate,
  Injections: validateInjections,
  Invocations: InvocationsValidator.validate,
  Layouts: LayoutValidator.validate,
  Project: validateProject,
  States: StateValidator.validate,
  TaoFile: validateTaoFile,
  Types: validateTypes,
  TypirProblems: ExpressionsValidator.validateTypirProblems,
  UseStatements: validateUseStatements,
  VisibleDeclarations: validateVisibleDeclarations,
  Views: ViewsValidator.validate,
} as const
