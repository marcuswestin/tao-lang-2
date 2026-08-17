import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: selectable loops', () => {
  Test('parses a loop-owned select handler with the singular row binding in scope', async () => {
    const parsed = await testParseCode(`
      app SelectableApp { view Main }
      view Main() {
        state Selected = ""
        render Stack() {
          loop ["One", "Two"] / Row {
            Text(Row)
            on select -> {
              set Selected = Row
            }
          }
        }
      }
      layout Stack() { }
      view Text(Value is text) { }
    `)

    const loop = AST.streamAllContents(parsed.entry.ast).find(AST.isForStatement)
    Expect.Is(loop, AST.isForStatement)
    const [handler] = AST.loopSelectHandlers(loop)
    Expect.Is(handler, AST.isLoopSelectHandler)
    Expect(handler.action).toBeUndefined()
    Expect(handler.block).toBeDefined()
    Expect(AST.directLoopForSelectHandler(handler)).toBe(loop)

    const set = handler.block?.statements.find(AST.isSetStatement)
    Expect.Is(set, AST.isSetStatement)
    Expect.Is(set.value, AST.isValueReference)
    Expect(set.value.target.ref).toBe(loop)
    Expect(AST.streamAllContents(parsed.entry.ast).filter(AST.isEventHandler)).toEqual([])
  })
})
