import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'

/** Whether executing this block can suspend its owning action transaction. */
export function actionBlockRequiresAsync(
  block: AST.ActionBlock | undefined,
  seen: ReadonlySet<AST.ActionDeclaration> = new Set(),
): boolean {
  return block?.statements.some(statement => {
    if (AST.isAskStatement(statement) || AST.isGuardActionStatement(statement) || AST.isIfActionStatement(statement)) {
      return true
    }
    return AST.isDoStatement(statement) && actionInvocationRequiresAsync(statement, seen)
  }) ?? false
}

/** Whether a statically resolved `do` target can suspend; dynamic callbacks remain conservative. */
export function actionInvocationRequiresAsync(
  invocation: AST.DoStatement,
  seen: ReadonlySet<AST.ActionDeclaration> = new Set(),
): boolean {
  const action = ASTUtils.resolveActionInvocation(invocation).action
  if (!action || action.foreign || seen.has(action)) {
    return true
  }
  const next = new Set(seen)
  next.add(action)
  return actionBlockRequiresAsync(action.block, next)
}

/** Whether this callback must be allowed to interrupt a suspended `ask`. */
export function actionBlockContainsRespond(block: AST.ActionBlock | undefined): boolean {
  return block?.statements.some(statement => {
    if (AST.isRespondStatement(statement)) {
      return true
    }
    if (AST.isAsyncActionStatement(statement)) {
      return actionBlockContainsRespond(statement.block)
    }
    if (AST.isIfActionStatement(statement)) {
      return actionBlockContainsRespond(statement.block)
    }
    if (AST.isGuardActionStatement(statement)) {
      return ASTUtils.guardBranches(statement).some(branch => actionBlockContainsRespond(branch.block))
    }
    return false
  }) ?? false
}
