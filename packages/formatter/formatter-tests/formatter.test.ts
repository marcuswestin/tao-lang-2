import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import Formatter from '../formatter-src/formatter'
import { testFormatCode } from './test-format'

const kitchenSinkPath = FS.repoPath('Apps/Kitchen Sink/Kitchen Sink.tao')
const targetKitchenSinkPath = FS.repoPath('Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao')
const tsFence = '```ts'
const fence = '```'

Describe('Tao formatter Kitchen Sink apps', () => {
  Test('the current Kitchen Sink app is a formatting fixed point', async () => {
    Expect(await Formatter.formatFile(kitchenSinkPath)).toBe(await FS.readText(kitchenSinkPath))
  })

  Test('the target Kitchen Sink app is a formatting fixed point', async () => {
    Expect(await Formatter.formatFile(targetKitchenSinkPath)).toBe(await FS.readText(targetKitchenSinkPath))
  })
})

Describe('Tao formatter top-level statements', () => {
  Test('separates declarations with one blank line and keeps alias groups adjacent', async () => {
    await testFormatCode(
      `
        app MyApp { ui MainView }
        alias Greeting = "Hello"
        alias Count = 3
        ui MainView { }
      `,
      `
        app MyApp {
           ui MainView
        }

        alias Greeting = "Hello"
        alias Count = 3

        ui MainView { }
      `,
    )
  })

  Test('collapses extra blank lines between declarations', async () => {
    await testFormatCode(
      `
        alias Greeting = "Hello"



        ui MainView { }
      `,
      `
        alias Greeting = "Hello"

        ui MainView { }
      `,
    )
  })

  Test('keeps consecutive use statements adjacent', async () => {
    await testFormatCode(
      `
        use Text from @tao/ui
        use Stack from @tao/ui
        ui MainView { render Text "hi" }
      `,
      `
        use Text from @tao/ui
        use Stack from @tao/ui

        ui MainView {
           render Text "hi"
        }
      `,
    )
  })

  Test('preserves a single existing blank line between consecutive aliases and use statements', async () => {
    await testFormatCode(
      `
        use Text from @tao/ui

        use Stack from @tao/ui
        alias Greeting = "a"

        alias Count = 3
        ui MainView { }
      `,
      `
        use Text from @tao/ui

        use Stack from @tao/ui

        alias Greeting = "a"

        alias Count = 3

        ui MainView { }
      `,
    )
  })

  Test('collapses multiple blank lines between consecutive aliases to one', async () => {
    await testFormatCode(
      `
        alias Greeting = "a"



        alias Count = 3
        ui MainView { }
      `,
      `
        alias Greeting = "a"

        alias Count = 3

        ui MainView { }
      `,
    )
  })

  Test('removes leading blank lines', async () => {
    Expect(await Formatter.formatCode('\n\n   ui MainView { }')).toBe('ui MainView { }\n')
  })

  Test('ends the formatted file with exactly one trailing newline', async () => {
    Expect(await Formatter.formatCode('ui MainView { }\n\n\n')).toBe('ui MainView { }\n')
  })
})

Describe('Tao formatter use statements', () => {
  Test('normalizes use statement spacing', async () => {
    await testFormatCode(
      `use   Text,Stack   from    @tao/ui\nui MainView { }`,
      `
        use Text, Stack from @tao/ui

        ui MainView { }
      `,
    )
  })
})

Describe('Tao formatter views and blocks', () => {
  Test('indents nested render blocks and collapses closing braces', async () => {
    await testFormatCode(
      `ui MainView{render Stack{Text "a"\nText "b"}}`,
      `
        ui MainView {
           render Stack {
              Text "a"
              Text "b"
        }  }
      `,
    )
  })

  Test('collapses deep closing brace runs onto one line at the outermost indentation', async () => {
    await testFormatCode(
      `ui MainView{render Stack{Text "a"{Text "b"{Text "c"}}}}`,
      `
        ui MainView {
           render Stack {
              Text "a" {
                 Text "b" {
                    Text "c"
        }  }  }  }
      `,
    )
  })

  Test('keeps a closing brace on its own line when statements follow it', async () => {
    await testFormatCode(
      `ui MainView{render Stack{Text "a"{Text "b"}\nText "c"}}`,
      `
        ui MainView {
           render Stack {
              Text "a" {
                 Text "b"
              }
              Text "c"
        }  }
      `,
    )
  })

  Test('does not collapse close-looking lines inside block comments', async () => {
    await testFormatCode(
      `
        ui MainView {
        render Stack {
        /*
        }
        }
        */
        Text "a"
        }
        }
      `,
      `
        ui MainView {
           render Stack {
              /*
              }
              }
              */
              Text "a"
        }  }
      `,
    )
  })

  Test('formats empty blocks as braces with one interior space', async () => {
    await testFormatCode(
      `ui MainView {render Stack{Text "a"{   }}}`,
      `
        ui MainView {
           render Stack {
              Text "a" { }
        }  }
      `,
    )
  })

  Test('normalizes view parameter spacing', async () => {
    await testFormatCode(
      `share ui CountText Count   number,Label    text { render Text Label }`,
      `
        share ui CountText Count number, Label text {
           render Text Label
        }
      `,
    )
  })

  Test('normalizes view invocation argument spacing', async () => {
    await testFormatCode(
      `ui MainView { render Stack { CountText 3,"label" } }\nui CountText Count number, Label text { render Text Label }`,
      `
        ui MainView {
           render Stack {
              CountText 3, "label"
        }  }

        ui CountText Count number, Label text {
           render Text Label
        }
      `,
    )
  })
})

