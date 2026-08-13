import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import Formatter from '../formatter-src/formatter'
import { testFormatCode } from './test-format'

const wordFlowerPath = Repo.resolvePath('Apps/WordFlower/1 - Current/WordFlower.tao')
const wordFlowerTestPath = Repo.resolvePath('Apps/WordFlower/1 - Current/WordFlower.test.tao')
const wordFlowerNextPath = Repo.resolvePath('Apps/WordFlower/2 - Next/WordFlower.tao-next')
const wordFlowerNextTestPath = Repo.resolvePath('Apps/WordFlower/2 - Next/WordFlower.test.tao-next')
const tsFence = '```ts'
const fence = '```'

Describe('Tao formatter WordFlower apps', () => {
  Test('the current WordFlower app is a formatting fixed point', async () => {
    Expect(await Formatter.formatFile(wordFlowerPath)).toBe(await FS.readText(wordFlowerPath))
  })

  Test('the current WordFlower test sidecar is a formatting fixed point', async () => {
    Expect(await Formatter.formatFile(wordFlowerTestPath)).toBe(await FS.readText(wordFlowerTestPath))
  })

  Test('formats the Next contract and sidecar to Current fixed points', async () => {
    const next = await Formatter.formatCode(await FS.readText(wordFlowerNextPath))
    const nextTest = await Formatter.formatCode(await FS.readText(wordFlowerNextTestPath))

    Expect(next).toBe(await FS.readText(wordFlowerPath))
    Expect(nextTest).toBe(await FS.readText(wordFlowerTestPath))
    Expect(await Formatter.formatCode(next)).toBe(next)
    Expect(await Formatter.formatCode(nextTest)).toBe(nextTest)
  })
})

Describe('Tao formatter top-level statements', () => {
  Test('separates declarations with one blank line and keeps let groups adjacent', async () => {
    await testFormatCode(
      `
        app MyApp { view MainView }
        let Greeting = "Hello"
        let Count = 3
        view MainView { }
      `,
      `
        app MyApp {
           view MainView
        }

        let Greeting = "Hello"
        let Count = 3

        view MainView { }
      `,
    )
  })

  Test('collapses extra blank lines between declarations', async () => {
    await testFormatCode(
      `
        let Greeting = "Hello"



        view MainView { }
      `,
      `
        let Greeting = "Hello"

        view MainView { }
      `,
    )
  })

  Test('keeps consecutive use statements adjacent', async () => {
    await testFormatCode(
      `
        use Text from @tao/ui
        use Stack from @tao/ui
        view MainView { render Text("hi") }
      `,
      `
        use Text from @tao/ui
        use Stack from @tao/ui

        view MainView {
           render Text("hi")
        }
      `,
    )
  })

  Test('preserves a single existing blank line between consecutive aliases and use statements', async () => {
    await testFormatCode(
      `
        use Text from @tao/ui

        use Stack from @tao/ui
        let Greeting = "a"

        let Count = 3
        view MainView { }
      `,
      `
        use Text from @tao/ui

        use Stack from @tao/ui

        let Greeting = "a"

        let Count = 3

        view MainView { }
      `,
    )
  })

  Test('collapses multiple blank lines between consecutive aliases to one', async () => {
    await testFormatCode(
      `
        let Greeting = "a"



        let Count = 3
        view MainView { }
      `,
      `
        let Greeting = "a"

        let Count = 3

        view MainView { }
      `,
    )
  })

  Test('removes leading blank lines', async () => {
    Expect(await Formatter.formatCode('\n\n   view MainView { }')).toBe('view MainView { }\n')
  })

  Test('ends the formatted file with exactly one trailing newline', async () => {
    Expect(await Formatter.formatCode('view MainView { }\n\n\n')).toBe('view MainView { }\n')
  })
})

Describe('Tao formatter use statements', () => {
  Test('normalizes use statement spacing', async () => {
    await testFormatCode(
      `use   Text,Stack   from    @tao/ui\nview MainView { }`,
      `
        use Text, Stack from @tao/ui

        view MainView { }
      `,
    )
  })
})

Describe('Tao formatter tests', () => {
  Test('formats v0 Tao test declarations', async () => {
    await testFormatCode(
      `use WordFlower from ./\ntest   "WordFlower"{check "renders"{run   WordFlower\nexpect   text "Hello"\npress   text "Add"\nexpect input   placeholder "Title" value   "Draft"\nback\nexpect missing   label "Loading"}}`,
      `
        use WordFlower from ./

        test "WordFlower" {
           check "renders" {
              run WordFlower

              expect text "Hello"
              press text "Add"
              expect input placeholder "Title" value "Draft"
              back
              expect missing label "Loading"
           }
        }
      `,
    )
  })

  Test('keeps test closing braces separate after trailing step comments', async () => {
    await testFormatCode(
      `test "Smoke"{check "renders"{run MyApp\nexpect text "Hello"\n// last step note\n}}`,
      `
        test "Smoke" {
           check "renders" {
              run MyApp

              expect text "Hello"
              // last step note
           }
        }
      `,
    )
  })
})

