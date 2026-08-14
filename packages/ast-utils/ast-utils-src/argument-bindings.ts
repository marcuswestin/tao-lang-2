import { AST } from '@parser'
import { Type } from './Type'
import {
  bindUnambiguousPairs,
  type MatchGraph,
  matchGraph,
  typesExactlyMatch,
} from './type-binding-matches'

/** RenderInvocationPair declares one resolved render argument-to-parameter pairing. */
export type RenderInvocationPair = {
  argument: AST.Argument
  parameter: AST.ParameterDeclaration
}

export type ArgumentBindingDiagnostic =
  | { kind: 'duplicate-parameter-type'; parameter: AST.ParameterDeclaration; type: string }
  | { kind: 'duplicate-argument-type'; argument: AST.Argument; type: string }
  | { kind: 'unknown-named-argument'; argument: AST.Argument; name: string }
  | { kind: 'duplicate-named-argument'; argument: AST.Argument; parameter: AST.ParameterDeclaration }
  | { kind: 'named-argument-type'; argument: AST.Argument; parameter: AST.ParameterDeclaration }
  | {
    kind: 'ambiguous-argument'
    argument: AST.Argument
    parameters: readonly AST.ParameterDeclaration[]
  }
  | {
    kind: 'ambiguous-parameter'
    parameter: AST.ParameterDeclaration
    arguments: readonly AST.Argument[]
  }
  | { kind: 'unmatched-argument'; argument: AST.Argument }
  | { kind: 'missing-argument'; parameter: AST.ParameterDeclaration }

type ArgumentBindingResult = {
  pairs: RenderInvocationPair[]
  diagnostics: ArgumentBindingDiagnostic[]
}

/** resolveArgumentBindings binds Tao arguments to parameters by exact type and unambiguous lineage. */
export function resolveArgumentBindings(
  declaration: AST.ParameterizedDeclaration,
  invocation:
    | AST.Render
    | AST.DoStatement
    | AST.FunctionCallExpression
    | AST.ContextualPresentStatement
    | AST.AskStatement,
): ArgumentBindingResult {
  const parameters = AST.parametersOf(declaration)
  const args = AST.argumentsOf(invocation)
  const diagnostics: ArgumentBindingDiagnostic[] = []
  const pairs: RenderInvocationPair[] = []
  const remainingParameters = new Set(parameters)
  const remainingArgs = new Set(args)

  bindNamedArguments(remainingArgs, remainingParameters, pairs, diagnostics)
  // Optional parameters are explicit-only for type-based view/action binding. This keeps a
  // defaulted text/number/etc. parameter from competing with an unnamed required parameter.
  for (const parameter of [...remainingParameters]) {
    if (parameter.defaultValue !== undefined) {
      remainingParameters.delete(parameter)
    }
  }
  reportDuplicateParameterTypes([...remainingParameters], diagnostics)
  const duplicateArgumentTypes = reportDuplicateArgumentTypes([...remainingArgs], diagnostics)

  bindArguments(remainingArgs, remainingParameters, pairs, {
    matches: argumentTypesExactlyMatch,
    blockedArgumentTypes: duplicateArgumentTypes,
  })
  bindArguments(remainingArgs, remainingParameters, pairs, {
    matches: argumentTypesAreAssignable,
    blockedArgumentTypes: duplicateArgumentTypes,
  })

  const matchGraph = argumentMatchGraph(remainingArgs, remainingParameters, duplicateArgumentTypes)
  const ambiguousArguments = new Set<AST.Argument>()
  const ambiguousParameters = new Set<AST.ParameterDeclaration>()
  let unresolvedArguments = 0
  for (const argument of remainingArgs) {
    const actualType = Type.ofArgument(argument)
    if (actualType.kind === 'unresolved') {
      unresolvedArguments += 1
      continue
    }
    const argumentType = Type.identityKey(actualType)
    if (argumentType && duplicateArgumentTypes.has(argumentType)) {
      continue
    }
    const matches = matchGraph.targetsByCandidate.get(argument) ?? []
    if (matches.length > 1) {
      diagnostics.push({
        kind: 'ambiguous-argument',
        argument,
        parameters: matches,
      })
      ambiguousArguments.add(argument)
      for (const parameter of matches) {
        ambiguousParameters.add(parameter)
      }
    }
  }
  for (const [parameter, matches] of matchGraph.candidatesByTarget) {
    if (matches.length > 1) {
      diagnostics.push({
        kind: 'ambiguous-parameter',
        parameter,
        arguments: matches,
      })
      ambiguousParameters.add(parameter)
      for (const argument of matches) {
        ambiguousArguments.add(argument)
      }
    }
  }
  for (const argument of remainingArgs) {
    if (ambiguousArguments.has(argument)) {
      continue
    }
    const actualType = Type.ofArgument(argument)
    const argumentType = Type.identityKey(actualType)
    const argumentIsUnmatched = actualType.kind !== 'unresolved'
      && !(argumentType && duplicateArgumentTypes.has(argumentType))
      && !(matchGraph.targetsByCandidate.get(argument)?.length)
    if (argumentIsUnmatched) {
      diagnostics.push({
        kind: 'unmatched-argument',
        argument,
      })
    }
  }

  for (const parameter of remainingParameters) {
    if (ambiguousParameters.has(parameter)) {
      continue
    }
    if (unresolvedArguments > 0) {
      unresolvedArguments -= 1
      continue
    }
    diagnostics.push({
      kind: 'missing-argument',
      parameter,
    })
  }

  return { pairs: pairsByParameterOrder(parameters, pairs), diagnostics }
}

