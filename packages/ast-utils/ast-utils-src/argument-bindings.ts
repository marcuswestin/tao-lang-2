import { AST } from '@parser'
import { Type } from './Type'
import {
  bindUnambiguousPairs,
  type MatchGraph,
  matchGraph,
  reportDuplicateCandidateTypes,
  reportDuplicateTargetTypes,
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

type ArgumentBindingState = {
  diagnostics: ArgumentBindingDiagnostic[]
  pairs: RenderInvocationPair[]
  remainingArgs: Set<AST.Argument>
  remainingParameters: Set<AST.ParameterDeclaration>
}

type ArgumentMatchAnalysis = {
  ambiguousArguments: Set<AST.Argument>
  ambiguousParameters: Set<AST.ParameterDeclaration>
  duplicateArgumentTypes: ReadonlySet<string>
  graph: MatchGraph<AST.Argument, AST.ParameterDeclaration>
  unresolvedArguments: number
}

/** resolveArgumentBindings binds Tao arguments to parameters by exact type and unambiguous lineage. */
export function resolveArgumentBindings(
  declaration: AST.ParameterizedDeclaration,
  invocation:
    | AST.Render
    | AST.DoStatement
    | AST.CommandDeclaration
    | AST.FunctionCallExpression
    | AST.ContextualPresentStatement
    | AST.ViewBinding
    | AST.AskStatement,
): ArgumentBindingResult {
  const parameters = AST.parametersOf(declaration)
  const args = AST.argumentsOf(invocation)
  const state: ArgumentBindingState = {
    diagnostics: [],
    pairs: [],
    remainingParameters: new Set(parameters),
    remainingArgs: new Set(args),
  }
  bindNamedArguments(state)
  const duplicateArgumentTypes = bindTypedArguments(state)
  const analysis = analyzeRemainingArguments(state, duplicateArgumentTypes)
  reportAmbiguousParameters(state, analysis)
  reportRemainingArgumentBindings(state, analysis)
  return { pairs: pairsByParameterOrder(parameters, state.pairs), diagnostics: state.diagnostics }
}

function bindTypedArguments(state: ArgumentBindingState): Set<string> {
  // Optional parameters are explicit-only for type-based view/action binding. This keeps a
  // defaulted text/number/etc. parameter from competing with an unnamed required parameter.
  for (const parameter of [...state.remainingParameters]) {
    if (parameter.defaultValue !== undefined) {
      state.remainingParameters.delete(parameter)
    }
  }
  reportDuplicateParameterTypes([...state.remainingParameters], state.diagnostics)
  const duplicateArgumentTypes = reportDuplicateArgumentTypes([...state.remainingArgs], state.diagnostics)
  bindArguments(state, {
    matches: argumentTypesExactlyMatch,
    blockedArgumentTypes: duplicateArgumentTypes,
  })
  bindArguments(state, {
    matches: argumentTypesAreAssignable,
    blockedArgumentTypes: duplicateArgumentTypes,
  })
  return duplicateArgumentTypes
}

function analyzeRemainingArguments(
  state: ArgumentBindingState,
  duplicateArgumentTypes: ReadonlySet<string>,
): ArgumentMatchAnalysis {
  const graph = argumentMatchGraph(state.remainingArgs, state.remainingParameters, duplicateArgumentTypes)
  const ambiguousArguments = new Set<AST.Argument>()
  const ambiguousParameters = new Set<AST.ParameterDeclaration>()
  let unresolvedArguments = 0
  for (const argument of state.remainingArgs) {
    const actualType = Type.ofArgument(argument)
    if (actualType.kind === 'unresolved') {
      unresolvedArguments += 1
      continue
    }
    const argumentType = Type.identityKey(actualType)
    if (argumentType && duplicateArgumentTypes.has(argumentType)) {
      continue
    }
    const matches = graph.targetsByCandidate.get(argument) ?? []
    if (matches.length > 1) {
      state.diagnostics.push({
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
  return { ambiguousArguments, ambiguousParameters, duplicateArgumentTypes, graph, unresolvedArguments }
}

function reportAmbiguousParameters(state: ArgumentBindingState, analysis: ArgumentMatchAnalysis): void {
  for (const [parameter, matches] of analysis.graph.candidatesByTarget) {
    if (matches.length > 1) {
      state.diagnostics.push({
        kind: 'ambiguous-parameter',
        parameter,
        arguments: matches,
      })
      analysis.ambiguousParameters.add(parameter)
      for (const argument of matches) {
        analysis.ambiguousArguments.add(argument)
      }
    }
  }
}

function reportRemainingArgumentBindings(state: ArgumentBindingState, analysis: ArgumentMatchAnalysis): void {
  for (const argument of state.remainingArgs) {
    if (analysis.ambiguousArguments.has(argument)) {
      continue
    }
    const actualType = Type.ofArgument(argument)
    const argumentType = Type.identityKey(actualType)
    const argumentIsUnmatched = actualType.kind !== 'unresolved'
      && !(argumentType && analysis.duplicateArgumentTypes.has(argumentType))
      && !(analysis.graph.targetsByCandidate.get(argument)?.length)
    if (argumentIsUnmatched) {
      state.diagnostics.push({
        kind: 'unmatched-argument',
        argument,
      })
    }
  }
  for (const parameter of state.remainingParameters) {
    if (analysis.ambiguousParameters.has(parameter)) {
      continue
    }
    if (analysis.unresolvedArguments > 0) {
      analysis.unresolvedArguments -= 1
      continue
    }
    state.diagnostics.push({
      kind: 'missing-argument',
      parameter,
    })
  }
}

function bindNamedArguments(state: ArgumentBindingState): void {
  for (const argument of [...state.remainingArgs]) {
    const name = argument.label
    if (!name) {
      continue
    }
    const parameter = [...state.remainingParameters].find(candidate => Type.parameterName(candidate) === name)
    if (!parameter) {
      const declared = state.pairs.find(pair => Type.parameterName(pair.parameter) === name)?.parameter
      state.diagnostics.push(
        declared
          ? { kind: 'duplicate-named-argument', argument, parameter: declared }
          : { kind: 'unknown-named-argument', argument, name },
      )
      state.remainingArgs.delete(argument)
      continue
    }
    const actual = Type.ofArgument(argument)
    const expected = Type.ofParameter(parameter)
    if (
      actual.kind !== 'unresolved'
      && expected.kind !== 'unresolved'
      && !Type.isAssignable(actual, expected)
    ) {
      state.diagnostics.push({ kind: 'named-argument-type', argument, parameter })
    }
    state.pairs.push({ argument, parameter })
    state.remainingArgs.delete(argument)
    state.remainingParameters.delete(parameter)
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
  reportDuplicateTargetTypes(
    parameters,
    parameter => Type.identityKey(Type.ofParameter(parameter)),
    (parameter, type) =>
      diagnostics.push({
        kind: 'duplicate-parameter-type',
        parameter,
        type,
      }),
  )
}

function bindArguments(
  state: ArgumentBindingState,
  { matches, blockedArgumentTypes }: {
    matches: (argument: AST.Argument, parameter: AST.ParameterDeclaration) => boolean
    blockedArgumentTypes: ReadonlySet<string>
  },
): void {
  bindUnambiguousPairs({
    candidates: state.remainingArgs,
    targets: state.remainingParameters,
    isCandidateBlocked: argument => {
      const argumentType = Type.identityKey(Type.ofArgument(argument))
      return !!argumentType && blockedArgumentTypes.has(argumentType)
    },
    matches,
    bind: (argument, parameter) => {
      state.pairs.push({ argument, parameter })
      state.remainingArgs.delete(argument)
      state.remainingParameters.delete(parameter)
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
  return reportDuplicateCandidateTypes(
    args,
    argument => !!argument.label,
    argument => Type.identityKey(Type.ofArgument(argument)),
    (argument, type) =>
      diagnostics.push({
        kind: 'duplicate-argument-type',
        argument,
        type,
      }),
  )
}
