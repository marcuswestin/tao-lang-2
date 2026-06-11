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
const targetKitchenSinkPath = FS.repoPath('Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao')
const typeSystemTestsPath = FS.repoPath('Apps/Test Apps/Type System Tests/Type System Tests.tao')
const runtimeStdlibTestsPath = FS.repoPath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')

Describe('minimal Tao compiler', () => {
  Test('reports parser syntax errors once', async () => {
    const source = 'ui Broken { render }'
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
    Expect(render.unwrap().view?.ref?.name).toBe('Text')
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

  Test('rejects inject in multi-statement view blocks explicitly', async () => {
    await Expect(testCompileCode(`
      app MyApp { ui MainView }
      ui MainView {
        render inject ${tsFence}
          return <RN.Text>Hello</RN.Text>
        ${fence}
        render MainView
      }
    `)).rejects.toThrow('`render inject` must be the only statement in a view body')
  })

  Test('compiles the target Kitchen Sink app', async () => {
    await Compiler.compileFile(targetKitchenSinkPath)
  })

  Test('compiles the Type System Tests app', async () => {
    await testCompileCode(await FS.readText(typeSystemTestsPath))
  })

  Test('compiles the Runtime Stdlib Tests app', async () => {
    await Compiler.compileFile(runtimeStdlibTestsPath)
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

  Test('compiles multi-file Tao apps with use imports', async () => {
    const appDir = await FS.mkTmpDir(FS.resolvePath('tao-compiler-use-', { cwd: FS.tmpdir() }))
    const mainPath = FS.resolvePath('Main.tao', { cwd: appDir })
    const viewsPath = FS.resolvePath('Views.tao', { cwd: appDir })
    try {
      await FS.writeText(
        mainPath,
        `
        app MultiFile { ui MainView }
        use Text from ./
        ui MainView {
          render Text "Hello from imports"
        }
      `,
      )
      await FS.writeText(
        viewsPath,
        `
        ui Text Value text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      )

      const compiled = await Compiler.compileFile(mainPath)
      const entryOutput = compiled.files.find(file => file.sourcePath === mainPath)
      const viewsOutput = compiled.files.find(file => file.sourcePath === viewsPath)

      Expect(compiled.files.length).toBeGreaterThan(1)
      Expect(entryOutput?.relativePath).toBe('App.tsx')
      Expect(viewsOutput).toBeDefined()
      Expect(compiled.files.every(file => !file.relativePath.includes('..'))).toBe(true)
    } finally {
      await FS.remove(appDir)
    }
  })

  Test('compiles circular use imports between sibling module files', async () => {
    const appDir = await FS.mkTmpDir(FS.resolvePath('tao-compiler-cycle-', { cwd: FS.tmpdir() }))
    const mainPath = FS.resolvePath('Main.tao', { cwd: appDir })
    try {
      await FS.writeText(
        mainPath,
        `
        app CircularApp { ui MainView }
        use AView from ./
        ui MainView {
          render AView
        }
      `,
      )
      await FS.writeText(
        FS.resolvePath('A.tao', { cwd: appDir }),
        `
        use BView from ./
        alias SharedTitle = "Cycle"
        ui AView {
          render BView
        }
      `,
      )
      await FS.writeText(
        FS.resolvePath('B.tao', { cwd: appDir }),
        `
        use SharedTitle from ./
        ui BView {
          render Leaf SharedTitle
        }
        ui Leaf Value text {
          render inject Value ${tsFence}
            return null
          ${fence}
        }
      `,
      )

      const compiled = await Compiler.compileFile(mainPath)

      Expect(compiled.files).toHaveLength(3)
    } finally {
      await FS.remove(appDir)
    }
  })

  Test('keeps generated module output paths unique for same-named external files', async () => {
    const rootDir = await FS.mkTmpDir(FS.resolvePath('tao-compiler-collision-', { cwd: FS.tmpdir() }))
    const appDir = FS.resolvePath('app', { cwd: rootDir })
    const libADir = FS.resolvePath('liba', { cwd: rootDir })
    const libBDir = FS.resolvePath('libb', { cwd: rootDir })
    const mainPath = FS.resolvePath('Main.tao', { cwd: appDir })
    try {
      await FS.mkdir(appDir)
      await FS.mkdir(libADir)
      await FS.mkdir(libBDir)
      await FS.writeText(
        mainPath,
        `
        app CollisionApp { ui MainView }
        use AText from ../liba
        use BText from ../libb
        ui MainView {
          render AText "Hello"
        }
      `,
      )
      const sharedViewSource = (name: string) => `
        share ui ${name} Value text {
          render inject Value ${tsFence}
            return null
          ${fence}
        }
      `
      await FS.writeText(FS.resolvePath('Views.tao', { cwd: libADir }), sharedViewSource('AText'))
      await FS.writeText(FS.resolvePath('Views.tao', { cwd: libBDir }), sharedViewSource('BText'))

      const compiled = await Compiler.compileFile(mainPath)
      const relativePaths = compiled.files.map(file => file.relativePath)

      Expect(compiled.files).toHaveLength(3)
      Expect(new Set(relativePaths).size).toBe(relativePaths.length)
    } finally {
      await FS.remove(rootDir)
    }
  })

  Test('rejects entry files without an app declaration', async () => {
    await Expect(testCompileCode(`
      ui MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)).rejects.toThrow('entry file must declare exactly one app')
  })
})