Describe('Tao formatter views and blocks', () => {
  Test('formats layout clauses on render sites', async () => {
    await testFormatCode(
      `view MainView{render Col()[claim 2,content top spread-inset,gap 12,pad 16,margin horizontal 4,width fill]{Text("Label")[width fill,height fill]}}`,
      `
        view MainView {
           render Col() [claim 2, content top spread-inset, gap 12, pad 16, margin horizontal 4, width fill] {
              Text("Label") [width fill, height fill]
        }  }
      `,
    )
  })

  Test('indents nested render blocks and collapses closing braces', async () => {
    await testFormatCode(
      `view MainView{render Stack(){Text( "a")\nText( "b")}}`,
      `
        view MainView {
           render Stack() {
              Text("a")
              Text("b")
        }  }
      `,
    )
  })

  Test('formats named and inline control event handlers', async () => {
    await testFormatCode(
      `view MainView{render Input(Value:Draft){on change->Entered{set Draft=Entered}\non submit Submit}}`,
      `
        view MainView {
           render Input(Value: Draft) {
              on change -> Entered {
                 set Draft = Entered
              }
              on submit Submit
        }  }
      `,
    )
  })

  Test('formats current query and loop headers', async () => {
    await testFormatCode(
      `view Main Workspace{render Col(){query Drafts from Workspace.Documents{where Draft}\nloop Drafts/Document{Text(Document.Title)}}}`,
      `
        view Main Workspace {
           render Col() {
              query Drafts from Workspace.Documents {
                 where Draft
              }
              loop Drafts / Document {
                 Text(Document.Title)
        }  }  }
      `,
    )
  })

  Test('collapses deep closing brace runs onto one line at the outermost indentation', async () => {
    await testFormatCode(
      `view MainView{render Stack() {Text("a") {Text("b") {Text("c")}}}}`,
      `
        view MainView {
           render Stack() {
              Text("a") {
                 Text("b") {
                    Text("c")
        }  }  }  }
      `,
    )
  })

  Test('keeps a closing brace on its own line when statements follow it', async () => {
    await testFormatCode(
      `view MainView{render Stack() {Text("a") {Text("b")}\nText( "c")}}`,
      `
        view MainView {
           render Stack() {
              Text("a") {
                 Text("b")
              }
              Text("c")
        }  }
      `,
    )
  })

  Test('does not collapse close-looking lines inside block comments', async () => {
    await testFormatCode(
      `
        view MainView {
        render Stack() {
        /*
        }
        }
        */
        Text("a")
        }
        }
      `,
      `
        view MainView {
           render Stack() {
              /*
              }
              }
              */
              Text("a")
        }  }
      `,
    )
  })

  Test('does not treat block-comment markers inside strings as block comments', async () => {
    await testFormatCode(
      `view MainView { render Stack() { Text("/*") { Text("hi") } } }`,
      `
        view MainView {
           render Stack() {
              Text("/*") {
                 Text("hi")
        }  }  }
      `,
    )
  })

  Test('formats empty blocks as braces with one interior space', async () => {
    await testFormatCode(
      `view MainView {render Stack() {Text("a") {   }}}`,
      `
        view MainView {
           render Stack() {
              Text("a") { }
        }  }
      `,
    )
  })

  Test('normalizes view parameter spacing', async () => {
    await testFormatCode(
      `public view CountText Count is number, Label is text { render Text(Label) }`,
      `
        public view CountText Count is number, Label is text {
           render Text(Label)
        }
      `,
    )
  })

  Test('normalizes view invocation argument spacing', async () => {
    await testFormatCode(
      `view MainView { render Stack() { CountText(3,"label") } }\nview CountText Count is number, Label is text { render Text(Label) }`,
      `
        view MainView {
           render Stack() {
              CountText(3, "label")
        }  }

        view CountText Count is number, Label is text {
           render Text(Label)
        }
      `,
    )
  })

  Test('normalizes named invocation and input-test step spacing', async () => {
    await testFormatCode(
      `view MainView{render Field(Value: "Draft",Disabled: false)}\ntest "Form"{check "entry"{run MyApp enter "Hello"  into label  "Title" submit placeholder  "Title"}}`,
      `
        view MainView {
           render Field(Value: "Draft", Disabled: false)
        }

        test "Form" {
           check "entry" {
              run MyApp
              enter "Hello" into label "Title"
              submit placeholder "Title"
        }  }
      `,
    )
  })

  Test('formats state declarations and action bodies', async () => {
    await testFormatCode(
      `view MainView{state Count=0 action AddStep Step is number{set Count+=Step} action AddFive{do AddStep(5)} render Stack() {Button("Reset",action{set Count=0}) Button("Inline",->{set Count+=1})}}`,
      `
        view MainView {
           state Count = 0
           action AddStep Step is number {
              set Count += Step
           }
           action AddFive {
              do AddStep(5)
           }
           render Stack() {
              Button("Reset", action { set Count = 0 })
              Button("Inline", -> { set Count += 1 })
        }  }
      `,
    )
  })

  Test('keeps commented inline actions multiline', async () => {
    await testFormatCode(
      `view MainView { state Count = 0 render Stack() {
        Button("Leading", action {
          // before
          set Count = 1
        })
        Button("Trailing", action {
          set Count = 2 // after
        })
        Button("Block", action { /* explanation */ set Count = 3 })
        Button("Compact", action { set Count = 4 })
      } }`,
      `
        view MainView {
           state Count = 0
           render Stack() {
              Button("Leading", action {
                 // before
                 set Count = 1
              })
              Button("Trailing", action {
                 set Count = 2 // after
              })
              Button("Block", action { /* explanation */
                 set Count = 3
              })
              Button("Compact", action { set Count = 4 })
        }  }
      `,
    )
  })
})

