import { FS } from '@shared'
import { describe, expect, test } from 'bun:test'
import { AST, Parser } from '../parser-src/parser'
import { testParseCode } from './test-parse'

const kitchenSinkPath = await FS.resolveRepoPath('Apps/Kitchen Sink/Kitchen Sink.tao')
const targetKitchenSinkPath = await FS.resolveRepoPath('Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao')
const typeSystemTestsPath = await FS.resolveRepoPath('Apps/Test Apps/Type System Tests/Type System Tests.tao')

function expectIs<T>(value: unknown, guard: (value: unknown) => value is T): asserts value is T {
  expect(guard(value)).toBe(true)
}

describe('minimal Tao parser', () => {
  test('parses the current Kitchen Sink app', async () => {
    const parsed = await Parser.parseFile(kitchenSinkPath)

    expect(parsed.diagnostics).toEqual([])

    const [app, greetingAlias, launchCountAlias, mainView, stackView, textView, countTextView] = parsed.ast.statements
    expectIs(app, AST.isAppDeclaration)
    expectIs(greetingAlias, AST.isAliasDeclaration)
    expectIs(launchCountAlias, AST.isAliasDeclaration)
    expectIs(mainView, AST.isUiDeclaration)
    expectIs(stackView, AST.isLayoutDeclaration)
    expectIs(textView, AST.isUiDeclaration)
    expectIs(countTextView, AST.isUiDeclaration)

    expect(app.name).toBe('KitchenSink')
    const appRoot = app.block.statements[0]
    expectIs(appRoot, AST.isAppUi)
    expect(appRoot.ui.ref?.name).toBe('MainView')

    expect(greetingAlias.name).toBe('Greeting')
    expectIs(greetingAlias.value, AST.isStringLiteral)
    expect(launchCountAlias.name).toBe('LaunchCount')
    expectIs(launchCountAlias.value, AST.isNumberLiteral)

    expect(mainView.name).toBe('MainView')
    const [localTextAlias, outerGreetingAlias, mainRender] = mainView.block.statements
    expectIs(localTextAlias, AST.isAliasDeclaration)
    expectIs(outerGreetingAlias, AST.isAliasDeclaration)
    expectIs(mainRender, AST.isRenderStatement)
    expect(mainRender.view?.ref?.name).toBe('Stack')
    expect(localTextAlias.name).toBe('LocalText')
    expect(outerGreetingAlias.name).toBe('OuterGreeting')
    expectIs(outerGreetingAlias.value, AST.isValueReference)
    expect(outerGreetingAlias.value.target.ref?.name).toBe('Greeting')

    const [blockGreetingAlias] = mainRender.block?.statements ?? []
    expectIs(blockGreetingAlias, AST.isAliasDeclaration)
    expect(blockGreetingAlias.name).toBe('Greeting')
    const childInvocations = mainRender.block?.statements.filter(AST.isViewRender) ?? []
    expect(childInvocations).toHaveLength(5)
    const [outerText, shadowedText, nestedText, literalText, countText] = childInvocations
    expectIs(outerText, AST.isViewRender)
    expectIs(shadowedText, AST.isViewRender)
    expectIs(nestedText, AST.isViewRender)
    expectIs(literalText, AST.isViewRender)
    expectIs(countText, AST.isViewRender)
    expect(outerText.view.ref?.name).toBe('Text')
    expect(shadowedText.view.ref?.name).toBe('Text')
    expect(nestedText.view.ref?.name).toBe('Text')
    expect(literalText.view.ref?.name).toBe('Text')
    expect(countText.view.ref?.name).toBe('CountText')
    const [greetingArg, shadowArg, nestedArg, literalArg, countArg] = [
      outerText.argumentList?.arguments[0]?.value,
      shadowedText.argumentList?.arguments[0]?.value,
      nestedText.argumentList?.arguments[0]?.value,
      literalText.argumentList?.arguments[0]?.value,
      countText.argumentList?.arguments[0]?.value,
    ]
    expectIs(greetingArg, AST.isValueReference)
    expectIs(shadowArg, AST.isValueReference)
    expectIs(nestedArg, AST.isValueReference)
    expectIs(literalArg, AST.isStringLiteral)
    expectIs(countArg, AST.isValueReference)
    expect(greetingArg.target.ref?.name).toBe('OuterGreeting')
    expect(shadowArg.target.ref?.name).toBe('LocalText')
    expect(nestedArg.target.ref?.name).toBe('Greeting')
    expect(literalArg.value).toBe('Hello World')
    expect(countArg.target.ref?.name).toBe('LaunchCount')

    expect(stackView.name).toBe('Stack')
    expect(stackView.parameterList).toBeUndefined()

    const stackRender = stackView.block.statements[0]
    expectIs(stackRender, AST.isRenderStatement)
    expect(stackRender.injection?.tsCodeBlock).toContain('_ViewProps.children')

    expect(textView.name).toBe('Text')
    expect(textView.parameterList?.parameters[0]?.name).toBe('Value')
    expect(textView.parameterList?.parameters[0]?.type).toBe('text')

    const textRender = textView.block.statements[0]
    expectIs(textRender, AST.isRenderStatement)
    expect(textRender.injection?.tsCodeBlock).toContain('_ViewProps.Value.evaluate')

    expect(countTextView.name).toBe('CountText')
    expect(countTextView.parameterList?.parameters[0]?.name).toBe('Count')
    expect(countTextView.parameterList?.parameters[0]?.type).toBe('number')
  })

  test('parses inject render declarations', async () => {
    const parsed = await testParseCode('ui Native { render inject ```ts\nreturn null\n``` }')
    const view = parsed.ast.statements[0]

    expectIs(view, AST.isUiDeclaration)

    const render = view.block.statements[0]
    expectIs(render, AST.isRenderStatement)
    expect(render.injection?.tsCodeBlock).toContain('return null')
  })

  test('parses layout declarations and child view invocations', async () => {
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
    expectIs(layout, AST.isLayoutDeclaration)
    const mainView = parsed.ast.statements.find(statement =>
      AST.isUiDeclaration(statement) && statement.name === 'MainView'
    )
    expectIs(mainView, AST.isUiDeclaration)
    const render = mainView.block.statements[0]
    expectIs(render, AST.isRenderStatement)
    const [_localAlias, firstChild, secondChild] = render.block?.statements ?? []
    expectIs(firstChild, AST.isViewRender)
    expectIs(secondChild, AST.isViewRender)
    expect(firstChild.view.ref?.name).toBe('Text')
    expect(secondChild.view.ref?.name).toBe('Text')
  })

  test('parses aliases, number literals, and value references', async () => {
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

    expectIs(greetingAlias, AST.isAliasDeclaration)
    expectIs(launchCountAlias, AST.isAliasDeclaration)
    expectIs(mainView, AST.isUiDeclaration)

    expectIs(greetingAlias.value, AST.isStringLiteral)
    expectIs(launchCountAlias.value, AST.isNumberLiteral)
    expect(launchCountAlias.value.value).toBe(3)
    expect(mainView.parameterList?.parameters[0]?.type).toBe('text')

    const [localAlias, textRender, statRender] = mainView.block.statements
    expectIs(localAlias, AST.isAliasDeclaration)
    expectIs(textRender, AST.isRenderStatement)
    expectIs(statRender, AST.isRenderStatement)

    expectIs(localAlias.value, AST.isValueReference)
    expect(localAlias.value.target.ref?.name).toBe('Label')

    const textArg = textRender.argumentList?.arguments[0]?.value
    expectIs(textArg, AST.isValueReference)
    expect(textArg.target.ref?.name).toBe('LocalLabel')

    const statArgs = statRender.argumentList?.arguments.map(argument => argument.value)
    expect(statArgs?.map(argument => AST.isValueReference(argument))).toEqual([true, true])
    const [labelArg, countArg] = statArgs ?? []
    expectIs(labelArg, AST.isValueReference)
    expectIs(countArg, AST.isValueReference)
    expect(labelArg.target.ref?.name).toBe('Greeting')
    expect(countArg.target.ref?.name).toBe('LaunchCount')
  })

  test('resolves value references through nested scope shadowing', async () => {
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
    expectIs(fileGreetingAlias, AST.isAliasDeclaration)
    expectIs(mainView, AST.isUiDeclaration)

    const labelParameter = mainView.parameterList?.parameters[0]
    expectIs(labelParameter, AST.isParameterDeclaration)

    const [viewGreetingAlias, labelAlias, render] = mainView.block.statements
    expectIs(viewGreetingAlias, AST.isAliasDeclaration)
    expectIs(labelAlias, AST.isAliasDeclaration)
    expectIs(render, AST.isRenderStatement)
    expectIs(labelAlias.value, AST.isValueReference)
    expect(labelAlias.value.target.ref).toBe(labelParameter)

    const [blockGreetingAlias, blockText, nestedStack, labelText] = render.block?.statements ?? []
    expectIs(blockGreetingAlias, AST.isAliasDeclaration)
    expectIs(blockText, AST.isViewRender)
    expectIs(nestedStack, AST.isViewRender)
    expectIs(labelText, AST.isViewRender)

    const blockTextValue = blockText.argumentList?.arguments[0]?.value
    expectIs(blockTextValue, AST.isValueReference)
    expect(blockTextValue.target.ref).toBe(blockGreetingAlias)

    const [nestedGreetingAlias, nestedText] = nestedStack.block?.statements ?? []
    expectIs(nestedGreetingAlias, AST.isAliasDeclaration)
    expectIs(nestedText, AST.isViewRender)

    const nestedTextValue = nestedText.argumentList?.arguments[0]?.value
    expectIs(nestedTextValue, AST.isValueReference)
    expect(nestedTextValue.target.ref).toBe(nestedGreetingAlias)

    const labelTextValue = labelText.argumentList?.arguments[0]?.value
    expectIs(labelTextValue, AST.isValueReference)
    expect(labelTextValue.target.ref).toBe(labelAlias)
    expect(labelTextValue.target.ref).not.toBe(fileGreetingAlias)
  })

  test('parses the target Kitchen Sink app', async () => {
    const parsed = await Parser.parseFile(targetKitchenSinkPath)

    expect(parsed.diagnostics).toEqual([])
    expect(parsed.ast.statements.filter(AST.isAliasDeclaration).map(alias => alias.name)).toEqual([
      'Greeting',
      'LaunchCount',
    ])
  })

  test('parses the Type System Tests app', async () => {
    const parsed = await Parser.parseFile(typeSystemTestsPath)

    expect(parsed.diagnostics).toEqual([])
    expect(parsed.ast.statements.filter(AST.isAliasDeclaration)).toHaveLength(4)
  })

  test('parses Tao source strings', async () => {
    const source = await FS.readText(kitchenSinkPath)
    const parsed = await testParseCode(source)

    expect(parsed.ast.statements).toHaveLength(7)
    expectIs(parsed.ast.statements[0], AST.isAppDeclaration)
  })
})
