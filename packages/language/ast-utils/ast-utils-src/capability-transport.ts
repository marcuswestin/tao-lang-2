import { AST } from '@parser'
import { Switch } from '@shared'
import {
  associatedCallableAnalysis,
  type AssociatedCallableDescriptor,
  associatedCallableDescriptor,
  hasAssociatedEffects,
} from './associated-methods'
import {
  type CallableInput,
  type CallableSignatureComparison,
  compareCallableSignatures,
} from './callable-signatures'
import { type TaoType, Type } from './Type'

/** Executable adaptation, independent of payload values and nominal spelling. */
export type CapabilityTransportPlan =
  | Readonly<{ kind: 'identity' }>
  | Readonly<{ kind: 'attach'; methods: readonly CapabilityTransportMethod[] }>
  | Readonly<{ kind: 'reproject'; methods: readonly CapabilityTransportMethod[] }>
  | Readonly<{ kind: 'optional'; present: CapabilityTransportPlan }>

/** Contravariant input transport follows the admitted implementation's parameter order. */
export type CapabilityTransportInput = Readonly<{
  required: CallableInput
  supplied: CallableInput
  plan: CapabilityTransportPlan
}>

/** Real parameter declarations retain lexical defaults; planning never evaluates them. */
export type CapabilityTransportMethod = Readonly<{
  required: AssociatedCallableDescriptor
  supplied: AssociatedCallableDescriptor
  correspondence: CallableSignatureComparison['correspondence']
  inputs: readonly CapabilityTransportInput[]
  result: CapabilityTransportPlan
}>

export type CapabilityTransportResult =
  | Readonly<{ kind: 'ready'; plan: CapabilityTransportPlan }>
  | Readonly<{
    kind: 'unknown'
    reason: 'missing-effects' | 'unresolved-domain' | 'missing-proof' | 'recursive-plan'
  }>
  | Readonly<{
    kind: 'unsupported'
    reason:
      | 'incompatible-types'
      | 'ambiguous-expected-union'
      | 'erased-union'
      | 'list-mapping'
      | 'action-mapping'
      | 'writable-input'
  }>

const identity: CapabilityTransportPlan = Object.freeze({ kind: 'identity' })
type TransportAdmission = 'source' | 'callable'

/** Ordinary source construction stays with its consumer; method substitution remains strict. */
export function planCapabilityTransport(
  actual: TaoType,
  expected: TaoType,
  admission: TransportAdmission = 'source',
): CapabilityTransportResult {
  return hasAssociatedEffects()
    ? new CapabilityTransportPlanner().plan(actual, expected, admission)
    : unknown('missing-effects')
}

class CapabilityTransportPlanner {
  private readonly visiting = new Map<object, Set<object>>()
  private readonly domains = new Map<TaoType, TaoType>()
  private readonly inputs = new Map<CallableInput, CallableInput>()
  private readonly descriptors = new Map<AssociatedCallableDescriptor, AssociatedCallableDescriptor>()

  plan(actual: TaoType, expected: TaoType, admission: TransportAdmission): CapabilityTransportResult {
    if (unresolvedDomain(actual) || unresolvedDomain(expected)) {
      return unknown('unresolved-domain')
    }
    const actualKey = domainWitness(actual)
    const expectedKey = domainWitness(expected)
    const targets = this.visiting.get(actualKey) ?? new Set<object>()
    if (targets.has(expectedKey)) {
      return unknown('recursive-plan')
    }
    this.visiting.set(actualKey, targets)
    targets.add(expectedKey)
    try {
      if (actual.kind === 'union') {
        return this.actualUnion(flattenUnion(actual.members), expected, admission)
      }
      if (expected.kind === 'union') {
        return this.expectedUnion(actual, flattenUnion(expected.members), admission)
      }
      if (expected.genericParameter && Type.aggregateCapabilityRequirements(expected).length > 0) {
        return this.capability(actual, expected)
      }
      return Switch.kind(expected, {
        capability: capability => this.capability(actual, capability),
        list: list => this.list(actual, list, admission),
        primitive: primitive => this.primitive(actual, primitive, admission),
        item: () => admittedIdentity(actual, expected, admission),
        entity: () => admittedIdentity(actual, expected, admission),
        enum: () => admittedIdentity(actual, expected, admission),
        unresolved: () => unknown('unresolved-domain'),
      })
    } finally {
      targets.delete(expectedKey)
      if (targets.size === 0) {
        this.visiting.delete(actualKey)
      }
    }
  }

