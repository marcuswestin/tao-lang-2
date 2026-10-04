import { FS } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, Test, testOverrideSlot } from '@shared/test'
import { Database } from 'bun:sqlite'
import type { AccountProtocol } from 'tao-shared/auth'
import { AccountServer, type AccountServerOptions } from '../account-server-src/AccountServer'
import { InstantAccountStore } from '../account-server-src/InstantAccountStore'
import { testAccountPolicy as policy } from './fixtures/account-policy'

const issuer = 'https://example.clerk.accounts.dev'
const party = 'https://app.example.test'
const openInstant = testOverrideSlot({
  read: () => InstantAccountStore.open,
  write: value => {
    InstantAccountStore.open = value
  },
})

Describe('Clerk account gateway', () => {
  Test('disables local password registration and login in Clerk deployments', async () => {
    await fixture(async context => {
      for (const path of ['/v1/auth/sign-up', '/v1/auth/sign-in']) {
        const response = await fetch(`${context.server.url}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'bypass@example.test', password: 'valid-local-password', resource: 'notes' }),
        })
        Expect(response.status).toBe(401)
        Expect(await response.json()).toEqual({
          error: { code: 'unauthorized', message: 'Use Clerk to sign in to this account service.' },
        })
      }
      Expect(context.count('identities')).toBe(0)
      Expect(context.count('sessions')).toBe(0)
    })
  })

  Test(
    'cryptographically verifies sessions and keeps issuer-subject Account identity across refresh and restart',
    async () => {
      await fixture(async context => {
        const token = await context.token()
        const first = await context.session(token)
        Expect(first.issuer).toBe(issuer)
        Expect(first.subject).toBe('user_alice')
        Expect(first.resource).toBe('notes')
        Expect(first.token).toMatch(/^[a-f0-9]{96}$/)
        Expect(first.token).not.toBe(token)
        Expect(first.accountId).not.toBe('user_alice')
        Expect(first.expiresAt).toBe(context.now() + 30_000)
        await context.restart()
        const renewed = await context.session(await context.token({ sid: 'sess_second' }))
        Expect(renewed.accountId).toBe(first.accountId)
        Expect(renewed.token).not.toBe(first.token)
        const bob = await context.session(await context.token({ sub: 'user_bob' }))
        Expect(bob.accountId).not.toBe(first.accountId)
        const data = await fetch(`${context.server.url}/v1/data`, {
          headers: { authorization: `Bearer ${renewed.token}` },
        })
        Expect(data.status).toBe(200)
        Expect((await data.json() as AccountProtocol.Snapshot).rows).toEqual([
          { entity: 'Account', fields: {}, id: first.accountId },
        ])
        const signedOut = await fetch(`${context.server.url}/v1/auth/sign-out`, {
          method: 'POST',
          headers: { authorization: `Bearer ${renewed.token}` },
        })
        Expect(signedOut.status).toBe(200)
        Expect(
          (await fetch(`${context.server.url}/v1/auth/session`, {
            headers: { authorization: `Bearer ${renewed.token}` },
          })).status,
        ).toBe(401)
        const capped = await context.session(await context.token({ exp: Math.floor(context.now() / 1000) + 10 }))
        Expect(capped.expiresAt).toBe((Math.floor(context.now() / 1000) + 10) * 1000)
      })
    },
  )

  Test('rejects forged, wrong-issuer/audience/party, expired, incomplete and pending signed proofs', async () => {
    await fixture(async context => {
      for (
        const claims of [
          { iss: 'https://attacker.clerk.accounts.dev' },
          { aud: 'another-resource' },
          { aud: undefined },
          { azp: 'https://attacker.example.test' },
          { azp: undefined },
          { sub: '' },
          { sid: undefined },
          { sid: '' },
          { exp: Math.floor(Date.now() / 1000) - 1 },
          { exp: undefined },
          { nbf: Math.floor(Date.now() / 1000) + 300 },
          { sts: 'pending' },
          { sts: 'revoked' },
          { fva: [-1, -1] },
          { fva: [0, -2] },
          { fva: undefined },
        ]
      ) {
        Expect({ claims, status: (await context.exchange(await context.token(claims))).status }).toEqual({
          claims,
          status: 401,
        })
      }
      const good = await context.token()
      const parts = good.split('.')
      parts[1] = Buffer.from(JSON.stringify({ ...context.claims, sub: 'forged_user' })).toString('base64url')
      Expect((await context.exchange(parts.join('.'))).status).toBe(401)
      Expect((await context.exchange(good, { resource: 'other' })).status).toBe(401)
      Expect((await context.exchange(good, { resource: 'notes', actor: 'user_bob' })).status).toBe(400)
      Expect((await context.exchange(good, { resource: 'notes', issuer: 'attacker' })).status).toBe(400)
      Expect(context.count('identities')).toBe(0)
      // Absence of sts is the normal active-session encoding; -1 second-factor age also means no MFA.
      Expect(await context.exchange(await context.token({ sts: undefined, fva: [0, -1] }))).toHaveProperty(
        'status',
        200,
      )
    })
  })

  Test('refresh prunes expired credentials while preserving live sessions and Account identity', async () => {
    await fixture(async context => {
      const first = await context.session(await context.token())
      context.advance(15_000)
      const live = await context.session(await context.token())
      Expect(context.count('sessions')).toBe(2)
      context.advance(15_000)
      const third = await context.session(await context.token())
      Expect(third.accountId).toBe(first.accountId)
      Expect(context.count('sessions')).toBe(2)
      for (const [session, status] of [[first, 401], [live, 200], [third, 200]] as const) {
        Expect(
          (await fetch(`${context.server.url}/v1/auth/session`, {
            headers: { authorization: `Bearer ${session.token}` },
          })).status,
        ).toBe(status)
      }
    })
  })

  Test('requires explicit deployment opt-in for a signed proof without an authorized party', async () => {
    for (const allowMissingAuthorizedPartyWithoutOrigin of [undefined, false]) {
      await fixture(
        async context => {
          const token = await context.token({ azp: undefined })
          Expect((await context.exchange(token)).status).toBe(401)
          Expect((await context.exchange(token, { resource: 'notes', native: true })).status).toBe(400)
          Expect(context.count('identities')).toBe(0)
        },
        {},
        { allowMissingAuthorizedPartyWithoutOrigin },
      )
    }
  })

  Test(
    'accepts opted-in native proofs only without an Origin header and requires accepted session claims',
    async () => {
      await fixture(
        async context => {
          const native = await context.token({ azp: undefined })
          const session = await context.session(native)
          Expect(session.subject).toBe('user_alice')
          for (const origin of [party, 'null', '']) {
            Expect((await context.exchange(native, { resource: 'notes' }, { origin })).status).toBe(401)
            // These origins reach token verification: CORS is not masking this assertion.
            Expect((await context.exchange(await context.token(), { resource: 'notes' }, { origin })).status).toBe(200)
          }
          for (
            const claims of [
              { azp: 'https://attacker.example.test' },
              { azp: '' },
              { azp: null },
              { exp: Math.floor(Date.now() / 1000) - 1 },
              { sts: 'pending' },
            ]
          ) {
            Expect((await context.exchange(await context.token({ azp: undefined, ...claims }))).status).toBe(401)
          }
          const parts = native.split('.')
          parts[1] = Buffer.from(JSON.stringify({ ...context.claims, azp: undefined, sub: 'forged_user' }))
            .toString('base64url')
          Expect((await context.exchange(parts.join('.'))).status).toBe(401)
        },
        { allowedOrigins: [party, 'null', ''] },
        { allowMissingAuthorizedPartyWithoutOrigin: true },
      )
    },
  )

  Test('does not issue a gateway credential when signed proof expires during asynchronous provisioning', async () => {
    const entered = Deferred<string>()
    const release = Deferred()
    const restore = openInstant.install(async () =>
      ({
        async provision(accountId: string) {
          entered.resolve(accountId)
          await release.promise
        },
        close() {},
      }) as unknown as InstantAccountStore
    )
    try {
      await fixture(async context => {
        const exchange = context.exchange(await context.token())
        try {
          await entered.promise
          Expect(context.count('sessions')).toBe(0)
          context.advance(300_000)
        } finally {
          release.resolve()
        }
        Expect((await exchange).status).toBe(401)
        Expect(context.count('sessions')).toBe(0)
      }, { instant: { apiURI: 'http://localhost:9020', appId: 'app', adminToken: 'test-only' } })
    } finally {
      release.resolve()
      restore()
    }
  })

  Test(
    'fences remote expired-session work before pruning and preserves credentials that expire during the fence',
    async () => {
      const entered = Deferred()
      const release = Deferred()
      const provisioned: string[] = []
      const restore = openInstant.install(async () =>
        ({
          async provision(accountId: string) {
            provisioned.push(accountId)
          },
          async barrier() {
            entered.resolve()
            await release.promise
          },
          close() {},
        }) as unknown as InstantAccountStore
      )
      try {
        await fixture(async context => {
          const first = await context.session(await context.token())
          context.advance(15_000)
          await context.session(await context.token())
          context.advance(15_000)
          const pending = context.exchange(await context.token())
          try {
            await entered.promise
            Expect(context.count('sessions')).toBe(2)
            context.advance(15_000)
          } finally {
            release.resolve()
          }
          const response = await pending
          Expect(response.status).toBe(200)
          Expect((await response.json() as AccountProtocol.Session).accountId).toBe(first.accountId)
          Expect(provisioned).toEqual([first.accountId, first.accountId, first.accountId])
          Expect(context.count('sessions')).toBe(2)
        }, { instant: { apiURI: 'http://localhost:9020', appId: 'app', adminToken: 'test-only' } })
      } finally {
        release.resolve()
        restore()
      }
    },
  )
})

async function fixture(
  run: (context: {
    server: AccountServer
    claims: Record<string, unknown>
    now(): number
    advance(ms: number): void
    count(table: 'sessions' | 'identities'): number
    restart(): Promise<void>
    token(claims?: Record<string, unknown>): Promise<string>
    exchange(token: string, body?: unknown, headers?: Record<string, string>): Promise<Response>
    session(token: string): Promise<AccountProtocol.Session>
  }) => Promise<void>,
  overrides: Partial<AccountServerOptions> = {},
  clerkOverrides: Partial<NonNullable<AccountServerOptions['clerk']>> = {},
): Promise<void> {
  const root = await mkTestDir('clerk-account-')
  const key = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  const publicKey = Buffer.from(await crypto.subtle.exportKey('spki', key.publicKey)).toString('base64')
  let now = Date.now()
  const options: AccountServerOptions = {
    databasePath: FS.resolvePath('accounts.sqlite', root),
    clock: () => now,
    issuer: 'local-reference',
    resource: 'notes',
    policy,
    sessionLifetimeMs: 30_000,
    clerk: {
      issuer,
      authorizedParties: [party],
      audience: 'notes',
      jwtKey: `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`,
      ...clerkOverrides,
    },
    ...overrides,
  }
  const context = {
    server: await AccountServer.start(options),
    claims: {
      iss: issuer,
      sub: 'user_alice',
      sid: 'sess_alice',
      azp: party,
      aud: 'notes',
      iat: Math.floor(now / 1000),
      nbf: Math.floor(now / 1000) - 10,
      exp: Math.floor(now / 1000) + 300,
      v: 2,
      sts: 'active',
      fva: [0, -1],
    },
    now: () => now,
    advance(ms: number) {
      now += ms
    },
    count(table: 'sessions' | 'identities'): number {
      const db = new Database(options.databasePath, { readonly: true })
      try {
        return db.query<{ count: number }, []>(`SELECT count(*) AS count FROM ${table}`).get()!.count
      } finally {
        db.close()
      }
    },
    async restart() {
      await context.server.stop()
      context.server = await AccountServer.start(options)
    },
    async token(claims: Record<string, unknown> = {}): Promise<string> {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-key' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ ...context.claims, ...claims })).toString('base64url')
      const message = `${header}.${payload}`
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(message))
      return `${message}.${Buffer.from(signature).toString('base64url')}`
    },
    async exchange(
      token: string,
      body: unknown = { resource: 'notes' },
      headers: Record<string, string> = {},
    ): Promise<Response> {
      return await fetch(`${context.server.url}/v1/auth/clerk/exchange`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })
    },
    async session(token: string): Promise<AccountProtocol.Session> {
      const response = await context.exchange(token)
      Expect(response.status).toBe(200)
      return await response.json() as AccountProtocol.Session
    },
  }
  try {
    await run(context)
  } finally {
    await context.server.stop()
    await FS.remove(root)
  }
}
