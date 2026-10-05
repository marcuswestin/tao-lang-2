import { AST } from '@parser'
import type {
  AssociatedCallableDescriptor,
  AssociatedCallableOwner,
  AssociatedDescriptorMaterialization,
} from './associated-methods'
import type { TaoType } from './Type'
import { Type } from './Type'

export type AssociatedOperation = AST.BinaryExpression | AST.UnaryExpression

export type AssociatedOperatorContract = Readonly<{
  declaration: AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration
  owner: AssociatedCallableOwner
  contract: AssociatedDescriptorMaterialization
  receiverEligible?: boolean
  inputTypes?: readonly TaoType[]
}>

export type AssociatedOperatorCandidate = Readonly<{
  descriptor: AssociatedCallableDescriptor
  dispatch: 'instance' | 'static'
  /** Includes the implicit receiver domain for an instance declaration. */
  operandDomains: readonly TaoType[]
}>

export type AssociatedOperationResolution = Readonly<{
  expression: AssociatedOperation
  operator: string
  operands: readonly AST.Expression[]
  operandTypes: readonly TaoType[]
  candidates: readonly AssociatedOperatorCandidate[]
  descriptor?: AssociatedCallableDescriptor
  dispatch?: 'instance' | 'static'
  receiver?: AST.Expression
  operandDomains?: readonly TaoType[]
  /** Explicit inputs stay in declaration order; receiver anchors never become fake parameters. */
  pairs: readonly Readonly<{ parameter: AST.ParameterDeclaration; operand: AST.Expression; type: TaoType }>[]
  result: TaoType
  problem?:
    | 'unsupported-operator'
    | 'unresolved-operand'
    | 'missing-operator'
    | 'ambiguous-operator'
    | 'pending-contract'
}>

export type AssociatedOperationTypeResolution = Readonly<{
  ofExpression(expression: AST.Expression): TaoType
  contracts(operands: readonly TaoType[], operator: string): readonly AssociatedOperatorContract[]
  accepts(actual: TaoType, expected: TaoType): boolean
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
  const base = {
    expression,
    operator: expression.operator,
    operands,
    operandTypes,
    pairs: [],
    candidates: [],
    result: { kind: 'unresolved' } as TaoType,
  }
  if (!authoredOperators.has(expression.operator)) {
    return { ...base, problem: 'unsupported-operator' }
  }
  if (operandTypes.some(type => type.kind === 'unresolved')) {
    return { ...base, problem: 'unresolved-operand' }
  }
  const receiver = operandTypes[0]!
  const contracts = resolution.contracts(operandTypes, expression.operator)
  const candidates: AssociatedOperatorCandidate[] = []
  const declarations = new Set<AssociatedOperatorContract['declaration']>()
  let pending = false
  for (const candidate of contracts) {
    const declaration = candidate.declaration
    if (declarations.has(declaration)) {
      continue
    }
    declarations.add(declaration)
    const staticDeclaration = AST.isAssociatedFunctionDeclaration(declaration) && declaration.static
    if (!staticDeclaration && candidate.receiverEligible === false) {
      continue
    }
    const arity = AST.parametersOf(declaration).length + (staticDeclaration ? 0 : 1)
    if (arity !== operands.length) {
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
    const contextualReceiver = candidate.receiverEligible !== false
      && (comparisonOperators.has(expression.operator) || (!staticDeclaration
        && (receiver.kind === 'capability' || receiver.genericParameter !== undefined)))
    const descriptor = contextualReceiver
      ? Type.specializeAssociatedDescriptor(candidate.contract.descriptor, receiver.genericReceiver ?? receiver)
      : candidate.contract.descriptor
    const operandDomains = [
      ...(staticDeclaration
        ? []
        : [contextualReceiver ? receiver.genericReceiver ?? receiver : descriptor.receiver]),
      ...descriptor.signature.inputs.map(input => input.type),
    ]
    const dispatch = staticDeclaration ? 'static' : 'instance'
    candidates.push({ descriptor, dispatch, operandDomains })
  }
  if (pending) {
    return { ...base, candidates, problem: 'pending-contract' }
  }
  const applicable = candidates.filter(candidate =>
    operandTypes.every((actual, index) => resolution.accepts(actual, candidate.operandDomains[index]!))
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
  const offset = selected.dispatch === 'instance' ? 1 : 0
  return {
    ...base,
    candidates,
    descriptor: selected.descriptor,
    dispatch: selected.dispatch,
    ...(offset ? { receiver: operands[0] } : {}),
    operandDomains: selected.operandDomains,
    pairs: selected.descriptor.signature.inputs.map((input, index) => ({
      parameter: input.declaration,
      operand: operands[index + offset]!,
      type: input.type,
    })),
    result: selected.descriptor.result,
  }
}
