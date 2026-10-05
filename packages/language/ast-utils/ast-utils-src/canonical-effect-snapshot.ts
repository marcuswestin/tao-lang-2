import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import type { ArgumentBindingDiagnostic, ArgumentBindingMetadata, RenderInvocationPair } from './argument-bindings'
import { resolveAssociatedMethodInvocation } from './associated-invocations'
import {
  type AssociatedCallableDescriptor,
  type AssociatedDescriptorMaterialization,
  associatedMethodCallTarget,
  type AssociatedMethodReceiver,
  capabilityRequirements,
  hasAssociatedEffects,
  ownAssociatedMethods,
} from './associated-methods'
import type { NativeEffectPublication } from './callable-effect-facts'
import { type CallableSignature, callableSignatureOf } from './callable-signatures'
import { resolveFunctionInvocation } from './invocations'
import { type ItemShape, type TaoType, Type } from './Type'

type AssociatedDeclaration = AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration
type SourceCallable = AST.CallableDeclaration | AssociatedDeclaration
type EffectContract = Pick<NativeEffectPublication, 'purity' | 'failures'>
type PublicationStatus =
  | Readonly<{ kind: 'complete'; reason?: never }>
  | Readonly<{ kind: 'unknown'; reason: 'incomplete-fact' | 'dynamic-target' | 'unclassified-native' }>

/** Source bodies remain real execution witnesses; their contracts are not purity promises. */
export type CanonicalCallableDescriptor = Readonly<{
  declaration: SourceCallable
  owner?: AST.TypeDeclaration
  parameters: readonly AST.ParameterDeclaration[]
  body?: AST.Node
  kind: 'source' | 'requirement' | 'opaque'
  signature?: CallableSignature
  result?: TaoType
  pending: readonly AST.Node[]
  convention: 'wrapped' | 'raw-nullish' | 'unknown'
  contract?: EffectContract
}>

/** Every declared default has an eligibility record, even when correspondence is unknown. */
export type CanonicalDefaultEligibility = Readonly<{
  parameter: AST.ParameterDeclaration
  expression: AST.Expression
  eligibility: 'cannot' | 'may' | 'unknown'
  reason: 'provided-wrapper' | 'omitted' | 'raw-nullish' | 'unresolved-binding' | 'unknown-convention'
}>

/** Completeness here proves correspondence only; final admission runs after real analysis. */
export type CanonicalCallPublication =
  & PublicationStatus
  & Readonly<{
    site: AST.FunctionCallExpression | AST.MethodCallExpression
    operation: 'function'
    target?: SourceCallable
    descriptor?: CanonicalCallableDescriptor
    receiver?: AssociatedMethodReceiver
    receiverType?: TaoType
    pairs: readonly Readonly<RenderInvocationPair>[]
    diagnostics: readonly ArgumentBindingDiagnostic[]
    defaults: readonly CanonicalDefaultEligibility[]
  }>

/** The proof retains the declaration and source context rather than a fabricated receiver. */
export type CanonicalReadPublication =
  & PublicationStatus
  & Readonly<{
    reference: AST.ValueReference | AST.MemberAccessExpression
    declaration?: AST.ValueReferenceTarget
    classification: 'immutable' | 'reactive' | 'unknown'
    proof?: Readonly<{
      kind: 'parameter' | 'contextual-owner' | 'state' | 'live-alias'
      owner: AST.Node
    }>
    initializer?: AST.Expression
  }>

const factoryBrand: unique symbol = Symbol('canonical effect-independent snapshot')
const publishedSnapshots = new WeakSet<CanonicalEffectIndependentSnapshot>()

/** Only the production factory mints this immutable, generation-local semantic inventory. */
export type CanonicalEffectIndependentSnapshot = Readonly<{
  [factoryBrand]: true
  phase: 'correspondence'
  roots: readonly AST.TaoFile[]
  covered: ReadonlySet<AST.Node>
  descriptors: ReadonlyMap<AST.Node, CanonicalCallableDescriptor>
  associatedDescriptors: ReadonlyMap<AssociatedDeclaration, AssociatedDescriptorMaterialization>
  calls: ReadonlyMap<AST.Node, CanonicalCallPublication>
  reads: ReadonlyMap<AST.Node, CanonicalReadPublication>
  natives: readonly NativeEffectPublication[]
}>

