import { FS, Repo } from '@shared'
import { describe, expect, test } from 'bun:test'
import { AST, Parser } from '../parser-src/parser'
import { testParseCode } from './test-parse'

const repoRoot = await Repo.getRoot()
const kitchenSinkPath = FS.resolvePath(repoRoot, 'Apps/Kitchen Sink/Kitchen Sink.tao')
const targetKitchenSinkPath = FS.resolvePath(repoRoot, 'Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao')
const typeSystemTestsPath = FS.resolvePath(repoRoot, 'Apps/Test Apps/Type System Tests/Type System Tests.tao')

describe('minimal Tao parser', () => {
  test('parses the current Kitchen Sink app', async () => {
    const parsed = await Parser.parseFile(kitchenSinkPath)

    expect(parsed.diagnostics).toEqual([])

    const [app, mainView, textView] = parsed.ast.statements
    expect(AST.isAppDeclaration(app)).toBe(true)
    expect(AST.isViewDeclaration(mainView)).toBe(true)
    expect(AST.isViewDeclaration(textView)).toBe(true)

    if (!AST.isAppDeclaration(app) || !AST.isViewDeclaration(mainView) || !AST.isViewDeclaration(textView)) {
      throw new Error('Unexpected Kitchen Sink AST shape.')
    }

    expect(app.name).toBe('KitchenSink')
    const appRoot = app.block.statements[0]
    expect(AST.isAppUi(appRoot)).toBe(true)
    if (!AST.isAppUi(appRoot)) {
      throw new Error('KitchenSink should declare a root ui.')
    }
    expect(appRoot.ui.ref?.name).toBe('MainView')

    expect(mainView.name).toBe('MainView')
    const mainRender = mainView.block.statements[0]
    expect(AST.isRender(mainRender)).toBe(true)
    if (!AST.isRender(mainRender)) {
      throw new Error('MainView should render Text.')
    }
    expect(mainRender.view?.ref?.name).toBe('Text')
    const mainRenderArgument = mainRender.argumentList?.arguments[0]?.value
    expect(AST.isStringLiteral(mainRenderArgument)).toBe(true)
    if (!AST.isStringLiteral(mainRenderArgument)) {
      throw new Error('MainView should pass a string literal to Text.')
    }
    expect(mainRenderArgument.value).toBe('Hello, World!')
    expect(mainRender.block?.statements).toEqual([])

    expect(textView.name).toBe('Text')
    expect(textView.parameterList?.parameters[0]?.name).toBe('Value')
    expect(textView.parameterList?.parameters[0]?.type).toBe('text')

    const textRender = textView.block.statements[0]
    expect(AST.isRender(textRender)).toBe(true)
    if (!AST.isRender(textRender)) {
      throw new Error('Text should render an injection.')
    }
    expect(textRender.injection?.tsCodeBlock).toContain('_ViewProps.Value.evaluate')
  })

  test('parses raw inject declarations', async () => {
    const parsed = await testParseCode('ui Native { render inject raw ```ts\nreturn null\n``` }')
    const view = parsed.ast.statements[0]

    expect(AST.isViewDeclaration(view)).toBe(true)
    if (!AST.isViewDeclaration(view)) {
      throw new Error('Expected a view declaration.')
    }

    const render = view.block.statements[0]
    expect(AST.isRender(render)).toBe(true)
    if (!AST.isRender(render)) {
      throw new Error('Expected render inject.')
    }
    expect(render.injection?.type).toBe('raw')
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

    expect(AST.isAliasDeclaration(greetingAlias)).toBe(true)
    expect(AST.isAliasDeclaration(launchCountAlias)).toBe(true)
    expect(AST.isViewDeclaration(mainView)).toBe(true)
    if (
      !AST.isAliasDeclaration(greetingAlias)
      || !AST.isAliasDeclaration(launchCountAlias)
      || !AST.isViewDeclaration(mainView)
    ) {
      throw new Error('Unexpected parser AST shape for aliases and value references.')
    }

    expect(AST.isStringLiteral(greetingAlias.value)).toBe(true)
    expect(AST.isNumberLiteral(launchCountAlias.value)).toBe(true)
    if (!AST.isNumberLiteral(launchCountAlias.value)) {
      throw new Error('LaunchCount should be a number literal.')
    }
    expect(launchCountAlias.value.value).toBe(3)
    expect(mainView.parameterList?.parameters[0]?.type).toBe('text')

    const [localAlias, textRender, statRender] = mainView.block.statements
    expect(AST.isAliasDeclaration(localAlias)).toBe(true)
    expect(AST.isRender(textRender)).toBe(true)
    expect(AST.isRender(statRender)).toBe(true)
    if (!AST.isAliasDeclaration(localAlias) || !AST.isRender(textRender) || !AST.isRender(statRender)) {
      throw new Error('Unexpected MainView statement shape.')
    }

    expect(AST.isValueReference(localAlias.value)).toBe(true)
    if (!AST.isValueReference(localAlias.value)) {
      throw new Error('LocalLabel should reference the Label parameter.')
    }
    expect(localAlias.value.target.ref?.name).toBe('Label')

    const textArg = textRender.argumentList?.arguments[0]?.value
    expect(AST.isValueReference(textArg)).toBe(true)
    if (!AST.isValueReference(textArg)) {
      throw new Error('Text render should receive a value reference.')
    }
    expect(textArg.target.ref?.name).toBe('LocalLabel')

    const statArgs = statRender.argumentList?.arguments.map(argument => argument.value)
    expect(statArgs?.map(argument => AST.isValueReference(argument))).toEqual([true, true])
    const [labelArg, countArg] = statArgs ?? []
    if (!AST.isValueReference(labelArg) || !AST.isValueReference(countArg)) {
      throw new Error('StatTile render should receive value references.')
    }
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

    expect(parsed.ast.statements).toHaveLength(3)
    expect(AST.isAppDeclaration(parsed.ast.statements[0])).toBe(true)
  })
})
