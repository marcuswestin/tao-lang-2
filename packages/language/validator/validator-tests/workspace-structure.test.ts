import { Packages } from '@ast-utils'
import { AST, codeProjectRoot, Langium, Parser } from '@parser'
import { Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { Validation } from '../validator-src/validation'
import { AliasesValidator } from '../validator-src/validators/aliases-validator'
import { preludeValidationMessages } from '../validator-src/validators/prelude-validator'
import { projectValidationMessages } from '../validator-src/validators/project-validator'
import { testValidationMessages } from '../validator-src/validators/tests-validator'
import { useValidationMessages, validateVisibleDeclarations } from '../validator-src/validators/use-validator'
import {
  accepts,
  acceptsFiles,
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

  Test('validates an existing parser result', async () => {
    await withValidationParse(stubApp(), ({ result }) => {
      Expect(validationErrorMessages(result)).toEqual([])
    })
  })

  Test('auto-loads the parsed Tao prelude and exposes its primitive slot contracts', async () => {
    await withValidationParse(stubApp(), ({ result }) => {
      const prelude = result.files.find(file => file.path.endsWith('/@tao/Prelude.tao'))
      Expect(prelude).toBeDefined()
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
        'Name',
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
        // A file-level test is a suite, so an empty one declares no checks rather than being a
        // leaf journey that forgot its run step. A leaf that forgets one is `missing run` below.
        title: 'rejects a file-level test that declares no checks',
        source: testSuite('', false),
        message: testValidationMessages.emptySuite('Smoke'),
      },
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
    'accepts relaunch fresh after run',
    accepts(testCheck('fresh relaunch', 'run MyApp\nrelaunch fresh\nexpect text "Hello"')),
  )

  Test(
    'rejects relaunch inside a selected row, whose scope a relaunch replaces',
    rejects(
      testCheck('relaunch in select', 'run MyApp\nselect #rows[1] { relaunch }'),
      testValidationMessages.relaunchInSelect,
    ),
  )

  Test(
    'rejects relaunch fresh inside a selected row, which the modifier does not excuse',
    rejects(
      testCheck('fresh relaunch in select', 'run MyApp\nselect #rows[1] { relaunch fresh }'),
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
        title: 'rejects relaunch fresh at top level',
        source: 'relaunch fresh',
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
    'accepts nested tests, which are the decided grouping form',
    accepts(`${stubApp()}\ntest "Smoke" { test "renders" { run MyApp\nexpect text "Hello" } }`),
  )

  Test(
    'accepts visible app declarations outside the entry file',
    acceptsFiles(
      {
        'Main.tao': `
          use OtherApp, OtherView from ./Other.tao
          ${app('render OtherView()')}
        `,
        'Other.tao': `
          folder app OtherApp { view OtherView }
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
          app MyApp { view MainView }
        `,
        'packages/@bar/Main.tao': `
          public app PackageApp { view MainView }
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
          app MyApp { view MainView }
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
          workspace let Greeting = "Hello"
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
          [packagePathCase.sourcePath]: 'workspace let Chosen = "File target"',
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
        'Outer/Main.tao': `
          project { id "outer" name "Outer" }
          use Hidden from @outer/Child
        `,
        'Outer/@outer/Main.tao': 'workspace let Visible = "Outer"',
        'Outer/@outer/Child/Project.tao': 'project { id "child" name "Child" }',
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
        'App/Main.tao': `
          project { id "app" name "App" }
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
        '@data/Data.tao': 'workspace let Visible = "Local"',
      },
      useValidationMessages.packagePathEscape('@data/../../Outside', '@data'),
    ),
  )

  Test(
    'keeps package-visible declarations out of cross-package imports',
    rejectsFiles(
      {
        'Main.tao': `
          use MainView from @bar
          app VisibilityApp { view MainView }
        `,
        'features/@bar/Main.tao': stubView('MainView').replace('view ', 'package view '),
      },
      useValidationMessages.notVisible('MainView'),
    ),
  )

  Test(
    'does not include nested package folders in bare package imports',
    rejectsFiles(
      {
        'Main.tao': `
          use MainView from @outer
          use InnerView from @inner
          app NestedPackageApp { view MainView }
        `,
        'features/@outer/Main.tao': `
          use NestedAlias
          workspace view MainView() { render Text(NestedAlias) }
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
          app NestedPackageApp { view MainView }
        `,
        'features/@outer/Main.tao': visibleView('MainView'),
        'features/@outer/@inner/Broken.tao': 'view Broken() {',
      },
      result => {
        Expect(Diagnostics.hasSource(result.diagnostics, 'parser')).toBe(false)
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

  for (
    const projectCase of [
      {
        title: 'rejects multiple project declarations',
        source: `project { id "one" name "One" }\nproject { id "two" name "Two" }\n${stubApp()}`,
        message: projectValidationMessages.duplicateProject(),
      },
      {
        title: 'rejects a missing project id with the migration command',
        source: `project { name "One" }\n${stubApp()}`,
        message: projectValidationMessages.requiredId(),
      },
      {
        title: 'rejects duplicate project ids',
        source: `project { id "one" id "two" name "One" }\n${stubApp()}`,
        message: projectValidationMessages.duplicateId(),
      },
      {
        title: 'rejects duplicate project names',
        source: `project { id "one" name "One" name "Two" }\n${stubApp()}`,
        message: projectValidationMessages.duplicateName(),
      },
      {
        title: 'rejects duplicate project versions',
        source: `project { id "one" name "One" version "1.2.3" version "1.2.4" }\n${stubApp()}`,
        message: projectValidationMessages.duplicateVersion(),
      },
      {
        title: 'rejects duplicate default apps',
        source: `project { id "one" name "One" app First app Second }\napp First { }\napp Second { }`,
        message: projectValidationMessages.duplicateDefaultApp(),
      },
      {
        title: 'rejects duplicate project remotes',
        source: `project { id "one" name "One" remote none remote none }\n${stubApp()}`,
        message: projectValidationMessages.duplicateRemote(),
      },
      {
        title: 'rejects duplicate project licenses',
        source: `project { id "one" name "One" license MIT license Apache }\n${stubApp()}`,
        message: projectValidationMessages.duplicateLicense(),
      },
      {
        title: 'rejects unsupported project requirements',
        source: `project { id "one" name "One" requires foo }\n${stubApp()}`,
        message: projectValidationMessages.unsupportedRequires(),
      },
    ]
  ) {
    Test(projectCase.title, rejects(projectCase.source, projectCase.message))
  }

  for (const version of ['1.2', '1.2.3-beta', '1.2.3+4', '01.2.3', 'v1.2.3']) {
    Test(
      `rejects non-core project version ${version}`,
      rejects(
        `project { id "version-test" name "Version test" version "${version}" }\n${stubApp()}`,
        projectValidationMessages.invalidVersion(),
      ),
    )
  }

  Test(
    'accepts numeric SemVer core and a default app declared beside project metadata',
    accepts(`
      project { id "one" name "One" version "0.12.3" app MyApp }
      ${stubApp()}
    `),
  )

  Test(
    'resolves a default app from a root project metadata file',
    acceptsFiles({
      'Project.tao': 'project { id "one" name "One" version "1.2.3" app MyApp }',
      'Main.tao': stubApp(),
    }),
  )
})
