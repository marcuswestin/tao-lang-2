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

  Test('parses `do ... then` outcomes and cleanup forms', async () => {
    const parsed = await testParseCode(`
      action Save() { }
      action Delete(File text) { }
      view Main() {
        action Run() {
          do Save() then {
            done -> { }
            Full -> Message { }
            error -> Message { }
            cancelled -> { }
            otherwise -> { }
          }
          defer { do Delete(File: "old") }
          defer Delete(File: "later")
        }
      }
    `)
    const statements = AST.streamAllContents(parsed.entry.ast)
    const then = statements.find(AST.isDoStatement)
    Expect.Is(then, AST.isDoStatement)
    Expect(then.then).toBe(true)
    Expect(then.outcomes.map(outcome => [outcome.case, outcome.payload?.name])).toEqual([
      ['done', undefined],
      ['Full', 'Message'],
      ['error', 'Message'],
      ['cancelled', undefined],
      ['otherwise', undefined],
    ])
    Expect(then.otherwise).toBeUndefined()
    const deferred = statements.filter(AST.isDeferStatement)
    Expect(deferred).toHaveLength(2)
    Expect.Is(deferred[0]!.block, AST.isActionBlock)
    Expect.Is(deferred[1]!.invocation, AST.isDoStatement)
    Expect(deferred[1]!.invocation.action.$type).toBe('ValueReference')
    Expect(deferred[1]!.invocation.$cstNode?.text.startsWith('Delete')).toBe(true)
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
