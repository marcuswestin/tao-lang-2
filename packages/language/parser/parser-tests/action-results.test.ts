import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: action results', () => {
  Test('shadows results within a nested block and restores the outer binding afterward', async () => {
    const parsed = await testParseCode(`
      action Read() returns text from ./Bindings.ts
      action Consume(Value text) { }
      action Paste() {
        let Pasted = do Read()
        if true { let Pasted = do Read() do Consume(Pasted) }
        do Consume(Pasted)
      }
    `)
    const contents = AST.streamAllContents(parsed.entry.ast)
    const bindings = contents.filter(AST.isActionResultStatement)
    const references = contents.filter(AST.isValueReference).filter(node => node.target.$refText === 'Pasted')
    Expect(bindings).toHaveLength(2)
    Expect(references).toHaveLength(2)
    Expect(references[0]?.target.ref).toBe(bindings[1])
    Expect(references[1]?.target.ref).toBe(bindings[0])
  })
})
