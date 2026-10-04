import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: async actions', () => {
  Test('launches an isolated action block without awaiting the following statement', async () => {
    const compiled = await Compiler.compileCode(`
      app AsyncApp { view Main }
      view Main() {
        state Ready = false
        action Launch() {
          async {
            toggle Ready
          }
          set Ready = false
        }
        render Text("Ready")
      }
      view Text(Value text) {
        render inject Value \`\`\`ts
          return null
        \`\`\`
      }
    `)

    const code = compiled.code
    const launch = code.indexOf('TR.Async(() =>')
    const launchedToggle = code.indexOf('TR.Toggle(', launch)
    const followingSet = code.indexOf('TR.Set(', launchedToggle)
    Expect(launch).toBeGreaterThan(-1)
    Expect(launchedToggle).toBeGreaterThan(launch)
    Expect(followingSet).toBeGreaterThan(launchedToggle)
    Expect(code).not.toMatch(/\bawait\s+TR\.Async\s*\(/)
    Expect(code.slice(launch, followingSet)).toContain('TR.BlockScope(_Scope, async _Scope =>')
  })
})
