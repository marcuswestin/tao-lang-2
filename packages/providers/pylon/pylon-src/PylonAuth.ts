import TR from '@runtime/TR'
import { Assert, Errors } from '@shared/core'

type Session = Readonly<{ token: string; user_id: string; expires_at: number; email?: string }>
type Stored = Readonly<{ current?: Session; revocations: readonly Session[] }>
type Me = Readonly<{ user_id: string | null; email?: string | null }>

export type PylonAuthClient = Readonly<{
  initialize(baseURL: string): Promise<void>
  token(): string | null
  setToken(token: string | null): Promise<void>
  sendEmailCode(email: string): Promise<{ sent: boolean }>
  verifyEmailCode(email: string, code: string): Promise<{
    token: string
    user_id?: string | null
    expires_at?: number | string | null
  }>
}>

export type PylonAuthHost = Readonly<{
  client?: PylonAuthClient
  fetch?: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => ReturnType<typeof fetch>
  now?: () => number
  schedule?: (retry: () => void, delay: number) => () => void
  storage?: TR.AuthSecretStorage
}>

// React Native's fetch declaration names its own AbortSignal; both use the same runtime signal.
function transportSignal(signal: AbortSignal): NonNullable<Parameters<typeof fetch>[1]>['signal'] {
  return signal as NonNullable<Parameters<typeof fetch>[1]>['signal']
}

const emailPattern = /^[^\s@]+@[^\s@]+$/
const providerName = 'PylonAuth'

