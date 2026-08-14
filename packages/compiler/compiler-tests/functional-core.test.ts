import { Describe, Expect, Test } from '@shared/test'
import Compiler from '../compiler-src/compiler'

Describe('functional core compiler', () => {
  Test('compiles pure functions and total control flow through validated Tao', async () => {
    const compiled = await Compiler.compileCode(`
      app FunctionalApp { view Main }
      function HasCount Count is number returns boolean = Count > 0
      function Label Count is number returns text = when
        Count > 0 -> interpolate "Count: ", Count
        otherwise -> "Empty"
      view Main {
        state Ready = false
        action Flip {
          when
            Ready -> { toggle Ready }
            otherwise -> { toggle Ready }
        }
        render Stack(){
          when
            HasCount(2) -> {
            Text(Label(2))
            }
            otherwise -> {
            Text("Empty")
            }
          for Name in ["Inbox" "Today"] {
            Text(Name)
          }
        }
      }
      layout Stack { render inject \`\`\`ts\nreturn null\n\`\`\` }
      view Text Value is text { render inject Value \`\`\`ts\nreturn null\n\`\`\` }
    `)

    Expect(compiled.validation.diagnostics).toEqual([])
    Expect(compiled.files).toHaveLength(1)
    Expect(compiled.files[0]?.code).toContain('TR.When([')
    Expect(compiled.files[0]?.code).toContain('TR.WhenRender([')
    Expect(compiled.files[0]?.code).toContain('TR.WhenAction([')
    Expect(compiled.files[0]?.code).toContain('TR.Toggle(')
  })

  Test('lowers typed defaults in view, layout, action, and function callee scopes', async () => {
    const compiled = await Compiler.compileCode(`
      app DefaultsApp { view Main }
      function Label Value is text default "Save" returns text = Value
      view Main {
        action Submit Message is text default "Saved" { }
        render Card(){ Greeting() }
      }
      layout Card Gap is number default 8 { render inject \`\`\`ts\nreturn null\n\`\`\` }
      view Greeting Title is text default "Welcome" { render inject \`\`\`ts\nreturn null\n\`\`\` }
    `)

    Expect(compiled.validation.diagnostics).toEqual([])
    const code = compiled.files[0]?.code ?? ''
    Expect(code).toContain('_ViewProps.Title ?? TR.Value("Welcome")')
    Expect(code).toContain('_ViewProps.Gap ?? TR.Value(8)')
    Expect(code).toContain('_TaoActionArg0 ?? TR.Value("Saved")')
    Expect(code).toContain('_TaoFunctionArg0 ?? TR.Value("Save")')
  })
})
