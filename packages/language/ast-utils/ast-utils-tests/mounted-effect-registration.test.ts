import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { createAssociatedEffects } from '../ast-utils-src/associated-effect-context'
import { ownAssociatedViews } from '../ast-utils-src/associated-methods'
import { discoverCallableEffectFacts } from '../ast-utils-src/callable-effect-facts'
import { projectCallableEffectPublications } from '../ast-utils-src/callable-effect-publications'
import { publishCanonicalEffectSnapshot } from '../ast-utils-src/canonical-effect-snapshot'

Describe('Mounted callable effect registration', () => {
  Test('registers the actual entity view body without closing an unpublished live read', async () => {
    const file = await parse(`
      data Books / Book {
        Title text,
        view Book.Render() { render Book.Title }
      }
    `)
    const entity = file.statements.find(AST.isEntityDataDeclaration)
    Expect.Is(entity, AST.isEntityDataDeclaration)
    const view = ownAssociatedViews(entity)[0]
    Expect.Is(view, AST.isAssociatedViewDeclaration)
    const render = AST.streamAllContents(view).find(AST.isRenderStatement)
    Expect.Is(render, AST.isRenderStatement)
    Expect.Is(render.expression, AST.isMemberAccessExpression)
    Expect(render.expression.target.ref).toBe(entity)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const descriptor = snapshot.associatedDescriptors.get(view)
    Assert(descriptor?.kind === 'ready', 'the real mounted descriptor is ready before effect admission')
    Expect(snapshot.descriptors.get(view)?.body).toBe(view.block)
    Expect(snapshot.descriptors.get(view)?.convention).toBe('mounted')
    const projected = projectCallableEffectPublications(snapshot, view)
    const facts = discoverCallableEffectFacts(view, projected.inputs, projected.context)
    Expect(facts.find(fact => fact.node === view.block)?.kind).toBe('complete')
    Expect(facts.find(fact => fact.node === render)?.kind).toBe('complete')
    Expect(facts.find(fact => fact.node === render.expression)?.kind).toBe('unknown')
    const registered = createAssociatedEffects([file])
    Expect(registered.descriptors.get(view)?.owner).toBe(entity)
    Expect(registered.descriptors.get(view)?.declaration).toBe(view)
    const analysis = registered.analyses.get(view)
    Assert.defined(analysis, 'the real view body is an analysis root')
    Expect(analysis.effects).toEqual({
      purity: { violations: [], open: true },
      failures: { cases: [], open: true },
    })
    Expect(analysis.findings.some(finding => finding.node === render.expression)).toBe(true)
  })

  Test('retains injected implementation children beneath the structural mounted block', async () => {
    const file = await parse(`
      data Books / Book {
        Title text,
        view Book.Render() { render inject \`\`\`ts return null \`\`\` }
      }
    `)
    const view = AST.streamAllContents(file).find(AST.isAssociatedViewDeclaration)
    Expect.Is(view, AST.isAssociatedViewDeclaration)
    const injection = AST.streamAllContents(view).find(AST.isInjection)
    Expect.Is(injection, AST.isInjection)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const projected = projectCallableEffectPublications(snapshot, view)
    const facts = discoverCallableEffectFacts(view, projected.inputs, projected.context)
    Expect(facts.find(fact => fact.node === view.block)?.kind).toBe('complete')
    Expect(facts.find(fact => fact.node === injection)?.kind).toBe('unknown')
    const analysis = createAssociatedEffects([file]).analyses.get(view)
    Assert.defined(analysis, 'the injected view still registers a conservative analysis')
    Expect(analysis.effects.purity.open).toBe(true)
    Expect(analysis.effects.failures.open).toBe(true)
    Expect(analysis.findings.some(finding => finding.node === injection)).toBe(true)
  })
})

async function parse(source: string): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics).toEqual([])
  return parsed.entry.ast
}
