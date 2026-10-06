import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseSyntax } from './test-parse'

Describe('parser: qualified renders', () => {
  Test('retains named calls and qualified parameter expressions in the existing render fields', async () => {
    const parsed = await testParseSyntax(`
      type ContentValue is {
        Content text
        func Render() -> text { return Content }
      }
      view Foo(Value text) { render "foo" }
      view Container { render inject \`\`\`ts return null \`\`\` }
      view SlotContainer {
        @member = empty
        @method = empty
        render inject \`\`\`ts return null \`\`\`
      }
      view Child { render "child" }
      view Main(Value ContentValue) {
        render Foo(Value.Content) [pad 8] { Child }
        render Value.Content
        render Value.Render()
        render Container {
          Value.Content [pad 4]
          Value.Render() [pad 6]
        }
        render SlotContainer {
          @member: Value.Content [pad 10]
          @method: Value.Render() [pad 12]
        }
      }
    `)
    const main = parsed.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Main'
    )
    Expect.Is(main, AST.isViewDeclaration)
    const parameter = AST.parametersOf(main)[0]
    const parameters = main.block!.statements.filter(AST.isRenderStatement)
    Expect(parameters).toHaveLength(5)

    const [named, member, method, container, slotContainer] = parameters
    Expect.Is(named, AST.isRenderStatement)
    Expect(named.view?.$refText).toBe('Foo')
    const argument = named.argumentList!.arguments[0]!.value
    Expect.Is(argument, AST.isMemberAccessExpression)
    Expect(argument.target.ref).toBe(parameter)
    Expect(argument.members).toEqual(['Content'])
    Expect(named.layoutClause?.entries[0]?.head.$cstNode?.text).toBe('pad')
    Expect(AST.isViewRender(named.block!.statements[0])).toBe(true)

    Expect.Is(member, AST.isRenderStatement)
    Expect.Is(member.expression, AST.isMemberAccessExpression)
    Expect(member.expression.target.ref).toBe(parameter)
    Expect(member.expression.members).toEqual(['Content'])

    Expect.Is(method, AST.isRenderStatement)
    Expect.Is(method.expression, AST.isMethodCallExpression)
    Expect.Is(method.expression.callee, AST.isMemberAccessExpression)
    Expect(method.expression.callee.target.ref).toBe(parameter)
    Expect(method.expression.callee.members).toEqual(['Render'])

    Expect.Is(container, AST.isRenderStatement)
    const inlineRenders = container.block!.statements.filter(AST.isViewRender)
    Expect(inlineRenders).toHaveLength(2)
    const [inlineMember, inlineMethod] = inlineRenders
    Expect.Is(inlineMember, AST.isViewRender)
    Expect.Is(inlineMember.expression, AST.isMemberAccessExpression)
    Expect(inlineMember.expression.target.ref).toBe(parameter)
    Expect(inlineMember.expression.members).toEqual(['Content'])
    Expect(inlineMember.layoutClause?.entries[0]?.head.$cstNode?.text).toBe('pad')

    Expect.Is(inlineMethod, AST.isViewRender)
    Expect.Is(inlineMethod.expression, AST.isMethodCallExpression)
    Expect.Is(inlineMethod.expression.callee, AST.isMemberAccessExpression)
    Expect(inlineMethod.expression.callee.target.ref).toBe(parameter)
    Expect(inlineMethod.expression.callee.members).toEqual(['Render'])
    Expect(inlineMethod.layoutClause?.entries[0]?.head.$cstNode?.text).toBe('pad')

    Expect.Is(slotContainer, AST.isRenderStatement)
    const slotContainerDeclaration = parsed.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'SlotContainer'
    )
    Expect.Is(slotContainerDeclaration, AST.isViewDeclaration)
    const slotDeclarations = AST.renderSlotDeclarationsOf(slotContainerDeclaration)
    const fills = slotContainer.block!.statements.filter(AST.isRenderSlotUse)
    Expect(fills).toHaveLength(2)
    Expect(fills[0]!.slot.ref).toBe(slotDeclarations[0])
    Expect(fills[1]!.slot.ref).toBe(slotDeclarations[1])
    const [memberFill, methodFill] = fills

    Expect.Is(memberFill, AST.isRenderSlotUse)
    Expect.Is(memberFill.render, AST.isViewRender)
    Expect.Is(memberFill.render.expression, AST.isMemberAccessExpression)
    Expect(memberFill.render.expression.target.ref).toBe(parameter)
    Expect(memberFill.render.expression.members).toEqual(['Content'])
    Expect(memberFill.render.layoutClause?.entries[0]?.head.$cstNode?.text).toBe('pad')

    Expect.Is(methodFill, AST.isRenderSlotUse)
    Expect.Is(methodFill.render, AST.isViewRender)
    Expect.Is(methodFill.render.expression, AST.isMethodCallExpression)
    Expect.Is(methodFill.render.expression.callee, AST.isMemberAccessExpression)
    Expect(methodFill.render.expression.callee.target.ref).toBe(parameter)
    Expect(methodFill.render.expression.callee.members).toEqual(['Render'])
    Expect(methodFill.render.layoutClause?.entries[0]?.head.$cstNode?.text).toBe('pad')
  })
})
