import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import Formatter from '../formatter-src/formatter'
import { formats } from './test-format'

const wordFlowerCurrentPath = Repo.resolvePath('Apps/WordFlower/1 - Current')

Describe('Tao formatter WordFlower apps', () => {
  Test('every current WordFlower source and test sidecar is a formatting fixed point', async () => {
    const sourceByPath: Record<string, string> = {}
    const formattedByPath: Record<string, string> = {}
    const paths: string[] = []
    for await (const path of FS.walk(wordFlowerCurrentPath, { extensions: ['.tao'] })) {
      paths.push(path)
    }
    for (const path of paths.sort()) {
      const relativePath = FS.relativePath(wordFlowerCurrentPath, path)
      sourceByPath[relativePath] = await FS.readText(path)
      formattedByPath[relativePath] = await Formatter.formatFile(path)
    }
    Expect(formattedByPath).toEqual(sourceByPath)
  })
})

Describe('Tao formatter declaration parameters and functions', () => {
  Test(
    'formats mandatory parameter lists, block returns, and early returns',
    formats(
      `public function GoalFraction ( Count number )returns number{if Count==0{return 0}\nreturn Count/10}\nview Main ( ){action Save ( ){ }render Empty()}`,
      `
        public
        function GoalFraction(Count number) returns number {
           if Count == 0 {
              return 0
           }
           return Count / 10
        }

        view Main() {
           action Save() { }
           render Empty()
        }
      `,
    ),
  )
})

Describe('Tao formatter data declarations', () => {
  Test(
    'formats reshaped fields, traits, boolean cases, and bare now defaults',
    formats(
      `
        data Workspaces/Workspace{
        Name text
        CreatedAt time(default now)
        Pinned yes / no
        Documents(owned,ordered)
        index CreatedAt
        order by CreatedAt desc}
        data Documents/Document{Final yes /       Draft no(default Draft) Workspace Author(relation   Accounts)}
      `,
      `
        data Workspaces / Workspace {
           Name text
           CreatedAt time (default now)
           Pinned yes / no
           Documents (owned, ordered)

           index CreatedAt
           order by CreatedAt desc
        }

        data Documents / Document {
           Final yes / Draft no (default Draft)
           Workspace
           Author (relation Accounts)
        }
      `,
    ),
  )
})

Describe('Tao formatter configurable declarations', () => {
  Test(
    'formats declaration-owned nav and datasource contracts with injected implementations',
    formats(
      `public type CustomNav is nav with{Initial ui @key{Label text Content Presentable}nav CustomNavKind from ./CustomNav.ts}\npublic type CustomData is datasource with{StorageKey text provider CustomData from ./CustomData.ts}`,
      `
        public
        type CustomNav is nav with {
           Initial ui
           @key {
              Label text
              Content Presentable
           }

           nav CustomNavKind from ./CustomNav.ts
        }

        public
        type CustomData is datasource with {
           StorageKey text

           provider CustomData from ./CustomData.ts
        }
      `,
    ),
  )

  Test(
    'formats keyed, labeled, named, nested, and bare constructor entries',
    formats(
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
    ),
  )

  Test(
    'keeps qualified declaration-owned constructors tight',
    formats(
      `let Demo=Card . Details { OuterAge }`,
      `
        let Demo = Card.Details {
           OuterAge
        }
      `,
    ),
  )
})