Describe('Tao formatter immutable bindings', () => {
  Test('normalizes canonical let binding spacing', async () => {
    await testFormatCode(
      `public let   Greeting="Hello"\nlet   Legacy="Hello"\nview MainView { }`,
      `
        public let Greeting = "Hello"
        let Legacy = "Hello"

        view MainView { }
      `,
    )
  })
})

Describe('Tao formatter types and constructors', () => {
  Test('normalizes type declarations, constructors, casts, lists, and member access', async () => {
    await testFormatCode(
      `type Job is {Title is text Level is number}\ntype Person is {Name Age Tags Job}\nlet Demo = Person {Tags: Tags ["a","b"],Job: Job {Level: 2,Title: "Engineer"},Age: 40,Name: "Ada"}\nview Profile Person { render Text(Person.Job.Title) }`,
      `
        type Job is {
           Title is text
           Level is number
        }

        type Person is {
           Name
           Age
           Tags
           Job
        }

        let Demo = Person {
           Tags: Tags ["a", "b"],
           Job: Job {
              Level: 2,
              Title: "Engineer"
           },
           Age: 40,
           Name: "Ada"
        }

        view Profile Person {
           render Text(Person.Job.Title)
        }
      `,
    )
  })
})

Describe('Tao formatter project metadata', () => {
  Test('formats project metadata blocks', async () => {
    await testFormatCode(
      `project{name "Package Access" remote   none license   MIT}`,
      `
        project {
           name "Package Access"
           remote none
           license MIT
        }
      `,
    )
  })
})

Describe('Tao formatter injections', () => {
  Test('formats injection fence bodies with dprint TypeScript style', async () => {
    await testFormatCode(
      `
        view MainView {
        render inject ${tsFence}
        const message = "hi";
        return <RN.Text accessibilityLabel='greeting'>{ message }</RN.Text>;
        ${fence}
        }
      `,
      `
        view MainView {
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
        view CountText Count is number {
        render inject Count ${tsFence}
        return <RN.Text>{Count}</RN.Text>
        ${fence}
        }
      `,
      `
        view CountText Count is number {
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
        view MainView {
        render inject ${tsFence}
        function label() {
            return 'hi'
        }
        return <RN.Text>{label()}</RN.Text>
        ${fence}
        }
      `,
      `
        view MainView {
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
        view MainView {
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
        view MainView {
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
        view MainView {
        // inject some TS via ${tsFence}
        render inject ${tsFence}
        return null
        ${fence}
        }
      `,
      `
        view MainView {
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
        view MainView {
        render inject ${tsFence}
        const s = \`abc${'   '}
        def\`
        return <RN.Text>{s}</RN.Text>
        ${fence}
        }
      `,
      `
        view MainView {
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
        view MainView {
        render inject ${tsFence}
        const value = 1
        return value${fence}
        }
      `,
      `
        view MainView {
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
        view MainView {
        render inject ${tsFence}
        const =
        return null
        ${fence}
        }
      `,
      `
        view MainView {
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
        let UserName = "Ro"
        view MainView {
        render inject Name    UserName,UserName ${tsFence}
        return <RN.Text>{Name}</RN.Text>
        ${fence}
        }
      `,
      `
        let UserName = "Ro"

        view MainView {
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
        let Greeting = "hi"

        // the main view
        view MainView { render Text(Greeting) }
      `,
      `
        let Greeting = "hi"

        // the main view
        view MainView {
           render Text(Greeting)
        }
      `,
    )
  })

  Test('preserves and indents comments inside blocks', async () => {
    await testFormatCode(
      `
        view MainView {
        // local greeting
        let G = "hi"
        render Text(G)
        }
      `,
      `
        view MainView {
           // local greeting
           let G = "hi"
           render Text(G)
        }
      `,
    )
  })
})

Describe('Tao formatter error handling', () => {
  Test('throws on Tao source with syntax errors', async () => {
    await Expect(Formatter.formatCode('view Broken {')).rejects.toThrow(
      'Tao source without syntax errors when formatting',
    )
  })
})
