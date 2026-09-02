import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { FS, Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { AliasesValidator } from './aliases-validator'

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
    `Labeled argument '${name}:' of action ${action} expects ${expected}, got ${actual}.`,
  dynamicActionArguments: 'Action callback declared as action() cannot receive arguments.',
  dynamicActionArity: (expected: number, actual: number) =>
    `Action callback expects ${expected} argument${expected === 1 ? '' : 's'}, got ${actual}.`,
  dynamicActionArgumentCount: (minimum: number, maximum: number, actual: number) =>
    `Action callback expects ${minimum} to ${maximum} arguments, got ${actual}.`,
  dynamicActionArgumentType: (position: number, expected: string, actual: string) =>
    `Argument ${position} of action callback expects ${expected}, got ${actual}.`,
  dynamicActionNamedArgument: 'Action callback arguments are positional and cannot use a parameter name.',
  doTypeMismatch: (actual: string) => `do expects an action, got ${actual}.`,
  doActionCall: 'do runs an action with its call parentheses; a bare name runs a command.',
  asyncPlacement: '`async` is allowed only inside an action block.',
  foreignActionPath: 'A foreign action implementation path must name a relative TypeScript or TSX module.',
  foreignActionMissing: (path: string) => `Foreign action implementation '${path}' does not exist.`,
  runsLatestNative: '`runs latest` is allowed only on a foreign action.',
}

/** ActionsValidator groups action validation and diagnostics. */
export const ActionsValidator = {
  checks: {
    [AST.ActionDeclaration.$type]: (action, ctx) => {
      validateDuplicateParameters(action, ctx)
      validateParameterNameConflicts(action, ctx)
      if (action.runsLatest && !action.foreign) {
        ctx.error(actionValidationMessages.runsLatestNative, action)
      }
      if (action.foreign) {
        if (!/^\.\.?\/.+\.tsx?$/.test(action.foreign.path)) {
          ctx.error(actionValidationMessages.foreignActionPath, action.foreign)
        }
      }
    },
    [AST.AsyncActionStatement.$type]: (statement, ctx) => {
      if (!AST.findOwningActionBlock(statement)) {
        ctx.error(actionValidationMessages.asyncPlacement, statement)
      }
    },
    [AST.DoStatement.$type]: reportArity,
  } satisfies NodeValidationChecks,
  messages: actionValidationMessages,
  typeChecks: {
    [AST.DoStatement.$type]: reportDoStatementActionType,
  } satisfies NodeValidationChecks,
  validateForeignFiles: validateForeignActionFiles,
} as const

async function validateForeignActionFiles(file: AST.TaoFile, ctx: ValidationContext): Promise<void> {
  for (const action of AST.streamAllContents(file).filter(AST.isActionDeclaration)) {
    const foreign = action.foreign
    if (!foreign || !/^\.\.?\/.+\.tsx?$/.test(foreign.path)) {
      continue
    }
    const documentDirectory = FS.dirname(AST.getDocument(foreign).uri.path)
    if (
      await FS.isDirectory(documentDirectory)
      && !await FS.exists(FS.resolvePath(foreign.path, documentDirectory))
    ) {
      ctx.error(actionValidationMessages.foreignActionMissing(foreign.path), foreign)
    }
  }
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
  if (ASTUtils.resolveCommandBinding(invocation.action)) {
    return
  }
  if (!invocation.called) {
    ctx.error(actionValidationMessages.doActionCall, invocation)
    return
  }
  const resolved = ASTUtils.resolveActionInvocation(invocation)
  if (!resolved.action) {
    validateDynamicActionInvocation(invocation, ctx)
    return
  }

  for (const diagnostic of resolved.diagnostics) {
    reportActionBindingDiagnostic(resolved.action, diagnostic, invocation, ctx)
  }
}

/** reportActionBindingDiagnostic shares named, typed, and arity diagnostics with bound commands. */
export function reportActionBindingDiagnostic(
  action: AST.ActionDeclaration,
  diagnostic: ASTUtils.ArgumentBindingDiagnostic,
  invocation: AST.DoStatement | AST.CommandDoClause,
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

function validateDynamicActionInvocation(invocation: AST.DoStatement, ctx: ValidationContext): void {
  const actionType = Type.ofExpression(invocation.action)
  if (actionType.kind !== 'primitive' || actionType.primitive !== 'action') {
    return
  }
  const args = AST.argumentsOf(invocation)
  if (actionType.parameters.length === 0 && args.length > 0) {
    ctx.error(actionValidationMessages.dynamicActionArguments, args[0]!)
    return
  }
  const requiredCount = actionType.parameters.filter(parameter => !parameter.optional).length
  if (args.length < requiredCount || args.length > actionType.parameters.length) {
    const message = requiredCount === actionType.parameters.length
      ? actionValidationMessages.dynamicActionArity(actionType.parameters.length, args.length)
      : actionValidationMessages.dynamicActionArgumentCount(requiredCount, actionType.parameters.length, args.length)
    ctx.error(message, invocation)
  }
  for (const [index, argument] of args.entries()) {
    if (argument.label) {
      ctx.error(actionValidationMessages.dynamicActionNamedArgument, argument)
      continue
    }
    const parameter = actionType.parameters[index]
    if (!parameter) {
      continue
    }
    const actual = Type.ofArgument(argument)
    if (
      actual.kind !== 'unresolved'
      && parameter.type.kind !== 'unresolved'
      && !Type.isAssignable(actual, parameter.type)
    ) {
      ctx.error(
        actionValidationMessages.dynamicActionArgumentType(
          index + 1,
          Type.displayName(parameter.type),
          Type.displayName(actual),
        ),
        argument,
      )
    }
  }
}

/** reportDoStatementActionType requires `do` to invoke an action- or command-typed expression. */
function reportDoStatementActionType(invocation: AST.DoStatement, ctx: ValidationContext): void {
  const actionType = Type.ofExpression(invocation.action)
  if (actionType.kind === 'unresolved') {
    return
  }
  const runnable = actionType.kind === 'primitive'
    && (actionType.primitive === 'action' || actionType.primitive === 'command')
  if (!runnable) {
    ctx.error(actionValidationMessages.doTypeMismatch(Type.displayName(actionType)), invocation.action)
  }
}
