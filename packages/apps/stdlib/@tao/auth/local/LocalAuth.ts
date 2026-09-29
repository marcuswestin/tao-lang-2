import TR from '@runtime/TR'
import { Assert, Errors } from '@shared/core'
import type { AccountProtocol } from 'tao-shared/auth'

type LocalAuthHost = {
  fetch?: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => ReturnType<typeof fetch>
  now?: () => number
  secureStorage?: ReturnType<typeof TR.Auth.SecureStorage> | null
  schedule?: (retry: () => void, delay: number) => () => void
}
type SessionRecord = { session?: AccountProtocol.Session; revocations: AccountProtocol.Session[] }

/** LocalAuthProvider delegates password verification and account provisioning to the trusted server. */
export function LocalAuthProvider(host: LocalAuthHost = {}): TR.AuthProvider {
  return {
    connect({ configuration }) {
      const endpoint = configuration['Endpoint']
      const resource = configuration['Resource']
      Assert.input(typeof endpoint === 'string' && endpoint.length > 0, 'LocalAuth requires an Endpoint.')
      Assert.input(typeof resource === 'string' && resource.length > 0, 'LocalAuth requires a Resource.')
      const now = host.now ?? Date.now
      const baseURL = endpoint.replace(/\/$/, '')
      let current: AccountProtocol.Session | undefined
      const secure = host.secureStorage === null ? undefined : host.secureStorage ?? TR.Auth.SecureStorage()
      const transport = host.fetch ?? fetch
      const schedule = host.schedule ?? ((retry, delay) => {
        const timer = setTimeout(retry, delay)
        return () => clearTimeout(timer)
      })
      const storageKey = 'tao.auth.'
        + Array.from(JSON.stringify([endpoint, resource]), character => character.codePointAt(0)!.toString(16)).join(
          '-',
        )
      let pending: AccountProtocol.Session[] = []
      let storageWrite = Promise.resolve()
      let cancelRetry: (() => void) | undefined
      let retryDelay = 1_000
      let closed = false
      let retrying: Promise<boolean> | undefined
      let cancelExpiry: (() => void) | undefined
      let cancelRevalidation: (() => void) | undefined
      let revalidationDelay = 1_000
      const listeners = new Set<(session: TR.AuthConnectionSession) => void>()
      const lifetime = new AbortController()
      function persist() {
        const record: SessionRecord = { ...(current ? { session: current } : {}), revocations: [...pending] }
        storageWrite = storageWrite.catch(() => undefined).then(async () => {
          if (!secure) {
            return
          }
          if (record.session || record.revocations.length) {
            await secure.setItem(storageKey, JSON.stringify(record))
          } else {
            await secure.removeItem(storageKey)
          }
        })
        return storageWrite
      }
      async function request(
        path: string,
        signal: AbortSignal,
        body?: unknown,
        token = current?.token,
      ): Promise<Response> {
        return transport(`${baseURL}/v1/auth/${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          // RN and browser ambient AbortSignal declarations differ; both hosts consume this same signal.
          signal: signal as NonNullable<Parameters<typeof fetch>[1]>['signal'],
        })
      }
      function retryLater() {
        if (closed || cancelRetry || pending.length === 0) {
          return
        }
        cancelRetry = schedule(() => {
          cancelRetry = undefined
          void revokePending()
        }, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 60_000)
      }
      function revokePending(): Promise<boolean> {
        if (retrying) {
          return retrying
        }
        retrying = (async () => {
          for (const session of [...pending]) {
            if (closed) {
              return false
            }
            try {
              const response = session.expiresAt <= now()
                ? undefined
                : await request('sign-out', lifetime.signal, {}, session.token)
              if (closed) {
                return false
              }
              if (response && !response.ok && response.status !== 401) {
                continue
              }
              pending = pending.filter(value => value.token !== session.token)
              await persist()
            } catch { /* The durable revocation remains queued until transport or storage recovers. */ }
          }
          if (pending.length === 0) {
            retryDelay = 1_000
          }
          return pending.length === 0
        })().finally(() => {
          retrying = undefined
          retryLater()
        })
        return retrying
      }
      function notify(value: TR.AuthConnectionSession) {
        for (const listener of listeners) {
          listener(value)
        }
      }
      function validSession(value: unknown): value is AccountProtocol.Session {
        if (typeof value !== 'object' || value === null) {
          return false
        }
        const candidate = value as Partial<AccountProtocol.Session>
        return ['token', 'accountId', 'issuer', 'subject'].every(key =>
          typeof candidate[key as keyof AccountProtocol.Session] === 'string'
          && candidate[key as keyof AccountProtocol.Session] !== ''
        )
          && candidate.resource === resource && typeof candidate.expiresAt === 'number'
          && Number.isFinite(candidate.expiresAt)
      }
      function setCurrent(value?: AccountProtocol.Session) {
        current = value
        cancelExpiry?.()
        cancelExpiry = undefined
        cancelRevalidation?.()
        cancelRevalidation = undefined
        if (!value || closed) {
          return
        }
        cancelExpiry = schedule(() => {
          if (closed || current?.token !== value.token) {
            return
          }
          if (value.expiresAt > now()) {
            setCurrent(value)
            return
          }
          setCurrent()
          notify({ state: 'ReauthenticationRequired' })
          void persist().catch(() =>
            notify({ state: 'Error', message: 'The expired session could not be removed from secure storage.' })
          )
        }, Math.min(Math.max(0, value.expiresAt - now()), 2_147_000_000))
      }
      function revalidateLater() {
        if (closed || !current || cancelRevalidation) {
          return
        }
        const expected = current
        cancelRevalidation = schedule(() => {
          cancelRevalidation = undefined
          void revalidate(expected)
        }, revalidationDelay)
        revalidationDelay = Math.min(revalidationDelay * 2, 60_000)
      }
      async function revalidate(expected: AccountProtocol.Session) {
        let response: Response
        try {
          response = await request('session', lifetime.signal, undefined, expected.token)
        } catch {
          if (!closed && current?.token === expected.token) {
            revalidateLater()
          }
          return
        }
        if (closed || current?.token !== expected.token) {
          return
        }
        if (response.status >= 500) {
          revalidateLater()
          return
        }
        let value: unknown
        try {
          value = response.ok ? await response.json() : undefined
        } catch {
          value = undefined
        }
        if (closed || current?.token !== expected.token) {
          return
        }
        if (!validSession(value) || value.expiresAt <= now()) {
          setCurrent()
          notify({ state: 'ReauthenticationRequired' })
        } else {
          revalidationDelay = 1_000
          setCurrent(value)
          notify(session(value))
        }
        await persist().catch(() =>
          notify({ state: 'Error', message: 'The session could not be updated in secure storage.' })
        )
      }
      async function abandon(value: AccountProtocol.Session) {
        if (current?.token === value.token) {
          setCurrent()
        }
        if (!pending.some(session => session.token === value.token)) {
          pending.push(value)
        }
        await persist()
        void revokePending()
      }
      function session(value: AccountProtocol.Session): TR.AuthConnectionSession {
        return { state: 'SignedIn', principal: { issuer: value.issuer, subject: value.subject } }
      }
      return {
        capabilities: { methods: ['Password'] },
        async restore(signal) {
          if (!current && secure) {
            const saved = await secure.getItem(storageKey)
            if (signal.aborted) {
              return { state: 'SignedOut' }
            }
            if (saved) {
              try {
                const record = JSON.parse(saved) as SessionRecord
                setCurrent(validSession(record.session) ? record.session : undefined)
                pending = Array.isArray(record.revocations) ? record.revocations.filter(validSession) : []
              } catch {
                setCurrent()
                await persist()
              }
            }
          }
          if (pending.length) {
            void revokePending()
          }
          if (signal.aborted || !current) {
            return { state: 'SignedOut' }
          }
          if (current.expiresAt <= now()) {
            setCurrent()
            await persist()
            return { state: 'ReauthenticationRequired' }
          }
          let response: Response
          try {
            response = await request('session', signal)
          } catch (error) {
            if (signal.aborted) {
              return { state: 'SignedOut' }
            }
            if (!secure || !current) {
              throw error
            }
            revalidateLater()
            return session(current)
          }
          if (signal.aborted) {
            return { state: 'SignedOut' }
          }
          if (response.status >= 500 && secure && current) {
            revalidateLater()
            return session(current)
          }
          let restored: unknown
          try {
            restored = response.ok ? await response.json() : undefined
          } catch {
            restored = undefined
          }
          if (signal.aborted) {
            return { state: 'SignedOut' }
          }
          if (!validSession(restored) || restored.expiresAt <= now()) {
            setCurrent()
            await persist()
            return { state: 'ReauthenticationRequired' }
          }
          setCurrent(restored)
          await persist()
          return session(restored)
        },
        async signIn(input, signal) {
          if (input.method !== 'Password') {
            return { outcome: { status: 'rejected', message: 'This provider supports password sign-in.' } }
          }
          const response = await request(
            input.fields?.['Register'] === 'true' ? 'sign-up' : 'sign-in',
            signal,
            {
              email: input.fields?.['Email'] ?? '',
              password: input.fields?.['Password'] ?? '',
              resource,
            } satisfies AccountProtocol.Credentials,
          )
          if (!response.ok) {
            return {
              outcome: {
                status: response.status < 500 ? 'rejected' : 'error',
                message: 'Unable to sign in. Check your details and try again.',
              },
            }
          }
          const result = await response.json() as AccountProtocol.Session
          if (signal.aborted) {
            await abandon(result)
            return { outcome: { status: 'cancelled' } }
          }
          Assert.input(validSession(result) && result.expiresAt > now(), 'The auth server returned an invalid session.')
          setCurrent(result)
          await persist()
          if (signal.aborted) {
            await abandon(result)
            return { outcome: { status: 'cancelled' } }
          }
          return { outcome: { status: 'completed' }, session: session(result) }
        },
        async signOut() {
          if (current && !pending.some(value => value.token === current!.token)) {
            pending.push(current)
          }
          setCurrent()
          // One secure record prevents a restart from restoring a session queued for revocation.
          await persist()
          return await revokePending()
            ? { status: 'completed' }
            : { status: 'error', message: 'Signed out on this device. Server revocation will retry when connected.' }
        },
        /** The Session proof is the server session itself; only a datasource naming LocalAuth accepts it. */
        async proof({ kind, signal }) {
          if (signal.aborted) {
            throw Errors.abortError('The authentication request was cancelled.')
          }
          Assert.input(kind === 'Session', `LocalAuth issues Session sign-in proofs, not ${kind}.`)
          Assert.input(current !== undefined && current.expiresAt > now(), 'Sign in again to access account data.')
          return {
            kind,
            issuer: current.issuer,
            subject: current.subject,
            value: { ...current },
            expiresAt: current.expiresAt,
          }
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        close() {
          closed = true
          current = undefined
          lifetime.abort()
          cancelRetry?.()
          cancelExpiry?.()
          cancelRevalidation?.()
          listeners.clear()
        },
      }
    },
  }
}
