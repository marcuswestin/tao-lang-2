import TR from '@runtime/TR'
import { Platform } from '@shared'
import { Assert } from '@shared/core'
import { Describe, Expect, MockModule, Test, until } from '@shared/test'
import { acquireInstantClient } from '../instantdb-src/instant-clients'
import { pushInstantSchema } from '../instantdb-src/instant-push'
import { instantRules } from '../instantdb-src/instant-rules'
import { instantMapping } from '../instantdb-src/instant-schema'
import { InstantAuthProvider, InstantDBProvider } from '../instantdb-src/InstantDB'
import {
  alternateHost,
  bunInstantSDK,
  type EphemeralApp,
  ephemeralApp,
  localInstantAddress,
  notesPolicy,
  notesSchema,
} from './fixtures'

// The React Native SDK's two native modules, doubled so it loads under Bun (see `bunInstantSDK`).
MockModule('react-native-get-random-values', () => ({}))
MockModule('@react-native-community/netinfo', () => ({
  default: { addEventListener: () => () => {}, fetch: async () => ({ isConnected: true }) },
}))

// Run explicitly against the machine's local InstantDB (`./agent unsandboxed local-instantdb start`):
// TAO_INSTANT_LIVE_API_URL=http://localhost:9020 ./agent test-file packages/providers/instantdb/instantdb-tests/InstantDB-sign-in-live.test.ts
// A self-hosted InstantDB sends no email, so the test mints each code through the admin API.
const apiURI = Platform.runtimeProcess.env['TAO_INSTANT_LIVE_API_URL']
const liveTest = apiURI === undefined ? Test['skip'] : Test
const timeout = 120_000
const required: readonly TR.RequiredField[] = [['DisplayName', 'Enter your name']]

Describe('InstantAuth signing in to InstantDB through the runtime (requires TAO_INSTANT_LIVE_API_URL)', () => {
  liveTest('an email code signs in, creates the account row, and keeps notes to their owner', async () => {
    const app = await ephemeralApp(apiURI!, 'Tao InstantDB sign-in')
    const mapping = instantMapping(notesSchema)
    await pushInstantSchema(app.target, { rules: instantRules(mapping, notesPolicy), schema: mapping.schema })
    const alice = await mountedApp(app, app.apiURI)
    const bob = await mountedApp(app, alternateHost(app.apiURI))
    try {
      const aliceId = await alice.signIn('alice@example.test')
      Expect(aliceId).toMatch(/^[0-9a-f-]{36}$/)
      Expect(alice.scope.session.identity).toEqual({
        accountId: aliceId,
        issuer: `instantdb:${app.id}`,
        subject: aliceId,
      })
      // The account row exists, linked to its `$users` row, and reads as an incomplete profile.
      Expect(accountUsers(await app.adminQuery('accounts', { $user: {} }))).toEqual([[aliceId, aliceId]])
      const account = TR.Auth.Account(alice.scope, alice.declaration, 'Account')
      await until(() => TR.Data.EntityAvailability(account.evaluate().jsValue)?.status === 'available', {
        description: "alice's account row to load",
      })
      Expect(TR.IsIncomplete(account, required).jsValue).toBe(true)

      // Completing the profile waits for InstantDB's receipt, then reads back as complete.
      Expect(await TR.Auth.SaveProfile(alice.scope, account, { DisplayName: TR.Value('Alice') })).toEqual({
        status: 'completed',
      })
      Expect((await app.queryAs('alice@example.test', 'accounts')).map(row => row['displayName'])).toEqual(['Alice'])
      await until(() => TR.IsIncomplete(account, required).jsValue === false, {
        description: "alice's completed profile to load",
      })

      TR.Data.Create(alice.store, 'Note', {
        Body: TR.Value('alice private'),
        Owner: TR.Value(alice.store.entity('Account', aliceId)),
        Status: TR.Value('Draft'),
      })
      await alice.store.settle()
      Expect((await app.queryAs('alice@example.test', 'notes')).map(row => row['body'])).toEqual(['alice private'])

      // A second person signs in on another client: their own account row, and none of alice's notes.
      const bobId = await bob.signIn('bob@example.test')
      Expect(bobId).not.toBe(aliceId)
      Expect((await app.adminQuery('accounts')).map(row => row['id']).sort()).toEqual([aliceId, bobId].sort())
      await until(() => bob.rows('Account').length === 1, { description: "bob's account row to load" })
      Expect(bob.rows('Account').map(row => row['Id'])).toEqual([bobId])
      Expect(bob.rows('Note')).toEqual([])
      Expect(await app.queryAs('bob@example.test', 'notes')).toEqual([])
      Expect(alice.rows('Note').map(row => row['Body'])).toEqual(['alice private'])

      // Signing in again finds the row it created rather than creating another.
      Expect(await alice.signOut()).toEqual({ status: 'completed' })
      Expect(await alice.signIn('alice@example.test')).toBe(aliceId)
      Expect((await app.adminQuery('accounts')).length).toBe(2)

      // After sign-out the datasource's proof is refused, and so is authenticating with it again.
      const context = alice.authentications.at(-1)!
      Expect(await alice.signOut()).toEqual({ status: 'completed' })
      Expect(alice.scope.session.state).toBe('SignedOut')
      await Expect(context.proof('Session', new AbortController().signal)).rejects.toThrow(
        'Sign in to access this resource.',
      )
      await Expect(alice.provider.authenticate!(context)).rejects.toThrow('Sign in to access this resource.')
    } finally {
      alice.dispose()
      bob.dispose()
    }
  }, timeout)

  liveTest('two clients signing in as one new user at once both resolve its one account row', async () => {
    const app = await ephemeralApp(apiURI!, 'Tao InstantDB sign-in race')
    const mapping = instantMapping(notesSchema)
    await pushInstantSchema(app.target, { rules: instantRules(mapping, notesPolicy), schema: mapping.schema })
    const user = await app.user('carol@example.test')
    const sdk = await bunInstantSDK()
    const provider = InstantDBProvider(() => sdk)
    const lifetime = new AbortController()
    // A client whose user changes before its websocket has delivered a message retries over SSE,
    // which never connects under Bun; hold each client until its websocket is up.
    const clients = await Promise.all([app.apiURI, alternateHost(app.apiURI)].map(async origin => {
      const configuration = localInstantAddress(app, origin)
      const lease = acquireInstantClient(sdk, {
        apiURI: configuration.ApiURI,
        appId: app.id,
        websocketURI: configuration.WebsocketURI,
      })
      let status: unknown
      const stop = lease.db.core.subscribeConnectionStatus(next => {
        status = next
      })
      await until(() => status === 'authenticated', { description: `the client at ${origin} to connect` })
      stop()
      return lease
    }))
    const authenticate = (origin: string) => {
      const configuration = localInstantAddress(app, origin)
      const context: TR.DataAuthenticationContext = {
        configuration,
        schema: notesSchema,
        principal: { issuer: `instantdb:${app.id}`, subject: user.id },
        provider: 'InstantAuth',
        proof: (async () => ({
          issuer: `instantdb:${app.id}`,
          kind: 'Session',
          provider: 'InstantAuth',
          subject: user.id,
          value: {
            apiURI: configuration.ApiURI,
            appId: app.id,
            refreshToken: user.refreshToken,
            websocketURI: configuration.WebsocketURI,
          },
        })) as TR.DataAuthenticationContext['proof'],
        signal: lifetime.signal,
      }
      return provider.authenticate!(context)
    }
    // Two addresses are two clients, each signed in by the token alone.
    const results = await Promise.all([authenticate(app.apiURI), authenticate(alternateHost(app.apiURI))])
    Expect(results.map(result => result.accountId)).toEqual([user.id, user.id])
    Expect(accountUsers(await app.adminQuery('accounts', { $user: {} }))).toEqual([[user.id, user.id]])
    await Promise.all(results.map(result => result.release!(new AbortController().signal)))
    for (const lease of clients) {
      lease.release()
    }
  }, timeout)
})

