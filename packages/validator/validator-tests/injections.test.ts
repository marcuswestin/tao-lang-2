import { Describe, Test } from '@shared/test'
import { injectionValidationMessages } from '../validator-src/validators/injections-validator'
import { fence, rejects, tsFence } from './test-validate'

Describe('validator: injections', () => {
  Test(
    'rejects duplicate inject argument names',
    rejects(
      `
      app MyApp { view MainView }
      view MainView() {
        render Text("Hello")
      }
      view Text(Value is text) {
        render inject Value, Value "Again" ${tsFence}
          return null
        ${fence}
      }
    `,
      injectionValidationMessages.duplicateArgument('Value'),
    ),
  )
})