  private actualUnion(
    members: readonly TaoType[],
    expected: TaoType,
    admission: TransportAdmission,
  ): CapabilityTransportResult {
    if (members.length === 0) {
      return unknown('unresolved-domain')
    }
    const selections = members.map(member => ({ member, result: this.plan(member, expected, admission) }))
    const unavailable = selections.find(selection => selection.result.kind === 'unknown')
      ?? selections.find(selection => selection.result.kind === 'unsupported')
    if (unavailable) {
      return unavailable.result
    }
    const present = selections.filter(selection => !isNone(selection.member))
    const plans = present.map(selection =>
      (selection.result as Extract<CapabilityTransportResult, { kind: 'ready' }>).plan
    )
    if (plans.length === 0) {
      return ready(identity)
    }
    const plan = plans[0]!
    if (!plans.every(candidate => equivalentPlan(plan, candidate))) {
      return unsupported('erased-union')
    }
    return ready(
      present.length !== members.length && plan.kind !== 'identity'
        ? Object.freeze({ kind: 'optional', present: plan })
        : plan,
    )
  }

  private expectedUnion(
    actual: TaoType,
    members: readonly TaoType[],
    admission: TransportAdmission,
  ): CapabilityTransportResult {
    if (members.length === 0) {
      return unknown('unresolved-domain')
    }
    const selections = members.map(member => this.plan(actual, member, admission))
    const unavailable = selections.find(selection => selection.kind === 'unknown')
    if (unavailable) {
      return unavailable
    }
    const candidates = selections.filter(selection =>
      !(selection.kind === 'unsupported' && selection.reason === 'incompatible-types')
    )
    const plans = candidates.filter((selection): selection is Extract<CapabilityTransportResult, { kind: 'ready' }> =>
      selection.kind === 'ready'
    )
    if (plans.length === 0) {
      return candidates[0] ?? unsupported('incompatible-types')
    }
    const plan = plans[0]!.plan
    return plans.length === candidates.length && plans.every(candidate => equivalentPlan(plan, candidate.plan))
      ? ready(plan)
      : unsupported('ambiguous-expected-union')
  }

  private list(
    actual: TaoType,
    expected: Extract<TaoType, { kind: 'list' }>,
    admission: TransportAdmission,
  ): CapabilityTransportResult {
    if (actual.kind !== 'list') {
      return unsupported('incompatible-types')
    }
    if (!actual.element && expected.element && containsCapability(expected.element)) {
      return unknown('missing-proof')
    }
    const element = actual.element && expected.element
      ? this.plan(actual.element, expected.element, admission)
      : ready(identity)
    if (element.kind === 'unknown') {
      return element
    }
    if (!admitsTransport(actual, expected, admission)) {
      return unsupported('incompatible-types')
    }
    if (element.kind === 'unsupported') {
      return element.reason === 'incompatible-types' ? element : unsupported('list-mapping')
    }
    return element.plan.kind === 'identity' ? ready(identity) : unsupported('list-mapping')
  }

  private primitive(
    actual: TaoType,
    expected: Extract<TaoType, { kind: 'primitive' }>,
    admission: TransportAdmission,
  ): CapabilityTransportResult {
    if (
      expected.primitive !== 'action' || actual.kind !== 'primitive' || actual.primitive !== 'action'
    ) {
      return admittedIdentity(actual, expected, admission)
    }
    const parameters = expected.parameters.map((input, index) => {
      const supplied = actual.parameters[index]
      return supplied ? this.plan(input.type, supplied.type, admission) : unsupported('incompatible-types')
    })
    const unavailable = parameters.find(parameter => parameter.kind === 'unknown')
    if (unavailable) {
      return unavailable
    }
    if (!admitsTransport(actual, expected, admission)) {
      return unsupported('incompatible-types')
    }
    return parameters.every(parameter => parameter.kind === 'ready' && parameter.plan.kind === 'identity')
      ? ready(identity)
      : unsupported('action-mapping')
  }

