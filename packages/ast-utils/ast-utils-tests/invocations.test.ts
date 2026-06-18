import ASTUtils from '@ast-utils'
import { AST, Parser, type ParseResult } from '@parser'
import { Describe, Expect, Test } from '@shared/test'

Describe('Tao AST invocation resolution', () => {
  Test('resolves render argument pairs by type', async () => {
    const parseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        render Tile "Open", 1
      }
      view Tile text as Title, number as Count { }
    `)
    const mainView = findMainView(parseResult)
    const render = mainView.block.statements[0]
    Expect.Is(render, AST.isRenderStatement)

    const invocation = ASTUtils.resolveRenderInvocation(render)

    Expect(invocation.view?.name).toBe('Tile')
    Expect(invocation.pairs.map(pair => pair.parameter.name)).toEqual(['Title', 'Count'])
  })

  Test('resolves out-of-order render arguments by type', async () => {
    const parseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        render Tile 1, "Open"
      }
      view Tile text as Title, number as Count { }
    `)
    const mainView = findMainView(parseResult)
    const render = mainView.block.statements[0]
    Expect.Is(render, AST.isRenderStatement)

    const invocation = ASTUtils.resolveRenderInvocation(render)

    Expect(invocation.view?.name).toBe('Tile')
    Expect(invocation.pairs.map(pair => pair.parameter.name)).toEqual(['Count', 'Title'])
  })

  Test('resolves only type-matched pairs and reports remaining arguments or parameters', async () => {
    const missingParseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        render Tile "Open"
      }
      view Tile text as Title, number as Count { }
    `)
    const missingRender = findMainView(missingParseResult).block.statements[0]
    Expect.Is(missingRender, AST.isRenderStatement)
    const missing = ASTUtils.resolveRenderInvocation(missingRender)

    const extraParseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        render Tile "Open", 1, "extra"
      }
      view Tile text as Title, number as Count { }
    `)
    const extraRender = findMainView(extraParseResult).block.statements[0]
    Expect.Is(extraRender, AST.isRenderStatement)
    const extra = ASTUtils.resolveRenderInvocation(extraRender)

    Expect(missing.pairs.map(pair => pair.parameter.name)).toEqual(['Title'])
    Expect(extra.pairs.map(pair => pair.parameter.name)).toEqual(['Count'])
    Expect(missing.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(['missing-argument'])
    Expect(extra.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([
      'duplicate-argument-type',
      'missing-argument',
    ])
  })

  Test('reports duplicate provided exact types before lineage binding', async () => {
    const parseResult = await parseClean(`
      app MyApp { view MainView }
      type Base is text
      type Middle is Base
      type Leaf is Middle
      view MainView {
        render Pair Leaf."Ada", Leaf."Grace"
      }
      view Pair Base, Middle { }
    `)
    const render = findMainView(parseResult).block.statements[0]
    Expect.Is(render, AST.isRenderStatement)

    const invocation = ASTUtils.resolveRenderInvocation(render)

    Expect(invocation.pairs).toEqual([])
    Expect(invocation.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([
      'duplicate-argument-type',
      'missing-argument',
      'missing-argument',
    ])
  })

  Test('reports competing lineage arguments for one parameter without source-order binding', async () => {
    const parseResult = await parseClean(`
      app MyApp { view MainView }
      type Base is text
      type Name is Base
      type Title is Base
      view MainView {
        render Pair Name."Ada", Title."Grace"
      }
      view Pair Base { }
    `)
    const render = findMainView(parseResult).block.statements[0]
    Expect.Is(render, AST.isRenderStatement)

    const invocation = ASTUtils.resolveRenderInvocation(render)

    Expect(invocation.pairs).toEqual([])
    Expect(invocation.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(['ambiguous-parameter'])
  })

  Test('resolves child view invocation argument pairs by type', async () => {
    const parseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        render Stack {
          Tile "Open", 1
        }
      }
      layout Stack {
        render inject \`\`\`ts
          return <>{_ViewProps.children}</>
        \`\`\`
      }
      view Tile text as Title, number as Count {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)
    const render = findMainView(parseResult).block.statements[0]
    Expect.Is(render, AST.isRenderStatement)
    const child = render.block?.statements[0]
    Expect.Is(child, AST.isViewRender)

    const invocation = ASTUtils.resolveRenderInvocation(child)

    Expect(invocation.view?.name).toBe('Tile')
    Expect(invocation.pairs.map(pair => pair.parameter.name)).toEqual(['Title', 'Count'])
  })

  Test('resolves item constructor properties by field type', async () => {
    const parseResult = await parseClean(`
      type Name is text
      type Age is number
      type Person is {
        Name
        Age
      }
      alias DemoPerson = Person.{ Age.40 Name."Ada" }
      view MainView { }
    `)
    const person = parseResult.entry.ast.statements.find(
      statement => AST.isTypeDeclaration(statement) && statement.name === 'Person',
    )
    const alias = parseResult.entry.ast.statements.find(
      statement => AST.isAliasDeclaration(statement) && statement.name === 'DemoPerson',
    )
    Expect.Is(person, AST.isTypeDeclaration)
    Expect.Is(person.type, AST.isItemTypeExpression)
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(alias.value, AST.isTypedConstructor)
    Expect.Is(alias.value.value, AST.isItemLiteral)

    const result = ASTUtils.resolveItemPropertyBindings(person.type.properties, alias.value.value.properties)

    Expect(result.pairs.map(pair => pair.expected.name)).toEqual(['Age', 'Name'])
    Expect(result.diagnostics).toEqual([])
  })

  Test('reports competing lineage item values for one field without source-order binding', async () => {
    const parseResult = await parseClean(`
      type Base is text
      type Name is Base
      type Title is Base
      type Pair is {
        Base
      }
      alias BadPair = Pair.{ Name."Ada" Title."Grace" }
      view MainView { }
    `)
    const pair = parseResult.entry.ast.statements.find(
      statement => AST.isTypeDeclaration(statement) && statement.name === 'Pair',
    )
    const alias = parseResult.entry.ast.statements.find(
      statement => AST.isAliasDeclaration(statement) && statement.name === 'BadPair',
    )
    Expect.Is(pair, AST.isTypeDeclaration)
    Expect.Is(pair.type, AST.isItemTypeExpression)
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(alias.value, AST.isTypedConstructor)
    Expect.Is(alias.value.value, AST.isItemLiteral)

    const result = ASTUtils.resolveItemPropertyBindings(pair.type.properties, alias.value.value.properties)

    Expect(result.pairs).toEqual([])
    Expect(result.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(['ambiguous-field'])
  })
})

async function parseClean(source: string): Promise<ParseResult> {
  const parseResult = await Parser.parseCode(source)
  Expect(parseResult.diagnostics).toEqual([])
  return parseResult
}

function findMainView(parseResult: ParseResult): AST.ViewDeclaration {
  const mainView = parseResult.entry.ast.statements.find(statement =>
    AST.isViewDeclaration(statement) && statement.name === 'MainView'
  )
  Expect.Is(mainView, AST.isViewDeclaration)
  return mainView
}
