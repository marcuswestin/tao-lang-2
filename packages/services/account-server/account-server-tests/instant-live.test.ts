import Compiler from '@compiler'
import { FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, until } from '@shared/test'
import type { AccountProtocol } from 'tao-shared/auth'
import { accountPolicyFromJSON } from '../account-server-src/AccountPolicy'
import { AccountServer } from '../account-server-src/AccountServer'
import { testAccountPolicy } from './fixtures/account-policy'
import { runAuthReviewJourney } from './fixtures/auth-review-journey'
import { instantAppFixture, instantFixture } from './fixtures/instant-app'
import { startInstantCli } from './fixtures/instant-cli'
import { withHeldRequestBudget, withHeldSignIn } from './fixtures/instant-held-request'
import { referenceTest } from './fixtures/reference-test'

// Run explicitly: TAO_INSTANT_LIVE_API_URL=http://localhost:9020 ./agent test-file packages/services/account-server/account-server-tests/instant-live.test.ts
// Missing opt-in is a reported skip. A configured but unavailable service fails the live lane.
const apiURI = Platform.runtimeProcess.env['TAO_INSTANT_LIVE_API_URL']
const liveTest = apiURI === undefined ? Test['skip'] : Test
const namespaces = {
  Account: 'taoAccountRow_7e1b0d5641f2640c',
  Note: 'taoAccountRow_d8da2c49df39d91d',
  Workspace: 'taoAccountRow_87bb59ba2f92f2a5',
  Membership: 'taoAccountRow_9feceb9333b5ff62',
}

