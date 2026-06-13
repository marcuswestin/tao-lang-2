import { Describe, Expect, Test } from '@shared/test'
import Compiler from '../compiler-src/compiler'

const tsFence = '```ts'
const fence = '```'

Describe('Tao injection compiler', () => {
  Test('compiles inject arguments', async () => {
    const compiled = await Compiler.compileCode(`
      app MyApp { ui MainView }
      alias UserName = "Ro"
      ui MainView {
        render Text "Hello"
      }
      ui Text Value text {
        render inject Value, Name UserName, Count 3 ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(compiled.code).toContain('function __injection__(Value: string, Name: string, Count: number)')
    Expect(compiled.code).toContain(
      '[_Scope.Value.evaluate().jsValue, _Scope.UserName.evaluate().jsValue, new TR.Value(3).jsValue]',
    )
  })
})
