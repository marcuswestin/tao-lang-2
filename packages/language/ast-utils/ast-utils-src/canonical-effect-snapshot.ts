import { AST } from '@parser'
import { Assert, Switch } from '@shared'
import type { ArgumentBindingDiagnostic, ArgumentBindingMetadata, RenderInvocationPair } from './argument-bindings'
import { associatedConverterDescriptor, resolveAssociatedConversion } from './associated-converters'
import { resolveAssociatedMethodInvocation } from './associated-invocations'
import {
  type AssociatedCallableDeclaration,
  type AssociatedCallableDescriptor,
  type AssociatedCallableOwner,
  type AssociatedDescriptorMaterialization,
  associatedMethodCallTarget,
  type AssociatedMethodReceiver,
  associatedMethodTypeRoot,
  capabilityRequirements,
  hasAssociatedEffects,
  ownAssociatedMethods,
  ownAssociatedViews,
} from './associated-methods'
import type { NativeEffectPublication } from './callable-effect-facts'
import { type CallableSignature, callableSignatureOf } from './callable-signatures'
import { declaredCallableFailureContract } from './failure-contracts'
import { resolveFunctionInvocation } from './invocations'
import { type NumericUnitReading, resolveNumericUnitReading } from './numeric-unit-readings'
import { NumericUnits, type NumericUnitsSuffixResolution } from './NumericUnits'
import { type ItemShape, type TaoType, Type } from './Type'
import { type UnitFamily, type UnitReading, Units } from './Units'

type AssociatedDeclaration = AssociatedCallableDeclaration
type SourceCallable = AST.CallableDeclaration | AssociatedDeclaration | AST.AssociatedConverterDeclaration
type EffectContract = Pick<NativeEffectPublication, 'purity' | 'failures'>
type PublicationStatus =
  | Readonly<{ kind: 'complete'; reason?: never }>
  | Readonly<{ kind: 'unknown'; reason: 'incomplete-fact' | 'dynamic-target' | 'unclassified-native' }>

/** Source bodies remain real execution witnesses; their contracts are not purity promises. */
export type CanonicalCallableDescriptor = Readonly<{
  declaration: SourceCallable
  owner?: AssociatedCallableOwner
  parameters: readonly AST.ParameterDeclaration[]
  body?: AST.Node
  kind: 'source' | 'requirement' | 'opaque'
  signature?: CallableSignature
  result?: TaoType
  pending: readonly AST.Node[]
  convention: 'wrapped' | 'mounted' | 'raw-nullish' | 'unknown'
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
    site: AST.FunctionCallExpression | AST.MethodCallExpression | AST.ConversionExpression
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
    reference: AST.ValueReference | AST.MemberAccessExpression | AST.PostfixMemberAccess
    declaration?: AST.ValueReferenceTarget | AssociatedDeclaration
    classification: 'immutable' | 'reactive' | 'unknown'
    proof?:
      | Readonly<{
        kind: 'parameter' | 'contextual-owner' | 'state' | 'live-alias'
        owner: AST.Node
      }>
      | Readonly<{
        kind: 'static-method-selection'
        owner: AssociatedCallableOwner
        declaration: AssociatedDeclaration
        receiver: AST.Expression
      }>
      | Readonly<{
        kind: 'named-method-selection'
        owner: AssociatedCallableOwner
        declaration: AssociatedDeclaration
        receiver: AssociatedMethodReceiver
      }>
      | Readonly<{ kind: 'unit-selection'; owner: AST.TypeDeclaration; reading: NumericUnitReading }>
    initializer?: AST.Expression
  }>

/** Linked text wrapper construction executes its real operand without an implicit numeric check. */
export type CanonicalConstructorPublication =
  & PublicationStatus
  & EffectContract
  & Readonly<{
    site: AST.ConfigurationConstructor
    declaration?: AST.ConstructorDeclaration
    result: TaoType
    operands: readonly AST.Expression[]
  }>

