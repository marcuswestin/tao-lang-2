import { Errors, Platform } from '@shared'
import { Test } from '@shared/test'
import { runClerkIosJourney } from './clerk-ios-journey'

/** Actual phone setup and authored Fill values; no synthetic account or email-code bypass.
 * TAO_CLERK_LIVE=1 ./agent unsandboxed studio-smoke packages/ides/studio-tooling/studio-smoke/clerk-ios-review.test.ts
 */
Test('the phone review command signs in with its unchanged Fill buttons on iOS', async () => {
  if (Platform.runtimeProcess.env['TAO_CLERK_LIVE'] !== '1') {
    Errors.throwUserInput('Phone-equivalent iOS review requires TAO_CLERK_LIVE=1 and stored development Clerk keys.')
  }
  await runClerkIosJourney({ kind: 'phone-review' })
}, 900_000)
