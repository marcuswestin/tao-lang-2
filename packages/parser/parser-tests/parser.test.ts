import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AST, Parser } from '../parser-src/parser'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const kitchenSinkPath = resolve(repoRoot, 'Apps/Kitchen Sink/Kitchen Sink.tao')

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
    expect(mainRender.argumentList?.arguments[0]?.value.value).toBe('Hello, World!')
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

  test('parses Tao source strings', async () => {
    const source = await readFile(kitchenSinkPath, 'utf8')
    const parsed = await Parser.parseCode(source)

    expect(parsed.diagnostics).toEqual([])
    expect(parsed.ast.statements).toHaveLength(3)
    expect(AST.isAppDeclaration(parsed.ast.statements[0])).toBe(true)
  })
})
