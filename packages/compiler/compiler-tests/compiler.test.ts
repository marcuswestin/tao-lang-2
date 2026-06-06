import Compiler from '@compiler'
import { AST } from '@parser'
import { Errors, FS } from '@shared'
import { describe, expect, test } from 'bun:test'
import { testParseCode, testParseCodeWithParserErrors } from '../../parser/parser-tests/test-parse'
import { Compile } from '../compiler-src/codegen/Compile'
import { testCompileCode } from './test-compile'
import { wrap } from './test-utils/AST-Wrapper'

const tsFence = '```ts'
const fence = '```'
const targetKitchenSinkPath = FS.repoPath('Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao')
const typeSystemTestsPath = FS.repoPath('Apps/Test Apps/Type System Tests/Type System Tests.tao')

describe('minimal Tao compiler', () => {
  test('reports parser syntax errors once', async () => {
    const source = 'ui Broken { render }'
    const parsed = await testParseCodeWithParserErrors(source)
    const parserMessage = parsed.document.parseResult.parserErrors[0]!.message
    let errorDetails: unknown[] = []

    try {
      await Compiler.compileCode(source)
    } catch (error) {
      expect(error).toBeInstanceOf(Errors.UnexpectedBehaviorError)
      errorDetails = (error as Errors.UnexpectedBehaviorError).details!['errors'] as unknown[]
    }

    expect(errorDetails).toContain(parserMessage)
    expect(errorDetails.filter(error => error === parserMessage)).toHaveLength(1)
  })

  test('exposes a single Compile object for parsed AST nodes', async () => {
    const parsed = await testParseCode(`
      app MyApp { ui MainView }
      ui MainView {
        render Text "Hello"
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
    `)

    const taoFile = wrap(parsed.ast)
    Compile.TaoFile(taoFile.unwrap())
    const mainView = taoFile.statements.second.as_UiDeclaration
    const render = mainView.block.statements.only.as_RenderStatement
    const literal = render.argumentList.arguments.only.value.as_StringLiteral
    Compile.Expression(literal.unwrap())
    const layout = taoFile.statements[3]!.as_LayoutDeclaration
    Compile.LayoutDeclaration(layout.unwrap())

    taoFile.statements.match([
      { $type: AST.AppDeclaration.$type, name: 'MyApp' },
      { $type: AST.UiDeclaration.$type, name: 'MainView' },
      { $type: AST.UiDeclaration.$type, name: 'Text' },
      { $type: AST.LayoutDeclaration.$type, name: 'Stack' },
    ])
    expect(render.unwrap().view?.ref?.name).toBe('Text')
    literal.expect('value').toBe('Hello')
  })

  test('rejects duplicate app root ui declarations', async () => {
    await expect(testCompileCode(`
      app MyApp {
        ui MainView
        ui OtherView
      }
      ui MainView { }
      ui OtherView { }
    `)).rejects.toThrow('must declare exactly one root ui')
  })

  test('rejects app blocks without a root ui statement', async () => {
    await expect(testCompileCode(`
      app MyApp { }
      ui MainView { }
    `)).rejects.toThrow('must declare exactly one root ui')
  })

  test('rejects unsupported app block statements', async () => {
    await expect(testCompileCode(`
      app MyApp {
        ui MainView
        render MainView
      }
      ui MainView { }
    `)).rejects.toThrow('Only root ui declarations are allowed')
  })

  test('rejects inject in multi-statement view blocks explicitly', async () => {
    await expect(testCompileCode(`
      app MyApp { ui MainView }
      ui MainView {
        render inject ${tsFence}
          return <RN.Text>Hello</RN.Text>
        ${fence}
        render MainView
      }
    `)).rejects.toThrow('`render inject` must be the only statement in a view body')
  })

  test('compiles the target Kitchen Sink app', async () => {
    await testCompileCode(await FS.readText(targetKitchenSinkPath))
  })

  test('compiles the Type System Tests app', async () => {
    await testCompileCode(await FS.readText(typeSystemTestsPath))
  })

  test('rejects validator type errors before codegen', async () => {
    await expect(testCompileCode(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open", "not a count"
      }
      ui Tile Title text, Count number {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)).rejects.toThrow("Argument for parameter 'Count' expects number, got text.")
  })
})
