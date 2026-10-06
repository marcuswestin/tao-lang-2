import { AST, Langium, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { withAssociatedEffects } from '../ast-utils-src/associated-methods'
import { publishCanonicalEffectSnapshot } from '../ast-utils-src/canonical-effect-snapshot'
import { renderTargetName, resolveRenderTarget } from '../ast-utils-src/render-targets'

Describe('structural ui render targets', () => {
  Test('selects the canonical ordinary contract and declared rendered results across lexical shadows', async () => {
    const protocol = await Parser.parseCode('public can ui { Render() fails never -> rendered }', {
      uri: Langium.URI.file('/contracts/@tao/ui/UI.tao'),
      validation: false,
    })
    const parsed = await Parser.parseCode(
      `
      can Display { Render() fails never -> rendered }
      can Wrong { Render() fails never -> text }
      can ui { Render() fails never -> text }
      view Main(Value Display) { render Value }
      view Description(Value rendered) { render Value }
      view Plain(Value text) { render Value }
      view Rejected(Value Wrong) { render Value }
    `,
      { validation: false },
    )
    for (const result of [protocol, parsed]) {
      Expect(result.diagnostics).toEqual([])
      Expect(result.entry.document.parseResult.parserErrors).toEqual([])
    }
    const files = [parsed.entry.ast, protocol.entry.ast]
    AST.rememberVisibleWorkspaceFiles(files)
    const snapshot = publishCanonicalEffectSnapshot(files)
    const descriptors = new Map(
      [...snapshot.associatedDescriptors].flatMap(([declaration, materialized]) =>
        materialized.kind === 'ready' ? [[declaration, materialized.descriptor] as const] : []
      ),
    )
    withAssociatedEffects({ descriptors, analyses: new Map() }, () => {
      const render = (name: string) => {
        const view = parsed.entry.ast.statements.find(statement =>
          AST.isViewDeclaration(statement) && statement.name === name
        )
        Expect.Is(view, AST.isViewDeclaration)
        const render = view.block?.statements.find(AST.isRenderStatement)
        Expect.Is(render, AST.isRenderStatement)
        return resolveRenderTarget(render)
      }
      const target = render('Main')
      Assert(target?.kind === 'ui', 'a declared structural provider selects the real ui requirement')
      Expect(target.witness.required.owner === protocol.entry.ast.statements[0]).toBe(true)
      Expect(target.witness.supplied.owner === parsed.entry.ast.statements[0]).toBe(true)
      Expect(renderTargetName(target)).toBe('Value')
      Expect(render('Description')?.kind).toBe('rendered')
      Expect(render('Plain')?.kind).toBe('text')
      Expect(render('Rejected')).toBeUndefined()
    })
  })
})
