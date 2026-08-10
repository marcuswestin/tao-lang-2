import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('functional core parser', () => {
  Test('parses expressions, functions, conditionals, and iteration', async () => {
    const result = await testParseCode(`
      function HasCount Count is number returns boolean = Count > 0 and not false
      function Label Count is number returns text = interpolate "Count: ", Count + 1
      view Main {
        render Stack(){
          if HasCount(2) {
            Text(Label(2))
          } else {
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
    const render = AST.blockStatementOf(main, 0)
    Expect.Is(render, AST.isRenderStatement)
    const controls = AST.statementsOf(render.block)
    Expect(controls.some(AST.isIfStatement)).toBe(true)
    const loop = controls.find(AST.isForStatement)
    Expect.Is(loop, AST.isForStatement)
    const loopText = loop.block.statements[0]
    Expect.Is(loopText, AST.isViewRender)
    const loopValue = AST.argumentsOf(loopText)[0]?.value
    Expect.Is(loopValue, AST.isValueReference)
    Expect(loopValue.target.ref).toBe(loop)
  })
})
