import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { AST, Parser } from '../parser-src/parser'
import { testParseCode } from './test-parse'

const kitchenSinkPath = FS.repoPath('Apps/Kitchen Sink/Kitchen Sink.tao')
const targetKitchenSinkPath = FS.repoPath('Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao')
const typeSystemTestsPath = FS.repoPath('Apps/Test Apps/Type System Tests/Type System Tests.tao')
const runtimeStdlibTestsPath = FS.repoPath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')

Describe('minimal Tao parser', () => {
  Test('parses the current Kitchen Sink app', async () => {
    const parsed = await Parser.parseFile(kitchenSinkPath)

    Expect(parsed.diagnostics).toEqual([])

    const [useStatement, app, greetingAlias, launchCountAlias, mainView, countTextView] = parsed.ast.statements
    Expect.Is(useStatement, AST.isUseStatement)
    Expect.Is(app, AST.isAppDeclaration)
    Expect.Is(greetingAlias, AST.isAliasDeclaration)
    Expect.Is(launchCountAlias, AST.isAliasDeclaration)
    Expect.Is(mainView, AST.isUiDeclaration)
    Expect.Is(countTextView, AST.isUiDeclaration)
    Expect(useStatement.importedDeclarations.map(reference => reference.$refText)).toEqual(['Text', 'Stack'])
    Expect(useStatement.modulePath).toBe('@tao/ui')

    Expect(app.name).toBe('KitchenSink')
    const appRoot = app.block.statements[0]
    Expect.Is(appRoot, AST.isAppUi)
    Expect(appRoot.ui.ref?.name).toBe('MainView')

    Expect(greetingAlias.name).toBe('Greeting')
    Expect.Is(greetingAlias.value, AST.isStringLiteral)
    Expect(launchCountAlias.name).toBe('LaunchCount')
    Expect.Is(launchCountAlias.value, AST.isNumberLiteral)

    Expect(mainView.name).toBe('MainView')
    const [localTextAlias, outerGreetingAlias, mainRender] = mainView.block.statements
    Expect.Is(localTextAlias, AST.isAliasDeclaration)
    Expect.Is(outerGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(mainRender, AST.isRenderStatement)
    Expect(mainRender.view?.ref?.name).toBe('Stack')
    Expect(localTextAlias.name).toBe('LocalText')
    Expect(outerGreetingAlias.name).toBe('OuterGreeting')
    Expect.Is(outerGreetingAlias.value, AST.isValueReference)
    Expect(outerGreetingAlias.value.target.ref?.name).toBe('Greeting')

    const [blockGreetingAlias] = mainRender.block?.statements ?? []
    Expect.Is(blockGreetingAlias, AST.isAliasDeclaration)
    Expect(blockGreetingAlias.name).toBe('Greeting')
    const childInvocations = mainRender.block?.statements.filter(AST.isViewRender) ?? []
    Expect(childInvocations).toHaveLength(5)
    const [outerText, shadowedText, nestedText, literalText, countText] = childInvocations
    Expect.Is(outerText, AST.isViewRender)
    Expect.Is(shadowedText, AST.isViewRender)
    Expect.Is(nestedText, AST.isViewRender)
    Expect.Is(literalText, AST.isViewRender)
    Expect.Is(countText, AST.isViewRender)
    Expect(outerText.view.ref?.name).toBe('Text')
    Expect(shadowedText.view.ref?.name).toBe('Text')
    Expect(nestedText.view.ref?.name).toBe('Text')
    Expect(literalText.view.ref?.name).toBe('Text')
    Expect(countText.view.ref?.name).toBe('CountText')

    const [greetingArg, shadowArg, nestedArg, literalArg, countArg] = [
      outerText.argumentList?.arguments[0]?.value,
      shadowedText.argumentList?.arguments[0]?.value,
      nestedText.argumentList?.arguments[0]?.value,
      literalText.argumentList?.arguments[0]?.value,
      countText.argumentList?.arguments[0]?.value,
    ]
    Expect.Is(greetingArg, AST.isValueReference)
    Expect.Is(shadowArg, AST.isValueReference)
    Expect.Is(nestedArg, AST.isValueReference)
    Expect.Is(literalArg, AST.isStringLiteral)
    Expect.Is(countArg, AST.isValueReference)
    Expect(greetingArg.target.ref?.name).toBe('OuterGreeting')
    Expect(shadowArg.target.ref?.name).toBe('LocalText')
    Expect(nestedArg.target.ref?.name).toBe('Greeting')
    Expect(literalArg.value).toBe('Hello World')
    Expect(countArg.target.ref?.name).toBe('LaunchCount')

    Expect(countTextView.name).toBe('CountText')
    Expect(countTextView.parameterList?.parameters[0]?.name).toBe('Count')
    Expect(countTextView.parameterList?.parameters[0]?.type).toBe('number')
    const countRender = countTextView.block.statements[0]
    Expect.Is(countRender, AST.isRenderStatement)
    Expect(countRender.injection?.tsCodeBlock).toContain('Launch count:')
    Expect(countRender.injection?.argumentList?.arguments).toHaveLength(1)
  })

  Test('parses inject render declarations', async () => {
    const parsed = await testParseCode('ui Native { render inject ```ts\nreturn null\n``` }')
    const view = parsed.ast.statements[0]

    Expect.Is(view, AST.isUiDeclaration)

    const render = view.block.statements[0]
    Expect.Is(render, AST.isRenderStatement)
    Expect(render.injection?.tsCodeBlock).toContain('return null')
  })

  Test('parses layout declarations and child view invocations', async () => {
    const parsed = await testParseCode(`
      app MyApp { ui MainView }
      ui MainView {
        render Stack {
          alias Local = "Inside"
          Text Local { }
          Text "Literal"
        }
      }
      layout Stack {
        render inject \`\`\`ts
          return <>{_ViewProps.children}</>
        \`\`\`
      }
      ui Text Value text {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)
    const layout = parsed.ast.statements.find(statement => AST.isLayoutDeclaration(statement))
    Expect.Is(layout, AST.isLayoutDeclaration)
    const mainView = parsed.ast.statements.find(statement =>
      AST.isUiDeclaration(statement) && statement.name === 'MainView'
    )
    Expect.Is(mainView, AST.isUiDeclaration)
    const render = mainView.block.statements[0]
    Expect.Is(render, AST.isRenderStatement)
    const [_localAlias, firstChild, secondChild] = render.block?.statements ?? []
    Expect.Is(firstChild, AST.isViewRender)
    Expect.Is(secondChild, AST.isViewRender)
    Expect(firstChild.view.ref?.name).toBe('Text')
    Expect(secondChild.view.ref?.name).toBe('Text')
  })

  Test('parses aliases, number literals, and value references', async () => {
    const parsed = await testParseCode(`
      alias Greeting = "Hello"
      alias LaunchCount = 3

      ui Text Value text { }
      ui StatTile Label text, Count number { }
      ui MainView Label text {
        alias LocalLabel = Label
        render Text LocalLabel { }
        render StatTile Greeting, LaunchCount { }
      }
    `)

    const [greetingAlias, launchCountAlias, _textView, _statTileView, mainView] = parsed.ast.statements

    Expect.Is(greetingAlias, AST.isAliasDeclaration)
    Expect.Is(launchCountAlias, AST.isAliasDeclaration)
    Expect.Is(mainView, AST.isUiDeclaration)

    Expect.Is(greetingAlias.value, AST.isStringLiteral)
    Expect.Is(launchCountAlias.value, AST.isNumberLiteral)
    Expect(launchCountAlias.value.value).toBe(3)
    Expect(mainView.parameterList?.parameters[0]?.type).toBe('text')

    const [localAlias, textRender, statRender] = mainView.block.statements
    Expect.Is(localAlias, AST.isAliasDeclaration)
    Expect.Is(textRender, AST.isRenderStatement)
    Expect.Is(statRender, AST.isRenderStatement)

    Expect.Is(localAlias.value, AST.isValueReference)
    Expect(localAlias.value.target.ref?.name).toBe('Label')

    const textArg = textRender.argumentList?.arguments[0]?.value
    Expect.Is(textArg, AST.isValueReference)
    Expect(textArg.target.ref?.name).toBe('LocalLabel')

    const statArgs = statRender.argumentList?.arguments.map(argument => argument.value)
    Expect(statArgs?.map(argument => AST.isValueReference(argument))).toEqual([true, true])
    const [labelArg, countArg] = statArgs ?? []
    Expect.Is(labelArg, AST.isValueReference)
    Expect.Is(countArg, AST.isValueReference)
    Expect(labelArg.target.ref?.name).toBe('Greeting')
    Expect(countArg.target.ref?.name).toBe('LaunchCount')
  })

  Test('resolves value references through nested scope shadowing', async () => {
    const parsed = await testParseCode(`
      alias Greeting = "File"

      layout Stack {
        render inject \`\`\`ts
          return <>{_ViewProps.children}</>
        \`\`\`
      }
      ui Text Value text {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
      ui MainView Label text {
        alias Greeting = "View"
        alias LabelAlias = Label
        render Stack {
          alias Greeting = "Block"
          Text Greeting
          Stack {
            alias Greeting = "Nested"
            Text Greeting
          }
          Text LabelAlias
        }
      }
    `)

    const [fileGreetingAlias, _stackView, _textView, mainView] = parsed.ast.statements
    Expect.Is(fileGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(mainView, AST.isUiDeclaration)

    const labelParameter = mainView.parameterList?.parameters[0]
    Expect.Is(labelParameter, AST.isParameterDeclaration)

    const [viewGreetingAlias, labelAlias, render] = mainView.block.statements
    Expect.Is(viewGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(labelAlias, AST.isAliasDeclaration)
    Expect.Is(render, AST.isRenderStatement)
    Expect.Is(labelAlias.value, AST.isValueReference)
    Expect(labelAlias.value.target.ref).toBe(labelParameter)

    const [blockGreetingAlias, blockText, nestedStack, labelText] = render.block?.statements ?? []
    Expect.Is(blockGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(blockText, AST.isViewRender)
    Expect.Is(nestedStack, AST.isViewRender)
    Expect.Is(labelText, AST.isViewRender)

    const blockTextValue = blockText.argumentList?.arguments[0]?.value
    Expect.Is(blockTextValue, AST.isValueReference)
    Expect(blockTextValue.target.ref).toBe(blockGreetingAlias)

    const [nestedGreetingAlias, nestedText] = nestedStack.block?.statements ?? []
    Expect.Is(nestedGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(nestedText, AST.isViewRender)

    const nestedTextValue = nestedText.argumentList?.arguments[0]?.value
    Expect.Is(nestedTextValue, AST.isValueReference)
    Expect(nestedTextValue.target.ref).toBe(nestedGreetingAlias)

    const labelTextValue = labelText.argumentList?.arguments[0]?.value
    Expect.Is(labelTextValue, AST.isValueReference)
    Expect(labelTextValue.target.ref).toBe(labelAlias)
    Expect(labelTextValue.target.ref).not.toBe(fileGreetingAlias)
  })

  Test('parses the target Kitchen Sink app', async () => {
    const parsed = await Parser.parseFile(targetKitchenSinkPath)

    Expect(parsed.diagnostics).toEqual([])
    Expect(parsed.ast.statements.filter(AST.isAliasDeclaration).map(alias => alias.name)).toEqual([
      'Greeting',
      'LaunchCount',
    ])
  })

  Test('parses the Type System Tests app', async () => {
    const parsed = await Parser.parseFile(typeSystemTestsPath)

    Expect(parsed.diagnostics).toEqual([])
    Expect(parsed.ast.statements.filter(AST.isAliasDeclaration)).toHaveLength(4)
  })

  Test('parses the Runtime Stdlib Tests app', async () => {
    const parsed = await Parser.parseFile(runtimeStdlibTestsPath)

    Expect(parsed.diagnostics).toEqual([])
    Expect(parsed.ast.statements.filter(AST.isUseStatement)).toHaveLength(1)
  })

  Test('parses Tao source strings', async () => {
    const source = `
      app InlineApp { ui MainView }
      ui MainView {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `
    const parsed = await testParseCode(source)

    Expect(parsed.ast.statements).toHaveLength(2)
    Expect.Is(parsed.ast.statements[0], AST.isAppDeclaration)
  })

  Test('parses use statements and shared declarations', async () => {
    const parsed = await testParseCode(`
      app MyApp { ui MainView }
      use Text, Stack from ./
      share alias Greeting = "Hello"
      share ui MainView {
        render Stack {
          Text Greeting
        }
      }
      share layout Stack {
        render inject \`\`\`ts
          return <>{_ViewProps.children}</>
        \`\`\`
      }
      share ui Text Value text {
        render inject Value \`\`\`ts
          return <RN.Text>{Value}</RN.Text>
        \`\`\`
      }
    `)

    Expect(parsed.diagnostics).toEqual([])
    const [, useStatement, sharedAlias, mainView] = parsed.ast.statements
    Expect.Is(useStatement, AST.isUseStatement)
    Expect(useStatement.importedDeclarations.map(reference => reference.$refText)).toEqual(['Text', 'Stack'])
    Expect(useStatement.modulePath).toBe('./')
    Expect.Is(sharedAlias, AST.isAliasDeclaration)
    Expect(sharedAlias.visibility).toBe('share')
    Expect.Is(mainView, AST.isUiDeclaration)
    Expect(mainView.visibility).toBe('share')
  })
})
