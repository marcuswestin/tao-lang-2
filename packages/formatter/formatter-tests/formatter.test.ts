import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import Formatter from '../formatter-src/formatter'
import { fence, testFormatCode, tsFence } from './test-format'

const wordFlowerPath = Repo.resolvePath('Apps/WordFlower/1 - Current/WordFlower.tao')
const wordFlowerTestPath = Repo.resolvePath('Apps/WordFlower/1 - Current/WordFlower.test.tao')
const wordFlowerNextPath = Repo.resolvePath('Apps/WordFlower/2 - Next/WordFlower.tao-next')
const wordFlowerNextTestPath = Repo.resolvePath('Apps/WordFlower/2 - Next/WordFlower.test.tao-next')
const wordFlowerOpenTrancheHeader = '// Tranche status: open'
const wordFlowerAbsorbedTrancheHeader = '// Tranche status: absorbed'

Describe('Tao formatter WordFlower apps', () => {
  Test('the current WordFlower app is a formatting fixed point', async () => {
    Expect(await Formatter.formatFile(wordFlowerPath)).toBe(await FS.readText(wordFlowerPath))
  })

  Test('the current WordFlower test sidecar is a formatting fixed point', async () => {
    Expect(await Formatter.formatFile(wordFlowerTestPath)).toBe(await FS.readText(wordFlowerTestPath))
  })

  Test('declares whether the WordFlower Next contract is open or absorbed', async () => {
    const currentSource = await FS.readText(wordFlowerPath)
    const currentTestSource = await FS.readText(wordFlowerTestPath)
    const nextSource = await FS.readText(wordFlowerNextPath)
    const nextTestSource = await FS.readText(wordFlowerNextTestPath)

    expectWordFlowerTrancheStatus(currentSource, wordFlowerAbsorbedTrancheHeader)
    expectWordFlowerTrancheStatus(currentTestSource, wordFlowerAbsorbedTrancheHeader)
    expectWordFlowerTrancheStatus(
      nextSource,
      nextSource === currentSource ? wordFlowerAbsorbedTrancheHeader : wordFlowerOpenTrancheHeader,
    )
    expectWordFlowerTrancheStatus(
      nextTestSource,
      nextTestSource === currentTestSource ? wordFlowerAbsorbedTrancheHeader : wordFlowerOpenTrancheHeader,
    )
  })

  Test('formats the matching WordFlower Next app to the Current fixed point', async () => {
    const nextSource = await FS.readText(wordFlowerNextPath)
    const currentSource = await FS.readText(wordFlowerPath)
    if (!expectWordFlowerPairState(nextSource, currentSource, nextSource)) {
      return
    }
    const next = await Formatter.formatCode(nextSource)

    Expect(next).toBe(currentSource)
    Expect(await Formatter.formatCode(next)).toBe(next)
  })

  Test('formats the matching WordFlower Next sidecar to the Current fixed point', async () => {
    const nextTestSource = await FS.readText(wordFlowerNextTestPath)
    const currentTestSource = await FS.readText(wordFlowerTestPath)
    if (!expectWordFlowerPairState(nextTestSource, currentTestSource, nextTestSource)) {
      return
    }
    const nextTest = await Formatter.formatCode(nextTestSource)

    Expect(nextTest).toBe(currentTestSource)
    Expect(await Formatter.formatCode(nextTest)).toBe(nextTest)
  })
})

function expectWordFlowerPairState(next: string, current: string, nextHeader: string): boolean {
  if (next === current) {
    Expect(next).toBe(current)
    return true
  }
  Expect(next).not.toBe(current)
  expectWordFlowerTrancheStatus(nextHeader, wordFlowerOpenTrancheHeader)
  return false
}

function expectWordFlowerTrancheStatus(source: string, expected: string): void {
  Expect(source.match(/^\/\/ Tranche status: (?:open|absorbed)$/gm) ?? []).toEqual([expected])
}

Describe('Tao formatter data declarations', () => {
  Test('formats reshaped fields, relation modifiers, boolean cases, and bare now defaults', async () => {
    await testFormatCode(
      `
        data Workspaces/Workspace{
        Name text
        CreatedAt time(default now)
        Pinned yes / no
        Documents(relation Documents,auto-delete)}
        data Documents/Document{Final yes / no       Draft(default Draft) Workspace(relation Workspace)}
      `,
      `
        data Workspaces / Workspace {
           Name text
           CreatedAt time (default now)
           Pinned yes / no
           Documents (relation Documents, auto-delete)
        }

        data Documents / Document {
           Final yes / no Draft (default Draft)
           Workspace (relation Workspace)
        }
      `,
    )
  })
})

