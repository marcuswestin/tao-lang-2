import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: adaptive layout', () => {
  Test('preserves width max as one three-term layout entry', async () => {
    const result = await testParseCode(`
      app AdaptiveApp { view MainView }
      view MainView() {
        render Column() [width max 720]
      }
      layout Column() {
        render inject \`\`\`ts return null \`\`\`
      }
    `)

    const render = AST.streamAllContents(result.entry.ast).find(AST.isRenderStatement)
    Expect.Is(render, AST.isRenderStatement)
    const entry = render.layoutClause?.entries[0]
    Expect.Is(entry, AST.isLayoutEntry)
    Expect(ASTUtils.layoutEntryValues(entry)).toEqual(['width', 'max', 720])
  })
})
