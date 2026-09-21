import { Describe, Test } from '@shared/test'
import { ActionsValidator } from '../validator-src/validators/ActionsValidator'
import { accepts, rejects } from './test-validate'

Describe('validator: async actions', () => {
  Test(
    'allows async blocks inside named and nested action blocks',
    accepts(`
      action Launch() {
        async {
          async { }
        }
      }
    `),
  )

  Test(
    'reports async outside an action block',
    rejects('async { }', ActionsValidator.messages.asyncPlacement),
  )
})
