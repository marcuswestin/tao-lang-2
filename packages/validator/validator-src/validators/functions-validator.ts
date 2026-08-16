import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

const messages = {
  duplicateParameter: (name: string) => `Parameter '${name}' is declared more than once in this function.`,
  functionMissingArgument: (name: string, parameter: string) =>
    `Function '${name}' is missing argument for parameter '${parameter}'.`,
  functionUnmatchedArgument: (name: string) =>
    `Function '${name}' has an argument that does not match any unbound parameter by type.`,
  functionAmbiguousArgument: (name: string, parameters: readonly AST.ParameterDeclaration[]) =>
    `Function '${name}' has an argument that matches multiple parameters by type: ${
      parameters.map(Type.parameterName).join(', ')
    }.`,
  functionAmbiguousParameter: (name: string, parameter: string) =>
    `Function '${name}' has multiple arguments that match parameter '${parameter}' by type.`,
  functionDuplicateParameterType: (name: string, parameter: string) =>
    `Function '${name}' has more than one parameter with the same type near '${parameter}'.`,
  functionDuplicateArgumentType: (name: string) =>
    `Function '${name}' has more than one argument with the same exact type.`,
  functionUnknownLabel: (name: string, label: string) =>
    `Function '${name}' has no parameter named '${label}'; labels resolve only the invoked owner's parameters, not visible types.`,
  functionDuplicateLabel: (name: string, label: string) =>
    `Function '${name}' receives parameter '${label}' more than once.`,
  functionLabelType: (name: string, label: string, expected: string, actual: string) =>
    `Labeled argument '${label}:' of function '${name}' expects ${expected}, got ${actual}.`,
  functionPlacement: 'Pure functions must be declared at file level.',
  functionMissingReturn: (name: string) => `Function '${name}' must end with a return so every path produces a value.`,
  functionReturn: (name: string, expected: string, actual: string) =>
    `Function '${name}' returns ${expected}, but a return produces ${actual}.`,
  functionReturnInference: (name: string, expected: string, actual: string) =>
    `Function '${name}' cannot infer one return type from ${expected} and ${actual}.`,
} as const

export const FunctionsValidator = {
  checks: {
    [AST.FunctionDeclaration.$type]: validateFunction,
    [AST.FunctionCallExpression.$type]: validateFunctionCall,
  } satisfies NodeValidationChecks,
  messages,
} as const

function validateFunction(fn: AST.FunctionDeclaration, ctx: ValidationContext): void {
  if (!AST.isTaoFile(fn.$container)) {
    ctx.error(messages.functionPlacement, fn)
  }
  const seen = new Set<string>()
  for (const parameter of AST.parametersOf(fn)) {
    const name = Type.parameterName(parameter)
    if (seen.has(name)) {
      ctx.error(messages.duplicateParameter(name), parameter)
    }
    seen.add(name)
  }
  if (!AST.functionHasFallthroughReturn(fn)) {
    ctx.error(messages.functionMissingReturn(fn.name), fn.block)
  }
  const returns = AST.returnStatementsOf(fn)
  if (fn.returnType) {
    validateExplicitReturnType(fn, returns, ctx)
  } else {
    validateInferredReturnType(fn, returns, ctx)
  }
}

function validateExplicitReturnType(
  fn: AST.FunctionDeclaration,
  returns: readonly AST.ReturnStatement[],
  ctx: ValidationContext,
): void {
  const expected = Type.ofReference(fn.returnType!)
  if (expected.kind === 'unresolved') {
    return
  }
  for (const statement of returns) {
    const actual = Type.ofExpression(statement.value)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
      ctx.error(
        messages.functionReturn(fn.name, Type.displayName(expected), Type.displayName(actual)),
        statement.value,
      )
    }
  }
}

function validateInferredReturnType(
  fn: AST.FunctionDeclaration,
  returns: readonly AST.ReturnStatement[],
  ctx: ValidationContext,
): void {
  let inferred: ReturnType<typeof Type.ofExpression> | undefined
  for (const statement of returns) {
    const actual = Type.ofExpression(statement.value)
    if (actual.kind === 'unresolved') {
      continue
    }
    if (!inferred) {
      inferred = actual
      continue
    }
    const common = Type.commonType([inferred, actual])
    if (!common) {
      ctx.error(
        messages.functionReturnInference(fn.name, Type.displayName(inferred), Type.displayName(actual)),
        statement.value,
      )
      return
    }
    inferred = common
  }
}

function validateFunctionCall(call: AST.FunctionCallExpression, ctx: ValidationContext): void {
  const resolved = ASTUtils.resolveFunctionInvocation(call)
  const fn = resolved.function
  if (!fn) {
    return
  }
  for (const diagnostic of resolved.diagnostics) {
    Switch.kind(diagnostic, {
      'missing-argument': diagnostic => {
        ctx.error(messages.functionMissingArgument(fn.name, Type.parameterName(diagnostic.parameter)), call)
      },
      'unmatched-argument': diagnostic => {
        ctx.error(messages.functionUnmatchedArgument(fn.name), diagnostic.argument)
      },
      'ambiguous-argument': diagnostic => {
        ctx.error(messages.functionAmbiguousArgument(fn.name, diagnostic.parameters), diagnostic.argument)
      },
      'ambiguous-parameter': diagnostic => {
        ctx.error(messages.functionAmbiguousParameter(fn.name, Type.parameterName(diagnostic.parameter)), call)
      },
      'duplicate-argument-type': diagnostic => {
        ctx.error(messages.functionDuplicateArgumentType(fn.name), diagnostic.argument)
      },
      'duplicate-parameter-type': diagnostic => {
        ctx.error(messages.functionDuplicateParameterType(fn.name, Type.parameterName(diagnostic.parameter)), call)
      },
      'unknown-named-argument': diagnostic => {
        ctx.error(messages.functionUnknownLabel(fn.name, diagnostic.name), diagnostic.argument)
      },
      'duplicate-named-argument': diagnostic => {
        ctx.error(
          messages.functionDuplicateLabel(fn.name, Type.parameterName(diagnostic.parameter)),
          diagnostic.argument,
        )
      },
      'named-argument-type': diagnostic => {
        ctx.error(
          messages.functionLabelType(
            fn.name,
            Type.parameterName(diagnostic.parameter),
            Type.displayName(Type.ofParameter(diagnostic.parameter)),
            Type.displayName(Type.ofArgument(diagnostic.argument)),
          ),
          diagnostic.argument,
        )
      },
    })
  }
}
