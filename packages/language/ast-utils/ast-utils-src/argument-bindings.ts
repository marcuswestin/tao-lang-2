import { AST } from '@parser'
import { Switch } from '@shared'
import { type TaoType, Type } from './Type'
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

export type ArgumentBindingResult = {
  pairs: RenderInvocationPair[]
  diagnostics: ArgumentBindingDiagnostic[]
}

/** Invocation callers can supply phase-local domains and compatibility without replacing binding. */
export type ArgumentBindingMetadata = {
  argumentLabel?(argument: AST.Argument): string | undefined
  parameterName?(parameter: AST.ParameterDeclaration): string
  parameterType?(parameter: AST.ParameterDeclaration): TaoType
  parameterOmissible?(parameter: AST.ParameterDeclaration): boolean
  argumentType?(argument: AST.Argument): TaoType
  accepts?(actual: TaoType, expected: TaoType): boolean
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
  metadata?: ArgumentBindingMetadata,
): ArgumentBindingResult {
  return resolveParameterArgumentBindings(AST.parametersOf(declaration), AST.argumentsOf(invocation), metadata)
}

/** resolveParameterArgumentBindings shares binding without extracting storage or effect metadata. */
export function resolveParameterArgumentBindings(
  parameters: readonly AST.ParameterDeclaration[],
  arguments_: readonly AST.Argument[],
  metadata: ArgumentBindingMetadata = {},
): ArgumentBindingResult {
  const resolution = resolveBindings<AST.Argument, AST.ParameterDeclaration>({
    candidates: arguments_,
    targets: parameters,
    candidateLabel: argument => {
      if (metadata.argumentLabel) {
        return metadata.argumentLabel(argument)
      }
      const role = Type.genericRoleConstructor(argument)
      return argument.label ?? (role ? Type.parameterName(role.parameter) : undefined)
    },
    targetName: metadata.parameterName ?? Type.parameterName,
    candidateType: metadata.argumentType ?? Type.ofArgument,
    targetType: metadata.parameterType ?? Type.ofParameter,
    namedTypeAccepts: metadata.accepts ?? Type.isAssignable,
    compatibleTypeAccepts: metadata.accepts ?? Type.isAssignable,
    pairAccepts: metadata.accepts
      ? (argument, parameter) =>
        metadata.accepts!(
          (metadata.argumentType ?? Type.ofArgument)(argument),
          (metadata.parameterType ?? Type.ofParameter)(parameter),
        )
      : undefined,
    duplicateTargetTypesOnlyWithCandidates: true,
    afterNamedBinding: ({ remainingTargets }) => {
      // Optional parameters are explicit-only for type-based view/action binding. This keeps a
      // defaulted text/number/etc. parameter from competing with an unnamed required parameter.
      for (const parameter of [...remainingTargets]) {
        if (metadata.parameterOmissible?.(parameter) ?? (parameter.defaultValue !== undefined)) {
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
