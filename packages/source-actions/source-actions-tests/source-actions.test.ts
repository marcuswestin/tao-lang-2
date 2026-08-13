import { FS, Text } from '@shared'
import { Describe, Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'
import SourceActions from '../source-actions-src/source-actions'
import {
  parseDocument,
  parseRawDocument,
  parseRawDocumentAt,
  sourceActionOptionsFor,
  testOrganizeSource,
  testOrganizeSourceUnchanged,
} from './test-source-actions'

Describe('organizeSource use statements', () => {
  Test('produces no edit for an already organized file', async () => {
    await testOrganizeSourceUnchanged(`
      use Stack, Text from @tao/ui

      app MyApp {
         view MainView
      }

      view MainView {
         render Stack() {
            Text("hi")
      }  }
    `)
  })

  Test('merges duplicate imports from the same source', async () => {
    await testOrganizeSource(
      `
        use Text from @tao/ui
        use Row from @tao/ui
        use Text from @tao/ui
        view MainView {
           render Row() {
              Text("hi")
        }  }
      `,
      `
        use Row, Text from @tao/ui

        view MainView {
           render Row() {
              Text("hi")
        }  }
      `,
    )
  })

  Test('removes unused imported symbols', async () => {
    await testOrganizeSource(
      `
        use Text, Row, Button from @tao/ui
        view MainView {
           render Text("hi")
        }
      `,
      `
        use Text from @tao/ui

        view MainView {
           render Text("hi")
        }
      `,
    )
  })

  Test('drops use statements whose imports are all unused', async () => {
    await testOrganizeSource(
      `
        use Button from @tao/ui
        view MainView { }
      `,
      `
        view MainView { }
      `,
    )
  })

  Test('sorts imports with package sources before relative sources', async () => {
    await testOrganizeSource(
      `
        use Two from ./z-local
        use One from ./a-local
        use Text from @tao/ui
        let First = One
        let Second = Two
        view MainView {
           render Text("hi")
        }
      `,
      `
        use Text from @tao/ui
        use One from ./a-local
        use Two from ./z-local

        let First = One
        let Second = Two

        view MainView {
           render Text("hi")
        }
      `,
    )
  })

  Test('sorts imported symbols alphabetically within each import', async () => {
    await testOrganizeSource(
      `
        use Text, Stack, Row from @tao/ui
        view MainView {
           render Stack() {
              Row() {
                 Text("hi")
        }  }  }
      `,
      `
        use Row, Stack, Text from @tao/ui

        view MainView {
           render Stack() {
              Row() {
                 Text("hi")
        }  }  }
      `,
    )
  })

  Test('keeps unresolved imports when organizing source', async () => {
    await testOrganizeSource(
      `
        view MainView { }
        use Missing from ./missing
      `,
      `
        use Missing from ./missing

        view MainView { }
      `,
    )
  })
})

Describe('organizeSource canonical statement order', () => {
  Test('moves use statements above other top-level statements', async () => {
    await testOrganizeSource(
      `
        app MyApp {
           view MainView
        }
        use Text from @tao/ui
        view MainView {
           render Text("hi")
        }
      `,
      `
        use Text from @tao/ui

        app MyApp {
           view MainView
        }

        view MainView {
           render Text("hi")
        }
      `,
    )
  })

  Test('moves app declarations after imports and keeps other statements after the app', async () => {
    await testOrganizeSource(
      `
        let Greeting = "hi"
        app MyApp {
           view MainView
        }
        use Text from @tao/ui
        view MainView {
           render Text(Greeting)
        }
      `,
      `
        use Text from @tao/ui

        app MyApp {
           view MainView
        }

        let Greeting = "hi"

        view MainView {
           render Text(Greeting)
        }
      `,
    )
  })

  Test('moves project metadata after imports and before the app', async () => {
    await testOrganizeSource(
      `
        app MyApp { view MainView }
        view MainView { render Text("hi") }
        use Text from @tao/ui
        project {
           name "My App"
           remote none
           license MIT
        }
      `,
      `
        use Text from @tao/ui

        project {
           name "My App"
           remote none
           license MIT
        }

        app MyApp {
           view MainView
        }

        view MainView {
           render Text("hi")
        }
      `,
    )
  })

  Test('preserves the relative order of non-app statements', async () => {
    await testOrganizeSource(
      `
        let Second = First
        app MyApp { view MainView }
        let First = "1"
        view MainView { render Text(First) }
        use Text from @tao/ui
      `,
      `
        use Text from @tao/ui

        app MyApp {
           view MainView
        }

        let Second = First
        let First = "1"

        view MainView {
           render Text(First)
        }
      `,
    )
  })

  Test('keeps comments attached to the statements below them', async () => {
    await testOrganizeSource(
      `
        // the app
        app MyApp { view MainView }
        // @tao/ui imports
        use Text from @tao/ui
        // the main view
        view MainView { render Text("hi") }
      `,
      `
        // @tao/ui imports
        use Text from @tao/ui

        // the app
        app MyApp {
           view MainView
        }

        // the main view
        view MainView {
           render Text("hi")
        }
      `,
    )
  })

  Test('drops comments attached to imports that are removed', async () => {
    await testOrganizeSource(
      `
        // unused import
        use Button from @tao/ui
        // rendered text import
        use Text from @tao/ui
        view MainView {
           render Text("hi")
        }
      `,
      `
        // rendered text import
        use Text from @tao/ui

        view MainView {
           render Text("hi")
        }
      `,
    )
  })

  Test('drops statement comments when organizing partially pruned imports', async () => {
    await testOrganizeSource(
      `
        // unused button import
        use Text, Button from @tao/ui
        view MainView {
           render Text("hi")
        }
      `,
      `
        use Text from @tao/ui

        view MainView {
           render Text("hi")
        }
      `,
    )
  })

  Test('preserves trailing comments after the last statement', async () => {
    await testOrganizeSource(
      `
        app MyApp { view MainView }
        use Text from @tao/ui
        view MainView { render Text("hi") }
        // footer note
      `,
      `
        use Text from @tao/ui

        app MyApp {
           view MainView
        }

        view MainView {
           render Text("hi")
        }

        // footer note
      `,
    )
  })

  Test('splits same-line top-level statements safely when organizing', async () => {
    await testOrganizeSource(
      `app MyApp { view MainView } use Text from @tao/ui view MainView { render Text("hi") }`,
      `
        use Text from @tao/ui

        app MyApp {
           view MainView
        }

        view MainView {
           render Text("hi")
        }
      `,
    )
  })

  Test('produces no edit for source with syntax errors', async () => {
    const document = await parseRawDocument('view Broken {')

    Expect(await SourceActions.organizeSource(document)).toBeUndefined()
  })
})

Describe('removeUnusedImports', () => {
  Test('removes only unused names and keeps statement order', async () => {
    const document = await parseDocument(`
      use Two from ./local
      use Text, Button from @tao/ui
      view MainView {
         Two()
         render Text("hi")
      }
    `)

    Expect(await SourceActions.removeUnusedImports(document)).toBe(`${
      Text.stripIndent(`
      use Two from ./local
      use Text from @tao/ui

      view MainView {
         Two()
         render Text("hi")
      }
    `)
    }\n`)
  })

  Test('produces no edit when every import is used', async () => {
    const document = await parseDocument(`
      use Text from @tao/ui

      view MainView {
         render Text("hi")
      }
    `)

    Expect(await SourceActions.removeUnusedImports(document)).toBeUndefined()
  })

  Test('keeps app imports used by run steps', async () => {
    await withTaoFiles(
      'tao-source-actions-tests-',
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
             check "renders" {
                run MyApp

                expect text "Hello"
             }
          }
        `)
        }\n`)
      },
    )
  })

  Test('keeps unresolved imports even when they are not referenced', async () => {
    const document = await parseDocument(`
      use Missing from ./missing

      view MainView { }
    `)

    Expect(await SourceActions.removeUnusedImports(document)).toBeUndefined()
  })

  Test('drops comments attached to fully removed imports', async () => {
    const document = await parseDocument(`
      // unused import
      use Button from @tao/ui
      // kept import
      use Text from @tao/ui
      view MainView {
         render Text("hi")
      }
    `)

    Expect(await SourceActions.removeUnusedImports(document)).toBe(`${
      Text.stripIndent(`
      // kept import
      use Text from @tao/ui

      view MainView {
         render Text("hi")
      }
    `)
    }\n`)
  })

  Test('drops statement comments when partially pruning import names', async () => {
    const document = await parseDocument(`
      // unused button import
      use Text, Button from @tao/ui
      view MainView {
         render Text("hi")
      }
    `)

    Expect(await SourceActions.removeUnusedImports(document)).toBe(`${
      Text.stripIndent(`
      use Text from @tao/ui

      view MainView {
         render Text("hi")
      }
    `)
    }\n`)
  })
})

