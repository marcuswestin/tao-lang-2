import { Describe, Expect, stubView, Test } from '@shared/test'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: associated module publication', () => {
  Test('publishes its private witness without a runtime nominal type binding', async () => {
    const compiled = await Compiler.compileCode(`
      let __tao_associated_witness_1__ = "authored"
      type Token is text with {
        func ToText() -> text { return Token }
      }
      app WitnessApp { id "com.tao.test.witness" version "1.0.0" name "Witness" view Main }
      ${stubView('Main')}
    `)
    Expect(compiled.code).toContain('const __tao_associated_witness_1__1 = {')
    Expect(compiled.code).toContain('export { __tao_associated_witness_1__1 }')
    Expect(compiled.code).toContain('_Scope.Token = _TaoAssociatedReceiver')
    Expect(compiled.code).not.toContain('export const Token')
    Expect(compiled.code).not.toContain('_Scope.Token = TR.Type')
  })
})