  private capability(
    actual: TaoType,
    expected: TaoType,
  ): CapabilityTransportResult {
    if (
      actual.kind !== 'capability' && actual.kind !== 'entity' && !actual.genericParameter
      && !((actual.kind === 'primitive' || actual.kind === 'item' || actual.kind === 'list')
        && AST.isTypeDeclaration(actual.nominal))
    ) {
      return unsupported('incompatible-types')
    }
    const receiver = expected.genericReceiver ?? actual
    const requirements = Type.aggregateCapabilityRequirements(expected)
    const requiredDescriptors = requirements.map(requirement => {
      const descriptor = associatedCallableDescriptor(requirement)
      return descriptor ? Type.specializeAssociatedDescriptor(descriptor, receiver) : undefined
    })
    if (requiredDescriptors.some(descriptor => !descriptor)) {
      return unknown('missing-proof')
    }
    if (requiredDescriptors.some(descriptor => descriptorUnresolved(descriptor!))) {
      return unknown('unresolved-domain')
    }
    // Identity still requires the final declaration contracts; it cannot bless a concrete value.
    if (
      (actual.kind === 'capability' || actual.genericParameter)
      && Type.identityKey(actual) === Type.identityKey(expected)
    ) {
      return ready(identity)
    }
    const methods: { required: AssociatedCallableDescriptor; supplied: AssociatedCallableDescriptor }[] = []
    for (let index = 0; index < requirements.length; index++) {
      const requirement = requirements[index]!
      const declaration = actual.kind === 'capability' || actual.genericParameter
        ? Type.aggregateCapabilityRequirements(actual).find(method => method.name === requirement.name)
        : Type.associatedMethodDeclaration(receiver, requirement.name)?.declaration
      if (!declaration) {
        return unsupported('incompatible-types')
      }
      const descriptor = associatedCallableDescriptor(declaration)
      if (!descriptor) {
        return unknown('missing-proof')
      }
      const supplied = Type.specializeAssociatedDescriptor(descriptor, receiver)
      if (descriptorUnresolved(supplied)) {
        return unknown('unresolved-domain')
      }
      if (actual.kind !== 'capability' && !actual.genericParameter) {
        const analysis = associatedCallableAnalysis(declaration)
        if (!analysis || analysis.effects.purity.open) {
          return unknown('missing-proof')
        }
      }
      methods.push({ required: requiredDescriptors[index]!, supplied })
    }
    // Probe nested proof before final admission. Its recursion guard intentionally refuses self-proof.
    let unavailable: CapabilityTransportResult | undefined
    for (const method of methods) {
      const result = this.plan(method.supplied.result, method.required.result, 'callable')
      if (result.kind === 'unknown') {
        return result
      }
      const analysis = actual.kind === 'capability' || actual.genericParameter
        ? undefined
        : associatedCallableAnalysis(method.supplied.declaration)
      const signature = analysis
        ? { ...method.supplied.signature, failures: analysis.effects.failures }
        : method.supplied.signature
      const comparison = compareCallableSignatures(signature, method.required.signature, (input, supplied) => {
        const plan = this.plan(input, supplied, 'callable')
        if (plan.kind === 'unknown') {
          unavailable = plan
        }
        return Type.isCallableAssignable(input, supplied)
      })
      if (!comparison.compatible && unavailable) {
        return unavailable
      }
    }
    const witnesses = Type.capabilityWitnesses(actual, expected)
    if (!witnesses) {
      return unavailable ?? unsupported('incompatible-types')
    }
    const planned: CapabilityTransportMethod[] = []
    let unsupportedPlan: CapabilityTransportResult | undefined
    for (const witness of witnesses) {
      const inputs: CapabilityTransportInput[] = []
      for (const pair of witness.correspondence) {
        const result = this.plan(pair.required.type, pair.supplied.type, 'callable')
        if (result.kind === 'unknown') {
          return result
        }
        if (result.kind === 'unsupported') {
          unsupportedPlan ??= result
          continue
        }
        if (pair.supplied.callerWritable && result.plan.kind !== 'identity') {
          unsupportedPlan ??= unsupported('writable-input')
        }
        inputs.push(Object.freeze({
          required: this.snapshotInput(pair.required),
          supplied: this.snapshotInput(pair.supplied),
          plan: result.plan,
        }))
      }
      const result = this.plan(witness.supplied.result, witness.required.result, 'callable')
      if (result.kind === 'unknown') {
        return result
      }
      if (result.kind === 'unsupported') {
        unsupportedPlan ??= result
        continue
      }
      planned.push(Object.freeze({
        required: this.snapshotDescriptor(witness.required),
        supplied: this.snapshotDescriptor(witness.supplied),
        correspondence: Object.freeze(witness.correspondence.map(pair =>
          Object.freeze({
            required: this.snapshotInput(pair.required),
            supplied: this.snapshotInput(pair.supplied),
          })
        )),
        inputs: Object.freeze(inputs),
        result: result.plan,
      }))
    }
    return unsupportedPlan ?? ready(Object.freeze({
      kind: actual.kind === 'capability' || actual.genericParameter ? 'reproject' : 'attach',
      methods: Object.freeze(planned),
    }))
  }

