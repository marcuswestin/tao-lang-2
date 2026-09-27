import type TR from '@runtime/TR'
import { Assert, Errors } from '@shared/core'
import {
  ClerkConfigurationError,
  type ClerkDriver,
  type ClerkDriverSession,
  ClerkRevocationError,
  ClerkSignInRejectedError,
} from './ClerkDriver'

type ClerkConnectionHost = {
  driver: ClerkDriver
  logoutStorage: Pick<TR.AuthSecretStorage, 'getItem' | 'setItem'>
  schedule?: (job: () => void, delay: number) => () => void
}

/**
 * No Clerk token is exposed to authored Tao values. The connection reports the Clerk user as the
 * principal and issues its session token as an IdentityToken proof; the datasource exchanges it.
 */
export function createClerkConnection(
  configuration: Readonly<Record<string, unknown>>,
  host: ClerkConnectionHost,
): TR.AuthConnection {
  const { PublishableKey: publishableKey } = configuration
  Assert.input(typeof publishableKey === 'string' && publishableKey.length > 0, 'Clerk requires a PublishableKey.')
  const driver = host.driver
  const schedule = host.schedule ?? ((job, delay) => {
    const timer = setTimeout(job, delay)
    return () => clearTimeout(timer)
  })
  const storageKey = `tao.clerk.logout.${encodeURIComponent(JSON.stringify([publishableKey]))}`
  const markerKey = (sessionId: string) => `${storageKey}.session.${encodeURIComponent(sessionId)}`
  const listeners = new Set<(session: TR.AuthConnectionSession) => void>()
  const lifetime = new AbortController()
  let generation = 0
  let closed = false
  let explicitLogout = false
  let busy = 0
  let sdkGeneration = 0
  let deferredSDKChange: { session: ClerkDriverSession | null } | undefined
  let sdkSession: ClerkDriverSession | undefined
  let principal: TR.AuthPrincipal | undefined
  let cancelRevocation: (() => void) | undefined
  let pending = new Set<string>()
  let loaded: Promise<void> | undefined
  let persistence = Promise.resolve()
  let flushing: Promise<boolean> | undefined

  const active = (epoch: number, signal: AbortSignal) => !closed && generation === epoch && !signal.aborted
  function notify(value: TR.AuthConnectionSession) {
    if (!closed) {
      for (const listener of listeners) {
        listener(value)
      }
    }
  }
  function clear() {
    principal = undefined
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
    // The SDK can complete before the sign-in is cancelled. Persist a tombstone before
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
  /** sessionToken reads the SDK session's current token after confirming no tab signed it out. */
  async function sessionToken(session: ClerkDriverSession, epoch: number, signal: AbortSignal) {
    const sdkEpoch = sdkGeneration
    Assert.input(!await isLoggedOut(session.id), 'Finish signing out before using this Clerk session again.')
    const token = await session.getToken()
    if (!active(epoch, signal) || sdkEpoch !== sdkGeneration) {
      throw Errors.abortError('Sign-in was cancelled.')
    }
    Assert.input(token !== null, 'Sign in again to access account data.')
    return { token, claims: clerkTokenClaims(token, session) }
  }
  async function signedIn(
    session: ClerkDriverSession,
    epoch: number,
    signal: AbortSignal,
  ): Promise<TR.AuthConnectionSession> {
    const { claims } = await sessionToken(session, epoch, signal)
    sdkSession = session
    principal = claims.principal
    return { state: 'SignedIn', principal: claims.principal }
  }
  function acceptSDKChange(session: ClerkDriverSession | null) {
    if (closed || explicitLogout || (session?.id === sdkSession?.id && (session === null || principal))) {
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
        const result = await signedIn(session, epoch, lifetime.signal)
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
        return await signedIn(session, epoch, signal)
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
        return { outcome: { status: 'completed' }, session: await signedIn(result.session, epoch, signal) }
      } catch (error) {
        const abandonedId = error instanceof ClerkRevocationError ? error.sessionId : completedSession?.id
        if (abandonedId) {
          await abandonSession(abandonedId).catch(() => undefined)
        }
        if (active(epoch, signal) && error instanceof ClerkSignInRejectedError) {
          return { outcome: { status: 'rejected', message: error.message } }
        }
        if (active(epoch, signal) && error instanceof ClerkConfigurationError) {
          return { outcome: { status: 'error', message: error.message } }
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
        return await flushPending()
          ? { status: 'completed' }
          : { status: 'error', message: 'Signed out here. Some remote revocations could not be confirmed.' }
      } catch {
        return { status: 'error', message: 'Signed out here, but persistent sign-out could not be confirmed.' }
      }
    },
    cancel() {
      generation += 1
    },
    /** The IdentityToken proof is the Clerk session token; the datasource verifies and exchanges it. */
    async proof({ kind, signal }) {
      Assert.input(kind === 'IdentityToken', `Clerk issues IdentityToken sign-in proofs, not ${kind}.`)
      if (signal.aborted || closed) {
        throw Errors.abortError('The authentication request was cancelled.')
      }
      const session = sdkSession
      const signedInAs = principal
      Assert.input(
        session !== undefined && signedInAs !== undefined && !explicitLogout,
        'Sign in again to access account data.',
      )
      const { token, claims } = await sessionToken(session, generation, signal)
      Assert.input(
        claims.principal.issuer === signedInAs.issuer && claims.principal.subject === signedInAs.subject,
        'Sign in again to access account data.',
      )
      return {
        kind,
        ...claims.principal,
        token,
        ...(claims.expiresAt === undefined ? {} : { expiresAt: claims.expiresAt }),
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

/**
 * clerkTokenClaims reads the principal from a Clerk session token's claims. The datasource that
 * receives the token verifies its signature; these claims only name who the provider signed in.
 */
function clerkTokenClaims(
  token: string,
  session: ClerkDriverSession,
): { principal: TR.AuthPrincipal; expiresAt?: number } {
  const claims = jwtPayload(token)
  const issuer = claims?.['iss']
  Assert.input(
    typeof issuer === 'string' && issuer.length > 0 && claims?.['sub'] === session.userId,
    'Clerk returned an unreadable session token.',
  )
  const expiry = claims['exp']
  const email = claims['email']
  const emailVerified = claims['email_verified']
  return {
    principal: {
      issuer,
      subject: session.userId,
      ...(typeof email === 'string' && email.length > 0 ? { email } : {}),
      ...(typeof emailVerified === 'boolean' ? { emailVerified } : {}),
    },
    ...(typeof expiry === 'number' && Number.isFinite(expiry) ? { expiresAt: expiry * 1_000 } : {}),
  }
}

const base64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** jwtPayload decodes a JWT's payload segment without trusting it; it is undefined when unreadable. */
function jwtPayload(token: string): Record<string, unknown> | undefined {
  const segment = token.split('.')[1]
  if (segment === undefined || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    return undefined
  }
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const character of segment) {
    buffer = (buffer << 6) | base64URL.indexOf(character)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  try {
    const value: unknown = JSON.parse(
      decodeURIComponent(bytes.map(byte => `%${byte.toString(16).padStart(2, '0')}`).join('')),
    )
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}
