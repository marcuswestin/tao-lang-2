import { Describe, Expect, Test } from '@shared/test'
import { testCompileCode } from './test-compile'

const tsFence = '```ts'
const fence = '```'

Describe('Tao injection compiler', () => {
  Test('compiles inject arguments', async () => {
    await testCompileCode(`
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
  })

  Test('rejects inject in multi-statement view blocks explicitly', async () => {
    await Expect(testCompileCode(`
      app MyApp { ui MainView }
      ui MainView {
        render inject ${tsFence}
          return <RN.Text>Hello</RN.Text>
        ${fence}
        render MainView
      }
    `)).rejects.toThrow()
  })
})
