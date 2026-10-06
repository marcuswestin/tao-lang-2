import { Workspace } from '@compiler/workspace'
import { AST } from '@parser'
import { FS, Text } from '@shared'
import { Describe, Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'
import { useValidationCodes } from '@validator/diagnostic-codes'
import { TaoCodeActionProvider } from '../source-actions-src/langium-code-actions'
import SourceActions from '../source-actions-src/source-actions'
import {
  organized,
  organizes,
  parseDocument,
  parseRawDocument,
  parseRawDocumentAt,
  sourceActionOptionsFor,
} from './test-source-actions'

Describe('organizeSource use statements', () => {
  Test(
    'merges duplicate imports from the same source',
    organizes(
      `
        use Text from @tao/ui
        use Row from @tao/ui
        use Text from @tao/ui
        view MainView() {
           render Row() {
              Text("hi")
        }  }
      `,
      `
        use Row, Text from @tao/ui

        view MainView() {
           render Row() {
              Text("hi")
        }  }
      `,
    ),
  )

  Test(
    'keeps an imported one-of type when one of its cases is referenced',
    organized(`
      use Haptic, HapticKind from @tao/device/haptic

      view MainView() {
         state Feedback = Haptic()
         action Play() {
            do Feedback.Play(Success)
      }  }
    `),
  )

  Test(
    'sorts imports with package sources before relative sources',
    organizes(
      `
        use Two from ./z-local
        use One from ./a-local
        use Text from @tao/ui
        let First = One
        let Second = Two
        view MainView() {
           render Text("hi")
        }
      `,
      `
        use Text from @tao/ui
        use One from ./a-local
        use Two from ./z-local

        let First = One
        let Second = Two

        view MainView() {
           render Text("hi")
        }
      `,
    ),
  )

  Test(
    'keeps unresolved imports when organizing source',
    organizes(
      `
        view MainView() { }
        use Missing from ./missing
      `,
      `
        use Missing from ./missing

        view MainView() { }
      `,
    ),
  )
})

Describe('organizeSource canonical statement order', () => {
  Test(
    'moves package publication after imports and before the app',
    organizes(
      `
        app MyApp { view MainView }
        view MainView() { render Text("hi") }
        use Text from @tao/ui
        package {
           name "My App"
           version 1.0.0
           license MIT
        }
      `,
      `
        use Text from @tao/ui

        package {
           name "My App"
           version 1.0.0
           license MIT
        }

        app MyApp {
           view MainView
        }

        view MainView() {
           render Text("hi")
        }
      `,
    ),
  )

  Test(
    'preserves the relative order of non-app statements',
    organizes(
      `
        let Second = First
        app MyApp { view MainView }
        let First = "1"
        view MainView() { render Text(First) }
        use Text from @tao/ui
      `,
      `
        use Text from @tao/ui

        app MyApp {
           view MainView
        }

        let Second = First
        let First = "1"

        view MainView() {
           render Text(First)
        }
      `,
    ),
  )

  Test(
    'keeps comments attached to the statements below them',
    organizes(
      `
        // the app
        app MyApp { view MainView }
        // @tao/ui imports
        use Text from @tao/ui
        // the main view
        view MainView() { render Text("hi") }
      `,
      `
        // @tao/ui imports
        use Text from @tao/ui

        // the app
        app MyApp {
           view MainView
        }

        // the main view
        view MainView() {
           render Text("hi")
        }
      `,
    ),
  )

  Test(
    'drops comments attached to imports that are removed',
    organizes(
      `
        // unused import
        use Button from @tao/ui
        // rendered text import
        use Text from @tao/ui
        view MainView() {
           render Text("hi")
        }
      `,
      `
        // rendered text import
        use Text from @tao/ui

        view MainView() {
           render Text("hi")
        }
      `,
    ),
  )

  Test(
    'drops statement comments when organizing partially pruned imports',
    organizes(
      `
        // unused button import
        use Text, Button from @tao/ui
        view MainView() {
           render Text("hi")
        }
      `,
      `
        use Text from @tao/ui

        view MainView() {
           render Text("hi")
        }
      `,
    ),
  )

  Test(
    'preserves trailing comments after the last statement',
    organizes(
      `
        app MyApp { view MainView }
        use Text from @tao/ui
        view MainView() { render Text("hi") }
        // footer note
      `,
      `
        use Text from @tao/ui

        app MyApp {
           view MainView
        }

        view MainView() {
           render Text("hi")
        }

        // footer note
      `,
    ),
  )

  Test(
    'splits same-line top-level statements safely when organizing',
    organizes(
      `app MyApp { view MainView } use Text from @tao/ui view MainView() { render Text("hi") }`,
      `
        use Text from @tao/ui

        app MyApp {
           view MainView
        }

        view MainView() {
           render Text("hi")
        }
      `,
    ),
  )

  Test('produces no edit for source with syntax errors', async () => {
    const document = await parseRawDocument('view Broken() {')

    Expect(await SourceActions.organizeSource(document)).toBeUndefined()
  })
})

Describe('removeUnusedImports', () => {
  Test('removes only unused names and keeps statement order', async () => {
    const document = await parseDocument(`
      use Two from ./local
      use Text, Button from @tao/ui
      view MainView() {
         Two()
         render Text("hi")
      }
    `)

    Expect(await SourceActions.removeUnusedImports(document)).toBe(`${
      Text.stripIndent(`
      use Two from ./local
      use Text from @tao/ui

      view MainView() {
         Two()
         render Text("hi")
      }
    `)
    }\n`)
  })

  Test('keeps app imports used by run steps', async () => {
    await withTaoFiles(
      'tao-source-actions-tests-',
      {
        'Main.test.tao': `
        use MyApp from ./

        test "Smoke" {
          test "renders" {
            run MyApp
            expect text "Hello"
          }
        }
      `,
        'Main.tao': `
        app MyApp { view MainView }
        view MainView() {
          render inject \`\`\`ts
            return null
          \`\`\`
        }
      `,
      },
      async paths => {
        const source = await FS.readText(paths['Main.test.tao']!)
        const document = await parseRawDocumentAt(source, paths['Main.test.tao']!)

        Expect(await SourceActions.removeUnusedImports(document)).toBe(`${
          Text.stripIndent(`
          use MyApp from ./

          test "Smoke" {
             test "renders" {
                run MyApp

                expect text "Hello"
             }
          }
        `)
        }\n`)
      },
    )
  })

  for (
    const example of [
      {
        name: 'both explicit forms when both are used',
        imports: 'Documents, Document',
        body: 'view Editor(Document) { query Documents = Documents with { } render Empty(Document.Title) }',
        kept: ['Document', 'Documents'],
      },
      {
        name: 'singular type without the unused plural',
        imports: 'Documents, Document',
        body: 'view Editor(Document) { render Empty(Document.Title) }',
        kept: ['Document'],
      },
      {
        name: 'plural query without the unused singular',
        imports: 'Documents, Document',
        body: 'view Editor() { query Recent = Documents with { } render Empty("ok") }',
        kept: ['Documents'],
      },
      {
        name: 'plural query with a local singular loop binder',
        imports: 'Documents, Document',
        body: `view Editor() {
        query Documents = Documents with { }
        render Col() { loop Documents / Document { Empty(Document.Title) } }
      }`,
        kept: ['Documents'],
      },
      {
        name: 'singular import used by a named data field type',
        imports: 'Documents, Document',
        body: 'data Links / Link { Owner Document }',
        kept: ['Document'],
      },
      {
        name: 'singular import used by an implicit data field type',
        imports: 'Documents, Document',
        body: 'data Links / Link { Document }',
        kept: ['Document'],
      },
      {
        name: 'plural import used by an inverse data field',
        imports: 'Documents, Document',
        body: 'data Folders / Folder { Documents }',
        kept: ['Documents'],
      },
      {
        name: 'no singular import for a primitive data field with the same name',
        imports: 'Document',
        body: 'data Links / Link { Document text }',
        kept: [],
      },
      {
        name: 'no singular import for a local same-name parameter',
        imports: 'Document',
        body: 'view Editor(Document text) { render Empty(Document) }',
        kept: [],
      },
      {
        name: 'no singular import for a local same-name alias',
        imports: 'Document',
        body: 'view Editor() { let Document = "local" render Empty(Document) }',
        kept: [],
      },
      {
        name: 'neither unused form',
        imports: 'Documents, Document',
        body: 'view Editor() { render Empty("ok") }',
        kept: [],
      },
    ]
  ) {
    Test(`removeUnusedImports keeps ${example.name}`, async () => {
      await withTaoFiles('tao-source-actions-data-import-', {
        'Main.tao': `
          use ${example.imports} from ./Schema.tao
          ${example.body}
          view Empty(Value text) { render inject \`\`\`ts return null \`\`\` }
          view Col() { render inject Content @@content \`\`\`ts return Content \`\`\` }
        `,
        'Schema.tao': 'project data Documents / Document { Title text }',
      }, async paths => {
        const source = await FS.readText(paths['Main.tao']!)
        const document = await parseRawDocumentAt(source, paths['Main.tao']!)
        Expect(document.parseResult.lexerErrors).toEqual([])
        Expect(document.parseResult.parserErrors).toEqual([])
        const uses = document.parseResult.value.statements.filter(AST.isUseStatement)
        Expect(uses[0]!.importedDeclarations.every(specifier => specifier.target.ref !== undefined)).toBe(true)
        if (example.name.includes('loop binder')) {
          const references = AST.streamAllContents(document.parseResult.value)
            .filter(AST.isMemberAccessExpression)
          Expect(references.some(reference => AST.isForStatement(reference.target.ref))).toBe(true)
        }
        if (example.name.includes('local same-name')) {
          const reference = AST.streamAllContents(document.parseResult.value)
            .filter(AST.isValueReference).find(reference => reference.target.$refText === 'Document')
          Expect(reference?.target.ref).toBeDefined()
          Expect(AST.findRoot(reference!.target.ref!)).toBe(document.parseResult.value)
        }
        const updated = await SourceActions.removeUnusedImports(document) ?? source
        const reparsed = await parseRawDocumentAt(updated, paths['Main.tao']!)
        const imports = reparsed.parseResult.value.statements.filter(AST.isUseStatement)
          .flatMap(statement => statement.importedDeclarations.map(AST.importSourceName))
        Expect(imports.toSorted()).toEqual(example.kept)
        Expect(await SourceActions.removeUnusedImports(reparsed)).toBeUndefined()
      })
    })
  }

  Test('unused-import quickfix removes only the unused data form', async () => {
    await withTaoFiles('tao-source-actions-data-quickfix-', {
      'Main.tao': `
        use Documents, Document from ./Schema.tao
        view Editor(Document) { render inject \`\`\`ts return null \`\`\` }
      `,
      'Schema.tao': 'project data Documents / Document { Title text }',
    }, async paths => {
      const validated = await Workspace.validate(paths['Main.tao']!)
      const document = validated.entry.document
      const unused = validated.diagnostics.filter(diagnostic => diagnostic.code === useValidationCodes.unusedImport)
        .map(diagnostic => ({ code: diagnostic.code, message: diagnostic.message, range: diagnostic.range! }))
      Expect(unused).toHaveLength(1)
      const actions = await new TaoCodeActionProvider().getCodeActions(document, {
        textDocument: { uri: document.uri.toString() },
        range: unused[0]!.range,
        context: { diagnostics: unused, only: ['quickfix'] },
      })
      Expect(actions).toHaveLength(1)
      Expect(actions[0]!.title).toBe('Tao: Remove unused imports')
      const edit = actions[0]!.edit!.changes![document.uri.toString()]![0]!
      Expect(edit.newText).toContain('use Document from ./Schema.tao')
      Expect(edit.newText).not.toContain('use Documents')
    })
  })

  Test('keeps same-name declarations inferred by bare app property configurations', async () => {
    await withTaoFiles(
      'tao-source-actions-inferred-app-property-',
      {
        'Main.tao': `
        use Navigator from ./Navigation.tao

        app Demo {
          Name "Demo"
          Navigator { Initial Home }
        }

        view Home() {
          render Empty()
        }

        view Empty() {
          render inject \`\`\`ts
            return null
          \`\`\`
        }
      `,
        'Navigation.tao': `
        public type Navigator is nav with {
          Initial view

          nav TestNavKind from ./TestNav.ts
        }
      `,
      },
      async paths => {
        const source = await FS.readText(paths['Main.tao']!)
        const document = await parseRawDocumentAt(source, paths['Main.tao']!)

        const updated = await SourceActions.removeUnusedImports(document)
        Expect(updated ?? source).toContain('use Navigator from ./Navigation.tao')
        Expect(await SourceActions.fixSource(document, await sourceActionOptionsFor(document))).toContain(
          'use Navigator from ./Navigation.tao',
        )
      },
    )
  })

  Test('keeps unresolved imports even when they are not referenced', async () => {
    const document = await parseDocument(`
      use Missing from ./missing

      view MainView() { }
    `)

    Expect(await SourceActions.removeUnusedImports(document)).toBeUndefined()
  })

  Test('drops comments attached to fully removed imports', async () => {
    const document = await parseDocument(`
      // unused import
      use Button from @tao/ui
      // kept import
      use Text from @tao/ui
      view MainView() {
         render Text("hi")
      }
    `)

    Expect(await SourceActions.removeUnusedImports(document)).toBe(`${
      Text.stripIndent(`
      // kept import
      use Text from @tao/ui

      view MainView() {
         render Text("hi")
      }
    `)
    }\n`)
  })

  Test('drops statement comments when partially pruning import names', async () => {
    const document = await parseDocument(`
      // unused button import
      use Text, Button from @tao/ui
      view MainView() {
         render Text("hi")
      }
    `)

    Expect(await SourceActions.removeUnusedImports(document)).toBe(`${
      Text.stripIndent(`
      use Text from @tao/ui

      view MainView() {
         render Text("hi")
      }
    `)
    }\n`)
  })
})

Describe('moveRendersLast', () => {
  Test('moves render statements to the end of plain and responds-declaring view bodies', async () => {
    const document = await parseDocument(`
      type Answer is one of Confirmed
      view Home() {
         render Text(Greeting)
         let Greeting = "Home"
      }
      view Confirm() responds Answer {
         render Text(Prompt)
         let Prompt = "Continue?"
      }
    `)

    Expect(await SourceActions.moveRendersLast(document)).toBe(`${
      Text.stripIndent(`
      type Answer is one of Confirmed

      view Home() {
         let Greeting = "Home"
         render Text(Greeting)
      }

      view Confirm() responds Answer {
         let Prompt = "Continue?"
         render Text(Prompt)
      }
    `)
    }\n`)
  })

  Test('splits same-line view statements safely when moving renders', async () => {
    const document = await parseRawDocument('view MainView() { render Text(Greeting) let Greeting = "hi" }')

    Expect(await SourceActions.moveRendersLast(document)).toBe(`${
      Text.stripIndent(`
      view MainView() {
         let Greeting = "hi"
         render Text(Greeting)
      }
    `)
    }\n`)
  })

  Test('keeps comments attached when moving renders', async () => {
    const document = await parseDocument(`
      view MainView() {
         // render comment
         render Text(Greeting)
         // let comment
         let Greeting = "hi"
      }
    `)

    Expect(await SourceActions.moveRendersLast(document)).toBe(`${
      Text.stripIndent(`
      view MainView() {
         // let comment
         let Greeting = "hi"
         // render comment
         render Text(Greeting)
      }
    `)
    }\n`)
  })

  Test('keeps leading render comments that contain braces attached when moving renders', async () => {
    const document = await parseDocument(`
      view MainView() {
         // render { comment
         render Text(Greeting)
         let Greeting = "hi"
      }
    `)

    Expect(await SourceActions.moveRendersLast(document)).toBe(`${
      Text.stripIndent(`
      view MainView() {
         let Greeting = "hi"
         // render { comment
         render Text(Greeting)
      }
    `)
    }\n`)
  })

  Test('produces no edit when render is already last', async () => {
    const document = await parseDocument(`
      view MainView() {
         let Greeting = "hi"
         render Text(Greeting)
      }
    `)

    Expect(await SourceActions.moveRendersLast(document)).toBeUndefined()
  })

  Test('leaves views with multiple render statements to the validator', async () => {
    const document = await parseDocument(`
      view MainView() {
         render Text("one")
         render Text("two")
      }
    `)

    Expect(await SourceActions.moveRendersLast(document)).toBeUndefined()
  })
})

Describe('fixSource', () => {
  Test('applies render moves, import organization, and formatting together', async () => {
    const document = await parseDocument(`
      app   MyApp { view MainView }
      use Text,Button from @tao/ui
      view MainView() {
         render Text(Greeting)
         let Greeting = "hi"
      }
    `)
    const fixed = await SourceActions.fixSource(document, await sourceActionOptionsFor(document))

    Expect(fixed).toBe(`${
      Text.stripIndent(`
      use Text from @tao/ui

      app MyApp {
         view MainView
      }

      view MainView() {
         let Greeting = "hi"
         render Text(Greeting)
      }
    `)
    }\n`)
    const fixedDocument = await parseRawDocument(fixed)
    Expect(await SourceActions.fixSource(fixedDocument, await sourceActionOptionsFor(fixedDocument))).toBe(fixed)
  })

  Test('uses the source file URI when fixing files with relative imports after render moves', async () => {
    const tmpDir = await mkTestDir('tao-source-actions-')
    try {
      await FS.writeText(
        FS.resolvePath('Local.tao', tmpDir),
        'public view LocalText(Value text) { }\n',
      )
      const document = await parseRawDocumentAt(
        `${
          Text.stripIndent(`
          use Text from @tao/ui
          use LocalText, MissingLocal from ./Local
          view MainView() {
             render Text(Greeting)
             let Greeting = "hi"
          }
        `)
        }\n`,
        FS.resolvePath('Main.tao', tmpDir),
      )

      Expect(await SourceActions.fixSource(document, await sourceActionOptionsFor(document))).toBe(`${
        Text.stripIndent(`
        use Text from @tao/ui
        use MissingLocal from ./Local

        view MainView() {
           let Greeting = "hi"
           render Text(Greeting)
        }
      `)
      }\n`)
    } finally {
      await FS.remove(tmpDir)
    }
  })
})
