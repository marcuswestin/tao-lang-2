import { AST } from '@parser'
import { resolveActionTarget } from './invocations'

/** EffectDeclaration is a verb whose failure contract a call site can read. */
export type EffectDeclaration = AST.ActionDeclaration | AST.CommandDeclaration | AST.ActionExpression

/** EffectInvocation is a site that runs one verb: a `do`, a `when do`, a handler, or a command clause. */
export type EffectInvocation =
  | AST.DoStatement
  | AST.WhenDoStatement
  | AST.EventHandler
  | AST.LoopSelectHandler
  | AST.CommandDoClause

/** The three outcomes every `when do` may name, beside the cases its verb declares. */
export const effectOutcomeWords = ['saved', 'rejected', 'error'] as const

// An `async` block is a body of its own: it runs as a separate root after its caller returns, so
// nothing it does reaches the caller's contract, and no `when do` at the caller could catch it.
type EffectBody =
  | AST.ActionDeclaration
  | AST.ActionExpression
  | AST.EventHandler
  | AST.LoopSelectHandler
  | AST.AsyncActionStatement

/**
 * effectFailureCases is an effect's effective failure contract, as case names in declaration order:
 * the cases its own `fail` or `fails` declare, plus the cases of every verb it reaches through a
 * plain `do`, minus the cases a `when do` inside it handles. A cycle contributes nothing new.
 */
export function effectFailureCases(
  effect: EffectDeclaration,
  seen: ReadonlySet<EffectDeclaration> = new Set(),
): string[] {
  if (seen.has(effect)) {
    return []
  }
  const path = new Set(seen).add(effect)
  if (AST.isCommandDeclaration(effect)) {
    const clause = AST.commandDoClauseOf(effect)
    return clause ? invocationFailureCases(clause, path) : []
  }
  if (AST.isActionDeclaration(effect) && effect.foreign) {
    return uniqueCases(effect.foreign.failures.map(failure => failure.case.$refText))
  }
  const block = effect.block
  if (!block) {
    return []
  }
  const cases = AST.streamAllContents(block)
    .filter(node => effectBodyOf(node) === effect)
    .flatMap(node => {
      if (AST.isFailStatement(node)) {
        return [node.case.$refText]
      }
      if (AST.isDoStatement(node) && !AST.isWhenDoStatement(node.$container)) {
        return invocationFailureCases(node, path)
      }
      return AST.isWhenDoStatement(node) ? unhandledOutcomeCases(node, path) : []
    })
  return uniqueCases(cases)
}

/** invocationFailureCases is the effective contract of the verb one site runs; a dynamic verb has none. */
export function invocationFailureCases(
  invocation: EffectInvocation,
  seen: ReadonlySet<EffectDeclaration> = new Set(),
): string[] {
  const effect = invokedEffect(invocation)
  return effect ? effectFailureCases(effect, seen) : []
}

/** invokedEffect is the declared verb one site runs, when it is statically known. */
export function invokedEffect(invocation: EffectInvocation): EffectDeclaration | undefined {
  const action = AST.isWhenDoStatement(invocation) ? invocation.invocation.action : invocation.action
  if (AST.isActionExpression(action)) {
    return action
  }
  const target = resolveActionTarget(action)
  return target.kind === 'named' ? target.action : undefined
}

/**
 * unhandledOutcomeCases is what a `when do` lets through: its verb's cases, less the ones it names,
 * and nothing at all once it names `rejected`.
 */
export function unhandledOutcomeCases(
  statement: AST.WhenDoStatement,
  seen: ReadonlySet<EffectDeclaration> = new Set(),
): string[] {
  const named = new Set(statement.outcomes.map(outcome => outcome.case))
  if (named.has('rejected')) {
    return []
  }
  return invocationFailureCases(statement, seen).filter(failureCase => !named.has(failureCase))
}

/**
 * isRootEffectInvocation reports a site whose failure no Tao caller can observe: one written directly
 * in a view event handler, an `on select` handler, an `async` block, or a command's `do` clause. A
 * `do` inside another action is not a root; its cases flow into that action's contract instead.
 */
export function isRootEffectInvocation(invocation: EffectInvocation): boolean {
  if (AST.isEventHandler(invocation) || AST.isLoopSelectHandler(invocation) || AST.isCommandDoClause(invocation)) {
    return true
  }
  const body = effectBodyOf(invocation)
  return AST.isEventHandler(body) || AST.isLoopSelectHandler(body) || AST.isAsyncActionStatement(body)
    || (AST.isActionExpression(body) && AST.isCommandDoClause(body.$container))
}

/** effectBodyOf is the nearest verb body or handler whose run `node` belongs to. */
function effectBodyOf(node: AST.Node): EffectBody | undefined {
  let current: AST.Node | undefined = node.$container
  while (current) {
    if (
      AST.isActionDeclaration(current) || AST.isActionExpression(current)
      || AST.isEventHandler(current) || AST.isLoopSelectHandler(current) || AST.isAsyncActionStatement(current)
    ) {
      return current
    }
    current = current.$container
  }
  return undefined
}

function uniqueCases(cases: readonly string[]): string[] {
  return [...new Set(cases)]
}
