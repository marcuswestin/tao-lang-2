import ASTUtils from '@ast-utils'
import { AST, Parser } from '@parser'
import { describe, expect, test } from 'bun:test'

type ExpectApi = {
  is<T>(value: unknown, guard: (value: unknown) => value is T): asserts value is T
}

const Expect: ExpectApi = {
  is<T>(value: unknown, guard: (value: unknown) => value is T): asserts value is T {
    expect(guard(value)).toBe(true)
  },
}

describe('Tao AST invocation resolution', () => {
  test('resolves positional render argument pairs', async () => {
    const parsed = await parseClean(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open", 1
      }
      ui Tile Title text, Count number { }
    `)
    const mainView = parsed.ast.statements.find(statement =>
      AST.isUiDeclaration(statement) && statement.name === 'MainView'
    )
    Expect.is(mainView, AST.isUiDeclaration)
    const render = mainView.block.statements[0]
    Expect.is(render, AST.isRenderStatement)

    const invocation = ASTUtils.resolveRenderInvocation(render)

    expect(invocation.view?.name).toBe('Tile')
    expect(invocation.pairs.map(pair => pair.parameter.name)).toEqual(['Title', 'Count'])
  })

  test('resolves only positional pairs with matching argument and parameter slots', async () => {
    const missingParsed = await parseClean(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open"
      }
      ui Tile Title text, Count number { }
    `)
    const missingMainView = missingParsed.ast.statements.find(statement =>
      AST.isUiDeclaration(statement) && statement.name === 'MainView'
    )
    Expect.is(missingMainView, AST.isUiDeclaration)
    const missingRender = missingMainView.block.statements[0]
    Expect.is(missingRender, AST.isRenderStatement)
    const missing = ASTUtils.resolveRenderInvocation(missingRender)

    const extraParsed = await parseClean(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open", 1, "extra"
      }
      ui Tile Title text, Count number { }
    `)
    const extraMainView = extraParsed.ast.statements.find(statement =>
      AST.isUiDeclaration(statement) && statement.name === 'MainView'
    )
    Expect.is(extraMainView, AST.isUiDeclaration)
    const extraRender = extraMainView.block.statements[0]
    Expect.is(extraRender, AST.isRenderStatement)
    const extra = ASTUtils.resolveRenderInvocation(extraRender)

    expect(missing.pairs.map(pair => pair.parameter.name)).toEqual(['Title'])
    expect(extra.pairs.map(pair => pair.parameter.name)).toEqual(['Title', 'Count'])
  })

  test('resolves positional child view invocation argument pairs', async () => {
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
    const mainView = parsed.ast.statements.find(statement =>
      AST.isUiDeclaration(statement) && statement.name === 'MainView'
    )
    Expect.is(mainView, AST.isUiDeclaration)
    const render = mainView.block.statements[0]
    Expect.is(render, AST.isRenderStatement)
    const child = render.block?.statements[0]
    Expect.is(child, AST.isViewRender)

    const invocation = ASTUtils.resolveRenderInvocation(child)

    expect(invocation.view?.name).toBe('Tile')
    expect(invocation.pairs.map(pair => pair.parameter.name)).toEqual(['Title', 'Count'])
  })
})

async function parseClean(source: string): Promise<Awaited<ReturnType<typeof Parser.parseCode>>> {
  const parsed = await Parser.parseCode(source)
  expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
  return parsed
}
