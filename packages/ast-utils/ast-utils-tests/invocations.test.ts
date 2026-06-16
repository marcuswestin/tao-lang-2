import ASTUtils from '@ast-utils'
import { AST, Parser, type ParseResult } from '@parser'
import { Describe, Expect, Test } from '@shared/test'

Describe('Tao AST invocation resolution', () => {
  Test('resolves positional render argument pairs', async () => {
    const parseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        render Tile "Open", 1
      }
      view Tile Title text, Count number { }
    `)
    const mainView = findMainView(parseResult)
    const render = mainView.block.statements[0]
    Expect.Is(render, AST.isRenderStatement)

    const invocation = ASTUtils.resolveRenderInvocation(render)

    Expect(invocation.view?.name).toBe('Tile')
    Expect(invocation.pairs.map(pair => pair.parameter.name)).toEqual(['Title', 'Count'])
  })

  Test('resolves only positional pairs with matching argument and parameter slots', async () => {
    const missingParseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        render Tile "Open"
      }
      view Tile Title text, Count number { }
    `)
    const missingRender = findMainView(missingParseResult).block.statements[0]
    Expect.Is(missingRender, AST.isRenderStatement)
    const missing = ASTUtils.resolveRenderInvocation(missingRender)

    const extraParseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        render Tile "Open", 1, "extra"
      }
      view Tile Title text, Count number { }
    `)
    const extraRender = findMainView(extraParseResult).block.statements[0]
    Expect.Is(extraRender, AST.isRenderStatement)
    const extra = ASTUtils.resolveRenderInvocation(extraRender)

    Expect(missing.pairs.map(pair => pair.parameter.name)).toEqual(['Title'])
    Expect(extra.pairs.map(pair => pair.parameter.name)).toEqual(['Title', 'Count'])

    const extraView = extra.view
    Expect.Is(extraView, AST.isRenderableDeclaration)
    const arity = ASTUtils.invocationArity(extra, extraView, extraRender)
    Expect(arity.parameters.map(parameter => parameter.name)).toEqual(['Title', 'Count'])
    Expect(arity.args).toHaveLength(3)
    Expect(arity.pairCount).toBe(2)
  })

  Test('resolves positional child view invocation argument pairs', async () => {
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
      view Tile Title text, Count number {
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

  Test('resolves positional action invocation argument pairs', async () => {
    const parseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        action AddStep Step number, Label text { }
        action AddOne {
          do AddStep 1, "one"
        }
      }
    `)
    const doStatement = findAction(parseResult, 'AddOne').block.statements[0]
    Expect.Is(doStatement, AST.isDoStatement)

    const invocation = ASTUtils.resolveActionInvocation(doStatement)

    Expect(invocation.action?.name).toBe('AddStep')
    Expect(invocation.pairs.map(pair => pair.parameter.name)).toEqual(['Step', 'Label'])
  })

  Test('resolves action invocations through alias chains to named declarations', async () => {
    const parseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        action AddStep Step number, Label text { }
        alias CallStep = AddStep
        alias Call = CallStep
        action AddOne {
          do Call 1, "one"
        }
      }
    `)
    const doStatement = findAction(parseResult, 'AddOne').block.statements[0]
    Expect.Is(doStatement, AST.isDoStatement)

    const invocation = ASTUtils.resolveActionInvocation(doStatement)

    Expect(invocation.action?.name).toBe('AddStep')
    Expect(invocation.pairs.map(pair => pair.parameter.name)).toEqual(['Step', 'Label'])
  })

  Test('classifies dynamic action targets through inline actions and action parameters', async () => {
    const parseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView Callback action {
        alias InlineCall = action { }
        alias CallbackAlias = Callback
        action Run {
          do action { }
          do InlineCall
          do CallbackAlias
        }
      }
    `)
    const statements = findAction(parseResult, 'Run').block.statements

    const kinds = statements.map(statement => {
      Expect.Is(statement, AST.isDoStatement)
      return ASTUtils.resolveActionTarget(statement.action).kind
    })

    Expect(kinds).toEqual(['dynamic', 'dynamic', 'dynamic'])
  })

  Test('resolves only direct action invocation argument pairs with matching slots', async () => {
    const missingParseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        action AddStep Step number, Label text { }
        action Missing {
          do AddStep 1
        }
      }
    `)
    const missingDo = findAction(missingParseResult, 'Missing').block.statements[0]
    Expect.Is(missingDo, AST.isDoStatement)
    const missing = ASTUtils.resolveActionInvocation(missingDo)

    const extraParseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        action AddStep Step number, Label text { }
        action Extra {
          do AddStep 1, "one", 2
        }
      }
    `)
    const extraDo = findAction(extraParseResult, 'Extra').block.statements[0]
    Expect.Is(extraDo, AST.isDoStatement)
    const extra = ASTUtils.resolveActionInvocation(extraDo)

    const inlineParseResult = await parseClean(`
      app MyApp { view MainView }
      view MainView {
        action Inline {
          do action { }
        }
      }
    `)
    const inlineDo = findAction(inlineParseResult, 'Inline').block.statements[0]
    Expect.Is(inlineDo, AST.isDoStatement)
    const inline = ASTUtils.resolveActionInvocation(inlineDo)

    Expect(missing.pairs.map(pair => pair.parameter.name)).toEqual(['Step'])
    Expect(extra.pairs.map(pair => pair.parameter.name)).toEqual(['Step', 'Label'])
    Expect(inline.action).toBeUndefined()
    Expect(inline.pairs).toEqual([])

    const extraAction = extra.action
    Expect.Is(extraAction, AST.isActionDeclaration)
    const arity = ASTUtils.invocationArity(extra, extraAction, extraDo)
    Expect(arity.parameters.map(parameter => parameter.name)).toEqual(['Step', 'Label'])
    Expect(arity.args).toHaveLength(3)
    Expect(arity.pairCount).toBe(2)
  })

  Test('treats recursive action alias invocations as unresolved', async () => {
    const parseResult = await parseClean(`
      app MyApp { view MainView }
      alias First = Second
      alias Second = First
      view MainView {
        action Run {
          do First
        }
      }
    `)
    const doStatement = findAction(parseResult, 'Run').block.statements[0]
    Expect.Is(doStatement, AST.isDoStatement)

    const invocation = ASTUtils.resolveActionInvocation(doStatement)

    Expect(invocation.action).toBeUndefined()
    Expect(invocation.pairs).toEqual([])
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

function findAction(parseResult: ParseResult, name: string): AST.ActionDeclaration {
  const action = findMainView(parseResult).block.statements.find(statement =>
    AST.isActionDeclaration(statement) && statement.name === name
  )
  Expect.Is(action, AST.isActionDeclaration)
  return action
}
