import { AST } from '@parser'
import { ActionsValidator } from './ActionsValidator'
import { AliasesValidator } from './aliases-validator'
import { AppValidator } from './app-validator'
import { validateData } from './data-validator'
import { ExpressionsValidator } from './expressions-validator'
import { FunctionalCoreValidator } from './FunctionalCoreValidator'
import { validateInjections } from './injections-validator'
import { InvocationsValidator } from './invocations-validator'
import { LayoutValidator } from './layout-validator'
import { validateNavigation } from './navigation-validator'
import { validateProject } from './project-validator'
import { StateValidator } from './StateValidator'
import { validateTests } from './tests-validator'
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
  validateTests(file, ctx)
  validateTypes(file, ctx)
  InvocationsValidator.validate(file, ctx)
  FunctionalCoreValidator.validate(file, ctx)
  validateData(file, ctx)
  validateNavigation(file, ctx)

  const document = AST.getDocument(file)
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
  FunctionalCore: FunctionalCoreValidator.validate,
  Data: validateData,
  Layouts: LayoutValidator.validate,
  Navigation: validateNavigation,
  Project: validateProject,
  States: StateValidator.validate,
  TaoFile: validateTaoFile,
  Tests: validateTests,
  Types: validateTypes,
  TypirProblems: ExpressionsValidator.validateTypirProblems,
  UseStatements: validateUseStatements,
  VisibleDeclarations: validateVisibleDeclarations,
  Views: ViewsValidator.validate,
} as const