/** accountUsers pairs each account row's id with the id of the `$users` row it links to. */
function accountUsers(rows: readonly Record<string, unknown>[]): [unknown, unknown][] {
  return rows.map(row => {
    const linked = row['$user']
    const user = Array.isArray(linked) ? linked[0] : linked
    return [row['id'], (user as { id?: unknown } | undefined)?.id]
  })
}

/**
 * mountedApp is the runtime's app scope over InstantAuth and InstantDB at one address, both
 * declared with their pairing as the compiler emits it. It records each authentication context the
 * runtime hands the datasource, so the test can replay one after sign-out.
 */
async function mountedApp(app: EphemeralApp, origin: string) {
  const sdk = await bunInstantSDK()
  const configuration = localInstantAddress(app, origin)
  const base = InstantDBProvider(() => sdk)
  const authentications: TR.DataAuthenticationContext[] = []
  const provider: TR.DataProvider = {
    ...base,
    authenticate: context => {
      authentications.push(context)
      return base.authenticate!(context)
    },
  }
  const auth = TR.Auth.Configure(
    TR.Auth.Declaration('InstantAuth', InstantAuthProvider(() => sdk), { issues: ['Session'] }),
    configuration,
  )
  const source = TR.Data.Configure(
    TR.Data.Declaration('InstantDB', provider, undefined, {
      accepts: [{ from: 'InstantAuth', kind: 'Session' }],
      supports: [],
    }),
    configuration,
  )
  const scope = TR.Auth.CreateScope(auth)
  const declaration = TR.Data.Schema(notesSchema)
  scope.bindDatasources([{ source, store: declaration }])
  await scope.restore()
  Expect(scope.session.state).toBe('SignedOut')
  const store = scope.store(declaration)
  return {
    authentications,
    declaration,
    provider,
    scope,
    store,
    dispose: () => scope.dispose(),
    rows: (entity: string): Record<string, unknown>[] =>
      (JSON.parse(store.captureSnapshot()) as { rows: Record<string, Record<string, unknown>[]> }).rows[entity]
        ?? [],
    /** signIn requests a code, redeems the one the server minted, and waits for the account. */
    signIn: async (email: string): Promise<string> => {
      Expect(await scope.signIn({ fields: { Email: email }, method: 'EmailCode' })).toEqual({ status: 'completed' })
      const challenge = scope.session.challenge
      Assert(challenge !== undefined, 'the first email-code step reports a challenge')
      const outcome = await scope.signIn({
        challengeId: challenge.id,
        fields: { Code: await app.magicCode(email), Email: email },
        method: 'EmailCode',
      })
      Expect(outcome).toEqual({ status: 'completed' })
      const identity = await until(() => scope.session.state === 'SignedIn' ? scope.session.identity : undefined, {
        description: `${email} to finish signing in`,
      })
      await store.settle()
      return identity.accountId
    },
    signOut: () => scope.signOut(),
  }
}
