import { Describe, Expect, Test } from '@shared/test'
import Compiler from '../compiler-src/compiler'

Describe('functional core compiler', () => {
  Test('compiles pure functions and render control flow through validated Tao', async () => {
    const compiled = await Compiler.compileCode(`
      app FunctionalApp { view Main }
      function HasCount Count is number returns boolean = Count > 0
      function Label Count is number returns text = interpolate "Count: ", Count
      view Main {
        render Stack(){
          if HasCount(2) {
            Text(Label(2))
          } else {
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
  })
})