/** Evidence is independently owned; absence leaves requirements and native contracts open. */
export type CanonicalEffectEvidence = Readonly<{
  requirements?: ReadonlyMap<AST.CapabilityMethodDeclaration, EffectContract>
  natives?: readonly NativeEffectPublication[]
}>

/** Consumers check phase/provenance without invoking a resolver or analyzer. */
export function assertCanonicalEffectSnapshot(snapshot: CanonicalEffectIndependentSnapshot): void {
  Assert(
    publishedSnapshots.has(snapshot) && snapshot[factoryBrand] === true && snapshot.phase === 'correspondence',
    'a factory-published correspondence snapshot',
  )
}

/** Inventory all linked source metadata without selecting execution regions or admission witnesses. */
export function publishCanonicalEffectSnapshot(
  files: readonly AST.TaoFile[],
  evidence: CanonicalEffectEvidence = {},
): CanonicalEffectIndependentSnapshot {
  Assert(!hasAssociatedEffects(), 'canonical source publication precedes final admission')
  const nodes = inventoryNodes(files, evidence)
  const associated = new Map<AssociatedDeclaration, AssociatedDescriptorMaterialization>()
  const associatedOwners = new Map<AssociatedDeclaration, AST.TypeDeclaration>()
  for (const node of nodes) {
    if (!AST.isTypeDeclaration(node)) {
      continue
    }
    for (const declaration of [...ownAssociatedMethods(node), ...capabilityRequirements(node)]) {
      associated.set(declaration, sealAssociated(Type.associatedCallable(declaration, node)))
      associatedOwners.set(declaration, node)
    }
  }
  const resolution = Type.correspondenceResolver(associated)
  const descriptors = new Map<AST.Node, CanonicalCallableDescriptor>()
  for (const node of nodes) {
    if (AST.isAssociatedFunctionDeclaration(node) || AST.isCapabilityMethodDeclaration(node)) {
      const contract = associated.get(node)
      const ready = contract?.kind === 'ready' ? contract.descriptor : undefined
      const owner = associatedOwners.get(node)
      const requirement = AST.isCapabilityMethodDeclaration(node)
      const effects = requirement ? evidence.requirements?.get(node) : undefined
      descriptors.set(
        node,
        Object.freeze({
          declaration: node,
          ...(owner ? { owner } : {}),
          ...(ready ? { signature: ready.signature, result: ready.result } : {}),
          parameters: Object.freeze([...node.parameterList.parameters]),
          ...(AST.isAssociatedFunctionDeclaration(node) ? { body: node.block } : {}),
          kind: requirement ? 'requirement' : 'source',
          pending: Object.freeze(contract?.kind === 'pending' ? [...contract.dependencies] : ready ? [] : [node]),
          convention: 'wrapped',
          ...(effects ? { contract: sealEffectContract(effects) } : {}),
        }),
      )
    } else if (AST.isFunctionDeclaration(node) || AST.isPhraseDeclaration(node)) {
      const parameters = AST.parametersOf(node)
      const result = AST.isPhraseDeclaration(node)
        ? { kind: 'primitive', primitive: 'text' } as const
        : node.returnType
        ? resolution.ofTypeExpression(node.returnType)
        : resolution.ofFunctionReturn(node)
      const signature = sealSignature(callableSignatureOf(parameters, {
        cases: [],
        open: !AST.isFunctionDeclaration(node) || node.failureBound !== 'never',
      }, {
        inputDomain: parameter => resolution.ofParameter(parameter),
        accepts: (actual, expected) => resolution.compare(actual, expected) === 'compatible',
      }))
      const body = AST.isFunctionDeclaration(node) ? node.block : node.text
      const supportedBody = !!body && (!AST.isPhraseDeclaration(node) || node.forms.length === 0)
      descriptors.set(
        node,
        Object.freeze({
          declaration: node,
          parameters: Object.freeze([...parameters]),
          ...(body ? { body } : {}),
          kind: supportedBody ? 'source' : 'opaque',
          signature,
          result: sealType(result),
          pending: Object.freeze(
            !supportedBody || result.kind === 'unresolved'
              || signature.inputs.some(input => unresolvedDomain(input.type))
              ? [node]
              : [],
          ),
          convention: 'wrapped',
        }),
      )
    }
  }
  const calls = new Map<AST.Node, CanonicalCallPublication>()
  const reads = new Map<AST.Node, CanonicalReadPublication>()
  const inputs = new Map(
    [...descriptors.values()].flatMap(descriptor =>
      descriptor.signature?.inputs.map(input => [input.declaration, input] as const) ?? []
    ),
  )
  for (const node of nodes) {
    if (AST.isFunctionCallExpression(node) || AST.isMethodCallExpression(node)) {
      let pending = false
      const metadata: ArgumentBindingMetadata = {
        parameterName: Type.parameterName,
        parameterType: parameter => inputs.get(parameter)?.type ?? resolution.ofParameter(parameter),
        argumentType: argument => resolution.ofArgument(argument),
        accepts: (actual, expected) => {
          const result = resolution.compare(actual, expected)
          pending ||= result === 'pending'
          return result !== 'incompatible'
        },
      }
      const resolved = AST.isFunctionCallExpression(node)
        ? resolveFunctionInvocation(node, metadata)
        : resolveAssociatedMethodInvocation(node, {
          receiverType: resolution.receiverType,
          methodDeclaration: resolution.associatedMethodDeclaration,
          descriptor: declaration => associated.get(declaration),
          bindingMetadata: metadata,
        })
      const target = 'declaration' in resolved
        ? resolved.declaration
        : 'function' in resolved
        ? resolved.function
        : undefined
      const descriptor = target ? descriptors.get(target) : undefined
      const unresolved = AST.argumentsOf(node).some(argument => unresolvedDomain(resolution.ofArgument(argument)))
        || descriptor?.signature?.inputs.some(input => unresolvedDomain(input.type))
      const complete = !!descriptor && descriptor.pending.length === 0 && !pending && !unresolved
        && resolved.diagnostics.length === 0 && (!('problem' in resolved) || !resolved.problem)
      const receiver = AST.isMethodCallExpression(node) ? associatedMethodCallTarget(node)?.receiver : undefined
      calls.set(
        node,
        Object.freeze({
          site: node,
          operation: 'function',
          ...(target ? { target } : {}),
          ...(descriptor ? { descriptor } : {}),
          ...(receiver ? { receiver: sealReceiver(receiver) } : {}),
          ...('receiver' in resolved && resolved.receiver ? { receiverType: sealType(resolved.receiver) } : {}),
          pairs: Object.freeze(resolved.pairs.map(pair => Object.freeze({ ...pair }))),
          diagnostics: Object.freeze(resolved.diagnostics.map(diagnostic =>
            Object.freeze({
              ...diagnostic,
              ...('parameters' in diagnostic ? { parameters: Object.freeze([...diagnostic.parameters]) } : {}),
              ...('arguments' in diagnostic ? { arguments: Object.freeze([...diagnostic.arguments]) } : {}),
            })
          )),
          defaults: defaultEligibility(descriptor, resolved.pairs, complete),
          ...(complete ? { kind: 'complete' } as const : { kind: 'unknown', reason: 'incomplete-fact' } as const),
        }),
      )
    }
    if (AST.isValueReference(node) || AST.isMemberAccessExpression(node)) {
      reads.set(node, publishRead(node, resolution.ofReferenceRoot(node)))
    }
  }
  const snapshot: CanonicalEffectIndependentSnapshot = Object.freeze({
    [factoryBrand]: true as const,
    phase: 'correspondence',
    roots: Object.freeze([...files]),
    covered: immutableSet(nodes),
    descriptors: immutableMap(descriptors),
    associatedDescriptors: immutableMap(associated),
    calls: immutableMap(calls),
    reads: immutableMap(reads),
    natives: Object.freeze(
      (evidence.natives ?? []).map(native => Object.freeze({ ...native, ...sealEffectContract(native) })),
    ),
  })
  publishedSnapshots.add(snapshot)
  return snapshot
}

