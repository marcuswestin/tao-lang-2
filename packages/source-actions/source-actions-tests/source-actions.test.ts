import { FS, Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
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
         ui MainView
      }

      ui MainView {
         render Stack {
            Text "hi"
      }  }
    `)
  })

  Test('merges duplicate imports from the same source', async () => {
    await testOrganizeSource(
      `
        use Text from @tao/ui
        use Row from @tao/ui
        use Text from @tao/ui
        ui MainView {
           render Row {
              Text "hi"
        }  }
      `,
      `
        use Row, Text from @tao/ui

        ui MainView {
           render Row {
              Text "hi"
        }  }
      `,
    )
  })

  Test('removes unused imported symbols', async () => {
    await testOrganizeSource(
      `
        use Text, Row, Button from @tao/ui
        ui MainView {
           render Text "hi"
        }
      `,
      `
        use Text from @tao/ui

        ui MainView {
           render Text "hi"
        }
      `,
    )
  })

  Test('drops use statements whose imports are all unused', async () => {
    await testOrganizeSource(
      `
        use Button from @tao/ui
        ui MainView { }
      `,
      `
        ui MainView { }
      `,
    )
  })

  Test('sorts imports with package sources before relative sources', async () => {
    await testOrganizeSource(
      `
        use Two from ./z-local
        use One from ./a-local
        use Text from @tao/ui
        alias First = One
        alias Second = Two
        ui MainView {
           render Text "hi"
        }
      `,
      `
        use Text from @tao/ui
        use One from ./a-local
        use Two from ./z-local

        alias First = One
        alias Second = Two

        ui MainView {
           render Text "hi"
        }
      `,
    )
  })

  Test('sorts imported symbols alphabetically within each import', async () => {
    await testOrganizeSource(
      `
        use Text, Stack, Row from @tao/ui
        ui MainView {
           render Stack {
              Row {
                 Text "hi"
        }  }  }
      `,
      `
        use Row, Stack, Text from @tao/ui

        ui MainView {
           render Stack {
              Row {
                 Text "hi"
        }  }  }
      `,
    )
  })

  Test('keeps unresolved imports when organizing source', async () => {
    await testOrganizeSource(
      `
        ui MainView { }
        use Missing from ./missing
      `,
      `
        use Missing from ./missing

        ui MainView { }
      `,
    )
  })
})

Describe('organizeSource canonical statement order', () => {
  Test('moves use statements above other top-level statements', async () => {
    await testOrganizeSource(
      `
        app MyApp {
           ui MainView
        }
        use Text from @tao/ui
        ui MainView {
           render Text "hi"
        }
      `,
      `
        use Text from @tao/ui

        app MyApp {
           ui MainView
        }

        ui MainView {
           render Text "hi"
        }
      `,
    )
  })

  Test('moves app declarations after imports and keeps other statements after the app', async () => {
    await testOrganizeSource(
      `
        alias Greeting = "hi"
        app MyApp {
           ui MainView
        }
        use Text from @tao/ui
        ui MainView {
           render Text Greeting
        }
      `,
      `
        use Text from @tao/ui

        app MyApp {
           ui MainView
        }

        alias Greeting = "hi"

        ui MainView {
           render Text Greeting
        }
      `,
    )
  })

  Test('moves project metadata after imports and before the app', async () => {
    await testOrganizeSource(
      `
        app MyApp { ui MainView }
        ui MainView { render Text "hi" }
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
           ui MainView
        }

        ui MainView {
           render Text "hi"
        }
      `,
    )
  })

  Test('preserves the relative order of non-app statements', async () => {
    await testOrganizeSource(
      `
        alias Second = First
        app MyApp { ui MainView }
        alias First = "1"
        ui MainView { render Text First }
        use Text from @tao/ui
      `,
      `
        use Text from @tao/ui

        app MyApp {
           ui MainView
        }

        alias Second = First
        alias First = "1"

        ui MainView {
           render Text First
        }
      `,
    )
  })

  Test('keeps comments attached to the statements below them', async () => {
    await testOrganizeSource(
      `
        // the app
        app MyApp { ui MainView }
        // ui imports
        use Text from @tao/ui
        // the main view
        ui MainView { render Text "hi" }
      `,
      `
        // ui imports
        use Text from @tao/ui

        // the app
        app MyApp {
           ui MainView
        }

        // the main view
        ui MainView {
           render Text "hi"
        }
      `,
    )
  })

  Test('preserves trailing comments after the last statement', async () => {
    await testOrganizeSource(
      `
        app MyApp { ui MainView }
        use Text from @tao/ui
        ui MainView { render Text "hi" }
        // footer note
      `,
      `
        use Text from @tao/ui

        app MyApp {
           ui MainView
        }

        ui MainView {
           render Text "hi"
        }

        // footer note
      `,
    )
  })

  Test('splits same-line top-level statements safely when organizing', async () => {
    await testOrganizeSource(
      `app MyApp { ui MainView } use Text from @tao/ui ui MainView { render Text "hi" }`,
      `
        use Text from @tao/ui

        app MyApp {
           ui MainView
        }

        ui MainView {
           render Text "hi"
        }
      `,
    )
  })

  Test('produces no edit for source with syntax errors', async () => {
    const document = await parseRawDocument('ui Broken {')

    Expect(await SourceActions.organizeSource(document)).toBeUndefined()
  })
})

Describe('removeUnusedImports', () => {
  Test('removes only unused names and keeps statement order', async () => {
    const document = await parseDocument(`
      use Two from ./local
      use Text, Button from @tao/ui
      ui MainView {
         Two
         render Text "hi"
      }
    `)

    Expect(await SourceActions.removeUnusedImports(document)).toBe(`${
      Text.stripIndent(`
      use Two from ./local
      use Text from @tao/ui

      ui MainView {
         Two
         render Text "hi"
      }
    `)
    }\n`)
  })

  Test('produces no edit when every import is used', async () => {
    const document = await parseDocument(`
      use Text from @tao/ui

      ui MainView {
         render Text "hi"
      }
    `)

    Expect(await SourceActions.removeUnusedImports(document)).toBeUndefined()
  })

  Test('keeps unresolved imports even when they are not referenced', async () => {
    const document = await parseDocument(`
      use Missing from ./missing

      ui MainView { }
    `)

    Expect(await SourceActions.removeUnusedImports(document)).toBeUndefined()
  })
})

Describe('moveRendersLast', () => {
  Test('moves a render statement to the end of its view body', async () => {
    const document = await parseDocument(`
      ui MainView {
         render Text Greeting
         alias Greeting = "hi"
      }
    `)

    Expect(await SourceActions.moveRendersLast(document)).toBe(`${
      Text.stripIndent(`
      ui MainView {
         alias Greeting = "hi"
         render Text Greeting
      }
    `)
    }\n`)
  })

  Test('splits same-line view statements safely when moving renders', async () => {
    const document = await parseRawDocument('ui MainView { render Text Greeting alias Greeting = "hi" }')

    Expect(await SourceActions.moveRendersLast(document)).toBe(`${
      Text.stripIndent(`
      ui MainView {
         alias Greeting = "hi"
         render Text Greeting
      }
    `)
    }\n`)
  })

  Test('keeps comments attached when moving renders', async () => {
    const document = await parseDocument(`
      ui MainView {
         // render comment
         render Text Greeting
         // alias comment
         alias Greeting = "hi"
      }
    `)

    Expect(await SourceActions.moveRendersLast(document)).toBe(`${
      Text.stripIndent(`
      ui MainView {
         // alias comment
         alias Greeting = "hi"
         // render comment
         render Text Greeting
      }
    `)
    }\n`)
  })

  Test('keeps leading render comments that contain braces attached when moving renders', async () => {
    const document = await parseDocument(`
      ui MainView {
         // render { comment
         render Text Greeting
         alias Greeting = "hi"
      }
    `)

    Expect(await SourceActions.moveRendersLast(document)).toBe(`${
      Text.stripIndent(`
      ui MainView {
         alias Greeting = "hi"
         // render { comment
         render Text Greeting
      }
    `)
    }\n`)
  })

  Test('produces no edit when render is already last', async () => {
    const document = await parseDocument(`
      ui MainView {
         alias Greeting = "hi"
         render Text Greeting
      }
    `)

    Expect(await SourceActions.moveRendersLast(document)).toBeUndefined()
  })

  Test('leaves views with multiple render statements to the validator', async () => {
    const document = await parseDocument(`
      ui MainView {
         render Text "one"
         render Text "two"
      }
    `)

    Expect(await SourceActions.moveRendersLast(document)).toBeUndefined()
  })
})

Describe('fixSource', () => {
  Test('applies render moves, import organization, and formatting together', async () => {
    const document = await parseDocument(`
      app   MyApp { ui MainView }
      use Text,Button from @tao/ui
      ui MainView {
         render Text Greeting
         alias Greeting = "hi"
      }
    `)
    const fixed = await SourceActions.fixSource(document, await sourceActionOptionsFor(document))

    Expect(fixed).toBe(`${
      Text.stripIndent(`
      use Text from @tao/ui

      app MyApp {
         ui MainView
      }

      ui MainView {
         alias Greeting = "hi"
         render Text Greeting
      }
    `)
    }\n`)
    const fixedDocument = await parseRawDocument(fixed)
    Expect(await SourceActions.fixSource(fixedDocument, await sourceActionOptionsFor(fixedDocument))).toBe(fixed)
  })

  Test('uses the source file URI when fixing files with relative imports after render moves', async () => {
    const tmpDir = await FS.mkTmpDir(FS.resolvePath('tao-source-actions-', { cwd: FS.tmpdir() }))
    try {
      await FS.writeText(
        FS.resolvePath('Local.tao', { cwd: tmpDir }),
        'publish ui LocalText Value text { }\n',
      )
      const document = await parseRawDocumentAt(
        `${
          Text.stripIndent(`
          use Text from @tao/ui
          use LocalText, MissingLocal from ./Local
          ui MainView {
             render Text Greeting
             alias Greeting = "hi"
          }
        `)
        }\n`,
        FS.resolvePath('Main.tao', { cwd: tmpDir }),
      )

      Expect(await SourceActions.fixSource(document, await sourceActionOptionsFor(document))).toBe(`${
        Text.stripIndent(`
        use Text from @tao/ui
        use MissingLocal from ./Local

        ui MainView {
           alias Greeting = "hi"
           render Text Greeting
        }
      `)
      }\n`)
    } finally {
      await FS.remove(tmpDir)
    }
  })
})
