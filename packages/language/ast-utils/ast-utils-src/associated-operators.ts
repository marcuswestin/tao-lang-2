import { AST } from '@parser'
import type {
  AssociatedCallableDescriptor,
  AssociatedCallableOwner,
  AssociatedDescriptorMaterialization,
} from './associated-methods'
import type { CallableInput } from './callable-signatures'
import type { TaoType } from './Type'

export type AssociatedOperation = AST.BinaryExpression | AST.UnaryExpression

export type AssociatedOperatorContract = Readonly<{
  declaration: AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration
  owner: AssociatedCallableOwner
  contract: AssociatedDescriptorMaterialization
  receiverEligible?: boolean
  /** Only declarations discovered through an actual operand may anchor contextual Self. */
  eligibleOperandIndices?: readonly number[]
  /** Actual declaration ancestry, excluding the defining owner itself. */
  ownerAncestors?: readonly AssociatedCallableOwner[]
  inputTypes?: readonly TaoType[]
}>

type AssociatedOperatorCandidate = Readonly<{
  descriptor: AssociatedCallableDescriptor
  dispatch: 'instance' | 'static'
  /** Includes the implicit receiver domain for an instance declaration. */
  operandDomains: readonly TaoType[]
}>

export type AssociatedOperatorContractResolution = Readonly<{
  operator: string
  operandTypes: readonly TaoType[]
  candidates: readonly AssociatedOperatorCandidate[]
  descriptor?: AssociatedCallableDescriptor
  dispatch?: 'instance' | 'static'
  operandDomains?: readonly TaoType[]
  receiverPlacement?: Readonly<
    { kind: 'implicit' } | { kind: 'parameter'; input: CallableInput; parameter: AST.ParameterDeclaration }
  >
  result: TaoType
  problem?:
    | 'unsupported-operator'
    | 'unresolved-operand'
    | 'missing-operator'
    | 'ambiguous-operator'
    | 'pending-contract'
}>

export type AssociatedOperationResolution =
  & AssociatedOperatorContractResolution
  & Readonly<{
    expression: AssociatedOperation
    operands: readonly AST.Expression[]
    receiver?: AST.Expression
    /** Explicit inputs stay in declaration order; receiver anchors never become fake parameters. */
    pairs: readonly Readonly<{ parameter: AST.ParameterDeclaration; operand: AST.Expression; type: TaoType }>[]
  }>

export type AssociatedOperatorTypeResolution = Readonly<{
  contracts(operands: readonly TaoType[], operator: string): readonly AssociatedOperatorContract[]
  accepts(actual: TaoType, expected: TaoType): boolean
  specialize(descriptor: AssociatedCallableDescriptor, receiver: TaoType): AssociatedCallableDescriptor
  isAbstractDomain?(domain: TaoType): boolean
}>

export type AssociatedOperationTypeResolution =
  & AssociatedOperatorTypeResolution
  & Readonly<{
    ofExpression(expression: AST.Expression): TaoType
  }>

const authoredOperators = new Set(['+', '-', '*', '/', '==', '!=', '<', '<=', '>', '>='])
const comparisonOperators = new Set(['==', '!=', '<', '<=', '>', '>='])

/** Ordered operands match real callable inputs directly, without argument or callee fabrication. */
export function resolveAssociatedOperation(
  expression: AssociatedOperation,
  resolution: AssociatedOperationTypeResolution,
): AssociatedOperationResolution {
  const operands = AST.isBinaryExpression(expression) ? [expression.left, expression.right] : [expression.operand]
  const operandTypes = operands.map(operand => resolution.ofExpression(operand))
  const selected = resolveAssociatedOperatorContract(expression.operator, operandTypes, resolution)
  const offset = selected.dispatch === 'instance' ? 1 : 0
  return {
    ...selected,
    expression,
    operands,
    ...(selected.descriptor && offset ? { receiver: operands[0] } : {}),
    pairs: selected.descriptor?.signature.inputs.map((input, index) => ({
      parameter: input.declaration,
      operand: operands[index + offset]!,
      type: input.type,
    })) ?? [],
  }
}

