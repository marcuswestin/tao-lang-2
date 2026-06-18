import { AST } from '@parser'
import { Type } from './Type'

/** RenderInvocationPair declares one resolved render argument-to-parameter pairing. */
export type RenderInvocationPair = {
  argument: AST.Argument
  parameter: AST.ParameterDeclaration
}

export type ArgumentBindingDiagnostic =
  | { kind: 'duplicate-parameter-type'; parameter: AST.ParameterDeclaration; type: string }
  | { kind: 'duplicate-argument-type'; argument: AST.Argument; type: string }
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

export type ItemPropertyBindingPair = {
  property: AST.ItemProperty
  expected: AST.TypeProperty
}

export type ItemPropertyBindingDiagnostic =
  | { kind: 'duplicate-property-type'; expected: AST.TypeProperty; type: string }
  | { kind: 'duplicate-provided-property-type'; property: AST.ItemProperty; type: string }
  | { kind: 'ambiguous-property'; property: AST.ItemProperty; expected: readonly AST.TypeProperty[] }
  | { kind: 'ambiguous-field'; expected: AST.TypeProperty; properties: readonly AST.ItemProperty[] }
  | { kind: 'unmatched-property'; property: AST.ItemProperty }
  | { kind: 'missing-property'; expected: AST.TypeProperty }

export type ItemPropertyBindingResult = {
  pairs: ItemPropertyBindingPair[]
  diagnostics: ItemPropertyBindingDiagnostic[]
}

type MatchGraph<Candidate, Target> = {
  targetsByCandidate: Map<Candidate, Target[]>
  candidatesByTarget: Map<Target, Candidate[]>
}

/** ResolvedRenderInvocation declares the semantic shape of a render invocation. */
export type ResolvedRenderInvocation = {
  render: AST.Render
  view?: AST.RenderableDeclaration
  pairs: RenderInvocationPair[]
  diagnostics: ArgumentBindingDiagnostic[]
}

/** resolveItemPropertyBindings binds item constructor property values to item type fields by type. */
export function resolveItemPropertyBindings(
  expectedProperties: readonly AST.TypeProperty[],
  properties: readonly AST.ItemProperty[],
): ItemPropertyBindingResult {
  const diagnostics: ItemPropertyBindingDiagnostic[] = []
  const pairs: ItemPropertyBindingPair[] = []
  const remainingExpected = new Set(expectedProperties)
  const remainingProperties = new Set(properties)

  reportDuplicatePropertyTypes(expectedProperties, diagnostics)
  const duplicateProvidedPropertyTypes = reportDuplicateProvidedPropertyTypes(properties, diagnostics)

  bindItemProperties(
    remainingProperties,
    remainingExpected,
    pairs,
    propertyTypesExactlyMatch,
    duplicateProvidedPropertyTypes,
  )
  bindItemProperties(
    remainingProperties,
    remainingExpected,
    pairs,
    propertyTypesAreAssignable,
    duplicateProvidedPropertyTypes,
  )

  const matchGraph = propertyMatchGraph(remainingProperties, remainingExpected, duplicateProvidedPropertyTypes)
  const ambiguousProperties = new Set<AST.ItemProperty>()
  const ambiguousExpected = new Set<AST.TypeProperty>()
  let unresolvedProperties = 0
  for (const property of remainingProperties) {
    const actualType = Type.ofExpression(property.value)
    if (actualType.kind === 'unresolved') {
      unresolvedProperties += 1
      continue
    }
    const propertyKey = Type.identityKey(actualType)
    if (propertyKey && duplicateProvidedPropertyTypes.has(propertyKey)) {
      continue
    }
    const matches = matchGraph.targetsByCandidate.get(property) ?? []
    if (matches.length > 1) {
      diagnostics.push({
        kind: 'ambiguous-property',
        property,
        expected: matches,
      })
      ambiguousProperties.add(property)
      for (const expected of matches) {
        ambiguousExpected.add(expected)
      }
    }
  }
  for (const [expected, matches] of matchGraph.candidatesByTarget) {
    if (matches.length > 1) {
      diagnostics.push({
        kind: 'ambiguous-field',
        expected,
        properties: matches,
      })
      ambiguousExpected.add(expected)
      for (const property of matches) {
        ambiguousProperties.add(property)
      }
    }
  }
  for (const property of remainingProperties) {
    if (ambiguousProperties.has(property)) {
      continue
    }
    const actualType = Type.ofExpression(property.value)
    const propertyKey = Type.identityKey(actualType)
    if (
      actualType.kind !== 'unresolved'
      && !(propertyKey && duplicateProvidedPropertyTypes.has(propertyKey))
      && !(matchGraph.targetsByCandidate.get(property)?.length)
    ) {
      diagnostics.push({
        kind: 'unmatched-property',
        property,
      })
    }
  }

  for (const expected of remainingExpected) {
    if (ambiguousExpected.has(expected)) {
      continue
    }
    if (unresolvedProperties > 0) {
      unresolvedProperties -= 1
      continue
    }
    diagnostics.push({
      kind: 'missing-property',
      expected,
    })
  }

  return { pairs, diagnostics }
}

