import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'

let activeInstrumentation: boolean | undefined

/**
 * withActionInstrumentation scopes debugger gates to one synchronous generated-module pass. An
 * instrumented body awaits `TR.Debug.At` before every statement, so every action block is async.
 */
export function withActionInstrumentation<ResultT>(enabled: boolean, compile: () => ResultT): ResultT {
  Assert(activeInstrumentation === undefined, 'action instrumentation compilation is not nested')
  activeInstrumentation = enabled
  try {
    return compile()
  } finally {
    activeInstrumentation = undefined
  }
}

/** Whether this compilation emits debugger gates. */
export function actionInstrumentationEnabled(): boolean {
  return activeInstrumentation === true
}

/** Whether executing this block can suspend its owning action transaction. */
export function actionBlockRequiresAsync(
  block: AST.ActionBlock | undefined,
  seen: ReadonlySet<AST.ActionDeclaration> = new Set(),
): boolean {
  if (actionInstrumentationEnabled()) {
    return true
  }
  return block?.statements.some(statement => {
    if (AST.isSetStatement(statement) || AST.isToggleStatement(statement)) {
      // A parameter may be an action-backed native mapping. Owned state commits synchronously.
      return AST.isParameterDeclaration(statement.target.ref)
    }
    if (
      AST.isAskStatement(statement) || AST.isActionResultStatement(statement)
      || AST.isGuardActionStatement(statement) || AST.isIfActionStatement(statement)
      || AST.isWhenDoStatement(statement)
    ) {
      return true
    }
    if (AST.isDeferStatement(statement)) {
      return statement.block
        ? actionBlockRequiresAsync(statement.block, seen)
        : statement.invocation === undefined || actionInvocationRequiresAsync(statement.invocation, seen)
    }
    return AST.isDoStatement(statement)
      && (statement.then || actionInvocationRequiresAsync(statement, seen))
  }) ?? false
}

/** Whether a statically resolved `do` target can suspend; dynamic callbacks remain conservative. */
export function actionInvocationRequiresAsync(
  invocation: AST.DoStatement,
  seen: ReadonlySet<AST.ActionDeclaration> = new Set(),
): boolean {
  const action = ASTUtils.resolveActionInvocation(invocation).action
  if (!action) {
    return true
  }
  // A command runs the one action its `do` clause names, so it needs whatever that action needs.
  const target = AST.isCommandDeclaration(action) ? commandActionTarget(action) : action
  if (!target) {
    return true
  }
  if (AST.isActionExpression(target)) {
    return actionBlockRequiresAsync(target.block, seen)
  }
  if (target.foreign || seen.has(target)) {
    return true
  }
  const next = new Set(seen)
  next.add(target)
  return actionBlockRequiresAsync(target.block, next)
}

function commandActionTarget(
  command: AST.CommandDeclaration,
): AST.ActionDeclaration | AST.ActionExpression | undefined {
  const clause = AST.commandDoClauseOf(command)
  if (!clause) {
    return undefined
  }
  if (AST.isActionExpression(clause.action)) {
    return clause.action
  }
  const target = ASTUtils.resolveActionTarget(clause.action)
  return target.kind === 'named' && AST.isActionDeclaration(target.action) ? target.action : undefined
}

/** Whether this callback must be allowed to interrupt a suspended `ask`. */
export function actionBlockInterruptsAsk(
  block: AST.ActionBlock | undefined,
  seen: ReadonlySet<AST.ActionDeclaration> = new Set(),
): boolean {
  return block?.statements.some(statement => {
    // Cancelling an asked view must cross the same suspended action as answering it. Ordinary
    // content dismissals keep the normal root queue and cannot interrupt an unrelated ask.
    if (
      AST.isRespondStatement(statement)
      || (AST.isDismissStatement(statement) && AST.findOwningView(statement)?.response !== undefined)
    ) {
      return true
    }
    if (AST.isDoStatement(statement)) {
      return actionInvocationInterruptsAsk(statement, seen)
    }
    if (AST.isAsyncActionStatement(statement)) {
      return actionBlockInterruptsAsk(statement.block, seen)
    }
    if (AST.isIfActionStatement(statement)) {
      return actionBlockInterruptsAsk(statement.block, seen)
    }
    if (AST.isGuardActionStatement(statement)) {
      return ASTUtils.guardBranches(statement).some(branch => actionBlockInterruptsAsk(branch.block, seen))
    }
    if (AST.isWhenDoStatement(statement)) {
      return actionInvocationInterruptsAsk(statement.invocation, seen)
        || statement.outcomes.some(outcome => actionBlockInterruptsAsk(outcome.block, seen))
    }
    return false
  }) ?? false
}

function actionInvocationInterruptsAsk(
  invocation: AST.DoStatement,
  seen: ReadonlySet<AST.ActionDeclaration>,
): boolean {
  const action = ASTUtils.resolveActionInvocation(invocation).action
  const target = AST.isCommandDeclaration(action) ? commandActionTarget(action) : action
  if (!target) {
    return false
  }
  if (AST.isActionExpression(target)) {
    return actionBlockInterruptsAsk(target.block, seen)
  }
  if (target.foreign || seen.has(target)) {
    return false
  }
  return actionBlockInterruptsAsk(target.block, new Set([...seen, target]))
}
