import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { formats } from './test-format'

const source = `
  type ContentValue is {
    Content text
    func Render() -> text { return Content }
  }
  view Label { render "Label" }
  view Foo(Value text) { render "foo" }
  view SlotContainer {
    @member = empty
    @method = empty
    render inject \`\`\`ts return null \`\`\`
  }
  view Child { render "child" }
  view Main(Value ContentValue) {
    render Label
    render Foo(Value.Content) [pad 8] { Child }
    render Value.Content
    render Value.Render()
    render SlotContainer {
      @member: Value.Content [pad 10]
      @method: Value.Render() [pad 12]
    }
  }
`

const expected = `
  type ContentValue is {
     Content text

     func Render() -> text {
        return Content
     }
  }

  view Label {
     render "Label"
  }

  view Foo(Value text) {
     render "foo"
  }

  view SlotContainer {
     @member = empty
     @method = empty
     render inject \`\`\`ts return null \`\`\`
  }

  view Child {
     render "child"
  }

  view Main(Value ContentValue) {
     render Label
     render Foo(Value.Content) [pad 8] {
        Child
     }
     render Value.Content
     render Value.Render()
     render SlotContainer {
        @member: Value.Content [pad 10]
        @method: Value.Render() [pad 12]
  }  }
`

Describe('formatter: qualified renders', () => {
  Test('formats named and qualified renders and slot fills without changing their AST fields', async () => {
    const formatted = await formats(source, expected)()
    const parsed = await Parser.parseCode(formatted, { validation: false })
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    const main = parsed.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Main'
    )
    Expect.Is(main, AST.isViewDeclaration)
    const parameter = AST.parametersOf(main)[0]
    const renders = main.block!.statements.filter(AST.isRenderStatement)
    Expect(renders).toHaveLength(5)

    const [named, called, member, method, slotCall] = renders
    Expect.Is(named, AST.isRenderStatement)
    Expect(named.view?.ref?.name).toBe('Label')

    Expect.Is(called, AST.isRenderStatement)
    Expect(called.view?.ref?.name).toBe('Foo')
    Expect(called.argumentList?.arguments).toHaveLength(1)
    const argument = called.argumentList!.arguments[0]!.value
    Expect.Is(argument, AST.isMemberAccessExpression)
    Expect(argument.target.ref).toBe(parameter)
    Expect(argument.members).toEqual(['Content'])
    Expect(called.layoutClause?.entries[0]?.head.$cstNode?.text).toBe('pad')
    Expect(called.block?.statements.some(AST.isViewRender)).toBe(true)

    Expect.Is(member, AST.isRenderStatement)
    Expect.Is(member.expression, AST.isMemberAccessExpression)
    Expect(member.expression.target.ref).toBe(parameter)
    Expect(member.expression.members).toEqual(['Content'])

    Expect.Is(method, AST.isRenderStatement)
    Expect.Is(method.expression, AST.isMethodCallExpression)
    Expect.Is(method.expression.callee, AST.isMemberAccessExpression)
    Expect(method.expression.callee.target.ref).toBe(parameter)
    Expect(method.expression.callee.members).toEqual(['Render'])

    Expect.Is(slotCall, AST.isRenderStatement)
    const slotContainer = parsed.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'SlotContainer'
    )
    Expect.Is(slotContainer, AST.isViewDeclaration)
    const slotDeclarations = AST.renderSlotDeclarationsOf(slotContainer)
    const fills = slotCall.block!.statements.filter(AST.isRenderSlotUse)
    Expect(fills).toHaveLength(2)
    Expect(fills[0]!.slot.ref).toBe(slotDeclarations[0])
    Expect(fills[1]!.slot.ref).toBe(slotDeclarations[1])

    const [memberFill, methodFill] = fills
    Expect.Is(memberFill.render, AST.isViewRender)
    Expect.Is(memberFill.render.expression, AST.isMemberAccessExpression)
    Expect(memberFill.render.expression.target.ref).toBe(parameter)
    Expect(memberFill.render.expression.members).toEqual(['Content'])
    Expect(memberFill.render.layoutClause?.entries[0]?.head.$cstNode?.text).toBe('pad')

    Expect.Is(methodFill.render, AST.isViewRender)
    Expect.Is(methodFill.render.expression, AST.isMethodCallExpression)
    Expect.Is(methodFill.render.expression.callee, AST.isMemberAccessExpression)
    Expect(methodFill.render.expression.callee.target.ref).toBe(parameter)
    Expect(methodFill.render.expression.callee.members).toEqual(['Render'])
    Expect(methodFill.render.layoutClause?.entries[0]?.head.$cstNode?.text).toBe('pad')
  })
})
