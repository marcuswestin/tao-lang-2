import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'

Describe('source action targets', () => {
  Test('keeps the receiver call and associated-action arguments in their own positions', async () => {
    const parsed = await Parser.parseCode(
      `
      data Books / Book { action Book.Return(Limit number) { } }
      func LoadedItems(Feed text) -> Books { }
      action Use(Feed text, Limit number) {
        do LoadedItems(Feed).Return(Limit)
        do Ordinary()
      }
      action Ordinary() { }
    `,
      { validation: false },
    )

    Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    const invocations = AST.streamAllContents(parsed.entry.ast).filter(AST.isDoStatement)
    Expect(invocations).toHaveLength(2)
    const [associated, ordinary] = invocations
    Expect.Is(associated!.action, AST.isPostfixMemberAccess)
    Expect(associated!.action.member).toBe('Return')
    Expect.Is(associated!.action.receiver, AST.isFunctionCallExpression)
    Expect(associated!.action.receiver.function.$refText).toBe('LoadedItems')
    Expect(associated!.action.receiver.argumentList?.arguments.map(argument => argument.value.$type)).toEqual([
      'ValueReference',
    ])
    Expect(associated!.argumentList?.arguments.map(argument => argument.value.$type)).toEqual(['ValueReference'])
    Expect.Is(ordinary!.action, AST.isValueReference)
    Expect(ordinary!.action.target.$refText).toBe('Ordinary')
  })
})
