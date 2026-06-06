import Compiler from '@compiler'
import { AST } from '@parser'
import { Errors, FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode, testParseCodeWithParserErrors } from '../../parser/parser-tests/test-parse'
import { Compile } from '../compiler-src/codegen/Compile'
import { testCompileCode } from './test-compile'
import { wrap } from './test-utils/AST-Wrapper'

const tsFence = '```ts'
const fence = '```'
const targetKitchenSinkPath = await FS.resolveRepoPath('Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao')
const typeSystemTestsPath = await FS.resolveRepoPath('Apps/Test Apps/Type System Tests/Type System Tests.tao')

Describe('minimal Tao compiler', () => {
  Test('reports parser syntax errors once', async () => {
    const source = 'view Legacy { }'
    const parsed = await testParseCodeWithParserErrors(source)
    const parserMessage = parsed.document.parseResult.parserErrors[0]!.message
    let errorDetails: unknown[] = []

    try {
      await Compiler.compileCode(source)
    } catch (error) {
      Expect(error).toBeInstanceOf(Errors.UnexpectedBehaviorError)
      errorDetails = (error as Errors.UnexpectedBehaviorError).details!['errors'] as unknown[]
    }

    Expect(errorDetails).toContain(parserMessage)
    Expect(errorDetails.filter(error => error === parserMessage)).toHaveLength(1)
  })

  Test('exposes a single Compile object for parsed AST nodes', async () => {
    const parsed = await testParseCode(`
      app MyApp { ui MainView }
      ui MainView {
        render Text "Hello"
      }
      ui Text Value text { }
    `)

    const taoFile = wrap(parsed.ast)
    Compile.TaoFile(taoFile.unwrap())
    const mainView = taoFile.statements.second.as_UiDeclaration
    const render = mainView.block.statements.only.as_Render
    const literal = render.argumentList.arguments.only.value.as_StringLiteral
    Compile.Expression(literal.unwrap())

    taoFile.statements.match([
      { $type: AST.AppDeclaration.$type, name: 'MyApp' },
      { $type: AST.UiDeclaration.$type, name: 'MainView' },
      { $type: AST.UiDeclaration.$type, name: 'Text' },
    ])
    render.view.expect('name').toBe('Text')
    literal.expect('value').toBe('Hello')
  })

  Test('rejects duplicate app root ui declarations', async () => {
    await Expect(testCompileCode(`
      app MyApp {
        ui MainView
        ui OtherView
      }
      ui MainView { }
      ui OtherView { }
    `)).rejects.toThrow('must declare exactly one root ui')
  })

  Test('rejects app blocks without a root ui statement', async () => {
    await Expect(testCompileCode(`
      app MyApp { }
      ui MainView { }
    `)).rejects.toThrow('must declare exactly one root ui')
  })

  Test('rejects unsupported app block statements', async () => {
    await Expect(testCompileCode(`
      app MyApp {
        ui MainView
        render MainView
      }
      ui MainView { }
    `)).rejects.toThrow('Only root ui declarations are allowed')
  })

  Test('compiles the target Kitchen Sink app', async () => {
    await testCompileCode(await FS.readText(targetKitchenSinkPath))
  })

  Test('compiles the Type System Tests app', async () => {
    await testCompileCode(await FS.readText(typeSystemTestsPath))
  })

  Test('rejects validator type errors before codegen', async () => {
    await Expect(testCompileCode(`
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
