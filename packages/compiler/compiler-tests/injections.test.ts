import { Describe, Expect, Test } from '@shared/test'
import Compiler from '../compiler-src/compiler'

const tsFence = '```ts'
const fence = '```'

Describe('Tao injection compiler', () => {
  Test('compiles inject arguments', async () => {
    const compiled = await Compiler.compileCode(`
      app MyApp { view MainView }
      alias UserName = "Ro"
      view MainView {
        render Text "Hello"
      }
      view Text Value text {
        render inject Value, Name UserName, Count 3 ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(compiled.files).toHaveLength(1)
    Expect(compiled.validation.diagnostics).toEqual([])
  })
})
