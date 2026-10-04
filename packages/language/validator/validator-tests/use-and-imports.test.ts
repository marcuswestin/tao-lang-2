import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { useValidationCodes } from '../validator-src/diagnostic-codes'
import Validator from '../validator-src/validator'
import { dataValidationMessages } from '../validator-src/validators/data-validator'
import { injectionValidationMessages } from '../validator-src/validators/injections-validator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import { useValidationMessages } from '../validator-src/validators/use-validator'
import {
  accepts,
  acceptsFiles,
  acceptsFilesFrom,
  app,
  checksFiles,
  fence,
  rejectsFiles,
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
        Expect(validationErrorMessages(result)).toContain("No value named 'Name' is in scope.")
      },
    ),
  )

  Test(
    'keeps invisible same-name imports out of type scopes',
    checksFiles(
      {
        'Main.tao': importingApp(
          'use Name from ./Types.tao',
          `let DisplayName = Name "the Developer"
           render Text(DisplayName)`,
          stubView('Text', 'Value text'),
        ),
        'Types.tao': `
          type Name is text
          workspace let Name = "Visible"
        `,
      },
      result => {
        Expect(validationErrorMessages(result)).toContain("No type named 'Name' is in scope.")
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

        Expect(diagnostic?.filePath?.endsWith('/Views.tao')).toBe(true)
      },
    ),
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
    'allows a folder app declaration to be reached by a sibling sidecar without use statement',
    checksFiles(
      {
        'Main.tao': `
          folder
          ${stubApp()}
        `,
        'Main.scenarios.tao': `
          scenarios MyApp "devices" {
            scenario "phone" {
              device phone
            }
          }
        `,
      },
      result => Expect(validationErrorMessages(result)).toEqual([]),
      'Main.scenarios.tao',
    ),
  )

  // An unmarked app keeps its directory reach, so a sidecar may import it by name. `file` is the one
  // way to say otherwise, and it has to narrow that reach rather than read as "no marker at all".
  for (
    const appVisibilityCase of [
      { marker: '', title: 'lets a sidecar use an unmarked app declaration from its own directory' },
      { marker: 'file', title: 'refuses a sidecar use of a file-private app declaration' },
    ]
  ) {
    Test(
      appVisibilityCase.title,
      checksFiles(
        {
          'Main.tao': `
            ${appVisibilityCase.marker}
            ${stubApp()}
          `,
          'Main.scenarios.tao': `
            use MyApp from ./Main.tao

            scenarios MyApp "devices" {
              scenario "phone" {
                device phone
                run MyApp
              }
            }
          `,
        },
        result => {
          const errors = validationErrorMessages(result)
          if (appVisibilityCase.marker === 'file') {
            Expect(errors.some(message => message.includes("named 'MyApp'"))).toBe(true)
          } else {
            Expect(errors).toEqual([])
          }
        },
        'Main.scenarios.tao',
      ),
    )
  }

  // Once sources are grouped into folders, the app a sidecar runs is declared in an ancestor
  // directory rather than beside it.
  Test(
    'lets a test sidecar in a subfolder run an app declared in an ancestor directory',
    acceptsFilesFrom('ui/Main.test.tao', {
      'Main.tao': stubApp().replace('app MyApp', 'workspace app MyApp'),
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

  // REMOVAL CANDIDATE: the imported nested app is unused; this retains its availability from a test entry.
  Test(
    'lets test sidecars import a visible app from a nested file',
    acceptsFilesFrom(
      'Main.test.tao',
      {
        'Main.test.tao': `
          use MyApp from ./
          use OtherApp, OtherView from ./nested/Other.tao
          test "sidecar smoke" {
            test "renders" {
              run MyApp
              expect text "Hello"
            }
          }
        `,
        'Main.tao': stubApp(),
        'nested/Other.tao': `
          workspace app OtherApp { view OtherView }
          ${visibleView('OtherView')}
        `,
      },
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
    'keeps a plural data import unused and its singular entity type unavailable',
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
        Expect(validationErrorMessages(result)).toContain(typeValidationMessages.unknownType('Document'))
        Expect(
          result.diagnostics.some(diagnostic => diagnostic.message === useValidationMessages.unusedImport('Documents')),
        ).toBe(true)
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
          `query Workspaces = Workspaces with { }
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

Describe('validator: explicit data import forms', () => {
  const schema = 'workspace data Workspaces / Workspace { Name text }'

  Test(
    'imports a singular entity for type references and creates',
    acceptsFiles({
      'Main.tao': importingApp(
        'use Workspace from ./Schema.tao',
        'render Text("Ready")',
        `view Editor(Workspace) { render Text(Workspace.Name) }
         fixture Starter { Home = create Workspace { Name: "Home" } }
         ${stubView('Text', 'Value text')}`,
      ),
      'Schema.tao': schema,
    }),
  )

  Test(
    'imports both data forms from a named package',
    acceptsFiles({
      'Main.tao': importingApp(
        'use Workspaces, Workspace from @records',
        'query Workspaces = Workspaces with { } render Text("Rows: { Workspaces.Count }")',
        `view Editor(Workspace) { render Text(Workspace.Name) }
         ${stubView('Text', 'Value text')}`,
      ),
      'Packages/@records/Schema.tao': schema,
    }),
  )

  for (const name of ['Workspaces', 'Workspace']) {
    Test(
      `diagnoses a duplicate ${name} import in one statement`,
      rejectsFiles({
        'Main.tao': importingApp(
          `use ${name}, ${name} from ./Schema.tao`,
          'render Text("Ready")',
          stubView('Text', 'Value text'),
        ),
        'Schema.tao': schema,
      }, useValidationMessages.duplicateImport(name)),
    )
  }

  Test(
    'keeps the plural collection unavailable after a singular-only import',
    rejectsFiles({
      'Main.tao': importingApp(
        'use Workspace from ./Schema.tao',
        'query Workspaces = Workspaces with { } render Text("Ready")',
        stubView('Text', 'Value text'),
      ),
      'Schema.tao': schema,
    }, dataValidationMessages.querySource),
  )

  Test(
    'requires the singular import for a create even when the plural is imported',
    rejectsFiles({
      'Main.tao': importingApp(
        'use Workspaces from ./Schema.tao',
        'query Workspaces = Workspaces with { } render Text("Ready")',
        `fixture Starter { Home = create Workspace { Name: "Home" } }
         ${stubView('Text', 'Value text')}`,
      ),
      'Schema.tao': schema,
    }, "No data entity named 'Workspace' is in scope."),
  )

  Test(
    'imports both forms with ordinary commas',
    checksFiles({
      'Main.tao': importingApp(
        'use Workspaces, Workspace from ./Schema.tao',
        'query Workspaces = Workspaces with { } render Text("Rows: { Workspaces.Count }")',
        `view Editor(Workspace) { render Text(Workspace.Name) }
         ${stubView('Text', 'Value text')}`,
      ),
      'Schema.tao': schema,
    }, result => {
      Expect(validationErrorMessages(result)).toEqual([])
      Expect(result.diagnostics.filter(diagnostic => diagnostic.code === useValidationCodes.unusedImport)).toEqual([])
    }),
  )

  Test(
    'needs only the plural import for a local singular loop binder',
    acceptsFiles({
      'Main.tao': importingApp(
        'use Col from @tao/ui\nuse Workspaces from ./Schema.tao',
        'query Workspaces = Workspaces with { } render Col() { loop Workspaces / Workspace { Text(Workspace.Name) } }',
        stubView('Text', 'Value text'),
      ),
      'Schema.tao': schema,
    }),
  )

  Test(
    'keeps an explicit singular import unused when only a local loop binder has that name',
    checksFiles({
      'Main.tao': importingApp(
        'use Col from @tao/ui\nuse Workspaces, Workspace from ./Schema.tao',
        'query Workspaces = Workspaces with { } render Col() { loop Workspaces / Workspace { Text(Workspace.Name) } }',
        stubView('Text', 'Value text'),
      ),
      'Schema.tao': schema,
    }, result => {
      Expect(validationErrorMessages(result)).toEqual([])
      Expect(
        result.diagnostics.filter(diagnostic => diagnostic.code === useValidationCodes.unusedImport)
          .map(diagnostic => diagnostic.message),
      ).toEqual([useValidationMessages.unusedImport('Workspace')])
    }),
  )

  Test(
    'keeps both forms implicitly visible for folder data declarations',
    acceptsFiles({
      'Main.tao': importingApp(
        '',
        'query Workspaces = Workspaces with { } render Text("Rows: { Workspaces.Count }")',
        `view Editor(Workspace) { render Text(Workspace.Name) }
         fixture Starter { Home = create Workspace { Name: "Home" } }
         ${stubView('Text', 'Value text')}`,
      ),
      'Schema.tao': schema.replace('workspace ', 'folder '),
    }),
  )

  Test(
    'resolves file-local data before same-name folder declarations in every data scope',
    checksFiles({
      'Main.tao': importingApp(
        '',
        'query Workspaces = Workspaces with { order by LocalName } render Text("Rows: { Workspaces.Count }")',
        `file data Workspaces / Workspace { LocalName text }
         view Editor(Workspace) { render Text(Workspace.LocalName) }
         fixture Starter { Home = create Workspace { LocalName: "Home" } }
         ${stubView('Text', 'Value text')}`,
      ),
      'Schema.tao': 'folder data Workspaces / Workspace { SiblingName text }',
    }, result => {
      Expect(validationErrorMessages(result)).toEqual([])
      const root = result.entry.ast
      const local = root.statements.find(AST.isEntityDataDeclaration)
      Expect.Is(local, AST.isEntityDataDeclaration)
      const contents = [...AST.streamAllContents(root)]
      const query = contents.find(AST.isEntityQueryDeclaration)
      Expect.Is(query, AST.isEntityQueryDeclaration)
      const reference = contents.filter(AST.isNamedTypeReference).find(type => type.root === 'Workspace')
      Expect.Is(reference, AST.isNamedTypeReference)
      const create = contents.find(AST.isFixtureCreateBinding)
      Expect.Is(create, AST.isFixtureCreateBinding)
      Expect(Type.queryEntity(query)).toBe(local)
      Expect(Type.entityOfReference(reference)).toBe(local)
      Expect(create.entity.ref).toBe(local)
      Expect(
        Type.visibleDataEntities(root).map(entity =>
          entity.block.entries.filter(AST.isEntityDataField).map(field => field.name)
        ),
      ).toEqual([['LocalName'], ['SiblingName']])
      const declarations = AST.visibleFileDeclarations(root, AST.isEntityDataDeclaration)
      Expect(declarations).toHaveLength(2)
      Type.visibleDataEntities(root).forEach((entity, index) => Expect(declarations[index]).toBe(entity))
    }),
  )

  for (const field of ['Owner Workspace', 'Workspace']) {
    Test(
      `requires the singular import for the relation field ${field}`,
      rejectsFiles({
        'Main.tao': importingApp(
          'use Workspaces from ./Schema.tao',
          'render Text("Ready")',
          `data Notes / Note { ${field} }
${stubView('Text', 'Value text')}`,
        ),
        'Schema.tao': schema,
      }, dataValidationMessages.unknownRelation('Note', 'Workspace')),
    )

    Test(
      `resolves the singular import for the relation field ${field}`,
      checksFiles({
        'Main.tao': importingApp(
          'use Workspace from ./Schema.tao',
          'render Text("Ready")',
          `data Notes / Note { ${field} }
${stubView('Text', 'Value text')}`,
        ),
        'Schema.tao': schema,
      }, result => {
        Expect(validationErrorMessages(result)).toEqual([])
        Expect(result.diagnostics.filter(diagnostic => diagnostic.code === useValidationCodes.unusedImport)).toEqual([])
      }),
    )
  }

  Test(
    'reads a related boolean case through an imported entity without importing its related target',
    acceptsFiles({
      'Main.tao': importingApp(
        'use Workspace from ./Schema/Workspaces.tao',
        'render Text("Ready")',
        `view Editor(Workspace) {
           let OwnerActive = Workspace.Owner.Active is Active
           render Text("{ OwnerActive }")
         }
         ${stubView('Text', 'Value text')}`,
      ),
      'Schema/Workspaces.tao': `
        use Person from ./People.tao
        workspace data Workspaces / Workspace { Owner Person }
      `,
      'Schema/People.tao': 'workspace data People / Person { Active yes / Inactive no }',
    }),
  )

  Test(
    'imports a plural inverse relation with its singular backreference imported by the target schema',
    checksFiles({
      'Main.tao': importingApp(
        'use Workspaces from ./Schema.tao',
        'render Text("Ready")',
        `workspace data Notes / Note { Workspaces }
         ${stubView('Text', 'Value text')}`,
      ),
      'Schema.tao': `
        use Note from ./Main.tao
        workspace data Workspaces / Workspace { Note }
      `,
    }, result => {
      Expect(validationErrorMessages(result)).toEqual([])
      Expect(result.diagnostics.filter(diagnostic => diagnostic.code === useValidationCodes.unusedImport)).toEqual([])
    }),
  )

  Test(
    'requires the plural import for an inverse relation field',
    rejectsFiles({
      'Main.tao': importingApp(
        'use Workspace from ./Schema.tao',
        'render Text("Ready")',
        `data Notes / Note { Workspaces }
${stubView('Text', 'Value text')}`,
      ),
      'Schema.tao': schema,
    }, dataValidationMessages.unknownRelation('Note', 'Workspaces')),
  )

  Test(
    'preserves contextual auth Account values when only the account collection is imported',
    acceptsFiles({
      'Main.tao': importingApp(
        'use Account from @tao/auth\nuse Accounts from ./Schema.tao',
        'render Text(Account.DisplayName)',
        stubView('Text', 'Value text'),
      ),
      'Schema.tao': 'workspace data Accounts / Account { DisplayName text }',
    }),
  )

  for (const imported of ['Account', 'Accounts']) {
    Test(
      `requires a singular entity import for access declarations with ${imported} imported`,
      checksFiles({
        // Access rules need an Auth to enforce them, so the app binds one.
        'Main.tao': `use ${imported} from ./Schema.tao
use TestAuth from @tao/auth/testing
app MyApp { Auth TestAuth { } view MainView }
view MainView() { render Text("Ready") }
access Account { Account can read }
${stubView('Text', 'Value text')}`,
        'Schema.tao': 'workspace data Accounts / Account { DisplayName text }',
      }, result => {
        if (imported === 'Account') {
          Expect(validationErrorMessages(result)).toEqual([])
        } else {
          Expect(validationErrorMessages(result)).toContain("No data entity named 'Account' is in scope.")
        }
      }),
    )
  }

  Test(
    'diagnoses a repeated singular import',
    rejectsFiles({
      'Main.tao': importingApp(
        'use Workspace from ./Schema.tao\nuse Workspace from ./Schema.tao',
        'render Text("Ready")',
        stubView('Text', 'Value text'),
      ),
      'Schema.tao': schema,
    }, useValidationMessages.repeatedImport('Workspace')),
  )

  Test(
    'diagnoses collisions between imported singular forms',
    rejectsFiles({
      'Main.tao': importingApp('use Workspace from ./Schemas', 'render Text("Ready")', stubView('Text', 'Value text')),
      'Schemas/First.tao': schema,
      'Schemas/Second.tao': 'workspace data OtherWorkspaces / Workspace { Name text }',
    }, useValidationMessages.ambiguousImport('Workspace', './Schemas')),
  )

  Test(
    'diagnoses collisions between imported and local singular types',
    rejectsFiles({
      'Main.tao': importingApp(
        'use Workspace from ./Schema.tao',
        'render Text("Ready")',
        `type Workspace is text
${stubView('Text', 'Value text')}`,
      ),
      'Schema.tao': schema,
    }, useValidationMessages.localDeclarationCollision('Workspace')),
  )

  Test(
    'keeps a collection and a different entity with the same spelling in separate namespaces',
    acceptsFiles({
      'Main.tao': importingApp(
        'use Entries from ./Schema.tao',
        'query Entries = Entries with { } render Text("Rows: { Entries.Count }")',
        `view Editor(Entries) { render Text(Entries.Label) }
         ${stubView('Text', 'Value text')}`,
      ),
      'Schema.tao': `workspace data Entries / Entry { Name text }
                     workspace data Groups / Entries { Label text }`,
    }),
  )
})