function sealReceiver(receiver: AssociatedMethodReceiver): AssociatedMethodReceiver {
  return Switch.kind(receiver, {
    expression: receiver => Object.freeze({ ...receiver }),
    'member-path': receiver => Object.freeze({ ...receiver, members: Object.freeze([...receiver.members]) }),
  })
}

function defaultEligibility(
  descriptor: CanonicalCallableDescriptor | undefined,
  pairs: readonly RenderInvocationPair[],
  complete: boolean,
): readonly CanonicalDefaultEligibility[] {
  return Object.freeze((descriptor?.parameters ?? []).flatMap(parameter => {
    if (!parameter.defaultValue) {
      return []
    }
    const supplied = pairs.some(pair => pair.parameter === parameter)
    const eligibility = !complete
      ? 'unknown'
      : descriptor?.convention !== 'wrapped'
      ? 'unknown'
      : supplied
      ? 'cannot'
      : 'may'
    const reason = !complete
      ? 'unresolved-binding'
      : descriptor?.convention !== 'wrapped'
      ? 'unknown-convention'
      : supplied
      ? 'provided-wrapper'
      : 'omitted'
    return [Object.freeze({ parameter, expression: parameter.defaultValue, eligibility, reason })]
  }))
}

function publishRead(
  reference: AST.ValueReference | AST.MemberAccessExpression,
  domain: TaoType,
): CanonicalReadPublication {
  const declaration = reference.target.ref
  const owner = AST.associatedReceiverOwner(reference)
  if (owner && declaration === owner && immutableReadDomain(domain)) {
    return Object.freeze({
      reference,
      declaration,
      classification: 'immutable',
      kind: 'complete',
      proof: Object.freeze({ kind: 'contextual-owner', owner }),
    })
  }
  if (AST.isParameterDeclaration(declaration)) {
    const method = AST.findOwningAssociatedFunction(declaration)
    const fn = AST.findOwningFunction(declaration)
    const phrase = AST.findOwningPhrase(declaration)
    const pureOwner = method ?? fn ?? phrase
    if (pureOwner && !declaration.mutable && !declaration.copy && immutableReadDomain(domain)) {
      return Object.freeze({
        reference,
        declaration,
        classification: 'immutable',
        kind: 'complete',
        proof: Object.freeze({ kind: 'parameter', owner: pureOwner }),
      })
    }
    if (!declaration.mutable && !declaration.copy) {
      return Object.freeze({
        reference,
        declaration,
        classification: 'unknown',
        kind: 'unknown',
        reason: 'incomplete-fact',
        proof: Object.freeze({ kind: 'parameter', owner: pureOwner ?? declaration }),
      })
    }
    return Object.freeze({
      reference,
      declaration,
      classification: 'reactive',
      kind: 'complete',
      proof: Object.freeze({ kind: 'parameter', owner: pureOwner ?? declaration }),
    })
  }
  if (AST.isStateDeclaration(declaration)) {
    return Object.freeze({
      reference,
      declaration,
      classification: 'reactive',
      kind: 'complete',
      proof: Object.freeze({ kind: 'state', owner: declaration }),
    })
  }
  if (AST.isAliasDeclaration(declaration)) {
    return Object.freeze({
      reference,
      declaration,
      classification: 'immutable',
      kind: 'complete',
      initializer: declaration.value,
      proof: Object.freeze({ kind: 'live-alias', owner: declaration }),
    })
  }
  return Object.freeze({
    reference,
    ...(declaration ? { declaration } : {}),
    classification: 'unknown',
    kind: 'unknown',
    reason: 'incomplete-fact',
  })
}

