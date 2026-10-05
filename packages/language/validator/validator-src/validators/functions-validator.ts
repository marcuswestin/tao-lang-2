import { ASTUtils, Type } from '@ast-utils'
import { AST } from '@parser'
import { Switch } from '@shared'
import type { NodeValidationChecks } from '../node-validation'
import type { ValidationContext } from '../validation'

const messages = {
  duplicateParameter: (name: string) => `Parameter '${name}' is declared more than once in this function.`,
  duplicateGenericParameter: (name: string) => `Type parameter '${name}' is declared more than once in this function.`,
  uninferredGeneric: (name: string, parameter: string) =>
    `Function '${name}' needs a typed input to infer type parameter '${parameter}'.`,
  incompatibleGeneric: (name: string, parameter: string) =>
    `Function '${name}' cannot infer type parameter '${parameter}' from these inputs within all its bounds.`,
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
    [AST.AssociatedFunctionDeclaration.$type]: validateFunction,
    [AST.FunctionCallExpression.$type]: validateFunctionCall,
  } satisfies NodeValidationChecks,
  messages,
  reportBindingDiagnostics,
} as const

function validateFunction(
  fn: AST.FunctionDeclaration | AST.AssociatedFunctionDeclaration,
  ctx: ValidationContext,
): void {
  if (AST.isFunctionDeclaration(fn) && !AST.isTaoFile(fn.$container)) {
    ctx.error(fn, messages.functionPlacement)
  }
  const seen = new Set<string>()
  for (const parameter of fn.genericParameters) {
    if (seen.has(parameter.name)) {
      ctx.error(parameter, messages.duplicateGenericParameter(parameter.name))
    }
    seen.add(parameter.name)
  }
  seen.clear()
  for (const parameter of AST.parametersOf(fn)) {
    const name = Type.parameterName(parameter)
    if (seen.has(name)) {
      ctx.error(parameter, messages.duplicateParameter(name))
    }
    seen.add(name)
  }
  if (!AST.functionHasFallthroughReturn(fn)) {
    ctx.error(fn.block, messages.functionMissingReturn(fn.name))
  }
  const returns = AST.returnStatementsOf(fn)
  if (fn.returnType) {
    validateExplicitReturnType(fn, returns, ctx)
  } else {
    validateInferredReturnType(fn, returns, ctx)
  }
}

function validateExplicitReturnType(
  fn: AST.FunctionDeclaration | AST.AssociatedFunctionDeclaration,
  returns: readonly AST.ReturnStatement[],
  ctx: ValidationContext,
): void {
  const expected = Type.ofTypeExpression(fn.returnType!)
  if (expected.kind === 'unresolved') {
    return
  }
  for (const statement of returns) {
    const actual = Type.ofExpression(statement.value)
    if (actual.kind !== 'unresolved' && !Type.isAssignable(actual, expected)) {
      ctx.error(
        statement.value,
        messages.functionReturn(fn.name, Type.displayName(expected), Type.displayName(actual)),
      )
    }
  }
}

function validateInferredReturnType(
  fn: AST.FunctionDeclaration | AST.AssociatedFunctionDeclaration,
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
        statement.value,
        messages.functionReturnInference(fn.name, Type.displayName(inferred), Type.displayName(actual)),
      )
      return
    }
    inferred = common
  }
}

function validateFunctionCall(call: AST.FunctionCallExpression, ctx: ValidationContext): void {
  const resolved = ASTUtils.resolveFunctionInvocation(call)
  const fn = resolved.function
  // A call shares its one shape with a phrase call (Decisions §14); phrases-validator owns those.
  if (!fn || !AST.isFunctionDeclaration(fn)) {
    return
  }
  reportBindingDiagnostics(
    call,
    fn.name,
    resolved.diagnostics,
    ctx,
    parameter => resolved.parameterTypes?.get(parameter) ?? Type.ofParameter(parameter),
  )
  for (const diagnostic of resolved.genericDiagnostics ?? []) {
    Switch.kind(diagnostic, {
      'uninferred-generic': value => ctx.error(call, messages.uninferredGeneric(fn.name, value.parameter.name)),
      'incompatible-generic': value => ctx.error(call, messages.incompatibleGeneric(fn.name, value.parameter.name)),
    })
  }
}

/** Ordinary and associated calls report the same shared argument binder's diagnostics. */
function reportBindingDiagnostics(
  call: AST.FunctionCallExpression | AST.MethodCallExpression,
  name: string,
  diagnostics: readonly ASTUtils.ArgumentBindingDiagnostic[],
  ctx: ValidationContext,
  expectedType: (parameter: AST.ParameterDeclaration) => ASTUtils.TaoType = Type.ofParameter,
): void {
  for (const diagnostic of diagnostics) {
    Switch.kind(diagnostic, {
      'missing-argument': diagnostic => {
        ctx.error(call, messages.functionMissingArgument(name, Type.parameterName(diagnostic.parameter)))
      },
      'unmatched-argument': diagnostic => {
        ctx.error(diagnostic.argument, messages.functionUnmatchedArgument(name))
      },
      'ambiguous-argument': diagnostic => {
        ctx.error(diagnostic.argument, messages.functionAmbiguousArgument(name, diagnostic.parameters))
      },
      'ambiguous-parameter': diagnostic => {
        ctx.error(call, messages.functionAmbiguousParameter(name, Type.parameterName(diagnostic.parameter)))
      },
      'duplicate-argument-type': diagnostic => {
        ctx.error(diagnostic.argument, messages.functionDuplicateArgumentType(name))
      },
      'duplicate-parameter-type': diagnostic => {
        ctx.error(call, messages.functionDuplicateParameterType(name, Type.parameterName(diagnostic.parameter)))
      },
      'unknown-named-argument': diagnostic => {
        ctx.error(diagnostic.argument, messages.functionUnknownLabel(name, diagnostic.name))
      },
      'duplicate-named-argument': diagnostic => {
        ctx.error(
          diagnostic.argument,
          messages.functionDuplicateLabel(name, Type.parameterName(diagnostic.parameter)),
        )
      },
      'named-argument-type': diagnostic => {
        ctx.error(
          diagnostic.argument,
          messages.functionLabelType(
            name,
            Type.parameterName(diagnostic.parameter),
            Type.displayName(expectedType(diagnostic.parameter)),
            Type.displayName(Type.ofArgument(diagnostic.argument)),
          ),
        )
      },
    })
  }
}
