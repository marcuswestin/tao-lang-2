import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { createAssociatedEffects } from '../ast-utils-src/associated-effect-context'
import {
  associatedCallableAdmissionAnalysis,
  associatedCallableAnalysis,
  ownAssociatedViews,
  withAssociatedEffects,
} from '../ast-utils-src/associated-methods'
import { publishCanonicalEffectSnapshot } from '../ast-utils-src/canonical-effect-snapshot'
import { planCapabilityTransport } from '../ast-utils-src/capability-transport'
import { mountedViewCreationAnalysis } from '../ast-utils-src/mounted-view-creation'
import { Type } from '../ast-utils-src/Type'

Describe('Mounted view creation boundary', () => {
  Test('admits actual entity ui creation while retaining its deferred body', async () => {
    const file = await parse(`
      can ui { Render() fails never -> rendered }
      data Books / Book { Title text, view Book.Render() { render Book.Title } }
    `)
    const entity = file.statements.find(AST.isEntityDataDeclaration)
    const capability = file.statements.find(AST.isTypeDeclaration)
    Assert(entity && capability, 'actual entity and ui declarations exist')
    const view = ownAssociatedViews(entity)[0]!
    const snapshot = publishCanonicalEffectSnapshot([file])
    Expect(snapshot.descriptors.get(view)?.body).toBe(view.block)
    Expect(mountedViewCreationAnalysis(snapshot, view)?.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
    const context = createAssociatedEffects([file])
    withAssociatedEffects(context, () => {
      Expect(associatedCallableAdmissionAnalysis(view)).toBe(context.creatorAnalyses!.get(view))
      Expect(associatedCallableAnalysis(view)).toBe(context.analyses.get(view))
      const witnesses = Type.capabilityWitnesses(Type.ofAssociatedOwner(entity), Type.ofDefinition(capability))
      Assert(witnesses, 'production factory proves actual mounted creator admission')
      Expect(witnesses[0]!.supplied.declaration).toBe(view)
      const plan = planCapabilityTransport(Type.ofAssociatedOwner(entity), Type.ofDefinition(capability))
      Assert(plan.kind === 'ready' && plan.plan.kind === 'attach', 'actual ui transport attaches')
      Expect(plan.plan.methods[0]!.supplied.declaration).toBe(view)
    })
    withAssociatedEffects({ descriptors: context.descriptors, analyses: context.analyses }, () => {
      Expect(Type.capabilityWitnesses(Type.ofAssociatedOwner(entity), Type.ofDefinition(capability))).toBeUndefined()
    })
  })

  Test('keeps deferred defaults and injected mount code outside creator execution', async () => {
    const file = await parse(`
      func Caption() -> text { return "caption" }
      type Card is text with {
        view Card.Render(Label text default Caption()) { render inject \`\`\`ts return null \`\`\` }
      }
    `)
    const view = AST.streamAllContents(file).find(AST.isAssociatedViewDeclaration)
    Assert(view, 'actual mounted source exists')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const analysis = mountedViewCreationAnalysis(snapshot, view)
    Assert(analysis, 'canonical source mounted convention proves creation')
    Expect(analysis.findings).toEqual([])
    Expect(analysis.effects.purity.open).toBe(false)
    Expect(analysis.effects.failures.open).toBe(false)
    Expect(AST.parametersOf(view)[0]!.defaultValue).toBeDefined()
    Expect(AST.streamAllContents(view).some(AST.isInjection)).toBe(true)
  })

  Test('rejects unregistered generations and copied snapshots', async () => {
    const first = await parse('type Card is text with { view Card.Render() { } }')
    const second = await parse('type Card is text with { view Card.Render() { } }')
    const snapshot = publishCanonicalEffectSnapshot([first])
    const firstView = AST.streamAllContents(first).find(AST.isAssociatedViewDeclaration)!
    const secondView = AST.streamAllContents(second).find(AST.isAssociatedViewDeclaration)!
    Expect(mountedViewCreationAnalysis(snapshot, secondView)).toBeUndefined()
    Expect(() => mountedViewCreationAnalysis({ ...snapshot }, firstView)).toThrow()
  })
})

async function parse(source: string): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics).toEqual([])
  return parsed.entry.ast
}