function inventoryNodes(files: readonly AST.TaoFile[], evidence: CanonicalEffectEvidence): Set<AST.Node> {
  const nodes = new Set<AST.Node>()
  const queue: AST.Node[] = []
  const enter = (node: AST.Node) => {
    if (!nodes.has(node)) {
      nodes.add(node)
      queue.push(node)
    }
  }
  files.forEach(enter)
  for (const [requirement] of evidence.requirements ?? []) {
    enter(requirement)
  }
  for (const native of evidence.natives ?? []) {
    enter(native.declaration)
    enter(native.exportSource)
  }
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index]!
    AST.streamContents(node).forEach(enter)
    if (AST.isFunctionCallExpression(node)) {
      const declaration = node.function.ref
      if (declaration) {
        enter(declaration)
      }
    }
    if (AST.isValueReference(node) || AST.isMemberAccessExpression(node)) {
      const declaration = node.target.ref
      if (declaration) {
        enter(declaration)
      }
    }
    if (AST.isNamedTypeReference(node)) {
      const declaration = Type.definitionOfReference(node)
      if (declaration) {
        enter(declaration)
      }
    }
  }
  return nodes
}

function immutableReadDomain(type: TaoType): boolean {
  return Switch.kind(type, {
    unresolved: () => false,
    primitive: () => true,
    union: type => type.members.every(immutableReadDomain),
    list: type => !!type.element && immutableReadDomain(type.element),
    item: () => false,
    entity: () => false,
    enum: () => true,
    capability: () => true,
  })
}

