import type TR from '@runtime/TR'
import { Assert, Errors } from '@shared/core'
import type { AccountProtocol } from 'tao-shared/auth'
import {
  type ClerkDriver,
  type ClerkDriverSession,
  ClerkRevocationError,
  ClerkSignInRejectedError,
} from './ClerkDriver'

type ClerkConnectionHost = {
  driver: ClerkDriver
  logoutStorage: Pick<TR.AuthSecretStorage, 'getItem' | 'setItem'>
  fetch?: typeof fetch
  now?: () => number
  schedule?: (job: () => void, delay: number) => () => void
}

/** No Clerk token or resource credential is exposed to authored Tao values. */
export function createClerkConnection(
  configuration: Readonly<Record<string, unknown>>,
  host: ClerkConnectionHost,
): TR.AuthConnection {
  const { Endpoint: endpoint, Resource: resource, PublishableKey: publishableKey } = configuration
  Assert.input(typeof endpoint === 'string' && endpoint.length > 0, 'Clerk requires an Endpoint.')
  Assert.input(typeof resource === 'string' && resource.length > 0, 'Clerk requires a Resource.')
  Assert.input(typeof publishableKey === 'string' && publishableKey.length > 0, 'Clerk requires a PublishableKey.')
  const base = endpoint.replace(/\/$/, '')
  const driver = host.driver
  const transport = host.fetch ?? fetch
  const now = host.now ?? Date.now
  const schedule = host.schedule ?? ((job, delay) => {
    const timer = setTimeout(job, delay)
    return () => clearTimeout(timer)
  })
  const storageKey = `tao.clerk.logout.${encodeURIComponent(JSON.stringify([publishableKey, endpoint, resource]))}`
  const markerKey = (sessionId: string) => `${storageKey}.session.${encodeURIComponent(sessionId)}`
  const listeners = new Set<(session: TR.AuthSession) => void>()
  const lifetime = new AbortController()
  let generation = 0
  let closed = false
  let explicitLogout = false
  let busy = 0
  let sdkGeneration = 0
  let deferredSDKChange: { session: ClerkDriverSession | null } | undefined
  let sdkSession: ClerkDriverSession | undefined
  let current: AccountProtocol.Session | undefined
  const gatewaySessions = new Map<string, AccountProtocol.Session>()
  const gatewayRevocations = new Map<string, Promise<void>>()
  let cancelRefresh: (() => void) | undefined
  let cancelExpiry: (() => void) | undefined
  let cancelRevocation: (() => void) | undefined
  let refreshing: Promise<void> | undefined
  let pending = new Set<string>()
  let loaded: Promise<void> | undefined
  let persistence = Promise.resolve()
  let flushing: Promise<boolean> | undefined

  const active = (epoch: number, signal: AbortSignal) => !closed && generation === epoch && !signal.aborted
  function notify(value: TR.AuthSession) {
    if (!closed) {
      for (const listener of listeners) {
        listener(value)
      }
    }
  }
  function identity(value: AccountProtocol.Session): TR.AuthSession {
    return { state: 'SignedIn', identity: { accountId: value.accountId, issuer: value.issuer, subject: value.subject } }
  }
  function clear() {
    current = undefined
    cancelRefresh?.()
    cancelExpiry?.()
    cancelRefresh = cancelExpiry = undefined
  }
  function loadPending() {
    loaded ??= (async () => {
      const raw = await host.logoutStorage.getItem(storageKey)
      if (raw === null) {
        return
      }
      const values: unknown = JSON.parse(raw)
      Assert.input(
        Array.isArray(values) && values.every(value => typeof value === 'string'),
        'Clerk logout state is unreadable.',
      )
      pending = new Set(values as string[])
    })()
    return loaded
  }
  function persistPending() {
    const value = JSON.stringify([...pending])
    // This shared array is only a retry hint. Another tab may replace it from a stale snapshot.
    persistence = persistence.then(() => host.logoutStorage.setItem(storageKey, value)).catch(() => undefined)
    return persistence
  }
  async function markPending(sessionId: string) {
    pending.add(sessionId)
    await host.logoutStorage.setItem(markerKey(sessionId), 'true')
    await persistPending()
  }
  async function isLoggedOut(sessionId: string): Promise<boolean> {
    const raw = await host.logoutStorage.getItem(markerKey(sessionId))
    Assert.input(raw === null || raw === 'true' || raw === 'false', 'Clerk logout state is unreadable.')
    if (raw === null && pending.has(sessionId)) {
      // Preserve logout state written before per-session markers were introduced.
      await markPending(sessionId)
    } else if (raw !== 'true') {
      return false
    }
    pending.add(sessionId)
    void flushPending().catch(() => undefined)
    return true
  }
  async function abandonSession(sessionId: string) {
    // The SDK can complete before the gateway request is cancelled. Persist a tombstone before
    // targeted revocation so that a restart cannot restore this abandoned provider session.
    await markPending(sessionId)
    await flushPending()
  }
  function flushPending(): Promise<boolean> {
    flushing ??= (async () => {
      await loadPending()
      for (const id of [...pending]) {
        try {
          await driver.signOut(id)
          // Only a confirmed targeted revocation may clear this session's authoritative marker.
          await host.logoutStorage.setItem(markerKey(id), 'false')
          pending.delete(id)
          if (sdkSession?.id === id) {
            sdkSession = undefined
          }
          await persistPending()
        } catch { /* Keep the tombstone until Clerk confirms revocation. */ }
      }
      return pending.size === 0
    })().finally(() => {
      flushing = undefined
      if (!closed && pending.size > 0 && !cancelRevocation) {
        cancelRevocation = schedule(() => {
          cancelRevocation = undefined
          void flushPending().catch(() => undefined)
        }, 5_000)
      }
    })
    return flushing
  }
  function revokeGateway(value: AccountProtocol.Session): Promise<void> {
    const running = gatewayRevocations.get(value.token)
    if (running) {
      return running
    }
    const revocation = (async () => {
      const response = await transport(`${base}/v1/auth/sign-out`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${value.token}`, 'Content-Type': 'application/json' },
        body: '{}',
      })
      Assert.input(response.ok || response.status === 401, 'The account gateway could not confirm sign-out.')
      gatewaySessions.delete(value.token)
    })().finally(() => {
      gatewayRevocations.delete(value.token)
    })
    gatewayRevocations.set(value.token, revocation)
    return revocation
  }
  function valid(value: unknown, session: ClerkDriverSession): value is AccountProtocol.Session {
    if (typeof value !== 'object' || value === null) {
      return false
    }
    const candidate = value as Partial<AccountProtocol.Session>
    return candidate.resource === resource && candidate.subject === session.userId
      && typeof candidate.token === 'string' && /^[a-f0-9]{96}$/.test(candidate.token)
      && typeof candidate.accountId === 'string' && candidate.accountId.length > 0
      && typeof candidate.issuer === 'string' && candidate.issuer.length > 0
      && typeof candidate.expiresAt === 'number' && Number.isFinite(candidate.expiresAt) && candidate.expiresAt > now()
  }
  function arm(value: AccountProtocol.Session) {
    cancelRefresh?.()
    cancelExpiry?.()
    cancelExpiry = schedule(() => {
      if (current !== value || closed) {
        return
      }
      generation += 1
      clear()
      notify({ state: 'ReauthenticationRequired' })
    }, Math.max(0, value.expiresAt - now()))
    cancelRefresh = schedule(() => {
      cancelRefresh = undefined
      void renew().catch(() => {
        if (current === value && !closed) {
          cancelRefresh = schedule(() => {
            cancelRefresh = undefined
            void renew().catch(() => undefined)
          }, Math.min(5_000, Math.max(0, value.expiresAt - now())))
        }
      })
    }, Math.max(1_000, value.expiresAt - now() - 10_000))
  }
  async function exchange(session: ClerkDriverSession, epoch: number, signal: AbortSignal) {
    const sdkEpoch = sdkGeneration
    Assert.input(!await isLoggedOut(session.id), 'Finish signing out before using this Clerk session again.')
    const token = await session.getToken()
    if (!active(epoch, signal) || sdkEpoch !== sdkGeneration) {
      throw Errors.abortError('Sign-in was cancelled.')
    }
    Assert.input(token !== null, 'Sign in again to access account data.')
    const response = await transport(`${base}/v1/auth/clerk/exchange`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource }),
      signal: signal as NonNullable<Parameters<typeof fetch>[1]>['signal'],
    })
    Assert.input(response.ok, 'Clerk could not authorize this account gateway. Try signing in again.')
    const value: unknown = await response.json()
    Assert.input(valid(value, session), 'The account gateway returned an invalid Clerk session.')
    gatewaySessions.set(value.token, value)
    try {
      Assert.input(!await isLoggedOut(session.id), 'Finish signing out before using this Clerk session again.')
      if (!active(epoch, signal) || sdkEpoch !== sdkGeneration) {
        throw Errors.abortError('Sign-in was cancelled.')
      }
    } catch (error) {
      void revokeGateway(value).catch(() => undefined)
      throw error
    }
    current = value
    sdkSession = session
    arm(value)
    // Even an expired bearer can have an admitted remote write that still needs fencing.
    // Retire replaced credentials promptly and retain failures for explicit logout.
    for (const previous of gatewaySessions.values()) {
      if (previous.token !== value.token) {
        void revokeGateway(previous).catch(() => undefined)
      }
    }
    return identity(value)
  }
  function renew() {
    refreshing ??= (async () => {
      const session = sdkSession
      Assert.input(session !== undefined && !closed && !explicitLogout, 'Sign in again to access account data.')
      const result = await exchange(session, generation, lifetime.signal)
      notify(result)
    })().finally(() => {
      refreshing = undefined
    })
    return refreshing
  }
  function acceptSDKChange(session: ClerkDriverSession | null) {
    if (closed || explicitLogout || (session?.id === sdkSession?.id && (session === null || current))) {
      return
    }
    const epoch = ++generation
    clear()
    sdkSession = session ?? undefined
    notify({ state: 'SignedOut' })
    if (session) {
      void loadPending().then(async () => {
        if (!active(epoch, lifetime.signal)) {
          return
        }
        const result = await exchange(session, epoch, lifetime.signal)
        notify(result)
      }).catch(() => {
        if (active(epoch, lifetime.signal)) {
          notify({ state: 'ReauthenticationRequired' })
        }
      })
    }
  }
  function finishOperation() {
    busy -= 1
    if (busy === 0 && deferredSDKChange) {
      const { session } = deferredSDKChange
      deferredSDKChange = undefined
      acceptSDKChange(session)
    }
  }
  const unsubscribe = driver.subscribe(session => {
    if (closed || explicitLogout) {
      return
    }
    if (session?.id !== sdkSession?.id) {
      sdkGeneration += 1
    }
    if (busy > 0) {
      deferredSDKChange = { session }
      return
    }
    acceptSDKChange(session)
  })
  return {
    capabilities: { methods: ['Password', 'EmailCode'] },
    async restore(signal) {
      const epoch = ++generation
      let sdkEpoch = sdkGeneration
      busy += 1
      try {
        await loadPending()
        await flushPending()
        const session = await driver.restore(signal)
        if (!active(epoch, signal) || !session || explicitLogout || await isLoggedOut(session.id)) {
          return { state: 'SignedOut' }
        }
        sdkSession = session
        sdkEpoch = sdkGeneration
        return await exchange(session, epoch, signal)
      } catch (error) {
        if (!active(epoch, signal) || sdkEpoch !== sdkGeneration) {
          return { state: 'SignedOut' }
        }
        throw error
      } finally {
        finishOperation()
      }
    },
    async signIn(input, signal) {
      const epoch = ++generation
      explicitLogout = false
      busy += 1
      clear()
      let completedSession: ClerkDriverSession | undefined
      try {
        await loadPending()
        const result = await driver.signIn(input, signal)
        if (result.status === 'complete') {
          completedSession = result.session
        }
        if (!active(epoch, signal)) {
          if (completedSession) {
            await abandonSession(completedSession.id)
          }
          return { outcome: { status: 'cancelled' } }
        }
        if (result.status === 'unsupported') {
          return { outcome: { status: 'rejected', message: result.message } }
        }
        if (result.status === 'challenge') {
          return {
            outcome: { status: 'completed' },
            session: { state: 'ChallengeRequired', challenge: { id: result.id, kind: result.kind } },
          }
        }
        sdkSession = result.session
        return { outcome: { status: 'completed' }, session: await exchange(result.session, epoch, signal) }
      } catch (error) {
        const abandonedId = error instanceof ClerkRevocationError ? error.sessionId : completedSession?.id
        if (abandonedId) {
          await abandonSession(abandonedId).catch(() => undefined)
        }
        if (active(epoch, signal) && error instanceof ClerkSignInRejectedError) {
          return { outcome: { status: 'rejected', message: error.message } }
        }
        return {
          outcome: active(epoch, signal)
            ? { status: 'error', message: 'Unable to sign in. Check your details and connection, then try again.' }
            : { status: 'cancelled' },
        }
      } finally {
        finishOperation()
      }
    },
    async signOut() {
      const sessionId = sdkSession?.id
      generation += 1
      explicitLogout = true
      clear()
      sdkSession = undefined
      await loadPending()
      try {
        if (sessionId) {
          await markPending(sessionId)
        } else {
          await persistPending()
        }
        const results = await Promise.allSettled([
          flushPending(),
          ...[...gatewaySessions.values()].map(revokeGateway),
        ])
        return results.every(result => result.status === 'fulfilled' && result.value !== false)
          ? { status: 'completed' }
          : { status: 'error', message: 'Signed out here. Some remote revocations could not be confirmed.' }
      } catch {
        return { status: 'error', message: 'Signed out here, but persistent sign-out could not be confirmed.' }
      }
    },
    cancel() {
      generation += 1
    },
    async credential({ audience, signal }) {
      Assert.input(audience === resource, 'This Clerk session does not authorize that datasource.')
      if (signal.aborted || closed) {
        throw Errors.abortError('The authentication request was cancelled.')
      }
      Assert.input(current !== undefined && current.expiresAt > now(), 'Sign in again to access account data.')
      const epoch = generation
      if (current.expiresAt - now() < 5_000) {
        await renew()
      }
      if (!active(epoch, signal)) {
        throw Errors.abortError('The authentication request was cancelled.')
      }
      Assert.input(current !== undefined && current.expiresAt > now(), 'Sign in again to access account data.')
      return { audience, value: current.token, expiresAt: current.expiresAt }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close() {
      closed = true
      generation += 1
      lifetime.abort()
      clear()
      cancelRevocation?.()
      unsubscribe()
      driver.close()
      listeners.clear()
    },
  }
}
