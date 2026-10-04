import type TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import type { Auth, User } from 'firebase/auth'
import type { FirebaseClient } from '../firebase-src/firebase-client'
import { FirebaseAuthProvider, type FirebaseAuthSDK } from '../firebase-src/FirebaseAuth'

const configuration = { ApiKey: 'public-key', ProjectId: 'project-one' }
const signal = () => new AbortController().signal
const user = (uid: string): User => ({ uid, email: `${uid}@example.test`, emailVerified: true }) as User

function fixture() {
  const auth = { currentUser: null as User | null, authStateReady: async () => undefined }
  const callbacks = new Set<(user: User | null) => void>()
  const calls: string[] = []
  let registration: Promise<{ user: User }> | undefined
  let signInFailure: unknown
  let signOutFailure: unknown
  const signIns = new Map<string, Promise<{ user: User }>>()
  const sdk: FirebaseAuthSDK = {
    observe: (_auth, callback) => {
      callbacks.add(callback)
      return () => {
        callbacks.delete(callback)
      }
    },
    async register(_auth, email) {
      calls.push(`register:${email}`)
      const result = await (registration ?? Promise.resolve({ user: user('alice') }))
      auth.currentUser = result.user
      callbacks.forEach(callback => callback(result.user))
      return result
    },
    async signIn(_auth, email) {
      calls.push(`signIn:${email}`)
      if (signInFailure !== undefined) {
        throw signInFailure
      }
      const result = await (signIns.get(email) ?? Promise.resolve({ user: user('alice') }))
      auth.currentUser = result.user
      callbacks.forEach(callback => callback(result.user))
      return result
    },
    async signOut() {
      calls.push('signOut')
      if (signOutFailure !== undefined) {
        const failure = signOutFailure
        signOutFailure = undefined
        throw failure
      }
      auth.currentUser = null
      callbacks.forEach(callback => callback(null))
    },
  }
  const client = { auth: auth as Auth } as FirebaseClient
  const connect = () => FirebaseAuthProvider(() => client, sdk).connect({ configuration })
  return {
    auth,
    callbacks,
    calls,
    connect,
    holdRegistration: (value: Promise<{ user: User }>) => {
      registration = value
    },
    failSignIn: (error: unknown) => {
      signInFailure = error
    },
    failNextSignOut: (error: unknown) => {
      signOutFailure = error
    },
    holdSignIn: (email: string, result: Promise<{ user: User }>) => {
      signIns.set(email, result)
    },
  }
}

