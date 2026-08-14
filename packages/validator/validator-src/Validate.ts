import { AST } from '@parser'
import { NodeValidation, type NodeValidationChecks } from './node-validation'
import type { ValidationContext } from './validation'
import { ActionsValidator } from './validators/ActionsValidator'
import { AliasesValidator } from './validators/aliases-validator'
import { AppValidator } from './validators/app-validator'
import { configurationValidationChecks } from './validators/configuration-validator'
import { validateData } from './validators/data-validator'
import { DialogueValidator } from './validators/dialogue-validator'
import { ExpressionsValidator } from './validators/expressions-validator'
import { FunctionalCoreValidator } from './validators/FunctionalCoreValidator'
import { injectionValidationChecks } from './validators/injections-validator'
import { InvocationsValidator } from './validators/invocations-validator'
import { LayoutValidator } from './validators/layout-validator'
import { validateNavigation } from './validators/navigation-validator'
import { projectValidationChecks, validateProjectFile } from './validators/project-validator'
import { StateValidator } from './validators/StateValidator'
import { testValidationChecks } from './validators/tests-validator'
import { validateTypes } from './validators/types-validator'
import { validateUseStatements, validateVisibleDeclarations } from './validators/use-validator'
import { ViewsValidator } from './validators/views-validator'

const nodeValidationChecks = NodeValidation.compile(
  [
    projectValidationChecks,
    LayoutValidator.checks,
    injectionValidationChecks,
    testValidationChecks,
    InvocationsValidator.checks,
    configurationValidationChecks,
  ] satisfies readonly NodeValidationChecks[],
)

function validateTaoFile(file: AST.TaoFile, ctx: ValidationContext): void {
  AppValidator.validate(file, ctx)
  validateProjectFile(file, ctx)
  ViewsValidator.validate(file, ctx)
  ActionsValidator.validate(file, ctx)
  StateValidator.validate(file, ctx)
  AliasesValidator.validate(file, ctx)
  validateTypes(file, ctx)
  FunctionalCoreValidator.validate(file, ctx)
  validateData(file, ctx)
  DialogueValidator.validate(file, ctx)
  validateNavigation(file, ctx)
  NodeValidation.validate(AST.streamAllContents(file), file, ctx, nodeValidationChecks)

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
  FunctionalCore: FunctionalCoreValidator.validate,
  Data: validateData,
  Dialogues: DialogueValidator.validate,
  Navigation: validateNavigation,
  States: StateValidator.validate,
  TaoFile: validateTaoFile,
  Types: validateTypes,
  TypirProblems: ExpressionsValidator.validateTypirProblems,
  UseStatements: validateUseStatements,
  VisibleDeclarations: validateVisibleDeclarations,
  Views: ViewsValidator.validate,
} as const
