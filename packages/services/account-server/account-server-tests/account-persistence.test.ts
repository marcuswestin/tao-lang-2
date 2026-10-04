import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { Database } from 'bun:sqlite'
import { AccountServer } from '../account-server-src/AccountServer'
import { AccountStore } from '../account-server-src/AccountStore'
import { testAccountPolicy } from './fixtures/account-policy'

Describe('Account persistence ownership', () => {
  Test('refuses switching authentication mode or issuer without changing existing local sessions', async () => {
    const root = await mkTestDir('account-auth-mode-')
    const options = {
      databasePath: FS.resolvePath('accounts.sqlite', root),
      issuer: 'local-test',
      resource: 'notes',
      policy: testAccountPolicy,
    }
    const clerk = {
      issuer: 'https://example.clerk.accounts.dev',
      jwtKey: 'configured-public-key',
      authorizedParties: ['https://app.example.test'],
    }
    let server: AccountServer | undefined
    try {
      server = await AccountServer.start(options)
      const response = await fetch(`${server.url}/v1/auth/sign-up`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'old@example.test', password: 'valid-password', resource: 'notes' }),
      })
      Expect(response.status).toBe(200)
      const session = await response.json() as { token: string; accountId: string }
      await server.stop()
      server = undefined
      await Expect(tryStartingServer({ ...options, clerk })).rejects.toThrow('another authentication mode or issuer')
      await Expect(tryStartingServer({ ...options, issuer: 'another-local-issuer' })).rejects.toThrow(
        'another authentication mode or issuer',
      )
      server = await AccountServer.start(options)
      const resumed = await fetch(`${server.url}/v1/auth/session`, {
        headers: { authorization: `Bearer ${session.token}` },
      })
      Expect(resumed.status).toBe(200)
      Expect((await resumed.json() as { accountId: string }).accountId).toBe(session.accountId)
      await server.stop()
      server = undefined

      const clerkOptions = { ...options, databasePath: FS.resolvePath('clerk.sqlite', root), clerk }
      server = await AccountServer.start(clerkOptions)
      Expect((await fetch(`${server.url}/v1/data`, { headers: { authorization: `Bearer ${session.token}` } })).status)
        .toBe(401)
      await server.stop()
      server = undefined
      await Expect(tryStartingServer({ ...clerkOptions, clerk: undefined })).rejects.toThrow(
        'another authentication mode or issuer',
      )
      await Expect(
        tryStartingServer({ ...clerkOptions, clerk: { ...clerk, issuer: 'https://other.clerk.accounts.dev' } }),
      )
        .rejects.toThrow('another authentication mode or issuer')
    } finally {
      await server?.stop()
      await FS.remove(root)
    }
  })

  Test('requires explicit migration of populated legacy auth databases before Clerk claims them', async () => {
    const root = await mkTestDir('account-auth-legacy-')
    const path = FS.resolvePath('accounts.sqlite', root)
    const local = new AccountStore(path, testAccountPolicy)
    const identity = local.register('legacy@example.test', 'legacy-hash', 'local-test')
    local.close()
    try {
      await Expect(tryStartingServer({
        databasePath: path,
        issuer: 'local-test',
        resource: 'notes',
        policy: testAccountPolicy,
        clerk: {
          issuer: 'https://example.clerk.accounts.dev',
          jwtKey: 'configured-public-key',
          authorizedParties: ['https://app.example.test'],
        },
      })).rejects.toThrow('explicit migration before using Clerk')
      const retained = new AccountStore(path, testAccountPolicy)
      try {
        Expect(retained.password('legacy@example.test')?.subject).toBe(identity.subject)
        Expect(retained.provision('local-test', identity.subject)).toEqual(identity)
      } finally {
        retained.close()
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects malformed or incomplete Instant deployment configuration before connecting', async () => {
    const root = await mkTestDir('account-persistence-config-')
    try {
      for (
        const [apiURI, appId, adminToken, message] of [
          ['not a URL', 'app', 'token', 'valid HTTP origin'],
          ['http://localhost:9020/path', 'app', 'token', 'HTTP origin without credentials'],
          ['http://localhost:9020', '', 'token', 'requires an endpoint, app ID, and admin token'],
          ['http://localhost:9020', 'app', '', 'requires an endpoint, app ID, and admin token'],
        ] as const
      ) {
        await Expect(AccountServer.start({
          databasePath: FS.resolvePath('accounts.sqlite', root),
          issuer: 'issuer',
          resource: 'notes',
          policy: testAccountPolicy,
          instant: { apiURI, appId, adminToken },
        })).rejects.toThrow(message)
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('refuses cross-mode gateways even when the claimed database is empty', async () => {
    const root = await mkTestDir('account-persistence-mode-')
    try {
      for (const local of [true, false]) {
        const path = FS.resolvePath(`${local}.sqlite`, root)
        const owner = new AccountStore(path, testAccountPolicy, local)
        owner.close()
        Expect(() => new AccountStore(path, testAccountPolicy, !local)).toThrow('another persistence mode')
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('retains authority and account identities before remote provisioning completes', async () => {
    const root = await mkTestDir('account-persistence-identity-')
    const path = FS.resolvePath('accounts.sqlite', root)
    const first = new AccountStore(path, testAccountPolicy, false)
    const authority = first.authorityId()
    const identity = first.register('alice@example.test', 'trusted-test-hash', 'issuer')
    first.close()
    const restarted = new AccountStore(path, testAccountPolicy, false)
    try {
      Expect(restarted.authorityId()).toBe(authority)
      Expect(restarted.provision('issuer', identity.subject)).toEqual(identity)
      Expect(restarted.password('alice@example.test')?.subject).toBe(identity.subject)
    } finally {
      restarted.close()
      await FS.remove(root)
    }
  })

  Test('refuses implicit migration of an unmarked legacy auth database', async () => {
    const root = await mkTestDir('account-persistence-legacy-')
    const path = FS.resolvePath('accounts.sqlite', root)
    try {
      const original = new AccountStore(path, testAccountPolicy)
      original.register('alice@example.test', 'trusted-test-hash', 'issuer')
      original.close()
      const legacy = new Database(path)
      legacy.exec('DELETE FROM persistenceMode; DELETE FROM rows;')
      legacy.close()
      Expect(() => new AccountStore(path, testAccountPolicy, false)).toThrow('explicit migration')
      const local = new AccountStore(path, testAccountPolicy)
      try {
        Expect(local.password('alice@example.test')).not.toBeNull()
      } finally {
        local.close()
      }
    } finally {
      await FS.remove(root)
    }
  })
})

async function tryStartingServer(options: Parameters<typeof AccountServer.start>[0]): Promise<void> {
  // Keep negative transition tests leak-free even when a mutation unexpectedly permits startup.
  const server = await AccountServer.start(options)
  await server.stop()
}