/** resolveRenderInvocation resolves a render target and type-based argument bindings. */
export function resolveRenderInvocation(render: AST.Render): ResolvedRenderInvocation {
  const view = render.view?.ref
  if (!view) {
    return {
      render,
      pairs: [],
      diagnostics: [],
    }
  }

  const bindings = resolveArgumentBindings(view.parameterList?.parameters ?? [], render.argumentList?.arguments ?? [])

  return {
    render,
    view,
    pairs: bindings.pairs,
    diagnostics: bindings.diagnostics,
  }
}

function reportDuplicatePropertyTypes(
  properties: readonly AST.TypeProperty[],
  diagnostics: ItemPropertyBindingDiagnostic[],
): void {
  const seen = new Map<string, AST.TypeProperty>()
  for (const property of properties) {
    const key = Type.identityKey(Type.ofProperty(property))
    if (!key) {
      continue
    }
    if (seen.has(key)) {
      diagnostics.push({
        kind: 'duplicate-property-type',
        expected: property,
        type: key,
      })
      continue
    }
    seen.set(key, property)
  }
}

/** resolveArgumentBindings binds Tao arguments to parameters by exact type and unambiguous lineage. */
export function resolveArgumentBindings(
  parameters: readonly AST.ParameterDeclaration[],
  args: readonly AST.Argument[],
): ArgumentBindingResult {
  const diagnostics: ArgumentBindingDiagnostic[] = []
  const pairs: RenderInvocationPair[] = []
  const remainingParameters = new Set(parameters)
  const remainingArgs = new Set(args)

  reportDuplicateParameterTypes(parameters, diagnostics)
  const duplicateArgumentTypes = reportDuplicateArgumentTypes(args, diagnostics)

  bindArguments(remainingArgs, remainingParameters, pairs, argumentTypesExactlyMatch, duplicateArgumentTypes)
  bindArguments(remainingArgs, remainingParameters, pairs, argumentTypesAreAssignable, duplicateArgumentTypes)

  const matchGraph = argumentMatchGraph(remainingArgs, remainingParameters, duplicateArgumentTypes)
  const ambiguousArguments = new Set<AST.Argument>()
  const ambiguousParameters = new Set<AST.ParameterDeclaration>()
  let unresolvedArguments = 0
  for (const argument of remainingArgs) {
    const actualType = Type.ofExpression(argument.value)
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
    const actualType = Type.ofExpression(argument.value)
    const argumentType = Type.identityKey(actualType)
    if (
      actualType.kind !== 'unresolved'
      && !(argumentType && duplicateArgumentTypes.has(argumentType))
      && !(matchGraph.targetsByCandidate.get(argument)?.length)
    ) {
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

  return { pairs, diagnostics }
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
      const argumentType = Type.identityKey(Type.ofExpression(argument.value))
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

function bindItemProperties(
  remainingProperties: Set<AST.ItemProperty>,
  remainingExpected: Set<AST.TypeProperty>,
  pairs: ItemPropertyBindingPair[],
  matches: (property: AST.ItemProperty, expected: AST.TypeProperty) => boolean,
  blockedPropertyTypes: ReadonlySet<string> = new Set(),
): void {
  bindUnambiguousPairs({
    candidates: remainingProperties,
    targets: remainingExpected,
    isCandidateBlocked: property => {
      const propertyType = Type.identityKey(Type.ofExpression(property.value))
      return !!propertyType && blockedPropertyTypes.has(propertyType)
    },
    matches,
    bind: (property, expected) => {
      pairs.push({ property, expected })
      remainingProperties.delete(property)
      remainingExpected.delete(expected)
    },
  })
}

function bindUnambiguousPairs<Candidate, Target>(params: {
  candidates: Set<Candidate>
  targets: Set<Target>
  isCandidateBlocked: (candidate: Candidate) => boolean
  matches: (candidate: Candidate, target: Target) => boolean
  bind: (candidate: Candidate, target: Target) => void
}): void {
  let madeProgress = true
  while (madeProgress) {
    madeProgress = false
    const graph = matchGraph(params.candidates, params.targets, params.isCandidateBlocked, params.matches)
    for (const [candidate, targets] of graph.targetsByCandidate) {
      if (targets.length !== 1) {
        continue
      }
      const target = targets[0]!
      if (graph.candidatesByTarget.get(target)?.length !== 1) {
        continue
      }
      params.bind(candidate, target)
      madeProgress = true
    }
  }
}

function matchGraph<Candidate, Target>(
  candidates: Set<Candidate>,
  targets: Set<Target>,
  isCandidateBlocked: (candidate: Candidate) => boolean,
  matches: (candidate: Candidate, target: Target) => boolean,
): MatchGraph<Candidate, Target> {
  const targetsByCandidate = new Map<Candidate, Target[]>()
  const candidatesByTarget = new Map<Target, Candidate[]>()
  for (const candidate of candidates) {
    if (isCandidateBlocked(candidate)) {
      continue
    }
    const matchedTargets = Array.from(targets).filter(target => matches(candidate, target))
    if (matchedTargets.length === 0) {
      continue
    }
    targetsByCandidate.set(candidate, matchedTargets)
    for (const target of matchedTargets) {
      const matchedCandidates = candidatesByTarget.get(target) ?? []
      matchedCandidates.push(candidate)
      candidatesByTarget.set(target, matchedCandidates)
    }
  }
  return { targetsByCandidate, candidatesByTarget }
}

function argumentTypesExactlyMatch(argument: AST.Argument, parameter: AST.ParameterDeclaration): boolean {
  return typesExactlyMatch(Type.ofExpression(argument.value), Type.ofParameter(parameter))
}

function argumentTypesAreAssignable(argument: AST.Argument, parameter: AST.ParameterDeclaration): boolean {
  return Type.isAssignable(Type.ofExpression(argument.value), Type.ofParameter(parameter))
}

function propertyTypesExactlyMatch(property: AST.ItemProperty, expected: AST.TypeProperty): boolean {
  return typesExactlyMatch(Type.ofExpression(property.value), Type.ofProperty(expected))
}

function propertyTypesAreAssignable(property: AST.ItemProperty, expected: AST.TypeProperty): boolean {
  return Type.isAssignable(Type.ofExpression(property.value), Type.ofProperty(expected))
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
      const type = Type.ofExpression(argument.value)
      const key = Type.identityKey(type)
      return type.kind === 'unresolved' || (!!key && duplicateArgumentTypes.has(key))
    },
    argumentTypesAreAssignable,
  )
}

function propertyMatchGraph(
  remainingProperties: Set<AST.ItemProperty>,
  remainingExpected: Set<AST.TypeProperty>,
  duplicateProvidedPropertyTypes: ReadonlySet<string>,
): MatchGraph<AST.ItemProperty, AST.TypeProperty> {
  return matchGraph(
    remainingProperties,
    remainingExpected,
    property => {
      const type = Type.ofExpression(property.value)
      const key = Type.identityKey(type)
      return type.kind === 'unresolved' || (!!key && duplicateProvidedPropertyTypes.has(key))
    },
    propertyTypesAreAssignable,
  )
}

function typesExactlyMatch(
  actual: ReturnType<typeof Type.ofExpression>,
  expected: ReturnType<typeof Type.ofParameter>,
): boolean {
  const actualKey = Type.identityKey(actual)
  return !!actualKey && actualKey === Type.identityKey(expected)
}

function reportDuplicateArgumentTypes(
  args: readonly AST.Argument[],
  diagnostics: ArgumentBindingDiagnostic[],
): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const argument of args) {
    const key = Type.identityKey(Type.ofExpression(argument.value))
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

function reportDuplicateProvidedPropertyTypes(
  properties: readonly AST.ItemProperty[],
  diagnostics: ItemPropertyBindingDiagnostic[],
): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const property of properties) {
    const key = Type.identityKey(Type.ofExpression(property.value))
    if (!key) {
      continue
    }
    if (seen.has(key)) {
      duplicates.add(key)
      diagnostics.push({
        kind: 'duplicate-provided-property-type',
        property,
        type: key,
      })
      continue
    }
    seen.add(key)
  }
  return duplicates
}
