import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode, testParseSyntax } from './test-parse'

Describe('parser: optional when render fallback', () => {
  Test('keeps bare view-render arms as block statements in isolated subject and bar forms', async () => {
    for (
      const source of [
        `
        view Main(Enabled boolean) { render Col { when Enabled { yes -> Leaf } } }
        view Col { render inject \`\`\`ts return null \`\`\` }
        view Leaf { render inject \`\`\`ts return null \`\`\` }
      `,
        `
        view Main(Enabled boolean) { render Col { when Enabled | yes -> Leaf } }
        view Col { render inject \`\`\`ts return null \`\`\` }
        view Leaf { render inject \`\`\`ts return null \`\`\` }
      `,
      ]
    ) {
      const parsed = await testParseCode(source)
      const leaf = parsed.entry.ast.statements.find(statement =>
        AST.isViewDeclaration(statement) && statement.name === 'Leaf'
      )
      Expect.Is(leaf, AST.isViewDeclaration)
      const when = AST.streamAllContents(parsed.entry.ast).find(AST.isWhenRenderStatement)
      Expect.Is(when, AST.isWhenRenderStatement)
      const block = when.branches[0]!.block
      Expect.Is(block, AST.isBlock)
      const arm = block.statements[0]
      Expect.Is(arm, AST.isViewRender)
      Expect(arm.view?.ref).toBe(leaf)
    }
  })

  Test('keeps adjacent bare arms as four direct whens with linked view-render statements', async () => {
    const parsed = await testParseCode(`
      view Main(Enabled boolean) {
        render Col {
          when Enabled { yes -> Leaf }
          when Enabled | no -> Leaf
          when | Enabled -> Leaf
          when Enabled { yes -> Leaf otherwise -> Leaf }
        }
      }
      view Col { render inject \`\`\`ts return null \`\`\` }
      view Leaf { render inject \`\`\`ts return null \`\`\` }
    `)
    const views = parsed.entry.ast.statements.filter(AST.isViewDeclaration)
    const main = views.find(view => view.name === 'Main')
    const leaf = views.find(view => view.name === 'Leaf')
    Expect.Is(main, AST.isViewDeclaration)
    Expect.Is(leaf, AST.isViewDeclaration)
    const render = main.block!.statements.find(AST.isRenderStatement)
    Expect.Is(render, AST.isRenderStatement)
    const whens = render.block!.statements.filter(AST.isWhenRenderStatement)
    const armShapes = whens.map((when, index) => {
      const block = when.branches[0]?.block
      const arm = block?.statements[0]
      return {
        index,
        branches: when.branches.length,
        bodyType: arm?.$type,
        cstText: arm?.$cstNode?.text.slice(0, 80),
      }
    })
    Expect({ directWhenCount: whens.length, arms: armShapes }).toEqual({
      directWhenCount: 4,
      arms: [
        { index: 0, branches: 1, bodyType: 'ViewRender', cstText: 'Leaf' },
        { index: 1, branches: 1, bodyType: 'ViewRender', cstText: 'Leaf' },
        { index: 2, branches: 1, bodyType: 'ViewRender', cstText: 'Leaf' },
        { index: 3, branches: 1, bodyType: 'ViewRender', cstText: 'Leaf' },
      ],
    })
    Expect(whens).toHaveLength(4)
    for (const when of whens) {
      const arm = when.branches[0]!.block.statements[0]
      Expect.Is(arm, AST.isViewRender)
      Expect(arm.view?.ref).toBe(leaf)
    }
    const fallback = whens[3]!.otherwise?.block.statements[0]
    Expect.Is(fallback, AST.isViewRender)
    Expect(fallback.view?.ref).toBe(leaf)
  })

  Test('keeps all three fallback-free forms and explicit fallback in the existing branch fields', async () => {
    const parsed = await testParseCode(`
      view Main(Enabled boolean) {
        render Col {
          when Enabled { yes -> { Leaf } }
          when Enabled | no -> { Leaf }
          when | Enabled -> { Leaf }
          when Enabled { yes -> { Leaf } otherwise -> { Leaf } }
        }
      }
      view Col { render inject \`\`\`ts return null \`\`\` }
      view Leaf { render inject \`\`\`ts return null \`\`\` }
    `)
    const main = parsed.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Main'
    )
    Expect.Is(main, AST.isViewDeclaration)
    const enabled = AST.parametersOf(main)[0]
    const leaf = parsed.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Leaf'
    )
    Expect.Is(leaf, AST.isViewDeclaration)

    const whens = AST.streamAllContents(main).filter(AST.isWhenRenderStatement)
    Expect(whens).toHaveLength(4)
    Expect(whens.map(when => when.otherwise === undefined)).toEqual([true, true, true, false])
    Expect(whens.map(when => when.branches.length)).toEqual([1, 1, 1, 1])
    Expect(whens.map(when => when.branches[0]!.case)).toEqual(['yes', 'no', undefined, 'yes'])

    const bracedSubject = whens[0]!
    Expect.Is(bracedSubject.subject, AST.isValueReference)
    Expect(bracedSubject.subject.target.ref).toBe(enabled)
    const subjectBar = whens[1]!
    Expect.Is(subjectBar.subject, AST.isValueReference)
    Expect(subjectBar.subject.target.ref).toBe(enabled)
    Expect(subjectBar.branches[0]!.barSyntax).toBe(true)
    const predicateBar = whens[2]!
    Expect(predicateBar.subject).toBeUndefined()
    Expect.Is(predicateBar.branches[0]!.condition, AST.isValueReference)
    Expect(predicateBar.branches[0]!.condition.target.ref).toBe(enabled)

    for (const when of whens) {
      const arm = when.branches[0]!.block.statements[0]
      Expect.Is(arm, AST.isViewRender)
      Expect(arm.view?.ref).toBe(leaf)
    }
    const explicitOtherwise = whens[3]!.otherwise
    Expect.Is(explicitOtherwise, AST.isWhenRenderOtherwise)
    const fallback = explicitOtherwise.block.statements[0]
    Expect.Is(fallback, AST.isViewRender)
    Expect(fallback.view?.ref).toBe(leaf)
  })

  Test('binds pre-arrow error payloads through nested when render bodies', async () => {
    const parsed = await testParseCode(`
      data Documents / Document { Final yes / Draft no }
      view Main(Document) {
        render Stack() {
          when Document {
            error Problem -> {
              when Document {
                error Nested -> { Text(Problem.Message) Text(Nested.Message) }
              }
            }
          }
        }
      }
      view Stack() { render inject \`\`\`ts return null \`\`\` }
      view Text(Value text) { render inject \`\`\`ts return null \`\`\` }
    `)
    const main = parsed.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Main'
    )
    Expect.Is(main, AST.isViewDeclaration)
    const whens = AST.streamAllContents(main).filter(AST.isWhenRenderStatement)
    Expect(whens).toHaveLength(2)
    const [outer, nested] = whens
    Expect.Is(outer, AST.isWhenRenderStatement)
    Expect.Is(nested, AST.isWhenRenderStatement)
    Expect.Is(outer.branches[0]?.payload, AST.isCasePayload)
    Expect(outer.branches[0]!.payload!.name).toBe('Problem')
    Expect.Is(nested.branches[0]?.payload, AST.isCasePayload)
    Expect(nested.branches[0]!.payload!.name).toBe('Nested')
    const textRenders = nested.branches[0]!.block.statements.filter(AST.isViewRender)
    Expect(textRenders).toHaveLength(2)
    const problemMessage = AST.argumentsOf(textRenders[0]!)[0]?.value
    const nestedMessage = AST.argumentsOf(textRenders[1]!)[0]?.value
    Expect.Is(problemMessage, AST.isMemberAccessExpression)
    Expect.Is(nestedMessage, AST.isMemberAccessExpression)
    Expect(problemMessage.target.ref).toBe(outer.branches[0]!.payload)
    Expect(nestedMessage.target.ref).toBe(nested.branches[0]!.payload)
  })

  Test('parses old post-arrow payload spelling only as a view-render body', async () => {
    const parsed = await testParseSyntax(`
      view Main(Document) {
        render Stack() {
          when Document { error -> Problem { Text("body") } }
        }
      }
      view Stack() { render inject \`\`\`ts return null \`\`\` }
      view Problem() { render inject \`\`\`ts return null \`\`\` }
      view Text(Value text) { render inject \`\`\`ts return null \`\`\` }
    `)
    const when = AST.streamAllContents(parsed.entry.ast).find(AST.isWhenRenderStatement)
    Expect.Is(when, AST.isWhenRenderStatement)
    const branch = when.branches[0]!
    Expect(branch.payload).toBeUndefined()
    const body = branch.block.statements[0]
    Expect.Is(body, AST.isViewRender)
    Expect(body.view?.$refText).toBe('Problem')
  })
})