Describe('Self-hosted Instant authority (requires TAO_INSTANT_LIVE_API_URL)', () => {
  liveTest('runs the actual Tao auth journey and independently reads profiles and notes from Instant', async () => {
    const source = await FS.readText(Repo.resolvePath('Apps/Test Apps/Auth Review/Auth Review.tao'))
    const compiled = await Compiler.compileCode(source, { appName: 'AuthReviewLocal' })
    const metadata = compiled.files.find(file => file.relativePath === 'TaoDataPolicy.json')
    Expect(metadata).toBeDefined()
    await instantFixture(apiURI!, async fixture => {
      await runAuthReviewJourney(fixture.root, source, fixture.server)
      const data = await fixture.query({ [namespaces.Account]: {}, [namespaces.Note]: {} })
      Expect(data[namespaces.Account]!.map(row => row['fields'])).toContainEqual({ DisplayName: 'Alice' })
      Expect(data[namespaces.Note]).toHaveLength(1)
      Expect(data[namespaces.Note]![0]!['fields']).toMatchObject({ Body: 'Saved through real authority' })
      const denied = await fixture.admin('/admin/query', { query: { [namespaces.Note]: {} } }, true)
      Expect(denied.status).toBe(200)
      Expect((await denied.json() as Record<string, unknown>)[namespaces.Note]).toEqual([])
    }, { policy: accountPolicyFromJSON(JSON.parse(metadata!.code)), resource: 'auth-review' })
  }, 120_000)

  liveTest('denies anonymous, cross-account, owner, protected-field and forged membership access', async () => {
    await instantFixture(apiURI!, async fixture => {
      const alice = await register(fixture.server, 'alice')
      const bob = await register(fixture.server, 'bob')
      Expect((await request(fixture.server, '/v1/data')).status).toBe(401)
      Expect(
        (await mutate(fixture.server, alice, 'private-note', [{
          kind: 'create',
          entity: 'Note',
          id: 'private',
          fields: { Owner: alice.accountId, Body: 'private words' },
        }])).status,
      ).toBe(200)
      Expect((await snapshot(fixture.server, bob)).rows.map(row => row.id)).toEqual([bob.accountId])
      const forbidden: Array<[AccountProtocol.Session, AccountProtocol.Operation]> = [
        [bob, { kind: 'update', entity: 'Note', id: 'private', fields: { Body: 'stolen' } }],
        [bob, { kind: 'delete', entity: 'Note', id: 'private' }],
        [bob, { kind: 'create', entity: 'Note', id: 'forged', fields: { Owner: alice.accountId, Body: 'forged' } }],
        [bob, { kind: 'update', entity: 'Account', id: bob.accountId, fields: { VerifiedEmail: 'fake@test.test' } }],
        [alice, { kind: 'update', entity: 'Note', id: 'private', fields: { Owner: bob.accountId } }],
      ]
      for (const [actor, operation] of forbidden) {
        Expect((await mutate(fixture.server, actor, Platform.randomUUID(), [operation])).status).toBe(403)
      }
      await fixture.server.seed([{
        entity: 'Workspace',
        id: 'workspace',
        fields: { Owner: alice.accountId, Title: 'Shared' },
      }])
      Expect((await snapshot(fixture.server, bob)).rows.some(row => row.id === 'workspace')).toBe(false)
      Expect(
        (await mutate(fixture.server, bob, 'forged-member', [{
          kind: 'create',
          entity: 'Membership',
          id: 'forged-member',
          fields: { Workspace: 'workspace', Person: bob.accountId, Role: 'reader' },
        }])).status,
      ).toBe(403)
      const data = await fixture.query({ [namespaces.Note]: {}, [namespaces.Membership]: {} })
      Expect(data[namespaces.Note]).toHaveLength(1)
      Expect(data[namespaces.Note]![0]!['fields']).toEqual({ Owner: alice.accountId, Body: 'private words' })
      Expect(data[namespaces.Membership]).toEqual([])
    })
  }, 120_000)

  liveTest('commits one competing membership tuple and rolls back every row in a rejected batch', async () => {
    await instantFixture(apiURI!, async fixture => {
      const alice = await register(fixture.server, 'alice')
      const bob = await register(fixture.server, 'bob')
      await fixture.server.seed([{
        entity: 'Workspace',
        id: 'workspace',
        fields: { Owner: alice.accountId, Title: 'Shared' },
      }])
      const membership = (id: string): AccountProtocol.Operation => ({
        kind: 'create',
        entity: 'Membership',
        id,
        fields: { Workspace: 'workspace', Person: bob.accountId, Role: 'reader' },
      })
      const competing = await Promise.all([
        mutate(fixture.server, alice, 'one', [membership('member-one')]),
        mutate(fixture.server, alice, 'two', [membership('member-two')]),
      ])
      Expect(competing.map(response => response.status).sort()).toEqual([200, 409])
      Expect((await snapshot(fixture.server, bob)).rows.some(row => row.id === 'workspace')).toBe(true)
      Expect(
        (await mutate(fixture.server, alice, 'rollback', [
          { kind: 'create', entity: 'Note', id: 'rollback', fields: { Owner: alice.accountId, Body: 'never saved' } },
          membership('duplicate'),
        ])).status,
      ).toBe(409)
      Expect(
        (await mutate(fixture.server, alice, 'forbidden-batch', [
          {
            kind: 'create',
            entity: 'Note',
            id: 'rollback-two',
            fields: { Owner: alice.accountId, Body: 'never saved' },
          },
          { kind: 'update', entity: 'Account', id: bob.accountId, fields: { DisplayName: 'forged' } },
        ])).status,
      ).toBe(403)
      const data = await fixture.query({ [namespaces.Note]: {}, [namespaces.Membership]: {} })
      Expect(data[namespaces.Note]).toEqual([])
      Expect(data[namespaces.Membership]).toHaveLength(1)
      Expect(data[namespaces.Membership]![0]!['fields']).toEqual({
        Workspace: 'workspace',
        Person: bob.accountId,
        Role: 'reader',
      })
    })
  }, 120_000)

  liveTest(
    'recovers a lost commit response, persists retry receipts across restart and rejects stale replay',
    async () => {
      await instantFixture(apiURI!, async fixture => {
        const alice = await register(fixture.server, 'alice')
        const operations: AccountProtocol.Operation[] = [{
          kind: 'create',
          entity: 'Note',
          id: 'durable',
          fields: { Owner: alice.accountId, Body: 'committed once' },
        }]
        fixture.loseCommitResponse()
        const accepted = await mutate(fixture.server, alice, 'stable-operation', operations)
        Expect(accepted.status).toBe(200)
        Expect(fixture.lostCommitCount()).toBe(1)
        const receipt = await accepted.json()
        const before = await fixture.query({ [namespaces.Note]: {}, taoAccountReceipt: {}, taoAccountGuard: {} })
        Expect(before[namespaces.Note]).toHaveLength(1)
        Expect(before['taoAccountReceipt']!.filter(row => String(row['key']).includes('stable-operation')))
          .toHaveLength(1)
        const stale = await fixture.replayLastTransaction()
        Expect(stale.ok).toBe(false)
        Expect(await fixture.query({ [namespaces.Note]: {}, taoAccountReceipt: {}, taoAccountGuard: {} })).toEqual(
          before,
        )
        await fixture.restart()
        const restarted = await fixture.query({ [namespaces.Note]: {}, taoAccountReceipt: {}, taoAccountGuard: {} })
        Expect(restarted[namespaces.Note]).toEqual(before[namespaces.Note])
        const retry = await mutate(fixture.server, alice, 'stable-operation', operations)
        Expect(retry.status).toBe(200)
        Expect(await retry.json()).toEqual(receipt)
        Expect(
          (await mutate(fixture.server, alice, 'stable-operation', [{ kind: 'delete', entity: 'Note', id: 'durable' }]))
            .status,
        ).toBe(409)
        Expect(await fixture.query({ [namespaces.Note]: {}, taoAccountReceipt: {}, taoAccountGuard: {} })).toEqual(
          restarted,
        )
        Expect(
          (await mutate(fixture.server, alice, 'newer-operation', [{
            kind: 'update',
            entity: 'Note',
            id: 'durable',
            fields: { Body: 'newer authoritative body' },
          }])).status,
        ).toBe(200)
        Expect(await (await mutate(fixture.server, alice, 'stable-operation', operations)).json()).toEqual(receipt)
        Expect((await fixture.query({ [namespaces.Note]: {} }))[namespaces.Note]![0]!['fields'])
          .toEqual({ Owner: alice.accountId, Body: 'newer authoritative body' })
        await fixture.server.revoke(alice.token)
        Expect((await mutate(fixture.server, alice, 'stable-operation', operations)).status).toBe(401)
      })
    },
    120_000,
  )

  liveTest('independently fences timed-out transactions at restart, revoke and sign-out', async () => {
    for (const boundary of ['restart', 'revoke', 'sign-out']) {
      await instantFixture(apiURI!, async fixture => {
        const alice = await register(fixture.server, 'alice')
        fixture.holdWritesContaining('delayed-note')
        Expect(
          (await mutate(fixture.server, alice, 'delayed-operation', [{
            kind: 'create',
            entity: 'Note',
            id: 'delayed-note',
            fields: { Owner: alice.accountId, Body: 'must never arrive' },
          }])).status,
        ).toBe(503)
        Expect((await fixture.query({ [namespaces.Note]: {} }))[namespaces.Note]).toEqual([])
        if (boundary === 'restart') {
          await fixture.restart()
        }
        if (boundary === 'revoke') {
          await fixture.server.revoke(alice.token)
        }
        if (boundary === 'sign-out') {
          Expect((await request(fixture.server, '/v1/auth/sign-out', {}, alice)).status).toBe(200)
        }
        const stale = await fixture.releaseHeldTransaction()
        Expect(stale.ok).toBe(false)
        Expect((await fixture.query({ [namespaces.Note]: {} }))[namespaces.Note]).toEqual([])
        Expect((await request(fixture.server, '/v1/auth/session', undefined, alice)).status)
          .toBe(boundary === 'restart' ? 200 : 401)
      })
    }
  }, 120_000)

  liveTest('does not let an incomplete anonymous sign-in block trusted revoke or authenticated sign-out', async () => {
    await withHeldRequestBudget(async () => {
      for (const operation of ['revoke', 'sign-out']) {
        await instantFixture(apiURI!, async fixture => {
          const alice = await register(fixture.server, 'alice')
          await withHeldSignIn(fixture.server, async () => {
            let completed = false
            let failure: unknown
            const revocation = (operation === 'revoke'
              ? fixture.server.revoke(alice.token)
              : request(fixture.server, '/v1/auth/sign-out', {}, alice).then(response => {
                Expect(response.status).toBe(200)
              })).then(() => {
                completed = true
              }, error => {
                failure = error
                completed = true
              })
            await until(() => completed, { description: `${operation} while an anonymous body is still incomplete` })
            await revocation
            if (failure !== undefined) {
              throw failure
            }
            Expect((await request(fixture.server, '/v1/auth/session', undefined, alice)).status).toBe(401)
          })
        })
      }
    })
  }, 120_000)

  liveTest('does not write remote guards or receipts for unknown or already signed-out tokens', async () => {
    await instantFixture(apiURI!, async fixture => {
      const alice = await register(fixture.server, 'alice')
      const unknown = { ...alice, token: 'a'.repeat(96) }
      const query = { taoAccountGuard: {}, taoAccountReceipt: {} }
      const before = await fixture.query(query)
      Expect((await request(fixture.server, '/v1/auth/sign-out', {}, unknown)).status).toBe(200)
      await fixture.server.revoke(unknown.token)
      Expect(await fixture.query(query)).toEqual(before)
      Expect((await request(fixture.server, '/v1/auth/sign-out', {}, alice)).status).toBe(200)
      const signedOut = await fixture.query(query)
      Expect(signedOut['taoAccountGuard']!.length).toBe(before['taoAccountGuard']!.length + 1)
      Expect(signedOut['taoAccountReceipt']!.length).toBe(before['taoAccountReceipt']!.length + 1)
      const maximumRevision = (rows: Array<Record<string, unknown>>) =>
        Math.max(...rows.map(row => row['revision'] as number))
      Expect(maximumRevision(signedOut['taoAccountGuard']!)).toBe(maximumRevision(before['taoAccountGuard']!) + 1)
      Expect((await request(fixture.server, '/v1/auth/sign-out', {}, alice)).status).toBe(200)
      await fixture.server.revoke(alice.token)
      Expect(await fixture.query(query)).toEqual(signedOut)
    })
  }, 120_000)

  liveTest('refuses a second gateway and a different local identity database for the bound authority', async () => {
    await instantFixture(apiURI!, async fixture => {
      const alice = await register(fixture.server, 'alice')
      await Expect(AccountServer.start(fixture.options)).rejects.toThrow('Another gateway')
      await Expect(
        AccountServer.start({ ...fixture.options, databasePath: FS.resolvePath('other.sqlite', fixture.root) }),
      )
        .rejects.toThrow('another account database or policy')
      Expect((await request(fixture.server, '/v1/auth/session', undefined, alice)).status).toBe(200)
      await fixture.restart()
      Expect((await request(fixture.server, '/v1/auth/session', undefined, alice)).status).toBe(200)
    })
  }, 120_000)

  liveTest(
    'launches --instant-config and releases the gateway lock on real process death without losing receipts',
    async () => {
      await instantAppFixture(apiURI!, async app => {
        const options = {
          databasePath: FS.resolvePath('accounts.sqlite', app.root),
          issuer: 'local-instant-conformance',
          resource: 'notes',
          policy: testAccountPolicy,
          instant: app.instant,
        }
        const child = await startInstantCli(options, app.root)
        try {
          const alice = await register(child, 'crash')
          const operations: AccountProtocol.Operation[] = [{
            kind: 'create',
            entity: 'Note',
            id: 'before-crash',
            fields: { Owner: alice.accountId, Body: 'survives process death' },
          }]
          const accepted = await mutate(child, alice, 'crash-retry', operations)
          Expect(accepted.status).toBe(200)
          const receipt = await accepted.json()
          await Expect(AccountServer.start(options)).rejects.toThrow('Another gateway')
          await child.crash()
          const replacement = await AccountServer.start(options)
          try {
            const retry = await mutate(replacement, alice, 'crash-retry', operations)
            Expect(retry.status).toBe(200)
            Expect(await retry.json()).toEqual(receipt)
            const data = await app.query({ [namespaces.Note]: {} })
            Expect(data[namespaces.Note]).toHaveLength(1)
            Expect(data[namespaces.Note]![0]!['fields']).toEqual({
              Owner: alice.accountId,
              Body: 'survives process death',
            })
          } finally {
            await replacement.stop()
          }
        } finally {
          await child.stop()
        }
      })
    },
    120_000,
  )

  liveTest('retains an offline edit through a fresh process and reconnects it to Instant exactly once', async () => {
    await instantAppFixture(apiURI!, async app => {
      const test = await referenceTest(app.instant)
      try {
        test.nativeVault = true
        const alice = await test.signIn('offline', true)
        const connection = test.connect(alice)
        const baseline = await connection.load() as string
        test.online = false
        const next = JSON.parse(baseline) as { rows: { Note: unknown[] } }
        next.rows.Note.push({ Id: 'offline-note', Owner: alice.accountId, Body: 'offline retained body' })
        await connection.save(JSON.stringify(next), [], { previousSnapshot: baseline })
        await until(() => connection.writes!.status('Note', 'offline-note').failed === 1)
        connection.close?.()
        const cold = await test.coldProcess(alice)
        Expect(cold.offline.state).toBe('ready')
        Expect(cold.snapshot).toContain('offline retained body')
        Expect((await app.query({ [namespaces.Note]: {} }))[namespaces.Note]).toEqual([])
        test.online = true
        const reconnected = test.connect(alice)
        await reconnected.load()
        await until(async () => (await test.serverRows(alice)).rows.some(row => row.id === 'offline-note'))
        Expect((await app.query({ [namespaces.Note]: {} }))[namespaces.Note]).toHaveLength(1)
        Expect(reconnected.writes!.status('Note', 'offline-note').records).toHaveLength(0)
        reconnected.close?.()
      } finally {
        await test.stop()
      }
    })
  }, 120_000)
})

async function request(
  server: { url: string },
  path: string,
  body?: unknown,
  session?: AccountProtocol.Session,
): Promise<Response> {
  return await fetch(`${server.url}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(session === undefined ? {} : { authorization: `Bearer ${session.token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function register(server: { url: string }, name: string): Promise<AccountProtocol.Session> {
  const response = await request(server, '/v1/auth/sign-up', {
    email: `${name}@example.test`,
    password: 'a-good-password',
    resource: 'notes',
  })
  Expect(response.status).toBe(200)
  return await response.json() as AccountProtocol.Session
}

async function mutate(
  server: { url: string },
  session: AccountProtocol.Session,
  operationId: string,
  operations: AccountProtocol.Operation[],
): Promise<Response> {
  return await request(server, '/v1/data/transactions', { operationId, operations }, session)
}

async function snapshot(server: { url: string }, session: AccountProtocol.Session): Promise<AccountProtocol.Snapshot> {
  const response = await request(server, '/v1/data', undefined, session)
  Expect(response.status).toBe(200)
  return await response.json() as AccountProtocol.Snapshot
}
