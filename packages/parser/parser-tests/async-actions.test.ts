import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: async actions', () => {
  Test('parses nested async action blocks in source order', async () => {
    const parsed = await testParseCode(`
      action Launch() {
        async {
          async { }
        }
        async { }
      }
    `)

    const action = parsed.entry.ast.statements.find(AST.isActionDeclaration)
    Expect.Is(action, AST.isActionDeclaration)
    const [first, second] = action.block.statements
    Expect.Is(first, AST.isAsyncActionStatement)
    Expect.Is(first.block.statements[0], AST.isAsyncActionStatement)
    Expect.Is(second, AST.isAsyncActionStatement)
  })
})