Describe('Tao formatter top-level statements', () => {
  Test(
    'formats keyed SelectionNav items and key-valued Initial',
    formats(
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
    ),
  )

  Test(
    'separates declarations with one blank line and keeps let groups adjacent',
    formats(
      `
        app MyApp { view MainView }
        let Greeting = "Hello"
        let Count = 3
        view MainView() { }
      `,
      `
        app MyApp {
           view MainView
        }

        let Greeting = "Hello"
        let Count = 3

        view MainView() { }
      `,
    ),
  )

  Test(
    'breaks a let group before a declaration that states its visibility',
    formats(
      `
        let Greeting = "Hello"
        workspace
        let Count = 3
        let Trailing = 4
      `,
      `
        let Greeting = "Hello"

        workspace
        let Count = 3
        let Trailing = 4
      `,
    ),
  )

  Test(
    'separates a tagged element from the run above it, but not from its block opening',
    formats(
      `view Main(){render Col(){#first
Text("leading")
Text("plain")
#named
Text("tagged")}}`,
      `
        view Main() {
           render Col() {
              #first
              Text("leading")
              Text("plain")

              #named
              Text("tagged")
        }  }
      `,
    ),
  )

  Test(
    'collapses extra blank lines between declarations',
    formats(
      `
        let Greeting = "Hello"



        view MainView() { }
      `,
      `
        let Greeting = "Hello"

        view MainView() { }
      `,
    ),
  )

  Test(
    'keeps consecutive use statements adjacent',
    formats(
      `
        use Text from @tao/ui
        use Stack from @tao/ui
        view MainView() { render Text("hi") }
      `,
      `
        use Text from @tao/ui
        use Stack from @tao/ui

        view MainView() {
           render Text("hi")
        }
      `,
    ),
  )

  Test(
    'preserves a single existing blank line between consecutive aliases and use statements',
    formats(
      `
        use Text from @tao/ui

        use Stack from @tao/ui
        let Greeting = "a"

        let Count = 3
        view MainView() { }
      `,
      `
        use Text from @tao/ui

        use Stack from @tao/ui

        let Greeting = "a"

        let Count = 3

        view MainView() { }
      `,
    ),
  )

  Test(
    'collapses multiple blank lines between consecutive aliases to one',
    formats(
      `
        let Greeting = "a"



        let Count = 3
        view MainView() { }
      `,
      `
        let Greeting = "a"

        let Count = 3

        view MainView() { }
      `,
    ),
  )

  Test('removes leading blank lines', async () => {
    Expect(await Formatter.formatCode('\n\n   view MainView() { }')).toBe('view MainView() { }\n')
  })

  Test('ends the formatted file with exactly one trailing newline', async () => {
    Expect(await Formatter.formatCode('view MainView() { }\n\n\n')).toBe('view MainView() { }\n')
  })
})

Describe('Tao formatter use statements', () => {
  Test(
    'normalizes use statement spacing',
    formats(
      `use   Text,Stack   from    @tao/ui\nview MainView() { }`,
      `
        use Text, Stack from @tao/ui

        view MainView() { }
      `,
    ),
  )
})

Describe('Tao formatter tests', () => {
  Test(
    'formats v0 Tao test declarations',
    formats(
      `use WordFlower from ./\ntest   "WordFlower"{test "renders"{run   WordFlower\nexpect   text "Hello"\npress   "Add"\nexpect input   placeholder "Title" value   "Draft"\nback\nexpect missing   label "Loading"}}`,
      `
        use WordFlower from ./

        test "WordFlower" {
           test "renders" {
              run WordFlower

              expect text "Hello"
              press "Add"
              expect input placeholder "Title" value "Draft"
              back
              expect missing label "Loading"
           }
        }
      `,
    ),
  )

  Test(
    'keeps test closing braces separate after trailing step comments',
    formats(
      `test "Smoke"{test "renders"{run MyApp\nexpect text "Hello"\n// last step note\n}}`,
      `
        test "Smoke" {
           test "renders" {
              run MyApp

              expect text "Hello"
              // last step note
           }
        }
      `,
    ),
  )
})

