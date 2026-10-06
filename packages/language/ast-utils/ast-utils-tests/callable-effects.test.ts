import { AST, Parser } from '@parser'
import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  analyzeCallableEffects,
  analyzeExpressionEffects,
  type CallableEffectFact,
  type ExecutedEffectEdge,
  puritySatisfiesFunction,
  type PurityViolation,
} from '../ast-utils-src/callable-effects'
import { type FailureContract, failureContractSatisfiesBound } from '../ast-utils-src/failure-contracts'

Describe('Resolved callable effect facts', () => {
  Test('rejects duplicate source witnesses as an internal materialization invariant', async () => {
    const { root } = await witnesses()
    const first = complete(root)
    const duplicate = complete(root, [], ['io'])
    const analyze = () => analyzeCallableEffects(root, [first, duplicate])
    Expect(analyze).toThrow(Errors.UnexpectedBehaviorError)
    Expect(analyze).toThrow('Expected one callable effect fact per source witness.')
  })

  Test('retains transitive violations and real acyclic source call paths', async () => {
    const { root, middle, leaf, rootCall, middleCall, leafValue } = await witnesses()
    const first = { site: rootCall, target: middle }
    const second = { site: middleCall, target: leaf }
    const last = { site: leafValue, target: leafValue }
    const analysis = analyzeCallableEffects(root, [
      complete(root, [first]),
      complete(middle, [second]),
      complete(leaf, [last]),
      complete(leafValue, [], ['io', 'suspend', 'reactive-state']),
    ])
    Expect(analysis.effects.purity).toEqual({ violations: ['io', 'suspend', 'reactive-state'], open: false })
    Expect(puritySatisfiesFunction(analysis.effects.purity)).toBe(false)
    Expect(analysis.effects.failures).toEqual({ cases: [], open: false })
    Expect(analysis.findings).toHaveLength(3)
    for (const finding of analysis.findings) {
      Expect(finding.owner === root).toBe(true)
      Expect(finding.node === leafValue).toBe(true)
      Expect(finding.path).toHaveLength(3)
      Expect(finding.path[0] === first).toBe(true)
      Expect(finding.path[1] === second).toBe(true)
      Expect(finding.path[2] === last).toBe(true)
      Expect(finding.path[0]!.site === rootCall).toBe(true)
      Expect(finding.path[1]!.site === middleCall).toBe(true)
      Expect(finding.path[2]!.site === leafValue).toBe(true)
    }
  })

  Test('keeps pure computation independent of its modeled failure bound', async () => {
    const { root, leaf, rootCall } = await witnesses()
    const analysis = analyzeCallableEffects(root, [
      complete(root, [{ site: rootCall, target: leaf }]),
      complete(leaf, [], [], { cases: ['InvalidInput', 'InvalidInput'], open: false }),
    ])
    Expect(puritySatisfiesFunction(analysis.effects.purity)).toBe(true)
    Expect(analysis.effects.failures).toEqual({ cases: ['InvalidInput'], open: false })
    Expect(failureContractSatisfiesBound(analysis.effects.failures, { cases: [], open: false })).toBe(false)
    Expect(failureContractSatisfiesBound(analysis.effects.failures, {
      cases: ['InvalidInput', 'Missing'],
      open: false,
    })).toBe(true)
  })

  Test('converges pure recursion with conservative failures and preserved known cases', async () => {
    const { root, middle, rootCall, middleCall } = await witnesses()
    const analysis = analyzeCallableEffects(root, [
      complete(root, [{ site: rootCall, target: middle }], [], { cases: ['Missing'], open: false }),
      complete(middle, [{ site: middleCall, target: root }], [], { cases: ['Denied'], open: false }),
    ])
    Expect(analysis.effects.purity).toEqual({ violations: [], open: false })
    Expect(puritySatisfiesFunction(analysis.effects.purity)).toBe(true)
    Expect(analysis.effects.failures).toEqual({ cases: ['Missing', 'Denied'], open: true })
    Expect(analysis.findings).toHaveLength(2)
    Expect(analysis.findings.every(finding =>
      finding.kind === 'unknown'
      && finding.reason === 'recursive-failures' && !finding.purity && finding.failures
    )).toBe(true)
    Expect(analysis.findings.map(finding => finding.path.length)).toEqual([0, 1])
    Expect(analysis.findings[1]!.node === middle).toBe(true)
  })

  Test('propagates an effect around recursion without recursive witness duplication', async () => {
    const { root, middle, rootCall, middleCall } = await witnesses()
    const analysis = analyzeCallableEffects(root, [
      complete(root, [{ site: rootCall, target: middle }]),
      complete(middle, [{ site: middleCall, target: root }], ['io']),
    ])
    Expect(analysis.effects.purity).toEqual({ violations: ['io'], open: false })
    Expect(analysis.effects.failures).toEqual({ cases: [], open: true })
    const offending = analysis.findings.filter(finding => finding.kind === 'violation')
    Expect(offending).toHaveLength(1)
    Expect(offending[0]!.node === middle).toBe(true)
    Expect(offending[0]!.path).toHaveLength(1)
    Expect(offending[0]!.path[0]!.site === rootCall).toBe(true)
  })

  Test('keeps missing and explicitly unresolved dynamic targets open in both fields', async () => {
    const { root, leaf, rootCall, middleCall } = await witnesses()
    const absent = analyzeCallableEffects(root, [])
    Expect(absent.effects).toEqual({
      purity: { violations: [], open: true },
      failures: { cases: [], open: true },
    })
    Expect(absent.findings.every(finding => finding.node === root && finding.owner === root)).toBe(true)
    const missing = analyzeCallableEffects(root, [complete(root, [{ site: rootCall, target: leaf }])])
    Expect(missing.effects).toEqual(absent.effects)
    Expect(missing.findings.every(finding =>
      finding.node === leaf
      && finding.path[0]!.target === leaf && finding.path[0]!.site === rootCall
    )).toBe(true)
    const dynamic = analyzeCallableEffects(root, [complete(root, [
      { site: rootCall, unknown: 'dynamic-target' },
      { site: middleCall, unknown: 'unresolved-target' },
    ])])
    Expect(dynamic.effects).toEqual(absent.effects)
    Expect(dynamic.findings.map(finding => finding.kind === 'unknown' && finding.reason))
      .toEqual(['dynamic-target', 'unresolved-target', 'dynamic-target', 'unresolved-target'])
    Expect(dynamic.findings[0]!.node === rootCall).toBe(true)
    Expect(dynamic.findings[1]!.node === middleCall).toBe(true)
  })

  Test('requires explicit native completeness and retains unknown known-case remainders', async () => {
    const { root, leaf, rootCall } = await witnesses()
    const native: CallableEffectFact = {
      ...complete(leaf, [], ['io'], { cases: ['Denied'], open: false }),
      kind: 'unknown',
      reason: 'unclassified-native',
    }
    const unknown = analyzeCallableEffects(root, [complete(root, [{ site: rootCall, target: leaf }]), native])
    Expect(unknown.effects).toEqual({
      purity: { violations: ['io'], open: true },
      failures: { cases: ['Denied'], open: true },
    })
    const classified = analyzeCallableEffects(root, [
      complete(root, [{ site: rootCall, target: leaf }]),
      complete(leaf, [], [], { cases: ['Denied'], open: true }),
    ])
    Expect(classified.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: ['Denied'], open: true },
    })
    Expect(puritySatisfiesFunction(classified.effects.purity)).toBe(true)
    Expect(classified.findings).toHaveLength(1)
    const finding = classified.findings[0]!
    Expect(
      finding.kind === 'unknown' && finding.reason === 'open-contract'
        && !finding.purity && finding.failures,
    ).toBe(true)
    const trusted = analyzeCallableEffects(root, [
      complete(root, [{ site: rootCall, target: leaf }]),
      complete(leaf),
    ])
    Expect(trusted.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
  })

  Test('carries an action value without executing its body but rejects scheduling detached work', async () => {
    const { root, rootCall, action, actionCall } = await witnesses()
    const carried = analyzeCallableEffects(root, [
      complete(root),
      complete(action, [], ['io'], { cases: ['Denied'], open: false }),
    ])
    Expect(carried.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
    const scheduled = analyzeCallableEffects(root, [
      complete(root, [{ site: rootCall, target: actionCall }]),
      complete(actionCall, [{ site: actionCall, target: action, failureTransfer: { detached: true } }], ['action']),
      complete(action, [], ['io'], { cases: ['Denied'], open: false }),
    ])
    Expect(scheduled.effects).toEqual({
      purity: { violations: ['action', 'io'], open: false },
      failures: { cases: [], open: false },
    })
    Expect(scheduled.findings.map(finding => finding.node === actionCall || finding.node === action))
      .toEqual([true, true])
    const executed = analyzeCallableEffects(root, [
      complete(root, [{ site: rootCall, target: actionCall }]),
      complete(actionCall, [{ site: actionCall, target: action }], ['action']),
      complete(action, [], [], { cases: ['Denied'], open: false }),
    ])
    Expect(executed.effects).toEqual({
      purity: { violations: ['action'], open: false },
      failures: { cases: ['Denied'], open: false },
    })
  })

  Test('handles propagated failures without erasing impurity or direct local failures', async () => {
    const { root, leaf, rootCall } = await witnesses()
    const target = complete(leaf, [], ['io'], { cases: ['Missing', 'Denied'], open: true })
    const named = analyzeCallableEffects(root, [
      complete(root, [{ site: rootCall, target: leaf, failureTransfer: { handledCases: ['Missing'] } }]),
      target,
    ])
    Expect(named.effects).toEqual({
      purity: { violations: ['io'], open: false },
      failures: { cases: ['Denied'], open: true },
    })
    const all = analyzeCallableEffects(root, [
      complete(root, [{ site: rootCall, target: leaf, failureTransfer: { handlesAll: true } }], [], {
        cases: ['Local'],
        open: false,
      }),
      target,
    ])
    Expect(all.effects).toEqual({
      purity: { violations: ['io'], open: false },
      failures: { cases: ['Local'], open: false },
    })
    Expect(all.findings).toHaveLength(1)
    Expect(all.findings[0]!.kind).toBe('violation')
    const handledCycle = analyzeCallableEffects(root, [complete(
      root,
      [{
        site: rootCall,
        target: root,
        failureTransfer: { handlesAll: true },
      }],
      ['reactive-state'],
      { cases: ['Local'], open: false },
    )])
    Expect(handledCycle.effects).toEqual({
      purity: { violations: ['reactive-state'], open: false },
      failures: { cases: ['Local'], open: false },
    })
  })

  Test('uses a surviving longer failure path when the shortest execution path is handled', async () => {
    const { root, middle, leaf, rootCall, middleCall, leafValue } = await witnesses()
    const handled = { site: rootCall, target: leaf, failureTransfer: { handlesAll: true } }
    const first = { site: leafValue, target: middle }
    const second = { site: middleCall, target: leaf }
    const analysis = analyzeCallableEffects(root, [
      complete(root, [handled, first]),
      complete(middle, [second]),
      { ...complete(leaf), kind: 'unknown', reason: 'unclassified-native' },
    ])
    Expect(analysis.effects).toEqual({
      purity: { violations: [], open: true },
      failures: { cases: [], open: true },
    })
    const purity = analysis.findings.find(finding => finding.kind === 'unknown' && finding.purity)
    const failures = analysis.findings.find(finding => finding.kind === 'unknown' && finding.failures)
    Expect(purity?.node === leaf).toBe(true)
    Expect(purity?.path).toHaveLength(1)
    Expect(purity?.path[0] === handled).toBe(true)
    Expect(failures?.node === leaf).toBe(true)
    Expect(failures?.path).toHaveLength(2)
    Expect(failures?.path[0] === first).toBe(true)
    Expect(failures?.path[1] === second).toBe(true)
    Expect(failures?.path[0]!.site === leafValue).toBe(true)
    Expect(failures?.path[1]!.site === middleCall).toBe(true)
  })

  Test('keeps unknown purity after complete failure handling and detached execution', async () => {
    const { root, rootCall } = await witnesses()
    for (const failureTransfer of [{ handlesAll: true }, { detached: true }]) {
      const analysis = analyzeCallableEffects(root, [complete(root, [{
        site: rootCall,
        unknown: 'dynamic-target',
        failureTransfer,
      }])])
      Expect(analysis.effects).toEqual({
        purity: { violations: [], open: true },
        failures: { cases: [], open: false },
      })
      Expect(analysis.findings).toHaveLength(1)
      const finding = analysis.findings[0]!
      Expect(finding.kind === 'unknown' && finding.purity && !finding.failures).toBe(true)
    }
  })

  Test('does not mutate frozen materialized facts or retain analysis state across calls', async () => {
    const { root, leaf, rootCall, leafValue } = await witnesses()
    const edge = Object.freeze({
      site: rootCall,
      target: leaf,
      failureTransfer: Object.freeze({ handledCases: Object.freeze(['Missing']) }),
    })
    const rootFact = freezeFact(complete(root, [edge]))
    const leafFact = freezeFact(complete(leaf, [], ['io'], { cases: ['Missing', 'Denied'], open: false }))
    const facts = Object.freeze([rootFact, leafFact])
    const first = analyzeCallableEffects(root, facts)
    Expect(first.effects).toEqual({
      purity: { violations: ['io'], open: false },
      failures: { cases: ['Denied'], open: false },
    })
    Expect(facts[1]!.failures.cases).toEqual(['Missing', 'Denied'])
    Expect(facts[0]!.executes[0] === edge).toBe(true)
    const second = analyzeCallableEffects(root, Object.freeze([rootFact, freezeFact(complete(leaf))]))
    Expect(second.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
    Expect(analyzeCallableEffects(root, facts).effects).toEqual(first.effects)
    const expression = analyzeExpressionEffects(leafValue, [complete(leafValue, [], ['suspend'])])
    Expect(expression.effects).toEqual({
      purity: { violations: ['suspend'], open: false },
      failures: { cases: [], open: false },
    })
    Expect(expression.findings[0]!.owner === leafValue).toBe(true)
    Expect(expression.findings[0]!.node === leafValue).toBe(true)
    Expect(expression.findings[0]!.path).toHaveLength(0)
  })
})

function complete(
  node: AST.Node,
  executes: readonly ExecutedEffectEdge[] = [],
  violations: readonly PurityViolation[] = [],
  failures: FailureContract = { cases: [], open: false },
): CallableEffectFact {
  return { node, kind: 'complete', purity: { violations, open: false }, failures, executes }
}

function freezeFact(fact: CallableEffectFact): CallableEffectFact {
  return Object.freeze({
    ...fact,
    purity: Object.freeze({ ...fact.purity, violations: Object.freeze([...fact.purity.violations]) }),
    failures: Object.freeze({ ...fact.failures, cases: Object.freeze([...fact.failures.cases]) }),
    executes: Object.freeze([...fact.executes]),
  })
}

async function witnesses() {
  const parsed = await Parser.parseCode(`
    function Root() returns number { return Middle() }
    function Middle() returns number { return Leaf() }
    function Leaf() returns number { return 1 }
    action Save() { }
    action Run() { do Save() }
  `)
  Expect(parsed.diagnostics).toEqual([])
  const find = (name: string) =>
    parsed.entry.ast.statements.find(statement => AST.isFunctionDeclaration(statement) && statement.name === name)
  const root = find('Root')
  const middle = find('Middle')
  const leaf = find('Leaf')
  Expect.Is(root, AST.isFunctionDeclaration)
  Expect.Is(middle, AST.isFunctionDeclaration)
  Expect.Is(leaf, AST.isFunctionDeclaration)
  const rootCall = AST.returnStatementsOf(root)[0]!.value
  const middleCall = AST.returnStatementsOf(middle)[0]!.value
  const leafValue = AST.returnStatementsOf(leaf)[0]!.value
  Expect.Is(rootCall, AST.isFunctionCallExpression)
  Expect.Is(middleCall, AST.isFunctionCallExpression)
  Expect.Is(leafValue, AST.isNumberLiteral)
  const action = parsed.entry.ast.statements.find(statement =>
    AST.isActionDeclaration(statement) && statement.name === 'Save'
  )
  const run = parsed.entry.ast.statements.find(statement =>
    AST.isActionDeclaration(statement) && statement.name === 'Run'
  )
  Expect.Is(action, AST.isActionDeclaration)
  Expect.Is(run, AST.isActionDeclaration)
  const actionCall = run.block?.statements[0]
  Expect.Is(actionCall, AST.isDoStatement)
  return { root, middle, leaf, rootCall, middleCall, leafValue, action, actionCall }
}
