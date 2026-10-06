import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { parseCodeWithErrors, testParseSyntax } from './test-parse'

Describe('parser: atomic event handlers', () => {
  Test('accepts one action statement after the event arrow, including a then block', async () => {
    const parsed = await testParseSyntax(`
      view Main {
        render Button {
          on press -> do Commit()
          on submit -> do Save() then { saved -> { } }
          on change Commit
        }
      }
      action Commit() { }
      action Save() { }
    `)
    const handlers = AST.streamAllContents(parsed.entry.ast).filter(AST.isEventHandler)
    Expect(handlers).toHaveLength(3)
    Expect(handlers.map(handler => handler.block?.statements[0]?.$type)).toEqual([
      'DoStatement',
      'DoStatement',
      undefined,
    ])
    Expect(handlers[0]!.action).toBeUndefined()
    Expect(handlers[1]!.block?.statements[0] && AST.isDoStatement(handlers[1]!.block.statements[0]!))
      .toBe(true)
    Expect(handlers[2]!.action?.target.$refText).toBe('Commit')
  })

  Test('still requires an arrow before an inline event action', async () => {
    await parseCodeWithErrors('view Main { render Button { on press do Commit() } }')
  })
})
