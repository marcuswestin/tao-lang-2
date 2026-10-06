import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: public none subject case', () => {
  Test('parses none as a built-in guard case', async () => {
    const result = await testParseCode(`
      data Documents / Document { Title text }
      view Main(Document) {
        render Stack() {
          guard Document { none -> { Text("No document") } }
        }
      }
      view Stack() { render inject Content @@content \`\`\`ts
        return Content
      \`\`\` }
      view Text(Value text) { render inject Value \`\`\`ts
        return null
      \`\`\` }
    `)

    const main = result.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Main'
    )
    Expect.Is(main, AST.isViewDeclaration)
    const render = AST.blockStatementOf(main, { find: AST.isRenderStatement })
    Expect.Is(render, AST.isRenderStatement)
    const guard = AST.statementsOf(render.block).find(AST.isGuardRenderStatement)
    Expect.Is(guard, AST.isGuardRenderStatement)
    Expect(guard.caseBlock?.branches.map(branch => branch.case)).toEqual(['none'])
  })
})