  private snapshotDescriptor(descriptor: AssociatedCallableDescriptor): AssociatedCallableDescriptor {
    const existing = this.descriptors.get(descriptor)
    if (existing) {
      return existing
    }
    const snapshot: AssociatedCallableDescriptor = Object.freeze({
      declaration: descriptor.declaration,
      owner: descriptor.owner,
      receiver: this.snapshotDomain(descriptor.receiver),
      signature: Object.freeze({
        inputs: Object.freeze(descriptor.signature.inputs.map(input => this.snapshotInput(input))),
        failures: Object.freeze({
          cases: Object.freeze([...descriptor.signature.failures.cases]),
          open: descriptor.signature.failures.open,
        }),
      }),
      result: this.snapshotDomain(descriptor.result),
    })
    this.descriptors.set(descriptor, snapshot)
    return snapshot
  }

  private snapshotInput(input: CallableInput): CallableInput {
    const existing = this.inputs.get(input)
    if (existing) {
      return existing
    }
    const snapshot = Object.freeze({ ...input, type: this.snapshotDomain(input.type) })
    this.inputs.set(input, snapshot)
    return snapshot
  }

  private snapshotDomain(type: TaoType): TaoType {
    const existing = this.domains.get(type)
    if (existing) {
      return existing
    }
    const snapshot = { ...type } as TaoType
    this.domains.set(type, snapshot)
    Object.assign(snapshot, {
      ...(type.genericBounds
        ? { genericBounds: Object.freeze(type.genericBounds.map(bound => this.snapshotDomain(bound))) }
        : {}),
      ...(type.genericReceiver ? { genericReceiver: this.snapshotDomain(type.genericReceiver) } : {}),
    })
    Switch.kind(snapshot, {
      primitive: primitive => {
        if (primitive.primitive === 'action') {
          primitive.parameters = Object.freeze(
            primitive.parameters.map(parameter =>
              Object.freeze({ ...parameter, type: this.snapshotDomain(parameter.type) })
            ),
          )
        } else if (primitive.slots) {
          primitive.slots = snapshotShape(primitive.slots)
        }
      },
      list: list => {
        list.element = list.element && this.snapshotDomain(list.element)
      },
      union: union => {
        union.members = Object.freeze(union.members.map(member => this.snapshotDomain(member)))
      },
      item: item => {
        item.item = item.item && snapshotShape(item.item)
      },
      capability: Switch.nothing,
      entity: Switch.nothing,
      enum: Switch.nothing,
      unresolved: Switch.nothing,
    })
    return Object.freeze(snapshot)
  }
}

function ready(plan: CapabilityTransportPlan): CapabilityTransportResult {
  return Object.freeze({ kind: 'ready', plan })
}

function unknown(reason: Extract<CapabilityTransportResult, { kind: 'unknown' }>['reason']): CapabilityTransportResult {
  return Object.freeze({ kind: 'unknown', reason })
}

function unsupported(
  reason: Extract<CapabilityTransportResult, { kind: 'unsupported' }>['reason'],
): CapabilityTransportResult {
  return Object.freeze({ kind: 'unsupported', reason })
}

function admittedIdentity(
  actual: TaoType,
  expected: TaoType,
  admission: TransportAdmission,
): CapabilityTransportResult {
  return admitsTransport(actual, expected, admission) ? ready(identity) : unsupported('incompatible-types')
}

function admitsTransport(actual: TaoType, expected: TaoType, admission: TransportAdmission): boolean {
  return admission === 'source' ? Type.isAssignable(actual, expected) : Type.isCallableAssignable(actual, expected)
}

function domainWitness(type: TaoType): object {
  if (type.genericParameter || type.genericReceiver) {
    return type
  }
  return type.kind === 'entity'
    ? type.entity
    : type.kind === 'capability'
    ? type.declaration
    : 'nominal' in type
    ? type.nominal ?? type
    : type
}

function isNone(type: TaoType): boolean {
  return type.kind === 'primitive' && type.primitive === 'none'
}

