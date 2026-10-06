import Formatter from '@formatter'
import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'

Describe('formatter: atomic event handlers', () => {
  Test('keeps atomic do handlers canonical and preserves the existing action body', async () => {
    const source = 'view Main{render Button{on press->do Commit() then {done->{}}}} action Commit(){}'
    const formatted = await Formatter.formatCode(source)
    Expect(formatted).toContain('on press -> do Commit()')
    Expect(await Formatter.formatCode(formatted)).toBe(formatted)
    const parsed = await Parser.parseCode(formatted, { validation: false })
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    const handlers = AST.streamAllContents(parsed.entry.ast).filter(AST.isEventHandler)
    Expect(handlers).toHaveLength(1)
    Expect(handlers[0]!.block!.statements.map(statement => statement.$type)).toEqual(['DoStatement'])
    const statement = handlers[0]!.block!.statements[0]!
    Expect(AST.isDoStatement(statement) && statement.then).toBe(true)
    Expect(AST.isDoStatement(statement) && statement.outcomes.map(outcome => outcome.case)).toEqual(['done'])
  })
})
