import { Describe, Test } from '@shared/test'
import { FunctionalCoreValidator } from '../validator-src/validators/FunctionalCoreValidator'
import { accepts, rejects } from './test-validate'

Describe('validator: action when', () => {
  Test(
    'accepts yes and no cases for a boolean action subject',
    accepts(`
      action Choose(Ready boolean) {
        when Ready {
          yes -> { }
          no -> { }
        }
      }
    `),
  )

  Test(
    'rejects a case that does not belong to the boolean subject',
    rejects(
      `action Choose(Ready boolean) { when Ready { error -> { } } }`,
      FunctionalCoreValidator.messages.invalidCase('error', 'a boolean subject'),
    ),
  )

  Test(
    'detects duplicate canonical yes/no cases',
    rejects(
      `action Choose(Ready boolean) { when Ready { yes -> { } true -> { } } }`,
      FunctionalCoreValidator.messages.duplicateCase('true'),
    ),
  )

  Test(
    'rejects payloads on cases other than error',
    rejects(
      `action Choose(Ready boolean) { when Ready { yes -> Problem { } no -> { } } }`,
      FunctionalCoreValidator.messages.invalidCasePayload,
    ),
  )
})
