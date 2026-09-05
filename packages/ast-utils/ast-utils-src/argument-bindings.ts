import { AST } from '@parser'
import { Switch } from '@shared'
import { Type } from './Type'
import { type BindingDiagnostic, resolveBindings } from './type-binding-matches'

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
    | AST.AppView
    | AST.DoStatement
    | AST.CommandDoClause
    | AST.FunctionCallExpression
    | AST.ContextualPresentStatement
    | AST.ViewBinding
    | AST.AskStatement,
): ArgumentBindingResult {
  const resolution = resolveBindings<AST.Argument, AST.ParameterDeclaration>({
    candidates: AST.argumentsOf(invocation),
    targets: AST.parametersOf(declaration),
    candidateLabel: argument => argument.label,
    targetName: parameter => Type.parameterName(parameter),
    candidateType: argument => Type.ofArgument(argument),
    targetType: parameter => Type.ofParameter(parameter),
    namedTypeAccepts: (actual, expected) => Type.isAssignable(actual, expected),
    afterNamedBinding: ({ remainingTargets }) => {
      // Optional parameters are explicit-only for type-based view/action binding. This keeps a
      // defaulted text/number/etc. parameter from competing with an unnamed required parameter.
      for (const parameter of [...remainingTargets]) {
        if (parameter.defaultValue !== undefined) {
          remainingTargets.delete(parameter)
        }
      }
    },
    unresolvedCandidatesExcuseMissing: true,
  })
  return {
    pairs: resolution.pairs.map(([argument, parameter]) => ({ argument, parameter })),
    diagnostics: resolution.diagnostics.map(argumentDiagnostic),
  }
}

function argumentDiagnostic(
  diagnostic: BindingDiagnostic<AST.Argument, AST.ParameterDeclaration>,
): ArgumentBindingDiagnostic {
  return Switch.kind<BindingDiagnostic<AST.Argument, AST.ParameterDeclaration>, ArgumentBindingDiagnostic>(diagnostic, {
    'duplicate-target-type': ({ target, type }) => ({ kind: 'duplicate-parameter-type', parameter: target, type }),
    'duplicate-candidate-type': ({ candidate, type }) => ({
      kind: 'duplicate-argument-type',
      argument: candidate,
      type,
    }),
    'unknown-named': ({ candidate, name }) => ({ kind: 'unknown-named-argument', argument: candidate, name }),
    'duplicate-named': ({ candidate, target }) => ({
      kind: 'duplicate-named-argument',
      argument: candidate,
      parameter: target,
    }),
    'named-type': ({ candidate, target }) => ({ kind: 'named-argument-type', argument: candidate, parameter: target }),
    'ambiguous-candidate': ({ candidate, targets }) => ({
      kind: 'ambiguous-argument',
      argument: candidate,
      parameters: targets,
    }),
    'ambiguous-target': ({ target, candidates }) => ({
      kind: 'ambiguous-parameter',
      parameter: target,
      arguments: candidates,
    }),
    unmatched: ({ candidate }) => ({ kind: 'unmatched-argument', argument: candidate }),
    missing: ({ target }) => ({ kind: 'missing-argument', parameter: target }),
  })
}