Describe('moveRendersLast', () => {
  Test('moves a render statement to the end of its view body', async () => {
    const document = await parseDocument(`
      view MainView {
         render Text(Greeting)
         let Greeting = "hi"
      }
    `)

    Expect(await SourceActions.moveRendersLast(document)).toBe(`${
      Text.stripIndent(`
      view MainView {
         let Greeting = "hi"
         render Text(Greeting)
      }
    `)
    }\n`)
  })

  Test('splits same-line view statements safely when moving renders', async () => {
    const document = await parseRawDocument('view MainView { render Text(Greeting) let Greeting = "hi" }')

    Expect(await SourceActions.moveRendersLast(document)).toBe(`${
      Text.stripIndent(`
      view MainView {
         let Greeting = "hi"
         render Text(Greeting)
      }
    `)
    }\n`)
  })

  Test('keeps comments attached when moving renders', async () => {
    const document = await parseDocument(`
      view MainView {
         // render comment
         render Text(Greeting)
         // let comment
         let Greeting = "hi"
      }
    `)

    Expect(await SourceActions.moveRendersLast(document)).toBe(`${
      Text.stripIndent(`
      view MainView {
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
      view MainView {
         // render { comment
         render Text(Greeting)
         let Greeting = "hi"
      }
    `)

    Expect(await SourceActions.moveRendersLast(document)).toBe(`${
      Text.stripIndent(`
      view MainView {
         let Greeting = "hi"
         // render { comment
         render Text(Greeting)
      }
    `)
    }\n`)
  })

  Test('produces no edit when render is already last', async () => {
    const document = await parseDocument(`
      view MainView {
         let Greeting = "hi"
         render Text(Greeting)
      }
    `)

    Expect(await SourceActions.moveRendersLast(document)).toBeUndefined()
  })

  Test('leaves views with multiple render statements to the validator', async () => {
    const document = await parseDocument(`
      view MainView {
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
      view MainView {
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

      view MainView {
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
        'public view LocalText Value is text { }\n',
      )
      const document = await parseRawDocumentAt(
        `${
          Text.stripIndent(`
          use Text from @tao/ui
          use LocalText, MissingLocal from ./Local
          view MainView {
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

        view MainView {
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
