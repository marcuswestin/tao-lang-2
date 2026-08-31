import { Describe, Test } from '@shared/test'
import { ActionsValidator } from '../validator-src/validators/ActionsValidator'
import { accepts, rejects } from './test-validate'

Describe('validator: action failures', () => {
  Test(
    'accepts repeated case declarations and native inferred failures',
    accepts(`
    type SaveFailure is one of Offline
    action Save() { fail Offline "Could not save." }
    action Publish() runs latest
      fails Offline "Unavailable."
      fails Offline "Timed out."
      from ./Api.ts
  `),
  )

  Test(
    'rejects runs latest on a native action',
    rejects(
      'action Save() runs latest { }',
      ActionsValidator.messages.runsLatestNative,
    ),
  )

  Test(
    'rejects a non-relative foreign action implementation',
    rejects(
      `
        type SaveFailure is one of Offline
        action Publish() fails Offline "Unavailable." from @tao/api
      `,
      ActionsValidator.messages.foreignActionPath,
    ),
  )
})
