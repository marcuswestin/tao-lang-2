import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { parseCodeWithErrors, rejectsParser, testParseCode, testParseSyntax } from './test-parse'

function viewsOf(file: AST.TaoFile): AST.ViewDeclaration[] {
  return file.statements.filter(AST.isViewDeclaration)
}

Describe('parser: renderer slots', () => {
  Test('keeps declaration, fill, placement, renderer and inline body shapes distinct', async () => {
    const result = await testParseCode(`
      view Label { render inject \`\`\`ts return null \`\`\` }
      type Title is text
      view Box {
        state Count is number = 10
        @header(mutable Count number, Next number default Count, Change action default -> { set Count += 1 }): Label
        @footer: empty
        @body: Label [pad 8] { on press -> { } }
        @legacy = empty
        @header(TitleValue: 5)
        @header(TitleValue: 6)
        @footer
        @body
      }
      view Page {
        @header: Label
        @header
        render Box {
          @header: Label
          @footer: empty
          #slotBody
          @body: Label()
        }
      }
    `)
    const [label, box, page] = viewsOf(result.entry.ast)
    Expect.Is(box, AST.isViewDeclaration)
    Expect.Is(page, AST.isViewDeclaration)
    const slots = box.block!.statements.filter(AST.isRenderSlotDeclaration)
    Expect(slots.map(slot => AST.renderSlotBodyOf(slot).kind)).toEqual(['named', 'empty', 'render', 'empty'])
    Expect(slots[2]!.render?.layoutClause?.entries[0]?.head.$cstNode?.text).toBe('pad')
    Expect(slots[2]!.render?.block?.statements.some(AST.isEventHandler)).toBe(true)
    const slotParameters = AST.renderSlotParametersOf(slots[0]!)
    Expect(slotParameters.map(parameter => parameter.inlineType?.name)).toEqual(['Count', 'Next', 'Change'])
    Expect(AST.renderSlotParameterOwner(slotParameters[0]!)).toBe(slots[0])
    Expect(AST.isValueReference(slotParameters[1]!.defaultValue)).toBe(true)
    Expect(AST.isValueReference(slotParameters[1]!.defaultValue) && slotParameters[1]!.defaultValue.target.ref)
      .toBe(slotParameters[0])
    const mutation = AST.streamAllContents(slotParameters[2]!.defaultValue!).find(AST.isSetStatement)
    Expect.Is(mutation, AST.isSetStatement)
    Expect(mutation.target.ref).toBe(slotParameters[0])
    const render = page.block!.statements.find(AST.isRender)
    Expect.Is(render, AST.isRender)
    const placements = box.block!.statements.filter(AST.isRenderSlotUse)
    const uses = render.block!.statements.filter(AST.isRenderSlotUse)
    const pageSlots = page.block!.statements.filter(AST.isRenderSlotDeclaration)
    const pagePlacement = page.block!.statements.find(AST.isRenderSlotUse)
    Expect(AST.renderSlotDeclarationsOf(box).map(slot => slot.name)).toEqual(['@header', '@footer', '@body', '@legacy'])
    Expect(placements.map(AST.isRenderSlotFill)).toEqual([false, false, false, false])
    Expect(uses.map(AST.isRenderSlotFill)).toEqual([true, true, true])
    Expect(uses.map(use => AST.renderSlotBodyOf(use).kind)).toEqual(['named', 'empty', 'render'])
    Expect(placements[0]!.slot.ref).toBe(slots[0])
    Expect(uses[0]!.slot.ref).toBe(slots[0])
    Expect(uses[0]!.renderer?.ref).toBe(label)
    Expect(AST.attachedTag(uses[2]!)?.tag).toBe('#slotBody')
    Expect(placements.slice(0, 2).every(use => AST.argumentsOf(use).length === 1)).toBe(true)
    Expect(pagePlacement?.slot.ref).toBe(pageSlots[0])
  })

  Test('accepts real zero-input braced slot bodies and quoted inline bodies', async () => {
    const result = await testParseSyntax(`
      view Label { render inject \`\`\`ts return null \`\`\` }
      view Box {
        @header = empty
        @header "hello"
        "world"
        @footer: { render Label }
        @body: "inline" [pad 4] { on press -> { } }
      }
      view Native accepts slots @header(TitleValue text) from ./Native.tsx
    `)
    const [label, box, native] = viewsOf(result.entry.ast)
    Expect.Is(label, AST.isViewDeclaration)
    Expect.Is(box, AST.isViewDeclaration)
    Expect.Is(native, AST.isViewDeclaration)
    const slots = box.block!.statements.filter(AST.isRenderSlotDeclaration)
    Expect(slots.map(slot => AST.renderSlotBodyOf(slot).kind)).toEqual(['empty', 'block', 'render'])
    const statements = box.block!.statements
    Expect(AST.isRenderSlotUse(statements[1])).toBe(true)
    Expect(AST.isViewRender(statements[2])).toBe(true)
    Expect(AST.isRenderSlotUse(statements[1]) && statements[1].slot.ref).toBe(slots[0])
    Expect(AST.isViewRender(statements[2])).toBe(true)
    Expect(result.diagnostics.map(diagnostic => diagnostic.message)).toEqual(["No view named 'Text' is in scope."])
    const quotedBody = AST.renderSlotBodyOf(slots[2]!)
    Expect(quotedBody.kind).toBe('render')
    if (quotedBody.kind === 'render') {
      Expect.Is(quotedBody.render, AST.isViewRender)
    }
    Expect(slots[2]!.render?.layoutClause?.entries[0]?.head.$cstNode?.text).toBe('pad')
    Expect(slots[2]!.render?.block?.statements.some(AST.isEventHandler)).toBe(true)
    Expect(AST.renderSlotParametersOf(native.foreign!.slots[0]!).map(parameter => parameter.inlineType?.name))
      .toEqual(['TitleValue'])
    Expect(AST.renderSlotParameterOwner(native.foreign!.slots[0]!.parameterList!.parameters[0]!))
      .toBe(native.foreign!.slots[0])
  })

  Test('layers slot parameters at their lexical depth and restricts defaults to preceding parameters', async () => {
    const result = await parseCodeWithErrors(`
      view Label { render inject \`\`\`ts return null \`\`\` }
      view Box {
        state Count is number = 10
        @item(Count number, Next number default Count, Self number default Self, Later number default Final, Final number): Label
      }
      view Outside { let Value = Count }
    `)
    const [label, box, outside] = viewsOf(result.entry.ast)
    Expect.Is(label, AST.isViewDeclaration)
    Expect.Is(box, AST.isViewDeclaration)
    Expect.Is(outside, AST.isViewDeclaration)
    const slot = box.block!.statements.find(AST.isRenderSlotDeclaration)!
    const parameters = AST.renderSlotParametersOf(slot)
    Expect(
      AST.isValueReference(parameters[1]!.defaultValue)
        && parameters[1]!.defaultValue.target.ref === parameters[0],
    ).toBe(true)
    Expect(
      AST.isValueReference(parameters[2]!.defaultValue)
        && parameters[2]!.defaultValue.target.ref === undefined,
    ).toBe(true)
    Expect(
      AST.isValueReference(parameters[3]!.defaultValue)
        && parameters[3]!.defaultValue.target.ref === undefined,
    ).toBe(true)
    const state = outside.block!.statements.find(AST.isAliasDeclaration)!.value
    Expect(AST.isValueReference(state) && state.target.ref === undefined).toBe(true)
  })

  Test(
    'rejects anonymous slot binders',
    rejectsParser(`
    view Label { render inject \`\`\`ts return null \`\`\` }
    view Box { @header: (text) -> render Label(text) }
  `),
  )
})
