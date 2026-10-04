import { Describe, Expect, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: optional parameter types', () => {
  Test('unwraps a foreign action parameter with a none default to its JavaScript value', async () => {
    const compiled = await Compiler.compileCode(`
      app Example { id "com.tao.test.example" version "1.0.0" name "Example"  view Main }
      action ImpactAsync(Style text? default none) from ./Bindings.ts
      action Run() { do ImpactAsync() do ImpactAsync(Style: none) }
      view Main() {
        render inject \`\`\`ts return null \`\`\`
      }
    `)
    const code = compiled.code.replace(/\s+/g, ' ')

    Expect(code).toContain('TR.ForeignAction(')
    Expect(code).toContain('? TR.Value(null) : TR.Value(')
    Expect(code).toContain('_Scope.Style.evaluate().jsValue')
    Expect(code).toContain('requiredArguments: 0')
  })
})
