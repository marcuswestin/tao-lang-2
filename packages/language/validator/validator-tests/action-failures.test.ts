import { Describe, Expect, Test } from '@shared/test'
import { ActionsValidator } from '../validator-src/validators/ActionsValidator'
import { accepts, rejects, validationErrorMessages, withValidatedFiles } from './test-validate'

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

  Test('reports a missing foreign action sidecar at its Tao declaration', async () => {
    await withValidatedFiles('Main.tao', {
      'Main.tao':
        'app Missing { id "missing" version "1.0.0" name "Missing" view Main } view Main() { action Publish() from ./Missing.ts render Empty() } view Empty() { render inject ```ts return null ``` }',
    }, result => {
      Expect(validationErrorMessages(result)).toContain(
        ActionsValidator.messages.foreignActionMissing('./Missing.ts'),
      )
      const diagnostic = result.diagnostics.find(candidate =>
        candidate.message === ActionsValidator.messages.foreignActionMissing('./Missing.ts')
      )
      Expect(diagnostic?.filePath).toContain('Main.tao')
      Expect(diagnostic?.range).toBeDefined()
    })
  })
})
