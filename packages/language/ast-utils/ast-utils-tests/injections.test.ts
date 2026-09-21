import { ASTUtils } from '@ast-utils'
import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'

Describe('Tao AST injection helpers', () => {
  Test('resolves inject argument local names', async () => {
    const parseResult = await Parser.parseCode(`
      let UserName = "Ro"
      view Native(Value text) {
        render inject Value, Name UserName \`\`\`ts
          return null
        \`\`\`
      }
    `)
    Expect(parseResult.diagnostics).toEqual([])

    const nativeView = parseResult.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Native'
    )
    Expect.Is(nativeView, AST.isViewDeclaration)

    const render = AST.blockStatementOf(nativeView, 0)
    Expect.Is(render, AST.isRenderStatement)

    Expect.Is(render.injection, AST.isInjection)
    Expect(AST.injectionArgumentsOf(render.injection).map(ASTUtils.injectionArgumentName)).toEqual([
      'Value',
      'Name',
    ])
  })
})
