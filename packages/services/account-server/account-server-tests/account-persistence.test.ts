import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { Database } from 'bun:sqlite'
import { AccountServer } from '../account-server-src/AccountServer'
import { AccountStore } from '../account-server-src/AccountStore'
import { testAccountPolicy } from './fixtures/account-policy'

Describe('Account persistence ownership', () => {
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
        try {
          Expect(() => new AccountStore(path, testAccountPolicy, !local)).toThrow('another persistence mode')
        } finally {
          owner.close()
        }
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