/** Type-only selection shares the exact authored contracts and ordered operand matcher. */
export function resolveAssociatedOperatorContract(
  operator: string,
  operandTypes: readonly TaoType[],
  resolution: AssociatedOperatorTypeResolution,
): AssociatedOperatorContractResolution {
  const base = {
    operator,
    operandTypes,
    candidates: [],
    result: { kind: 'unresolved' } as TaoType,
  }
  if (!authoredOperators.has(operator)) {
    return { ...base, problem: 'unsupported-operator' }
  }
  if (operandTypes.length === 0 || operandTypes.some(type => type.kind === 'unresolved')) {
    return { ...base, problem: 'unresolved-operand' }
  }
  const receiver = operandTypes[0]!
  const contracts = resolution.contracts(operandTypes, operator)
  const candidates: AssociatedOperatorCandidate[] = []
  const contextualStaticCandidates = new Set<AssociatedOperatorCandidate>()
  const contractsByDeclaration = new Map<AssociatedOperatorContract['declaration'], AssociatedOperatorContract>()
  const declarations = new Set<AssociatedOperatorContract['declaration']>()
  let pending = false
  for (const candidate of contracts) {
    const declaration = candidate.declaration
    if (declarations.has(declaration)) {
      continue
    }
    declarations.add(declaration)
    contractsByDeclaration.set(declaration, candidate)
    const staticDeclaration = AST.isAssociatedFunctionDeclaration(declaration) && declaration.static
    if (!staticDeclaration && candidate.receiverEligible === false) {
      continue
    }
    const arity = AST.parametersOf(declaration).length + (staticDeclaration ? 0 : 1)
    if (arity !== operandTypes.length) {
      continue
    }
    if (
      candidate.contract.kind === 'pending'
      || (AST.isAssociatedFunctionDeclaration(declaration) && declaration.genericParameters.length > 0)
    ) {
      const inputs = candidate.contract.kind === 'ready'
        ? candidate.contract.descriptor.signature.inputs.map(input => input.type)
        : candidate.inputTypes ?? []
      const offset = staticDeclaration ? 0 : 1
      if (
        inputs.some((expected, index) => {
          const actual = operandTypes[index + offset]!
          return expected.genericParameter
            ? (expected.genericBounds ?? []).some(bound =>
              bound.kind !== 'unresolved' && !resolution.accepts(actual, bound)
            )
            : expected.kind !== 'unresolved' && !resolution.accepts(actual, expected)
        })
      ) {
        continue
      }
    }
    if (
      candidate.contract.kind === 'pending'
      || (AST.isAssociatedFunctionDeclaration(declaration) && declaration.genericParameters.length > 0)
    ) {
      pending = true
      continue
    }
    const declaredDescriptor = candidate.contract.descriptor
    const selfIndices = staticDeclaration
      ? declaredDescriptor.signature.inputs.flatMap((input, index) => input.type.selfOwner ? [index] : [])
      : []
    const eligibleIndices = candidate.eligibleOperandIndices ?? (candidate.receiverEligible === false ? [] : [0])
    const suppliedSelfDomains = selfIndices.map(index => operandTypes[index]!)
    const selectedSelf = suppliedSelfDomains.find((domain, index) =>
      eligibleIndices.includes(selfIndices[index]!)
      && suppliedSelfDomains.every(actual => resolution.accepts(actual, domain))
    )
    if (selfIndices.length > 0 && !selectedSelf) {
      continue
    }
    if (
      selectedSelf?.kind === 'primitive' && selectedSelf.primitive === 'numeric'
      && !selectedSelf.genericParameter
      && resolution.isAbstractDomain?.(selectedSelf)
    ) {
      continue
    }
    const contextualReceiver = candidate.receiverEligible !== false
      && (comparisonOperators.has(operator) || (!staticDeclaration
        && (receiver.kind === 'capability' || receiver.genericParameter !== undefined)))
    const descriptor = selectedSelf
      ? Object.freeze({
        ...resolution.specialize(declaredDescriptor, selectedSelf.genericReceiver ?? selectedSelf),
        receiver: selectedSelf.genericReceiver ?? selectedSelf,
      })
      : contextualReceiver
      ? resolution.specialize(declaredDescriptor, receiver.genericReceiver ?? receiver)
      : declaredDescriptor
    const operandDomains = [
      ...(staticDeclaration
        ? []
        : [contextualReceiver ? receiver.genericReceiver ?? receiver : descriptor.receiver]),
      ...descriptor.signature.inputs.map(input => input.type),
    ]
    const dispatch = staticDeclaration ? 'static' : 'instance'
    const resolvedCandidate: AssociatedOperatorCandidate = { descriptor, dispatch, operandDomains }
    candidates.push(resolvedCandidate)
    if (selectedSelf) {
      contextualStaticCandidates.add(resolvedCandidate)
    }
  }
  if (pending) {
    return { ...base, candidates, problem: 'pending-contract' }
  }
  const matching = candidates.filter(candidate =>
    operandTypes.every((actual, index) => resolution.accepts(actual, candidate.operandDomains[index]!))
  )
  const applicable = matching.filter(candidate =>
    !contextualStaticCandidates.has(candidate)
    || !matching.some(other => {
      const declaration = other.descriptor.declaration
      const contract =
        AST.isAssociatedFunctionDeclaration(declaration) || AST.isCapabilityMethodDeclaration(declaration)
          ? contractsByDeclaration.get(declaration)
          : undefined
      return other.dispatch === candidate.dispatch
        && contract?.ownerAncestors?.includes(candidate.descriptor.owner)
        && candidate.operandDomains.every((domain, index) =>
          resolution.accepts(domain, other.operandDomains[index]!)
          && resolution.accepts(other.operandDomains[index]!, domain)
        )
    })
  )
  const mostSpecific = applicable.filter(candidate =>
    applicable.every(other =>
      candidate.operandDomains.every((domain, index) => resolution.accepts(domain, other.operandDomains[index]!))
    )
  )
  if (mostSpecific.length !== 1) {
    return { ...base, candidates, problem: applicable.length === 0 ? 'missing-operator' : 'ambiguous-operator' }
  }
  const selected = mostSpecific[0]!
  const receiverInput = selected.descriptor.signature.inputs[0]
  return {
    ...base,
    candidates,
    descriptor: selected.descriptor,
    dispatch: selected.dispatch,
    operandDomains: selected.operandDomains,
    receiverPlacement: selected.dispatch === 'instance'
      ? { kind: 'implicit' }
      : { kind: 'parameter', input: receiverInput!, parameter: receiverInput!.declaration },
    result: selected.descriptor.result,
  }
}
