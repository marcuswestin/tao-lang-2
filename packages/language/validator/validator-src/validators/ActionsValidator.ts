import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { FS, Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'
import { AliasesValidator } from './aliases-validator'

/** actionValidationMessages declares action validation diagnostics. */
const actionValidationMessages = {
  duplicateParameter: (name: string, owner: 'action' | 'command' = 'action') =>
    `Parameter '${name}' is declared more than once in this ${owner}.`,
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
  asyncPlacement: '`async` is allowed only inside an action block.',
  foreignActionPath: 'A foreign action implementation path must name a relative TypeScript or TSX module.',
  foreignActionMissing: (path: string) => `Foreign action implementation '${path}' does not exist.`,
  returnNative: '`returns` is allowed only on a foreign action.',
  returnLatest: 'A foreign action with a result cannot use `runs latest`.',
  resultRequired:
    'A result binding requires a foreign action that declares `returns` or a source action with a return value.',
  sourceReturnTypeMismatch: (name: string, expected: string, actual: string) =>
    `Source action '${name}' returns ${actual}, but its result type is ${expected}.`,
  sourceActionMayCompleteWithoutResult: (name: string) =>
    `Source action '${name}' can complete without returning a value.`,
  duplicateResult: (name: string) => `Action result '${name}' is declared more than once in this action block.`,
  runsLatestNative: '`runs latest` is allowed only on a foreign action.',
}

/** ActionsValidator groups action validation and diagnostics. */
export const ActionsValidator = {
  checks: {
    [AST.ActionDeclaration.$type]: (action, ctx) => {
      validateParameters(action, ctx)
      const usesReturnsKeyword = action.returnType !== undefined && AST.keywordRange(action, 'returns') !== undefined
      if (usesReturnsKeyword && !action.foreign) {
        ctx.error(action, actionValidationMessages.returnNative)
      }
      if (action.returnType && action.runsLatest) {
        ctx.error(action, actionValidationMessages.returnLatest)
      }
      if (action.runsLatest && !action.foreign) {
        ctx.error(action, actionValidationMessages.runsLatestNative)
      }
      if (action.foreign) {
        if (!/^\.\.?\/.+\.tsx?$/.test(action.foreign.path)) {
          ctx.error(action.foreign, actionValidationMessages.foreignActionPath)
        }
      } else if (action.block && !usesReturnsKeyword) {
        if (action.returnType) {
          validateSourceActionReturnTypes(action, ctx)
        }
        validateSourceActionCompletion(action, ctx, Boolean(action.returnType))
      }
    },
    [AST.ActionResultStatement.$type]: (statement, ctx) => {
      const action = ASTUtils.resolveActionInvocation(statement.invocation).action
      const hasForeignResult = AST.isActionDeclaration(action) && Boolean(action.foreign && action.returnType)
      const hasSourceResult = AST.isActionDeclaration(action)
        && !action.foreign
        && ASTUtils.sourceActionResult(action, value => value).length > 0
      if (!hasForeignResult && !hasSourceResult) {
        ctx.error(statement, actionValidationMessages.resultRequired)
      }
    },
    [AST.ActionBlock.$type]: (block, ctx) => {
      const seen = new Set(AST.askDeclarationsOwnedByActionBlock(block).map(binding => binding.name))
      for (const binding of AST.actionResultDeclarationsOwnedByActionBlock(block)) {
        if (seen.has(binding.name)) {
          ctx.error(binding, actionValidationMessages.duplicateResult(binding.name))
        }
        seen.add(binding.name)
      }
    },
    [AST.AsyncActionStatement.$type]: (statement, ctx) => {
      if (!AST.findOwningActionBlock(statement)) {
        ctx.error(statement, actionValidationMessages.asyncPlacement)
      }
    },
    [AST.DoStatement.$type]: reportArity,
  } satisfies NodeValidationChecks,
  messages: actionValidationMessages,
  typeChecks: {
    [AST.DoStatement.$type]: reportDoStatementActionType,
  } satisfies NodeValidationChecks,
  validateForeignFiles: validateForeignActionFiles,
  /** validateParameters is shared with commands, whose slots are parameters under the same rules. */
  validateParameters,
} as const

interface SourceActionCompletion {
  mayFallThrough: boolean
  mayStopAtCheck: boolean
}

/** validateSourceActionCompletion rejects successful source-result paths that complete without a value. */
function validateSourceActionCompletion(
  action: AST.ActionDeclaration,
  ctx: ValidationContext,
  requiresResult: boolean,
): void {
  const returns = ASTUtils.sourceActionResult(action, value => value)
  if (returns.length === 0 && !requiresResult) {
    return
  }
  const ownedReturns = new Set(returns.map(result => result.statement))
  const completion = sourceActionCompletion(action.block!.statements, ownedReturns)
  if (completion.mayFallThrough || completion.mayStopAtCheck) {
    ctx.error(action, actionValidationMessages.sourceActionMayCompleteWithoutResult(action.name))
  }
}

/** validateSourceActionReturnTypes checks source arrow annotations against actual owned returns. */
function validateSourceActionReturnTypes(action: AST.ActionDeclaration, ctx: ValidationContext): void {
  if (!action.returnType) {
    return
  }
  const expected = Type.ofTypeExpression(action.returnType)
  if (expected.kind === 'unresolved') {
    return
  }
  for (const result of ASTUtils.sourceActionResult(action, value => Type.ofExpression(value))) {
    if (result.type.kind !== 'unresolved' && !Type.isAssignable(result.type, expected)) {
      ctx.error(
        result.value,
        actionValidationMessages.sourceReturnTypeMismatch(
          action.name,
          Type.displayName(expected),
          Type.displayName(result.type),
        ),
      )
    }
  }
}

/** sourceActionCompletion follows sequential returns and literal-true action branches conservatively. */
function sourceActionCompletion(
  statements: readonly AST.ActionStatement[],
  ownedReturns: ReadonlySet<AST.ReturnStatement>,
): SourceActionCompletion {
  let mayFallThrough = true
  let mayStopAtCheck = false

  for (const statement of statements) {
    if (!mayFallThrough) {
      break
    }
    if (
      !AST.isReturnStatement(statement) && !AST.isFailStatement(statement)
      && !AST.isCheckStatement(statement) && !AST.isIfActionStatement(statement)
    ) {
      continue
    }
    Switch.type(statement, {
      ReturnStatement: returned => {
        if (ownedReturns.has(returned)) {
          mayFallThrough = false
        }
      },
      FailStatement: () => {
        mayFallThrough = false
      },
      CheckStatement: checked => {
        if (AST.isBooleanLiteral(checked.condition) && checked.condition.value === 'true') {
          return
        }
        mayFallThrough = false
        mayStopAtCheck = true
      },
      IfActionStatement: conditional => {
        const literal = AST.isBooleanLiteral(conditional.condition) ? conditional.condition.value : undefined
        if (literal === 'false') {
          return
        }
        const branch = sourceActionCompletion(conditional.block.statements, ownedReturns)
        mayStopAtCheck ||= branch.mayStopAtCheck
        // A dynamic condition leaves its false path open.
        mayFallThrough = literal === 'true' ? branch.mayFallThrough : true
      },
    })
  }

  return { mayFallThrough, mayStopAtCheck }
}

async function validateForeignActionFiles(file: AST.TaoFile, ctx: ValidationContext): Promise<void> {
  for (const action of AST.streamAllContents(file).filter(AST.isActionDeclaration)) {
    const foreign = action.foreign
    if (!foreign || !/^\.\.?\/.+\.tsx?$/.test(foreign.path)) {
      continue
    }
    const documentDirectory = FS.resolvePath(FS.dirname(AST.getDocument(foreign).uri.path))
    if (
      await FS.isDirectory(documentDirectory)
      && !await FS.exists(FS.resolvePath(foreign.path, documentDirectory))
    ) {
      ctx.error(foreign, actionValidationMessages.foreignActionMissing(foreign.path))
    }
  }
}

type ParameterOwner = AST.ActionDeclaration | AST.CommandDeclaration

function validateParameters(owner: ParameterOwner, ctx: ValidationContext): void {
  validateDuplicateParameters(owner, ctx)
  validateParameterNameConflicts(owner, ctx)
}

function validateDuplicateParameters(owner: ParameterOwner, ctx: ValidationContext): void {
  const seen = new Set<string>()
  const kind = AST.isCommandDeclaration(owner) ? 'command' : 'action'
  for (const parameter of AST.parametersOf(owner)) {
    const name = Type.parameterName(parameter)
    if (seen.has(name)) {
      ctx.error(parameter, actionValidationMessages.duplicateParameter(name, kind))
      continue
    }
    seen.add(name)
  }
}

function validateParameterNameConflicts(owner: ParameterOwner, ctx: ValidationContext): void {
  const visibleNames = visibleActionParameterConflictNames(owner)
  for (const parameter of AST.parametersOf(owner)) {
    const name = Type.parameterName(parameter)
    if (visibleNames.has(name)) {
      ctx.error(parameter, AliasesValidator.messages.duplicateName(name))
    }
  }
}

function visibleActionParameterConflictNames(action: ParameterOwner): Set<string> {
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

/** A command is invoked as an action is, so `do Finish(Document)` gets the same diagnostics. */
function reportArity(invocation: AST.DoStatement, ctx: ValidationContext): void {
  const resolved = ASTUtils.resolveActionInvocation(invocation)
  if (!resolved.action) {
    validateDynamicActionInvocation(invocation, ctx)
    return
  }

  for (const diagnostic of resolved.diagnostics) {
    reportActionBindingDiagnostic(resolved.action, diagnostic, invocation, ctx)
  }
}

/** reportActionBindingDiagnostic shares named, typed, and arity diagnostics with command invocations. */
export function reportActionBindingDiagnostic(
  action: AST.ActionDeclaration | AST.CommandDeclaration,
  diagnostic: ASTUtils.ArgumentBindingDiagnostic,
  invocation: AST.DoStatement | AST.CommandDoClause,
  ctx: ValidationContext,
): void {
  Switch.kind(diagnostic, {
    'missing-argument': diagnostic => {
      ctx.error(
        invocation,
        actionValidationMessages.missingArgument(action.name, Type.parameterName(diagnostic.parameter)),
      )
    },
    'unmatched-argument': diagnostic => {
      ctx.error(diagnostic.argument, actionValidationMessages.unmatchedArgument(action.name))
    },
    'ambiguous-argument': diagnostic => {
      ctx.error(
        diagnostic.argument,
        actionValidationMessages.ambiguousArgument(action.name, diagnostic.parameters),
      )
    },
    'ambiguous-parameter': diagnostic => {
      ctx.error(
        invocation,
        actionValidationMessages.ambiguousParameter(action.name, Type.parameterName(diagnostic.parameter)),
      )
    },
    'duplicate-argument-type': diagnostic => {
      ctx.error(diagnostic.argument, actionValidationMessages.duplicateArgumentType(action.name))
    },
    'duplicate-parameter-type': diagnostic => {
      ctx.error(
        invocation,
        actionValidationMessages.duplicateParameterType(action.name, Type.parameterName(diagnostic.parameter)),
      )
    },
    'unknown-named-argument': diagnostic => {
      ctx.error(diagnostic.argument, actionValidationMessages.unknownNamedArgument(action.name, diagnostic.name))
    },
    'duplicate-named-argument': diagnostic => {
      ctx.error(
        diagnostic.argument,
        actionValidationMessages.duplicateNamedArgument(action.name, Type.parameterName(diagnostic.parameter)),
      )
    },
    'named-argument-type': diagnostic => {
      ctx.error(
        diagnostic.argument,
        actionValidationMessages.namedArgumentType(
          action.name,
          Type.parameterName(diagnostic.parameter),
          Type.displayName(Type.ofParameter(diagnostic.parameter)),
          Type.displayName(Type.ofArgument(diagnostic.argument)),
        ),
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
    ctx.error(args[0]!, actionValidationMessages.dynamicActionArguments)
    return
  }
  const requiredCount = actionType.parameters.filter(parameter => !parameter.optional).length
  if (args.length < requiredCount || args.length > actionType.parameters.length) {
    const message = requiredCount === actionType.parameters.length
      ? actionValidationMessages.dynamicActionArity(actionType.parameters.length, args.length)
      : actionValidationMessages.dynamicActionArgumentCount(requiredCount, actionType.parameters.length, args.length)
    ctx.error(invocation, message)
  }
  for (const [index, argument] of args.entries()) {
    if (argument.label) {
      ctx.error(argument, actionValidationMessages.dynamicActionNamedArgument)
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
        argument,
        actionValidationMessages.dynamicActionArgumentType(
          index + 1,
          Type.displayName(parameter.type),
          Type.displayName(actual),
        ),
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
    ctx.error(invocation.action, actionValidationMessages.doTypeMismatch(Type.displayName(actionType)))
  }
}
