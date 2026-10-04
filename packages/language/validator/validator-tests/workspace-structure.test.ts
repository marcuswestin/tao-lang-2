import { Packages } from '@ast-utils'
import { LSPWorkspace } from '@compiler/workspace'
import { AST, codeProjectRoot, Langium, Parser } from '@parser'
import { Diagnostics, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { Validation } from '../validator-src/validation'
import { AliasesValidator } from '../validator-src/validators/aliases-validator'
import { packageValidationMessages } from '../validator-src/validators/package-validator'
import { preludeValidationMessages } from '../validator-src/validators/prelude-validator'
import { testValidationMessages } from '../validator-src/validators/tests-validator'
import { useValidationMessages, validateVisibleDeclarations } from '../validator-src/validators/use-validator'
import {
  accepts,
  acceptsFiles,
  acceptsFilesFrom,
  app,
  checksFiles,
  rejects,
  rejectsFiles,
  rejectsFilesFrom,
  stubView,
  testValidateCodeWithErrors,
  validationErrorMessages,
  visibleView,
  withValidationParse,
} from './test-validate'

function stubApp(extra = ''): string {
  return app('render Fixture()', `${stubView('Fixture')}\n${extra}`)
}

function testSuite(body: string, includeApp = true): string {
  const test = `test "Smoke" { ${body} }`
  return includeApp ? stubApp(test) : test
}

function testCheck(name: string, body: string, includeApp = true): string {
  return testSuite(`test "${name}" { ${body} }`, includeApp)
}

Describe('validator: workspace structure', () => {
  for (
    const reservedNameCase of [
      {
        title: 'rejects prototype-mutating file aliases',
        source: stubApp('let __proto__ = "unsafe"'),
      },
      {
        title: 'rejects prototype-mutating parameters',
        source: `
        app ScopeApp { view MainView }
        view MainView(__proto__ text) { render Fixture() }
        ${stubView('Fixture')}
      `,
      },
    ]
  ) {
    Test(
      reservedNameCase.title,
      rejects(reservedNameCase.source, AliasesValidator.messages.reservedName('__proto__')),
    )
  }

  Test('auto-loads the parsed Tao prelude and exposes its primitive slot contracts', async () => {
    await withValidationParse(stubApp(), ({ result }) => {
      const prelude = result.files.find(file => file.path.endsWith('/@tao/Prelude.tao'))
      const primitives = prelude?.ast.statements.filter(AST.isPrimitiveDeclaration) ?? []
      Expect(primitives.map(declaration => declaration.name)).toEqual([
        'item',
        'number',
        'text',
        'boolean',
        'list',
        'time',
        'duration',
        'color',
        'action',
        'shortcut',
        'command',
        'design',
        'view',
        'scene',
        'nav',
        'datasource',
        'app',
      ])
      const appPrimitive = primitives.find(declaration => declaration.name === 'app')
      Expect(appPrimitive?.slots?.properties.map(property => property.name)).toEqual([
        'id',
        'version',
        'name',
        'Navigator',
        'AgentCommands',
        'Datasource',
        'Auth',
        'Design',
      ])
    })
  })

  Test(
    'rejects primitive declarations outside the pinned prelude',
    rejects('primitive text', preludeValidationMessages.location),
  )

  Test(
    'allows primitive declarations in the IDE extension generated prelude',
    acceptsFilesFrom('_gen_ide-extension/@tao/Prelude.tao', {
      '_gen_ide-extension/@tao/Prelude.tao': 'primitive item',
    }),
  )

  Test(
    'allows primitive declarations in the checkout prelude',
    acceptsFilesFrom('packages/apps/stdlib/@tao/Prelude.tao', {
      'packages/apps/stdlib/@tao/Prelude.tao': 'primitive item',
    }),
  )

  Test('pins the language server to a checkout prelude', async () => {
    const root = await mkTestDir('tao-prelude-pin-')
    try {
      const prelude = FS.resolvePath('packages/apps/stdlib/@tao/Prelude.tao', root)
      const app = FS.resolvePath('App.tao', root)
      await FS.writeText(prelude, 'primitive item\n')
      await FS.writeText(app, 'primitive text\n')
      const workspace = await LSPWorkspace.open(root)
      const preludeMessages = (await workspace.validate(prelude)).diagnostics
        .filter(diagnostic => diagnostic.filePath === prelude)
        .map(diagnostic => diagnostic.message)
      const appMessages = (await workspace.validate(app)).diagnostics
        .filter(diagnostic => diagnostic.filePath === app)
        .map(diagnostic => diagnostic.message)

      Expect(preludeMessages).not.toContain(preludeValidationMessages.location)
      Expect(preludeMessages).toContain(preludeValidationMessages.missing('number'))
      Expect(appMessages).toContain(preludeValidationMessages.location)
    } finally {
      await FS.remove(root)
    }
  })

  Test(
    'rejects primitive declarations in other generated Tao files',
    rejectsFilesFrom('_gen_ide-extension/App.tao', {
      '_gen_ide-extension/App.tao': 'primitive item',
    }, preludeValidationMessages.location),
  )

  // REMOVAL CANDIDATE: user primitives are forbidden; this retains termination for adversarial inheritance.
  Test(
    'reports cyclic user primitive inheritance without aborting validation',
    rejects('primitive view is nav', preludeValidationMessages.location),
  )

  Test('does not report duplicate visible declarations for repeated LSP document instances', async () => {
    const parserContext = Parser.createContext()
    const uri = Langium.URI.file(`${codeProjectRoot}/Views.tao`)
    const documentOne = parserContext.services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(
      'public view Box() { }',
      uri,
    )
    const documentTwo = parserContext.services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(
      'public view Box() { }',
      uri,
    )
    const diagnostics = Validation.collectDiagnostics()
    const packagesContext = await Packages.createContext(codeProjectRoot)
    const ctx = Validation.createContext(diagnostics.accept, {
      entryFilePath: uri.path,
      packagesContext,
      workspaceFiles: [
        documentOne.parseResult.value!,
        documentTwo.parseResult.value!,
      ],
    })

    validateVisibleDeclarations(ctx, documentOne.parseResult.value!)

    Expect(diagnostics.diagnostics).toEqual([])
  })

  Test('returns parser diagnostics without running structural checks on syntax errors', async () => {
    const result = await testValidateCodeWithErrors('view Broken() { render }')

    Expect(Diagnostics.hasSource(result.diagnostics, 'parser')).toBe(true)
    Expect(Diagnostics.hasSource(result.diagnostics, 'validator')).toBe(false)
  })

  for (
    const checkCase of [
      {
        title: 'rejects duplicate run statements in one check',
        source: testCheck('duplicate run', 'run MyApp\nrun MyApp'),
        message: testValidationMessages.duplicateRun('duplicate run'),
      },
      {
        title: 'rejects expectations before run',
        source: testCheck('ordered run', 'expect text "Hello"\nrun MyApp'),
        message: testValidationMessages.expectationBeforeRun,
      },
      {
        title: 'rejects presses before run',
        source: testCheck('ordered press', 'press text "Add"\nrun MyApp'),
        message: testValidationMessages.expectationBeforeRun,
      },
    ]
  ) {
    Test(checkCase.title, rejects(checkCase.source, checkCase.message))
  }

  Test('reports missing run without a cascading order diagnostic', async () => {
    const result = await testValidateCodeWithErrors(
      testCheck('missing run', 'expect text "Hello"', false),
    )
    const messages = validationErrorMessages(result)

    Expect(messages).toContain(testValidationMessages.missingRun('missing run'))
    Expect(messages).not.toContain(testValidationMessages.expectationBeforeRun)
  })

  Test('reports a non-app run target without a cascading run-target diagnostic', async () => {
    const result = await testValidateCodeWithErrors(`
      ${stubView('MainView')}
      ${testCheck('non app', 'run MainView', false)}
    `)
    const messages = validationErrorMessages(result)

    Expect(messages).toContain("No app or alias named 'MainView' is in scope.")
    Expect(messages).not.toContain(testValidationMessages.runTarget('MainView'))
  })

  Test(
    'rejects back before run',
    rejects(testCheck('order', 'back\nrun MyApp'), testValidationMessages.expectationBeforeRun),
  )

  Test(
    'rejects relaunch before run',
    rejects(testCheck('relaunch order', 'relaunch\nrun MyApp'), testValidationMessages.expectationBeforeRun),
  )

  Test(
    'accepts relaunch after run',
    accepts(testCheck('relaunch', 'run MyApp\nrelaunch\nexpect text "Hello"')),
  )

  Test(
    'rejects relaunch inside a selected row, whose scope a relaunch replaces',
    rejects(
      testCheck('relaunch in select', 'run MyApp\nselect #rows[1] { relaunch }'),
      testValidationMessages.relaunchInSelect,
    ),
  )

  for (
    const placementCase of [
      {
        title: 'rejects expectations at top level',
        source: 'expect text "Hello"',
        messages: [testValidationMessages.expectationPlacement],
      },
      {
        title: 'rejects presses at top level',
        source: 'press text "Add"',
        messages: [testValidationMessages.pressPlacement],
      },
      {
        title: 'rejects relaunch at top level',
        source: 'relaunch',
        messages: [testValidationMessages.relaunchPlacement],
      },
      {
        title: 'rejects aliases in check blocks',
        source: testCheck('renders', 'let Message = "Hello"\nrun MyApp'),
        messages: [testValidationMessages.checkBlock('renders')],
      },
      {
        title: 'rejects mixing nested tests with steps in one block',
        source: 'test "Outer" { test "Inner" { run MyApp } back }',
        messages: [testValidationMessages.testBlock('Outer')],
      },
    ]
  ) {
    Test(placementCase.title, rejects(placementCase.source, ...placementCase.messages))
  }

  Test(
    'accepts visible app declarations outside the entry file',
    acceptsFiles(
      {
        'Main.tao': `
          use OtherApp, OtherView from ./Other.tao
          ${app('render OtherView()')}
        `,
        'Other.tao': `
          folder app OtherApp { id "other" version "1.0.0" name "Other" view OtherView }
          ${visibleView('OtherView')}
        `,
      },
    ),
  )

  Test(
    'keeps an explicitly file-visible app private to its declaration file',
    rejectsFiles(
      {
        'Main.tao': `
          use PrivateApp, OtherView from ./Other.tao
          ${app('render OtherView()')}
        `,
        'Other.tao': `
          file app PrivateApp { view OtherView }
          ${visibleView('OtherView')}
        `,
      },
      useValidationMessages.notVisible('PrivateApp'),
    ),
  )

  Test(
    'accepts public app declarations inside packages',
    acceptsFiles(
      {
        'Main.tao': `
          use PackageApp, MainView from @bar
          app MyApp { id "my" version "1.0.0" name "My app" view MainView }
        `,
        'packages/@bar/Main.tao': `
          public app PackageApp { id "package" version "1.0.0" name "Package" view MainView }
          ${visibleView('MainView')}
        `,
      },
    ),
  )

  Test(
    'rejects imports that match multiple visible declarations in one target',
    rejectsFiles(
      {
        'Main.tao': `
          use Text from ./views
          ${app('render Text("Hello")')}
        `,
        'views/Views.tao': visibleView('Text', 'Value text'),
        'views/MoreViews.tao': visibleView('Text', 'Value text'),
      },
      useValidationMessages.ambiguousImport('Text', './views'),
    ),
  )

  Test(
    'allows file-level aliases that reference imported aliases',
    checksFiles(
      {
        'Main.tao': `
          app MyApp { id "my" version "1.0.0" name "My app" view MainView }
          use Greeting from ./
          let Local = Greeting
          ${stubView('Text', 'Value text')}
          view MainView() { render Text(Local) }
        `,
        'Views.tao': `
          // Padding comments keep this declaration at a larger source offset than the
          // importing file's references, which used to trip the declaration-order check.
          // More padding.
          // More padding.
          project let Greeting = "Hello"
        `,
      },
      result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    ),
  )

  for (
    const packagePathCase of [
      {
        title: 'rejects package file basenames as import paths',
        importPath: '@foo/FileOnly',
        sourcePath: 'features/@foo/FileOnly.tao',
      },
      {
        title: 'rejects explicit Tao package file paths',
        importPath: '@foo/ExplicitFile.tao',
        sourcePath: 'features/@foo/ExplicitFile.tao',
      },
    ]
  ) {
    Test(
      packagePathCase.title,
      rejectsFiles(
        {
          'Main.tao': `
            use Chosen from ${packagePathCase.importPath}
            ${stubApp()}
          `,
          [packagePathCase.sourcePath]: 'project let Chosen = "File target"',
        },
        useValidationMessages.unresolvedImport(packagePathCase.importPath),
      ),
    )
  }

  Test(
    'rejects duplicate package names in the package index',
    checksFiles(
      {
        'Main.tao': `
          use MainView from @bar
          app DuplicatePackageApp { view MainView }
        `,
        'one/@bar/Main.tao': visibleView('MainView'),
        'two/@bar/Main.tao': visibleView('OtherView'),
      },
      result => {
        Expect(validationErrorMessages(result).some(message => message.includes("Package '@bar' is ambiguous"))).toBe(
          true,
        )
      },
    ),
  )

  Test(
    'rejects relative imports that cross package boundaries',
    rejectsFiles(
      {
        'Main.tao': `
          use MainView from ./features/@bar
          app BoundaryApp { view MainView }
        `,
        'features/@bar/Main.tao': visibleView('MainView'),
      },
      useValidationMessages.packageBoundary('./features/@bar'),
    ),
  )

  Test(
    'rejects package subpaths that enter nested projects with project dependency guidance',
    rejectsFilesFrom(
      'Outer/Main.tao',
      {
        'Outer/.tao/.gitkeep': '',
        'Outer/Main.tao': `
          package { version 1.0.0 includes @outer }
          use Hidden from @outer/Child
        `,
        'Outer/@outer/Main.tao': 'project let Visible = "Outer"',
        'Outer/@outer/Child/.tao/.gitkeep': '',
        'Outer/@outer/Child/Hidden.tao': 'public let Hidden = "Nested"',
      },
      useValidationMessages.projectBoundary('@outer/Child'),
    ),
  )

  Test(
    'rejects relative imports that leave a project with project dependency guidance',
    rejectsFilesFrom(
      'App/Main.tao',
      {
        'App/.tao/.gitkeep': '',
        'Sibling/.tao/.gitkeep': '',
        'App/Main.tao': `
          package { version 1.0.0 includes @app }
          use Hidden from ../Sibling
        `,
        'Sibling/Hidden.tao': 'public let Hidden = "Sibling"',
      },
      useValidationMessages.projectBoundary('../Sibling'),
    ),
  )

  Test(
    'rejects package imports that traverse outside their named package',
    rejectsFiles(
      {
        'Main.tao': 'use Hidden from @data/../../Outside',
        '@data/Data.tao': 'project let Visible = "Local"',
      },
      useValidationMessages.packagePathEscape('@data/../../Outside', '@data'),
    ),
  )

  Test(
    'does not include nested package folders in bare package imports',
    rejectsFiles(
      {
        'Main.tao': `
          use MainView from @outer
          use InnerView from @inner
          app NestedPackageApp { id "nested" version "1.0.0" name "Nested" view MainView }
        `,
        'features/@outer/Main.tao': `
          use NestedAlias
          project view MainView() { render Text(NestedAlias) }
          ${stubView('Text', 'Value text')}
        `,
        'features/@outer/@inner/Main.tao': `
          package let NestedAlias = "Nested"
          ${visibleView('InnerView')}
        `,
      },
      useValidationMessages.missingImport('NestedAlias', 'current package'),
    ),
  )

  Test(
    'does not load nested package files through bare package imports',
    checksFiles(
      {
        'Main.tao': `
          use MainView from @outer
          app NestedPackageApp { id "nested" version "1.0.0" name "Nested" view MainView }
        `,
        'features/@outer/Main.tao': visibleView('MainView'),
        'features/@outer/@inner/Broken.tao': 'view Broken() {',
      },
      result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    ),
  )

  Test(
    'rejects duplicate visible declarations in sibling package files',
    checksFiles(
      {
        'Main.tao': `
          use MainView from @foo
          app DuplicateVisibleApp { view MainView }
        `,
        'features/@foo/Main.tao': visibleView('MainView'),
        'features/@foo/First.tao': 'package let Shared = "First"',
        'features/@foo/Second.tao': 'public let Shared = "Second"',
      },
      result => {
        const duplicateMessages = validationErrorMessages(result).filter(message =>
          message.startsWith("Visible declaration 'Shared' is declared more than once in folder ")
        )

        Expect(duplicateMessages).toHaveLength(2)
      },
    ),
  )

  Test(
    'rejects more than one unnamed publication',
    rejects(
      `package { version 1.0.0 }\npackage { version 2.0.0 }\n${stubApp()}`,
      packageValidationMessages.duplicateDefault(),
    ),
  )

  Test(
    'rejects duplicate named publications',
    rejects(
      `package { name "Library" version 1.0.0 }\npackage { name "Library" version 2.0.0 }\n${stubApp()}`,
      packageValidationMessages.duplicateNamed('Library'),
    ),
  )

  Test(
    'rejects malformed publication versions',
    rejects(
      `package { version "01.2.3" }\n${stubApp()}`,
      packageValidationMessages.invalidVersion('01.2.3'),
    ),
  )

  Test(
    'accepts a prerelease publication version',
    accepts(`package { version "1.2.3-beta.1" }\n${stubApp()}`),
  )

  Test(
    'accepts a root publication in another file',
    acceptsFiles({
      'Library.tao': 'package { version 1.2.3 }',
      'Main.tao': stubApp(),
    }),
  )
})
