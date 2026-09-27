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
      view Stack() { render inject Content @@content \`\`\`ts return Content \`\`\` }
      view Text(Value text) { render inject Value \`\`\`ts return null \`\`\` }
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
    Expect(code.slice(selection)).toContain('owner: _TaoActionOwner,')
  })

  Test('leaves non-selectable loop lowering on the two-argument runtime path', async () => {
    const compiled = await Compiler.compileCode(`
      app StaticApp { view Main }
      view Main() {
        render Stack() {
          loop ["One"] / Row { Text(Row) }
        }
      }
      view Stack() { render inject Content @@content \`\`\`ts return Content \`\`\` }
      view Text(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `)

    Expect(compiled.code.match(/_Scope.Row = _TaoFunctionArg0/g)).toHaveLength(1)
    Expect(compiled.code).not.toContain('owner: _TaoActionOwner,')
  })
})
