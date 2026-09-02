import { Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { useValidationCodes } from '../validator-src/diagnostic-codes'
import Validator from '../validator-src/validator'
import { AppValidator } from '../validator-src/validators/app-validator'
import { injectionValidationMessages } from '../validator-src/validators/injections-validator'
import { useValidationMessages } from '../validator-src/validators/use-validator'
import {
  accepts,
  acceptsFiles,
  acceptsFilesFrom,
  app,
  checksFiles,
  fence,
  rejectsFiles,
  rejectsFilesFrom,
  stubView,
  type TaoFiles,
  tsFence,
  validationErrorMessages,
  visibleView,
} from './test-validate'

function importingApp(imports: string, body = 'render Text("Hello")', extra = ''): string {
  return `${imports}\n${app(body, extra)}`
}

function stubApp(extra = ''): string {
  return app(`render inject ${tsFence} return null ${fence}`, extra)
}

function importedTextFiles(
  imports: string,
  importedSource = visibleView('Text', 'Value text'),
  importedPath = 'Views.tao',
): TaoFiles {
  return {
    'Main.tao': importingApp(imports),
    [importedPath]: importedSource,
  }
}

Describe('validator: use and imports', () => {
  Test(
    'keeps type references distinct from same-name views',
    accepts(
      app(
        'render Text(CardValue)',
        `type Card is text
         let CardValue = Card "Ada"
         ${stubView('Card')}
         ${stubView('Text', 'Value text')}`,
      ),
    ),
  )

  Test(
    'resolves same-name qualified item types when renderables lack that scoped member',
    accepts(
      app(
        'render Text(CardName)',
        `type Card is { Name text }
         let CardName = Card.Name "Ada"
         ${stubView('Card', 'Label text')}
         ${stubView('Text', 'Value text')}`,
      ),
    ),
  )

  for (const valueFirst of [true, false]) {
    Test(
      `imports same-name type and value declarations when the ${valueFirst ? 'value' : 'type'} is declared first`,
      checksFiles(
        {
          'Main.tao': `
            use Person from ./Declarations.tao

            app MyApp { view MainView }
            let Primary = Person { Name Person }

            view MainView() {
              render Text(Primary.Name)
            }

            ${stubView('Text', 'Value text')}
          `,
          'Declarations.tao': valueFirst
            ? `workspace let Person = "person"
               workspace type Person is { Name text }`
            : `workspace type Person is { Name text }
               workspace let Person = "person"`,
        },
        result => {
          Expect(validationErrorMessages(result)).toEqual([])
        },
      ),
    )
  }

  Test(
    'keeps invisible same-name imports out of value scopes',
    checksFiles(
      {
        'Main.tao': importingApp(
          'use Name from ./Types.tao',
          'render Text(Name)',
          stubView('Text', 'Value text'),
        ),
        'Types.tao': `
          let Name = "Hidden"
          workspace type Name is text
        `,
      },
      result => {
        Expect(validationErrorMessages(result).some(message => message.includes('Name'))).toBe(true)
      },
    ),
  )

  Test(
    'keeps invisible same-name imports out of type scopes',
    checksFiles(
      {
        'Main.tao': importingApp(
          'use Name from ./Types.tao',
          `let DisplayName = Name "Ro"
           render Text(DisplayName)`,
          stubView('Text', 'Value text'),
        ),
        'Types.tao': `
          type Name is text
          workspace let Name = "Visible"
        `,
      },
      result => {
        Expect(validationErrorMessages(result).some(message => message.includes('Name'))).toBe(true)
      },
    ),
  )

  // A folder outside any `@package` directory is still a package boundary, so `package` has to be
  // usable in an ordinary app directory, where every sibling import resolves as `same-directory`.
  Test(
    'accepts package-visible imports from another file in the same directory',
    acceptsFiles(
      importedTextFiles(
        'use Text from ./',
        stubView('Text', 'Value text').replace('view ', 'package view '),
      ),
    ),
  )

  // What `package` still refuses, and what separates it from `workspace`: reaching into a different
  // package of the same project.
  Test(
    'rejects package-visible imports from another package in the same project',
    rejectsFiles(
      {
        'Main.tao': importingApp('use Text from @views'),
        'Packages/@views/Views.tao': stubView('Text', 'Value text').replace('view ', 'package view '),
      },
      useValidationMessages.notVisible('Text'),
    ),
  )

  for (
    const visibilityCase of [
      {
        title: 'rejects file-private imports from another file in the same directory',
        importPath: './',
        sourcePath: 'Views.tao',
      },
      {
        title: 'rejects cross-file imports for declarations that are not visible',
        importPath: './views',
        sourcePath: 'views/Views.tao',
      },
    ]
  ) {
    Test(
      visibilityCase.title,
      rejectsFiles(
        importedTextFiles(
          `use Text from ${visibilityCase.importPath}`,
          stubView('Text', 'Value text'),
          visibilityCase.sourcePath,
        ),
        useValidationMessages.notVisible('Text'),
      ),
    )
  }

  Test(
    'reports validator errors inside imported Tao files',
    checksFiles(
      importedTextFiles(
        'use Text from ./',
        `
          workspace view Text(Value text) {
            render inject Value, Value ${tsFence}
              return null
            ${fence}
          }
        `,
      ),
      result => {
        const message = injectionValidationMessages.duplicateArgument('Value')
        const diagnostic = result.diagnostics.find(diagnostic => diagnostic.message === message)

        Expect(validationErrorMessages(result)).toContain(message)
        Expect(diagnostic?.filePath?.endsWith('/Views.tao')).toBe(true)
      },
    ),
  )

  Test(
    'reports parser errors inside imported Tao files',
    checksFiles(importedTextFiles('use Text from ./', 'view Text(Value text) {'), result => {
      Expect(Diagnostics.hasSource(result.diagnostics, 'parser')).toBe(true)
    }),
  )

  Test(
    'keeps parser errors from different imported files distinct',
    checksFiles(
      {
        'Main.tao': importingApp(
          `use BrokenOne from ./one
           use BrokenTwo from ./two`,
          '',
        ),
        'one/BrokenOne.tao': 'view BrokenOne() {',
        'two/BrokenTwo.tao': 'view BrokenTwo() {',
      },
      result => {
        const parserDiagnostics = Diagnostics.errors(result.diagnostics, 'parser')

        Expect(parserDiagnostics).toHaveLength(2)
        Expect(new Set(parserDiagnostics.map(diagnostic => diagnostic.filePath)).size).toBe(2)
      },
    ),
  )

  Test(
    'reports unresolved references inside imported Tao files',
    checksFiles(
      importedTextFiles(
        'use Text from ./',
        `
          workspace view Text(Value text) {
            render MissingView()
          }
        `,
      ),
      result => {
        Expect(Diagnostics.hasMessageContaining(Diagnostics.errors(result.diagnostics, 'linker'), 'MissingView')).toBe(
          true,
        )
      },
    ),
  )

  Test(
    'rejects names imported by more than one use statement',
    rejectsFiles(
      importedTextFiles(`use Text from ./
                         use Text from ./`),
      useValidationMessages.repeatedImport('Text'),
    ),
  )

  Test(
    'rejects imports that collide with declarations in the importing file',
    rejectsFiles(
      {
        'Main.tao': importingApp(
          'use Text from ./Views.tao',
          'render Text("Hello")',
          stubView('Text', 'Value text'),
        ),
        'Views.tao': visibleView('Text', 'Value text'),
      },
      useValidationMessages.localDeclarationCollision('Text'),
    ),
  )

  Test(
    'allows a same-directory supporting file to import the entry app identity for a strict target',
    checksFiles(
      {
        'Main.tao': `
          use Helper, ResetNav from ./Support.tao
          app MyApp { Name "My app" Navigator ResetNav }
          workspace let AppLet = MyApp with { Name "Inferred app" }
        `,
        'Support.tao': `
          use StackNav from @tao/nav
          use Col from @tao/ui
          use AppLet, MyApp from ./
          workspace nav ResetNav = StackNav { Initial Helper }
          workspace scene Helper() {
            Title "Helper"
            action Reset() { replace ResetNav in MyApp }
            render Col() { }
          }
          test "support app imports" {
            test "runs the inferred app value" { run AppLet }
          }
        `,
      },
      result => Expect(validationErrorMessages(result)).toEqual([]),
    ),
  )

  Test(
    'does not let inline tests import app declarations outside the entry file',
    rejectsFiles(
      {
        'Main.tao': importingApp(
          'use OtherView from ./Other.tao',
          'render OtherView()',
          `test "inline smoke" {
             test "renders" {
               run MyApp
               expect text "Hello"
             }
           }`,
        ),
        'Other.tao': `
          app OtherApp { view OtherView }
          ${visibleView('OtherView')}
        `,
      },
      AppValidator.messages.appEntryFile('OtherApp'),
    ),
  )

  // Once sources are grouped into folders, the app a sidecar runs is declared in an ancestor
  // directory rather than beside it.
  Test(
    'lets a test sidecar in a subfolder run an app declared in an ancestor directory',
    acceptsFilesFrom('ui/Main.test.tao', {
      'Main.tao': stubApp(),
      'ui/Main.test.tao': `
        use MyApp from ../
        test "sidecar smoke" {
          test "renders" {
            run MyApp
            expect text "Hello"
          }
        }
      `,
    }),
  )

  Test(
    'does not let test sidecars relax app placement outside their directory',
    rejectsFilesFrom(
      'Main.test.tao',
      {
        'Main.test.tao': `
          use MyApp from ./
          use OtherView from ./nested/Other.tao
          test "sidecar smoke" {
            test "renders" {
              run MyApp
              expect text "Hello"
            }
          }
        `,
        'Main.tao': stubApp(),
        'nested/Other.tao': `
          app OtherApp { view OtherView }
          ${visibleView('OtherView')}
        `,
      },
      AppValidator.messages.appEntryFile('OtherApp'),
    ),
  )
})

Describe('validator: use organization', () => {
  Test('warns about unused imports with a quick-fix code', async () => {
    const result = await Validator.validateCode(`
      use Text, Stack from @tao/ui
      ${app('render Text("hi")')}
    `)
    const warning = result.diagnostics.find(diagnostic =>
      diagnostic.message === useValidationMessages.unusedImport('Stack')
    )

    Expect(validationErrorMessages(result)).toEqual([])
    Expect(warning?.severity).toBe('warning')
    Expect(warning?.code).toBe(useValidationCodes.unusedImport)
  })

  Test(
    'treats imported shorthand item field types as used',
    checksFiles(
      {
        'Main.tao': importingApp(
          'use Name from ./Types.tao',
          `render inject ${tsFence} return null ${fence}`,
          'type Person is { Name }',
        ),
        'Types.tao': 'workspace type Name is text',
      },
      result => {
        Expect(validationErrorMessages(result)).toEqual([])
        Expect(
          result.diagnostics.some(diagnostic => diagnostic.message === useValidationMessages.unusedImport('Name')),
        ).toBe(false)
      },
    ),
  )

  Test(
    'treats an imported one-of type as used when one of its cases is referenced',
    checksFiles(
      {
        'Main.tao': importingApp(
          'use Mood from ./Mood.tao',
          'render Text("Ready")',
          `let Current = Happy
           ${stubView('Text', 'Value text')}`,
        ),
        'Mood.tao': 'workspace type Mood is one of Happy, Sad',
      },
      result => {
        Expect(validationErrorMessages(result)).toEqual([])
        Expect(
          result.diagnostics.some(diagnostic => diagnostic.message === useValidationMessages.unusedImport('Mood')),
        ).toBe(false)
      },
    ),
  )

  Test(
    'treats plural data imports referenced through their singular entity type as used',
    checksFiles(
      {
        'Main.tao': `
          use Documents from ./Schema.tao
          app Main { view Empty }
          view Editor(Document) { render Empty() }
          ${stubView('Empty')}
        `,
        'Schema.tao': 'workspace data Documents / Document { Title text }',
      },
      result => {
        Expect(validationErrorMessages(result)).toEqual([])
        Expect(
          result.diagnostics.some(diagnostic => diagnostic.message === useValidationMessages.unusedImport('Documents')),
        ).toBe(false)
      },
    ),
  )

  Test('warns about use statements after other top-level statements', async () => {
    const result = await Validator.validateCode(`
      ${app('render Text("hi")')}
      use Text from @tao/ui
    `)
    const warning = result.diagnostics.find(diagnostic => diagnostic.message === useValidationMessages.useOutOfSection)

    Expect(validationErrorMessages(result)).toEqual([])
    Expect(warning?.severity).toBe('warning')
    Expect(warning?.code).toBe(useValidationCodes.useOutOfSection)
  })

  Test('reports no organization warnings for a canonical import section', async () => {
    const result = await Validator.validateCode(`
      use Text from @tao/ui
      ${app('render Text("hi")')}
    `)

    Expect(result.diagnostics.filter(diagnostic => diagnostic.severity === 'warning')).toEqual([])
  })
})

Describe('validator: imported declaration regressions', () => {
  Test(
    'queries resolve imported plural data declarations',
    checksFiles(
      {
        'Schema.tao': 'workspace data Workspaces / Workspace { Name text }',
        'Main.tao': importingApp(
          'use Workspaces from ./Schema',
          `query Workspaces { }
           render Text("Rows: { Workspaces.Count }")`,
          stubView('Text', 'Value text'),
        ),
      },
      result => {
        Expect(validationErrorMessages(result)).toEqual([])
      },
    ),
  )
})