function bindNamedArguments(
  remainingArgs: Set<AST.Argument>,
  remainingParameters: Set<AST.ParameterDeclaration>,
  pairs: RenderInvocationPair[],
  diagnostics: ArgumentBindingDiagnostic[],
): void {
  for (const argument of [...remainingArgs]) {
    const name = argument.label
    if (!name) {
      continue
    }
    const parameter = [...remainingParameters].find(candidate => Type.parameterName(candidate) === name)
    if (!parameter) {
      const declared = pairs.find(pair => Type.parameterName(pair.parameter) === name)?.parameter
      diagnostics.push(
        declared
          ? { kind: 'duplicate-named-argument', argument, parameter: declared }
          : { kind: 'unknown-named-argument', argument, name },
      )
      remainingArgs.delete(argument)
      continue
    }
    const actual = Type.ofArgument(argument)
    const expected = Type.ofParameter(parameter)
    if (
      actual.kind !== 'unresolved'
      && expected.kind !== 'unresolved'
      && !Type.isCastCompatible(actual, expected)
    ) {
      diagnostics.push({ kind: 'named-argument-type', argument, parameter })
    }
    pairs.push({ argument, parameter })
    remainingArgs.delete(argument)
    remainingParameters.delete(parameter)
  }
}

function pairsByParameterOrder(
  parameters: readonly AST.ParameterDeclaration[],
  pairs: readonly RenderInvocationPair[],
): RenderInvocationPair[] {
  // Render/action arguments bind by type, not source position. Return pairs in parameter
  // declaration order so codegen emits props and callback arguments in the callee's order.
  return pairs.toSorted((left, right) => parameters.indexOf(left.parameter) - parameters.indexOf(right.parameter))
}

function reportDuplicateParameterTypes(
  parameters: readonly AST.ParameterDeclaration[],
  diagnostics: ArgumentBindingDiagnostic[],
): void {
  const seen = new Map<string, AST.ParameterDeclaration>()
  for (const parameter of parameters) {
    const key = Type.identityKey(Type.ofParameter(parameter))
    if (!key) {
      continue
    }
    if (seen.has(key)) {
      diagnostics.push({
        kind: 'duplicate-parameter-type',
        parameter,
        type: key,
      })
      continue
    }
    seen.set(key, parameter)
  }
}

function bindArguments(
  remainingArgs: Set<AST.Argument>,
  remainingParameters: Set<AST.ParameterDeclaration>,
  pairs: RenderInvocationPair[],
  { matches, blockedArgumentTypes }: {
    matches: (argument: AST.Argument, parameter: AST.ParameterDeclaration) => boolean
    blockedArgumentTypes: ReadonlySet<string>
  },
): void {
  bindUnambiguousPairs({
    candidates: remainingArgs,
    targets: remainingParameters,
    isCandidateBlocked: argument => {
      const argumentType = Type.identityKey(Type.ofArgument(argument))
      return !!argumentType && blockedArgumentTypes.has(argumentType)
    },
    matches,
    bind: (argument, parameter) => {
      pairs.push({ argument, parameter })
      remainingArgs.delete(argument)
      remainingParameters.delete(parameter)
    },
  })
}

function argumentTypesExactlyMatch(argument: AST.Argument, parameter: AST.ParameterDeclaration): boolean {
  return typesExactlyMatch(Type.ofArgument(argument), Type.ofParameter(parameter))
}

function argumentTypesAreAssignable(argument: AST.Argument, parameter: AST.ParameterDeclaration): boolean {
  return Type.isAssignable(Type.ofArgument(argument), Type.ofParameter(parameter))
}

function argumentMatchGraph(
  remainingArgs: Set<AST.Argument>,
  remainingParameters: Set<AST.ParameterDeclaration>,
  duplicateArgumentTypes: ReadonlySet<string>,
): MatchGraph<AST.Argument, AST.ParameterDeclaration> {
  return matchGraph(
    remainingArgs,
    remainingParameters,
    argument => {
      const type = Type.ofArgument(argument)
      const key = Type.identityKey(type)
      return type.kind === 'unresolved' || (!!key && duplicateArgumentTypes.has(key))
    },
    argumentTypesAreAssignable,
  )
}

function reportDuplicateArgumentTypes(
  args: readonly AST.Argument[],
  diagnostics: ArgumentBindingDiagnostic[],
): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const argument of args) {
    if (argument.label) {
      continue
    }
    const key = Type.identityKey(Type.ofArgument(argument))
    if (!key) {
      continue
    }
    if (seen.has(key)) {
      duplicates.add(key)
      diagnostics.push({
        kind: 'duplicate-argument-type',
        argument,
        type: key,
      })
      continue
    }
    seen.add(key)
  }
  return duplicates
}
