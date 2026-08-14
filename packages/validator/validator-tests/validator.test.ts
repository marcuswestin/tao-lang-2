import { Packages } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { Diagnostics, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import { useValidationCodes } from '../validator-src/diagnostic-codes'
import { Validation } from '../validator-src/validation'
import Validator from '../validator-src/validator'
import { AliasesValidator } from '../validator-src/validators/aliases-validator'
import { AppValidator } from '../validator-src/validators/app-validator'
import { injectionValidationMessages } from '../validator-src/validators/injections-validator'
import { projectValidationMessages } from '../validator-src/validators/project-validator'
import { testValidationMessages } from '../validator-src/validators/tests-validator'
import { useValidationMessages, validateVisibleDeclarations } from '../validator-src/validators/use-validator'
import {
  fence,
  testValidateCode,
  testValidateCodeWithErrors,
  tsFence,
  validationErrorMessages,
  withValidationParse,
} from './test-validate'

const wordFlowerPath = Repo.resolvePath('Apps/WordFlower/1 - Current/WordFlower.tao')
const typeSystemTestsPath = Repo.resolvePath('Apps/Test Apps/Type System Tests/Type System Tests.tao')
const runtimeStdlibTestsPath = Repo.resolvePath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')
const stateActionMvpPath = Repo.resolvePath('Apps/Test Apps/State Action MVP/State Action MVP.tao')
type ValidatedFiles = Awaited<ReturnType<typeof Workspace.validate>>

async function withValidatedFiles<
  const Files extends Record<string, string>,
  EntryFile extends keyof Files & string,
>(
  entryFile: EntryFile,
  files: Files,
  testFunction: (validated: ValidatedFiles) => Promise<void> | void,
): Promise<void> {
  await withTaoFiles('tao-validator-', files, async paths => {
    await testFunction(await Workspace.validate(paths[entryFile]))
  })
}

Describe('Tao validator structural diagnostics', () => {
  Test('rejects prototype-mutating runtime scope names', async () => {
    const result = await testValidateCodeWithErrors(`
      app ScopeApp { view MainView }
      let __proto__ = "unsafe"
      view MainView __proto__ is text {
        render Text("Ready")
      }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
    `)

    const messages = validationErrorMessages(result)
    Expect(messages.filter(message => message === AliasesValidator.messages.reservedName('__proto__'))).toHaveLength(2)
  })

  Test('validates the current WordFlower app', async () => {
    const result = await Workspace.validate(wordFlowerPath)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('validates the Type System Tests app', async () => {
    const result = await Workspace.validate(typeSystemTestsPath)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('validates the Runtime Stdlib Tests app', async () => {
    const result = await Workspace.validate(runtimeStdlibTestsPath)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('validates the State Action MVP app', async () => {
    const result = await Workspace.validate(stateActionMvpPath)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('validates an existing parser result', async () => {
    await withValidationParse(
      `
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `,
      ({ result }) => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
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

  Test('validates relative use imports across sibling files', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        view MainView {
          render Text("Hello")
        }
      `,
        'Views.tao': `
        workspace view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('keeps type references distinct from same-name views', async () => {
    const result = await testValidateCode(`
      app MyApp { view MainView }
      type Card is text
      let CardValue = Card "Ada"
      view Card {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Text(CardValue)
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('resolves same-name qualified item types when renderables lack that scoped member', async () => {
    const result = await testValidateCode(`
      app MyApp { view MainView }
      type Card is {
        Name is text
      }
      let CardName = Card.Name "Ada"
      view Card Label is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Text(CardName)
      }
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('allows imported types to share names with local values', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Name from ./Types.tao
        let Name = Name "Ro"
        view MainView {
          render Text(Name)
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
        'Types.tao': `
        let Name = "Hidden"
        workspace type Name is text
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('keeps invisible same-name imports out of value scopes', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Name from ./Types.tao
        view MainView {
          render Text(Name)
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
        'Types.tao': `
        let Name = "Hidden"
        workspace type Name is text
      `,
      },
      async result => {
        Expect(validationErrorMessages(result).some(message => message.includes('Name'))).toBe(true)
      },
    )
  })

  Test('keeps invisible same-name imports out of type scopes', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Name from ./Types.tao
        let DisplayName = Name "Ro"
        view MainView {
          render Text(DisplayName)
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
        'Types.tao': `
        type Name is text
        workspace let Name = "Visible"
      `,
      },
      async result => {
        Expect(validationErrorMessages(result).some(message => message.includes('Name'))).toBe(true)
      },
    )
  })

  Test('validates explicit Tao file use imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./Views.tao
        view MainView {
          render Text("Hello")
        }
      `,
        'Views.tao': `
        workspace view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('validates source strings that import the Tao stdlib', async () => {
    await testValidateCode(`
      use Text from @tao/ui
      app MyApp { view MainView }
      view MainView {
        render Text("Hello")
      }
    `)
  })

  Test('rejects file-private imports from another file in the same directory', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        view MainView {
          render Text("Hello")
        }
      `,
        'Views.tao': `
        view Text Value is text {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.notVisible('Text'))
      },
    )
  })

  Test('rejects cross-file imports for declarations that are not visible', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./views
        view MainView { }
      `,
        'views/Views.tao': `
        view Text Value is text {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.notVisible('Text'))
      },
    )
  })

  Test('reports validator errors inside imported Tao files', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        view MainView {
          render Text("Hello")
        }
      `,
        'Views.tao': `
        workspace view Text Value is text {
          render inject Value, Value ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        const diagnostic = result.diagnostics.find(diagnostic =>
          diagnostic.message === injectionValidationMessages.duplicateArgument('Value')
        )

        Expect(validationErrorMessages(result)).toContain(injectionValidationMessages.duplicateArgument('Value'))
        Expect(diagnostic?.filePath?.endsWith('/Views.tao')).toBe(true)
      },
    )
  })

  Test('reports parser errors inside imported Tao files', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        view MainView {
          render Text("Hello")
        }
      `,
        'Views.tao': 'view Text Value is text {',
      },
      async result => {
        Expect(Diagnostics.hasSource(result.diagnostics, 'parser')).toBe(true)
      },
    )
  })

  Test('keeps parser errors from different imported files distinct', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use BrokenOne from ./one
        use BrokenTwo from ./two
        view MainView { }
      `,
        'one/BrokenOne.tao': 'view BrokenOne {',
        'two/BrokenTwo.tao': 'view BrokenTwo {',
      },
      async result => {
        const parserDiagnostics = Diagnostics.errors(result.diagnostics, 'parser')

        Expect(parserDiagnostics).toHaveLength(2)
        Expect(new Set(parserDiagnostics.map(diagnostic => diagnostic.filePath)).size).toBe(2)
      },
    )
  })

  Test('reports unresolved references inside imported Tao files', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        view MainView {
          render Text("Hello")
        }
      `,
        'Views.tao': `
        workspace view Text Value is text {
          render MissingView()
        }
      `,
      },
      async result => {
        Expect(Diagnostics.hasMessageContaining(Diagnostics.errors(result.diagnostics, 'linker'), 'MissingView')).toBe(
          true,
        )
      },
    )
  })

  Test('rejects names imported by more than one use statement', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./
        use Text from ./
        view MainView {
          render Text("Hello")
        }
      `,
        'Views.tao': `
        workspace view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.repeatedImport('Text'))
      },
    )
  })

  Test('rejects imports that collide with declarations in the importing file', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
      app MyApp { view MainView }
      use Text from ./Views.tao
      view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        render Text("Hello")
      }
    `,
        'Views.tao': `
      workspace view Text Value is text {
        render inject Value ${tsFence}
          return <RN.Text>{Value}</RN.Text>
        ${fence}
      }
    `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.localDeclarationCollision('Text'))
      },
    )
  })

  Test('rejects app imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use OtherApp from ./Other.tao
        view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'Other.tao': `
        app OtherApp { view OtherView }
        view OtherView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.appImport('OtherApp'))
      },
    )
  })

  Test('allows test files to import apps from the same directory', async () => {
    await withValidatedFiles(
      'Main.test.tao',
      {
        'Main.test.tao': `
        use MyApp from ./

        test "Smoke" {
          check "renders" {
            run MyApp
            expect text "Hello"
          }
        }
      `,
        'Main.tao': `
        app MyApp { view MainView }
        view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('does not let inline tests import app declarations outside the entry file', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use OtherView from ./Other.tao
        view MainView {
          render OtherView()
        }
        test "inline smoke" {
          check "renders" {
            run MyApp
            expect text "Hello"
          }
        }
      `,
        'Other.tao': `
        app OtherApp { view OtherView }
        workspace view OtherView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(AppValidator.messages.appEntryFile('OtherApp'))
      },
    )
  })

  Test('does not let test sidecars relax app placement outside their directory', async () => {
    await withValidatedFiles(
      'Main.test.tao',
      {
        'Main.test.tao': `
        use MyApp from ./
        use OtherView from ./nested/Other.tao

        test "sidecar smoke" {
          check "renders" {
            run MyApp
            expect text "Hello"
          }
        }
      `,
        'Main.tao': `
        app MyApp { view MainView }
        view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'nested/Other.tao': `
        app OtherApp { view OtherView }
        workspace view OtherView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(AppValidator.messages.appEntryFile('OtherApp'))
      },
    )
  })

  Test('validates v0 test check run structure', async () => {
    const missingCheck = await testValidateCodeWithErrors(`
      test "Smoke" { }
    `)
    const missingRun = await testValidateCodeWithErrors(`
      test "Smoke" {
        check "missing run" {
          expect text "Hello"
        }
      }
    `)
    const duplicateRun = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
      test "Smoke" {
        check "duplicate run" {
          run MyApp
          run MyApp
        }
      }
    `)
    const expectationBeforeRun = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
      test "Smoke" {
        check "ordered run" {
          expect text "Hello"
          run MyApp
        }
      }
    `)
    const pressBeforeRun = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
      test "Smoke" {
        check "ordered press" {
          press text "Add"
          run MyApp
        }
      }
    `)
    const nonAppRun = await testValidateCodeWithErrors(`
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
      test "Smoke" {
        check "non app" {
          run MainView
        }
      }
    `)
    Expect(validationErrorMessages(missingCheck)).toContain(testValidationMessages.missingCheck('Smoke'))
    const missingRunMessages = validationErrorMessages(missingRun)
    Expect(missingRunMessages).toContain(testValidationMessages.missingRun('missing run'))
    Expect(missingRunMessages).not.toContain(testValidationMessages.expectationBeforeRun)
    Expect(validationErrorMessages(duplicateRun)).toContain(testValidationMessages.duplicateRun('duplicate run'))
    Expect(validationErrorMessages(expectationBeforeRun)).toContain(testValidationMessages.expectationBeforeRun)
    Expect(validationErrorMessages(pressBeforeRun)).toContain(testValidationMessages.expectationBeforeRun)
    const nonAppRunMessages = validationErrorMessages(nonAppRun)
    Expect(
      nonAppRunMessages.some(message => message.includes('AppValueDeclaration') && message.includes('MainView')),
    ).toBe(true)
    Expect(nonAppRunMessages).not.toContain(testValidationMessages.runTarget('MainView'))
  })

  Test('validates placeholder selectors, input-value selectors, and standalone test back', async () => {
    await testValidateCode(`
      app MyApp { view MainView }
      view MainView { render inject ${tsFence}\nreturn null\n${fence} }
      test "Input" {
        check "selectors" {
          run MyApp
          enter "Draft" into placeholder "Title"
          submit placeholder "Title"
          expect placeholder "Title"
          expect input placeholder "Title" value "Draft"
          back
        }
      }
    `)
    const backBeforeRun = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView { render inject ${tsFence}\nreturn null\n${fence} }
      test "Navigation" {
        check "order" {
          back
          run MyApp
        }
      }
    `)

    Expect(validationErrorMessages(backBeforeRun)).toContain(testValidationMessages.expectationBeforeRun)
  })

  Test('validates v0 test statement placement', async () => {
    const checkAtTopLevel = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
      check "orphan" {
        run MyApp
      }
    `)
    const runInTestBlock = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
      test "Smoke" {
        run MyApp
      }
    `)
    const expectationAtTopLevel = await testValidateCodeWithErrors(`
      expect text "Hello"
    `)
    const pressAtTopLevel = await testValidateCodeWithErrors(`
      press text "Add"
    `)
    const aliasInCheckBlock = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
      test "Smoke" {
        check "renders" {
          let Message = "Hello"
          run MyApp
        }
      }
    `)
    const nestedTest = await testValidateCodeWithErrors(`
      test "Outer" {
        test "Inner" { }
      }
    `)

    Expect(validationErrorMessages(checkAtTopLevel)).toContain(testValidationMessages.checkPlacement)
    const runInTestMessages = validationErrorMessages(runInTestBlock)
    Expect(runInTestMessages).toContain(testValidationMessages.testBlock('Smoke'))
    Expect(runInTestMessages).not.toContain(testValidationMessages.runPlacement)
    Expect(validationErrorMessages(expectationAtTopLevel)).toContain(testValidationMessages.expectationPlacement)
    Expect(validationErrorMessages(pressAtTopLevel)).toContain(testValidationMessages.pressPlacement)
    Expect(validationErrorMessages(aliasInCheckBlock)).toContain(testValidationMessages.checkBlock('renders'))
    const nestedTestMessages = validationErrorMessages(nestedTest)
    Expect(nestedTestMessages).toContain(testValidationMessages.testPlacement)
    Expect(nestedTestMessages).toContain(testValidationMessages.testBlock('Outer'))
  })

  Test('rejects app declarations outside the entry file', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use OtherView from ./Other.tao
        view MainView {
          render OtherView()
        }
      `,
        'Other.tao': `
        app OtherApp { view OtherView }
        workspace view OtherView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(AppValidator.messages.appEntryFile('OtherApp'))
      },
    )
  })

  Test('rejects app declarations inside packages', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use MainView from @bar
      `,
        'packages/@bar/Main.tao': `
        app PackageApp { view MainView }
        workspace view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(AppValidator.messages.appPackage('PackageApp'))
      },
    )
  })

  Test('rejects imports that match multiple visible declarations in an import target', async () => {
    const sharedTextSource = `
      workspace view Text Value is text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Text from ./views
        view MainView {
          render Text("Hello")
        }
      `,
        'views/Views.tao': sharedTextSource,
        'views/MoreViews.tao': sharedTextSource,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.ambiguousImport('Text', './views'))
      },
    )
  })

  Test('allows file-level aliases that reference imported aliases', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use Greeting from ./
        let Local = Greeting
        view Text Value is text {
          render inject Value ${tsFence}
            return <RN.Text>{Value}</RN.Text>
          ${fence}
        }
        view MainView {
          render Text(Local)
        }
      `,
        'Views.tao': `
        // Padding comments keep this declaration at a larger source offset than the
        // importing file's references, which used to trip the declaration-order check.
        // More padding.
        // More padding.
        workspace let Greeting = "Hello"
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('validates bare use imports across a whole package', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app PackageApp { view MainView }
        use MainView from @foo/forms
      `,
        'features/@foo/Title.tao': `
        package let PackageTitle = "Package title"
      `,
        'features/@foo/forms/Main.tao': `
        use PackageTitle
        workspace view MainView {
          render Text(PackageTitle)
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('resolves package imports through the project package index', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app IndexedPackageApp { view MainView }
        use MainView from @bar/views
      `,
        'deep/packages/@bar/views/Main.tao': `
        workspace view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('resolves package paths through folders instead of file basenames', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app FolderTargetApp { view MainView }
        use Chosen from @foo/Widget
        use FileOnly from @foo/FileOnly
        use ExplicitFile from @foo/ExplicitFile.tao
        view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'features/@foo/Widget.tao': `
        workspace let Chosen = "Wrong file target"
      `,
        'features/@foo/Widget/Index.tao': `
        workspace let Chosen = "Folder target"
      `,
        'features/@foo/FileOnly.tao': `
        workspace let FileOnly = "File target"
      `,
        'features/@foo/ExplicitFile.tao': `
        workspace let ExplicitFile = "Explicit file target"
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.unresolvedImport('@foo/FileOnly'))
        Expect(validationErrorMessages(result)).toContain(
          useValidationMessages.unresolvedImport('@foo/ExplicitFile.tao'),
        )
      },
    )
  })

  Test('rejects duplicate package names in the package index', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app DuplicatePackageApp { view MainView }
        use MainView from @bar
      `,
        'one/@bar/Main.tao': `
        workspace view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'two/@bar/Main.tao': `
        workspace view OtherView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result).some(message => message.includes("Package '@bar' is ambiguous"))).toBe(
          true,
        )
      },
    )
  })

  Test('rejects relative imports that cross package boundaries', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app BoundaryApp { view MainView }
        use MainView from ./features/@bar
      `,
        'features/@bar/Main.tao': `
        workspace view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.packageBoundary('./features/@bar'))
      },
    )
  })

  Test('keeps package-visible declarations out of cross-package imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app VisibilityApp { view MainView }
        use MainView from @bar
      `,
        'features/@bar/Main.tao': `
        package view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(useValidationMessages.notVisible('MainView'))
      },
    )
  })

  Test('does not include nested package folders in bare package imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app NestedPackageApp { view MainView }
        use MainView from @outer
        use InnerView from @inner
      `,
        'features/@outer/Main.tao': `
        use NestedAlias
        workspace view MainView {
          render Text(NestedAlias)
        }
        view Text Value is text {
          render inject Value ${tsFence}
            return null
          ${fence}
        }
      `,
        'features/@outer/@inner/Main.tao': `
        package let NestedAlias = "Nested"
        workspace view InnerView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toContain(
          useValidationMessages.missingImport('NestedAlias', 'current package'),
        )
      },
    )
  })

  Test('does not load nested package files through bare package imports', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app NestedPackageApp { view MainView }
        use MainView from @outer
      `,
        'features/@outer/Main.tao': `
        workspace view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'features/@outer/@inner/Broken.tao': 'view Broken {',
      },
      async result => {
        Expect(Diagnostics.hasSource(result.diagnostics, 'parser')).toBe(false)
        Expect(validationErrorMessages(result)).toEqual([])
      },
    )
  })

  Test('rejects duplicate visible declarations in sibling package files', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        app DuplicateVisibleApp { view MainView }
        use MainView from @foo
      `,
        'features/@foo/Main.tao': `
        workspace view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'features/@foo/First.tao': `
        package let Shared = "First"
      `,
        'features/@foo/Second.tao': `
        public let Shared = "Second"
      `,
      },
      async result => {
        const duplicateMessages = validationErrorMessages(result).filter(message =>
          message.startsWith("Visible declaration 'Shared' is declared more than once in folder ")
        )

        Expect(duplicateMessages).toHaveLength(2)
      },
    )
  })

  Test('validates local project metadata blocks', async () => {
    const result = await testValidateCodeWithErrors(`
      project {
        name "One"
        name "Two"
        remote none
        remote none
        license MIT
        license Apache
        requires foo
      }
      project {
        name "Duplicate"
      }
      app MetadataApp { view MainView }
      view MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(projectValidationMessages.duplicateProject())
    Expect(validationErrorMessages(result)).toContain(projectValidationMessages.duplicateName())
    Expect(validationErrorMessages(result)).toContain(projectValidationMessages.duplicateRemote())
    Expect(validationErrorMessages(result)).toContain(projectValidationMessages.duplicateLicense())
    Expect(validationErrorMessages(result)).toContain(projectValidationMessages.unsupportedRequires())
  })
})

Describe('Tao validator use organization diagnostics', () => {
  Test('warns about unused imports with a quick-fix code', async () => {
    const result = await Validator.validateCode(`
      use Text, Stack from @tao/ui
      app MyApp { view MainView }
      view MainView {
        render Text("hi")
      }
    `)
    const warning = result.diagnostics.find(diagnostic =>
      diagnostic.message === useValidationMessages.unusedImport('Stack')
    )

    Expect(validationErrorMessages(result)).toEqual([])
    Expect(warning?.severity).toBe('warning')
    Expect(warning?.code).toBe(useValidationCodes.unusedImport)
  })

  Test('treats imported shorthand item field types as used', async () => {
    await withValidatedFiles(
      'Main.tao',
      {
        'Main.tao': `
        use Name from ./Types.tao
        app MyApp { view MainView }
        type Person is {
          Name
        }
        view MainView {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
        'Types.tao': `
        workspace type Name is text
      `,
      },
      async result => {
        Expect(validationErrorMessages(result)).toEqual([])
        Expect(
          result.diagnostics.some(diagnostic => diagnostic.message === useValidationMessages.unusedImport('Name')),
        ).toBe(false)
      },
    )
  })

  Test('warns about use statements after other top-level statements', async () => {
    const result = await Validator.validateCode(`
      app MyApp { view MainView }
      use Text from @tao/ui
      view MainView {
        render Text("hi")
      }
    `)
    const warning = result.diagnostics.find(diagnostic => diagnostic.message === useValidationMessages.useOutOfSection)

    Expect(validationErrorMessages(result)).toEqual([])
    Expect(warning?.severity).toBe('warning')
    Expect(warning?.code).toBe(useValidationCodes.useOutOfSection)
  })

  Test('reports no organization warnings for a canonical import section', async () => {
    const result = await Validator.validateCode(`
      use Text from @tao/ui
      app MyApp { view MainView }
      view MainView {
        render Text("hi")
      }
    `)

    Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'warning')).toEqual([])
  })
})

Describe('Tao validator review regressions', () => {
  Test('queries resolve imported plural data declarations', async () => {
    await withValidatedFiles('Main.tao', {
      'Schema.tao': `
        workspace data Workspaces / Workspace { Name text }
      `,
      'Main.tao': `
        use Workspaces from ./Schema

        app ImportApp { view Main }
        view Main {
          query Workspaces { }
          render Text("Rows: { Workspaces.Count }")
        }
        view Text Value is text { render inject ${tsFence} return null ${fence} }
      `,
    }, async validated => {
      Expect(validationErrorMessages(validated)).toEqual([])
    })
  })
})
