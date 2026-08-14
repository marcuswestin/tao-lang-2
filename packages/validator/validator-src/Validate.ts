import { AST } from '@parser'
import type { ValidationContext } from './validation'
import { ActionsValidator } from './validators/ActionsValidator'
import { AliasesValidator } from './validators/aliases-validator'
import { AppValidator } from './validators/app-validator'
import { validateConfigurationDeclarations } from './validators/configuration-validator'
import { validateData } from './validators/data-validator'
import { DialogueValidator } from './validators/dialogue-validator'
import { ExpressionsValidator } from './validators/expressions-validator'
import { FunctionalCoreValidator } from './validators/FunctionalCoreValidator'
import { validateInjections } from './validators/injections-validator'
import { InvocationsValidator } from './validators/invocations-validator'
import { LayoutValidator } from './validators/layout-validator'
import { validateNavigation } from './validators/navigation-validator'
import { validateProject } from './validators/project-validator'
import { StateValidator } from './validators/StateValidator'
import { validateTests } from './validators/tests-validator'
import { validateTypes } from './validators/types-validator'
import { validateUseStatements, validateVisibleDeclarations } from './validators/use-validator'
import { ViewsValidator } from './validators/views-validator'

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
  validateConfigurationDeclarations(file, ctx)
  DialogueValidator.validate(file, ctx)
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
  ConfigurationDeclarations: validateConfigurationDeclarations,
  Dialogues: DialogueValidator.validate,
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
