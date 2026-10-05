import { Type } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: bare text render scope', () => {
  Test('renders a query loop entity without importing its singular name and shadows an outer view', async () => {
    await withTaoFiles('tao-query-loop-render-scope-', {
      'Main.tao': `
        use Books from ./Data
        use Col from @tao/ui
        view Book() { render "outer" }
        view Main() {
          query Feed = Books with { }
          render Col {
            loop Feed / Book { Book }
          }
          render Book
        }
      `,
      'Data.tao': 'public data Books / Book { Title text }',
    }, async paths => {
      const result = await Workspace.parse(paths['Main.tao']!)
      Expect(result.diagnostics).toEqual([])
      const main = result.entry.ast.statements.find(statement =>
        AST.isViewDeclaration(statement) && statement.name === 'Main'
      )
      Expect.Is(main, AST.isViewDeclaration)
      const loop = AST.streamAllContents(main).find(AST.isForStatement)
      Expect.Is(loop, AST.isForStatement)
      const row = AST.streamAllContents(loop).find(AST.isRender)
      Expect.Is(row, AST.isRender)
      Assert.defined(row.view, 'the loop row render has a linked view reference')
      Assert.defined(row.view.ref, 'the loop row view reference resolves')
      Expect(row.view.ref).toBe(loop)
      const data = result.files.find(file => file.path.endsWith('/Data.tao'))?.ast.statements.find(
        AST.isEntityDataDeclaration,
      )
      Expect.Is(data, AST.isEntityDataDeclaration)
      const rowType = Type.ofValueDeclaration(loop, row)
      Expect(rowType.kind).toBe('entity')
      if (rowType.kind === 'entity') {
        Expect(rowType.entity).toBe(data)
      }
      const outer = result.entry.ast.statements.find(statement =>
        AST.isViewDeclaration(statement) && statement.name === 'Book'
      )
      Expect.Is(outer, AST.isViewDeclaration)
      const outside = main.block?.statements.filter(AST.isRender).at(-1)
      Expect.Is(outside, AST.isRender)
      Assert.defined(outside.view, 'the outside render has a linked view reference')
      Assert.defined(outside.view.ref, 'the outside view reference resolves')
      Expect(outside.view.ref).toBe(outer)
    })
  })

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
    const [parameterRender, aliasRender, stateRender] = renders
    Expect.Is(parameterRender, AST.isRender)
    Assert.defined(parameterRender.view, 'the parameter render has a linked view reference')
    Assert.defined(parameterRender.view.ref, 'the parameter view reference resolves')
    Assert.defined(main.parameterList.parameters[0], 'the view parameter exists')
    Expect(parameterRender.view.ref).toBe(main.parameterList.parameters[0])
    Expect.Is(aliasRender, AST.isRender)
    Assert.defined(aliasRender.view, 'the alias render has a linked view reference')
    Assert.defined(aliasRender.view.ref, 'the alias view reference resolves')
    const alias = main.block?.statements.find(AST.isAliasDeclaration)
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect(aliasRender.view.ref).toBe(alias)
    Expect.Is(stateRender, AST.isRender)
    Assert.defined(stateRender.view, 'the state render has a linked view reference')
    Assert.defined(stateRender.view.ref, 'the state view reference resolves')
    const state = main.block?.statements.find(AST.isStateDeclaration)
    Expect.Is(state, AST.isStateDeclaration)
    Expect(stateRender.view.ref).toBe(state)
  })
})