/** Intrinsic contracts retain resolved unit witnesses and evaluate their actual source operands. */
export type CanonicalUnitOperationPublication =
  & EffectContract
  & Readonly<{
    kind: 'complete'
    site: AST.MethodCallExpression | AST.NumericUnitConstruction | AST.PostfixMemberAccess
    operands: readonly AST.Expression[]
    proof:
      | Readonly<{ kind: 'numeric-reading'; reading: NumericUnitReading }>
      | Readonly<{ kind: 'numeric-construction'; resolution: NumericUnitsSuffixResolution }>
      | Readonly<{
        kind: 'legacy-unit'
        receiver: TaoType
        family: UnitFamily
        unit: string
        ratio?: number
        reading?: UnitReading
      }>
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
  constructors: ReadonlyMap<AST.Node, CanonicalConstructorPublication>
  units: ReadonlyMap<AST.Node, CanonicalUnitOperationPublication>
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
  const associatedOwners = new Map<AssociatedDeclaration, AssociatedCallableOwner>()
  for (const node of nodes) {
    if (!AST.isTypeDeclaration(node) && !AST.isPrimitiveDeclaration(node) && !AST.isEntityDataDeclaration(node)) {
      continue
    }
    const declarations = AST.isTypeDeclaration(node)
      ? [...ownAssociatedMethods(node), ...ownAssociatedViews(node), ...capabilityRequirements(node)]
      : [...ownAssociatedMethods(node), ...ownAssociatedViews(node)]
    for (const declaration of declarations) {
      associated.set(declaration, sealAssociated(Type.associatedCallable(declaration, node)))
      associatedOwners.set(declaration, node)
    }
  }
  const resolution = Type.correspondenceResolver(associated)
  const nativeForwardOwners = nativeForwardingOwners(evidence)
  const descriptors = new Map<AST.Node, CanonicalCallableDescriptor>()
  for (const node of nodes) {
    if (
      AST.isAssociatedFunctionDeclaration(node) || AST.isCapabilityMethodDeclaration(node)
      || AST.isAssociatedViewDeclaration(node)
    ) {
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
          parameters: Object.freeze([...AST.parametersOf(node)]),
          ...(AST.isAssociatedFunctionDeclaration(node) || AST.isAssociatedViewDeclaration(node)
            ? { body: node.block }
            : {}),
          kind: requirement ? 'requirement' : 'source',
          pending: Object.freeze(contract?.kind === 'pending' ? [...contract.dependencies] : ready ? [] : [node]),
          convention: AST.isAssociatedViewDeclaration(node) ? 'mounted' : 'wrapped',
          ...(effects ? { contract: sealEffectContract(effects) } : {}),
        }),
      )
    } else if (AST.isAssociatedConverterDeclaration(node)) {
      const converter = associatedConverterDescriptor(node, resolution)
      const pending = !converter || converter.receiver.kind === 'unresolved' || converter.result.kind === 'unresolved'
      descriptors.set(
        node,
        Object.freeze({
          declaration: node,
          ...(converter
            ? {
              owner: converter.owner,
              signature: sealSignature(converter.signature),
              result: sealType(converter.result),
            }
            : {}),
          parameters: Object.freeze([]),
          body: node.block,
          kind: 'source',
          pending: Object.freeze(pending ? [node] : []),
          convention: 'wrapped',
        }),
      )
    } else if (AST.isFunctionDeclaration(node) || AST.isPhraseDeclaration(node)) {
      const parameters = AST.parametersOf(node)
      const result = AST.isPhraseDeclaration(node)
        ? { kind: 'primitive', primitive: 'text' } as const
        : node.returnType
        ? resolution.ofTypeExpression(node.returnType)
        : resolution.ofFunctionReturn(node)
      const signature = sealSignature(callableSignatureOf(
        parameters,
        AST.isFunctionDeclaration(node)
          ? declaredCallableFailureContract(node)
          : { cases: [], open: true },
        {
          inputDomain: parameter => resolution.ofParameter(parameter),
          accepts: (actual, expected) => resolution.compare(actual, expected) === 'compatible',
        },
      ))
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
  const units = new Map<AST.Node, CanonicalUnitOperationPublication>()
  const inputs = new Map(
    [...descriptors.values()].flatMap(descriptor =>
      descriptor.signature?.inputs.map(input => [input.declaration, input] as const) ?? []
    ),
  )
  for (const node of nodes) {
    const unit = publishUnitOperation(node, resolution)
    if (unit) {
      units.set(node, unit)
    }
    if (AST.isBinaryExpression(node) || AST.isUnaryExpression(node)) {
      const selected = resolution.associatedOperation(node)
      const builtIn = selected.problem === 'unsupported-operator'
        || (selected.problem === 'missing-operator' && resolution.ofExpression(node).kind !== 'unresolved')
      if (!builtIn) {
        const target = selected.descriptor?.declaration
        const declared = target ? descriptors.get(target) : undefined
        const descriptor = declared && selected.descriptor
          ? Object.freeze({
            ...declared,
            signature: sealSignature(selected.descriptor.signature),
            result: sealType(selected.result),
          })
          : declared
        const complete = !!descriptor && descriptor.pending.length === 0 && !selected.problem
        calls.set(
          node,
          Object.freeze({
            site: node,
            operation: 'function',
            ...(target ? { target } : {}),
            ...(descriptor ? { descriptor } : {}),
            ...(selected.receiver
              ? { receiver: Object.freeze({ kind: 'expression', expression: selected.receiver }) }
              : {}),
            ...(selected.operandTypes[0] ? { receiverType: sealType(selected.operandTypes[0]) } : {}),
            pairs: Object.freeze([]),
            operands: Object.freeze([...selected.operands]),
            operandPairs: Object.freeze(
              selected.pairs.map(pair => Object.freeze({ ...pair, type: sealType(pair.type) })),
            ),
            diagnostics: Object.freeze([]),
            defaults: Object.freeze([]),
            ...(complete ? { kind: 'complete' } as const : { kind: 'unknown', reason: 'incomplete-fact' } as const),
          }),
        )
      }
    }
    if (AST.isConversionExpression(node)) {
      const conversion = resolveAssociatedConversion(node, resolution)
      const target = conversion.descriptor?.declaration
      const descriptor = target ? descriptors.get(target) : undefined
      const complete = !!descriptor && descriptor.pending.length === 0 && !conversion.problem
      calls.set(
        node,
        Object.freeze({
          site: node,
          operation: 'function',
          ...(target ? { target } : {}),
          ...(descriptor ? { descriptor } : {}),
          receiver: Object.freeze({ kind: 'expression', expression: node.value }),
          receiverType: sealType(conversion.source),
          pairs: Object.freeze([]),
          diagnostics: Object.freeze([]),
          defaults: Object.freeze([]),
          ...(complete ? { kind: 'complete' } as const : { kind: 'unknown', reason: 'incomplete-fact' } as const),
        }),
      )
    }
    if (AST.isFunctionCallExpression(node) || (AST.isMethodCallExpression(node) && !unit)) {
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
      const declaredDescriptor = target ? descriptors.get(target) : undefined
      const instantiation = target && (AST.isFunctionDeclaration(target) || AST.isAssociatedFunctionDeclaration(target))
          && target.genericParameters.length > 0
        ? resolution.instantiateGenericInvocation(target, AST.argumentsOf(node), {
          ...metadata,
          parameterType: parameter =>
            ('transportTypes' in resolved ? resolved.transportTypes?.get(parameter) : undefined)
              ?? metadata.parameterType!(parameter),
        })
        : undefined
      const descriptor = declaredDescriptor && instantiation
        ? Object.freeze({
          ...declaredDescriptor,
          ...(declaredDescriptor.signature
            ? {
              signature: sealSignature({
                ...declaredDescriptor.signature,
                inputs: declaredDescriptor.signature.inputs.map(input => ({
                  ...input,
                  type: instantiation.parameterTypes.get(input.declaration) ?? input.type,
                })),
              }),
            }
            : {}),
          result: sealType(
            AST.isMethodCallExpression(node) && 'descriptor' in resolved && resolved.descriptor
              ? resolved.descriptor.result
              : instantiation.result,
          ),
          pending: Object.freeze(
            instantiation.genericDiagnostics.length > 0 ? [target!] : [...declaredDescriptor.pending],
          ),
        })
        : declaredDescriptor
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
  }
  const constructors = new Map<AST.Node, CanonicalConstructorPublication>()
  for (const node of nodes) {
    if (AST.isConfigurationConstructor(node)) {
      const declaration = node.type.ref
      const result = resolution.ofExpression(node)
      const complete = AST.isTypeDeclaration(declaration) && !!node.value && !node.block
        && node.members.length === 0 && result.kind === 'primitive' && result.primitive === 'text'
        && !Type.isAbstractDomain(result)
      constructors.set(
        node,
        Object.freeze({
          site: node,
          ...(declaration ? { declaration } : {}),
          result: sealType(result),
          operands: Object.freeze(node.value ? [node.value] : []),
          ...sealEffectContract({
            purity: { violations: [], open: false },
            failures: { cases: [], open: false },
          }),
          ...(complete ? { kind: 'complete' } as const : { kind: 'unknown', reason: 'incomplete-fact' } as const),
        }),
      )
    }
    if (AST.isValueReference(node) || AST.isMemberAccessExpression(node)) {
      const domain = resolution.ofReferenceRoot(node)
      const call = AST.isMemberAccessExpression(node) && AST.isMethodCallExpression(node.$container)
          && node.$container.callee === node
        ? calls.get(node.$container)
        : undefined
      const receiver = call?.kind === 'complete' && call.receiver?.kind === 'member-path'
          && call.receiver.site === node && call.receiver.members.length === 1
        ? call.receiver
        : undefined
      const selectedDomain = AST.isMemberAccessExpression(node) && domain.kind === 'item' && node.members.length === 1
        ? resolution.atMemberPath(domain, node.members)
        : domain.kind === 'item' && receiver
        ? resolution.atMemberPath(domain, receiver.members)
        : domain
      const selection = AST.isMemberAccessExpression(node)
        ? publishNamedMethodSelection(node, calls.get(node.$container))
        : undefined
      reads.set(node, selection ?? publishRead(node, domain, selectedDomain, nativeForwardOwners))
    }
    if (
      AST.isPostfixMemberAccess(node) && AST.isMethodCallExpression(node.$container)
      && node.$container.callee === node
    ) {
      const unit = units.get(node.$container)
      if (unit?.proof.kind === 'numeric-reading') {
        reads.set(
          node,
          Object.freeze({
            reference: node,
            classification: 'immutable',
            kind: 'complete',
            proof: Object.freeze({
              kind: 'unit-selection',
              owner: unit.proof.reading.concreteFactoryOwner,
              reading: unit.proof.reading,
            }),
          }),
        )
        continue
      }
      const receiver = resolution.ofExpression(node.receiver)
      const declaration = receiver.kind === 'capability'
        ? capabilityRequirements(receiver.declaration).find(method => method.name === node.member)
        : resolution.associatedMethodDeclaration(receiver, node.member)?.declaration
      const descriptor = declaration ? associated.get(declaration) : undefined
      reads.set(
        node,
        Object.freeze({
          reference: node,
          ...(declaration ? { declaration } : {}),
          ...(descriptor?.kind === 'ready'
            ? {
              classification: 'immutable',
              kind: 'complete',
              proof: Object.freeze({
                kind: 'static-method-selection',
                owner: descriptor.descriptor.owner,
                declaration: descriptor.descriptor.declaration,
                receiver: node.receiver,
              }),
            } as const
            : { classification: 'unknown', kind: 'unknown', reason: 'incomplete-fact' } as const),
        }),
      )
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
    constructors: immutableMap(constructors),
    units: immutableMap(units),
    natives: Object.freeze(
      (evidence.natives ?? []).map(native => Object.freeze({ ...native, ...sealEffectContract(native) })),
    ),
  })
  publishedSnapshots.add(snapshot)
  return snapshot
}

function publishUnitOperation(
  node: AST.Node,
  resolution: ReturnType<typeof Type.correspondenceResolver>,
): CanonicalUnitOperationPublication | undefined {
  if (!AST.isMethodCallExpression(node) && !AST.isNumericUnitConstruction(node) && !AST.isPostfixMemberAccess(node)) {
    return undefined
  }
  const contract = sealEffectContract({
    purity: { violations: [], open: false },
    // Checked quantity ingress and views have independently modeled runtime failure cases.
    failures: { cases: [], open: true },
  })
  if (AST.isMethodCallExpression(node)) {
    const target = associatedMethodCallTarget(node)
    if (!target || associatedMethodTypeRoot(target.receiver)) {
      return undefined
    }
    const selected = resolveNumericUnitReading(node, { receiverType: resolution.receiverType })
    if (selected.kind !== 'unit-reading') {
      return undefined
    }
    const reading: NumericUnitReading = Object.freeze({
      ...selected.reading,
      receiverAnchor: sealReceiver(selected.reading.receiverAnchor),
      receiverType: sealType(selected.reading.receiverType),
      resultType: sealType(selected.reading.resultType),
    })
    return Object.freeze({
      ...contract,
      kind: 'complete',
      site: node,
      operands: Object.freeze([node.callee]),
      proof: Object.freeze({ kind: 'numeric-reading', reading }),
    })
  }
  if (AST.isNumericUnitConstruction(node)) {
    const selected = NumericUnits.resolveSuffix(node)
    const input = resolution.ofExpression(node.input)
    if (
      !selected || !AST.numericUnitConstructionInputIsAllowed(node)
      || input.kind !== 'primitive' || input.primitive !== 'number'
    ) {
      return undefined
    }
    const plan = Object.freeze({
      ...selected.plan,
      units: Object.freeze(selected.plan.units.map(unit => Object.freeze({ ...unit }))),
    })
    return Object.freeze({
      ...contract,
      kind: 'complete',
      site: node,
      operands: Object.freeze([node.input]),
      proof: Object.freeze({
        kind: 'numeric-construction',
        resolution: Object.freeze({ plan, unit: Object.freeze({ ...selected.unit }) }),
      }),
    })
  }
  if (
    !AST.isPostfixMemberAccess(node)
    || (AST.isMethodCallExpression(node.$container) && node.$container.callee === node)
  ) {
    return undefined
  }
  const receiver = resolution.ofExpression(node.receiver)
  if (receiver.kind !== 'primitive') {
    return undefined
  }
  const family = receiver.primitive === 'number'
    ? Units.familyOf(node.member)
    : Units.isFamily(receiver.primitive)
    ? receiver.primitive
    : undefined
  if (!family) {
    return undefined
  }
  const ratio = Units.ratioToBase(family, node.member)
  const reading = receiver.primitive !== 'number' ? Units.readingOf(family, node.member) : undefined
  if (ratio === undefined && !reading) {
    return undefined
  }
  return Object.freeze({
    ...contract,
    kind: 'complete',
    site: node,
    operands: Object.freeze([node.receiver]),
    proof: Object.freeze({
      kind: 'legacy-unit',
      receiver: sealType(receiver),
      family,
      unit: node.member,
      ...(ratio !== undefined ? { ratio } : {}),
      ...(reading ? { reading } : {}),
    }),
  })
}

function sealReceiver(receiver: AssociatedMethodReceiver): AssociatedMethodReceiver {
  return Switch.kind(receiver, {
    expression: receiver => Object.freeze({ ...receiver }),
    'member-path': receiver => Object.freeze({ ...receiver, members: Object.freeze([...receiver.members]) }),
  })
}

/** Direct named selection retains its real receiver; field paths still need ordinary read evidence. */
function publishNamedMethodSelection(
  reference: AST.MemberAccessExpression,
  call: CanonicalCallPublication | undefined,
): CanonicalReadPublication | undefined {
  if (
    !AST.isMethodCallExpression(reference.$container) || reference.$container.callee !== reference
    || call?.kind !== 'complete' || !call.descriptor?.owner || !call.target
    || (!AST.isAssociatedFunctionDeclaration(call.target) && !AST.isCapabilityMethodDeclaration(call.target)
      && !AST.isAssociatedViewDeclaration(call.target))
    || call.receiver?.kind !== 'member-path' || call.receiver.members.length !== 0
  ) {
    return undefined
  }
  const declaration = reference.target.ref
  const owner = AST.findOwningAssociatedFunction(reference) ?? AST.findOwningFunction(reference)
    ?? AST.findOwningPhrase(reference)
  const ownParameter = AST.isParameterDeclaration(declaration) && !declaration.mutable && !declaration.copy
    && !!owner && AST.parametersOf(owner).includes(declaration)
  if (!associatedMethodTypeRoot(call.receiver) && !ownParameter) {
    return undefined
  }
  return Object.freeze({
    reference,
    declaration: call.target,
    classification: 'immutable',
    kind: 'complete',
    proof: Object.freeze({
      kind: 'named-method-selection',
      owner: call.descriptor.owner,
      declaration: call.target,
      receiver: call.receiver,
    }),
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

/** A real declared foreign call head witnesses only its wrapper's direct binding transports. */
function nativeForwardingOwners(
  evidence: CanonicalEffectEvidence,
): ReadonlyMap<AST.FunctionCallExpression, AST.FunctionDeclaration | AST.AssociatedFunctionDeclaration> {
  const owners = new Map<AST.FunctionCallExpression, AST.FunctionDeclaration | AST.AssociatedFunctionDeclaration>()
  for (const native of evidence.natives ?? []) {
    const call = native.declaration
    if (
      native.kind !== 'complete' || native.phase !== 'evaluation' || native.purity.open
      || native.purity.violations.length > 0 || !AST.isFunctionCallExpression(call)
      || native.exportSource !== call
    ) {
      continue
    }
    const bridge = call.$container
    if (!AST.isFromExpression(bridge) || bridge.expression !== call) {
      continue
    }
    const statement = bridge.$container
    if (!AST.isReturnStatement(statement) || statement.value !== bridge) {
      continue
    }
    let owner: AST.Node | undefined = statement.$container
    while (owner !== undefined) {
      if (AST.isFunctionDeclaration(owner) || AST.isAssociatedFunctionDeclaration(owner)) {
        if (owner.returnType) {
          owners.set(call, owner)
        }
        break
      }
      if (
        AST.isAssociatedConverterDeclaration(owner) || AST.isActionDeclaration(owner) || AST.isCommandDeclaration(owner)
      ) {
        break
      }
      owner = owner.$container
    }
  }
  return owners
}

/** Forwarding a bound handle evaluates its identity, while member reads keep live ownership. */
function nativeHandleTransport(
  reference: AST.ValueReference | AST.MemberAccessExpression,
  domain: TaoType,
  owner: AST.Node,
  nativeForwardOwners: ReadonlyMap<
    AST.FunctionCallExpression,
    AST.FunctionDeclaration | AST.AssociatedFunctionDeclaration
  >,
): boolean {
  if (nativeArgumentOwner(reference, nativeForwardOwners) !== owner) {
    return false
  }
  return domain.kind === 'entity'
    ? AST.isEntityDataDeclaration(domain.entity)
    : domain.kind === 'list' && domain.element?.kind === 'entity' && AST.isEntityDataDeclaration(domain.element.entity)
}

function nativeArgumentOwner(
  reference: AST.ValueReference | AST.MemberAccessExpression,
  nativeForwardOwners: ReadonlyMap<
    AST.FunctionCallExpression,
    AST.FunctionDeclaration | AST.AssociatedFunctionDeclaration
  >,
): AST.FunctionDeclaration | AST.AssociatedFunctionDeclaration | undefined {
  if (!AST.isValueReference(reference)) {
    return undefined
  }
  const argument = reference.$container
  if (!AST.isArgument(argument) || argument.value !== reference) {
    return undefined
  }
  const call = argument.$container?.$container
  if (
    !AST.isFunctionCallExpression(call) || call.argumentList !== argument.$container
  ) {
    return undefined
  }
  return nativeForwardOwners.get(call)
}

function publishRead(
  reference: AST.ValueReference | AST.MemberAccessExpression,
  domain: TaoType,
  selectedDomain: TaoType = domain,
  nativeForwardOwners: ReadonlyMap<
    AST.FunctionCallExpression,
    AST.FunctionDeclaration | AST.AssociatedFunctionDeclaration
  > = new Map(),
): CanonicalReadPublication {
  const declaration = reference.target.ref
  const owner = AST.associatedReceiverOwner(reference)
  const forwardingMethod = nativeArgumentOwner(reference, nativeForwardOwners)
  const contextualTransport = forwardingMethod && AST.isAssociatedFunctionDeclaration(forwardingMethod)
    && !forwardingMethod.static && AST.findOwningAssociatedFunction(reference) === forwardingMethod
    && 'nominal' in domain && domain.nominal === owner
  const contextualItemField = AST.isMemberAccessExpression(reference) && AST.isTypeDeclaration(owner)
    && domain.kind === 'item' && domain.nominal === owner && selectedDomain !== domain
    && immutableReadDomain(selectedDomain)
  const contextualEntityIdentity = AST.isMemberAccessExpression(reference) && AST.isEntityDataDeclaration(owner)
    && domain.kind === 'entity' && domain.entity === owner && reference.shade === undefined
    && reference.members.length === 1 && reference.members[0] === 'Id'
  if (
    owner && declaration === owner
    && (immutableReadDomain(domain) || contextualItemField || contextualEntityIdentity || contextualTransport)
  ) {
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
    if (
      pureOwner && !declaration.mutable && !declaration.copy
      && (immutableReadDomain(selectedDomain)
        || nativeHandleTransport(reference, domain, pureOwner, nativeForwardOwners))
    ) {
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
  const domain: TaoType = {
    ...type,
    ...(type.genericBounds ? { genericBounds: Object.freeze(type.genericBounds.map(sealType)) } : {}),
    ...(type.genericReceiver ? { genericReceiver: sealType(type.genericReceiver) } : {}),
  }
  return Switch.kind(domain, {
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
