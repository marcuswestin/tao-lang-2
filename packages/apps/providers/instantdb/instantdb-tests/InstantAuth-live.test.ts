import { Platform } from '@shared'
import { Assert } from '@shared/core'
import { Describe, Expect, MockModule, Test } from '@shared/test'
import { InstantAuthProvider } from '../instantdb-src/InstantAuth'
import { bunInstantSDK, ephemeralApp, localInstantAddress } from './fixtures'

// The React Native SDK's two native modules, doubled so it loads under Bun (see `bunInstantSDK`).
MockModule('react-native-get-random-values', () => ({}))
MockModule('@react-native-community/netinfo', () => ({
  default: { addEventListener: () => () => {}, fetch: async () => ({ isConnected: true }) },
}))

// Run explicitly against the machine's local InstantDB (`./agent unsandboxed local-instantdb start`):
// TAO_INSTANT_LIVE_API_URL=http://localhost:9020 ./agent test-file packages/apps/providers/instantdb/instantdb-tests/InstantAuth-live.test.ts
// A self-hosted InstantDB sends no email, so the test mints the code through the admin API.
const apiURI = Platform.runtimeProcess.env['TAO_INSTANT_LIVE_API_URL']
const liveTest = apiURI === undefined ? Test['skip'] : Test
const timeout = 120_000
const live = (): AbortSignal => new AbortController().signal

Describe('InstantAuth against local InstantDB (requires TAO_INSTANT_LIVE_API_URL)', () => {
  liveTest('signs in with an email code, proves the session, and signs out', async () => {
    const app = await ephemeralApp(apiURI!, 'Tao InstantAuth')
    const sdk = await bunInstantSDK()
    const connection = InstantAuthProvider(() => sdk).connect({
      configuration: localInstantAddress(app),
    })
    try {
      Expect(await connection.restore(live())).toEqual({ state: 'SignedOut' })
      const sent = await connection.signIn({ fields: { Email: 'alice@example.test' }, method: 'EmailCode' }, live())
      Expect(sent.outcome).toEqual({ status: 'completed' })
      Expect(sent.session?.state).toBe('ChallengeRequired')
      const challengeId = sent.session!.challenge!.id

      const refused = await connection.signIn({
        challengeId,
        fields: { Code: '000000', Email: 'alice@example.test' },
        method: 'EmailCode',
      }, live())
      Expect(refused).toEqual({ outcome: { message: 'The code was not accepted. Try again.', status: 'rejected' } })

      const code = await app.magicCode('alice@example.test')
      const signedIn = await connection.signIn({
        challengeId,
        fields: { Code: code, Email: 'alice@example.test' },
        method: 'EmailCode',
      }, live())
      Expect(signedIn.outcome).toEqual({ status: 'completed' })
      const principal = signedIn.session?.principal
      Expect(principal).toMatchObject({ email: 'alice@example.test', issuer: `instantdb:${app.id}` })
      Expect(principal?.subject).toMatch(/^[0-9a-f-]{36}$/)
      Expect(await connection.restore(live())).toEqual(signedIn.session)

      const proof = await connection.proof({ kind: 'Session', signal: live() })
      Expect(proof).toMatchObject({ issuer: `instantdb:${app.id}`, kind: 'Session', subject: principal!.subject })
      Assert(proof.kind === 'Session', 'InstantAuth issued a Session proof')
      // The proof's refresh token is one the server accepts for the same user.
      Expect((await app.verifyRefreshToken(String(proof.value['refreshToken']))).id).toBe(principal!.subject)

      Expect(await connection.signOut(live())).toEqual({ status: 'completed' })
      Expect(await connection.restore(live())).toEqual({ state: 'SignedOut' })
      await Expect(connection.proof({ kind: 'Session', signal: live() })).rejects.toThrow(
        'Sign in again to access account data.',
      )
    } finally {
      connection.close!()
    }
  }, timeout)
})
