import type TR from '@runtime/TR'
import type { AccountProtocol } from '@shared/auth/AuthProtocol'
import { Assert, Errors } from '@shared/core'

/** ReferenceAuthHost is the slice of the Reference host account resolution uses. */
export type ReferenceAuthHost = {
  now?(): number
  request(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): ReturnType<typeof fetch>
  schedule(callback: () => void, milliseconds: number): () => void
}

type Resolver = (
  host: ReferenceAuthHost,
  context: TR.DataAuthenticationContext,
  target: { resource: string; serverURL: string },
) => Promise<TR.DataAuthentication>

/**
 * referenceAuthentication resolves the Reference account for the auth provider that signed in:
 * LocalAuth's server session is already a Reference session, and a Clerk identity token is exchanged
 * at the Reference server for a gateway session this datasource owns and revokes.
 */
export async function referenceAuthentication(
  host: ReferenceAuthHost,
  context: TR.DataAuthenticationContext,
  target: { resource: string; serverURL: string },
): Promise<TR.DataAuthentication> {
  const resolvers: Readonly<Record<string, Resolver>> = {
    Clerk: gatewayAuthentication,
    LocalAuth: sessionAuthentication,
  }
  Assert.input(
    Object.hasOwn(resolvers, context.provider),
    `Reference cannot sign in with ${context.provider}. Use LocalAuth or Clerk.`,
  )
  return await resolvers[context.provider]!(host, context, target)
}

/** sessionAuthentication uses LocalAuth's server session directly; LocalAuth's sign-out revokes it. */
async function sessionAuthentication(
  host: ReferenceAuthHost,
  context: TR.DataAuthenticationContext,
  { resource }: { resource: string },
): Promise<TR.DataAuthentication> {
  const now = host.now ?? Date.now
  const session = async (signal: AbortSignal): Promise<AccountProtocol.Session> => {
    const proof = await context.proof('Session', signal)
    const value = proof.value
    Assert.input(
      validSession(value, now) && value.issuer === proof.issuer && value.subject === proof.subject,
      'Sign in again to access account data.',
    )
    Assert.input(
      value.resource === resource,
      'This sign-in does not authorize this datasource. Use the same Resource on LocalAuth and Reference.',
    )
    return value
  }
  const { accountId } = await session(context.signal)
  return {
    accountId,
    credential: async signal => {
      const value = await session(signal)
      Assert.input(value.accountId === accountId, 'Sign in again to access account data.')
      return value.token
    },
  }
}

/**
 * gatewayAuthentication exchanges the Clerk identity token for a Reference gateway session, refreshes
 * it before expiry, and revokes it on release. Replaced sessions are revoked promptly; a revocation
 * that fails stays recorded, so the next release retries it.
 */
