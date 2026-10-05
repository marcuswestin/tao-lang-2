import { AST } from '@parser'
import {
  type ArgumentBindingDiagnostic,
  type ArgumentBindingMetadata,
  type RenderInvocationPair,
  resolveArgumentBindings,
} from './argument-bindings'
import type { AssociatedMethodReceiver } from './associated-methods'
import { writableExpression } from './reactive-parameters'
import { type TaoType, Type } from './Type'

/** RenderEventBindingPair declares one explicit control event bound to its action-valued parameter. */
export type RenderEventBindingPair = {
  handler: AST.EventHandler
  parameter: AST.ParameterDeclaration
}

/** ImplicitChangeBinding declares the writable state synthesized for an omitted Change handler. */
export type ImplicitChangeBinding = {
  parameter: AST.ParameterDeclaration
  value: AST.Expression
}

export type RenderEventBindingDiagnostic =
  | { kind: 'duplicate-event'; handler: AST.EventHandler }
  | { kind: 'unsupported-event'; handler: AST.EventHandler; parameter?: AST.ParameterDeclaration }
  | {
    kind: 'event-argument-conflict'
    handler: AST.EventHandler
    argument: AST.Argument
    parameter: AST.ParameterDeclaration
  }
  | {
    kind: 'event-action-type'
    handler: AST.EventHandler
    parameter: AST.ParameterDeclaration
    actual: TaoType
  }
  | { kind: 'unexpected-event-payload'; handler: AST.EventHandler }
  | {
    kind: 'implicit-change-target'
    render: AST.Render
    parameter: AST.ParameterDeclaration
    valueArgument: AST.Argument
  }

/** ActionInvocationPair declares one resolved action argument-to-parameter pairing. */
export type ActionInvocationPair = RenderInvocationPair

/** ResolvedRenderInvocation declares the semantic shape of a render invocation. */
export type ResolvedRenderInvocation = {
  render: AST.Render
  view?: AST.ViewDeclaration
  pairs: RenderInvocationPair[]
  diagnostics: ArgumentBindingDiagnostic[]
  eventPairs: RenderEventBindingPair[]
  implicitChange?: ImplicitChangeBinding
  eventDiagnostics: RenderEventBindingDiagnostic[]
  parameterTypes?: ReadonlyMap<AST.ParameterDeclaration, TaoType>
  transportTypes?: ReadonlyMap<AST.ParameterDeclaration, TaoType>
  result?: TaoType
  bindings?: ReturnType<typeof Type.instantiateGenericInvocation>['bindings']
  genericDiagnostics?: ReturnType<typeof Type.instantiateGenericInvocation>['genericDiagnostics']
}

/** ResolvedActionInvocation declares the semantic shape of an action invocation. */
export type ResolvedActionInvocation = {
  invocation: AST.DoStatement
  action?: AST.ActionDeclaration | AST.CommandDeclaration
  associated?: AssociatedActionReceiver
  pairs: ActionInvocationPair[]
  diagnostics: ArgumentBindingDiagnostic[]
}

/** Associated action dispatch retains the authored receiver and its actual entity domain. */
type AssociatedActionReceiver = Readonly<{
  receiver: AssociatedMethodReceiver
  domain: TaoType
  owner: AST.EntityDataDeclaration
  cardinality: 'one' | 'many'
}>

/**
 * ResolvedFunctionInvocation declares one call's owner-bound arguments. Its target links to a pure
 * function or a phrase (Decisions §14); both share the one call shape, so callers branch on which
 * declaration kind actually linked.
 */
export type ResolvedFunctionInvocation = {
  invocation: AST.FunctionCallExpression
  function?: AST.CallableDeclaration
  pairs: RenderInvocationPair[]
  diagnostics: ArgumentBindingDiagnostic[]
  parameterTypes?: ReadonlyMap<AST.ParameterDeclaration, TaoType>
  transportTypes?: ReadonlyMap<AST.ParameterDeclaration, TaoType>
  result?: TaoType
  genericDiagnostics?: ReturnType<typeof Type.instantiateGenericInvocation>['genericDiagnostics']
}

/** ResolvedActionTarget declares how an expression resolves as an action target. */
export type ResolvedActionTarget =
  | { kind: 'named'; action: AST.ActionDeclaration | AST.CommandDeclaration; associated?: AssociatedActionReceiver }
  | { kind: 'dynamic' }
  | { kind: 'unresolved' }

