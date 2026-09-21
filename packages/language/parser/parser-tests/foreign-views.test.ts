import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: foreign views', () => {
  Test('parses a named TypeScript view export and its declared visual capabilities', async () => {
    const parsed = await testParseCode(`
      view CodeEditor(Content text, Change action(text)) responds Result
        accepts content slots @header, @footer from ./CodeEditor.tsx
      type Result is Done | Cancelled
    `)
    const view = parsed.entry.ast.statements.find(AST.isViewDeclaration)

    Expect(view?.foreign?.path).toBe('./CodeEditor.tsx')
    Expect(view?.foreign?.content).toBe('content')
    Expect(view?.foreign?.slots.map(slot => slot.name)).toEqual(['@header', '@footer'])
    Expect(view?.response?.$refText).toBe('Result')
  })

  Test('parses the minimal foreign view head', async () => {
    const parsed = await testParseCode('view CodeEditor(Content text) from ./CodeEditor.tsx')
    const view = parsed.entry.ast.statements.find(AST.isViewDeclaration)

    Expect(view?.foreign?.path).toBe('./CodeEditor.tsx')
    Expect(view?.block).toBeUndefined()
  })
})