async function gatewayAuthentication(
  host: ReferenceAuthHost,
  context: TR.DataAuthenticationContext,
  { resource, serverURL }: { resource: string; serverURL: string },
): Promise<TR.DataAuthentication> {
  const now = host.now ?? Date.now
  const sessions = new Map<string, AccountProtocol.Session>()
  const revocations = new Map<string, Promise<void>>()
  let current: AccountProtocol.Session | undefined
  let cancelRefresh: (() => void) | undefined
  let refreshing: Promise<void> | undefined
  let released = false
  let accountId: string | undefined
  const active = (): boolean => !released && !context.signal.aborted

  function revoke(value: AccountProtocol.Session): Promise<void> {
    const running = revocations.get(value.token)
    if (running) {
      return running
    }
    const revocation = (async () => {
      const response = await host.request(`${serverURL}/v1/auth/sign-out`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${value.token}`, 'Content-Type': 'application/json' },
        body: '{}',
      })
      Assert.input(response.ok || response.status === 401, 'The account gateway could not confirm sign-out.')
      sessions.delete(value.token)
    })().finally(() => {
      revocations.delete(value.token)
    })
    revocations.set(value.token, revocation)
    return revocation
  }
  function arm(value: AccountProtocol.Session): void {
    cancelRefresh?.()
    cancelRefresh = host.schedule(() => {
      cancelRefresh = undefined
      void renew().catch(() => {
        if (current === value && active()) {
          cancelRefresh = host.schedule(() => {
            cancelRefresh = undefined
            void renew().catch(() => undefined)
          }, Math.min(5_000, Math.max(0, value.expiresAt - now())))
        }
      })
    }, Math.max(1_000, value.expiresAt - now() - 10_000))
  }
  async function exchange(signal: AbortSignal): Promise<AccountProtocol.Session> {
    const proof = await context.proof('IdentityToken', signal)
    const response = await host.request(`${serverURL}/v1/auth/clerk/exchange`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${proof.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource }),
      // React Native declares a narrower ambient AbortSignal; fetch accepts the same host signal.
      signal: signal as NonNullable<Parameters<typeof fetch>[1]>['signal'],
    })
    Assert.input(response.ok, 'Clerk could not authorize this account gateway. Try signing in again.')
    const value: unknown = await response.json()
    Assert.input(
      validSession(value, now) && value.resource === resource && value.subject === proof.subject
        && /^[a-f0-9]{96}$/.test(value.token),
      'The account gateway returned an invalid Clerk session.',
    )
    sessions.set(value.token, value)
    try {
      Assert.input(accountId === undefined || value.accountId === accountId, 'Sign in again to access account data.')
      // A second proof confirms the provider still signs this principal in: another tab may have
      // signed out while the exchange was in flight.
      await context.proof('IdentityToken', signal)
      if (!active() || signal.aborted) {
        throw Errors.abortError('Sign-in was cancelled.')
      }
    } catch (error) {
      void revoke(value).catch(() => undefined)
      throw error
    }
    current = value
    arm(value)
    // Even an expired bearer can have an admitted remote write that still needs fencing.
    // Retire replaced credentials promptly and retain failures for release.
    for (const previous of sessions.values()) {
      if (previous.token !== value.token) {
        void revoke(previous).catch(() => undefined)
      }
    }
    return value
  }
  function renew(): Promise<void> {
    refreshing ??= (async () => {
      Assert.input(active(), 'Sign in again to access account data.')
      await exchange(context.signal)
    })().finally(() => {
      refreshing = undefined
    })
    return refreshing
  }

  context.signal.addEventListener('abort', () => {
    // The account's data access ended; the scope releases the gateway sessions when it signs out.
    cancelRefresh?.()
    cancelRefresh = undefined
  }, { once: true })
  const first = await exchange(context.signal)
  accountId = first.accountId
  return {
    accountId,
    credential: async signal => {
      if (signal.aborted) {
        throw Errors.abortError('The authentication request was cancelled.')
      }
      Assert.input(active(), 'Sign in again to access account data.')
      if (current === undefined || current.expiresAt - now() < 5_000) {
        await renew()
      }
      if (signal.aborted) {
        throw Errors.abortError('The authentication request was cancelled.')
      }
      Assert.input(current !== undefined && current.expiresAt > now(), 'Sign in again to access account data.')
      return current.token
    },
    release: async () => {
      released = true
      cancelRefresh?.()
      cancelRefresh = undefined
      current = undefined
      const results = await Promise.allSettled([...sessions.values()].map(revoke))
      Assert.input(
        results.every(result => result.status === 'fulfilled'),
        'The account gateway could not confirm sign-out.',
      )
    },
  }
}

function validSession(value: unknown, now: () => number): value is AccountProtocol.Session {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<AccountProtocol.Session>
  return ['token', 'accountId', 'issuer', 'subject', 'resource'].every(key =>
    typeof candidate[key as keyof AccountProtocol.Session] === 'string'
    && candidate[key as keyof AccountProtocol.Session] !== ''
  ) && typeof candidate.expiresAt === 'number' && Number.isFinite(candidate.expiresAt) && candidate.expiresAt > now()
}
