import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { AST, Parser } from '../parser-src/parser'
import { testParseCode } from './test-parse'

const kitchenSinkPath = FS.repoPath('Apps/Kitchen Sink/Kitchen Sink.tao')
const targetKitchenSinkPath = FS.repoPath('Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao')
const typeSystemTestsPath = FS.repoPath('Apps/Test Apps/Type System Tests/Type System Tests.tao')

Describe('minimal Tao parser', () => {
  Test('parses the current Kitchen Sink app', async () => {
    const parsed = await Parser.parseFile(kitchenSinkPath)

    Expect(parsed.diagnostics).toEqual([])

    const [app, greetingAlias, launchCountAlias, mainView, stackView, textView, statTileView] = parsed.ast.statements
    Expect.Is(app, AST.isAppDeclaration)
    Expect.Is(greetingAlias, AST.isAliasDeclaration)
    Expect.Is(launchCountAlias, AST.isAliasDeclaration)
    Expect.Is(mainView, AST.isUiDeclaration)
    Expect.Is(stackView, AST.isUiDeclaration)
    Expect.Is(textView, AST.isUiDeclaration)
    Expect.Is(statTileView, AST.isUiDeclaration)

    Expect(app.name).toBe('KitchenSink')
    const appRoot = app.block.statements[0]
    Expect.Is(appRoot, AST.isAppUi)
    Expect(appRoot.ui.ref?.name).toBe('MainView')

    Expect(greetingAlias.name).toBe('Greeting')
    Expect.Is(greetingAlias.value, AST.isStringLiteral)
    Expect(launchCountAlias.name).toBe('LaunchCount')
    Expect.Is(launchCountAlias.value, AST.isNumberLiteral)

    Expect(mainView.name).toBe('MainView')
    const [mainRender] = mainView.block.statements
    Expect.Is(mainRender, AST.isRender)
    Expect(mainRender.view?.ref?.name).toBe('Stack')
    const [textChildRender, statChildRender] = mainRender.block?.statements ?? []
    Expect.Is(textChildRender, AST.isRender)
    Expect.Is(statChildRender, AST.isRender)
    Expect(textChildRender.view?.ref?.name).toBe('Text')
    const mainRenderArgument = textChildRender.argumentList?.arguments[0]?.value
    Expect.Is(mainRenderArgument, AST.isValueReference)
    Expect(mainRenderArgument.target.ref?.name).toBe('Greeting')
    Expect(statChildRender.view?.ref?.name).toBe('StatTile')
    Expect(statChildRender.argumentList?.arguments).toHaveLength(2)

    Expect(stackView.name).toBe('Stack')

    Expect(textView.name).toBe('Text')
    Expect(textView.parameterList?.parameters[0]?.name).toBe('Value')
    Expect(textView.parameterList?.parameters[0]?.type).toBe('text')

    Expect(statTileView.name).toBe('StatTile')
    Expect(statTileView.parameterList?.parameters.map(param => param.type)).toEqual(['text', 'number'])
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
    Expect.Is(textRender, AST.isRender)
    Expect.Is(statRender, AST.isRender)

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

  Test('parses Tao source strings', async () => {
    const source = await FS.readText(kitchenSinkPath)
    const parsed = await testParseCode(source)

    Expect(parsed.ast.statements).toHaveLength(7)
    Expect.Is(parsed.ast.statements[0], AST.isAppDeclaration)
  })
})