/**
 * resolveRenderInvocation resolves a render target and type-based argument bindings. Only a view
 * declaration has parameters to bind; a nav or a parameter renders as the value it was bound to,
 * and `resolveRenderTarget` is what classifies those.
 */
export function resolveRenderInvocation(
  render: AST.Render,
  metadata?: ArgumentBindingMetadata,
): ResolvedRenderInvocation {
  const view = render.view?.ref
  if (!view || !AST.isViewDeclaration(view)) {
    return {
      render,
      pairs: [],
      diagnostics: [],
      eventPairs: [],
      eventDiagnostics: [],
    }
  }

  const genericView = transparentViewTarget(view)
  const generic = genericView.genericParameters.length > 0
    ? Type.instantiateGenericInvocation(genericView, AST.argumentsOf(render), metadata)
    : undefined
  const bindings = generic ?? resolveArgumentBindings(view, render, metadata)
  const events = resolveRenderEventBindings(render, view, bindings.pairs)
  const satisfiedParameters = new Set([
    ...events.pairs.map(pair => pair.parameter),
    ...(events.implicitChange ? [events.implicitChange.parameter] : []),
    ...events.diagnostics.flatMap(diagnostic =>
      diagnostic.kind === 'implicit-change-target' ? [diagnostic.parameter] : []
    ),
  ])

  return {
    render,
    view,
    pairs: bindings.pairs,
    diagnostics: bindings.diagnostics.filter(diagnostic =>
      diagnostic.kind !== 'missing-argument' || !satisfiedParameters.has(diagnostic.parameter)
    ),
    eventPairs: events.pairs,
    implicitChange: events.implicitChange,
    eventDiagnostics: events.diagnostics,
    ...(generic
      ? {
        parameterTypes: generic.parameterTypes,
        transportTypes: generic.transportTypes,
        result: generic.result,
        bindings: generic.bindings,
        genericDiagnostics: generic.genericDiagnostics,
      }
      : {}),
  }
}

/** Only aliases without their own constraints forward the target's generic declaration. */
function transparentViewTarget(view: AST.ViewDeclaration): AST.ViewDeclaration {
  const seen = new Set<AST.ViewDeclaration>()
  let current = view
  while (current.aliasTarget) {
    if (seen.has(current) || current.genericParameters.length > 0) {
      return view
    }
    seen.add(current)
    const target = current.aliasTarget.member.ref
    if (!AST.isViewDeclaration(target)) {
      return view
    }
    current = target
  }
  return current
}

function resolveRenderEventBindings(
  render: AST.Render,
  view: AST.ViewDeclaration,
  argumentPairs: readonly RenderInvocationPair[],
): {
  pairs: RenderEventBindingPair[]
  implicitChange?: ImplicitChangeBinding
  diagnostics: RenderEventBindingDiagnostic[]
} {
  const handlers = AST.statementsOf(render.block).filter(AST.isEventHandler)
  const diagnostics: RenderEventBindingDiagnostic[] = []
  const pairs: RenderEventBindingPair[] = []
  const seenEvents = new Set<AST.EventName>()

  for (const handler of handlers) {
    if (seenEvents.has(handler.event)) {
      diagnostics.push({ kind: 'duplicate-event', handler })
      continue
    }
    seenEvents.add(handler.event)

    const parameterName = eventParameterName(handler.event)
    const parameter = AST.parametersOf(view).find(candidate => Type.parameterName(candidate) === parameterName)
    if (!parameter || !parameterSupportsEvent(parameter, handler.event)) {
      diagnostics.push({ kind: 'unsupported-event', handler, parameter })
      continue
    }

    const argumentPair = argumentPairs.find(pair => pair.parameter === parameter)
    if (argumentPair) {
      diagnostics.push({
        kind: 'event-argument-conflict',
        handler,
        argument: argumentPair.argument,
        parameter,
      })
    }

    if (handler.payload && handler.event !== 'change') {
      diagnostics.push({ kind: 'unexpected-event-payload', handler })
    }

    if (handler.action) {
      const actual = Type.ofExpression(handler.action)
      const expected = Type.ofParameter(parameter)
      if (
        actual.kind !== 'unresolved'
        && expected.kind !== 'unresolved'
        && !Type.isAssignable(actual, expected)
      ) {
        diagnostics.push({ kind: 'event-action-type', handler, parameter, actual })
      }
    }

    pairs.push({ handler, parameter })
  }

  const implicitChange = resolveImplicitChangeBinding(render, view, {
    argumentPairs,
    eventPairs: pairs,
    diagnostics,
  })
  return { pairs, implicitChange, diagnostics }
}

