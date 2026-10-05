import { AST } from '@parser'
import type { CallableSignature } from './callable-signatures'
import type { TaoType } from './Type'

/** Declared callable contracts are resolved before effect discovery or structural admission. */
export type AssociatedCallableDescriptor = Readonly<{
  declaration: AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration
  owner: AST.TypeDeclaration
  /** The owner body sees this domain; an inherited method retains its original owner. */
  receiver: TaoType
  signature: CallableSignature
  result: TaoType
}>

/** A selected implementation retains both the actual nominal domain and its defining owner. */
export type AssociatedMethodSelection = Readonly<{
  receiver: TaoType
  descriptor: AssociatedCallableDescriptor
}>

export type AssociatedMethodReceiver =
  | Readonly<{ kind: 'member-path'; site: AST.MemberAccessExpression; members: readonly string[] }>
  | Readonly<{ kind: 'expression'; expression: AST.Expression }>

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
  receiver(owner: AST.TypeDeclaration): TaoType
  signature(declaration: AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration): CallableSignature
  result(declaration: AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration): TaoType
}>

export type AssociatedDescriptorMaterialization =
  | Readonly<{ kind: 'ready'; descriptor: AssociatedCallableDescriptor }>
  | Readonly<{ kind: 'pending'; dependencies: readonly AST.Node[] }>

/** Materialization does no matching, effect analysis, or provisional structural admission. */
export function materializeAssociatedCallable(
  declaration: AST.AssociatedFunctionDeclaration | AST.CapabilityMethodDeclaration,
  owner: AST.TypeDeclaration,
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
export function ownAssociatedMethods(owner: AST.TypeDeclaration): readonly AST.AssociatedFunctionDeclaration[] {
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
