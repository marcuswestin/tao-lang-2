import { Deferred, Describe, Expect, Test } from '@shared/test'
import {
  bindClerkDriverHost,
  type ClerkDriverSDK,
  ClerkRevocationError,
  ClerkSignInRejectedError,
  createClerkDriver,
} from '../@tao/auth/clerk/ClerkDriver'

function fixture() {
  const calls: unknown[] = []
  const navigations: string[] = []
  const events = new Set<() => void>()
  const session = {
    id: 'session-one',
    status: 'active',
    user: { id: 'user-one' },
    getToken: async () => 'sdk-token',
  }
  const signIn: NonNullable<ClerkDriverSDK['client']>['signIn'] = {
    id: 'sign-in-one',
    status: 'needs_first_factor',
    createdSessionId: null,
    supportedFirstFactors: [{ strategy: 'email_code', emailAddressId: 'email-one' }],
    supportedSecondFactors: [{ strategy: 'email_code', emailAddressId: 'email-one' }],
    async prepareSecondFactor(input) {
      calls.push(['prepare-trust', input])
      return signIn
    },
    async attemptSecondFactor(input) {
      calls.push(['verify-trust', input])
      signIn.status = 'complete'
      signIn.createdSessionId = session.id
      return signIn
    },
    async create(input) {
      calls.push(['create', input])
      return signIn
    },
    async prepareFirstFactor(input) {
      calls.push(['prepare', input])
      return signIn
    },
    async attemptFirstFactor(input) {
      calls.push(['verify', input])
      signIn.status = 'complete'
      signIn.createdSessionId = session.id
      return signIn
    },
  }
  const signUp: NonNullable<ClerkDriverSDK['client']>['signUp'] = {
    id: 'sign-up-one',
    status: 'missing_requirements',
    createdSessionId: null,
    missingFields: [],
    unverifiedFields: ['email_address'],
    async create(input) {
      calls.push(['register', input])
      return signUp
    },
    async prepareEmailAddressVerification(input) {
      calls.push(['prepare-register', input])
      return signUp
    },
    async attemptEmailAddressVerification(input) {
      calls.push(['verify-register', input])
      signUp.status = 'complete'
      signUp.createdSessionId = session.id
      return signUp
    },
  }
  const sdk: ClerkDriverSDK = {
    loaded: true,
    client: { signIn, signUp, sessions: [session] },
    session: null,
    async setActive(input) {
      calls.push(['activate', input.session])
      sdk.session = session
    },
    async signOut(
      callbackOrInput: (() => void | Promise<void>) | { sessionId: string },
      options?: { sessionId: string },
    ) {
      const input = typeof callbackOrInput === 'function' ? options! : callbackOrInput
      calls.push(['sign-out', input.sessionId])
      if (typeof callbackOrInput === 'function') {
        await callbackOrInput()
      } else {
        navigations.push('default-sign-out-redirect')
      }
    },
    addListener(listener) {
      events.add(listener)
      return () => {
        events.delete(listener)
      }
    },
  }
  const configuration = {}
  const driver = createClerkDriver(configuration)
  const unbind = bindClerkDriverHost(configuration, sdk, error => error === 'invalid-credentials')
  return {
    driver,
    sdk,
    signIn,
    signUp,
    session,
    calls,
    navigations,
    events,
    configuration,
    cleanup() {
      driver.close()
      unbind()
    },
  }
}
const signal = () => new AbortController().signal

