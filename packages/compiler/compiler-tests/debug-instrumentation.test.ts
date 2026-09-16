import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

const source = `
  app Main { view Root }
  view Root() {
    state Ready = false
    action Bump() {
      toggle Ready
      set Ready = false
    }
    render Text("Ready")
  }
  view Text(Value text) {
    render inject Value \`\`\`ts
      return null
    \`\`\`
  }
`

Describe('compiler: debugger instrumentation', () => {
  Test('emits a gate before every action statement under debug', async () => {
    const compiled = await Compiler.compileCode(source, { debug: true })
    const code = compiled.code
    Expect(code).toContain(`await TR.Debug.At({ action: "Bump", path: "0" }, _Scope)`)
    Expect(code).toContain(`await TR.Debug.At({ action: "Bump", path: "1" }, _Scope)`)
  })

  Test('emits nothing without debug', async () => {
    const compiled = await Compiler.compileCode(source)
    Expect(compiled.code).not.toContain('TR.Debug.At')
  })
})
