import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode, testParseSyntax } from './test-parse'

Describe('parser: bare renders', () => {
  Test('keeps bare and parenthesized headers, roots and children in the existing render AST', async () => {
    const parsed = await testParseCode(`
      view Main { render Container { Leaf Leaf() } }
      view Container() { render Leaf() }
      view Leaf { render inject \`\`\`ts return null \`\`\` }
    `)
    const views = parsed.entry.ast.statements.filter(AST.isViewDeclaration)
    Expect(views.map(view => AST.parametersOf(view).length)).toEqual([0, 0, 0])
    const root = views[0]!.block!.statements.find(AST.isRenderStatement)!
    Expect(root.view?.ref).toBe(views[1])
    Expect(root.block!.statements.filter(AST.isViewRender).map(render => render.view?.ref === views[2])).toEqual([
      true,
      true,
    ])
  })

  Test('parses a bare lexical value render into the existing render reference field', async () => {
    const parsed = await testParseSyntax('view Main { state Title is text = "Books" render Title }')
    const main = parsed.entry.ast.statements.find(AST.isViewDeclaration)!
    const render = main.block!.statements.find(AST.isRenderStatement)!
    Expect(render.view?.$refText).toBe('Title')
    Expect(render.argumentList).toBeUndefined()
    Expect(render.block).toBeUndefined()
  })

  Test('lowers empty and interpolated quotations to normal arguments while retaining source ranges', async () => {
    const parsed = await testParseSyntax(
      'view Main { state Name is text = "Books" render "{Name}" [pad 8] } view Empty { render "" }',
    )
    const renders = AST.streamAllContents(parsed.entry.ast).filter(AST.isQuotedRender)
    Expect(renders.length).toBe(2)
    Expect(renders[0]!.argumentList!.arguments[0]!.value.$type).toBe('InterpolatedString')
    Expect(renders[0]!.argumentList!.arguments[0]!.value.$cstNode!.text).toBe('"{Name}"')
    Expect(renders[0]!.layoutClause!.entries[0]!.head.$cstNode!.text).toBe('pad')
    const empty = renders[1]!.argumentList!.arguments[0]!.value
    Expect(AST.isStringLiteral(empty) && empty.value).toBe('')
    Expect(empty.$container?.$container).toBe(renders[1]!.argumentList)
  })

  Test('retains declaration fills and adjacent root ownership', async () => {
    const parsed = await testParseCode(
      'scene Main { Title "Books" render Leaf } view Leaf { render inject ```ts return null ``` }',
    )
    const main = parsed.entry.ast.statements.find(AST.isViewDeclaration)!
    Expect(main.block!.statements.map(statement => statement.$type)).toEqual(['DeclarationSlotFill', 'RenderStatement'])
    const fill = main.block!.statements[0]!
    Expect(AST.isDeclarationSlotFill(fill) && fill.name).toBe('Title')
  })

  Test('retains named guard handlers and when payload blocks', async () => {
    const parsed = await testParseCode(`
      view Main(Value text) {
        guard Value Failed -> Failure { Handler(Failure) }
        render Host { when Value { missing Reason -> { Handler(Reason) } otherwise -> Leaf } }
      }
      view Handler(Value text) { render Leaf }
      view Host { render Leaf }
      view Leaf { render inject \`\`\`ts return null \`\`\` }
    `)
    const guard = AST.streamAllContents(parsed.entry.ast).find(AST.isGuardRenderStatement)!
    Expect(guard.single!.case).toBe('Failed')
    Expect(guard.single!.payload!.name).toBe('Failure')
    Expect(guard.single!.block!.statements.length).toBe(1)
    const when = AST.streamAllContents(parsed.entry.ast).find(AST.isWhenRenderStatement)!
    Expect(when.branches[0]!.payload!.name).toBe('Reason')
    Expect(when.branches[0]!.block.statements.length).toBe(1)
    Expect(when.otherwise.block.statements[0]!.$type).toBe('ViewRender')
  })

  Test('retains app guard payload blocks before bare handler alternatives', async () => {
    const parsed = await testParseCode(`
      app Sample { view Main guard { loading -> Context { Handler(Context) } error -> Handler } }
      view Main { render Handler }
      view Handler(Value text default "") { render inject \`\`\`ts return null \`\`\` }
    `)
    const branches = AST.streamAllContents(parsed.entry.ast).filter(AST.isAppGuardBranch)
    Expect(branches[0]!.payload!.name).toBe('Context')
    Expect(branches[0]!.render).toBeUndefined()
    Expect(branches[0]!.block!.statements.length).toBe(1)
    Expect(branches[1]!.render!.view.$refText).toBe('Handler')
  })
})