Describe('Clerk SDK driver', () => {
  Test('targeted logout completes without invoking Clerk default navigation', async () => {
    const f = fixture()
    try {
      await f.driver.restore(signal())
      await f.driver.signOut('session-one')
      Expect(f.calls).toEqual([['sign-out', 'session-one']])
      Expect(f.navigations).toEqual([])
    } finally {
      f.cleanup()
    }
  })
  Test('waits for the provider and permits cancellation before it is ready', async () => {
    const driver = createClerkDriver({})
    const abort = new AbortController()
    const pending = driver.restore(abort.signal)
    abort.abort()
    await Expect(pending).rejects.toThrow('cancelled')
    driver.close()
  })

  Test('uses the selected email factor and verifies only its own challenge before activation', async () => {
    const f = fixture()
    try {
      Expect(await f.driver.signIn({ method: 'EmailCode', fields: { Email: 'alice@example.test' } }, signal()))
        .toEqual({ status: 'challenge', id: 'sign-in-one', kind: 'EmailCode' })
      await Expect(f.driver.signIn({ method: 'EmailCode', challengeId: 'someone-else' }, signal()))
        .rejects.toThrow('expired')
      const result = await f.driver.signIn({
        method: 'EmailCode',
        challengeId: 'sign-in-one',
        fields: { Code: '123456' },
      }, signal())
      Expect(result.status).toBe('complete')
      if (result.status === 'complete') {
        Expect(result.session.userId).toBe('user-one')
        Expect(await result.session.getToken()).toBe('sdk-token')
      }
      Expect(f.calls).toEqual([
        ['create', { identifier: 'alice@example.test' }],
        ['prepare', { strategy: 'email_code', emailAddressId: 'email-one' }],
        ['verify', { strategy: 'email_code', code: '123456' }],
        ['activate', 'session-one'],
      ])
    } finally {
      f.cleanup()
    }
  })

  Test('password registration verifies email using the sign-up resource', async () => {
    const f = fixture()
    try {
      Expect(
        await f.driver.signIn({
          method: 'Password',
          fields: { Register: 'true', Email: 'new@example.test', Password: 'secret' },
        }, signal()),
      )
        .toEqual({ status: 'challenge', id: 'sign-up-one', kind: 'EmailCode' })
      Expect(
        (await f.driver.signIn(
          { method: 'EmailCode', challengeId: 'sign-up-one', fields: { Code: '654321' } },
          signal(),
        )).status,
      ).toBe('complete')
      Expect(f.calls).toEqual([
        ['register', { emailAddress: 'new@example.test', password: 'secret' }],
        ['prepare-register', { strategy: 'email_code' }],
        ['verify-register', { code: '654321' }],
        ['activate', 'session-one'],
      ])
    } finally {
      f.cleanup()
    }
  })

  Test('completes password Device Trust using the advertised email second factor', async () => {
    const f = fixture()
    try {
      f.signIn.status = 'needs_client_trust'
      Expect(
        await f.driver.signIn(
          { method: 'Password', fields: { Email: 'alice@example.test', Password: 'secret' } },
          signal(),
        ),
      )
        .toEqual({ status: 'challenge', id: 'sign-in-one', kind: 'EmailCode' })
      Expect(
        (await f.driver.signIn(
          { method: 'EmailCode', challengeId: 'sign-in-one', fields: { Code: '777777' } },
          signal(),
        )).status,
      ).toBe('complete')
      Expect(f.calls).toContainEqual(['prepare-trust', { strategy: 'email_code', emailAddressId: 'email-one' }])
      Expect(f.calls).toContainEqual(['verify-trust', { strategy: 'email_code', code: '777777' }])
      Expect(f.calls).toContainEqual(['activate', 'session-one'])
    } finally {
      f.cleanup()
    }
  })

  Test('normalizes rejected credentials without leaking the SDK error', async () => {
    const f = fixture()
    try {
      f.signIn.create = () => Promise.reject('invalid-credentials')
      await Expect(f.driver.signIn({ method: 'Password' }, signal())).rejects.toBeInstanceOf(ClerkSignInRejectedError)
    } finally {
      f.cleanup()
    }
  })

  Test('reports the exact session id when cancellation revocation needs a durable retry', async () => {
    const f = fixture()
    const pending = Deferred<typeof f.signIn>()
    f.signIn.create = () => pending.promise
    f.sdk.signOut = () => Promise.reject('offline')
    const abort = new AbortController()
    try {
      const running = f.driver.signIn({ method: 'Password' }, abort.signal)
      await Promise.resolve()
      abort.abort()
      f.signIn.status = 'complete'
      f.signIn.createdSessionId = 'late-session'
      pending.resolve(f.signIn)
      const error = await running.catch(error => error as unknown)
      Expect(error).toBeInstanceOf(ClerkRevocationError)
      if (error instanceof ClerkRevocationError) {
        Expect(error.sessionId).toBe('late-session')
      }
    } finally {
      f.cleanup()
    }
  })

  Test('rejects MFA and never restores or activates a pending session', async () => {
    const f = fixture()
    try {
      f.signIn.status = 'needs_second_factor'
      Expect((await f.driver.signIn({ method: 'Password', fields: { Email: 'a', Password: 'b' } }, signal())).status)
        .toBe('unsupported')
      f.signIn.status = 'complete'
      f.signIn.createdSessionId = f.session.id
      f.session.status = 'pending'
      f.sdk.session = f.session
      Expect(await f.driver.restore(signal())).toBeNull()
      Expect((await f.driver.signIn({ method: 'Password' }, signal())).status).toBe('unsupported')
      Expect(f.calls).toContainEqual(['sign-out', 'session-one'])
      Expect(f.calls.some(call => Array.isArray(call) && call[0] === 'activate')).toBe(false)
    } finally {
      f.cleanup()
    }
  })

  Test('revokes a cancelled late session by id and rejects overlapping mutable attempts', async () => {
    const f = fixture()
    const pending = Deferred<typeof f.signIn>()
    f.signIn.create = () => pending.promise
    const abort = new AbortController()
    try {
      const running = f.driver.signIn({ method: 'Password' }, abort.signal)
      await Expect(f.driver.signIn({ method: 'Password' }, signal())).rejects.toThrow('current authentication')
      abort.abort()
      f.signIn.status = 'complete'
      f.signIn.createdSessionId = 'stale-session'
      f.sdk.session = { ...f.session, id: 'newer-session' }
      pending.resolve(f.signIn)
      await Expect(running).rejects.toThrow('cancelled')
      Expect(f.calls).toEqual([['sign-out', 'stale-session']])
      Expect(f.navigations).toEqual([])
      Expect(f.sdk.session.id).toBe('newer-session')
    } finally {
      f.cleanup()
    }
  })

  Test('holds client ownership while a closed driver still has an outstanding request', async () => {
    const f = fixture()
    const pending = Deferred<typeof f.signIn>()
    f.signIn.create = () => pending.promise
    const running = f.driver.signIn({ method: 'Password' }, signal())
    await Promise.resolve()
    f.driver.close()
    Expect(() => createClerkDriver(f.configuration)).toThrow('already has')
    f.signIn.status = 'complete'
    f.signIn.createdSessionId = 'late-session'
    pending.resolve(f.signIn)
    await Expect(running).rejects.toThrow('cancelled')
    const replacement = createClerkDriver(f.configuration)
    replacement.close()
    f.cleanup()
  })

  Test('blocks duplicate clients and connections, forwards revocation, and unsubscribes on close', async () => {
    const f = fixture()
    try {
      Expect(() => bindClerkDriverHost({}, f.sdk)).toThrow('another mounted app')
      Expect(() => createClerkDriver(f.configuration)).toThrow('already has')
      await f.driver.restore(signal())
      const seen: unknown[] = []
      f.driver.subscribe(value => seen.push(value?.id ?? null))
      f.sdk.session = f.session
      for (const event of f.events) {
        event()
      }
      f.sdk.session = null
      for (const event of f.events) {
        event()
      }
      Expect(seen).toEqual(['session-one', null])
      await f.driver.signOut(undefined)
      Expect(f.calls).toEqual([])
      f.driver.close()
      Expect(f.events.size).toBe(0)
    } finally {
      f.cleanup()
    }
  })
})
