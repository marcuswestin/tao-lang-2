import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: effect outcomes', () => {
  Test('parses `when do` with its invocation and every outcome form', async () => {
    const parsed = await testParseCode(`
      type ExportFailure is one of Offline, TooLarge
      action ExportDocument(Format text)
        fails Offline "Exporting needs a connection."
        fails TooLarge "This document is too long to export."
        from ./Export.ts
      view Main() {
        state Failure = ""
        action RunExport() {
          when do ExportDocument(Format: "pdf") {
            saved -> { set Failure = "" }
            Offline -> { set Failure = "offline" }
            rejected -> Problem { set Failure = Problem }
            error -> Message { set Failure = Message }
          }
        }
      }
    `)
    const statement = AST.streamAllContents(parsed.entry.ast).find(AST.isWhenDoStatement)
    Expect.Is(statement, AST.isWhenDoStatement)
    Expect.Is(statement.invocation.action, AST.isValueReference)
    Expect(statement.invocation.action.target.$refText).toBe('ExportDocument')
    Expect(statement.outcomes.map(outcome => [outcome.case, outcome.payload?.name])).toEqual([
      ['saved', undefined],
      ['Offline', undefined],
      ['rejected', 'Problem'],
      ['error', 'Message'],
    ])
  })

  Test('binds an outcome payload inside its own block', async () => {
    const parsed = await testParseCode(`
      action Save() { }
      view Main() {
        state Failure = ""
        action Run() {
          when do Save() {
            rejected -> Problem { set Failure = Problem }
          }
        }
      }
    `)
    const statement = AST.streamAllContents(parsed.entry.ast).find(AST.isWhenDoStatement)
    Expect.Is(statement, AST.isWhenDoStatement)
    const set = statement.outcomes[0]?.block.statements[0]
    Expect.Is(set, AST.isSetStatement)
    Expect.Is(set.value, AST.isValueReference)
    Expect(set.value.target.ref).toBe(statement.outcomes[0]?.payload)
  })

  Test('leaves `saved` and `rejected` usable as ordinary names', async () => {
    const parsed = await testParseCode(`
      view Main() {
        state saved = true
        state rejected = false
      }
    `)
    Expect(AST.streamAllContents(parsed.entry.ast).filter(AST.isStateDeclaration).map(state => state.name))
      .toEqual(['saved', 'rejected'])
  })
})
