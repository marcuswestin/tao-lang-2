import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseSyntax } from './test-parse'

Describe('parser: inline renderer inputs', () => {
  Test('retains bare and parenthesized input names as owned bindings before the renderer body', async () => {
    const parsed = await testParseSyntax(`
      type Occurrence is { Ordinal number }
      view Receiver {
        @item(Value text, Occurrence): empty
        render "receiver"
      }
      view Main {
        render Receiver { @item Entry, Position -> Entry [pad 8] }
        render Receiver { @item(Entry, Position) -> Entry [pad 9] }
        render Receiver { @item Entry -> Entry.Content [pad 10] }
      }
    `)
    const main = parsed.entry.ast.statements.find(node => AST.isViewDeclaration(node) && node.name === 'Main')
    Expect.Is(main, AST.isViewDeclaration)
    const calls = main.block!.statements.filter(AST.isRenderStatement)
    Expect(calls).toHaveLength(3)
    const fills = calls.map(call => call.block!.statements[0]!)
    for (const fill of fills) {
      Expect.Is(fill, AST.isRenderSlotUse)
      Expect(fill.fill).toBe(true)
      Expect(fill.argumentList).toBeUndefined()
      Expect(fill.inputBindings.every(AST.isRenderSlotInputBinding)).toBe(true)
      Expect(fill.inputBindings.every(binding => binding.$container === fill)).toBe(true)
      Expect(fill.slot.ref?.name).toBe('@item')
    }
    const [bare, parenthesized, member] = fills
    Expect.Is(bare, AST.isRenderSlotUse)
    Expect.Is(parenthesized, AST.isRenderSlotUse)
    Expect.Is(member, AST.isRenderSlotUse)
    Expect(bare.inputBindings.map(binding => binding.name)).toEqual(['Entry', 'Position'])
    Expect(parenthesized.inputBindings.map(binding => binding.name)).toEqual(['Entry', 'Position'])
    Expect(bare.render?.view?.$refText).toBe('Entry')
    Expect(parenthesized.render?.view?.$refText).toBe('Entry')
    Expect(bare.render?.layoutClause?.entries[0]?.terms[0]?.$cstNode?.text).toBe('8')
    Expect(parenthesized.render?.layoutClause?.entries[0]?.terms[0]?.$cstNode?.text).toBe('9')
    Expect.Is(member.render?.expression, AST.isMemberAccessExpression)
    Expect(member.render.expression.target.$refText).toBe('Entry')
    Expect(member.render.expression.members).toEqual(['Content'])
  })

  Test('keeps the receiving slot and lexical forwarded renderer as distinct references', async () => {
    const parsed = await testParseSyntax(`
      view Receiver {
        @item(Value text): empty
        render "receiver"
      }
      view Main {
        @outer(Value text): empty
        render Receiver { @item: @outer }
      }
    `)
    const receiver = parsed.entry.ast.statements.find(node => AST.isViewDeclaration(node) && node.name === 'Receiver')
    const main = parsed.entry.ast.statements.find(node => AST.isViewDeclaration(node) && node.name === 'Main')
    Expect.Is(receiver, AST.isViewDeclaration)
    Expect.Is(main, AST.isViewDeclaration)
    const call = main.block!.statements.find(AST.isRenderStatement)!
    const fill = call.block!.statements[0]!
    Expect.Is(fill, AST.isRenderSlotUse)
    Expect(fill.fill).toBe(true)
    Expect(fill.slot.ref).toBe(AST.renderSlotDeclarationsOf(receiver)[0])
    Expect(fill.forwardedSlot?.$refText).toBe('@outer')
    Expect(fill.forwardedSlot).not.toBe(fill.slot)
    Expect(fill.renderer).toBeUndefined()
    Expect(fill.argumentList).toBeUndefined()
    Expect(fill.render).toBeUndefined()
  })
})
