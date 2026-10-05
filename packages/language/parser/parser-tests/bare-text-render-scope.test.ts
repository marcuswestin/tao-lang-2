import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: bare text render scope', () => {
  Test('uses ordinary lexical aliases, states, and parameters before outer views', async () => {
    const result = await testParseCode(`
      view Label() { render inject \`\`\`ts\nreturn null\n\`\`\` }
      view Main(Label text) {
        let Local = "local"
        state Live = "live"
        render Label
        render Local
        render Live
      }
    `)
    const main = result.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Main'
    )
    Expect.Is(main, AST.isViewDeclaration)
    Expect.Is(main.parameterList, AST.isParameterList)
    const renders = AST.streamAllContents(main).filter(AST.isRender)
    Expect(renders).toHaveLength(3)
    Expect.Is(renders[0], AST.isRender)
    Expect(renders[0].view.ref).toBe(main.parameterList.parameters[0])
    Expect.Is(renders[1], AST.isRender)
    Expect(renders[1].view.ref).toBe(main.block?.statements.find(AST.isAliasDeclaration))
    Expect.Is(renders[2], AST.isRender)
    Expect(renders[2].view.ref).toBe(main.block?.statements.find(AST.isStateDeclaration))
  })
})
