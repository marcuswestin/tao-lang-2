import Compiler from '@compiler'
import { AST } from '@parser'
import { Errors } from '@shared'
import { describe, expect, test } from 'bun:test'
import { testParseCode, testParseCodeWithParserErrors } from '../../parser/parser-tests/test-parse'
import { Compile } from '../compiler-src/codegen/app/runtime-gen'
import { testCompileCode } from './test-compile'
import { wrap } from './test-utils/AST-Wrapper'

const tsFence = '```ts'
const fence = '```'

describe('minimal Tao compiler', () => {
  test('reports parser syntax errors once', async () => {
    const source = 'view Legacy { }'
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
      ui Text Value text { }
    `)

    const taoFile = wrap(parsed.ast)
    Compile.TaoFile(taoFile.unwrap())
    const mainView = taoFile.statements.second.as_ViewDeclaration
    const render = mainView.block.statements.only.as_Render
    const literal = render.argumentList.arguments.only.value
    Compile.Expression(literal.unwrap())

    taoFile.statements.match([
      { $type: AST.AppDeclaration.$type, name: 'MyApp' },
      { $type: AST.ViewDeclaration.$type, name: 'MainView' },
      { $type: AST.ViewDeclaration.$type, name: 'Text' },
    ])
    render.view.expect('name').toBe('Text')
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
    `)).rejects.toThrow('Unsupported app block syntax')
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
    `)).rejects.toThrow('Only view renders are supported in multi-statement blocks')
  })
})
