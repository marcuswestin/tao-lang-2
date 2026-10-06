import { Describe, Test } from '@shared/test'
import { typeValidationMessages as messages } from '../validator-src/validators/types-validator'
import { accepts, rejects } from './test-validate'

Describe('validator: named yes/no state shorthand', () => {
  Test(
    'accepts a same-name yes/no domain',
    accepts(`
    type GroupMode is yes/no
    scene Main { state GroupMode no render "state" }
  `),
  )
  Test(
    'requires an actual same-name domain',
    rejects(
      `
    scene Main { state Missing no }
  `,
      messages.unknownType('Missing'),
    ),
  )
  Test(
    'rejects a same-name nonboolean domain',
    rejects(
      `
    type Caption is text
    scene Main { state Caption no }
  `,
      messages.namedStateBoolean('Caption'),
    ),
  )
})
