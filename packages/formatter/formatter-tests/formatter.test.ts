import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import Formatter from '../formatter-src/formatter'
import { testFormatCode } from './test-format'

const kitchenSinkPath = Repo.resolvePath('Apps/Kitchen Sink/Kitchen Sink.tao')
const kitchenSinkTestPath = Repo.resolvePath('Apps/Kitchen Sink/Kitchen Sink.test.tao')
const tsFence = '```ts'
const fence = '```'

Describe('Tao formatter Kitchen Sink apps', () => {
  Test('the current Kitchen Sink app is a formatting fixed point', async () => {
    Expect(await Formatter.formatFile(kitchenSinkPath)).toBe(await FS.readText(kitchenSinkPath))
  })

  Test('the current Kitchen Sink v0 test sidecar is a formatting fixed point', async () => {
    Expect(await Formatter.formatFile(kitchenSinkTestPath)).toBe(await FS.readText(kitchenSinkTestPath))
  })
})

Describe('Tao formatter top-level statements', () => {
  Test('separates declarations with one blank line and keeps alias groups adjacent', async () => {
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
      `use KitchenSink from ./\ntest   "Kitchen Sink"{check "renders"{run   KitchenSink\nexpect   text "Hello"\npress   role "Add"\nexpect missing   label "Loading"}}`,
      `
        use KitchenSink from ./

        test "Kitchen Sink" {
           check "renders" {
              run KitchenSink

              expect text "Hello"
              press role "Add"
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
      `view MainView{render Stack(){Text("a")\nText("b")}}`,
      `
        view MainView {
           render Stack() {
              Text("a")
              Text("b")
        }  }
      `,
    )
  })

  Test('collapses deep closing brace runs onto one line at the outermost indentation', async () => {
    await testFormatCode(
      `view MainView{render Stack(){Text("a"){Text("b"){Text("c")}}}}`,
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
      `view MainView{render Stack(){Text("a"){Text("b")}\nText("c")}}`,
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
      `view MainView {render Stack(){Text("a"){   }}}`,
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
      `publish view CountText Count is number, Label is text { render Text(Label) }`,
      `
        publish view CountText Count is number, Label is text {
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

  Test('spaces operators and lays out when branches', async () => {
    await testFormatCode(
      `view MainView{state Ready=false state Count=1 let Total=(Count+1)*2-  -3 let Flag=not Ready and Count>=1 let Label=when Ready->"on" Count<1->"low" otherwise->"off" action Flip{toggle   Ready} render Text(Label)}`,
      `
        view MainView {
           state Ready = false
           state Count = 1
           let Total = (Count + 1) * 2 - -3
           let Flag = not Ready and Count >= 1
           let Label = when
              Ready -> "on"
              Count < 1 -> "low"
              otherwise -> "off"
           action Flip {
              toggle Ready
           }
           render Text(Label)
        }
      `,
    )
  })

  Test('formats when statements in render and action bodies', async () => {
    await testFormatCode(
      `view MainView{state Ready=false action Run{when Ready->{set Ready=false} otherwise->{set Ready=true}} render Stack(){when Ready->{Text("on")} otherwise->{Text("off")}}}`,
      `
        view MainView {
           state Ready = false
           action Run {
              when
                 Ready -> {
                    set Ready = false
                 }
                 otherwise -> {
                    set Ready = true
           }  }
           render Stack() {
              when
                 Ready -> {
                    Text("on")
                 }
                 otherwise -> {
                    Text("off")
        }  }  }
      `,
    )
  })

  Test('formats for statements and interpolated text', async () => {
    await testFormatCode(
      `view MainView{let Tags=["a" "b"] render Stack(){for   Tag   in   Tags{Text("- {Tag}")}}}`,
      `
        view MainView {
           let Tags = ["a" "b"]
           render Stack() {
              for Tag in Tags {
                 Text("- {Tag}")
        }  }  }
      `,
    )
  })

  Test('formats event clauses and defaulted parameters', async () => {
    await testFormatCode(
      `view Field Value is text,Label is text   default   "none"{ }
view MainView{state Draft="" render Field(Draft)on change->Value is text{set Draft=Value}}`,
      `
        view Field Value is text, Label is text default "none" { }

        view MainView {
           state Draft = ""
           render Field(Draft)
              on change -> Value is text {
                 set Draft = Value
        }  }
      `,
    )
  })

  Test('tightens invocation parentheses on renders, children, and actions', async () => {
    await testFormatCode(
      `view MainView{state Count = 0 action AddStep Step is number{set Count += Step} action Run{do AddStep ( 2 )} render Stack ( ) {CountText ( 3 , "label" ) [width fill]}}`,
      `
        view MainView {
           state Count = 0
           action AddStep Step is number {
              set Count += Step
           }
           action Run {
              do AddStep(2)
           }
           render Stack() {
              CountText(3, "label") [width fill]
        }  }
      `,
    )
  })

  Test('formats state declarations and action bodies', async () => {
    await testFormatCode(
      `view MainView{state Count=0 action AddStep Step is number{set Count+=Step} action AddFive{do AddStep(5)} render Stack(){Button("Reset",action{set Count=0}) Button("Inline",->{set Count+=1})}}`,
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

Describe('Tao formatter bindings', () => {
  Test('normalizes let declaration spacing', async () => {
    await testFormatCode(
      `publish let   Greeting="Hello"\nview MainView { }`,
      `
        publish let Greeting = "Hello"

        view MainView { }
      `,
    )
  })

  Test('keeps the deprecated alias keyword as written', async () => {
    await testFormatCode(
      `alias   Greeting="Hello"\nview MainView { }`,
      `
        alias Greeting = "Hello"

        view MainView { }
      `,
    )
  })
})

Describe('Tao formatter data', () => {
  Test('formats data declarations, queries, and mutations', async () => {
    await testFormatCode(
      `data Notes{Entries/Entry{Title text   indexed\nDone boolean default false\nCreatedAt time default now()}}\nview MainView{query Open=Notes.Entries where Done==false order CreatedAt   desc\naction Add{create Notes.Entry{Title:"x",Done:true}}\nrender Text("hi")}`,
      `
        data Notes {
           Entries/Entry {
              Title text indexed
              Done boolean default false
              CreatedAt time default now()
        }  }

        view MainView {
           query Open = Notes.Entries where Done == false order CreatedAt desc
           action Add {
              create Notes.Entry { Title: "x", Done: true }
           }
           render Text("hi")
        }
      `,
    )
  })
})

Describe('Tao formatter types and constructors', () => {
  Test('normalizes type declarations, constructors, casts, lists, and member access', async () => {
    await testFormatCode(
      `type Job is {Title is text Level is number}\ntype Person is {Name Age Tags Job}\nlet Demo = Person {Tags ["a" "b"] Job {Level 2 Title "Engineer"} Age 40 Name "Ada"}\nview Profile Person { render Text(Person.Job.Title) }`,
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
           Tags ["a" "b"]
           Job {
              Level 2
              Title "Engineer"
           }
           Age 40
           Name "Ada"
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
