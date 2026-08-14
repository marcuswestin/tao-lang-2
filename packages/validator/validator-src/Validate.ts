import { AST } from '@parser'
import { NodeValidation, type NodeValidationChecks } from './node-validation'
import type { ValidationContext } from './validation'
import { ActionsValidator } from './validators/ActionsValidator'
import { AliasesValidator } from './validators/aliases-validator'
import { AppValidator } from './validators/app-validator'
import { configurationValidationChecks } from './validators/configuration-validator'
import {
  configuredValueValidationChecks,
  validateConfiguredValuesFile,
} from './validators/configured-values-validator'
import { dataValidationChecks, validateDataFile } from './validators/data-validator'
import { DialogueValidator } from './validators/dialogue-validator'
import { ExpressionsValidator } from './validators/expressions-validator'
import { FunctionalCoreValidator } from './validators/FunctionalCoreValidator'
import { injectionValidationChecks } from './validators/injections-validator'
import { InvocationsValidator } from './validators/invocations-validator'
import { LayoutValidator } from './validators/layout-validator'
import { navigationValidationChecks } from './validators/navigation-validator'
import { projectValidationChecks, validateProjectFile } from './validators/project-validator'
import { StateValidator } from './validators/StateValidator'
import { testValidationChecks } from './validators/tests-validator'
import { typeValidationChecks } from './validators/types-validator'
import { validateUseStatements, validateVisibleDeclarations } from './validators/use-validator'
import { ViewsValidator } from './validators/views-validator'

const nodeValidationChecks = NodeValidation.compile(
  [
    projectValidationChecks,
    ViewsValidator.checks,
    ActionsValidator.checks,
    StateValidator.checks,
    AliasesValidator.checks,
    LayoutValidator.checks,
    injectionValidationChecks,
    testValidationChecks,
    typeValidationChecks,
    InvocationsValidator.checks,
    FunctionalCoreValidator.checks,
    dataValidationChecks,
    configurationValidationChecks,
    DialogueValidator.checks,
    navigationValidationChecks,
    configuredValueValidationChecks,
  ] satisfies readonly NodeValidationChecks[],
)

function validateTaoFile(file: AST.TaoFile, ctx: ValidationContext): readonly AST.Node[] {
  AppValidator.validate(file, ctx)
  validateProjectFile(file, ctx)
  AliasesValidator.validateFile(file, ctx)
  validateDataFile(file, ctx)
  const nodes = AST.streamAllContents(file)
  NodeValidation.validate(nodes, file, ctx, nodeValidationChecks)
  validateConfiguredValuesFile(file, ctx)

  const document = AST.getDocument(file)
  if (document.uri.scheme === 'file') {
    validateVisibleDeclarations(ctx, file)
    validateUseStatements(file, ctx)
  }
  return nodes
}

/** Validate exposes Tao AST validation passes. */
export const Validate = {
  App: AppValidator.validate,
  TaoFile: validateTaoFile,
  TypirProblems: ExpressionsValidator.validateTypirProblems,
  UseStatements: validateUseStatements,
  VisibleDeclarations: validateVisibleDeclarations,
} as const