function resolveImplicitChangeBinding(
  render: AST.Render,
  view: AST.ViewDeclaration,
  { argumentPairs, eventPairs, diagnostics }: {
    argumentPairs: readonly RenderInvocationPair[]
    eventPairs: readonly RenderEventBindingPair[]
    diagnostics: RenderEventBindingDiagnostic[]
  },
): ImplicitChangeBinding | undefined {
  const changeParameter = AST.parametersOf(view).find(candidate => Type.parameterName(candidate) === 'Change')
  if (
    !changeParameter
    || !parameterSupportsEvent(changeParameter, 'change')
    || eventPairs.some(pair => pair.parameter === changeParameter)
    || argumentPairs.some(pair => pair.parameter === changeParameter)
  ) {
    return undefined
  }

  const valueParameter = AST.parametersOf(view).find(candidate => Type.parameterName(candidate) === 'Value')
  const valuePair = valueParameter
    ? argumentPairs.find(pair => pair.parameter === valueParameter)
    : undefined
  if (!valuePair) {
    return undefined
  }

  const value = valuePair.argument.value
  if (valueParameter?.mutable || writableExpression(value)) {
    return { parameter: changeParameter, value }
  }

  diagnostics.push({
    kind: 'implicit-change-target',
    render,
    parameter: changeParameter,
    valueArgument: valuePair.argument,
  })
  return undefined
}

function eventParameterName(event: AST.EventName): string {
  return `${event[0]!.toUpperCase()}${event.slice(1)}`
}

const changeEventPayloads: readonly string[] = ['text', 'boolean', 'number', 'time', 'duration']

function parameterSupportsEvent(parameter: AST.ParameterDeclaration, event: AST.EventName): boolean {
  const type = Type.ofParameter(parameter)
  if (type.kind !== 'primitive' || type.primitive !== 'action') {
    return false
  }
  if (event === 'change') {
    // A change reports one scalar the control produced: text from a field, a boolean from a switch,
    // a number from a slider, a time from a date picker, a duration from a length control.
    const input = type.parameters[0]
    return type.parameters.length === 1
      && input !== undefined
      && !input.optional
      && input.type.kind === 'primitive'
      && changeEventPayloads.includes(input.type.primitive)
      && input.type.nominal === undefined
  }
  return type.parameters.length === 0
}

/** resolveActionInvocation resolves a named action call and type-based argument bindings. */
export function resolveActionInvocation(invocation: AST.DoStatement): ResolvedActionInvocation {
  const target = resolveActionTarget(invocation.action)
  if (target.kind !== 'named') {
    return {
      invocation,
      pairs: [],
      diagnostics: [],
    }
  }

  const bindings = resolveArgumentBindings(target.action, invocation)
  return {
    invocation,
    action: target.action,
    ...(target.associated ? { associated: target.associated } : {}),
    pairs: bindings.pairs,
    diagnostics: bindings.diagnostics,
  }
}

/** resolveFunctionInvocation resolves a pure function call through the shared owner binder. */
export function resolveFunctionInvocation(
  invocation: AST.FunctionCallExpression,
  metadata?: ArgumentBindingMetadata,
): ResolvedFunctionInvocation {
  const fn = invocation.function.ref
  if (!fn) {
    return { invocation, pairs: [], diagnostics: [] }
  }
  if (AST.isFunctionDeclaration(fn) && fn.genericParameters.length > 0) {
    return { invocation, function: fn, ...Type.instantiateGenericInvocation(fn, AST.argumentsOf(invocation), metadata) }
  }
  const bindings = resolveArgumentBindings(fn, invocation, metadata)
  return {
    invocation,
    function: fn,
    pairs: bindings.pairs,
    diagnostics: bindings.diagnostics,
  }
}

/** resolveActionTarget classifies an expression used as a Tao action value. */
export function resolveActionTarget(
  expression: AST.Expression | undefined,
  typeOfExpression: (expression: AST.Expression) => TaoType = Type.ofExpression,
): ResolvedActionTarget {
  return resolveActionTargetWithSeenAliases(expression, new Set(), typeOfExpression)
}

const UnresolvedActionTarget: ResolvedActionTarget = { kind: 'unresolved' }