Describe('Tao formatter configurable declarations', () => {
  Test('formats declaration-owned nav and datasource contracts with injected implementations', async () => {
    await testFormatCode(
      `public nav CustomNav{Initial ui @key{Label text Content Presentable}implement inject nav ${tsFence}\nreturn TR.NavKind.Stack()\n${fence}}\npublic datasource CustomData{StorageKey text implement inject provider ${tsFence}\nreturn TR.DataProvider.Local()\n${fence}}`,
      `
        public nav CustomNav {
           Initial ui
           @key {
              Label text
              Content Presentable
           }

           implement inject nav ${tsFence}
              return TR.NavKind.Stack()
           ${fence}
        }

        public datasource CustomData {
           StorageKey text

           implement inject provider ${tsFence}
              return TR.DataProvider.Local()
           ${fence}
        }
      `,
    )
  })

  Test('formats keyed, labeled, named, nested, and bare constructor entries', async () => {
    await testFormatCode(
      `let Demo=SelectionNav{Initial @home Display "tabs" @home{Label:"Home" Content HomeStack} Extra{Nested "value"} "bare"}`,
      `
        let Demo = SelectionNav {
           Initial @home
           Display "tabs"
           @home {
              Label: "Home"
              Content HomeStack
           }
           Extra {
              Nested "value"
           }
           "bare"
        }
      `,
    )
  })

  Test('keeps qualified declaration-owned constructors tight', async () => {
    await testFormatCode(
      `let Demo=Card . Details { OuterAge }`,
      `
        let Demo = Card.Details {
           OuterAge
        }
      `,
    )
  })
})

Describe('Tao formatter top-level statements', () => {
  Test('formats keyed SelectionNav items and key-valued Initial', async () => {
    await testFormatCode(
      `let Main=SelectionNav{Initial @home Display "tabs" @home{Label "Home" Content HomeStack}}`,
      `
        let Main = SelectionNav {
           Initial @home
           Display "tabs"
           @home {
              Label "Home"
              Content HomeStack
        }  }
      `,
    )
  })

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
      `view Main Workspace{render Col(){query Drafts from Workspace.Documents{where   is   Draft}\nloop Drafts/Document{Text(Document.Title)}}}`,
      `
        view Main Workspace {
           render Col() {
              query Drafts from Workspace.Documents {
                 where is Draft
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

  Test('formats dialogue declarations, asks, and explicit or bare responses', async () => {
    await testFormatCode(
      `dialogue Confirm Title is text responds ConfirmResult{action Close{respond Confirmed} action Cancel{respond} render Empty()} view Editor{action Close{let Result=ask Confirm( "Draft" ) if Result is Confirmed{dismiss}} render Empty()}`,
      `
        dialogue Confirm Title is text responds ConfirmResult {
           action Close {
              respond Confirmed
           }
           action Cancel {
              respond
           }
           render Empty()
        }

        view Editor {
           action Close {
              let Result = ask Confirm("Draft")
              if Result is Confirmed {
                 dismiss
           }  }
           render Empty()
        }
      `,
    )
  })

  Test('formats overlay presentation before an optional target', async () => {
    await testFormatCode(
      `view Main{action Open{present Detail( )as overlay in Target}}`,
      `
        view Main {
           action Open {
              present Detail() as overlay in Target
        }  }
      `,
    )
  })

  Test('formats keyed app toast presentation with canonical modifiers', async () => {
    await testFormatCode(
      `view Main{action Save{present Saved( )as toast( Key : "document-saved" ,Duration:3)}}`,
      `
        view Main {
           action Save {
              present Saved() as toast (Key: "document-saved", Duration: 3)
        }  }
      `,
    )
  })

  Test('keeps target-only selection activation tight to its app key', async () => {
    await testFormatCode(
      `view Main{action Open{present   WordFlower@workspace}}`,
      `
        view Main {
           action Open {
              present WordFlower@workspace
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
