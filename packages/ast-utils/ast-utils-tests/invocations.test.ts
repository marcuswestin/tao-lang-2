import ASTUtils from '@ast-utils'
import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'

Describe('Tao AST invocation resolution', () => {
  Test('resolves positional render argument pairs', async () => {
    const parsed = await parseClean(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open", 1
      }
      ui Tile Title text, Count number { }
    `)
    const mainView = findMainView(parsed)
    const render = mainView.block.statements[0]
    Expect.Is(render, AST.isRenderStatement)

    const invocation = ASTUtils.resolveRenderInvocation(render)

    Expect(invocation.view?.name).toBe('Tile')
    Expect(invocation.pairs.map(pair => pair.parameter.name)).toEqual(['Title', 'Count'])
  })

  Test('resolves only positional pairs with matching argument and parameter slots', async () => {
    const missingParsed = await parseClean(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open"
      }
      ui Tile Title text, Count number { }
    `)
    const missingRender = findMainView(missingParsed).block.statements[0]
    Expect.Is(missingRender, AST.isRenderStatement)
    const missing = ASTUtils.resolveRenderInvocation(missingRender)

    const extraParsed = await parseClean(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open", 1, "extra"
      }
      ui Tile Title text, Count number { }
    `)
    const extraRender = findMainView(extraParsed).block.statements[0]
    Expect.Is(extraRender, AST.isRenderStatement)
    const extra = ASTUtils.resolveRenderInvocation(extraRender)

    Expect(missing.pairs.map(pair => pair.parameter.name)).toEqual(['Title'])
    Expect(extra.pairs.map(pair => pair.parameter.name)).toEqual(['Title', 'Count'])
  })

  Test('resolves positional child view invocation argument pairs', async () => {
    const parsed = await parseClean(`
      app MyApp { ui MainView }
      ui MainView {
        render Stack {
          Tile "Open", 1
        }
      }
      layout Stack {
        render inject \`\`\`ts
          return <>{_ViewProps.children}</>
        \`\`\`
      }
      ui Tile Title text, Count number {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)
    const render = findMainView(parsed).block.statements[0]
    Expect.Is(render, AST.isRenderStatement)
    const child = render.block?.statements[0]
    Expect.Is(child, AST.isViewRender)

    const invocation = ASTUtils.resolveRenderInvocation(child)

    Expect(invocation.view?.name).toBe('Tile')
    Expect(invocation.pairs.map(pair => pair.parameter.name)).toEqual(['Title', 'Count'])
  })
})

async function parseClean(source: string): Promise<Awaited<ReturnType<typeof Parser.parseCode>>> {
  const parsed = await Parser.parseCode(source)
  Expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
  return parsed
}

function findMainView(parsed: Awaited<ReturnType<typeof Parser.parseCode>>): AST.UiDeclaration {
  const mainView = parsed.ast.statements.find(statement =>
    AST.isUiDeclaration(statement) && statement.name === 'MainView'
  )
  Expect.Is(mainView, AST.isUiDeclaration)
  return mainView
}
