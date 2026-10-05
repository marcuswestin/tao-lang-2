import { AST } from '@parser'
import { Switch } from '@shared'
import {
  type ArgumentBindingMetadata,
  type ArgumentBindingResult,
  resolveParameterArgumentBindings,
} from './argument-bindings'
import { type TaoType, Type } from './Type'

type GenericCallable = AST.FunctionDeclaration | AST.AssociatedFunctionDeclaration | AST.ViewDeclaration

export type GenericInvocationDiagnostic = Readonly<{
  kind: 'uninferred-generic' | 'incompatible-generic'
  parameter: AST.GenericTypeParameter
  arguments: readonly AST.Argument[]
}>

export type GenericInvocationInstantiation =
  & ArgumentBindingResult
  & Readonly<{
    parameterTypes: ReadonlyMap<AST.ParameterDeclaration, TaoType>
    /** Bounded body contracts retain symbolic identity and concrete contextual Self. */
    transportTypes: ReadonlyMap<AST.ParameterDeclaration, TaoType>
    result: TaoType
    bindings: ReadonlyMap<AST.GenericTypeParameter, TaoType>
    genericDiagnostics: readonly GenericInvocationDiagnostic[]
  }>

type GenericInvocationResolution =
  & ArgumentBindingMetadata
  & Readonly<{
    resultType(declaration: GenericCallable): TaoType
    strictAccepts(actual: TaoType, expected: TaoType): boolean
  }>

/** Inference consumes only real pairs from the ordinary binder, then binds specialized domains. */
export function instantiateGenericInvocation(
  declaration: GenericCallable,
  arguments_: readonly AST.Argument[],
  resolution: GenericInvocationResolution,
): GenericInvocationInstantiation {
  const parameters = AST.parametersOf(declaration)
  const parameterType = resolution.parameterType ?? Type.ofParameter
  const argumentType = resolution.argumentType ?? Type.ofArgument
  const accepts = resolution.accepts ?? Type.isAssignable
  const declared = new Map(parameters.map(parameter => [parameter, parameterType(parameter)]))
  const preliminary = resolveParameterArgumentBindings(parameters, arguments_, {
    ...resolution,
    parameterType: parameter => declared.get(parameter)!,
    accepts: (actual, expected) => {
      const inferred = inferenceDomain(actual, expected, accepts)
      return inferred !== undefined && accepts(actual, inferred)
    },
  })
  const bindings = new Map<AST.GenericTypeParameter, TaoType>()
  const genericDiagnostics: GenericInvocationDiagnostic[] = []
  for (const generic of declaration.genericParameters) {
    const pairs = preliminary.pairs.filter(pair => genericInputs(declared.get(pair.parameter)!, generic).length > 0)
    const supplied = pairs.filter(pair =>
      !rawContextualLiteral(Type.genericRoleConstructor(pair.argument)?.value ?? pair.argument.value)
    )
    const domains = supplied.flatMap(pair =>
      suppliedGenericInputs(argumentType(pair.argument), declared.get(pair.parameter)!, generic)
    )
      .filter(type => type.kind !== 'unresolved')
    const bounds = pairs.flatMap(pair => genericInputs(declared.get(pair.parameter)!, generic))[0]?.genericBounds
      ?? []
    const candidates = domains.filter(candidate =>
      bounds.every(bound => accepts(candidate, bound))
      && domains.every(actual => resolution.strictAccepts(actual, candidate))
    )
    // A common domain must itself have been supplied. No parent, conversion, or default invents it.
    const mostSpecific = candidates.filter(candidate =>
      candidates.every(other => resolution.strictAccepts(candidate, other))
    )
    const identities = new Set(mostSpecific.map(Type.identityKey))
    if (mostSpecific.length > 0 && identities.size === 1 && !identities.has(undefined)) {
      bindings.set(generic, mostSpecific[0]!)
    } else {
      genericDiagnostics.push(Object.freeze({
        kind: domains.length === 0 ? 'uninferred-generic' : 'incompatible-generic',
        parameter: generic,
        arguments: Object.freeze(pairs.map(pair => pair.argument)),
      }))
    }
  }
  const parameterTypes = new Map(parameters.map(parameter => [
    parameter,
    substituteGenericType(declared.get(parameter)!, bindings),
  ]))
  const transportTypes = new Map(parameters.map(parameter => [
    parameter,
    transportDomain(declared.get(parameter)!, bindings),
  ]))
  const resolved = resolveParameterArgumentBindings(parameters, arguments_, {
    ...resolution,
    parameterType: parameter => parameterTypes.get(parameter)!,
  })
  return {
    ...resolved,
    parameterTypes,
    transportTypes,
    bindings,
    genericDiagnostics: Object.freeze(genericDiagnostics),
    result: substituteGenericType(resolution.resultType(declaration), bindings),
  }
}