Describe('FirebaseAuth provider', () => {
  Test('restores a persisted session, registers through Password, and issues a matching Session proof', async () => {
    const fake = fixture()
    const connection = fake.connect()
    Expect(connection.capabilities.methods).toEqual(['Password'])
    Expect(await connection.restore(signal())).toEqual({ state: 'SignedOut' })
    const result = await connection.signIn({
      method: 'Password',
      fields: { Email: ' alice@example.test ', Password: 'secret', Register: 'true' },
    }, signal())
    Expect(fake.calls).toEqual(['register:alice@example.test'])
    Expect(result).toEqual({
      outcome: { status: 'completed' },
      session: {
        state: 'SignedIn',
        principal: {
          issuer: 'firebase:project-one',
          subject: 'alice',
          email: 'alice@example.test',
          emailVerified: true,
        },
      },
    })
    Expect(await connection.proof({ kind: 'Session', signal: signal() })).toEqual({
      kind: 'Session',
      issuer: 'firebase:project-one',
      subject: 'alice',
      value: { projectId: 'project-one', uid: 'alice' },
    })
    connection.close?.()
    Expect(fake.callbacks.size).toBe(0)
    Expect((await fake.connect().restore(signal())).state).toBe('SignedIn')
  })

  Test('signs in, reports external sign-out, and rejects bad methods without calling the SDK', async () => {
    const fake = fixture()
    const connection = fake.connect()
    const notifications: TR.AuthConnectionSession[] = []
    connection.subscribe?.(session => notifications.push(session))
    Expect((await connection.signIn({ method: 'EmailCode' }, signal())).outcome.status).toBe('rejected')
    Expect(fake.calls).toEqual([])
    Expect(
      (await connection.signIn({
        method: 'Password',
        fields: { Email: 'alice@example.test', Password: 'secret', Register: 'false' },
      }, signal())).outcome.status,
    ).toBe('completed')
    Expect(fake.calls).toEqual(['signIn:alice@example.test'])
    fake.auth.currentUser = null
    fake.callbacks.forEach(callback => callback(null))
    Expect(notifications.at(-1)).toEqual({ state: 'ReauthenticationRequired' })
    Expect((await connection.signOut(signal())).status).toBe('completed')
    connection.close?.()
  })

  Test('a cancelled registration cannot publish a late session or persist its user', async () => {
    const fake = fixture()
    const pending = Deferred<{ user: User }>()
    fake.holdRegistration(pending.promise)
    const connection = fake.connect()
    const submitted = connection.signIn({
      method: 'Password',
      fields: { Email: 'alice@example.test', Password: 'secret', Register: 'true' },
    }, signal())
    await Promise.resolve()
    connection.cancel?.()
    pending.resolve({ user: user('alice') })
    Expect((await submitted).outcome.status).toBe('cancelled')
    Expect(fake.calls).toEqual(['register:alice@example.test', 'signOut'])
    Expect((await connection.restore(signal())).state).toBe('SignedOut')
    connection.close?.()
  })

  Test('maps vendor failures to safe messages and suppresses self sign-out notifications', async () => {
    const fake = fixture()
    const connection = fake.connect()
    fake.failSignIn({ code: 'auth/invalid-credential', message: 'Firebase raw details' })
    const rejected = await connection.signIn({
      method: 'Password',
      fields: { Email: 'alice@example.test', Password: 'wrong' },
    }, signal())
    Expect(rejected.outcome).toEqual({ status: 'rejected', message: 'The email or password is incorrect.' })
    fake.failSignIn({ code: 'auth/internal-error', message: 'Sensitive vendor details' })
    const unknown = await connection.signIn({
      method: 'Password',
      fields: { Email: 'alice@example.test', Password: 'wrong' },
    }, signal())
    Expect(unknown.outcome).toEqual({
      status: 'error',
      message: 'Unable to sign in. Check your connection and try again.',
    })
    fake.failSignIn(undefined)
    await connection.signIn({
      method: 'Password',
      fields: { Email: 'alice@example.test', Password: 'secret' },
    }, signal())
    const notifications: TR.AuthConnectionSession[] = []
    connection.subscribe?.(session => notifications.push(session))
    Expect((await connection.signOut(signal())).status).toBe('completed')
    Expect(notifications).toEqual([])
    connection.close?.()
  })

  Test('a cancelled sign-in settles before the next connection can sign in to the shared Auth', async () => {
    const fake = fixture()
    const aliceResult = Deferred<{ user: User }>()
    fake.holdSignIn('alice@example.test', aliceResult.promise)
    fake.holdSignIn('bob@example.test', Promise.resolve({ user: user('bob') }))
    const first = fake.connect()
    const second = fake.connect()
    const firstEvents: TR.AuthConnectionSession[] = []
    first.subscribe?.(session => firstEvents.push(session))
    const aliceSignIn = first.signIn({
      method: 'Password',
      fields: { Email: 'alice@example.test', Password: 'alice-secret' },
    }, signal())
    await Promise.resolve()
    first.cancel?.()
    const bobSignIn = second.signIn({
      method: 'Password',
      fields: { Email: 'bob@example.test', Password: 'bob-secret' },
    }, signal())
    Expect(fake.calls).toEqual(['signIn:alice@example.test'])
    const restored = second.restore(signal())
    const proof = second.proof({ kind: 'Session', signal: signal() })
    aliceResult.resolve({ user: user('alice') })
    Expect((await aliceSignIn).outcome.status).toBe('cancelled')
    Expect((await bobSignIn).session?.principal?.subject).toBe('bob')
    Expect((await restored).principal?.subject).toBe('bob')
    Expect((await proof).subject).toBe('bob')
    Expect(firstEvents.some(event => event.principal?.subject === 'alice')).toBe(false)
    Expect(fake.calls).toEqual(['signIn:alice@example.test', 'signOut', 'signIn:bob@example.test'])
    first.close?.()
    second.close?.()
  })

  Test('sign-out waits for a pending sign-in and cannot be overwritten by its late result', async () => {
    const fake = fixture()
    const aliceResult = Deferred<{ user: User }>()
    fake.holdSignIn('alice@example.test', aliceResult.promise)
    const connection = fake.connect()
    const signingIn = connection.signIn({
      method: 'Password',
      fields: { Email: 'alice@example.test', Password: 'secret' },
    }, signal())
    await Promise.resolve()
    const signingOut = connection.signOut(signal())
    aliceResult.resolve({ user: user('alice') })
    Expect((await signingIn).outcome.status).toBe('cancelled')
    Expect((await signingOut).status).toBe('completed')
    Expect((await connection.restore(signal())).state).toBe('SignedOut')
    Expect(fake.auth.currentUser).toBe(null)
    connection.close?.()
  })

  Test('failed cancellation cleanup quarantines the SDK user until another sign-in succeeds', async () => {
    const fake = fixture()
    const aliceResult = Deferred<{ user: User }>()
    fake.holdSignIn('alice@example.test', aliceResult.promise)
    fake.holdSignIn('bob@example.test', Promise.resolve({ user: user('bob') }))
    fake.failNextSignOut({ code: 'auth/network-request-failed' })
    const first = fake.connect()
    const second = fake.connect()
    try {
      const events: TR.AuthConnectionSession[] = []
      second.subscribe?.(session => events.push(session))
      const signingIn = first.signIn({
        method: 'Password',
        fields: { Email: 'alice@example.test', Password: 'secret' },
      }, signal())
      await Promise.resolve()
      first.cancel?.()
      aliceResult.resolve({ user: user('alice') })
      Expect((await signingIn).outcome).toEqual({
        status: 'error',
        message: 'Unable to finish cancelling sign-in. Check your connection, then sign in again.',
      })
      Expect(fake.auth.currentUser?.uid).toBe('alice')
      Expect((await second.restore(signal())).state).toBe('ReauthenticationRequired')
      await Expect(second.proof({ kind: 'Session', signal: signal() })).rejects.toThrow(
        'Unable to finish cancelling sign-in',
      )
      Expect(events.some(event => event.principal?.subject === 'alice')).toBe(false)
      Expect(events.at(-1)?.message).toContain('Check your connection')
      const recovered = await second.signIn({
        method: 'Password',
        fields: { Email: 'bob@example.test', Password: 'secret' },
      }, signal())
      Expect(recovered.session?.principal?.subject).toBe('bob')
      Expect((await second.restore(signal())).principal?.subject).toBe('bob')
      Expect((await second.proof({ kind: 'Session', signal: signal() })).subject).toBe('bob')
    } finally {
      first.close?.()
      second.close?.()
    }
  })

  Test('cancelling repeat sign-in preserves the previously accepted same-UID session', async () => {
    const fake = fixture()
    fake.auth.currentUser = user('alice')
    const first = fake.connect()
    const second = fake.connect()
    try {
      Expect((await first.restore(signal())).principal?.subject).toBe('alice')
      Expect((await second.restore(signal())).principal?.subject).toBe('alice')
      const aliceResult = Deferred<{ user: User }>()
      fake.holdSignIn('alice@example.test', aliceResult.promise)
      const signingIn = first.signIn({
        method: 'Password',
        fields: { Email: 'alice@example.test', Password: 'secret' },
      }, signal())
      await Promise.resolve()
      first.cancel?.()
      aliceResult.resolve({ user: user('alice') })
      Expect((await signingIn).outcome.status).toBe('cancelled')
      Expect(fake.calls).toEqual(['signIn:alice@example.test'])
      Expect((await second.restore(signal())).principal?.subject).toBe('alice')
      Expect((await second.proof({ kind: 'Session', signal: signal() })).subject).toBe('alice')
    } finally {
      first.close?.()
      second.close?.()
    }
  })
})
