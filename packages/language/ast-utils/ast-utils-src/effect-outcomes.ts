import { AST } from '@parser'
import { type FailureContract, unionFailureContracts } from './failure-contracts'
import { resolveActionTarget } from './invocations'

export { type FailureContract, failureContractSatisfiesBound, unionFailureContracts } from './failure-contracts'

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
 * effectFailureContract is an effect's effective failure contract in declaration order:
 * the cases its own `fail` or `fails` declare, plus the cases of every verb it reaches through a
 * plain `do`, minus the cases a `when do` inside it handles. A traversal cycle cannot prove closure.
 */
export function effectFailureContract(
  effect: EffectDeclaration,
  seen: ReadonlySet<EffectDeclaration> = new Set(),
): FailureContract {
  if (seen.has(effect)) {
    return { cases: [], open: true }
  }
  const path = new Set(seen).add(effect)
  if (AST.isCommandDeclaration(effect)) {
    const clause = AST.commandDoClauseOf(effect)
    return clause ? invocationFailureContract(clause, path) : { cases: [], open: true }
  }
  if (AST.isActionDeclaration(effect) && effect.foreign) {
    const cases = uniqueCases(effect.foreign.failures.map(failure => failure.case.$refText))
    return { cases, open: cases.length === 0 }
  }
  const block = effect.block
  if (!block) {
    return { cases: [], open: true }
  }
  const contracts = AST.streamAllContents(block)
    .filter(node => effectBodyOf(node) === effect)
    .flatMap(node => {
      if (AST.isFailStatement(node)) {
        return [{ cases: [node.case.$refText], open: false }]
      }
      if (AST.isDoStatement(node) && !AST.isWhenDoStatement(node.$container)) {
        return [invocationFailureContract(node, path)]
      }
      return AST.isWhenDoStatement(node) ? [unhandledOutcomeContract(node, path)] : []
    })
  return unionFailureContracts(contracts)
}

/** A dynamic or unresolved verb has an open contract, rather than no failures. */
export function invocationFailureContract(
  invocation: EffectInvocation,
  seen: ReadonlySet<EffectDeclaration> = new Set(),
): FailureContract {
  const effect = invokedEffect(invocation)
  return effect ? effectFailureContract(effect, seen) : { cases: [], open: true }
}

/** Compatibility projection for consumers that only name known cases, never prove completeness. */
export function effectFailureCases(
  effect: EffectDeclaration,
  seen: ReadonlySet<EffectDeclaration> = new Set(),
): string[] {
  return [...effectFailureContract(effect, seen).cases]
}

/** Compatibility projection; an empty list does not establish failure freedom. */
export function invocationFailureCases(
  invocation: EffectInvocation,
  seen: ReadonlySet<EffectDeclaration> = new Set(),
): string[] {
  return [...invocationFailureContract(invocation, seen).cases]
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
 * A known-case handler only subtracts that case. Open contracts need both failure categories or
 * `otherwise` to close their remainder: `rejected` handles modeled cases, `error` undeclared faults.
 */
export function unhandledOutcomeContract(
  statement: AST.WhenDoStatement,
  seen: ReadonlySet<EffectDeclaration> = new Set(),
): FailureContract {
  const named = new Set(statement.outcomes.map(outcome => outcome.case))
  if (statement.otherwise) {
    return { cases: [], open: false }
  }
  const contract = invocationFailureContract(statement, seen)
  return {
    cases: named.has('rejected') ? [] : contract.cases.filter(failureCase => !named.has(failureCase)),
    open: contract.open && !(named.has('rejected') && named.has('error')),
  }
}

/** Compatibility projection for the existing declared-case root warning policy. */
export function unhandledOutcomeCases(
  statement: AST.WhenDoStatement,
  seen: ReadonlySet<EffectDeclaration> = new Set(),
): string[] {
  return [...unhandledOutcomeContract(statement, seen).cases]
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
