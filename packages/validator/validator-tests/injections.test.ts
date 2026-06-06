import { Describe, Expect, Test } from '@shared/test'
import { injectionValidationMessages } from '../validator-src/injections-validator'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

const tsFence = '```ts'
const fence = '```'

Describe('Tao injection validator', () => {
  Test('allows inject arguments that bind visible values as TS locals', async () => {
    await testValidateCode(`
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

  Test('rejects duplicate inject argument names', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Text "Hello"
      }
      ui Text Value text {
        render inject Value, Value "Again" ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(injectionValidationMessages.duplicateArgument('Value'))
  })
})
