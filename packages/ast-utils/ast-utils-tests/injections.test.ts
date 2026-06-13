import ASTUtils from '@ast-utils'
import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'

Describe('Tao AST injection helpers', () => {
  Test('resolves inject argument local names', async () => {
    const parseResult = await Parser.parseCode(`
      alias UserName = "Ro"
      ui Native Value text {
        render inject Value, Name UserName \`\`\`ts
          return null
        \`\`\`
      }
    `)
    Expect(parseResult.diagnostics).toEqual([])

    const nativeView = parseResult.entry.ast.statements.find(statement =>
      AST.isUiDeclaration(statement) && statement.name === 'Native'
    )
    Expect.Is(nativeView, AST.isUiDeclaration)

    const render = nativeView.block.statements[0]
    Expect.Is(render, AST.isRenderStatement)

    Expect(render.injection?.argumentList?.arguments.map(ASTUtils.injectionArgumentName)).toEqual(['Value', 'Name'])
  })
})