function flattenUnion(members: readonly TaoType[]): readonly TaoType[] {
  return members.flatMap(member => member.kind === 'union' ? flattenUnion(member.members) : [member])
}

function unresolvedDomain(type: TaoType, visiting = new Set<TaoType>()): boolean {
  if (visiting.has(type)) {
    return true
  }
  visiting.add(type)
  try {
    return Switch.kind(type, {
      unresolved: () => true,
      union: union => union.members.some(member => unresolvedDomain(member, visiting)),
      list: list => list.element !== undefined && unresolvedDomain(list.element, visiting),
      primitive: primitive =>
        primitive.primitive === 'action'
        && primitive.parameters.some(parameter => unresolvedDomain(parameter.type, visiting)),
      item: () => false,
      entity: () => false,
      enum: () => false,
      capability: () => false,
    })
  } finally {
    visiting.delete(type)
  }
}

function descriptorUnresolved(descriptor: AssociatedCallableDescriptor): boolean {
  return unresolvedDomain(descriptor.receiver) || unresolvedDomain(descriptor.result)
    || descriptor.signature.inputs.some(input => unresolvedDomain(input.type))
}

/** Whether a receiving domain needs capability transport rather than ordinary source construction. */
export function containsCapability(type: TaoType): boolean {
  if (type.genericBounds?.some(containsCapability)) {
    return true
  }
  return Switch.kind(type, {
    capability: () => true,
    union: union => union.members.some(containsCapability),
    list: list => list.element !== undefined && containsCapability(list.element),
    primitive: primitive =>
      primitive.primitive === 'action'
      && primitive.parameters.some(parameter => containsCapability(parameter.type)),
    item: () => false,
    entity: () => false,
    enum: () => false,
    unresolved: () => false,
  })
}

function snapshotShape(shape: NonNullable<Extract<TaoType, { kind: 'item' }>['item']>) {
  return Object.freeze({
    ...shape,
    properties: Object.freeze([...shape.properties]),
    dataFields: shape.dataFields && Object.freeze([...shape.dataFields]),
  })
}

/** Compare witness identities and executable steps, never the values being transported. */
function equivalentPlan(left: CapabilityTransportPlan, right: CapabilityTransportPlan): boolean {
  return Switch.kind(left, {
    identity: () => right.kind === 'identity',
    optional: optional => right.kind === 'optional' && equivalentPlan(optional.present, right.present),
    attach: attach => right.kind === 'attach' && equivalentMethods(attach.methods, right.methods),
    reproject: reproject => right.kind === 'reproject' && equivalentMethods(reproject.methods, right.methods),
  })
}

function equivalentMethods(
  left: readonly CapabilityTransportMethod[],
  right: readonly CapabilityTransportMethod[],
): boolean {
  return left.length === right.length && left.every((method, index) => {
    const other = right[index]!
    return equivalentDescriptor(method.required, other.required)
      && equivalentDescriptor(method.supplied, other.supplied)
      && method.correspondence.length === other.correspondence.length
      && method.correspondence.every((pair, pairIndex) => {
        const otherPair = other.correspondence[pairIndex]!
        return equivalentInput(pair.required, otherPair.required) && equivalentInput(pair.supplied, otherPair.supplied)
      })
      && method.inputs.length === other.inputs.length
      && method.inputs.every((input, inputIndex) => {
        const otherInput = other.inputs[inputIndex]!
        return equivalentInput(input.required, otherInput.required)
          && equivalentInput(input.supplied, otherInput.supplied)
          && equivalentPlan(input.plan, otherInput.plan)
      })
      && equivalentPlan(method.result, other.result)
  })
}

function equivalentDescriptor(left: AssociatedCallableDescriptor, right: AssociatedCallableDescriptor): boolean {
  return left.declaration === right.declaration && left.owner === right.owner
    && left.signature.inputs.length === right.signature.inputs.length
    && left.signature.inputs.every((input, index) => equivalentInput(input, right.signature.inputs[index]!))
    && left.signature.failures.open === right.signature.failures.open
    && left.signature.failures.cases.length === right.signature.failures.cases.length
    && left.signature.failures.cases.every((failure, index) => failure === right.signature.failures.cases[index])
}

function equivalentInput(left: CallableInput, right: CallableInput): boolean {
  return left.declaration === right.declaration && left.role === right.role && left.labelName === right.labelName
    && left.localName === right.localName && left.acceptsNone === right.acceptsNone
    && left.omissible === right.omissible && left.callerWritable === right.callerWritable
}
