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
  Test('indents nested render blocks', async () => {
    await testFormatCode(
      `ui MainView{render Stack{Text "a"\nText "b"}}`,
      `
        ui MainView {
            render Stack {
                Text "a"
                Text "b"
            }
        }
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
            }
        }
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
            }
        }

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

  Test('preserves relative indentation inside fence bodies', async () => {
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
