import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { createCallableEffectFactDiscovery, discoverCallableEffectFacts } from '../ast-utils-src/callable-effect-facts'
import { projectCallableEffectPublications } from '../ast-utils-src/callable-effect-publications'
import { analyzeCallableEffects } from '../ast-utils-src/callable-effects'
import { publishCanonicalEffectSnapshot } from '../ast-utils-src/canonical-effect-snapshot'

Describe('Snapshot-owned effect projection', () => {
  Test('shares one immutable inventory while retaining each owner and ordered cold facts', async () => {
    const file = await parse(`
      func Echo(Value text) fails never -> text { return Value }
      func Left(Value text) fails never -> text { return Echo(Value) }
      func Right(Value text) fails never -> text { return Echo(Value) }
    `)
    const left = namedFunction(file, 'Left')
    const right = namedFunction(file, 'Right')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const first = projectCallableEffectPublications(snapshot, left)
    const second = projectCallableEffectPublications(snapshot, right)

    Expect(second.inputs === first.inputs).toBe(true)
    Expect(second.discoverFacts === first.discoverFacts).toBe(true)
    Expect(Object.isFrozen(first.inputs)).toBe(true)
    Expect(Object.isFrozen(first.inputs.calls)).toBe(true)
    Expect(first.inputs.calls.every(Object.isFrozen)).toBe(true)
    Expect(first.inputs.calls).toHaveLength(2)
    Expect(first.inputs.calls[0]?.site).toBe(AST.returnStatementsOf(left)[0]!.value)
    Expect(first.inputs.calls[1]?.site).toBe(AST.returnStatementsOf(right)[0]!.value)
    Expect(first.context.root?.node === left).toBe(true)
    Expect(second.context.root?.node === right).toBe(true)
    Expect(second.context).not.toBe(first.context)
    Expect(first.discoverFacts(left, first.context)).not.toBe(first.discoverFacts(left, first.context))
    Expect(() => first.discoverFacts(right, first.context)).toThrow('source root identity')

    for (const owner of [right, left, right]) {
      const warm = projectCallableEffectPublications(snapshot, owner)
      const cold = projectCallableEffectPublications(publishCanonicalEffectSnapshot([file]), owner)
      Expect(warm.inputs === first.inputs).toBe(true)
      Expect(cold.inputs === first.inputs).toBe(false)
      Expect(cold.discoverFacts === first.discoverFacts).toBe(false)
      const facts = warm.discoverFacts(owner, warm.context)
      const coldFacts = discoverCallableEffectFacts(owner, cold.inputs, cold.context)
      Expect(facts).toHaveLength(coldFacts.length)
      facts.forEach(({ node, executes, ...fact }, index) => {
        const { node: coldNode, executes: coldEdges, ...coldFact } = coldFacts[index]!
        Expect(node).toBe(coldNode)
        Expect(fact).toEqual(coldFact)
        Expect(executes).toHaveLength(coldEdges.length)
        executes.forEach(({ site, target, ...edge }, edgeIndex) => {
          const { site: coldSite, target: coldTarget, ...coldEdge } = coldEdges[edgeIndex]!
          Expect(site).toBe(coldSite)
          Expect(target).toBe(coldTarget)
          Expect(edge).toEqual(coldEdge)
        })
      })
      Expect(facts[0]?.node).toBe(owner)
      Expect(facts.some(fact => fact.node === (owner === left ? right : left).block)).toBe(false)
      Expect(analyzeCallableEffects(owner, facts).effects).toEqual({
        purity: { violations: [], open: false },
        failures: { cases: [], open: false },
      })
    }
  })

  Test('indexes immutable rows once while raw discovery keeps mutable inputs cold', async () => {
    const file = await parse(`
      func Echo(Value text) fails never -> text { return Value }
      func Left(Value text) fails never -> text { return Echo(Value) }
      func Right(Value text) fails never -> text { return Echo(Value) }
    `)
    const left = namedFunction(file, 'Left')
    const right = namedFunction(file, 'Right')
    const publication = projectCallableEffectPublications(publishCanonicalEffectSnapshot([file]), left)
    let scans = 0
    const calls = new Proxy(publication.inputs.calls, {
      get(target, key, receiver) {
        if (key === Symbol.iterator) {
          return function*() {
            scans++
            yield* target
          }
        }
        return Reflect.get(target, key, receiver)
      },
    })
    const inputs = Object.freeze({ ...publication.inputs, calls })
    const discover = createCallableEffectFactDiscovery(inputs)
    Expect(scans).toBe(2)
    for (const owner of [right, left, right]) {
      const context = projectCallableEffectPublications(publishCanonicalEffectSnapshot([file]), owner).context
      const facts = discover(owner, context)
      Expect(facts[0]?.node).toBe(owner)
    }
    Expect(scans).toBe(2)
    discoverCallableEffectFacts(left, inputs, publication.context)
    Expect(scans).toBe(4)
    discoverCallableEffectFacts(left, inputs, publication.context)
    Expect(scans).toBe(6)
    const mutableInputs = { ...publication.inputs, calls: [...publication.inputs.calls] }
    const rawEffects = () =>
      analyzeCallableEffects(left, discoverCallableEffectFacts(left, mutableInputs, publication.context)).effects
    Expect(rawEffects().purity.open).toBe(false)
    mutableInputs.calls.length = 0
    Expect(rawEffects().purity.open).toBe(true)
  })

  Test('keeps different native evidence cold even when linked source identities are unchanged', async () => {
    const file = await parse(
      `
      let Host = Export() from ./Native.ts
      func Read() -> text { return Host }
    `,
    )
    const owner = namedFunction(file, 'Read')
    const host = file.statements.find(AST.isAliasDeclaration)
    Expect.Is(host, AST.isAliasDeclaration)
    const bridge = host.value
    Expect.Is(bridge, AST.isFromExpression)
    const snapshot = (violations: readonly 'io'[], cases: readonly string[]) =>
      publishCanonicalEffectSnapshot([file], {
        natives: [{
          declaration: bridge,
          exportSource: bridge,
          phase: 'evaluation',
          kind: 'complete',
          purity: { violations, open: false },
          failures: { cases, open: false },
        }],
      })
    const old = projectCallableEffectPublications(snapshot(['io'], ['ReadFailed']), owner)
    const fresh = projectCallableEffectPublications(snapshot([], []), owner)
    Expect(fresh.inputs === old.inputs).toBe(false)
    Expect(fresh.discoverFacts === old.discoverFacts).toBe(false)
    Expect(old.inputs.natives[0]?.failures.cases).toEqual(['ReadFailed'])
    Expect(fresh.inputs.natives[0]?.failures.cases).toEqual([])
    const effects = (projection: typeof old) =>
      analyzeCallableEffects(owner, projection.discoverFacts(owner, projection.context)).effects
    Expect(effects(old)).toEqual({
      purity: { violations: ['io'], open: true },
      failures: { cases: ['ReadFailed'], open: true },
    })
    Expect(effects(fresh)).toEqual({
      purity: { violations: [], open: true },
      failures: { cases: [], open: true },
    })
  })

  Test('rediscovers missing dependencies after a fresh linked build repairs the source', async () => {
    const broken = await parse('func Caller() -> text { return Missing() }', true)
    const repaired = await parse(`
      func Missing() fails never -> text { return "ready" }
      func Caller() fails never -> text { return Missing() }
    `)
    const project = (file: AST.TaoFile) => {
      const owner = namedFunction(file, 'Caller')
      const projection = projectCallableEffectPublications(publishCanonicalEffectSnapshot([file]), owner)
      return {
        projection,
        analysis: analyzeCallableEffects(
          owner,
          projection.discoverFacts(owner, projection.context),
        ),
      }
    }
    const before = project(broken)
    const after = project(repaired)
    Expect(after.projection.inputs === before.projection.inputs).toBe(false)
    Expect(before.analysis.effects.purity.open).toBe(true)
    Expect(before.analysis.effects.failures.open).toBe(true)
    Expect(after.analysis.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
  })
})

async function parse(source: string, allowUnresolved = false): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics.length > 0).toBe(allowUnresolved)
  return parsed.entry.ast
}

function namedFunction(file: AST.TaoFile, name: string): AST.FunctionDeclaration {
  const owner = file.statements.find(node => AST.isFunctionDeclaration(node) && node.name === name)
  Expect.Is(owner, AST.isFunctionDeclaration)
  return owner
}