function resolveActionTargetWithSeenAliases(
  expression: AST.Expression | undefined,
  seenAliases: Set<AST.AliasDeclaration>,
  typeOfExpression: (expression: AST.Expression) => TaoType,
): ResolvedActionTarget {
  if (!expression) {
    return UnresolvedActionTarget
  }
  if (AST.isActionExpression(expression)) {
    return { kind: 'dynamic' }
  }
  if (AST.isValueReference(expression)) {
    return resolveActionTargetReference(expression, seenAliases, typeOfExpression)
  }
  const associated = resolveAssociatedActionTarget(
    expression,
    receiver =>
      receiver.kind === 'expression' ? typeOfExpression(receiver.expression) : associatedActionReceiverType(receiver),
  )
  if (associated) {
    return associated
  }
  const type = typeOfExpression(expression)
  if (type.kind === 'primitive' && type.primitive === 'action') {
    return { kind: 'dynamic' }
  }
  return UnresolvedActionTarget
}

/** Select a real associated action using the consumer's context, with no dynamic type fallback. */
export function resolveAssociatedActionTarget(
  expression: AST.Expression,
  receiverType: (receiver: AssociatedMethodReceiver) => TaoType = associatedActionReceiverType,
): { kind: 'named'; action: AST.ActionDeclaration; associated: AssociatedActionReceiver } | undefined {
  let name: string
  let receiver: AssociatedMethodReceiver
  if (AST.isMemberAccessExpression(expression) && expression.shade === undefined && expression.members.length > 0) {
    name = expression.members.at(-1)!
    receiver = { kind: 'member-path', site: expression, members: expression.members.slice(0, -1) }
  } else if (AST.isPostfixMemberAccess(expression)) {
    name = expression.member
    receiver = { kind: 'expression', expression: expression.receiver }
  } else {
    return undefined
  }
  const domain = receiverType(receiver)
  const entity = domain.kind === 'entity' ? domain : domain.kind === 'list' ? domain.element : undefined
  if (entity?.kind !== 'entity' || !AST.isEntityDataDeclaration(entity.entity)) {
    return undefined
  }
  const owner = entity.entity
  const cardinality = domain.kind === 'list' ? 'many' : 'one'
  const action = owner.block.entries.filter(AST.isActionDeclaration).find(declaration => {
    const declared = AST.associatedEntityActionReceiver(declaration)
    return declaration.name === name && declared?.owner === owner && declared.cardinality === cardinality
  })
  return action
    ? { kind: 'named', action, associated: { receiver, domain, owner, cardinality } }
    : undefined
}

function associatedActionReceiverType(receiver: AssociatedMethodReceiver): TaoType {
  return receiver.kind === 'expression'
    ? Type.ofExpression(receiver.expression)
    : Type.atMemberPath(Type.ofReferenceRoot(receiver.site), receiver.members)
}

function resolveActionTargetReference(
  reference: AST.ValueReference,
  seenAliases: Set<AST.AliasDeclaration>,
  typeOfExpression: (expression: AST.Expression) => TaoType,
): ResolvedActionTarget {
  const target = reference.target.ref
  if (!target) {
    return UnresolvedActionTarget
  }
  // A command is invoked exactly as an action is: `do Finish(Document)` binds its arguments to the
  // command's parameters — its slots — through the one binding mechanism.
  if (AST.isActionDeclaration(target) || AST.isCommandDeclaration(target)) {
    return { kind: 'named', action: target }
  }
  if (AST.isAliasDeclaration(target)) {
    return resolveAliasActionTarget(target, seenAliases, typeOfExpression)
  }
  if (AST.isParameterDeclaration(target)) {
    return parameterAcceptsAction(target, () => typeOfExpression(reference))
      ? { kind: 'dynamic' }
      : UnresolvedActionTarget
  }
  return UnresolvedActionTarget
}

function resolveAliasActionTarget(
  target: AST.AliasDeclaration,
  seenAliases: Set<AST.AliasDeclaration>,
  typeOfExpression: (expression: AST.Expression) => TaoType,
): ResolvedActionTarget {
  if (seenAliases.has(target)) {
    return UnresolvedActionTarget
  }
  seenAliases.add(target)
  return AST.isExpression(target.value)
    ? resolveActionTargetWithSeenAliases(target.value, seenAliases, typeOfExpression)
    : UnresolvedActionTarget
}

function parameterAcceptsAction(
  parameter: AST.ParameterDeclaration,
  typeOfParameter: (parameter: AST.ParameterDeclaration) => TaoType,
): boolean {
  const type = typeOfParameter(parameter)
  return type.kind === 'primitive' && type.primitive === 'action'
}
