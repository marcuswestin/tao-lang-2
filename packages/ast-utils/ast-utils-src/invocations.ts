import { AST } from '@parser'
import { Switch } from '@shared'

/** RenderInvocationPair declares one positional render argument-to-parameter pairing. */
export type InvocationPair = {
  argument: AST.Argument
  parameter: AST.ParameterDeclaration
}

/** RenderInvocationPair declares one positional render argument-to-parameter pairing. */
export type RenderInvocationPair = InvocationPair

/** ResolvedRenderInvocation declares the semantic shape of a render invocation. */
export type ResolvedRenderInvocation = {
  render: AST.Render
  view?: AST.RenderableDeclaration
  pairs: RenderInvocationPair[]
}

/** ActionInvocationPair declares one positional action argument-to-parameter pairing. */
export type ActionInvocationPair = InvocationPair

/** ResolvedActionInvocation declares the semantic shape of an action invocation. */
export type ResolvedActionInvocation = {
  invocation: AST.DoStatement
  action?: AST.ActionDeclaration
  pairs: ActionInvocationPair[]
}

/** ResolvedActionTarget declares how an expression resolves as an action target. */
export type ResolvedActionTarget =
  | { kind: 'named'; action: AST.ActionDeclaration }
  | { kind: 'dynamic' }
  | { kind: 'unresolved' }

/** InvocationArity declares the lists and matched-pair count used for arity diagnostics. */
export type InvocationArity = {
  parameters: readonly AST.ParameterDeclaration[]
  pairCount: number
  args: readonly AST.Argument[]
}

type InvocationWithPairs = {
  pairs: readonly InvocationPair[]
}

type InvocationInputs = Omit<InvocationArity, 'pairCount'>

type ParameterListOwner = {
  parameterList?: AST.ParameterList
}

type ArgumentListOwner = {
  argumentList?: AST.ArgumentList
}

/** resolveRenderInvocation resolves a render target and positional argument bindings. */
export function resolveRenderInvocation(render: AST.Render): ResolvedRenderInvocation {
  const view = render.view?.ref
  if (!view) {
    return { render, pairs: [] }
  }

  const inputs = invocationInputs(view, render)
  const pairs = pairInvocationArguments(inputs)
  return { render, view, pairs }
}

/** resolveActionInvocation resolves a named action call and positional argument bindings. */
export function resolveActionInvocation(invocation: AST.DoStatement): ResolvedActionInvocation {
  const target = resolveActionTarget(invocation.action)
  if (target.kind !== 'named') {
    return { invocation, pairs: [] }
  }

  const inputs = invocationInputs(target.action, invocation)
  const pairs = pairInvocationArguments(inputs)
  return { invocation, action: target.action, pairs }
}

/** invocationArity returns the argument, parameter, and matched-pair counts for an invocation. */
export function invocationArity(
  invocation: InvocationWithPairs,
  target: ParameterListOwner,
  source: ArgumentListOwner,
): InvocationArity {
  const { parameters, args } = invocationInputs(target, source)
  const pairCount = invocation.pairs.length
  return { parameters, pairCount, args }
}

/** resolveActionTarget classifies an expression used as a Tao action value. */
export function resolveActionTarget(expression: AST.Expression | undefined): ResolvedActionTarget {
  return resolveActionTargetWithSeenAliases(expression, new Set())
}

function invocationInputs(target: ParameterListOwner, source: ArgumentListOwner): InvocationInputs {
  return {
    parameters: target.parameterList?.parameters ?? [],
    args: source.argumentList?.arguments ?? [],
  }
}

function pairInvocationArguments({ parameters, args }: InvocationInputs): InvocationPair[] {
  const pairCount = Math.min(parameters.length, args.length)
  return parameters.slice(0, pairCount).map((parameter, index) => ({
    argument: args[index]!,
    parameter,
  }))
}

const UnresolvedActionTarget: ResolvedActionTarget = { kind: 'unresolved' }
function resolveActionTargetWithSeenAliases(
  expression: AST.Expression | undefined,
  seenAliases = new Set<AST.AliasDeclaration>(),
): ResolvedActionTarget {
  if (!expression) {
    return UnresolvedActionTarget
  }
  return Switch.type(expression, {
    ActionExpression: () => ({ kind: 'dynamic' }),
    NumberLiteral: () => ({ kind: 'unresolved' }),
    StringLiteral: () => ({ kind: 'unresolved' }),
    ValueReference: valueReference => resolveActionTargetReference(valueReference, seenAliases),
  })
}

function resolveActionTargetReference(
  reference: AST.ValueReference,
  seenAliases: Set<AST.AliasDeclaration>,
): ResolvedActionTarget {
  if (!reference.target.ref) {
    return UnresolvedActionTarget
  }
  return Switch.type(reference.target.ref, {
    ActionDeclaration: action => ({ kind: 'named', action }),
    AliasDeclaration: alias => resolveAliasActionTarget(alias, seenAliases),
    ParameterDeclaration: parameter => parameter.type === 'action' ? { kind: 'dynamic' } : { kind: 'unresolved' },
    StateDeclaration: () => ({ kind: 'unresolved' }),
  })
}

function resolveAliasActionTarget(
  target: AST.AliasDeclaration,
  seenAliases: Set<AST.AliasDeclaration>,
): ResolvedActionTarget {
  if (seenAliases.has(target)) {
    return { kind: 'unresolved' }
  }
  seenAliases.add(target)
  return resolveActionTargetWithSeenAliases(target.value, seenAliases)
}
