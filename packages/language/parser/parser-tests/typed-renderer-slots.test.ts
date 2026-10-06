import { AST } from '@parser'
import { Describe, Expect, stubView, Test } from '@shared/test'
import { testParseCode, testParseSyntax } from './test-parse'

Describe('parser: typed renderer slot scopes', () => {
  Test('layers real inline bindings beneath local aliases and above enclosing parameters', async () => {
    const parsed = await testParseCode(`
      ${stubView('Text', 'Value text')}
      ${stubView('Column', 'Value text')}
      view Rows where type T is text (Items list of T) accepts slots @item(Value T, Ordinal number) from ./Rows.tsx
      view Main(Entry text) {
        let Items = ["one"]
        render Rows(Items) {
          @item Entry, Position -> Column(Entry) {
            let Entry = "inner"
            Text(Entry)
            Text(Position)
          }
          Text(Entry)
        }
      }
    `)
    const main = parsed.entry.ast.statements.find(node => AST.isViewDeclaration(node) && node.name === 'Main')
    Expect.Is(main, AST.isViewDeclaration)
    const invocation = main.block!.statements.find(AST.isRenderStatement)!
    const fill = invocation.block!.statements.find(AST.isRenderSlotUse)!
    const [entry, position] = fill.inputBindings
    Expect.Is(entry, AST.isRenderSlotInputBinding)
    Expect.Is(position, AST.isRenderSlotInputBinding)
    const body = fill.render!
    const first = AST.argumentsOf(body)[0]!.value
    Expect.Is(first, AST.isValueReference)
    Expect(first.target.ref).toBe(entry)
    const alias = body.block!.statements.find(AST.isAliasDeclaration)!
    const nested = body.block!.statements.filter(AST.isViewRender)
    const nestedEntry = AST.argumentsOf(nested[0]!)[0]!.value
    const nestedPosition = AST.argumentsOf(nested[1]!)[0]!.value
    Expect.Is(nestedEntry, AST.isValueReference)
    Expect.Is(nestedPosition, AST.isValueReference)
    Expect(nestedEntry.target.ref).toBe(alias)
    Expect(nestedPosition.target.ref).toBe(position)
    const sibling = invocation.block!.statements.find(AST.isViewRender)!
    const outerEntry = AST.argumentsOf(sibling)[0]!.value
    Expect.Is(outerEntry, AST.isValueReference)
    Expect(outerEntry.target.ref).toBe(AST.parametersOf(main)[0])
  })

  Test('keeps inline binding names inside their own renderer body', async () => {
    const parsed = await testParseSyntax(`
      ${stubView('Text', 'Value text')}
      view Rows(Items list of text) accepts slots @item(Value text) from ./Rows.tsx
      view Main(Items list of text) {
        render Rows(Items) { @item Entry -> Text(Entry) Text(Entry) }
      }
      view Outside { let Escaped = Entry render Text("") }
    `)
    const references = [...AST.streamAllContents(parsed.entry.ast)]
      .filter(AST.isValueReference).filter(reference => reference.target.$refText === 'Entry')
    Expect(references).toHaveLength(3)
    Expect.Is(references[0]!.target.ref, AST.isRenderSlotInputBinding)
    Expect(references.slice(1).map(reference => reference.target.ref)).toEqual([undefined, undefined])
    Expect(parsed.diagnostics).toHaveLength(2)
  })

  Test('links receiving and forwarded slots by their respective owners even when names match', async () => {
    const parsed = await testParseCode(`
      ${stubView('Leaf')}
      view Receiver { @item(Value text): empty render Leaf() }
      view Caller { @item(Value text): empty render Receiver { @item: @item } }
    `)
    const views = parsed.entry.ast.statements.filter(AST.isViewDeclaration)
    const receiver = views.find(view => view.name === 'Receiver')!
    const caller = views.find(view => view.name === 'Caller')!
    const use = [...AST.streamAllContents(caller)].find(AST.isRenderSlotUse)!
    Expect(use.slot.ref).toBe(AST.renderSlotDeclarationsOf(receiver)[0])
    Expect(use.forwardedSlot?.ref).toBe(AST.renderSlotDeclarationsOf(caller)[0])
    Expect(use.forwardedSlot?.ref === use.slot.ref).toBe(false)
    Expect(AST.renderSlotBodyOf(use).kind).toBe('forwarded')
  })

  Test('keeps a missing colon from turning a placement into a forwarded fill', async () => {
    const parsed = await testParseSyntax(`
      ${stubView('Leaf')}
      view Receiver { @item(Value text): empty render Leaf() }
      view Caller { @item(Value text): empty render Receiver { @item @item } }
    `)
    const caller = parsed.entry.ast.statements.find(node => AST.isViewDeclaration(node) && node.name === 'Caller')
    Expect.Is(caller, AST.isViewDeclaration)
    const uses = [...AST.streamAllContents(caller)].filter(AST.isRenderSlotUse)
    Expect(uses).toHaveLength(2)
    Expect(uses.map(AST.isRenderSlotFill)).toEqual([false, false])
    Expect(uses.map(use => use.forwardedSlot)).toEqual([undefined, undefined])
    Expect(uses.every(use => use.slot.ref === AST.renderSlotDeclarationsOf(caller)[0])).toBe(true)
  })
})
