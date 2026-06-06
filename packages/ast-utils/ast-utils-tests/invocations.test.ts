import ASTUtils from '@ast-utils'
import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'

Describe('Tao AST invocation resolution', () => {
  Test('resolves positional render argument pairs', async () => {
    const render = await parseOnlyRender(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open", 1
      }
      ui Tile Title text, Count number { }
    `)

    const invocation = ASTUtils.resolveRenderInvocation(render)

    Expect(invocation.view?.name).toBe('Tile')
    Expect(invocation.pairs.map(pair => pair.parameter.name)).toEqual(['Title', 'Count'])
  })

  Test('resolves only positional pairs with matching argument and parameter slots', async () => {
    const missing = ASTUtils.resolveRenderInvocation(
      await parseOnlyRender(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open"
      }
      ui Tile Title text, Count number { }
    `),
    )
    const extra = ASTUtils.resolveRenderInvocation(
      await parseOnlyRender(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open", 1, "extra"
      }
      ui Tile Title text, Count number { }
    `),
    )

    Expect(missing.pairs.map(pair => pair.parameter.name)).toEqual(['Title'])
    Expect(extra.pairs.map(pair => pair.parameter.name)).toEqual(['Title', 'Count'])
  })
})

async function parseOnlyRender(source: string): Promise<AST.Render> {
  const parsed = await Parser.parseCode(source)
  Expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
  const mainView = parsed.ast.statements.find(statement =>
    AST.isUiDeclaration(statement) && statement.name === 'MainView'
  )
  Expect.Is(mainView, AST.isUiDeclaration)

  const render = mainView.block.statements[0]
  Expect.Is(render, AST.isRender)
  return render
}
