import type { AST } from '@parser'
import { Assert } from '@shared'
import { type FailureContract, unionFailureContracts } from './failure-contracts'

export type PurityViolation = 'action' | 'io' | 'suspend' | 'reactive-state'
export type PurityContract = Readonly<{ violations: readonly PurityViolation[]; open: boolean }>

/** Local handling and detached execution change propagated failures, never executed purity. */
type FailureTransfer = Readonly<{
  handledCases?: readonly string[]
  handlesAll?: boolean
  detached?: boolean
}>

export type ExecutedEffectEdge =
  & Readonly<{
    site: AST.Node
    failureTransfer?: FailureTransfer
  }>
  & (
    | Readonly<{ target: AST.Node; unknown?: never }>
    | Readonly<{ target?: never; unknown: 'unresolved-target' | 'dynamic-target' }>
  )

type UnknownFactReason = 'dynamic-target' | 'unclassified-native' | 'incomplete-fact'

/** Already-resolved facts explicitly state completeness; no resolver can re-enter analysis. */
export type CallableEffectFact =
  & Readonly<{
    node: AST.Node
    purity: PurityContract
    failures: FailureContract
    executes: readonly ExecutedEffectEdge[]
  }>
  & (
    | Readonly<{ kind: 'complete'; reason?: never }>
    | Readonly<{ kind: 'unknown'; reason: UnknownFactReason }>
  )

type CallableEffectFinding =
  & Readonly<{
    owner: AST.Node
    node: AST.Node
    /** Shortest acyclic execution path, retaining each real call-site and target witness. */
    path: readonly ExecutedEffectEdge[]
  }>
  & (
    | Readonly<{ kind: 'violation'; violation: PurityViolation }>
    | Readonly<{
      kind: 'unknown'
      reason: UnknownFactReason | 'unresolved-target' | 'missing-fact' | 'open-contract' | 'recursive-failures'
      purity: boolean
      failures: boolean
    }>
  )

export type CallableAnalysis = Readonly<{
  effects: Readonly<{ purity: PurityContract; failures: FailureContract }>
  findings: readonly CallableEffectFinding[]
}>

