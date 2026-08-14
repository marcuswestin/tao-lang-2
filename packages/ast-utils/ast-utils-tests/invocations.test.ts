import { ASTUtils, Type } from '@ast-utils'
import { AST, Parser, type ParseResult } from '@parser'
import { Describe, Expect, Test } from '@shared/test'

Describe('Tao AST invocation resolution', () => {
  Test('resolves render argument pairs by type', async () => {
    const parseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        render Tile("Open", 1)
      }
      view Tile Title is text, Count is number { }
    `)
    const mainView = findMainView(parseResult)
    const render = AST.blockStatementOf(mainView, 0)
    Expect.Is(render, AST.isRenderStatement)

    const invocation = ASTUtils.resolveRenderInvocation(render)

    Expect(invocation.view?.name).toBe('Tile')
    Expect(invocation.pairs.map(pair => Type.parameterName(pair.parameter))).toEqual(['Title', 'Count'])
  })

  Test('resolves out-of-order render arguments by type', async () => {
    const parseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        render Tile(1, "Open")
      }
      view Tile Title is text, Count is number { }
    `)
    const mainView = findMainView(parseResult)
    const render = AST.blockStatementOf(mainView, 0)
    Expect.Is(render, AST.isRenderStatement)

    const invocation = ASTUtils.resolveRenderInvocation(render)

    Expect(invocation.view?.name).toBe('Tile')
    Expect(invocation.pairs.map(pair => Type.parameterName(pair.parameter))).toEqual(['Title', 'Count'])
  })

  Test('resolves out-of-order action arguments by type', async () => {
    const parseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        action Save Count is number, Label is text { }
        action CallSave {
          do Save("Open", 1)
        }
        render Text("Done")
      }
      view Text Value is text { }
    `)
    const mainView = findMainView(parseResult)
    const callSave = AST.blockStatementOf(mainView, {
      find: statement => AST.isActionDeclaration(statement) && statement.name === 'CallSave',
    })
    Expect.Is(callSave, AST.isActionDeclaration)
    const invocation = AST.blockStatementOf(callSave, 0)
    Expect.Is(invocation, AST.isDoStatement)

    const resolved = ASTUtils.resolveActionInvocation(invocation)

    Expect(resolved.action?.name).toBe('Save')
    Expect(resolved.pairs.map(pair => Type.parameterName(pair.parameter))).toEqual(['Count', 'Label'])
    Expect(resolved.diagnostics).toEqual([])
  })

  Test('reports action binding diagnostics by type', async () => {
    const parseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        action AddStep Step is number { }
        action CallAddStep {
          do AddStep("wrong")
        }
        render Text("Done")
      }
      view Text Value is text { }
    `)
    const mainView = findMainView(parseResult)
    const callAddStep = AST.blockStatementOf(mainView, {
      find: statement => AST.isActionDeclaration(statement) && statement.name === 'CallAddStep',
    })
    Expect.Is(callAddStep, AST.isActionDeclaration)
    const invocation = AST.blockStatementOf(callAddStep, 0)
    Expect.Is(invocation, AST.isDoStatement)

    const resolved = ASTUtils.resolveActionInvocation(invocation)

    Expect(resolved.pairs).toEqual([])
    Expect(resolved.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([
      'unmatched-argument',
      'missing-argument',
    ])
  })

  Test('resolves action invocations through aliases', async () => {
    const parseResult = await parseClean(`
      app MyApp { view MainView }
      action Save { }
      let SaveAlias = Save
      view MainView {
        action CallSave {
          do SaveAlias()
        }
        render Text("Done")
      }
      view Text Value is text { }
    `)
    const mainView = findMainView(parseResult)
    const callSave = AST.blockStatementOf(mainView, {
      find: statement => AST.isActionDeclaration(statement) && statement.name === 'CallSave',
    })
    Expect.Is(callSave, AST.isActionDeclaration)
    const invocation = AST.blockStatementOf(callSave, 0)
    Expect.Is(invocation, AST.isDoStatement)

    const target = ASTUtils.resolveActionTarget(invocation.action)

    Expect(target.kind).toBe('named')
    if (target.kind === 'named') {
      Expect(target.action.name).toBe('Save')
    }
  })

  Test('resolves only type-matched pairs and reports remaining arguments or parameters', async () => {
    const missingParseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        render Tile("Open")
      }
      view Tile Title is text, Count is number { }
    `)
    const missingRender = AST.blockStatementOf(findMainView(missingParseResult), 0)
    Expect.Is(missingRender, AST.isRenderStatement)
    const missing = ASTUtils.resolveRenderInvocation(missingRender)

    const extraParseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        render Tile("Open", 1, "extra")
      }
      view Tile Title is text, Count is number { }
    `)
    const extraRender = AST.blockStatementOf(findMainView(extraParseResult), 0)
    Expect.Is(extraRender, AST.isRenderStatement)
    const extra = ASTUtils.resolveRenderInvocation(extraRender)

    Expect(missing.pairs.map(pair => Type.parameterName(pair.parameter))).toEqual(['Title'])
    Expect(extra.pairs.map(pair => Type.parameterName(pair.parameter))).toEqual(['Count'])
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
        render Pair(Leaf "Ada", Leaf "Grace")
      }
      view Pair Base, Middle { }
    `)
    const render = AST.blockStatementOf(findMainView(parseResult), 0)
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
        render Pair(Name "Ada", Title "Grace")
      }
      view Pair Base { }
    `)
    const render = AST.blockStatementOf(findMainView(parseResult), 0)
    Expect.Is(render, AST.isRenderStatement)

    const invocation = ASTUtils.resolveRenderInvocation(render)

    Expect(invocation.pairs).toEqual([])
    Expect(invocation.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(['ambiguous-parameter'])
  })

  Test('resolves child view invocation argument pairs by type', async () => {
    const parseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        render Stack(){
          Tile("Open", 1)
        }
      }
      layout Stack {
        render inject \`\`\`ts
          return <>{_ViewProps.children}</>
        \`\`\`
      }
      view Tile Title is text, Count is number {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)
    const render = AST.blockStatementOf(findMainView(parseResult), 0)
    Expect.Is(render, AST.isRenderStatement)
    const child = AST.blockStatementOf(render, 0)
    Expect.Is(child, AST.isViewRender)

    const invocation = ASTUtils.resolveRenderInvocation(child)

    Expect(invocation.view?.name).toBe('Tile')
    Expect(invocation.pairs.map(pair => Type.parameterName(pair.parameter))).toEqual(['Title', 'Count'])
  })

  Test('resolves item constructor properties by field type', async () => {
    const parseResult = await parseClean(`
      type Name is text
      type Age is number
      type Person is {
        Name
        Age
      }
      let DemoPerson = Person { Age: 40, Name: "Ada" }
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

    Expect(result.pairs.map(pair => pair.expected.name)).toEqual(['Name', 'Age'])
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
      let BadPair = Pair { Name "Ada", Title "Grace" }
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
