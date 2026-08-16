import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: selectable loops', () => {
  Test('lowers row rendering and selection as sibling callbacks with the same singular binding', async () => {
    const compiled = await Compiler.compileCode(`
      app SelectableApp { view Main }
      view Main() {
        state Selected = ""
        render Stack() {
          loop ["One"] / Row {
            Text(Row)
            on select -> { set Selected = Row }
          }
        }
      }
      layout Stack() { render inject \`\`\`ts return null \`\`\` }
      view Text(Value is text) { render inject Value \`\`\`ts return null \`\`\` }
    `)

    const code = compiled.code
    const loop = code.indexOf('TR.ForEach(')
    const firstBinding = code.indexOf('_Scope.Row = _TaoFunctionArg0', loop)
    const secondBinding = code.indexOf('_Scope.Row = _TaoFunctionArg0', firstBinding + 1)
    const selection = code.indexOf('TR.Set(_Scope.Selected', secondBinding)
    Expect(loop).toBeGreaterThan(-1)
    Expect(firstBinding).toBeGreaterThan(loop)
    Expect(secondBinding).toBeGreaterThan(firstBinding)
    Expect(selection).toBeGreaterThan(secondBinding)
  })

  Test('leaves non-selectable loop lowering on the two-argument runtime path', async () => {
    const compiled = await Compiler.compileCode(`
      app StaticApp { view Main }
      view Main() {
        render Stack() {
          loop ["One"] / Row { Text(Row) }
        }
      }
      layout Stack() { render inject \`\`\`ts return null \`\`\` }
      view Text(Value is text) { render inject Value \`\`\`ts return null \`\`\` }
    `)

    Expect(compiled.code.match(/_Scope.Row = _TaoFunctionArg0/g)).toHaveLength(1)
  })
})
