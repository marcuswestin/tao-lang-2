import { AST } from '@parser'
import { type TaoType, Type } from './Type'
import type { DataEntityDefinition, DataFieldDefinition } from './Type'
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

/** RenderEventBindingPair declares one explicit control event bound to its action-valued parameter. */
export type RenderEventBindingPair = {
  handler: AST.EventHandler
  parameter: AST.ParameterDeclaration
}

/** ImplicitChangeBinding declares the writable state synthesized for an omitted Change handler. */
export type ImplicitChangeBinding = {
  parameter: AST.ParameterDeclaration
  state: AST.StateDeclaration
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

export type DataWriteBindingPair = {
  write: AST.DataWriteField
  field: DataFieldDefinition
}

export type DataWriteBindingDiagnostic =
  | { kind: 'duplicate-field-type'; field: DataFieldDefinition; type: string }
  | { kind: 'duplicate-write-type'; write: AST.DataWriteField; type: string }
  | { kind: 'unknown-named-field'; write: AST.DataWriteField; name: string }
  | { kind: 'duplicate-named-field'; write: AST.DataWriteField; field: DataFieldDefinition }
  | { kind: 'named-field-type'; write: AST.DataWriteField; field: DataFieldDefinition }
  | { kind: 'ambiguous-write'; write: AST.DataWriteField; fields: readonly DataFieldDefinition[] }
  | { kind: 'ambiguous-data-field'; field: DataFieldDefinition; writes: readonly AST.DataWriteField[] }
  | { kind: 'unmatched-write'; write: AST.DataWriteField }
  | { kind: 'missing-data-field'; field: DataFieldDefinition }

export type DataWriteBindingResult = {
  pairs: DataWriteBindingPair[]
  diagnostics: DataWriteBindingDiagnostic[]
}

/** ResolvedRenderInvocation declares the semantic shape of a render invocation. */
export type ResolvedRenderInvocation = {
  render: AST.Render
  view?: AST.RenderableDeclaration
  pairs: RenderInvocationPair[]
  diagnostics: ArgumentBindingDiagnostic[]
  eventPairs: RenderEventBindingPair[]
  implicitChange?: ImplicitChangeBinding
  eventDiagnostics: RenderEventBindingDiagnostic[]
}

/** ResolvedActionInvocation declares the semantic shape of an action invocation. */
export type ResolvedActionInvocation = {
  invocation: AST.DoStatement
  action?: AST.ActionDeclaration
  pairs: ActionInvocationPair[]
  diagnostics: ArgumentBindingDiagnostic[]
}

/** ResolvedFunctionInvocation declares one pure-function call and its owner-bound arguments. */
export type ResolvedFunctionInvocation = {
  invocation: AST.FunctionCallExpression
  function?: AST.FunctionDeclaration
  pairs: RenderInvocationPair[]
  diagnostics: ArgumentBindingDiagnostic[]
}

/** ResolvedActionTarget declares how an expression resolves as an action target. */
export type ResolvedActionTarget =
  | { kind: 'named'; action: AST.ActionDeclaration }
  | { kind: 'dynamic' }
  | { kind: 'unresolved' }

/** resolveDataWriteBindings binds create/update values to the target entity's fields by label or type. */
export function resolveDataWriteBindings(
  entity: DataEntityDefinition,
  writes: readonly AST.DataWriteField[],
  requireAll: boolean,
): DataWriteBindingResult {
  const fields = Type.dataFields(entity).filter(field => Type.dataFieldType(field).kind !== 'list')
  const diagnostics: DataWriteBindingDiagnostic[] = []
  const pairs: DataWriteBindingPair[] = []
  const remainingFields = new Set(fields)
  const remainingWrites = new Set(writes)

  bindNamedDataWriteFields(remainingWrites, remainingFields, pairs, diagnostics)
  bindBooleanCaseDataWriteFields(remainingWrites, remainingFields, pairs)
  // Defaulted fields may be omitted and are not eligible for unlabeled type binding. They can
  // still be written explicitly by label, while boolean cases bind by declaration identity above.
  for (const field of remainingFields) {
    if (hasDataFieldDefault(field)) {
      remainingFields.delete(field)
    }
  }
  if (remainingWrites.size > 0) {
    reportDuplicateDataFieldTypes([...remainingFields], diagnostics)
  }
  const duplicateWriteTypes = reportDuplicateWriteTypes([...remainingWrites], diagnostics)
  bindDataWriteFields(remainingWrites, remainingFields, pairs, dataWriteTypesExactlyMatch, duplicateWriteTypes)
  bindDataWriteFields(remainingWrites, remainingFields, pairs, dataWriteTypesAreAssignable, duplicateWriteTypes)

  const graph = dataWriteMatchGraph(remainingWrites, remainingFields, duplicateWriteTypes)
  const ambiguousWrites = new Set<AST.DataWriteField>()
  const ambiguousFields = new Set<DataFieldDefinition>()
  for (const write of remainingWrites) {
    const actual = Type.ofExpression(write.value)
    if (actual.kind === 'unresolved') {
      continue
    }
    const key = Type.identityKey(actual)
    if (key && duplicateWriteTypes.has(key)) {
      continue
    }
    const matches = graph.targetsByCandidate.get(write) ?? []
    if (matches.length > 1) {
      diagnostics.push({ kind: 'ambiguous-write', write, fields: matches })
      ambiguousWrites.add(write)
      matches.forEach(field => ambiguousFields.add(field))
    }
  }
  for (const [field, matches] of graph.candidatesByTarget) {
    if (matches.length > 1) {
      diagnostics.push({ kind: 'ambiguous-data-field', field, writes: matches })
      ambiguousFields.add(field)
      matches.forEach(write => ambiguousWrites.add(write))
    }
  }
  for (const write of remainingWrites) {
    if (ambiguousWrites.has(write)) {
      continue
    }
    const actual = Type.ofExpression(write.value)
    const key = Type.identityKey(actual)
    const writeIsUnmatched = actual.kind !== 'unresolved'
      && !(key && duplicateWriteTypes.has(key))
      && !(graph.targetsByCandidate.get(write)?.length)
    if (writeIsUnmatched) {
      diagnostics.push({ kind: 'unmatched-write', write })
    }
  }
  if (requireAll) {
    for (const field of remainingFields) {
      if (!ambiguousFields.has(field) && !hasDataFieldDefault(field)) {
        diagnostics.push({ kind: 'missing-data-field', field })
      }
    }
  }

  return {
    pairs: pairs.toSorted((left, right) => fields.indexOf(left.field) - fields.indexOf(right.field)),
    diagnostics,
  }
}

function bindBooleanCaseDataWriteFields(
  writes: Set<AST.DataWriteField>,
  fields: Set<DataFieldDefinition>,
  pairs: DataWriteBindingPair[],
): void {
  for (const write of [...writes]) {
    if (!AST.isValueReference(write.value) || !AST.isEntityDataField(write.value.target.ref)) {
      continue
    }
    const field = write.value.target.ref
    if (!fields.has(field)) {
      continue
    }
    pairs.push({ write, field })
    writes.delete(write)
    fields.delete(field)
  }
}

function hasDataFieldDefault(field: DataFieldDefinition): boolean {
  return field.boolean
    || field.modifiers.some(modifier => modifier.defaultValue !== undefined || modifier.defaultCase !== undefined)
}

/** resolveRenderInvocation resolves a render target and type-based argument bindings. */
export function resolveRenderInvocation(render: AST.Render): ResolvedRenderInvocation {
  const view = render.view?.ref
  if (!view) {
    return {
      render,
      pairs: [],
      diagnostics: [],
      eventPairs: [],
      eventDiagnostics: [],
    }
  }

  const bindings = resolveArgumentBindings(view, render)
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
  }
}

