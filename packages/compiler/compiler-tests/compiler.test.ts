import Compiler from '@compiler'
import { AST } from '@parser'
import { Errors, FS, Text } from '@shared'
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

async function withTaoFiles(
  prefix: string,
  files: Record<string, string>,
  testsFunction: (paths: Record<string, string>, rootDir: string) => Promise<void>,
): Promise<void> {
  const rootDir = await FS.mkTmpDir(FS.resolvePath(prefix, { cwd: FS.tmpdir() }))
  const paths: Record<string, string> = {}

  try {
    for (const [relativePath, source] of Object.entries(files)) {
      const path = FS.resolvePath(relativePath, { cwd: rootDir })
      await FS.writeText(path, Text.stripIndent(source))
      paths[relativePath] = path
    }

    await testsFunction(paths, rootDir)
  } finally {
    await FS.remove(rootDir)
  }
}

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

  Test('compiles source strings that import the Tao stdlib', async () => {
    await testCompileCode(`
      use Text from @tao/ui
      app MyApp { ui MainView }
      ui MainView {
        render Text "Hello"
      }
    `)
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
    await withTaoFiles(
      'tao-compiler-use-',
      {
        'Main.tao': `
        app MultiFile { ui MainView }
        use Text from ./
        ui MainView {
          render Text "Hello from imports"
        }
      `,
        'Views.tao': `
        ui Text Value text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      },
      async paths => {
        const mainPath = paths['Main.tao']!
        const viewsPath = paths['Views.tao']!

        const compiled = await Compiler.compileFile(mainPath)
        const entryOutput = compiled.files.find(file => file.sourcePath === mainPath)
        const viewsOutput = compiled.files.find(file => file.sourcePath === viewsPath)

        Expect(compiled.files.length).toBeGreaterThan(1)
        Expect(entryOutput?.relativePath).toBe('App.tsx')
        Expect(viewsOutput).toBeDefined()
        Expect(compiled.files.every(file => !file.relativePath.includes('..'))).toBe(true)
      },
    )
  })

  Test('compiles explicit Tao file imports', async () => {
    await withTaoFiles(
      'tao-compiler-use-',
      {
        'Main.tao': `
        app MultiFile { ui MainView }
        use Text from ./Views.tao
        ui MainView {
          render Text "Hello from file import"
        }
      `,
        'Views.tao': `
        ui Text Value text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      },
      async paths => {
        const mainPath = paths['Main.tao']!
        const viewsPath = paths['Views.tao']!

        const compiled = await Compiler.compileFile(mainPath)

        Expect(compiled.files.map(file => file.sourcePath).sort()).toEqual([mainPath, viewsPath].sort())
      },
    )
  })

  Test('compiles circular use imports between sibling module files', async () => {
    await withTaoFiles(
      'tao-compiler-cycle-',
      {
        'Main.tao': `
        app CircularApp { ui MainView }
        use AView from ./
        ui MainView {
          render AView
        }
      `,
        'A.tao': `
        use BView from ./
        alias SharedTitle = "Cycle"
        ui AView {
          render BView
        }
      `,
        'B.tao': `
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
      },
      async paths => {
        const mainPath = paths['Main.tao']!

        const compiled = await Compiler.compileFile(mainPath)

        Expect(compiled.files).toHaveLength(3)
      },
    )
  })

  Test('keeps generated module output paths unique for same-named external files', async () => {
    const sharedViewSource = (name: string) => `
      share ui ${name} Value text {
        render inject Value ${tsFence}
          return null
        ${fence}
      }
    `
    await withTaoFiles(
      'tao-compiler-collision-',
      {
        'app/Main.tao': `
        app CollisionApp { ui MainView }
        use AText from ../liba
        use BText from ../libb
        ui MainView {
          render AText "Hello"
        }
      `,
        'liba/Views.tao': sharedViewSource('AText'),
        'libb/Views.tao': sharedViewSource('BText'),
      },
      async paths => {
        const mainPath = paths['app/Main.tao']!

        const compiled = await Compiler.compileFile(mainPath)
        const relativePaths = compiled.files.map(file => file.relativePath)

        Expect(compiled.files).toHaveLength(3)
        Expect(new Set(relativePaths).size).toBe(relativePaths.length)
      },
    )
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