function sealAssociated(materialized: AssociatedDescriptorMaterialization): AssociatedDescriptorMaterialization {
  if (materialized.kind === 'pending') {
    return Object.freeze({ kind: 'pending', dependencies: Object.freeze([...materialized.dependencies]) })
  }
  const descriptor: AssociatedCallableDescriptor = Object.freeze({
    ...materialized.descriptor,
    receiver: sealType(materialized.descriptor.receiver),
    signature: sealSignature(materialized.descriptor.signature),
    result: sealType(materialized.descriptor.result),
  })
  return Object.freeze({ kind: 'ready', descriptor })
}

function sealSignature(signature: CallableSignature): CallableSignature {
  return Object.freeze({
    inputs: Object.freeze(signature.inputs.map(input => Object.freeze({ ...input, type: sealType(input.type) }))),
    failures: Object.freeze({ cases: Object.freeze([...signature.failures.cases]), open: signature.failures.open }),
  })
}

function sealEffectContract(contract: EffectContract): EffectContract {
  return Object.freeze({
    purity: Object.freeze({ violations: Object.freeze([...contract.purity.violations]), open: contract.purity.open }),
    failures: Object.freeze({ cases: Object.freeze([...contract.failures.cases]), open: contract.failures.open }),
  })
}

function sealType(type: TaoType): TaoType {
  return Switch.kind(type, {
    unresolved: type => Object.freeze({ ...type }),
    primitive: type =>
      Object.freeze(
        type.primitive === 'action'
          ? {
            ...type,
            parameters: Object.freeze(
              type.parameters.map(parameter => Object.freeze({ ...parameter, type: sealType(parameter.type) })),
            ),
          }
          : { ...type, ...(type.slots ? { slots: sealShape(type.slots) } : {}) },
      ),
    union: type => Object.freeze({ ...type, members: Object.freeze(type.members.map(sealType)) }),
    list: type => Object.freeze({ ...type, ...(type.element ? { element: sealType(type.element) } : {}) }),
    item: type => Object.freeze({ ...type, ...(type.item ? { item: sealShape(type.item) } : {}) }),
    entity: type => Object.freeze({ ...type }),
    enum: type => Object.freeze({ ...type }),
    capability: type => Object.freeze({ ...type }),
  })
}

function sealShape(shape: ItemShape): ItemShape {
  return Object.freeze({
    properties: Object.freeze([...shape.properties]),
    ...(shape.dataFields ? { dataFields: Object.freeze([...shape.dataFields]) } : {}),
    ...(shape.projectedEntity ? { projectedEntity: shape.projectedEntity } : {}),
  })
}

function unresolvedDomain(type: TaoType): boolean {
  return Switch.kind(type, {
    unresolved: () => true,
    primitive: type =>
      type.primitive === 'action' && type.parameters.some(parameter => unresolvedDomain(parameter.type)),
    union: type => type.members.some(unresolvedDomain),
    list: type => !!type.element && unresolvedDomain(type.element),
    item: () => false,
    entity: () => false,
    enum: () => false,
    capability: () => false,
  })
}

function immutableMap<Key, Value>(entries: ReadonlyMap<Key, Value>): ReadonlyMap<Key, Value> {
  const backing = new Map(entries)
  const view: ReadonlyMap<Key, Value> = Object.freeze({
    get size() {
      return backing.size
    },
    get: (key: Key) => backing.get(key),
    has: (key: Key) => backing.has(key),
    entries: () => backing.entries(),
    keys: () => backing.keys(),
    values: () => backing.values(),
    [Symbol.iterator]: () => backing[Symbol.iterator](),
    forEach: (callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void, thisArg?: unknown) =>
      backing.forEach((value, key) => callback.call(thisArg, value, key, view)),
  })
  return view
}

function immutableSet<Value>(entries: ReadonlySet<Value>): ReadonlySet<Value> {
  const backing = new Set(entries)
  const view: ReadonlySet<Value> = Object.freeze({
    get size() {
      return backing.size
    },
    has: (value: Value) => backing.has(value),
    entries: () => backing.entries(),
    keys: () => backing.keys(),
    values: () => backing.values(),
    [Symbol.iterator]: () => backing[Symbol.iterator](),
    forEach: (callback: (value: Value, key: Value, set: ReadonlySet<Value>) => void, thisArg?: unknown) =>
      backing.forEach(value => callback.call(thisArg, value, value, view)),
  })
  return view
}
