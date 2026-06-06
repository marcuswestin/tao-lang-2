import { FS } from '@shared'
import { describe, expect, test } from 'bun:test'
import { AST, Parser } from '../parser-src/parser'
import { testParseCode } from './test-parse'

const kitchenSinkPath = FS.repoPath('Apps/Kitchen Sink/Kitchen Sink.tao')
const targetKitchenSinkPath = FS.repoPath('Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao')
const typeSystemTestsPath = FS.repoPath('Apps/Test Apps/Type System Tests/Type System Tests.tao')

function expectIs<T>(value: unknown, guard: (value: unknown) => value is T): asserts value is T {
  expect(guard(value)).toBe(true)
}

describe('minimal Tao parser', () => {
  test('parses the current Kitchen Sink app', async () => {
    const parsed = await Parser.parseFile(kitchenSinkPath)

    expect(parsed.diagnostics).toEqual([])

    const [app, greetingAlias, launchCountAlias, mainView, stackView, textView, statTileView] = parsed.ast.statements
    expectIs(app, AST.isAppDeclaration)
    expectIs(greetingAlias, AST.isAliasDeclaration)
    expectIs(launchCountAlias, AST.isAliasDeclaration)
    expectIs(mainView, AST.isUiDeclaration)
    expectIs(stackView, AST.isUiDeclaration)
    expectIs(textView, AST.isUiDeclaration)
    expectIs(statTileView, AST.isUiDeclaration)

    expect(app.name).toBe('KitchenSink')
    const appRoot = app.block.statements[0]
    expectIs(appRoot, AST.isAppUi)
    expect(appRoot.ui.ref?.name).toBe('MainView')

    expect(greetingAlias.name).toBe('Greeting')
    expectIs(greetingAlias.value, AST.isStringLiteral)
    expect(launchCountAlias.name).toBe('LaunchCount')
    expectIs(launchCountAlias.value, AST.isNumberLiteral)

    expect(mainView.name).toBe('MainView')
    const [mainRender] = mainView.block.statements
    expectIs(mainRender, AST.isRender)
    expect(mainRender.view?.ref?.name).toBe('Stack')
    const [textChildRender, statChildRender] = mainRender.block?.statements ?? []
    expectIs(textChildRender, AST.isRender)
    expectIs(statChildRender, AST.isRender)
    expect(textChildRender.view?.ref?.name).toBe('Text')
    const mainRenderArgument = textChildRender.argumentList?.arguments[0]?.value
    expectIs(mainRenderArgument, AST.isValueReference)
    expect(mainRenderArgument.target.ref?.name).toBe('Greeting')
    expect(statChildRender.view?.ref?.name).toBe('StatTile')
    expect(statChildRender.argumentList?.arguments).toHaveLength(2)

    expect(stackView.name).toBe('Stack')
    const stackRender = stackView.block.statements[0]
    expectIs(stackRender, AST.isRender)
    expect(stackRender.injection?.tsCodeBlock).toContain('_ViewProps.children')

    expect(textView.name).toBe('Text')
    expect(textView.parameterList?.parameters[0]?.name).toBe('Value')
    expect(textView.parameterList?.parameters[0]?.type).toBe('text')

    const textRender = textView.block.statements[0]
    expectIs(textRender, AST.isRender)
    expect(textRender.injection?.tsCodeBlock).toContain('_ViewProps.Value.evaluate')

    expect(statTileView.name).toBe('StatTile')
    expect(statTileView.parameterList?.parameters.map(param => param.type)).toEqual(['text', 'number'])
  })

  test('parses inject render declarations', async () => {
    const parsed = await testParseCode('ui Native { render inject ```ts\nreturn null\n``` }')
    const view = parsed.ast.statements[0]

    expectIs(view, AST.isUiDeclaration)

    const render = view.block.statements[0]
    expectIs(render, AST.isRender)
    expect(render.injection?.tsCodeBlock).toContain('return null')
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
    expectIs(textRender, AST.isRender)
    expectIs(statRender, AST.isRender)

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
