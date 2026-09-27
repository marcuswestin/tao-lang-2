import { Errors, Platform } from '@shared'
import { Test } from '@shared/test'
import { withClerkInstant } from './clerk-instant'
import { runClerkIosJourney } from './clerk-ios-journey'
import { loadClerkLiveConfiguration } from './clerk-testing-token'

/** Explicit live pre-MVP proof; never substitutes for the default deterministic auth suite.
 * TAO_CLERK_LIVE=1 TAO_INSTANT_LIVE_API_URL=http://localhost:9020 ./agent unsandboxed studio-smoke packages/ides/studio-tooling/studio-smoke/clerk-ios-auth.test.ts
 * Creates its own simulator, synthetic Clerk user and ephemeral Instant app. No existing device is reset.
 */
Test('real iOS Clerk sessions persist Account and Note data in Instant and clear it on sign-out', async () => {
  const env = Platform.runtimeProcess.env
  const configuration = await loadClerkLiveConfiguration(env)
  if (configuration === undefined || env['TAO_INSTANT_LIVE_API_URL'] === undefined) {
    Errors.throwUserInput(
      'iOS Clerk acceptance requires TAO_CLERK_LIVE=1 and TAO_INSTANT_LIVE_API_URL=http://localhost:9020.',
    )
  }
  await withClerkInstant(env['TAO_INSTANT_LIVE_API_URL'], async instant => {
    if (instant === undefined) {
      Errors.throwUnexpected('iOS acceptance requires real Instant storage.')
    }
    await runClerkIosJourney({ kind: 'synthetic', configuration, instant })
  })
}, 900_000)