/** Analyze one materialized execution graph, independently retaining purity and modeled failures. */
export function analyzeCallableEffects(owner: AST.Node, facts: readonly CallableEffectFact[]): CallableAnalysis {
  const byNode = new Map<AST.Node, CallableEffectFact>()
  for (const fact of facts) {
    Assert(!byNode.has(fact.node), 'Expected one callable effect fact per source witness.')
    byNode.set(fact.node, fact)
  }
  const paths = new Map<AST.Node, readonly ExecutedEffectEdge[]>([[owner, []]])
  const queue = [owner]
  const findings: CallableEffectFinding[] = []
  const violations = new Set<PurityViolation>()
  let purityOpen = false
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index]!
    const path = paths.get(node)!
    const fact = byNode.get(node)
    if (!fact) {
      purityOpen = true
      findings.push({ owner, node, path, kind: 'unknown', reason: 'missing-fact', purity: true, failures: false })
      continue
    }
    for (const violation of new Set(fact.purity.violations)) {
      violations.add(violation)
      findings.push({ owner, node, path, kind: 'violation', violation })
    }
    if (fact.kind === 'unknown' || fact.purity.open) {
      purityOpen = true
      findings.push({
        owner,
        node,
        path,
        kind: 'unknown',
        reason: fact.reason ?? 'open-contract',
        purity: true,
        failures: false,
      })
    }
    for (const edge of fact.executes) {
      if (!edge.target) {
        purityOpen = true
        findings.push({
          owner,
          node: edge.site,
          path: [...path, edge],
          kind: 'unknown',
          reason: edge.unknown,
          purity: true,
          failures: false,
        })
      } else if (!paths.has(edge.target)) {
        paths.set(edge.target, [...path, edge])
        queue.push(edge.target)
      }
    }
  }

  const failures = new Map<AST.Node, FailureContract>()
  for (const node of queue) {
    const fact = byNode.get(node)
    const recursive = hasFailureCycle(node, byNode)
    failures.set(node, {
      cases: [...new Set(fact?.failures.cases ?? [])],
      open: !fact || fact.kind === 'unknown' || fact.failures.open || recursive,
    })
  }
  let changed = true
  while (changed) {
    changed = false
    for (const node of queue) {
      const previous = failures.get(node)!
      const propagated = (byNode.get(node)?.executes ?? []).map(edge =>
        transferFailures(
          edge.target ? failures.get(edge.target)! : { cases: [], open: true },
          edge.failureTransfer,
        )
      )
      const next = unionFailureContracts([previous, ...propagated])
      if (next.open !== previous.open || next.cases.length !== previous.cases.length) {
        failures.set(node, next)
        changed = true
      }
    }
  }
  // Failure evidence follows surviving forwarding paths, which may differ from purity paths.
  const failurePaths = new Map<AST.Node, readonly ExecutedEffectEdge[]>([[owner, []]])
  const failureQueue = [owner]
  for (let index = 0; index < failureQueue.length; index++) {
    const node = failureQueue[index]!
    const path = failurePaths.get(node)!
    const fact = byNode.get(node)
    if (!fact || fact.kind === 'unknown' || fact.failures.open) {
      findings.push({
        owner,
        node,
        path,
        kind: 'unknown',
        reason: !fact ? 'missing-fact' : fact.reason ?? 'open-contract',
        purity: false,
        failures: true,
      })
    }
    if (hasFailureCycle(node, byNode)) {
      findings.push({
        owner,
        node,
        path,
        kind: 'unknown',
        reason: 'recursive-failures',
        purity: false,
        failures: true,
      })
    }
    for (const edge of fact?.executes ?? []) {
      if (edge.failureTransfer?.handlesAll || edge.failureTransfer?.detached) {
        continue
      }
      if (!edge.target) {
        findings.push({
          owner,
          node: edge.site,
          path: [...path, edge],
          kind: 'unknown',
          reason: edge.unknown,
          purity: false,
          failures: true,
        })
      } else if (!failurePaths.has(edge.target)) {
        failurePaths.set(edge.target, [...path, edge])
        failureQueue.push(edge.target)
      }
    }
  }
  return {
    effects: { purity: { violations: [...violations], open: purityOpen }, failures: failures.get(owner)! },
    findings,
  }
}

/** Expressions use exactly the same execution and propagation semantics as callable owners. */
export function analyzeExpressionEffects(
  expression: AST.Expression,
  facts: readonly CallableEffectFact[],
): CallableAnalysis {
  return analyzeCallableEffects(expression, facts)
}

export function puritySatisfiesFunction(purity: PurityContract): boolean {
  return !purity.open && purity.violations.length === 0
}

function transferFailures(contract: FailureContract, transfer?: FailureTransfer): FailureContract {
  if (transfer?.detached || transfer?.handlesAll) {
    return { cases: [], open: false }
  }
  return {
    cases: contract.cases.filter(failureCase => !transfer?.handledCases?.includes(failureCase)),
    open: contract.open,
  }
}

/** Only forwarding edges form failure cycles; complete handling can close their remainder. */
function hasFailureCycle(start: AST.Node, facts: ReadonlyMap<AST.Node, CallableEffectFact>): boolean {
  const seen = new Set<AST.Node>()
  const pending = [start]
  while (pending.length) {
    const node = pending.pop()!
    if (seen.has(node)) {
      continue
    }
    seen.add(node)
    for (const edge of facts.get(node)?.executes ?? []) {
      if (!edge.target || edge.failureTransfer?.handlesAll || edge.failureTransfer?.detached) {
        continue
      }
      if (edge.target === start) {
        return true
      }
      pending.push(edge.target)
    }
  }
  return false
}
