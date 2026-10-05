import { AST } from '@parser'
import { Assert } from '@shared'
import type { CallableAnalysis } from './callable-effects'
import type { CallableSignature } from './callable-signatures'
import type { TaoType } from './Type'

export type AssociatedCallableOwner = AST.TypeDeclaration | AST.PrimitiveDeclaration

/** Declared callable contracts are resolved before effect discovery or structural admission. */
export type AssociatedCallableDescriptor = Readonly<{
  declaration: AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration
  owner: AssociatedCallableOwner
  /** The owner body sees this domain; an inherited method retains its original owner. */
  receiver: TaoType
  signature: CallableSignature
  result: TaoType
}>

/** Final admission consumes only contracts and analyses sealed for the current AST generation. */
export type AssociatedEffectsContext = Readonly<{
  descriptors: ReadonlyMap<
    AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration,
    AssociatedCallableDescriptor
  >
  analyses: ReadonlyMap<AST.Node, CallableAnalysis>
}>

type AssociatedAdmissionContext = AssociatedEffectsContext & {
  visiting: Map<AST.TypeDeclaration, Set<AST.TypeDeclaration>>
}

let associatedEffectsContext: AssociatedAdmissionContext | undefined

/** Copy the sealed maps and keep their dynamic lifetime synchronous, including nested admission. */
export function withAssociatedEffects<T>(context: AssociatedEffectsContext, consumeSync: () => T): T {
  const previous = associatedEffectsContext
  associatedEffectsContext = {
    descriptors: new Map(context.descriptors),
    analyses: new Map(context.analyses),
    visiting: new Map(),
  }
  try {
    return consumeAssociatedSync(consumeSync)
  } finally {
    associatedEffectsContext = previous
  }
}

export function hasAssociatedEffects(): boolean {
  return associatedEffectsContext !== undefined
}

export function associatedCallableDescriptor(
  declaration: AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration,
): AssociatedCallableDescriptor | undefined {
  return associatedEffectsContext?.descriptors.get(declaration)
}

export function associatedCallableAnalysis(declaration: AST.Node): CallableAnalysis | undefined {
  return associatedEffectsContext?.analyses.get(declaration)
}

/** A repeated real declaration pair cannot justify structural admission through itself. */
export function withAssociatedAdmissionPair(
  actual: AST.TypeDeclaration,
  expected: AST.TypeDeclaration,
  consumeSync: () => boolean,
): boolean {
  const context = associatedEffectsContext
  if (!context) {
    return false
  }
  const expectedDeclarations = context.visiting.get(actual) ?? new Set<AST.TypeDeclaration>()
  if (expectedDeclarations.has(expected)) {
    return false
  }
  context.visiting.set(actual, expectedDeclarations)
  expectedDeclarations.add(expected)
  try {
    return consumeAssociatedSync(consumeSync)
  } finally {
    expectedDeclarations.delete(expected)
    if (expectedDeclarations.size === 0) {
      context.visiting.delete(actual)
    }
  }
}

function consumeAssociatedSync<T>(consumeSync: () => T): T {
  const result = consumeSync()
  Assert(
    !(result !== null && (typeof result === 'object' || typeof result === 'function')
      && 'then' in result && typeof result.then === 'function'),
    'associated admission consumers return synchronously.',
  )
  return result
}

/** A selected implementation retains both the actual nominal domain and its defining owner. */
export type AssociatedMethodSelection = Readonly<{
  receiver: TaoType
  descriptor: AssociatedCallableDescriptor
}>

export type AssociatedMethodReceiver =
  | Readonly<{ kind: 'member-path'; site: AST.MemberAccessExpression; members: readonly string[] }>
  | Readonly<{ kind: 'expression'; expression: AST.Expression }>

export type AssociatedMethodDispatch = 'instance' | 'static'

/** A static root is an authored type reference, never a value carrying that type. */
export function associatedMethodTypeRoot(receiver: AssociatedMethodReceiver): AST.TypeDeclaration | undefined {
  const reference = receiver.kind === 'member-path'
    ? receiver.members.length === 0 ? receiver.site : undefined
    : AST.isValueReference(receiver.expression)
    ? receiver.expression
    : undefined
  if (!reference || !AST.isTypeDeclaration(reference.target.ref)) {
    return undefined
  }
  const owner = reference.target.ref
  const method = AST.findOwningAssociatedFunction(reference)
  const instanceBody = method ? !method.static : AST.findOwningAssociatedConverter(reference) !== undefined
  return instanceBody && AST.associatedReceiverOwner(reference) === owner ? undefined : owner
}

export type AssociatedMethodCallTarget = Readonly<{
  name: string
  receiver: AssociatedMethodReceiver
}>

/** Split a real postfix callee without creating an expression or losing its reference anchor. */
export function associatedMethodCallTarget(call: AST.MethodCallExpression): AssociatedMethodCallTarget | undefined {
  const callee = call.callee
  if (AST.isMemberAccessExpression(callee) && callee.shade === undefined && callee.members.length > 0) {
    return {
      name: callee.members.at(-1)!,
      receiver: { kind: 'member-path', site: callee, members: callee.members.slice(0, -1) },
    }
  }
  if (AST.isPostfixMemberAccess(callee)) {
    return { name: callee.member, receiver: { kind: 'expression', expression: callee.receiver } }
  }
  return undefined
}

export type AssociatedDescriptorResolver = Readonly<{
  receiver(owner: AssociatedCallableOwner): TaoType
  signature(declaration: AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration): CallableSignature
  result(declaration: AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration): TaoType
}>

export type AssociatedDescriptorMaterialization =
  | Readonly<{ kind: 'ready'; descriptor: AssociatedCallableDescriptor }>
  | Readonly<{ kind: 'pending'; dependencies: readonly AST.Node[] }>

/** Materialization does no matching, effect analysis, or provisional structural admission. */
export function materializeAssociatedCallable(
  declaration: AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration,
  owner: AssociatedCallableOwner,
  resolver: AssociatedDescriptorResolver,
): AssociatedDescriptorMaterialization {
  const descriptor: AssociatedCallableDescriptor = Object.freeze({
    declaration,
    owner,
    receiver: resolver.receiver(owner),
    signature: resolver.signature(declaration),
    result: resolver.result(declaration),
  })
  if (
    descriptor.receiver.kind === 'unresolved' || descriptor.result.kind === 'unresolved'
    || descriptor.signature.inputs.some(input => input.type.kind === 'unresolved')
  ) {
    return Object.freeze({ kind: 'pending', dependencies: Object.freeze([declaration]) })
  }
  return Object.freeze({ kind: 'ready', descriptor })
}

/** Own members remain separate from record properties and numeric construction members. */
export function ownAssociatedMethods(owner: AssociatedCallableOwner): readonly AST.AssociatedFunctionDeclaration[] {
  if (AST.isPrimitiveDeclaration(owner)) {
    return owner.slots?.methods ?? []
  }
  const type = owner.type
  const slots = type && AST.isDerivedTypeExpression(type)
    ? type.slots
    : type && AST.isItemTypeExpression(type)
    ? type
    : undefined
  return slots?.methods ?? []
}

export function capabilityRequirements(owner: AST.TypeDeclaration): readonly AST.CapabilityMethodDeclaration[] {
  return owner.type && AST.isCapabilityTypeExpression(owner.type) ? owner.type.methods : []
}
