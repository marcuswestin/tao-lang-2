import ASTUtils, { Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import type { ValidationProblemAcceptor } from 'typir'
import { AliasesValidator } from './aliases-validator'
import { DeclarationOrder } from './DeclarationOrder'
import { type TaoSpecifics, type TaoTypirServices, TypeSystemHelpers } from './TypeSystemHelpers'
import type { ValidationContext } from './validation'

const actionValidationMessages = {
  duplicateParameter: (name: string) => `Parameter '${name}' is declared more than once in this action.`,
  missingArgument: (action: string, parameter: string) =>
    `Action ${action} is missing argument for parameter '${parameter}'.`,
  extraArguments: (action: string, expected: number, actual: number) =>
    `Action ${action} expects ${expected} argument(s), found ${actual}.`,
  dynamicActionArguments: 'Action values without a named declaration cannot receive arguments in this MVP.',
  doTypeMismatch: (actual: string) => `do expects an action, got ${actual}.`,
  argumentTypeMismatch: (parameter: string, expected: string, actual: string) =>
    `Action argument for parameter '${parameter}' expects ${expected}, got ${actual}.`,
} as const

/** ActionsValidator groups action validation and diagnostics. */
export const ActionsValidator = {
  messages: actionValidationMessages,
  registerTypeValidation,
  validate,
}

function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const action of ASTUtils.streamAllContents(file).filter(AST.isActionDeclaration)) {
    validateDuplicateParameters(action, ctx)
    validateParameterNameConflicts(action, ctx)
  }
  for (const invocation of ASTUtils.streamAllContents(file).filter(AST.isDoStatement)) {
    reportArity(invocation, ctx)
  }
}

function registerTypeValidation(typir: TaoTypirServices): void {
  typir.validation.Collector.addValidationRulesForAstNodes({
    DoStatement: (invocation, accept, services) => {
      validateDoStatementTypes(invocation, accept, services as TaoTypirServices)
    },
  })
}

function validateDuplicateParameters(action: AST.ActionDeclaration, ctx: ValidationContext): void {
  const seen = new Set<string>()
  for (const parameter of action.parameterList?.parameters ?? []) {
    const name = Type.parameterName(parameter)
    if (seen.has(name)) {
      ctx.error(actionValidationMessages.duplicateParameter(name), parameter)
      continue
    }
    seen.add(name)
  }
}

function validateParameterNameConflicts(action: AST.ActionDeclaration, ctx: ValidationContext): void {
  const visibleNames = visibleActionParameterConflictNames(action)
  for (const parameter of action.parameterList?.parameters ?? []) {
    const name = Type.parameterName(parameter)
    if (visibleNames.has(name)) {
      ctx.error(AliasesValidator.messages.duplicateName(name), parameter)
    }
  }
}

function visibleActionParameterConflictNames(action: AST.ActionDeclaration): Set<string> {
  const visibleNames = new Set<string>()
  const root = DeclarationOrder.findRoot(action)
  if (AST.isTaoFile(root)) {
    addDeclarationNames(visibleNames, DeclarationOrder.importableValueDeclarationsInFile(root))
  }

  const owningView = DeclarationOrder.findOwningView(action)
  addDeclarationNames(visibleNames, owningView?.parameterList?.parameters ?? [])

  for (const block of DeclarationOrder.ancestorBlocks(action).reverse()) {
    addDeclarationNames(visibleNames, DeclarationOrder.valueDeclarationsOwnedByBlock(block))
  }

  return visibleNames
}

function addDeclarationNames(visibleNames: Set<string>, declarations: readonly AST.NamedDeclaration[]): void {
  for (const declaration of declarations) {
    visibleNames.add(AST.isParameterDeclaration(declaration) ? Type.parameterName(declaration) : declaration.name)
  }
}

function reportArity(invocation: AST.DoStatement, ctx: ValidationContext): void {
  const resolved = ASTUtils.resolveActionInvocation(invocation)
  if (!resolved.action) {
    if (ASTUtils.resolveActionTarget(invocation.action).kind === 'dynamic') {
      reportDynamicActionArguments(invocation, ctx)
    }
    return
  }

  const arity = ASTUtils.invocationArity(resolved, resolved.action, invocation)

  for (const parameter of arity.parameters.slice(arity.pairCount)) {
    ctx.error(actionValidationMessages.missingArgument(resolved.action.name, Type.parameterName(parameter)), invocation)
  }
  if (arity.args.length > arity.pairCount) {
    const extraArgument = arity.args[arity.pairCount]
    Assert.defined(extraArgument, 'extra action argument exists', {
      argumentCount: arity.args.length,
      pairCount: arity.pairCount,
    })
    ctx.error(
      actionValidationMessages.extraArguments(
        resolved.action.name,
        arity.parameters.length,
        arity.args.length,
      ),
      extraArgument,
    )
  }
}

function reportDynamicActionArguments(invocation: AST.DoStatement, ctx: ValidationContext): void {
  const args = invocation.argumentList?.arguments ?? []
  if (args.length > 0) {
    ctx.error(actionValidationMessages.dynamicActionArguments, args[0]!)
  }
}

function validateDoStatementTypes(
  invocation: AST.DoStatement,
  accept: ValidationProblemAcceptor<TaoSpecifics>,
  services: TaoTypirServices,
): void {
  const actionType = TypeSystemHelpers.taoPrimitiveType('action', services)
  services.validation.Constraints.ensureNodeIsAssignable(invocation.action, actionType, accept, actual => ({
    languageNode: invocation.action,
    message: actionValidationMessages.doTypeMismatch(actual.name),
  }))

  const resolved = ASTUtils.resolveActionInvocation(invocation)
  for (const pair of resolved.pairs) {
    const expected = TypeSystemHelpers.taoPrimitiveType(pair.parameter.type, services)
    services.validation.Constraints.ensureNodeIsAssignable(pair.argument.value, expected, accept, actual => ({
      languageNode: pair.argument.value,
      message: actionValidationMessages.argumentTypeMismatch(
        Type.parameterName(pair.parameter),
        Type.referenceName(pair.parameter.type),
        actual.name,
      ),
    }))
  }
}