function resolveRenderEventBindings(
  render: AST.Render,
  view: AST.RenderableDeclaration,
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

  const implicitChange = resolveImplicitChangeBinding(render, view, argumentPairs, pairs, diagnostics)
  return { pairs, implicitChange, diagnostics }
}

function resolveImplicitChangeBinding(
  render: AST.Render,
  view: AST.RenderableDeclaration,
  argumentPairs: readonly RenderInvocationPair[],
  eventPairs: readonly RenderEventBindingPair[],
  diagnostics: RenderEventBindingDiagnostic[],
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
  const state = valuePair.argument.label === 'Value' && AST.isValueReference(value)
    ? value.target.ref
    : undefined
  const valueType = Type.ofExpression(value)
  if (
    state
    && AST.isStateDeclaration(state)
    && valueType.kind === 'primitive'
    && valueType.primitive === 'text'
  ) {
    return { parameter: changeParameter, state }
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

function parameterSupportsEvent(parameter: AST.ParameterDeclaration, event: AST.EventName): boolean {
  const type = Type.ofParameter(parameter)
  if (type.kind !== 'primitive' || type.primitive !== 'action') {
    return false
  }
  if (event === 'change') {
    const input = type.parameters[0]
    return type.parameters.length === 1
      && input !== undefined
      && !input.optional
      && input.type.kind === 'primitive'
      && input.type.primitive === 'text'
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
    pairs: bindings.pairs,
    diagnostics: bindings.diagnostics,
  }
}

/** resolveFunctionInvocation resolves a pure function call through the shared owner binder. */
export function resolveFunctionInvocation(invocation: AST.FunctionCallExpression): ResolvedFunctionInvocation {
  const fn = invocation.function.ref
  if (!fn) {
    return { invocation, pairs: [], diagnostics: [] }
  }
  const bindings = resolveArgumentBindings(fn, invocation)
  return {
    invocation,
    function: fn,
    pairs: bindings.pairs,
    diagnostics: bindings.diagnostics,
  }
}

/** resolveActionTarget classifies an expression used as a Tao action value. */
export function resolveActionTarget(expression: AST.Expression | undefined): ResolvedActionTarget {
  return resolveActionTargetWithSeenAliases(expression, new Set())
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

  bindArguments(remainingArgs, remainingParameters, pairs, argumentTypesExactlyMatch, duplicateArgumentTypes)
  bindArguments(remainingArgs, remainingParameters, pairs, argumentTypesAreAssignable, duplicateArgumentTypes)

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

function bindNamedDataWriteFields(
  remainingWrites: Set<AST.DataWriteField>,
  remainingFields: Set<DataFieldDefinition>,
  pairs: DataWriteBindingPair[],
  diagnostics: DataWriteBindingDiagnostic[],
): void {
  for (const write of [...remainingWrites]) {
    const name = write.label
    if (!name) {
      continue
    }
    const field = [...remainingFields].find(candidate => candidate.name === name)
    if (!field) {
      const declared = pairs.find(pair => pair.field.name === name)?.field
      diagnostics.push(
        declared
          ? { kind: 'duplicate-named-field', write, field: declared }
          : { kind: 'unknown-named-field', write, name },
      )
      remainingWrites.delete(write)
      continue
    }
    const actual = Type.ofExpression(write.value)
    const expected = Type.dataFieldType(field)
    if (
      actual.kind !== 'unresolved'
      && expected.kind !== 'unresolved'
      && !Type.isCastCompatible(actual, expected)
    ) {
      diagnostics.push({ kind: 'named-field-type', write, field })
    }
    pairs.push({ write, field })
    remainingWrites.delete(write)
    remainingFields.delete(field)
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
  matches: (argument: AST.Argument, parameter: AST.ParameterDeclaration) => boolean,
  blockedArgumentTypes: ReadonlySet<string> = new Set(),
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

function bindDataWriteFields(
  remainingWrites: Set<AST.DataWriteField>,
  remainingFields: Set<DataFieldDefinition>,
  pairs: DataWriteBindingPair[],
  matches: (write: AST.DataWriteField, field: DataFieldDefinition) => boolean,
  blockedWriteTypes: ReadonlySet<string>,
): void {
  bindUnambiguousPairs({
    candidates: remainingWrites,
    targets: remainingFields,
    isCandidateBlocked: write => {
      const key = Type.identityKey(Type.ofExpression(write.value))
      return !!key && blockedWriteTypes.has(key)
    },
    matches,
    bind: (write, field) => {
      pairs.push({ write, field })
      remainingWrites.delete(write)
      remainingFields.delete(field)
    },
  })
}

function argumentTypesExactlyMatch(argument: AST.Argument, parameter: AST.ParameterDeclaration): boolean {
  return typesExactlyMatch(Type.ofArgument(argument), Type.ofParameter(parameter))
}

function argumentTypesAreAssignable(argument: AST.Argument, parameter: AST.ParameterDeclaration): boolean {
  return Type.isAssignable(Type.ofArgument(argument), Type.ofParameter(parameter))
}

function dataWriteTypesExactlyMatch(write: AST.DataWriteField, field: DataFieldDefinition): boolean {
  return typesExactlyMatch(Type.ofExpression(write.value), Type.dataFieldType(field))
}

function dataWriteTypesAreAssignable(write: AST.DataWriteField, field: DataFieldDefinition): boolean {
  return Type.isAssignable(Type.ofExpression(write.value), Type.dataFieldType(field))
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

function dataWriteMatchGraph(
  remainingWrites: Set<AST.DataWriteField>,
  remainingFields: Set<DataFieldDefinition>,
  duplicateWriteTypes: ReadonlySet<string>,
): MatchGraph<AST.DataWriteField, DataFieldDefinition> {
  return matchGraph(
    remainingWrites,
    remainingFields,
    write => {
      const type = Type.ofExpression(write.value)
      const key = Type.identityKey(type)
      return type.kind === 'unresolved' || (!!key && duplicateWriteTypes.has(key))
    },
    dataWriteTypesAreAssignable,
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

function reportDuplicateDataFieldTypes(
  fields: readonly DataFieldDefinition[],
  diagnostics: DataWriteBindingDiagnostic[],
): void {
  const seen = new Map<string, DataFieldDefinition>()
  for (const field of fields) {
    const key = Type.identityKey(Type.dataFieldType(field))
    if (!key) {
      continue
    }
    if (seen.has(key)) {
      diagnostics.push({ kind: 'duplicate-field-type', field, type: key })
      continue
    }
    seen.set(key, field)
  }
}

function reportDuplicateWriteTypes(
  writes: readonly AST.DataWriteField[],
  diagnostics: DataWriteBindingDiagnostic[],
): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const write of writes) {
    if (write.label) {
      continue
    }
    const key = Type.identityKey(Type.ofExpression(write.value))
    if (!key) {
      continue
    }
    if (seen.has(key)) {
      duplicates.add(key)
      diagnostics.push({ kind: 'duplicate-write-type', write, type: key })
      continue
    }
    seen.add(key)
  }
  return duplicates
}

const UnresolvedActionTarget: ResolvedActionTarget = { kind: 'unresolved' }

function resolveActionTargetWithSeenAliases(
  expression: AST.Expression | undefined,
  seenAliases: Set<AST.AliasDeclaration>,
): ResolvedActionTarget {
  if (!expression) {
    return UnresolvedActionTarget
  }
  if (AST.isActionExpression(expression)) {
    return { kind: 'dynamic' }
  }
  if (AST.isValueReference(expression)) {
    return resolveActionTargetReference(expression, seenAliases)
  }
  const type = Type.ofExpression(expression)
  if (type.kind === 'primitive' && type.primitive === 'action') {
    return { kind: 'dynamic' }
  }
  return UnresolvedActionTarget
}

function resolveActionTargetReference(
  reference: AST.ValueReference,
  seenAliases: Set<AST.AliasDeclaration>,
): ResolvedActionTarget {
  const target = reference.target.ref
  if (!target) {
    return UnresolvedActionTarget
  }
  if (AST.isActionDeclaration(target)) {
    return { kind: 'named', action: target }
  }
  if (AST.isAliasDeclaration(target)) {
    return resolveAliasActionTarget(target, seenAliases)
  }
  if (AST.isParameterDeclaration(target)) {
    return parameterAcceptsAction(target) ? { kind: 'dynamic' } : UnresolvedActionTarget
  }
  return UnresolvedActionTarget
}

function resolveAliasActionTarget(
  target: AST.AliasDeclaration,
  seenAliases: Set<AST.AliasDeclaration>,
): ResolvedActionTarget {
  if (seenAliases.has(target)) {
    return UnresolvedActionTarget
  }
  seenAliases.add(target)
  return AST.isExpression(target.value)
    ? resolveActionTargetWithSeenAliases(target.value, seenAliases)
    : UnresolvedActionTarget
}

function parameterAcceptsAction(parameter: AST.ParameterDeclaration): boolean {
  const type = Type.ofParameter(parameter)
  return type.kind === 'primitive' && type.primitive === 'action'
}
