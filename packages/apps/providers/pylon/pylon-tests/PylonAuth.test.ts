import type TR from '@runtime/TR'
import { Errors } from '@shared/core'
import { Describe, Expect, Test } from '@shared/test'
import { type PylonAuthClient, PylonAuthProvider } from '../pylon-src/PylonAuth'

const baseURL = 'https://example.test/app'
const live = (): AbortSignal => new AbortController().signal

function fixture() {
  const saved = new Map<string, string>()
  const calls: Array<{ method: string; token: string | undefined; url: string }> = []
  const codes: string[] = []
  let token: string | null = null
  let revokeStatus = 200
  let meStatus = 200
  let initialized = ''
  let failTokenClear = false
  let expiresAt = 4_000_000_000
  const client: PylonAuthClient = {
    async initialize(url) {
      initialized = url
    },
    token: () => token,
    async setToken(next) {
      if (next === null && failTokenClear) {
        Errors.throwHostEnvironment('native storage unavailable')
      }
      token = next
    },
    async sendEmailCode(email) {
      codes.push(email)
      return { sent: true }
    },
    async verifyEmailCode(email, code) {
      if (email !== 'alice@example.test' || code !== '123456') {
        throw Object.assign(new TypeError('Bad code'), { status: 400 })
      }
      token = 'pylon-secret'
      return { expires_at: expiresAt, token, user_id: 'user-alice' }
    },
  }
  const storage: TR.AuthSecretStorage = {
    getItem: async key => saved.get(key) ?? null,
    setItem: async (key, value) => {
      saved.set(key, value)
    },
    removeItem: async key => {
      saved.delete(key)
    },
  }
  const request = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): ReturnType<typeof fetch> => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const authorization = new Headers(init?.headers).get('authorization') ?? undefined
    calls.push({ method, token: authorization, url })
    if (url.endsWith('/api/auth/session')) {
      return Response.json({ revoked: revokeStatus === 200 }, { status: revokeStatus })
    }
    return Response.json({ user_id: meStatus === 200 ? 'user-alice' : null }, { status: meStatus })
  }
  const provider = PylonAuthProvider({ client, fetch: request, now: () => 1_000, storage })
  return {
    calls,
    codes,
    connect: () => provider.connect({ configuration: { BaseURL: `${baseURL}/` } }),
    get initialized() {
      return initialized
    },
    get token() {
      return token
    },
    saved,
    setMeStatus: (status: number) => {
      meStatus = status
    },
    setRevokeStatus: (status: number) => {
      revokeStatus = status
    },
    setFailTokenClear: (value: boolean) => {
      failTokenClear = value
    },
    setExpiresAt: (value: number) => {
      expiresAt = value
    },
  }
}

async function signIn(connection: TR.AuthConnection) {
  const sent = await connection.signIn({ fields: { Email: ' Alice@Example.test ' }, method: 'EmailCode' }, live())
  return connection.signIn({
    challengeId: sent.session!.challenge!.id,
    fields: { Code: '123456' },
    method: 'EmailCode',
  }, live())
}

Describe('PylonAuth', () => {
  Test('uses magic codes and issues a bounded Session proof for the configured backend', async () => {
    const host = fixture()
    const connection = host.connect()
    Expect(await connection.restore(live())).toEqual({ state: 'SignedOut' })
    Expect(host.initialized).toBe(baseURL)
    Expect((await signIn(connection)).session).toEqual({
      principal: {
        email: 'alice@example.test',
        emailVerified: true,
        issuer: `pylon:${baseURL}`,
        subject: 'user-alice',
      },
      state: 'SignedIn',
    })
    Expect(host.codes).toEqual(['alice@example.test'])
    Expect(await connection.proof({ kind: 'Session', signal: live() })).toEqual({
      expiresAt: 4_000_000_000_000,
      issuer: `pylon:${baseURL}`,
      kind: 'Session',
      subject: 'user-alice',
      value: { baseURL, token: 'pylon-secret' },
    })
    Expect(await connection.signOut(live())).toEqual({ status: 'completed' })
    Expect(host.calls).toEqual([{
      method: 'DELETE',
      token: 'Bearer pylon-secret',
      url: `${baseURL}/api/auth/session`,
    }])
    Expect(host.token).toBe(null)
    await Expect(connection.proof({ kind: 'Session', signal: live() })).rejects.toThrow(
      'Sign in again to access account data.',
    )
    connection.close?.()
  })

  Test('persists a failed revocation before clearing the local token and retries on restore', async () => {
    const host = fixture()
    const first = host.connect()
    await signIn(first)
    host.setRevokeStatus(503)
    Expect(await first.signOut(live())).toEqual({
      status: 'error',
      message: 'Signed out on this device. Server revocation will retry when connected.',
    })
    Expect(host.token).toBe(null)
    Expect([...host.saved.values()][0]).toContain('pylon-secret')
    first.close?.()
    host.setRevokeStatus(200)
    const resumed = host.connect()
    Expect(await resumed.restore(live())).toEqual({ state: 'SignedOut' })
    await Promise.resolve()
    await Promise.resolve()
    Expect(host.calls.filter(call => call.method === 'DELETE')).toHaveLength(2)
    resumed.close?.()
  })

  Test('rejects a server-invalid restored token and unsupported sign-in methods', async () => {
    const host = fixture()
    const first = host.connect()
    await signIn(first)
    first.close?.()
    host.setMeStatus(401)
    const resumed = host.connect()
    Expect(await resumed.restore(live())).toEqual({ state: 'ReauthenticationRequired' })
    Expect(host.token).toBe(null)
    Expect((await resumed.signIn({ method: 'Password' }, live())).outcome).toEqual({
      status: 'rejected',
      message: 'This provider supports email code sign-in.',
    })
    resumed.close?.()
  })

  Test('keeps sign-out state consistent when clearing the native token fails', async () => {
    const host = fixture()
    const connection = host.connect()
    const sessions: string[] = []
    connection.subscribe?.(session => sessions.push(session.state))
    await signIn(connection)
    host.setFailTokenClear(true)
    Expect(await connection.signOut(live())).toEqual({
      status: 'error',
      message: 'Unable to finish local sign-out. Please try again.',
    })
    Expect(sessions).toEqual(['SignedIn', 'SignedOut'])
    await Expect(connection.proof({ kind: 'Session', signal: live() })).rejects.toThrow(
      'Sign in again to access account data.',
    )
    Expect([...host.saved.values()][0]).toContain('pylon-secret')
    connection.close?.()
  })

  Test('keeps zero-expiry sessions valid and revokes them on sign-out', async () => {
    const host = fixture()
    host.setExpiresAt(0)
    const connection = host.connect()
    await signIn(connection)
    Expect(await connection.proof({ kind: 'Session', signal: live() })).toEqual({
      issuer: `pylon:${baseURL}`,
      kind: 'Session',
      subject: 'user-alice',
      value: { baseURL, token: 'pylon-secret' },
    })
    Expect(await connection.signOut(live())).toEqual({ status: 'completed' })
    Expect(host.calls.filter(call => call.method === 'DELETE')).toHaveLength(1)
    connection.close?.()
  })
})
