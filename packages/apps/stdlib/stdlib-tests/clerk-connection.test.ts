import TR from '@runtime/TR'
import { Errors } from '@shared/core'
import { Deferred, Describe, Expect, Test, until } from '@shared/test'
import { createClerkConnection } from '../@tao/auth/clerk/ClerkConnection'
import {
  type ClerkDriver,
  type ClerkDriverResult,
  type ClerkDriverSession,
  ClerkRevocationError,
  ClerkSignInRejectedError,
} from '../@tao/auth/clerk/ClerkDriver'

const signal = () => new AbortController().signal
const configuration = { Endpoint: 'https://gateway.test/', Resource: 'notes', PublishableKey: 'pk_test_fixture' }
const token = 'a'.repeat(96)
const otherToken = 'b'.repeat(96)
const sdkSession = (id = 'session-alice', userId = 'alice'): ClerkDriverSession => ({
  id,
  userId,
  getToken: async () => `clerk-${userId}`,
})
const gatewaySession = (subject = 'alice', value = token, expiresAt = 61_000) => ({
  accountId: `account-${subject}`,
  issuer: 'https://clerk.test',
  subject,
  resource: 'notes',
  token: value,
  expiresAt,
})

function fixture(storage = new Map<string, string>()) {
  let now = 1_000
  let listener: (session: ClerkDriverSession | null) => void = () => undefined
  let closed = false
  const calls: Array<{ url: string; options?: RequestInit }> = []
  const timers: Array<{ job: () => void; delay: number; cancelled: boolean }> = []
  const sessions: TR.AuthSession[] = []
  const driver: ClerkDriver = {
    restore: async () => sdkSession(),
    signIn: async (): Promise<ClerkDriverResult> => ({ status: 'complete', session: sdkSession() }),
    signOut: async () => undefined,
    subscribe: value => {
      listener = value
      return () => undefined
    },
    close: () => {
      closed = true
    },
  }
  const transport = {
    respond: async (url: string, _options?: RequestInit): Promise<Response> =>
      Response.json(url.endsWith('/exchange') ? gatewaySession() : {}),
  }
  const connection = createClerkConnection(configuration, {
    driver,
    now: () => now,
    logoutStorage: {
      getItem: async key => storage.get(key) ?? null,
      setItem: async (key, value) => {
        storage.set(key, value)
      },
    },
    fetch: (async (input, options) => {
      const url = String(input)
      calls.push({ url, options })
      return await transport.respond(url, options)
    }) as typeof fetch,
    schedule: (job, delay) => {
      const timer = { job, delay, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
  })
  connection.subscribe?.(value => sessions.push(value))
  return {
    connection,
    calls,
    driver,
    sessions,
    storage,
    timers,
    transport,
    emit: (session: ClerkDriverSession | null) => listener(session),
    setNow: (value: number) => {
      now = value
    },
    isClosed: () => closed,
    credential: () => connection.credential({ audience: 'notes', signal: signal() }),
    signIn: () => connection.signIn({ method: 'Password', fields: { Email: 'alice', Password: 'secret' } }, signal()),
  }
}

Describe('Clerk account gateway connection', () => {
  Test('exchanges only the Clerk bearer and resource, and exposes an audience-scoped gateway credential', async () => {
    const f = fixture()
    try {
      Expect(await f.signIn()).toEqual({
        outcome: { status: 'completed' },
        session: {
          state: 'SignedIn',
          identity: { accountId: 'account-alice', issuer: 'https://clerk.test', subject: 'alice' },
        },
      })
      Expect(f.calls[0]!.url).toBe('https://gateway.test/v1/auth/clerk/exchange')
      Expect(new Headers(f.calls[0]!.options?.headers).get('Authorization')).toBe('Bearer clerk-alice')
      Expect(JSON.parse(String(f.calls[0]!.options?.body))).toEqual({ resource: 'notes' })
      Expect(await f.credential()).toEqual({ audience: 'notes', value: token, expiresAt: 61_000 })
      await Expect(f.connection.credential({ audience: 'other', signal: signal() })).rejects.toThrow(
        'does not authorize',
      )
    } finally {
      f.connection.close?.()
    }
  })

  Test('email verification exposes a challenge without acquiring any credential', async () => {
    const f = fixture()
    f.driver.signIn = async () => ({ status: 'challenge', id: 'challenge-1', kind: 'EmailCode' })
    try {
      Expect(await f.signIn()).toEqual({
        outcome: { status: 'completed' },
        session: {
          state: 'ChallengeRequired',
          challenge: { id: 'challenge-1', kind: 'EmailCode' },
        },
      })
      Expect(f.calls).toEqual([])
      await Expect(f.credential()).rejects.toThrow('Sign in again')
    } finally {
      f.connection.close?.()
    }
  })

  Test('rejects gateway credentials for another subject, resource, expired session, or malformed token', async () => {
    for (
      const invalid of [
        { ...gatewaySession(), subject: 'bob' },
        { ...gatewaySession(), resource: 'other' },
        { ...gatewaySession(), expiresAt: 1_000 },
        { ...gatewaySession(), token: 'not-a-gateway-token' },
      ]
    ) {
      const f = fixture()
      f.transport.respond = async () => Response.json(invalid)
      try {
        Expect((await f.signIn()).outcome.status).toBe('error')
        await Expect(f.credential()).rejects.toThrow('Sign in again')
      } finally {
        f.connection.close?.()
      }
    }
  })

  Test('refresh replaces the expiring credential and cancels its old expiry callback', async () => {
    const f = fixture()
    try {
      await f.signIn()
      const expiry = f.timers.find(timer => timer.delay === 60_000)!
      f.setNow(57_000)
      f.transport.respond = async () => Response.json(gatewaySession('alice', otherToken, 120_000))
      Expect(await f.credential()).toEqual({ audience: 'notes', value: otherToken, expiresAt: 120_000 })
      Expect(expiry.cancelled).toBe(true)
      f.setNow(61_000)
      expiry.job()
      Expect((await f.credential()).value).toBe(otherToken)
      Expect(f.sessions).toEqual([
        { state: 'SignedIn', identity: { accountId: 'account-alice', issuer: 'https://clerk.test', subject: 'alice' } },
      ])
    } finally {
      f.connection.close?.()
    }
  })

  Test('a cancelled delayed exchange revokes its returned token without publishing credentials', async () => {
    const f = fixture()
    const pending = Deferred<Response>()
    f.transport.respond = async url => url.endsWith('/exchange') ? pending.promise : Response.json({})
    try {
      const signingIn = f.signIn()
      await until(() => f.calls.length === 1)
      f.connection.cancel?.()
      pending.resolve(Response.json(gatewaySession()))
      Expect((await signingIn).outcome.status).toBe('cancelled')
      Expect(f.calls).toHaveLength(2)
      Expect(f.calls[1]!.url).toBe('https://gateway.test/v1/auth/sign-out')
      Expect(new Headers(f.calls[1]!.options?.headers).get('Authorization')).toBe(`Bearer ${token}`)
      Expect(f.sessions).toEqual([])
      await Expect(f.credential()).rejects.toThrow('Sign in again')
    } finally {
      f.connection.close?.()
    }
  })

  Test(
    'cancellation after SDK completion revokes the completed SDK session while its gateway exchange is delayed',
    async () => {
      const f = fixture()
      const pending = Deferred<Response>()
      const revoked: Array<string | undefined> = []
      f.driver.signOut = async id => {
        revoked.push(id)
      }
      f.transport.respond = async url => url.endsWith('/exchange') ? pending.promise : Response.json({})
      try {
        const signingIn = f.signIn()
        await until(() => f.calls.length === 1)
        f.connection.cancel?.()
        pending.resolve(Response.json(gatewaySession()))
        Expect((await signingIn).outcome.status).toBe('cancelled')
        Expect(revoked).toEqual(['session-alice'])
        await Expect(f.credential()).rejects.toThrow('Sign in again')
      } finally {
        f.connection.close?.()
      }
    },
  )

  Test('failed renewal remains bounded by the original expiry and requires reauthentication', async () => {
    const f = fixture()
    try {
      await f.signIn()
      f.transport.respond = async () => Errors.throwHostEnvironment('offline fixture')
      f.setNow(57_000)
      await Expect(f.credential()).rejects.toThrow('offline fixture')
      f.setNow(61_000)
      f.timers.find(timer => timer.delay === 60_000)!.job()
      Expect(f.sessions).toEqual([{ state: 'ReauthenticationRequired' }])
      await Expect(f.credential()).rejects.toThrow('Sign in again')
    } finally {
      f.connection.close?.()
    }
  })

  Test('logout after expiry retains SDK ownership and fences the expired gateway credential', async () => {
    const f = fixture()
    const revoked: Array<string | undefined> = []
    f.driver.signOut = async id => {
      revoked.push(id)
      Errors.throwHostEnvironment('offline fixture')
    }
    try {
      await f.signIn()
      f.setNow(61_000)
      f.timers.find(timer => timer.delay === 60_000)!.job()
      Expect((await f.connection.signOut(signal())).status).toBe('error')
      Expect(revoked).toEqual(['session-alice'])
      Expect(
        f.calls.filter(call => call.url.endsWith('/sign-out')).map(call =>
          new Headers(call.options?.headers).get('Authorization')
        ),
      ).toEqual([`Bearer ${token}`])
      const restored = fixture(f.storage)
      restored.driver.signOut = f.driver.signOut
      try {
        Expect(await restored.connection.restore(signal())).toEqual({ state: 'SignedOut' })
        Expect(restored.calls).toEqual([])
      } finally {
        restored.connection.close?.()
      }
    } finally {
      f.connection.close?.()
    }
  })

  Test('logout revokes the restored SDK session even when its gateway exchange failed', async () => {
    const f = fixture()
    const revoked: Array<string | undefined> = []
    f.driver.signOut = async id => {
      revoked.push(id)
    }
    f.transport.respond = async () => Response.json({}, { status: 503 })
    try {
      await Expect(f.connection.restore(signal())).rejects.toThrow('could not authorize')
      Expect((await f.connection.signOut(signal())).status).toBe('completed')
      Expect(revoked).toEqual(['session-alice'])
    } finally {
      f.connection.close?.()
    }
  })

  Test('logout retries every unconfirmed gateway retirement, including expired credentials', async () => {
    const f = fixture()
    let failOldRevocation = true
    const revoked: string[] = []
    try {
      f.transport.respond = async () => Response.json(gatewaySession())
      await f.signIn()
      f.transport.respond = async (url, options) => {
        if (url.endsWith('/exchange')) {
          return Response.json(gatewaySession('alice', otherToken, 120_000))
        }
        const authorization = new Headers(options?.headers).get('Authorization')!
        revoked.push(authorization)
        return Response.json({}, { status: authorization === `Bearer ${token}` && failOldRevocation ? 503 : 200 })
      }
      f.setNow(57_000)
      await f.credential()
      await until(() => revoked.length === 1)
      f.setNow(62_000)
      Expect((await f.connection.signOut(signal())).status).toBe('error')
      Expect(revoked).toContain(`Bearer ${otherToken}`)
      failOldRevocation = false
      Expect((await f.connection.signOut(signal())).status).toBe('completed')
      Expect(revoked.at(-1)).toBe(`Bearer ${token}`)
      Expect(revoked.filter(value => value === `Bearer ${otherToken}`)).toHaveLength(1)
    } finally {
      f.connection.close?.()
    }
  })

  Test('SDK changes during sign-in or restoration cannot publish a stale gateway identity', async () => {
    for (const restoring of [false, true]) {
      for (const replacement of [null, sdkSession('session-bob', 'bob')]) {
        const f = fixture()
        const pending = Deferred<Response>()
        f.transport.respond = async url => url.endsWith('/exchange') ? pending.promise : Response.json({})
        try {
          const signingIn = restoring ? f.connection.restore(signal()) : f.signIn()
          await until(() => f.calls.length === 1)
          f.emit(replacement)
          f.transport.respond = async url =>
            Response.json(
              url.endsWith('/exchange')
                ? gatewaySession('bob', otherToken, 120_000)
                : {},
            )
          pending.resolve(Response.json(gatewaySession()))
          const result = await signingIn
          Expect(result).not.toHaveProperty('session.identity.subject', 'alice')
          Expect(result).not.toHaveProperty('identity.subject', 'alice')
          if (replacement) {
            await until(() => f.sessions.some(value => value.identity?.subject === 'bob'))
            Expect((await f.credential()).value).toBe(otherToken)
          } else {
            await Expect(f.credential()).rejects.toThrow('Sign in again')
          }
          Expect(f.sessions.some(value => value.identity?.subject === 'alice')).toBe(false)
          Expect(f.calls.some(call =>
            call.url.endsWith('/sign-out')
            && new Headers(call.options?.headers).get('Authorization') === `Bearer ${token}`
          )).toBe(true)
        } finally {
          f.connection.close?.()
        }
      }
    }
  })

  Test('the SDK activation notification does not invalidate its own sign-in', async () => {
    const f = fixture()
    f.driver.signIn = async () => {
      f.emit(sdkSession())
      return { status: 'complete', session: sdkSession() }
    }
    try {
      Expect((await f.signIn()).session?.identity?.subject).toBe('alice')
      Expect((await f.credential()).value).toBe(token)
    } finally {
      f.connection.close?.()
    }
  })

  Test('the runtime follows a Clerk account switch through the gateway exchange', async () => {
    const f = fixture()
    const expiresAt = Date.now() + 120_000
    f.transport.respond = async () => Response.json(gatewaySession('alice', token, expiresAt))
    const scope = TR.Auth.CreateScope(TR.Auth.Configure(
      TR.Auth.Declaration('Clerk', {
        connect: () => f.connection,
      }),
      {},
    ))
    const pending = Deferred<Response>()
    try {
      await scope.restore()
      Expect(scope.session.identity?.subject).toBe('alice')
      f.transport.respond = async url => url.endsWith('/exchange') ? pending.promise : Response.json({})
      f.emit(sdkSession('session-bob', 'bob'))
      Expect(scope.session.state).toBe('SignedOut')
      pending.resolve(Response.json(gatewaySession('bob', otherToken, expiresAt)))
      await until(() => scope.session.identity?.subject === 'bob')
      Expect((await scope.credential({ audience: 'notes', signal: signal() })).value).toBe(otherToken)
    } finally {
      scope.dispose()
    }
  })

  Test(
    'sign-out clears credentials before delayed revocation and persists a tombstone across restoration',
    async () => {
      const f = fixture()
      const revocation = Deferred<void>()
      f.driver.signOut = async () => revocation.promise
      try {
        await f.signIn()
        const leaving = f.connection.signOut(signal())
        await Expect(f.credential()).rejects.toThrow('Sign in again')
        await until(() => [...f.storage.values()].includes('["session-alice"]'))
        revocation.reject(Errors.abortError('offline fixture'))
        Expect((await leaving).status).toBe('error')
        const restored = fixture(f.storage)
        restored.driver.signOut = async () => Errors.throwHostEnvironment('offline fixture')
        try {
          Expect(await restored.connection.restore(signal())).toEqual({ state: 'SignedOut' })
          Expect(restored.calls).toEqual([])
          await Expect(restored.credential()).rejects.toThrow('Sign in again')
        } finally {
          restored.connection.close?.()
        }
      } finally {
        f.connection.close?.()
      }
    },
  )

  Test('another tab cannot erase an authoritative logout marker by overwriting the retry index', async () => {
    const storage = new Map<string, string>()
    const leaving = fixture(storage)
    const stale = fixture(storage)
    const offline = async () => Errors.throwHostEnvironment('offline fixture')
    leaving.driver.signOut = offline
    stale.driver.restore = async () => null
    try {
      await stale.connection.restore(signal())
      await leaving.signIn()
      Expect((await leaving.connection.signOut(signal())).status).toBe('error')
      Expect((await stale.connection.signOut(signal())).status).toBe('completed')
      Expect([...storage.values()]).toContain('[]')
      Expect([...storage.values()]).toContain('true')
      const restored = fixture(storage)
      restored.driver.signOut = offline
      try {
        Expect(await restored.connection.restore(signal())).toEqual({ state: 'SignedOut' })
        Expect(restored.calls).toEqual([])
      } finally {
        restored.connection.close?.()
      }
      // This connection loaded the empty index before the other tab wrote its marker.
      stale.driver.signOut = offline
      Expect((await stale.signIn()).outcome.status).toBe('error')
      Expect(stale.calls).toEqual([])
    } finally {
      leaving.connection.close?.()
      stale.connection.close?.()
    }
  })

  Test('stale tabs check logout markers before proofs and after delayed renewal or SDK-switch exchanges', async () => {
    for (const mode of ['renew', 'switch']) {
      for (const delayed of [false, true]) {
        const storage = new Map<string, string>()
        const leaving = fixture(storage)
        const stale = fixture(storage)
        const pending = Deferred<Response>()
        const offline = async () => Errors.throwHostEnvironment('offline fixture')
        leaving.driver.signOut = offline
        stale.driver.signOut = offline
        let proofs = 0
        const session = {
          ...sdkSession(),
          getToken: async () => {
            proofs += 1
            return 'clerk-alice'
          },
        }
        stale.driver.signIn = async () => ({ status: 'complete', session })
        try {
          await leaving.signIn()
          await stale.signIn()
          if (!delayed) {
            await leaving.connection.signOut(signal())
          }
          stale.transport.respond = async url =>
            url.endsWith('/exchange')
              ? delayed ? pending.promise : Response.json(gatewaySession('alice', otherToken, 120_000))
              : Response.json({})
          let renewal: Promise<string> | undefined
          if (mode === 'renew') {
            stale.setNow(57_000)
            renewal = stale.credential().then(() => 'authorized', () => 'rejected')
          } else {
            stale.emit(null)
            stale.emit(session)
          }
          if (delayed) {
            await until(() => stale.calls.filter(call => call.url.endsWith('/exchange')).length === 2)
            await leaving.connection.signOut(signal())
            pending.resolve(Response.json(gatewaySession('alice', otherToken, 120_000)))
          }
          if (renewal) {
            Expect(await renewal).toBe('rejected')
          } else {
            await until(() =>
              stale.sessions.some(value => value.state === 'ReauthenticationRequired' || value.state === 'SignedIn')
            )
            Expect(stale.sessions.at(-1)?.state).toBe('ReauthenticationRequired')
          }
          Expect(proofs).toBe(delayed ? 2 : 1)
          Expect(stale.sessions.some(value => value.state === 'SignedIn')).toBe(false)
          if (delayed) {
            Expect(stale.calls.some(call =>
              call.url.endsWith('/sign-out')
              && new Headers(call.options?.headers).get('Authorization') === `Bearer ${otherToken}`
            )).toBe(true)
          }
        } finally {
          pending.resolve(Response.json(gatewaySession('alice', otherToken, 120_000)))
          leaving.connection.close?.()
          stale.connection.close?.()
        }
      }
    }
  })

  Test('an unreadable session logout marker fails closed before requesting a proof', async () => {
    const f = fixture()
    f.driver.signOut = async () => Errors.throwHostEnvironment('offline fixture')
    try {
      await f.signIn()
      await f.connection.signOut(signal())
      const marker = [...f.storage.keys()].find(key => key.endsWith('.session.session-alice'))
      Expect(marker).toBeDefined()
      f.storage.set(marker!, 'unreadable')
      const restored = fixture(f.storage)
      restored.driver.signOut = f.driver.signOut
      try {
        await Expect(restored.connection.restore(signal())).rejects.toThrow('logout state is unreadable')
        Expect(restored.calls).toEqual([])
      } finally {
        restored.connection.close?.()
      }
    } finally {
      f.connection.close?.()
    }
  })

  Test('a driver cleanup failure persists the abandoned SDK session across restart', async () => {
    const f = fixture()
    f.driver.signIn = async () => {
      throw new ClerkRevocationError('session-alice')
    }
    f.driver.signOut = async () => Errors.throwHostEnvironment('offline fixture')
    try {
      Expect((await f.signIn()).outcome.status).toBe('error')
      const restored = fixture(f.storage)
      restored.driver.signOut = f.driver.signOut
      try {
        Expect(await restored.connection.restore(signal())).toEqual({ state: 'SignedOut' })
        Expect(restored.calls).toEqual([])
      } finally {
        restored.connection.close?.()
      }
    } finally {
      f.connection.close?.()
    }
  })

  Test('known credential rejections are safe user-correctable outcomes', async () => {
    const f = fixture()
    f.driver.signIn = async () => {
      throw new ClerkSignInRejectedError()
    }
    try {
      Expect((await f.signIn()).outcome).toEqual({
        status: 'rejected',
        message: 'The sign-in details were not accepted. Check them and try again.',
      })
      Expect(f.calls).toEqual([])
    } finally {
      f.connection.close?.()
    }
  })

  Test('late refresh of a replaced account cannot overwrite the newer account', async () => {
    const f = fixture()
    const pending = Deferred<Response>()
    try {
      await f.signIn()
      f.setNow(57_000)
      f.transport.respond = async () => pending.promise
      const renewing = f.credential().catch(() => undefined)
      await until(() => f.calls.length === 2)
      f.transport.respond = async url =>
        Response.json(
          url.endsWith('/exchange')
            ? gatewaySession('bob', otherToken, 120_000)
            : {},
        )
      f.emit(sdkSession('session-bob', 'bob'))
      await until(() => f.sessions.some(value => value.state === 'SignedIn' && value.identity?.subject === 'bob'))
      pending.resolve(Response.json(gatewaySession('alice', token, 120_000)))
      await renewing
      Expect((await f.credential()).value).toBe(otherToken)
      Expect(f.sessions.filter(value => value.state === 'SignedIn')).toEqual([
        { state: 'SignedIn', identity: { accountId: 'account-bob', issuer: 'https://clerk.test', subject: 'bob' } },
      ])
      Expect(f.calls.some(call =>
        call.url.endsWith('/sign-out')
        && new Headers(call.options?.headers).get('Authorization') === `Bearer ${token}`
      )).toBe(true)
    } finally {
      f.connection.close?.()
    }
  })

  Test('close rejects delayed exchange completion and ignores later SDK callbacks', async () => {
    const f = fixture()
    const pending = Deferred<Response>()
    f.transport.respond = async url => url.endsWith('/exchange') ? pending.promise : Response.json({})
    const signingIn = f.signIn()
    await until(() => f.calls.length === 1)
    f.connection.close?.()
    f.emit(sdkSession('session-bob', 'bob'))
    pending.resolve(Response.json(gatewaySession()))
    Expect((await signingIn).outcome.status).toBe('cancelled')
    Expect(f.isClosed()).toBe(true)
    Expect(f.sessions).toEqual([])
    Expect(f.calls.filter(call => call.url.endsWith('/exchange'))).toHaveLength(1)
    await Expect(f.credential()).rejects.toThrow('cancelled')
  })
})
