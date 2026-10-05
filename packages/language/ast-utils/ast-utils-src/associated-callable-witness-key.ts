import { AST } from '@parser'
import type { AssociatedCallableDeclaration, AssociatedCallableDescriptor } from './associated-methods'

export type AssociatedOperatorWitnessDeclaration =
  | AST.AssociatedFunctionDeclaration
  | AST.CapabilityMethodDeclaration

/**
 * Module publication preallocates collision-safe private keys for actual defining declarations
 * and shares this context with publication, attachment, reprojection, defaults and invocation.
 * Allocating or comparing semantic contracts is the caller's responsibility.
 */
export type AssociatedCallableWitnessKeyContext = Readonly<{
  operatorKey(declaration: AssociatedOperatorWitnessDeclaration): string | undefined
}>

const operators = new Set(['+', '-', '*', '/', '==', '!=', '<', '<=', '>', '>='])

/**
 * Defining declarations survive specialization and reprojection. Operator keys require an
 * explicit allocation proof; this helper never infers contract equality or falls back to names.
 */
export function associatedCallableWitnessKey(
  callable: AssociatedCallableDeclaration | Pick<AssociatedCallableDescriptor, 'declaration'>,
  context?: AssociatedCallableWitnessKeyContext,
): string | undefined {
  const declaration = 'declaration' in callable ? callable.declaration : callable
  if (!operators.has(declaration.name)) {
    return declaration.name
  }
  if (AST.isAssociatedViewDeclaration(declaration)) {
    return undefined
  }
  return context?.operatorKey(declaration)
}
