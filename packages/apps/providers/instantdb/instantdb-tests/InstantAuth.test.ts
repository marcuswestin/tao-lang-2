import type TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { acquireInstantClient } from '../instantdb-src/instant-clients'
import { InstantAuthProvider } from '../instantdb-src/InstantAuth'

type FakeUser = { email?: string; id: string; refresh_token: string }

let appCounter = 0
/** Every test takes its own app id, because the client registry is shared by the whole process. */
const nextAppId = (): string => `auth-app-${++appCounter}`
const live = (): AbortSignal => new AbortController().signal
const alice: FakeUser = { email: 'alice@example.test', id: 'user-alice', refresh_token: 'refresh-alice' }

function connect(sdk: ReturnType<typeof fakeInstantSDK>, configuration: Record<string, unknown>) {
  return InstantAuthProvider(() => sdk.instantSDK as never).connect({ configuration })
}

async function signInWithCode(connection: TR.AuthConnection, email = 'alice@example.test', code = '123456') {
  const sent = await connection.signIn({ fields: { Email: email }, method: 'EmailCode' }, live())
  return connection.signIn({
    challengeId: sent.session!.challenge!.id,
    fields: { Code: code, Email: email },
    method: 'EmailCode',
  }, live())
}

Describe('InstantAuth provider', () => {
  Test('sends an email code, then signs in with it on the client an InstantDB datasource shares', async () => {
    const sdk = fakeInstantSDK()
    const appId = nextAppId()
    const connection = connect(sdk, {
      ApiURI: ' http://localhost:9020 ',
      AppId: ` ${appId} `,
      WebsocketURI: 'ws://localhost:9020/runtime/session',
    })
    Expect(connection.capabilities.methods).toEqual(['EmailCode'])
    Expect(sdk.inits).toEqual([{
      apiURI: 'http://localhost:9020',
      appId,
      websocketURI: 'ws://localhost:9020/runtime/session',
    }])
    // A datasource at the same address leases the auth provider's client rather than a second one.
    const datasource = acquireInstantClient(sdk.instantSDK as never, {
      apiURI: 'http://localhost:9020',
      appId,
      websocketURI: 'ws://localhost:9020/runtime/session',
    })
    Expect(datasource.db).toBe(sdk.databases[0])

    Expect(await connection.restore(live())).toEqual({ state: 'SignedOut' })
    const sent = await connection.signIn({ fields: { Email: ' alice@example.test ' }, method: 'EmailCode' }, live())
    Expect(sdk.sentCodes).toEqual(['alice@example.test'])
    Expect(sent).toEqual({
      outcome: { status: 'completed' },
      session: { challenge: { id: 'instant-id-1', kind: 'EmailCode' }, state: 'ChallengeRequired' },
    })

    const verified = await connection.signIn({
      challengeId: 'instant-id-1',
      fields: { Code: ' 123456 ', Email: 'alice@example.test' },
      method: 'EmailCode',
    }, live())
    Expect(sdk.checkedCodes).toEqual([{ code: '123456', email: 'alice@example.test' }])
    Expect(verified).toEqual({
      outcome: { status: 'completed' },
      session: {
        principal: { email: 'alice@example.test', issuer: `instantdb:${appId}`, subject: 'user-alice' },
        state: 'SignedIn',
      },
    })

    // The code step still knows the email when the flow sends only the challenge and the code.
    await connection.signOut(live())
    const resent = await connection.signIn({ fields: { Email: 'alice@example.test' }, method: 'EmailCode' }, live())
    Expect(
      (await connection.signIn({
        challengeId: resent.session!.challenge!.id,
        fields: { Code: '123456' },
        method: 'EmailCode',
      }, live())).outcome,
    ).toEqual({ status: 'completed' })
    Expect(sdk.checkedCodes.at(-1)).toEqual({ code: '123456', email: 'alice@example.test' })

    connection.close!()
    Expect(sdk.shutdowns).toBe(0)
    datasource.release()
    Expect(sdk.shutdowns).toBe(1)
  })

  Test('rejects a refused email or code, errors on transport failure, and honours cancellation', async () => {
    const sdk = fakeInstantSDK()
    const connection = connect(sdk, { AppId: nextAppId() })

    Expect(await connection.signIn({ fields: { Password: 'secret' }, method: 'Password' }, live())).toEqual({
      outcome: { message: 'This provider supports email code sign-in.', status: 'rejected' },
    })
    Expect(await connection.signIn({ fields: { Email: 'not an email' }, method: 'EmailCode' }, live())).toEqual({
      outcome: { message: 'Enter a valid email address.', status: 'rejected' },
    })
    Expect(sdk.sentCodes).toEqual([])

    sdk.failNext('send', apiError(400))
    Expect((await connection.signIn({ fields: { Email: 'a@b.test' }, method: 'EmailCode' }, live())).outcome).toEqual({
      message: 'Unable to send a code to that email. Check the address and try again.',
      status: 'rejected',
    })
    sdk.failNext('send', new TypeError('Network request failed'))
    Expect((await connection.signIn({ fields: { Email: 'a@b.test' }, method: 'EmailCode' }, live())).outcome).toEqual({
      message: 'Unable to send a sign-in code. Check your connection and try again.',
      status: 'error',
    })

    Expect((await signInWithCode(connection, 'alice@example.test', '000000')).outcome).toEqual({
      message: 'The code was not accepted. Try again.',
      status: 'rejected',
    })
    Expect(
      (await connection.signIn({ challengeId: 'unknown', fields: { Code: '123456' }, method: 'EmailCode' }, live()))
        .outcome,
    ).toEqual({ message: 'Request a new code to sign in.', status: 'rejected' })
    const sent = await connection.signIn({ fields: { Email: 'alice@example.test' }, method: 'EmailCode' }, live())
    Expect(
      (await connection.signIn({
        challengeId: sent.session!.challenge!.id,
        fields: { Code: ' ', Email: 'alice@example.test' },
        method: 'EmailCode',
      }, live())).outcome,
    ).toEqual({ message: 'Enter the code from your email.', status: 'rejected' })
    sdk.failNext('check', apiError(500))
    Expect((await signInWithCode(connection)).outcome).toEqual({
      message: 'Unable to check the code. Check your connection and try again.',
      status: 'error',
    })
    sdk.failNext('check', apiError(429))
    Expect((await signInWithCode(connection)).outcome).toEqual({
      message: 'Too many attempts. Wait a moment and try again.',
      status: 'rejected',
    })

    const aborted = new AbortController()
    aborted.abort()
    Expect(await connection.signIn({ fields: { Email: 'a@b.test' }, method: 'EmailCode' }, aborted.signal)).toEqual({
      outcome: { status: 'cancelled' },
    })

    // A cancellation that arrives while the code is checked signs the persisted user back out.
    const cancelling = new AbortController()
    const challenge = await connection.signIn({ fields: { Email: 'alice@example.test' }, method: 'EmailCode' }, live())
    sdk.onCheck(() => cancelling.abort())
    Expect(
      await connection.signIn({
        challengeId: challenge.session!.challenge!.id,
        fields: { Code: '123456', Email: 'alice@example.test' },
        method: 'EmailCode',
      }, cancelling.signal),
    ).toEqual({ outcome: { status: 'cancelled' } })
    Expect(sdk.user).toBeNull()
    Expect(await connection.restore(live())).toEqual({ state: 'SignedOut' })
    connection.close!()
  })

  Test('restores the persisted user and proves the session with its refresh token', async () => {
    const sdk = fakeInstantSDK()
    sdk.user = alice
    const appId = nextAppId()
    const connection = connect(sdk, {
      ApiURI: 'http://localhost:9020',
      AppId: appId,
      WebsocketURI: 'ws://localhost:9020/runtime/session',
    })
    Expect(await connection.restore(live())).toEqual({
      principal: { email: 'alice@example.test', issuer: `instantdb:${appId}`, subject: 'user-alice' },
      state: 'SignedIn',
    })
    Expect(await connection.proof({ kind: 'Session', signal: live() })).toEqual({
      issuer: `instantdb:${appId}`,
      kind: 'Session',
      subject: 'user-alice',
      value: {
        apiURI: 'http://localhost:9020',
        appId,
        refreshToken: 'refresh-alice',
        websocketURI: 'ws://localhost:9020/runtime/session',
      },
    })
    await Expect(connection.proof({ kind: 'IdentityToken', signal: live() })).rejects.toThrow(
      'InstantAuth issues Session sign-in proofs, not IdentityToken.',
    )
    const aborted = new AbortController()
    aborted.abort()
    await Expect(connection.proof({ kind: 'Session', signal: aborted.signal })).rejects.toThrow(
      'The authentication request was cancelled.',
    )

    Expect(await connection.signOut(live())).toEqual({ status: 'completed' })
    Expect(sdk.signOuts).toBe(1)
    Expect(await connection.restore(live())).toEqual({ state: 'SignedOut' })
    await Expect(connection.proof({ kind: 'Session', signal: live() })).rejects.toThrow(
      'Sign in again to access account data.',
    )
    // Only the configured endpoints appear in the proof.
    const bare = connect(sdk, { AppId: nextAppId() })
    sdk.user = alice
    Expect(Object.keys((await bare.proof({ kind: 'Session', signal: live() }) as { value: object }).value)).toEqual([
      'appId',
      'refreshToken',
    ])
    connection.close!()
    bare.close!()
  })

  Test('reports a server-side sign-out, but not the SDK replaying the user it already reported', async () => {
    const sdk = fakeInstantSDK()
    sdk.user = alice
    const appId = nextAppId()
    const connection = connect(sdk, { AppId: appId })
    const seen: TR.AuthConnectionSession[] = []
    await connection.restore(live())
    const stop = connection.subscribe!(session => seen.push(session))
    Expect(sdk.authListeners.size).toBe(1)
    Expect(seen).toEqual([])

    sdk.emit({ user: null })
    Expect(seen).toEqual([{ state: 'ReauthenticationRequired' }])
    sdk.emit({ user: null })
    sdk.emit({ error: { message: 'OAuth failed' }, user: undefined })
    Expect(seen).toHaveLength(1)
    const bob = { email: 'bob@example.test', id: 'user-bob', refresh_token: 'refresh-bob' }
    sdk.emit({ user: bob })
    Expect(seen.at(-1)).toEqual({
      principal: { email: 'bob@example.test', issuer: `instantdb:${appId}`, subject: 'user-bob' },
      state: 'SignedIn',
    })

    // A challenge in progress survives the SDK replaying its signed-out user on subscribe.
    stop()
    Expect(sdk.authListeners.size).toBe(0)
    await connection.signOut(live())
    await connection.signIn({ fields: { Email: 'alice@example.test' }, method: 'EmailCode' }, live())
    const replayed: TR.AuthConnectionSession[] = []
    connection.subscribe!(session => replayed.push(session))
    Expect(replayed).toEqual([])

    connection.close!()
    Expect(sdk.authListeners.size).toBe(0)
    Expect(sdk.shutdowns).toBe(1)
  })

  Test('refuses configuration without an AppId', () => {
    const sdk = fakeInstantSDK()
    Expect(() => connect(sdk, {})).toThrow("InstantAuth configuration 'AppId' expects non-empty text.")
    Expect(() => connect(sdk, { ApiURI: ' ', AppId: 'app' })).toThrow(
      "InstantAuth configuration 'ApiURI' expects non-empty text.",
    )
    Expect(sdk.inits).toEqual([])
  })
})

