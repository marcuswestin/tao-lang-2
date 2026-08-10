import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { ValidationProblemAcceptor } from 'typir'
import { AliasesValidator } from './aliases-validator'
import { type TaoSpecifics, type TaoTypirServices } from './TypeSystemHelpers'
import type { ValidationContext } from './validation'

/** actionValidationMessages declares action validation diagnostics. */
const actionValidationMessages = {
  duplicateParameter: (name: string) => `Parameter '${name}' is declared more than once in this action.`,
  missingArgument: (action: string, parameter: string) =>
    `Action ${action} is missing argument for parameter '${parameter}'.`,
  unmatchedArgument: (action: string) =>
    `Action ${action} has an argument that does not match any unbound parameter by type.`,
  ambiguousArgument: (action: string, parameters: readonly AST.ParameterDeclaration[]) =>
    `Action ${action} has an argument that matches multiple parameters by type: ${
      parameters.map(Type.parameterName).join(', ')
    }.`,
  ambiguousParameter: (action: string, parameter: string) =>
    `Action ${action} has multiple arguments that match parameter '${parameter}' by type.`,
  duplicateParameterType: (action: string, parameter: string) =>
    `Action ${action} has more than one parameter with the same type near '${parameter}'.`,
  duplicateArgumentType: (action: string) => `Action ${action} has more than one argument with the same exact type.`,
  unknownNamedArgument: (action: string, name: string) => `Action ${action} has no parameter named '${name}'.`,
  duplicateNamedArgument: (action: string, name: string) =>
    `Action ${action} receives parameter '${name}' more than once.`,
  namedArgumentType: (action: string, name: string, expected: string, actual: string) =>
    `Named argument '.${name}' of action ${action} expects ${expected}, got ${actual}.`,
  dynamicActionArguments: 'Action values without a named declaration cannot receive arguments in this MVP.',
  doTypeMismatch: (actual: string) => `do expects an action, got ${actual}.`,
}

/** ActionsValidator groups action validation and diagnostics. */
export const ActionsValidator = {
  messages: actionValidationMessages,
  registerTypeValidation,
  validate,
} as const

/////////////
// Private //
/////////////

function validate(file: AST.TaoFile, ctx: ValidationContext): void {
  for (const action of AST.streamAllContents(file).filter(AST.isActionDeclaration)) {
    validateDuplicateParameters(action, ctx)
    validateParameterNameConflicts(action, ctx)
  }
  for (const invocation of AST.streamAllContents(file).filter(AST.isDoStatement)) {
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
  for (const parameter of AST.parametersOf(action)) {
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
  for (const parameter of AST.parametersOf(action)) {
    const name = Type.parameterName(parameter)
    if (visibleNames.has(name)) {
      ctx.error(AliasesValidator.messages.duplicateName(name), parameter)
    }
  }
}

function visibleActionParameterConflictNames(action: AST.ActionDeclaration): Set<string> {
  const visibleNames = new Set<string>()
  const root = AST.findRoot(action)
  if (AST.isTaoFile(root)) {
    addDeclarationNames(visibleNames, AST.importableValueDeclarationsInFile(root))
  }

  const owningView = AST.findOwningView(action)
  addDeclarationNames(visibleNames, owningView ? AST.parametersOf(owningView) : [])

  for (const block of AST.ancestorBlocks(action).reverse()) {
    addDeclarationNames(visibleNames, AST.valueDeclarationsOwnedByBlock(block))
  }

  return visibleNames
}

function addDeclarationNames(visibleNames: Set<string>, declarations: readonly AST.NamedDeclaration[]): void {
  for (const declaration of declarations) {
    visibleNames.add(Type.declarationName(declaration))
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

  for (const diagnostic of resolved.diagnostics) {
    reportActionBindingDiagnostic(resolved.action, diagnostic, invocation, ctx)
  }
}

function reportActionBindingDiagnostic(
  action: AST.ActionDeclaration,
  diagnostic: ASTUtils.ArgumentBindingDiagnostic,
  invocation: AST.DoStatement,
  ctx: ValidationContext,
): void {
  Switch.kind(diagnostic, {
    'missing-argument': diagnostic => {
      ctx.error(
        actionValidationMessages.missingArgument(action.name, Type.parameterName(diagnostic.parameter)),
        invocation,
      )
    },
    'unmatched-argument': diagnostic => {
      ctx.error(actionValidationMessages.unmatchedArgument(action.name), diagnostic.argument)
    },
    'ambiguous-argument': diagnostic => {
      ctx.error(
        actionValidationMessages.ambiguousArgument(action.name, diagnostic.parameters),
        diagnostic.argument,
      )
    },
    'ambiguous-parameter': diagnostic => {
      ctx.error(
        actionValidationMessages.ambiguousParameter(action.name, Type.parameterName(diagnostic.parameter)),
        invocation,
      )
    },
    'duplicate-argument-type': diagnostic => {
      ctx.error(actionValidationMessages.duplicateArgumentType(action.name), diagnostic.argument)
    },
    'duplicate-parameter-type': diagnostic => {
      ctx.error(
        actionValidationMessages.duplicateParameterType(action.name, Type.parameterName(diagnostic.parameter)),
        invocation,
      )
    },
    'unknown-named-argument': diagnostic => {
      ctx.error(actionValidationMessages.unknownNamedArgument(action.name, diagnostic.name), diagnostic.argument)
    },
    'duplicate-named-argument': diagnostic => {
      ctx.error(
        actionValidationMessages.duplicateNamedArgument(action.name, Type.parameterName(diagnostic.parameter)),
        diagnostic.argument,
      )
    },
    'named-argument-type': diagnostic => {
      ctx.error(
        actionValidationMessages.namedArgumentType(
          action.name,
          Type.parameterName(diagnostic.parameter),
          Type.displayName(Type.ofParameter(diagnostic.parameter)),
          Type.displayName(Type.ofArgument(diagnostic.argument)),
        ),
        diagnostic.argument,
      )
    },
  })
}

function reportDynamicActionArguments(invocation: AST.DoStatement, ctx: ValidationContext): void {
  const args = AST.argumentsOf(invocation)
  if (args.length > 0) {
    ctx.error(actionValidationMessages.dynamicActionArguments, args[0]!)
  }
}

function validateDoStatementTypes(
  invocation: AST.DoStatement,
  accept: ValidationProblemAcceptor<TaoSpecifics>,
  _services: TaoTypirServices,
): void {
  const actionType = Type.ofExpression(invocation.action)
  if (actionType.kind === 'unresolved') {
    return
  }
  if (actionType.kind !== 'primitive' || actionType.primitive !== 'action') {
    accept({
      languageNode: invocation.action,
      message: actionValidationMessages.doTypeMismatch(Type.displayName(actionType)),
      severity: 'error',
    })
  }
}
