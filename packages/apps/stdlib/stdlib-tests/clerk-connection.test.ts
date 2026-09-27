import TR from '@runtime/TR'
import { Errors } from '@shared/core'
import { Deferred, Describe, Expect, Test, until } from '@shared/test'
import { createClerkConnection } from '../@tao/auth/clerk/ClerkConnection'
import {
  classifyClerkSignInError,
  type ClerkDriver,
  type ClerkDriverResult,
  type ClerkDriverSession,
  ClerkRevocationError,
  ClerkSignInRejectedError,
} from '../@tao/auth/clerk/ClerkDriver'

const signal = () => new AbortController().signal
const configuration = { PublishableKey: 'pk_test_fixture' }
const issuer = 'https://clerk.test'

/** clerkToken is an unsigned stand-in for a Clerk session JWT; only the datasource verifies signatures. */
function clerkToken(userId: string, claims: Record<string, unknown> = {}): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${encode({ alg: 'RS256' })}.${
    encode({
      iss: issuer,
      sub: userId,
      exp: Math.floor(Date.now() / 1_000) + 60,
      email: `${userId}@example.test`,
      email_verified: true,
      ...claims,
    })
  }.signature`
}

const principal = (subject = 'alice'): TR.AuthPrincipal => ({
  issuer,
  subject,
  email: `${subject}@example.test`,
  emailVerified: true,
})

function fixture(storage = new Map<string, string>()) {
  let listener: (session: ClerkDriverSession | null) => void = () => undefined
  let closed = false
  const sessions: TR.AuthConnectionSession[] = []
  const tokens = {
    reads: 0,
    issue: async (userId: string): Promise<string | null> => clerkToken(userId),
  }
  const sdkSession = (id = 'session-alice', userId = 'alice'): ClerkDriverSession => ({
    id,
    userId,
    getToken: async () => {
      tokens.reads += 1
      return await tokens.issue(userId)
    },
  })
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
  const connection = createClerkConnection(configuration, {
    driver,
    logoutStorage: {
      getItem: async key => storage.get(key) ?? null,
      setItem: async (key, value) => {
        storage.set(key, value)
      },
    },
    schedule: () => () => undefined,
  })
  connection.subscribe?.(value => sessions.push(value))
  return {
    connection,
    driver,
    sdkSession,
    sessions,
    storage,
    tokens,
    emit: (session: ClerkDriverSession | null) => listener(session),
    isClosed: () => closed,
    proof: () => connection.proof({ kind: 'IdentityToken', signal: signal() }),
    signIn: () => connection.signIn({ method: 'Password', fields: { Email: 'alice', Password: 'secret' } }, signal()),
  }
}

Describe('Clerk auth connection', () => {
  Test('reports the Clerk user as the principal and issues its session token as an IdentityToken proof', async () => {
    const f = fixture()
    try {
      Expect(await f.signIn()).toEqual({
        outcome: { status: 'completed' },
        session: { state: 'SignedIn', principal: principal() },
      })
      const proof = await f.proof()
      Expect(proof).toMatchObject({ kind: 'IdentityToken', ...principal() })
      Expect(proof.kind === 'IdentityToken' && proof.token.split('.')).toHaveLength(3)
      Expect(proof.kind === 'IdentityToken' && proof.expiresAt! > Date.now()).toBe(true)
      await Expect(f.connection.proof({ kind: 'Session', signal: signal() })).rejects.toThrow(
        'Clerk issues IdentityToken sign-in proofs, not Session.',
      )
    } finally {
      f.connection.close?.()
    }
  })

  Test('email verification exposes a challenge without reading any token', async () => {
    const f = fixture()
    f.driver.signIn = async () => ({ status: 'challenge', id: 'challenge-1', kind: 'EmailCode' })
    try {
      Expect(await f.signIn()).toEqual({
        outcome: { status: 'completed' },
        session: { state: 'ChallengeRequired', challenge: { id: 'challenge-1', kind: 'EmailCode' } },
      })
      Expect(f.tokens.reads).toBe(0)
      await Expect(f.proof()).rejects.toThrow('Sign in again')
    } finally {
      f.connection.close?.()
    }
  })

  Test('refuses a session token without an issuer or for another user, and abandons that SDK session', async () => {
    for (const claims of [{ iss: '' }, { sub: 'bob' }, {}]) {
      const f = fixture()
      const revoked: Array<string | undefined> = []
      f.driver.signOut = async id => {
        revoked.push(id)
      }
      f.tokens.issue = async userId => Object.keys(claims).length === 0 ? 'not-a-jwt' : clerkToken(userId, claims)
      try {
        Expect((await f.signIn()).outcome).toEqual({
          status: 'error',
          message: 'Unable to sign in. Check your details and connection, then try again.',
        })
        Expect(revoked).toEqual(['session-alice'])
        await Expect(f.proof()).rejects.toThrow('Sign in again')
      } finally {
        f.connection.close?.()
      }
    }
  })

  Test('cancellation after SDK completion revokes the completed SDK session while its token is delayed', async () => {
    const f = fixture()
    const pending = Deferred<string | null>()
    const revoked: Array<string | undefined> = []
    f.driver.signOut = async id => {
      revoked.push(id)
    }
    f.tokens.issue = () => pending.promise
    try {
      const signingIn = f.signIn()
      await until(() => f.tokens.reads === 1)
      f.connection.cancel?.()
      pending.resolve(clerkToken('alice'))
      Expect((await signingIn).outcome.status).toBe('cancelled')
      Expect(revoked).toEqual(['session-alice'])
      Expect(f.sessions).toEqual([])
      await Expect(f.proof()).rejects.toThrow('Sign in again')
    } finally {
      f.connection.close?.()
    }
  })

  Test('logout revokes the restored SDK session even when its token could not be read', async () => {
    const f = fixture()
    const revoked: Array<string | undefined> = []
    f.driver.signOut = async id => {
      revoked.push(id)
    }
    f.tokens.issue = async () => Errors.throwHostEnvironment('offline fixture')
    try {
      await Expect(f.connection.restore(signal())).rejects.toThrow('offline fixture')
      Expect((await f.connection.signOut(signal())).status).toBe('completed')
      Expect(revoked).toEqual(['session-alice'])
    } finally {
      f.connection.close?.()
    }
  })

  Test('SDK changes during sign-in or restoration cannot publish a stale principal', async () => {
    for (const restoring of [false, true]) {
      for (const replacement of ['none', 'bob'] as const) {
        const f = fixture()
        const pending = Deferred<string | null>()
        f.tokens.issue = userId => userId === 'alice' ? pending.promise : Promise.resolve(clerkToken(userId))
        try {
          const running = restoring ? f.connection.restore(signal()) : f.signIn()
          await until(() => f.tokens.reads === 1)
          f.emit(replacement === 'bob' ? f.sdkSession('session-bob', 'bob') : null)
          pending.resolve(clerkToken('alice'))
          const result = await running
          Expect(result).not.toHaveProperty('session.principal.subject', 'alice')
          Expect(result).not.toHaveProperty('principal.subject', 'alice')
          if (replacement === 'bob') {
            await until(() => f.sessions.some(value => value.principal?.subject === 'bob'))
            Expect((await f.proof()).subject).toBe('bob')
          } else {
            await Expect(f.proof()).rejects.toThrow('Sign in again')
          }
          Expect(f.sessions.some(value => value.principal?.subject === 'alice')).toBe(false)
        } finally {
          f.connection.close?.()
        }
      }
    }
  })

  Test('the SDK activation notification does not invalidate its own sign-in', async () => {
    const f = fixture()
    f.driver.signIn = async () => {
      f.emit(f.sdkSession())
      return { status: 'complete', session: f.sdkSession() }
    }
    try {
      Expect((await f.signIn()).session?.principal?.subject).toBe('alice')
      Expect((await f.proof()).subject).toBe('alice')
      Expect(f.sessions).toEqual([])
    } finally {
      f.connection.close?.()
    }
  })

  Test('the runtime follows a Clerk account switch and stamps its proofs with the Clerk declaration', async () => {
    const f = fixture()
    const proofs: TR.AuthProof[] = []
    const scope = TR.Auth.CreateScope(
      TR.Auth.Configure(
        TR.Auth.Declaration('Clerk', { connect: () => f.connection }, { issues: ['IdentityToken'] }),
        {},
      ),
    )
    scope.bindDatasources([{
      store: TR.Data.Schema({ name: 'Accounts', entities: { Account: { collection: 'Accounts', fields: {} } } }),
      source: TR.Data.Configure(
        TR.Data.Declaration(
          'Gateway',
          {
            authenticate: async context => {
              const proof = await context.proof('IdentityToken', context.signal)
              proofs.push(proof)
              return { accountId: `account-${proof.subject}` }
            },
            connect: () => ({ load: () => undefined, save: () => undefined }),
          },
          undefined,
          { accepts: [{ kind: 'IdentityToken', from: 'Clerk' }], supports: [] },
        ),
        {},
      ),
    }])
    try {
      await scope.restore()
      Expect(scope.session.identity).toEqual({ issuer, subject: 'alice', accountId: 'account-alice' })
      f.emit(f.sdkSession('session-bob', 'bob'))
      await until(() => scope.session.identity?.subject === 'bob')
      Expect(scope.session.identity?.accountId).toBe('account-bob')
      Expect(proofs.map(proof => [proof.provider, proof.subject])).toEqual([['Clerk', 'alice'], ['Clerk', 'bob']])
    } finally {
      scope.dispose()
    }
  })

  Test('sign-out refuses proofs before delayed revocation and persists a tombstone across restoration', async () => {
    const f = fixture()
    const revocation = Deferred<void>()
    f.driver.signOut = async () => revocation.promise
    try {
      await f.signIn()
      const leaving = f.connection.signOut(signal())
      await Expect(f.proof()).rejects.toThrow('Sign in again')
      await until(() => [...f.storage.values()].includes('["session-alice"]'))
      revocation.reject(Errors.abortError('offline fixture'))
      Expect(await leaving).toEqual({
        status: 'error',
        message: 'Signed out here. Some remote revocations could not be confirmed.',
      })
      const restored = fixture(f.storage)
      restored.driver.signOut = async () => Errors.throwHostEnvironment('offline fixture')
      try {
        Expect(await restored.connection.restore(signal())).toEqual({ state: 'SignedOut' })
        Expect(restored.tokens.reads).toBe(0)
        await Expect(restored.proof()).rejects.toThrow('Sign in again')
      } finally {
        restored.connection.close?.()
      }
    } finally {
      f.connection.close?.()
    }
  })

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
        Expect(restored.tokens.reads).toBe(0)
      } finally {
        restored.connection.close?.()
      }
      // This connection loaded the empty index before the other tab wrote its marker.
      stale.driver.signOut = offline
      Expect((await stale.signIn()).outcome.status).toBe('error')
      Expect(stale.tokens.reads).toBe(0)
    } finally {
      leaving.connection.close?.()
      stale.connection.close?.()
    }
  })

  Test('a stale tab checks the logout marker before issuing a proof or following an SDK switch', async () => {
    for (const mode of ['proof', 'switch'] as const) {
      const storage = new Map<string, string>()
      const leaving = fixture(storage)
      const stale = fixture(storage)
      const offline = async () => Errors.throwHostEnvironment('offline fixture')
      leaving.driver.signOut = offline
      stale.driver.signOut = offline
      try {
        await leaving.signIn()
        await stale.signIn()
        await leaving.connection.signOut(signal())
        const reads = stale.tokens.reads
        if (mode === 'proof') {
          await Expect(stale.proof()).rejects.toThrow('Finish signing out')
        } else {
          stale.emit(null)
          stale.emit(stale.sdkSession())
          await until(() => stale.sessions.some(value => value.state === 'ReauthenticationRequired'))
        }
        Expect(stale.tokens.reads).toBe(reads)
        Expect(stale.sessions.some(value => value.state === 'SignedIn')).toBe(false)
      } finally {
        leaving.connection.close?.()
        stale.connection.close?.()
      }
    }
  })

  Test('an unreadable session logout marker fails closed before reading a token', async () => {
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
        Expect(restored.tokens.reads).toBe(0)
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
        Expect(restored.tokens.reads).toBe(0)
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
      Expect(f.tokens.reads).toBe(0)
    } finally {
      f.connection.close?.()
    }
  })

  Test('native configuration errors stay distinct and unknown provider failures remain generic', async () => {
    const f = fixture()
    try {
      f.driver.signIn = async () => {
        const error = classifyClerkSignInError({ status: 400, errors: [{ code: 'native_api_disabled' }] })
        throw error
      }
      Expect((await f.signIn()).outcome).toEqual({
        status: 'error',
        message: 'Native sign-in is disabled for this app. Ask the app developer to enable the Clerk Native API.',
      })
      f.driver.signIn = async () => {
        throw {
          status: 400,
          errors: [{ code: 'private@example.test', message: 'private', meta: { secret: 'private' } }],
        }
      }
      Expect((await f.signIn()).outcome).toEqual({
        status: 'error',
        message: 'Unable to sign in. Check your details and connection, then try again.',
      })
      Expect(f.tokens.reads).toBe(0)
    } finally {
      f.connection.close?.()
    }
  })

  Test('close rejects a delayed sign-in and ignores later SDK callbacks', async () => {
    const f = fixture()
    const pending = Deferred<string | null>()
    f.tokens.issue = () => pending.promise
    const signingIn = f.signIn()
    await until(() => f.tokens.reads === 1)
    f.connection.close?.()
    f.emit(f.sdkSession('session-bob', 'bob'))
    pending.resolve(clerkToken('alice'))
    Expect((await signingIn).outcome.status).toBe('cancelled')
    Expect(f.isClosed()).toBe(true)
    Expect(f.sessions).toEqual([])
    Expect(f.tokens.reads).toBe(1)
    await Expect(f.proof()).rejects.toThrow('cancelled')
  })
})