function apiError(status: number): Error & { status: number } {
  return Object.assign(new TypeError(`InstantDB answered ${status}`), { status })
}

type AuthEvent = { error?: { message: string }; user: FakeUser | null | undefined }

/** fakeInstantSDK doubles the auth surface of `@instantdb/react-native`: one user, one code, one core. */
function fakeInstantSDK() {
  const state = {
    authListeners: new Set<(event: AuthEvent) => void>(),
    checkedCodes: [] as { code: string; email: string }[],
    databases: [] as unknown[],
    inits: [] as Record<string, unknown>[],
    sentCodes: [] as string[],
    shutdowns: 0,
    signOuts: 0,
    user: null as FakeUser | null,
  }
  const failures = new Map<'check' | 'send', unknown>()
  let checking: (() => void) | undefined
  let ids = 0
  const failed = (operation: 'check' | 'send'): void => {
    const error = failures.get(operation)
    failures.delete(operation)
    if (error !== undefined) {
      throw error
    }
  }
  const setUser = (user: FakeUser | null): void => {
    state.user = user
    for (const listener of state.authListeners) {
      listener({ user })
    }
  }
  const db = {
    auth: {
      async sendMagicCode({ email }: { email: string }) {
        failed('send')
        state.sentCodes.push(email)
        return { sent: true }
      },
      async signInWithMagicCode({ code, email }: { code: string; email: string }) {
        state.checkedCodes.push({ code, email })
        failed('check')
        if (code !== '123456') {
          throw apiError(400)
        }
        const user = { email, id: 'user-alice', refresh_token: 'refresh-alice' }
        setUser(user)
        checking?.()
        checking = undefined
        return { created: false, user }
      },
      async signOut() {
        state.signOuts += 1
        setUser(null)
      },
    },
    core: {
      shutdown: () => {
        state.shutdowns += 1
      },
      subscribeAuth(listener: (event: AuthEvent) => void) {
        state.authListeners.add(listener)
        // The SDK replays its cached user synchronously on subscribe.
        listener({ user: state.user })
        return () => state.authListeners.delete(listener)
      },
    },
    getAuth: async () => state.user,
  }
  state.databases.push(db)
  return Object.assign(state, {
    emit: (event: AuthEvent) => {
      state.user = event.user ?? null
      for (const listener of state.authListeners) {
        listener(event)
      }
    },
    failNext: (operation: 'check' | 'send', error: unknown) => {
      failures.set(operation, error)
    },
    instantSDK: {
      id: () => `instant-id-${++ids}`,
      init: (config: Record<string, unknown>) => {
        state.inits.push(config)
        return db
      },
    },
    onCheck: (callback: () => void) => {
      checking = callback
    },
  })
}
