import ASTUtils from '@ast-utils'
import { AST, Parser } from '@parser'
import { describe, expect, test } from 'bun:test'

describe('Tao AST invocation resolution', () => {
  test('resolves positional render argument pairs', async () => {
    const render = await parseOnlyRender(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open", 1
      }
      ui Tile Title text, Count number { }
    `)

    const invocation = ASTUtils.resolveRenderInvocation(render)

    expect(invocation.view?.name).toBe('Tile')
    expect(invocation.pairs.map(pair => pair.parameter.name)).toEqual(['Title', 'Count'])
  })

  test('resolves only positional pairs with matching argument and parameter slots', async () => {
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

    expect(missing.pairs.map(pair => pair.parameter.name)).toEqual(['Title'])
    expect(extra.pairs.map(pair => pair.parameter.name)).toEqual(['Title', 'Count'])
  })
})

async function parseOnlyRender(source: string): Promise<AST.Render> {
  const parsed = await Parser.parseCode(source)
  expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
  const mainView = parsed.ast.statements.find(statement =>
    AST.isUiDeclaration(statement) && statement.name === 'MainView'
  )
  if (!AST.isUiDeclaration(mainView)) {
    throw new Error('Expected MainView declaration.')
  }
  const render = mainView.block.statements[0]
  if (!AST.isRender(render)) {
    throw new Error('Expected MainView render statement.')
  }
  return render
}