Describe('Tao formatter aliases', () => {
  Test('normalizes alias declaration spacing', async () => {
    await testFormatCode(
      `share alias   Greeting="Hello"\nui MainView { }`,
      `
        share alias Greeting = "Hello"

        ui MainView { }
      `,
    )
  })
})

Describe('Tao formatter injections', () => {
  Test('formats injection fence bodies with dprint TypeScript style', async () => {
    await testFormatCode(
      `
        ui MainView {
        render inject ${tsFence}
        const message = "hi";
        return <RN.Text accessibilityLabel='greeting'>{ message }</RN.Text>;
        ${fence}
        }
      `,
      `
        ui MainView {
           render inject ${tsFence}
              const message = 'hi'
              return <RN.Text accessibilityLabel="greeting">{message}</RN.Text>
           ${fence}
        }
      `,
    )
  })

  Test('indents injection fence bodies one level below the inject line', async () => {
    await testFormatCode(
      `
        ui CountText Count number {
        render inject Count ${tsFence}
        return <RN.Text>{Count}</RN.Text>
        ${fence}
        }
      `,
      `
        ui CountText Count number {
           render inject Count ${tsFence}
              return <RN.Text>{Count}</RN.Text>
           ${fence}
        }
      `,
    )
  })

  Test('preserves relative indentation and brace lines inside fence bodies', async () => {
    await testFormatCode(
      `
        ui MainView {
        render inject ${tsFence}
        function label() {
            return 'hi'
        }
        return <RN.Text>{label()}</RN.Text>
        ${fence}
        }
      `,
      `
        ui MainView {
           render inject ${tsFence}
              function label() {
                return 'hi'
              }
              return <RN.Text>{label()}</RN.Text>
           ${fence}
        }
      `,
    )
  })

  Test('detects fences with trailing whitespace after the opener and leaves their bodies untouched', async () => {
    await testFormatCode(
      `
        ui MainView {
        render inject ${tsFence}${' '}
        function wrap() {
           if (true) {
           }
        }
        return <RN.Text>hi</RN.Text>
        ${fence}
        }
      `,
      `
        ui MainView {
           render inject ${tsFence}
              function wrap() {
                if (true) {
                }
              }
              return <RN.Text>hi</RN.Text>
           ${fence}
        }
      `,
    )
  })

  Test('ignores comment lines that mention inject fences', async () => {
    await testFormatCode(
      `
        ui MainView {
        // inject some TS via ${tsFence}
        render inject ${tsFence}
        return null
        ${fence}
        }
      `,
      `
        ui MainView {
           // inject some TS via ${tsFence}
           render inject ${tsFence}
              return null
           ${fence}
        }
      `,
    )
  })

  Test('preserves trailing whitespace inside fence bodies', async () => {
    await testFormatCode(
      `
        ui MainView {
        render inject ${tsFence}
        const s = \`abc${'   '}
        def\`
        return <RN.Text>{s}</RN.Text>
        ${fence}
        }
      `,
      `
        ui MainView {
           render inject ${tsFence}
              const s = \`abc${'   '}
              def\`
              return <RN.Text>{s}</RN.Text>
           ${fence}
        }
      `,
    )
  })

  Test('moves body content sharing the close-fence line onto its own body line', async () => {
    await testFormatCode(
      `
        ui MainView {
        render inject ${tsFence}
        const value = 1
        return value${fence}
        }
      `,
      `
        ui MainView {
           render inject ${tsFence}
              const value = 1
              return value
           ${fence}
        }
      `,
    )
  })

  Test('falls back to reindent-only for invalid embedded TypeScript', async () => {
    await testFormatCode(
      `
        ui MainView {
        render inject ${tsFence}
        const =
        return null
        ${fence}
        }
      `,
      `
        ui MainView {
           render inject ${tsFence}
              const =
              return null
           ${fence}
        }
      `,
    )
  })

  Test('normalizes injection argument spacing', async () => {
    await testFormatCode(
      `
        alias UserName = "Ro"
        ui MainView {
        render inject Name    UserName,UserName ${tsFence}
        return <RN.Text>{Name}</RN.Text>
        ${fence}
        }
      `,
      `
        alias UserName = "Ro"

        ui MainView {
           render inject Name UserName, UserName ${tsFence}
              return <RN.Text>{Name}</RN.Text>
           ${fence}
        }
      `,
    )
  })
})

Describe('Tao formatter comments', () => {
  Test('keeps top-level comments attached below the blank-line separation', async () => {
    await testFormatCode(
      `
        alias Greeting = "hi"

        // the main view
        ui MainView { render Text Greeting }
      `,
      `
        alias Greeting = "hi"

        // the main view
        ui MainView {
           render Text Greeting
        }
      `,
    )
  })

  Test('preserves and indents comments inside blocks', async () => {
    await testFormatCode(
      `
        ui MainView {
        // local greeting
        alias G = "hi"
        render Text G
        }
      `,
      `
        ui MainView {
           // local greeting
           alias G = "hi"
           render Text G
        }
      `,
    )
  })
})

Describe('Tao formatter error handling', () => {
  Test('throws on Tao source with syntax errors', async () => {
    await Expect(Formatter.formatCode('ui Broken {')).rejects.toThrow(
      'Tao source without syntax errors when formatting',
    )
  })
})