/** The ordinary binder still checks the full list contract after relaxing bounded elements. */
function inferenceDomain(
  actual: TaoType,
  expected: TaoType,
  accepts: (actual: TaoType, expected: TaoType) => boolean,
): TaoType | undefined {
  if (expected.genericParameter) {
    return (expected.genericBounds ?? []).every(bound => accepts(actual, bound)) ? actual : undefined
  }
  if (expected.kind === 'list' && actual.kind === 'list' && expected.element && actual.element) {
    const element = inferenceDomain(actual.element, expected.element, accepts)
    return element ? { ...expected, element } : undefined
  }
  return expected
}

function genericInputs(type: TaoType, generic: AST.GenericTypeParameter): readonly TaoType[] {
  if (type.genericParameter === generic) {
    return [type]
  }
  return type.kind === 'list' && type.element ? genericInputs(type.element, generic) : []
}

/** Extract supplied element domains only from the real pairs selected by the binder. */
function suppliedGenericInputs(
  actual: TaoType,
  expected: TaoType,
  generic: AST.GenericTypeParameter,
): readonly TaoType[] {
  if (expected.genericParameter === generic) {
    return [actual]
  }
  return expected.kind === 'list' && actual.kind === 'list' && expected.element && actual.element
    ? suppliedGenericInputs(actual.element, expected.element, generic)
    : []
}

/** Substitution retains existing carriers and traverses only their ordinary domain children. */
export function substituteGenericType(
  type: TaoType,
  bindings: ReadonlyMap<AST.GenericTypeParameter, TaoType>,
  receiver?: TaoType,
): TaoType {
  if (type.genericParameter) {
    const binding = bindings.get(type.genericParameter)
    if (binding) {
      return binding
    }
    if (!receiver) {
      return { kind: 'unresolved' }
    }
    const bounds = (type.genericBounds ?? []).map(bound => substituteGenericType(bound, bindings, receiver))
    return bounds.every((bound, index) => bound === type.genericBounds?.[index])
      ? type
      : Object.freeze({ ...type, genericBounds: Object.freeze(bounds) })
  }
  if (type.selfOwner && receiver) {
    return receiver
  }
  const substitute = (child: TaoType) => substituteGenericType(child, bindings, receiver)
  return Switch.kind(type, {
    union: type => {
      const members = type.members.map(substitute)
      return members.every((member, index) => member === type.members[index])
        ? type
        : Object.freeze({ ...type, members: Object.freeze(members) })
    },
    list: type => {
      const element = type.element && substitute(type.element)
      return element === type.element ? type : Object.freeze({ ...type, element })
    },
    primitive: type => {
      if (type.primitive !== 'action') {
        return type
      }
      const parameters = type.parameters.map(parameter => {
        const domain = substitute(parameter.type)
        return domain === parameter.type ? parameter : Object.freeze({ ...parameter, type: domain })
      })
      return parameters.every((parameter, index) => parameter === type.parameters[index])
        ? type
        : Object.freeze({ ...type, parameters: Object.freeze(parameters) })
    },
    item: type => type,
    capability: type => type,
    enum: type => type,
    entity: type => type,
    unresolved: type => type,
  })
}

function transportDomain(type: TaoType, bindings: ReadonlyMap<AST.GenericTypeParameter, TaoType>): TaoType {
  if (type.kind === 'list' && type.element && !type.genericParameter) {
    return Object.freeze({ ...type, element: transportDomain(type.element, bindings) })
  }
  if (!type.genericParameter) {
    return substituteGenericType(type, bindings)
  }
  const receiver = bindings.get(type.genericParameter)
  return Object.freeze({
    ...type,
    ...(receiver ? { genericReceiver: receiver } : {}),
    genericBounds: Object.freeze(
      (type.genericBounds ?? []).map(bound => substituteGenericType(bound, bindings, receiver)),
    ),
  })
}

function rawContextualLiteral(expression: AST.Expression | AST.ConfiguredValue): boolean {
  if (AST.isUnaryExpression(expression)) {
    return rawContextualLiteral(expression.operand)
  }
  return AST.isNumberLiteral(expression) || AST.isStringLiteral(expression) || AST.isInterpolatedString(expression)
    || AST.isBooleanLiteral(expression) || AST.isNoneLiteral(expression) || AST.isListLiteral(expression)
}
