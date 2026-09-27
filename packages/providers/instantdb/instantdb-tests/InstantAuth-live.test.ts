import { Platform } from '@shared'
import { Assert, Errors } from '@shared/core'
import { Describe, Expect, MockModule, Test } from '@shared/test'
import type { InstantSDK } from '../instantdb-src/instant-clients'
import { InstantAuthProvider } from '../instantdb-src/InstantAuth'

// The React Native SDK's two native modules, doubled so it loads under Bun (see `bunInstantSDK`).
MockModule('react-native-get-random-values', () => ({}))
MockModule('@react-native-community/netinfo', () => ({
  default: { addEventListener: () => () => {}, fetch: async () => ({ isConnected: true }) },
}))

// Run explicitly against the machine's local InstantDB (`./agent unsandboxed local-instantdb start`):
// TAO_INSTANT_LIVE_API_URL=http://localhost:9020 ./agent test-file packages/providers/instantdb/instantdb-tests/InstantAuth-live.test.ts
// A self-hosted InstantDB sends no email, so the test mints the code through the admin API.
const apiURI = Platform.runtimeProcess.env['TAO_INSTANT_LIVE_API_URL']
const liveTest = apiURI === undefined ? Test['skip'] : Test
const timeout = 120_000
const live = (): AbortSignal => new AbortController().signal

Describe('InstantAuth against local InstantDB (requires TAO_INSTANT_LIVE_API_URL)', () => {
  liveTest('signs in with an email code, proves the session, and signs out', async () => {
    const app = await ephemeralApp()
    const sdk = await bunInstantSDK()
    const connection = InstantAuthProvider(() => sdk).connect({
      configuration: {
        ApiURI: app.apiURI,
        AppId: app.id,
        WebsocketURI: `${app.apiURI.replace(/^http/, 'ws')}/runtime/session`,
      },
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

async function ephemeralApp() {
  const base = new URL(apiURI!).origin
  Assert.input(
    ['localhost', '127.0.0.1'].includes(new URL(base).hostname),
    'The InstantDB live tests run only against a local InstantDB.',
  )
  const created = await fetch(`${base}/dash/apps/ephemeral`, {
    body: JSON.stringify({ title: `Tao InstantAuth ${Platform.randomUUID()}` }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  Expect(created.status).toBe(200)
  const { app } = await created.json() as { app: { 'admin-token': string; id: string } }
  const post = async (path: string, body: unknown, headers: Record<string, string>) => {
    const response = await fetch(`${base}${path}`, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
      method: 'POST',
    })
    if (!response.ok) {
      Errors.throwHostEnvironment(`InstantDB ${path} failed: ${await response.text()}`)
    }
    return await response.json() as Record<string, unknown>
  }
  return {
    apiURI: base,
    id: app.id,
    /** magicCode mints the code the local server would have emailed. */
    magicCode: async (email: string) => {
      const { code } = await post('/admin/magic_code', { email }, {
        'app-id': app.id,
        authorization: `Bearer ${app['admin-token']}`,
      }) as { code: string }
      return code
    },
    verifyRefreshToken: async (refreshToken: string) => {
      const { user } = await post('/runtime/auth/verify_refresh_token', {
        'app-id': app.id,
        'refresh-token': refreshToken,
      }, {}) as { user: { id: string } }
      return user
    },
  }
}

/**
 * Mirrors `bunInstantSDK` in `instantdb-live.test.ts`: the React Native SDK itself under Bun, with
 * in-memory storage through the SDK's `Store` option and a `window` so the SDK connects.
 */
async function bunInstantSDK(): Promise<InstantSDK> {
  const native = await import('@instantdb/react-native')
  const host = globalThis as { window?: unknown }
  host.window ??= globalThis
  class MemoryStore extends native.StoreInterface {
    private readonly values = new Map<string, unknown>()
    async getItem(key: string) {
      return this.values.get(key) ?? null
    }
    async removeItem(key: string) {
      this.values.delete(key)
    }
    async multiSet(pairs: Array<[string, unknown]>) {
      for (const [key, value] of pairs) {
        this.values.set(key, value)
      }
    }
    async getAllKeys() {
      return [...this.values.keys()]
    }
  }
  return {
    i: native.i,
    id: native.id,
    init: config => native.init({ ...config, Store: MemoryStore }),
    tx: native.tx,
  }
}