Describe('Tao formatter views and blocks', () => {
  Test(
    'formats layout clauses on render sites',
    formats(
      `view MainView(){render Col()[claim 2,content top spread-inset,gap 12,pad 16,margin horizontal 4,width fill]{Text("Label")[width fill,height fill,aligned center,centered]}}`,
      `
        view MainView() {
           render Col() [claim 2, content top spread-inset, gap 12, pad 16, margin horizontal 4, width fill] {
              Text("Label") [width fill, height fill, aligned center, centered]
        }  }
      `,
    ),
  )

  Test(
    'indents nested render blocks and collapses closing braces',
    formats(
      `view MainView(){render Stack(){Text( "a")\nText( "b")}}`,
      `
        view MainView() {
           render Stack() {
              Text("a")
              Text("b")
        }  }
      `,
    ),
  )

  Test(
    'formats named and inline control event handlers',
    formats(
      `view MainView(){render Input(Value:Draft){on change->Entered{set Draft=Entered}\non submit Submit}}`,
      `
        view MainView() {
           render Input(Value: Draft) {
              on change -> Entered { set Draft = Entered }
              on submit Submit
        }  }
      `,
    ),
  )

  Test(
    'formats current query and loop headers',
    formats(
      `view Main(Workspace){render Col(){query Drafts from Workspace.Documents{where   is   Draft}\nloop Drafts/Document{Text(Document.Title)}}}`,
      `
        view Main(Workspace) {
           render Col() {
              query Drafts from Workspace.Documents {
                 where is Draft
              }
              loop Drafts / Document {
                 Text(Document.Title)
        }  }  }
      `,
    ),
  )

  Test(
    'formats query order and limit clauses',
    formats(
      `view Main(Workspace){render Col(){query Drafts from Workspace.Documents{order   by   Ordering desc\nlimit   20}\nloop Drafts/Document{Text(Document.Title)}}}`,
      `
        view Main(Workspace) {
           render Col() {
              query Drafts from Workspace.Documents {
                 order by Ordering desc
                 limit 20
              }
              loop Drafts / Document {
                 Text(Document.Title)
        }  }  }
      `,
    ),
  )

  Test(
    'collapses deep closing brace runs onto one line at the outermost indentation',
    formats(
      `view MainView(){render Stack() {Text("a") {Text("b") {Text("c")}}}}`,
      `
        view MainView() {
           render Stack() {
              Text("a") {
                 Text("b") {
                    Text("c")
        }  }  }  }
      `,
    ),
  )

  Test(
    'keeps a closing brace on its own line when statements follow it',
    formats(
      `view MainView(){render Stack() {Text("a") {Text("b")}\nText( "c")}}`,
      `
        view MainView() {
           render Stack() {
              Text("a") {
                 Text("b")
              }
              Text("c")
        }  }
      `,
    ),
  )

  Test(
    'does not collapse close-looking lines inside block comments',
    formats(
      `
        view MainView() {
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
        view MainView() {
           render Stack() {
              /*
              }
              }
              */
              Text("a")
        }  }
      `,
    ),
  )

  Test(
    'does not treat block-comment markers inside strings as block comments',
    formats(
      `view MainView() { render Stack() { Text("/*") { Text("hi") } } }`,
      `
        view MainView() {
           render Stack() {
              Text("/*") {
                 Text("hi")
        }  }  }
      `,
    ),
  )

  Test(
    'formats empty blocks as braces with one interior space',
    formats(
      `view MainView() {render Stack() {Text("a") {   }}}`,
      `
        view MainView() {
           render Stack() {
              Text("a") { }
        }  }
      `,
    ),
  )

  Test(
    'normalizes view parameter spacing',
    formats(
      `public view CountText(Count number, Label text) { render Text(Label) }`,
      `
        public
        view CountText(Count number, Label text) {
           render Text(Label)
        }
      `,
    ),
  )

  Test(
    'normalizes view invocation argument spacing',
    formats(
      `view MainView() { render Stack() { CountText(3,"label") } }\nview CountText(Count number, Label text) { render Text(Label) }`,
      `
        view MainView() {
           render Stack() {
              CountText(3, "label")
        }  }

        view CountText(Count number, Label text) {
           render Text(Label)
        }
      `,
    ),
  )

  Test(
    'normalizes named invocation and input-test step spacing',
    formats(
      `view MainView(){render Field(Value: "Draft",Disabled: false)}\ntest "Form"{test "entry"{run MyApp enter "Hello"  into label  "Title" submit placeholder  "Title"}}`,
      `
        view MainView() {
           render Field(Value: "Draft", Disabled: false)
        }

        test "Form" {
           test "entry" {
              run MyApp
              enter "Hello" into label "Title"
              submit placeholder "Title"
        }  }
      `,
    ),
  )

  Test(
    'formats state declarations and action bodies',
    formats(
      `view MainView(){state Count=0 action AddStep(Step number){set Count+=Step} action AddFive(){do AddStep(5)} render Stack() {Button("Reset",action{set Count=0}) Button("Inline",->{set Count+=1})}}`,
      `
        view MainView() {
           state Count = 0
           action AddStep(Step number) {
              set Count += Step
           }
           action AddFive() {
              do AddStep(5)
           }
           render Stack() {
              Button("Reset", action { set Count = 0 })
              Button("Inline", -> { set Count += 1 })
        }  }
      `,
    ),
  )

  Test(
    'formats dialogue declarations, asks, and explicit or bare responses',
    formats(
      `dialogue Confirm(Title text) responds ConfirmResult{action Close(){respond Confirmed} action Cancel(){respond} render Empty()} view Editor(){action Close(){let Result=ask Confirm( "Draft" ) if Result is Confirmed{dismiss}} render Empty()}`,
      `
        dialogue Confirm(Title text) responds ConfirmResult {
           action Close() {
              respond Confirmed
           }
           action Cancel() {
              respond
           }
           render Empty()
        }

        view Editor() {
           action Close() {
              let Result = ask Confirm("Draft")
              if Result is Confirmed {
                 dismiss
           }  }
           render Empty()
        }
      `,
    ),
  )

  Test(
    'formats overlay presentation before an optional target',
    formats(
      `view Main(){action Open(){present Detail( )as overlay in Target}}`,
      `
        view Main() {
           action Open() {
              present Detail() as overlay in Target
        }  }
      `,
    ),
  )

  Test(
    'formats keyed app toast presentation with canonical modifiers',
    formats(
      `view Main(){action Save(){present Saved( )as toast( Key : "document-saved" ,Duration:3.s)}}`,
      `
        view Main() {
           action Save() {
              present Saved() as toast (Key: "document-saved", Duration: 3.s)
        }  }
      `,
    ),
  )

  Test(
    'keeps target-only selection activation tight to its app key',
    formats(
      `view Main(){action Open(){present   WordFlower@workspace}}`,
      `
        view Main() {
           action Open() {
              present WordFlower@workspace
        }  }
      `,
    ),
  )

  Test(
    'keeps commented inline actions multiline',
    formats(
      `view MainView() { state Count = 0 render Stack() {
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
        view MainView() {
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
    ),
  )
})

Describe('Tao formatter immutable bindings', () => {
  Test(
    'normalizes canonical let binding spacing',
    formats(
      `public let   Greeting="Hello"\nlet   Legacy="Hello"\nview MainView() { }`,
      `
        public
        let Greeting = "Hello"
        let Legacy = "Hello"

        view MainView() { }
      `,
    ),
  )
})

Describe('Tao formatter types and constructors', () => {
  Test(
    'normalizes type declarations, constructors, casts, lists, and member access',
    formats(
      `type Job is {Title text,Level number}\ntype Person is {Name,Age,Tags,Job}\nlet Demo = Person {Tags: Tags ["a","b"],Job: Job {Level: 2,Title: "Engineer"},Age: 40,Name: "Ada"}\nview Profile(Person) { render Text(Person.Job.Title) }`,
      `
        type Job is {
           Title text,
           Level number
        }

        type Person is {
           Name,
           Age,
           Tags,
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

        view Profile(Person) {
           render Text(Person.Job.Title)
        }
      `,
    ),
  )
})

Describe('Tao formatter project metadata', () => {
  Test(
    'formats project metadata blocks',
    formats(
      `project{name "Package Access" remote   none license   MIT}`,
      `
        project {
           name "Package Access"
           remote none
           license MIT
        }
      `,
    ),
  )
})

Describe('Tao formatter comments', () => {
  Test(
    'keeps top-level comments attached below the blank-line separation',
    formats(
      `
        let Greeting = "hi"

        // the main view
        view MainView() { render Text(Greeting) }
      `,
      `
        let Greeting = "hi"

        // the main view
        view MainView() {
           render Text(Greeting)
        }
      `,
    ),
  )

  Test(
    'preserves and indents comments inside blocks',
    formats(
      `
        view MainView() {
        // local greeting
        let G = "hi"
        render Text(G)
        }
      `,
      `
        view MainView() {
           // local greeting
           let G = "hi"
           render Text(G)
        }
      `,
    ),
  )
})

Describe('Tao formatter error handling', () => {
  Test('throws on Tao source with syntax errors', async () => {
    await Expect(Formatter.formatCode('view Broken() {')).rejects.toThrow(
      'Tao source without syntax errors when formatting',
    )
  })
})
