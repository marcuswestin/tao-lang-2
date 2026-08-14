import { Packages } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { Validation } from '../validator-src/validation'
import { AliasesValidator } from '../validator-src/validators/aliases-validator'
import { AppValidator } from '../validator-src/validators/app-validator'
import { projectValidationMessages } from '../validator-src/validators/project-validator'
import { testValidationMessages } from '../validator-src/validators/tests-validator'
import { useValidationMessages, validateVisibleDeclarations } from '../validator-src/validators/use-validator'
import {
  app,
  rejects,
  stubView,
  testValidateCodeWithErrors,
  type ValidatedFiles,
  validationErrorMessages,
  withValidatedFiles,
  withValidationParse,
} from './test-validate'

type TaoFiles = Record<string, string>
type FilesCheck = (result: ValidatedFiles) => Promise<void> | void

function checksFiles(files: TaoFiles, check: FilesCheck): () => Promise<void> {
  return async () => await withValidatedFiles('Main.tao', files, check)
}

function rejectsFiles(files: TaoFiles, ...messages: readonly string[]): () => Promise<void> {
  return checksFiles(files, result => {
    const errors = validationErrorMessages(result).join('\n')
    for (const message of messages) {
      Expect(errors).toContain(message)
    }
  })
}

function visibleView(name: string, parameters = ''): string {
  return stubView(name, parameters).replace('view ', 'workspace view ')
}

function stubApp(extra = ''): string {
  return app('render Fixture()', `${stubView('Fixture')}\n${extra}`)
}

function testSuite(body: string, includeApp = true): string {
  const test = `test "Smoke" { ${body} }`
  return includeApp ? stubApp(test) : test
}

function testCheck(name: string, body: string, includeApp = true): string {
  return testSuite(`check "${name}" { ${body} }`, includeApp)
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
        view MainView __proto__ is text { render Fixture() }
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

  Test('does not report duplicate visible declarations for repeated LSP document instances', async () => {
    const parserContext = Parser.createContext()
    const uri = Langium.URI.file('/__tao__/Views.tao')
    const documentOne = parserContext.services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(
      'public layout Box { }',
      uri,
    )
    const documentTwo = parserContext.services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(
      'public layout Box { }',
      uri,
    )
    const diagnostics = Validation.collectDiagnostics()
    const packagesContext = await Packages.createContext('/__tao__')
    const ctx = Validation.createContext(diagnostics.accept, {
      entryFilePath: uri.path,
      packagesContext,
      typir: {} as any,
      workspaceFiles: [
        documentOne.parseResult.value!,
        documentTwo.parseResult.value!,
      ],
    })

    validateVisibleDeclarations(ctx, documentOne.parseResult.value!)

    Expect(diagnostics.diagnostics).toEqual([])
  })

  Test('returns parser diagnostics without running structural checks on syntax errors', async () => {
    const result = await testValidateCodeWithErrors('view Broken { render }')

    Expect(Diagnostics.hasSource(result.diagnostics, 'parser')).toBe(true)
    Expect(Diagnostics.hasSource(result.diagnostics, 'validator')).toBe(false)
  })

  for (
    const checkCase of [
      {
        title: 'rejects test suites without checks',
        source: testSuite('', false),
        message: testValidationMessages.missingCheck('Smoke'),
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

    Expect(messages.some(message => message.includes('AppValueDeclaration') && message.includes('MainView'))).toBe(true)
    Expect(messages).not.toContain(testValidationMessages.runTarget('MainView'))
  })

  Test(
    'rejects back before run',
    rejects(testCheck('order', 'back\nrun MyApp'), testValidationMessages.expectationBeforeRun),
  )

  for (
    const placementCase of [
      {
        title: 'rejects checks at top level',
        source: `${stubApp()}\ncheck "orphan" { run MyApp }`,
        messages: [testValidationMessages.checkPlacement],
      },
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
        title: 'rejects aliases in check blocks',
        source: testCheck('renders', 'let Message = "Hello"\nrun MyApp'),
        messages: [testValidationMessages.checkBlock('renders')],
      },
      {
        title: 'rejects nested test declarations',
        source: 'test "Outer" { test "Inner" { } }',
        messages: [testValidationMessages.testPlacement, testValidationMessages.testBlock('Outer')],
      },
    ]
  ) {
    Test(placementCase.title, rejects(placementCase.source, ...placementCase.messages))
  }

  Test('reports a run in a test block without a cascading run-placement diagnostic', async () => {
    const result = await testValidateCodeWithErrors(testSuite('run MyApp'))
    const messages = validationErrorMessages(result)

    Expect(messages).toContain(testValidationMessages.testBlock('Smoke'))
    Expect(messages).not.toContain(testValidationMessages.runPlacement)
  })

  Test(
    'rejects app declarations outside the entry file',
    rejectsFiles(
      {
        'Main.tao': `
          use OtherView from ./Other.tao
          ${app('render OtherView()')}
        `,
        'Other.tao': `
          app OtherApp { view OtherView }
          ${visibleView('OtherView')}
        `,
      },
      AppValidator.messages.appEntryFile('OtherApp'),
    ),
  )

  Test(
    'rejects app declarations inside packages',
    rejectsFiles(
      {
        'Main.tao': `
          use MainView from @bar
          app MyApp { view MainView }
        `,
        'packages/@bar/Main.tao': `
          app PackageApp { view MainView }
          ${visibleView('MainView')}
        `,
      },
      AppValidator.messages.appPackage('PackageApp'),
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
        'views/Views.tao': visibleView('Text', 'Value is text'),
        'views/MoreViews.tao': visibleView('Text', 'Value is text'),
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
          ${stubView('Text', 'Value is text')}
          view MainView { render Text(Local) }
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
          workspace view MainView { render Text(NestedAlias) }
          ${stubView('Text', 'Value is text')}
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
        'features/@outer/@inner/Broken.tao': 'view Broken {',
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
        source: `project { name "One" }\nproject { name "Two" }\n${stubApp()}`,
        message: projectValidationMessages.duplicateProject(),
      },
      {
        title: 'rejects duplicate project names',
        source: `project { name "One" name "Two" }\n${stubApp()}`,
        message: projectValidationMessages.duplicateName(),
      },
      {
        title: 'rejects duplicate project remotes',
        source: `project { remote none remote none }\n${stubApp()}`,
        message: projectValidationMessages.duplicateRemote(),
      },
      {
        title: 'rejects duplicate project licenses',
        source: `project { license MIT license Apache }\n${stubApp()}`,
        message: projectValidationMessages.duplicateLicense(),
      },
      {
        title: 'rejects unsupported project requirements',
        source: `project { requires foo }\n${stubApp()}`,
        message: projectValidationMessages.unsupportedRequires(),
      },
    ]
  ) {
    Test(projectCase.title, rejects(projectCase.source, projectCase.message))
  }
})
