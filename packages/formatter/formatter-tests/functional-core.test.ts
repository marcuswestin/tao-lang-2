import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('functional core formatter', () => {
  Test(
    'formats functions, total conditionals, toggle, and iteration deterministically',
    formats(
      `function Label Count is number returns text=when(Count>0){true->"Count: {Count+1}" otherwise->"Empty"}\nview Main{state Ready=false action Flip{guard Ready true->{toggle Ready}toggle Ready}render Stack() {when(Count>0 and not false){true->{Text(Label(Count))}otherwise->{Text("Empty")}}loop["Inbox","Today"]/Name{Text(Name)}}}`,
      `
        function Label Count is number returns text = when (Count > 0) {
           true -> "Count: { Count + 1 }"
           otherwise -> "Empty"
        }

        view Main {
           state Ready = false
           action Flip {
              guard Ready true -> {
                 toggle Ready
              }
              toggle Ready
           }
           render Stack() {
              when (Count > 0 and not false) {
                 true -> {
                    Text(Label(Count))
                 }
                 otherwise -> {
                    Text("Empty")
              }  }
              loop ["Inbox", "Today"] / Name {
                 Text(Name)
        }  }  }
      `,
    ),
  )

  Test(
    'indents comments with value, action, and render when branches',
    formats(
      `function Choice returns text=when true{\n// value preferred\ntrue->"yes"\n// value fallback\notherwise->"no"}\nview Main{state Ready=true action Flip{guard Ready{\n// action preferred\ntrue->{toggle Ready}\n// action fallback\nfalse->{toggle Ready}}}render Stack(){when Ready{\n// render preferred\ntrue->{Text("yes")}\n// render fallback\notherwise->{Text("no")}}}}`,
      `
        function Choice returns text = when true {
           // value preferred
           true -> "yes"
           // value fallback
           otherwise -> "no"
        }

        view Main {
           state Ready = true
           action Flip {
              guard Ready {
                 // action preferred
                 true -> {
                    toggle Ready
                 }
                 // action fallback
                 false -> {
                    toggle Ready
           }  }  }
           render Stack() {
              when Ready {
                 // render preferred
                 true -> {
                    Text("yes")
                 }
                 // render fallback
                 otherwise -> {
                    Text("no")
        }  }  }  }
      `,
    ),
  )

  Test(
    'formats parameter defaults with a space before default',
    formats(
      `function Label Value is text default"Save" returns text=Value\nview Main Title is text default"Welcome"{action Submit Message is text default"Saved"{}render Card()}\nlayout Card Gap is number default 8{render inject \`\`\`ts\nreturn null\n\`\`\`}`,
      `
        function Label Value is text default "Save" returns text = Value

        view Main Title is text default "Welcome" {
           action Submit Message is text default "Saved" { }
           render Card()
        }

        layout Card Gap is number default 8 {
           render inject \`\`\`ts
              return null
           \`\`\`
        }
      `,
    ),
  )

  Test(
    'formats enums, general case tests, and one-sided action and render if',
    formats(
      `enum ConfirmResult{Confirmed Cancelled}\nview Main{state Result=Confirmed action Close{if Result is Confirmed{}}render Stack(){if Result is Cancelled{Text("Cancelled")}}}`,
      `
        enum ConfirmResult {
           Confirmed
           Cancelled
        }

        view Main {
           state Result = Confirmed
           action Close {
              if Result is Confirmed { }
           }
           render Stack() {
              if Result is Cancelled {
                 Text("Cancelled")
        }  }  }
      `,
    ),
  )

  Test(
    'formats grouped entity availability guards and their error payload',
    formats(
      `view DocumentScreen Document{render Stack(){guard Document{loading->{Text("Loading")}missing->{Text("Missing")}unauthorized->{Text("Unauthorized")}error->Message{Text(Message)}}DocumentEditor(Document)}}`,
      `
        view DocumentScreen Document {
           render Stack() {
              guard Document {
                 loading -> {
                    Text("Loading")
                 }
                 missing -> {
                    Text("Missing")
                 }
                 unauthorized -> {
                    Text("Unauthorized")
                 }
                 error -> Message {
                    Text(Message)
              }  }
              DocumentEditor(Document)
        }  }
      `,
    ),
  )

  Test(
    'formats positional action callback signatures compactly',
    formats(
      `view Field Change is action ( text,number ),Submit is action ( ){render Text("Field")}`,
      `
        view Field Change is action(text, number), Submit is action() {
           render Text("Field")
        }
      `,
    ),
  )

  Test(
    'formats interpolated expressions without changing literal text or escapes',
    formats(
      `let Greeting="Hello {Name}, next {1+2}!"\nlet Escaped="literal \\{ brace and \\\\ slash"`,
      `
        let Greeting = "Hello { Name }, next { 1 + 2 }!"
        let Escaped = "literal \\{ brace and \\\\ slash"
      `,
    ),
  )
})
