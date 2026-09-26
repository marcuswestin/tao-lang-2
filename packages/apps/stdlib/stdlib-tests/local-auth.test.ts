import { Errors } from '@shared/core'
import { Deferred, Describe, Expect, Test, until } from '@shared/test'
import type { AccountProtocol } from 'tao-shared/auth'
import { LocalAuthProvider } from '../@tao/auth/local/LocalAuth'

type AuthTransport = NonNullable<NonNullable<Parameters<typeof LocalAuthProvider>[0]>['fetch']>

const signal = () => new AbortController().signal
const session = (token: string): AccountProtocol.Session => ({
  token,
  accountId: token,
  subject: token,
  issuer: 'local',
  resource: 'notes',
  expiresAt: Date.now() + 60_000,
})
const configuration = { Endpoint: 'http://localhost:4738', Resource: 'notes' }

Describe('LocalAuth session lifetime', () => {
  Test('offline sign-out clears access immediately and restores only the queued revocation', async () => {
    const values = new Map<string, string>()
    const secureStorage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        values.set(key, value)
      },
      removeItem: async (key: string) => {
        values.delete(key)
      },
    }
    let online = false
    const revoked: string[] = []
    let retries = 0
    const transport: AuthTransport = (async (url: string, options?: RequestInit) => {
      if (url.endsWith('sign-in')) {
        return Response.json(session('first'))
      }
      if (url.endsWith('sign-out')) {
        if (!online) {
          throw Errors.abortError('Offline test transport')
        }
        revoked.push(new Headers(options?.headers).get('Authorization')!)
        return Response.json({})
      }
      return Response.json({}, { status: 401 })
    }) as AuthTransport
    const provider = LocalAuthProvider({
      fetch: transport,
      secureStorage,
      schedule: (_retry, delay) => {
        if (delay === 1_000) {
          retries += 1
        }
        return () => undefined
      },
    })
    const first = provider.connect({ configuration })
    await first.signIn({ method: 'Password', fields: { Email: 'alice', Password: 'secret' } }, signal())
    Expect((await first.signOut(signal())).status).toBe('error')
    await Expect(first.credential({ audience: 'notes', signal: signal() })).rejects.toThrow('Sign in again')
    const record = JSON.parse([...values.values()][0]!)
    Expect(record.session).toBeUndefined()
    Expect(record.revocations).toHaveLength(1)
    Expect(retries).toBe(1)
    first.close?.()
    online = true
    const second = provider.connect({ configuration })
    Expect((await second.restore(signal())).state).toBe('SignedOut')
    await until(() => values.size === 0)
    Expect(revoked).toEqual(['Bearer first'])
    second.close?.()
  })

  Test('completion of an old sign-out cannot revoke or erase a newer sign-in', async () => {
    const pending = Deferred<Response>()
    let signIns = 0
    const revoked: string[] = []
    const transport: AuthTransport = (async (url: string, options?: RequestInit) => {
      if (url.endsWith('sign-in')) {
        return Response.json(session(++signIns === 1 ? 'old' : 'new'))
      }
      revoked.push(new Headers(options?.headers).get('Authorization')!)
      return pending.promise
    }) as AuthTransport
    const connection = LocalAuthProvider({ fetch: transport, secureStorage: null, schedule: () => () => undefined })
      .connect({ configuration })
    await connection.signIn({ method: 'Password' }, signal())
    const leaving = connection.signOut(signal())
    await until(() => revoked.length === 1)
    await connection.signIn({ method: 'Password' }, signal())
    pending.resolve(Response.json({}))
    await leaving
    Expect((await connection.credential({ audience: 'notes', signal: signal() })).value).toBe('new')
    Expect(revoked).toEqual(['Bearer old'])
    connection.close?.()
  })

  Test('cancellation during secure persistence cannot leave a restorable session', async () => {
    const saving = Deferred<void>()
    let record: string | undefined
    let writes = 0
    const secureStorage = {
      getItem: async () => record ?? null,
      setItem: async (_key: string, value: string) => {
        writes += 1
        if (writes === 1) {
          await saving.promise
        }
        record = value
      },
      removeItem: async () => {
        record = undefined
      },
    }
    const transport = (async (url: string) =>
      url.endsWith('sign-in')
        ? Response.json(session('cancelled'))
        : Response.json({}, { status: 503 })) as AuthTransport
    const connection = LocalAuthProvider({ fetch: transport, secureStorage, schedule: () => () => undefined }).connect({
      configuration,
    })
    const operation = new AbortController()
    const signingIn = connection.signIn({ method: 'Password' }, operation.signal)
    await until(() => writes === 1)
    operation.abort()
    saving.resolve()
    Expect((await signingIn).outcome.status).toBe('cancelled')
    Expect(JSON.parse(record!).session).toBeUndefined()
    Expect(JSON.parse(record!).revocations[0].token).toBe('cancelled')
    await Expect(connection.credential({ audience: 'notes', signal: signal() })).rejects.toThrow('Sign in again')
    connection.close?.()
  })

  Test('native cached restore unlocks offline data until revalidation rejects the session', async () => {
    let record: string | undefined = JSON.stringify({ session: session('cached'), revocations: [] })
    let connected = false
    const jobs = new Map<number, () => void>()
    const changes: string[] = []
    const secureStorage = {
      getItem: async () => record ?? null,
      setItem: async (_key: string, value: string) => {
        record = value
      },
      removeItem: async () => {
        record = undefined
      },
    }
    const transport = (async () => {
      if (!connected) {
        throw Errors.abortError('Offline test transport')
      }
      return Response.json({}, { status: 401 })
    }) as AuthTransport
    const connection = LocalAuthProvider({
      fetch: transport,
      secureStorage,
      schedule: (job, delay) => {
        jobs.set(delay, job)
        return () => {
          jobs.delete(delay)
        }
      },
    }).connect({ configuration })
    connection.subscribe!(value => changes.push(value.state))
    Expect((await connection.restore(signal())).state).toBe('SignedIn')
    Expect((await connection.credential({ audience: 'notes', signal: signal() })).value).toBe('cached')
    connected = true
    jobs.get(1_000)!()
    await until(() => changes.includes('ReauthenticationRequired') && record === undefined)
    await Expect(connection.credential({ audience: 'notes', signal: signal() })).rejects.toThrow('Sign in again')
    connection.close?.()
  })

  Test('expired, revoked, and malformed native sessions never restore a cached identity', async () => {
    for (const status of ['expired', 'revoked', 'malformed']) {
      const saved = session('denied')
      if (status === 'expired') {
        saved.expiresAt = Date.now() - 1
      }
      let record: string | undefined = JSON.stringify({ session: saved, revocations: [] })
      const connection = LocalAuthProvider({
        fetch: (async () => Response.json({}, { status: status === 'revoked' ? 403 : 200 })) as AuthTransport,
        secureStorage: {
          getItem: async () => record ?? null,
          setItem: async (_key, value) => {
            record = value
          },
          removeItem: async () => {
            record = undefined
          },
        },
        schedule: () => () => undefined,
      }).connect({ configuration })
      Expect((await connection.restore(signal())).state).toBe('ReauthenticationRequired')
      Expect(record).toBeUndefined()
      connection.close?.()
    }
  })

  Test('session expiry emits reauthentication and removes the native session', async () => {
    let now = 10_000
    const cached = { ...session('expires'), expiresAt: 10_500 }
    let record: string | undefined = JSON.stringify({ session: cached, revocations: [] })
    let expiry: (() => void) | undefined
    const changes: string[] = []
    const connection = LocalAuthProvider({
      now: () => now,
      fetch: (async () => Response.json(cached)) as AuthTransport,
      secureStorage: {
        getItem: async () => record ?? null,
        setItem: async (_key, value) => {
          record = value
        },
        removeItem: async () => {
          record = undefined
        },
      },
      schedule: job => {
        expiry = job
        return () => {
          expiry = undefined
        }
      },
    }).connect({ configuration })
    connection.subscribe!(value => changes.push(value.state))
    Expect((await connection.restore(signal())).state).toBe('SignedIn')
    now = 10_501
    expiry!()
    await until(() => record === undefined)
    Expect(changes).toEqual(['ReauthenticationRequired'])
    await Expect(connection.credential({ audience: 'notes', signal: signal() })).rejects.toThrow('Sign in again')
    connection.close?.()
  })
})
