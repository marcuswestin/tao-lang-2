import { Describe, Test } from '@shared/test'
import { testFormatCode } from './test-format'

Describe('functional core formatter', () => {
  Test('formats functions, total conditionals, toggle, and iteration deterministically', async () => {
    await testFormatCode(
      `function Label Count is number returns text=when Count>0->interpolate "Count: ",Count+1 otherwise->"Empty"\nview Main{state Ready=false action Flip{when Ready->{toggle Ready}otherwise->{toggle Ready}}render Stack() {when Count>0 and not false->{Text(Label(Count))}otherwise->{Text("Empty")}for Name in["Inbox" "Today"]{Text(Name)}}}`,
      `
        function Label Count is number returns text = when
           Count > 0 -> interpolate "Count: ", Count + 1
           otherwise -> "Empty"

        view Main {
           state Ready = false
           action Flip {
              when
                 Ready -> {
                    toggle Ready
                 }
                 otherwise -> {
                    toggle Ready
           }  }
           render Stack() {
              when
                 Count > 0 and not false -> {
                    Text(Label(Count))
                 }
                 otherwise -> {
                    Text("Empty")
                 }
              for Name in ["Inbox" "Today"] {
                 Text(Name)
        }  }  }
      `,
    )
  })

  Test('indents comments with value, action, and render when branches', async () => {
    await testFormatCode(
      `function Choice returns text=when\n// value preferred\ntrue->"yes"\n// value fallback\notherwise->"no"\nview Main{state Ready=true action Flip{when\n// action preferred\nReady->{toggle Ready}\n// action fallback\notherwise->{toggle Ready}}render Stack(){when\n// render preferred\nReady->{Text("yes")}\n// render fallback\notherwise->{Text("no")}}}`,
      `
        function Choice returns text = when
           // value preferred
           true -> "yes"
           // value fallback
           otherwise -> "no"

        view Main {
           state Ready = true
           action Flip {
              when
                 // action preferred
                 Ready -> {
                    toggle Ready
                 }
                 // action fallback
                 otherwise -> {
                    toggle Ready
           }  }
           render Stack() {
              when
                 // render preferred
                 Ready -> {
                    Text("yes")
                 }
                 // render fallback
                 otherwise -> {
                    Text("no")
        }  }  }
      `,
    )
  })

  Test('formats parameter defaults with a space before default', async () => {
    await testFormatCode(
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
    )
  })

  Test('formats positional action callback signatures compactly', async () => {
    await testFormatCode(
      `view Field Change is action ( text,number ),Submit is action ( ){render Text("Field")}`,
      `
        view Field Change is action(text, number), Submit is action() {
           render Text("Field")
        }
      `,
    )
  })
})