/** PylonAuth signs in with Pylon magic codes and issues a revocable bearer Session proof. */
export function PylonAuthProvider(host: PylonAuthHost = {}): TR.AuthProvider {
  return {
    connect({ configuration }) {
      const baseURL = pylonBaseURL(configuration)
      const client = host.client ?? nativePylonClient
      const transport = host.fetch ?? fetch
      const now = host.now ?? Date.now
      const maybeStorage = host.storage ?? TR.Auth.SecureStorage()
      Assert.input(maybeStorage !== undefined, 'PylonAuth needs persistent credential storage on this device.')
      const storage: TR.AuthSecretStorage = maybeStorage
      const schedule = host.schedule ?? ((retry, delay) => {
        const timer = setTimeout(retry, delay)
        return () => clearTimeout(timer)
      })
      const key = `tao.auth.pylon.${Array.from(baseURL, character => character.codePointAt(0)!.toString(16)).join('-')}`
      const issuer = `pylon:${baseURL}`
      const listeners = new Set<(session: TR.AuthConnectionSession) => void>()
      const lifetime = new AbortController()
      let current: Session | undefined
      let pending: Session[] = []
      let challengeEmail: string | undefined
      let loaded: Promise<void> | undefined
      let storageWrite: Promise<void> = Promise.resolve()
      let revoking: Promise<boolean> | undefined
      let cancelRetry: (() => void) | undefined
      let retryDelay = 1_000
      let closed = false

      function persist(): Promise<void> {
        const record: Stored = { ...(current ? { current } : {}), revocations: [...pending] }
        storageWrite = storageWrite.catch(() => undefined).then(() =>
          record.current || record.revocations.length > 0
            ? storage.setItem(key, JSON.stringify(record))
            : storage.removeItem(key)
        )
        return storageWrite
      }

      function notify(session: TR.AuthConnectionSession): void {
        for (const listener of listeners) {
          listener(session)
        }
      }

      function signedIn(value: Session): TR.AuthConnectionSession {
        return {
          state: 'SignedIn',
          principal: {
            issuer,
            subject: value.user_id,
            ...(value.email ? { email: value.email, emailVerified: true } : {}),
          },
        }
      }

      function retryLater(): void {
        if (closed || pending.length === 0 || cancelRetry) {
          return
        }
        cancelRetry = schedule(() => {
          cancelRetry = undefined
          void revokePending()
        }, retryDelay)
        retryDelay = Math.min(retryDelay * 2, 60_000)
      }

      function revokePending(): Promise<boolean> {
        if (revoking) {
          return revoking
        }
        revoking = (async () => {
          for (const value of [...pending]) {
            if (closed) {
              return false
            }
            try {
              const response = sessionExpired(value, now())
                ? undefined
                : await transport(`${baseURL}/api/auth/session`, {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${value.token}` },
                  signal: transportSignal(lifetime.signal),
                })
              if (closed) {
                return false
              }
              // A server that no longer knows the token has already achieved revocation.
              const body = response?.ok ? await response.json() as { revoked?: unknown } : undefined
              if (response !== undefined && response.status !== 401 && (!response.ok || body?.revoked !== true)) {
                continue
              }
              pending = pending.filter(session => session.token !== value.token)
              await persist()
            } catch { /* The persisted revocation remains queued for retry. */ }
          }
          if (pending.length === 0) {
            retryDelay = 1_000
          }
          return pending.length === 0
        })().finally(() => {
          revoking = undefined
          retryLater()
        })
        return revoking
      }

      async function ensureLoaded(): Promise<void> {
        loaded ??= (async () => {
          await client.initialize(baseURL)
          const saved = await storage.getItem(key)
          if (saved) {
            let record: unknown
            try {
              record = JSON.parse(saved)
            } catch {
              record = undefined
            }
            if (typeof record === 'object' && record !== null) {
              const value = record as Partial<Stored>
              current = validSession(value.current) ? value.current : undefined
              pending = Array.isArray(value.revocations) ? value.revocations.filter(validSession) : []
            }
          }
          // The secure record is authoritative. A token queued for revocation cannot be restored
          // just because the native SDK's write-through AsyncStorage bridge still holds it.
          if (client.token() !== (current?.token ?? null)) {
            await client.setToken(current?.token ?? null)
          }
          if (pending.length > 0) {
            void revokePending()
          }
        })()
        return loaded
      }

      async function abandon(value: Session): Promise<void> {
        if (current?.token === value.token) {
          current = undefined
        }
        if (!pending.some(session => session.token === value.token)) {
          pending.push(value)
        }
        await persist()
        await client.setToken(null)
        void revokePending()
      }

      return {
        capabilities: { methods: ['EmailCode'] },
        async restore(signal) {
          await ensureLoaded()
          if (signal.aborted || closed) {
            return { state: 'SignedOut' }
          }
          if (!current) {
            return { state: 'SignedOut' }
          }
          if (sessionExpired(current, now())) {
            current = undefined
            await persist()
            await client.setToken(null)
            return { state: 'ReauthenticationRequired' }
          }
          let response: Response
          try {
            response = await transport(`${baseURL}/api/auth/me`, {
              headers: { Authorization: `Bearer ${current.token}` },
              signal: transportSignal(signal),
            })
          } catch {
            // The unexpired secure record permits a cold offline launch. The server may still have
            // revoked it; the next online request and the datasource must check independently.
            return signedIn(current)
          }
          if (signal.aborted || closed) {
            return { state: 'SignedOut' }
          }
          if (response.status >= 500) {
            return signedIn(current)
          }
          const me = response.ok ? await response.json() as Me : undefined
          if (!me?.user_id || me.user_id !== current.user_id) {
            current = undefined
            await persist()
            await client.setToken(null)
            return { state: 'ReauthenticationRequired' }
          }
          return signedIn(current)
        },
        async signIn(input, signal) {
          if (input.method !== 'EmailCode') {
            return { outcome: { status: 'rejected', message: 'This provider supports email code sign-in.' } }
          }
          await ensureLoaded()
          if (signal.aborted || closed) {
            return { outcome: { status: 'cancelled' } }
          }
          const typed = input.fields?.['Email']?.trim().toLowerCase() ?? ''
          if (!input.challengeId) {
            if (!emailPattern.test(typed)) {
              return { outcome: { status: 'rejected', message: 'Enter a valid email address.' } }
            }
            try {
              const sent = await client.sendEmailCode(typed)
              if (!sent.sent) {
                return { outcome: { status: 'rejected', message: 'Unable to send a code to that email.' } }
              }
            } catch (error) {
              return {
                outcome: authFailure(error, 'Unable to send a sign-in code. Check your connection and try again.'),
              }
            }
            if (signal.aborted || closed) {
              return { outcome: { status: 'cancelled' } }
            }
            challengeEmail = typed
            return {
              outcome: { status: 'completed' },
              session: { state: 'ChallengeRequired', challenge: { id: typed, kind: 'EmailCode' } },
            }
          }
          const email = typed || (challengeEmail === input.challengeId ? challengeEmail : input.challengeId)
          const code = input.fields?.['Code']?.trim() ?? ''
          if (!emailPattern.test(email)) {
            return { outcome: { status: 'rejected', message: 'Request a new code to sign in.' } }
          }
          if (!code) {
            return { outcome: { status: 'rejected', message: 'Enter the code from your email.' } }
          }
          let issued: Awaited<ReturnType<PylonAuthClient['verifyEmailCode']>>
          try {
            issued = await client.verifyEmailCode(email, code)
          } catch (error) {
            return { outcome: authFailure(error, 'Unable to check the code. Check your connection and try again.') }
          }
          const value = sessionOf(issued, email)
          if (signal.aborted || closed) {
            await abandon(value)
            return { outcome: { status: 'cancelled' } }
          }
          current = value
          try {
            await persist()
            await client.setToken(value.token)
          } catch (error) {
            await abandon(value)
            return { outcome: { status: 'error', message: 'The session could not be saved on this device.' } }
          }
          if (signal.aborted || closed) {
            await abandon(value)
            return { outcome: { status: 'cancelled' } }
          }
          challengeEmail = undefined
          notify(signedIn(value))
          return { outcome: { status: 'completed' }, session: signedIn(value) }
        },
        cancel() {
          challengeEmail = undefined
        },
        async signOut() {
          await ensureLoaded()
          challengeEmail = undefined
          const value = current
          current = undefined
          if (value && !pending.some(session => session.token === value.token)) {
            pending.push(value)
          }
          try {
            await persist()
          } catch {
            current = value
            pending = pending.filter(session => session.token !== value?.token)
            return { status: 'error', message: 'Unable to finish local sign-out. Please try again.' }
          }
          try {
            await client.setToken(null)
          } catch {
            // The durable record already excludes the current session and retains revocation.
            notify({ state: 'SignedOut' })
            retryLater()
            return { status: 'error', message: 'Unable to finish local sign-out. Please try again.' }
          }
          notify({ state: 'SignedOut' })
          return await revokePending()
            ? { status: 'completed' }
            : { status: 'error', message: 'Signed out on this device. Server revocation will retry when connected.' }
        },
        async proof({ kind, signal }) {
          await ensureLoaded()
          if (signal.aborted) {
            throw Errors.abortError('The authentication request was cancelled.')
          }
          Assert.input(kind === 'Session', `PylonAuth issues Session sign-in proofs, not ${kind}.`)
          Assert.input(
            current !== undefined && !sessionExpired(current, now()),
            'Sign in again to access account data.',
          )
          return {
            kind,
            issuer,
            subject: current.user_id,
            value: { baseURL, token: current.token },
            ...(current.expires_at === 0 ? {} : { expiresAt: current.expires_at * 1_000 }),
          }
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        close() {
          closed = true
          lifetime.abort()
          cancelRetry?.()
          listeners.clear()
        },
      }
    },
  }
}

function validSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const session = value as Partial<Session>
  return typeof session.token === 'string' && session.token.length > 0
    && typeof session.user_id === 'string' && session.user_id.length > 0
    && typeof session.expires_at === 'number' && Number.isFinite(session.expires_at)
}

/** Pylon's zero expiry denotes a non-expiring server session. */
function sessionExpired(value: Session, now: number): boolean {
  return value.expires_at !== 0 && value.expires_at * 1_000 <= now
}

function sessionOf(value: Awaited<ReturnType<PylonAuthClient['verifyEmailCode']>>, email: string): Session {
  const expires = typeof value.expires_at === 'string' ? Number(value.expires_at) : value.expires_at
  const session = { token: value.token, user_id: value.user_id, expires_at: expires, email }
  Assert.input(validSession(session), 'Pylon returned an invalid sign-in session.')
  return session
}

function authFailure(error: unknown, fallback: string): TR.AuthOutcome {
  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined
  return typeof status === 'number' && status >= 400 && status < 500
    ? { status: 'rejected', message: 'The email or code was not accepted. Try again.' }
    : { status: 'error', message: fallback }
}

export function pylonBaseURL(configuration: Readonly<Record<string, unknown>>): string {
  const value = configuration['BaseURL']
  Assert.input(
    typeof value === 'string' && value.trim().length > 0,
    `${providerName} configuration 'BaseURL' expects a URL.`,
  )
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return Errors.throwUserInput(`${providerName} configuration 'BaseURL' expects an HTTP URL.`)
  }
  Assert.input(
    url.protocol === 'http:' || url.protocol === 'https:',
    `${providerName} configuration 'BaseURL' expects an HTTP URL.`,
  )
  Assert.input(
    !url.username && !url.password && !url.search && !url.hash,
    `${providerName} BaseURL cannot contain credentials, a query, or a fragment.`,
  )
  return url.toString().replace(/\/$/, '')
}

// The native client is one process-wide sync engine. Both declarations must use the same address.
let initializedURL: string | undefined
export const nativePylonClient: PylonAuthClient = {
  async initialize(baseURL) {
    if (initializedURL === baseURL) {
      return
    }
    Assert.input(initializedURL === undefined, 'The native Pylon client is already connected to another BaseURL.')
    const sdk = nativeSDK()
    await sdk.init({ baseUrl: baseURL, appName: `tao-${encodeURIComponent(baseURL)}` })
    initializedURL = baseURL
  },
  token() {
    const sdk = nativeSDK()
    return sdk.getReactStorage().get(sdk.storageKey('token')) ?? null
  },
  async setToken(token) {
    const sdk = nativeSDK()
    await sdk.setSessionToken(token)
  },
  async sendEmailCode(email) {
    const sdk = nativeSDK()
    return sdk.sendEmailCode(email)
  },
  async verifyEmailCode(email, code) {
    const sdk = nativeSDK()
    return sdk.verifyEmailCode(email, code)
  },
}

/** Exact 0.20.0 native entrypoints; the published TS source fails this repo's stricter checker. */
export type NativeSDK = Readonly<{
  init(config: { appName: string; baseUrl: string }): Promise<void>
  getReactStorage(): { get(key: string): string | null | undefined }
  storageKey(slot: string): string
  setSessionToken(token: string | null): Promise<void>
  sendEmailCode(email: string): Promise<{ sent: boolean }>
  verifyEmailCode(email: string, code: string): Promise<{
    token: string
    user_id?: string | null
    expires_at?: number | string | null
  }>
  getSync(): {
    pull(): Promise<void>
    fn<T = unknown>(name: string, args?: unknown): Promise<T>
    store: {
      list(entity: string): Record<string, unknown>[]
      subscribe(listener: () => void): () => void
    }
  }
}>

export function nativeSDK(): NativeSDK {
  return require('@pylonsync/react-native') as NativeSDK
}
