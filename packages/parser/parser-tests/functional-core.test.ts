import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { parseCodeWithErrors, testParseCode } from './test-parse'

Describe('functional core parser', () => {
  Test('parses expressions, functions, total conditionals, actions, and iteration', async () => {
    const result = await testParseCode(`
      function HasCount Count is number returns boolean = Count > 0 and not false
      function Label Count is number returns text = when
        Count > 1 -> interpolate "Count: ", Count + 1
        otherwise -> "Empty"
      view Main {
        state Ready = false
        action Flip {
          when
            Ready -> { toggle Ready }
            otherwise -> { toggle Ready }
        }
        render Stack(){
          when
            HasCount(2) -> {
            Text(Label(2))
            }
            otherwise -> {
            Text("Empty")
            }
          for Name in ["Inbox" "Today"] {
            Text(Name)
          }
        }
      }
      layout Stack { render inject \`\`\`ts\nreturn null\n\`\`\` }
      view Text Value is text { render inject Value \`\`\`ts\nreturn null\n\`\`\` }
    `)

    const hasCount = result.entry.ast.statements.find(statement =>
      AST.isFunctionDeclaration(statement) && statement.name === 'HasCount'
    )
    Expect.Is(hasCount, AST.isFunctionDeclaration)
    Expect.Is(hasCount.value, AST.isBinaryExpression)
    Expect(hasCount.value.operator).toBe('and')

    const main = result.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Main'
    )
    Expect.Is(main, AST.isViewDeclaration)
    const render = AST.blockStatementOf(main, { find: AST.isRenderStatement })
    Expect.Is(render, AST.isRenderStatement)
    const controls = AST.statementsOf(render.block)
    const when = controls.find(AST.isWhenRenderStatement)
    Expect.Is(when, AST.isWhenRenderStatement)
    Expect(when.branches).toHaveLength(1)
    Expect(when.otherwise.block.statements).toHaveLength(1)
    const loop = controls.find(AST.isForStatement)
    Expect.Is(loop, AST.isForStatement)
    const loopText = loop.block.statements[0]
    Expect.Is(loopText, AST.isViewRender)
    const loopValue = AST.argumentsOf(loopText)[0]?.value
    Expect.Is(loopValue, AST.isValueReference)
    Expect(loopValue.target.ref).toBe(loop)
  })

  Test('requires otherwise in value, render, and action conditionals', async () => {
    const value = await parseCodeWithErrors('let Result = when true -> "yes"')
    const render = await parseCodeWithErrors('view Main { render Stack() { when true -> { Text("yes") } } }')
    const action = await parseCodeWithErrors('action Run { when true -> { } }')

    Expect(value.entry.document.parseResult.parserErrors.length).toBeGreaterThan(0)
    Expect(render.entry.document.parseResult.parserErrors.length).toBeGreaterThan(0)
    Expect(action.entry.document.parseResult.parserErrors.length).toBeGreaterThan(0)
  })

  Test('parses typed parameter defaults across declarations', async () => {
    const result = await testParseCode(`
      function Label Value is text default "Save" returns text = Value
      view Main Title is text default "Welcome" {
        action Submit Message is text default "Saved" { }
        render Card()
      }
      layout Card Gap is number default 8 { render inject \`\`\`ts\nreturn null\n\`\`\` }
    `)

    const label = result.entry.ast.statements.find(statement => AST.isFunctionDeclaration(statement))
    const main = result.entry.ast.statements.find(statement => AST.isViewDeclaration(statement))
    const card = result.entry.ast.statements.find(statement => AST.isLayoutDeclaration(statement))
    Expect.Is(label, AST.isFunctionDeclaration)
    Expect.Is(main, AST.isViewDeclaration)
    Expect.Is(card, AST.isLayoutDeclaration)
    const submit = AST.blockStatementOf(main, { find: AST.isActionDeclaration })
    Expect.Is(submit, AST.isActionDeclaration)

    Expect(AST.parametersOf(label)[0]?.defaultValue?.$type).toBe('StringLiteral')
    Expect(AST.parametersOf(main)[0]?.defaultValue?.$type).toBe('StringLiteral')
    Expect(AST.parametersOf(submit)[0]?.defaultValue?.$type).toBe('StringLiteral')
    Expect(AST.parametersOf(card)[0]?.defaultValue?.$type).toBe('NumberLiteral')
  })
})
