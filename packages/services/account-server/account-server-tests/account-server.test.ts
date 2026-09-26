import { CLI, Errors, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test, until } from '@shared/test'
import type { AccountProtocol } from 'tao-shared/auth'
import { type AccountPolicy, AccountServer } from '../account-server-src/AccountServer'

const policy: AccountPolicy = {
  accountEntity: 'Account',
  entities: {
    Account: {
      fields: ['DisplayName', 'VerifiedEmail'],
      grants: [{ operations: ['read'], principal: [] }, {
        operations: ['update'],
        principal: [],
        updateFields: ['DisplayName'],
      }],
    },
    Note: {
      fields: ['Owner', 'Body'],
      fieldTypes: { Body: 'text' },
      relations: { Owner: { entity: 'Account' } },
      grants: [{ operations: ['read', 'create', 'delete'], principal: ['Owner'] }, {
        operations: ['update'],
        principal: ['Owner'],
        updateFields: ['Body'],
      }],
    },
    Workspace: {
      fields: ['Owner', 'Title'],
      relations: { Owner: { entity: 'Account' }, Memberships: { entity: 'Membership', inverse: 'Workspace' } },
      grants: [{ operations: ['read'], principal: ['Memberships', 'Person'] }],
    },
    Membership: {
      fields: ['Workspace', 'Person', 'Role'],
      relations: { Workspace: { entity: 'Workspace' }, Person: { entity: 'Account' } },
      unique: [['Workspace', 'Person']],
      grants: [{ operations: ['read'], principal: ['Person'] }, {
        operations: ['create'],
        principal: ['Workspace', 'Owner'],
      }],
    },
  },
}

Describe('Local account reference authority', () => {
  Test('verifies passwords, resource binding, session expiry/revocation and durable restart', async () => {
    await fixture(async context => {
      const alice = await register(context.server, 'alice')
      const key = await (await request(context.server, '/v1/auth/data-key', undefined, alice))
        .json() as AccountProtocol.DataKey
      Expect(key.accountId).toBe(alice.accountId)
      Expect(key.resource).toBe('notes')
      Expect(key.key).toMatch(/^[a-f0-9]{64}$/)
      Expect(alice.accountId).not.toBe(alice.subject)
      Expect(
        (await request(context.server, '/v1/auth/sign-in', {
          email: 'alice@example.test',
          password: 'wrong-password',
          resource: 'notes',
        })).status,
      ).toBe(401)
      Expect(
        (await request(context.server, '/v1/auth/sign-in', {
          email: 'alice@example.test',
          password: 'a-good-password',
          resource: 'another',
        })).status,
      ).toBe(401)
      const signedIn = await (await request(context.server, '/v1/auth/sign-in', {
        email: 'alice@example.test',
        password: 'a-good-password',
        resource: 'notes',
      })).json() as AccountProtocol.Session
      Expect(signedIn.accountId).toBe(alice.accountId)
      Expect(signedIn.token).not.toBe(alice.token)
      await context.restart()
      Expect(await (await request(context.server, '/v1/auth/data-key', undefined, alice)).json()).toEqual(key)
      Expect((await request(context.server, '/v1/auth/session', undefined, alice)).status).toBe(200)
      const wrongResource = await AccountServer.start({ ...context.options, resource: 'other' })
      try {
        Expect((await request(wrongResource, '/v1/data', undefined, alice)).status).toBe(401)
      } finally {
        await wrongResource.stop()
      }
      Expect((await request(context.server, '/v1/auth/sign-out', {}, alice)).status).toBe(200)
      Expect((await request(context.server, '/v1/auth/sign-out', {}, alice)).status).toBe(200)
      Expect((await request(context.server, '/v1/auth/session', undefined, alice)).status).toBe(401)
      context.advance(60 * 60 * 1000)
      Expect((await request(context.server, '/v1/data', undefined, signedIn)).status).toBe(401)
    })
  })

  Test('denies anonymous/cross-account/owner/protected-field writes and rejects spoofed actors', async () => {
    await fixture(async ({ server }) => {
      const alice = await register(server, 'alice')
      const bob = await register(server, 'bob')
      Expect((await request(server, '/v1/data')).status).toBe(401)
      Expect(
        (await mutate(server, alice, 'create', [{
          kind: 'create',
          entity: 'Note',
          id: 'private',
          fields: { Owner: alice.accountId, Body: 'private words' },
        }])).status,
      ).toBe(200)
      const bobRows = await snapshot(server, bob)
      Expect(bobRows.rows.map(row => row.id)).toEqual([bob.accountId])
      for (
        const operation of [
          { kind: 'update', entity: 'Note', id: 'private', fields: { Body: 'stolen' } },
          { kind: 'update', entity: 'Note', id: 'private', fields: { Owner: bob.accountId, Body: 'stolen' } },
          { kind: 'create', entity: 'Note', id: 'forged', fields: { Owner: alice.accountId, Body: 'forged' } },
          { kind: 'update', entity: 'Account', id: bob.accountId, fields: { VerifiedEmail: 'fake@verified.test' } },
        ] as AccountProtocol.Operation[]
      ) {
        Expect((await mutate(server, bob, JSON.stringify(operation), [operation])).status).toBe(403)
      }
      Expect(
        (await request(server, '/v1/data/transactions', {
          operationId: 'spoof',
          actor: alice.accountId,
          operations: [],
        }, bob)).status,
      ).toBe(400)
      Expect(
        (await mutate(server, alice, 'transfer', [{
          kind: 'update',
          entity: 'Note',
          id: 'private',
          fields: { Owner: bob.accountId },
        }])).status,
      ).toBe(403)
      Expect(
        (await mutate(server, alice, 'profile', [{
          kind: 'update',
          entity: 'Account',
          id: alice.accountId,
          fields: { DisplayName: 'Alice' },
        }])).status,
      ).toBe(200)
      Expect(
        (await mutate(server, alice, 'invalid-owner-list', [{
          kind: 'create',
          entity: 'Note',
          id: 'invalid-owner',
          fields: { Owner: [alice.accountId, bob.accountId], Body: 'shared accidentally' },
        }])).status,
      ).toBe(400)
      Expect(
        (await mutate(server, alice, 'invalid-body', [{
          kind: 'update',
          entity: 'Note',
          id: 'private',
          fields: { Body: { invalid: true } },
        }])).status,
      ).toBe(400)
      Expect(
        (await mutate(server, alice, 'unknown-entity', [{
          kind: 'create',
          entity: 'toString',
          id: 'unknown',
          fields: {},
        }])).status,
      ).toBe(403)
      Expect((await mutate(server, bob, 'delete-another', [{ kind: 'delete', entity: 'Note', id: 'private' }])).status)
        .toBe(403)
      Expect((await snapshot(server, alice)).rows.find(row => row.id === 'private')?.fields['Body']).toBe(
        'private words',
      )
    })
  })

  Test('enforces membership, tuple races and multi-row rollback in the actual HTTP backend', async () => {
    await fixture(async ({ server }) => {
      const alice = await register(server, 'alice')
      const bob = await register(server, 'bob')
      server.seed([{ entity: 'Workspace', id: 'workspace', fields: { Owner: alice.accountId, Title: 'Shared' } }])
      Expect((await snapshot(server, bob)).rows.some(row => row.id === 'workspace')).toBe(false)
      const membership: AccountProtocol.Operation = {
        kind: 'create',
        entity: 'Membership',
        id: 'membership',
        fields: { Workspace: 'workspace', Person: bob.accountId, Role: 'reader' },
      }
      Expect((await mutate(server, bob, 'forge-membership', [membership])).status).toBe(403)
      const responses = await Promise.all([
        mutate(server, alice, 'member-one', [membership]),
        mutate(server, alice, 'member-two', [{ ...membership, id: 'membership-two' }]),
      ])
      Expect(responses.map(response => response.status).sort()).toEqual([200, 409])
      Expect((await snapshot(server, bob)).rows.some(row => row.id === 'workspace')).toBe(true)
      const rollback = await mutate(server, alice, 'atomic-reject', [
        { kind: 'create', entity: 'Note', id: 'rollback', fields: { Owner: alice.accountId, Body: 'never saved' } },
        {
          kind: 'create',
          entity: 'Membership',
          id: 'duplicate',
          fields: { Workspace: 'workspace', Person: bob.accountId, Role: 'reader' },
        },
      ])
      Expect(rollback.status).toBe(409)
      Expect((await snapshot(server, alice)).rows.some(row => row.id === 'rollback')).toBe(false)
      const unauthorizedBatch = await mutate(server, alice, 'atomic-forbidden', [
        { kind: 'create', entity: 'Note', id: 'rollback-two', fields: { Owner: alice.accountId, Body: 'never saved' } },
        { kind: 'update', entity: 'Account', id: bob.accountId, fields: { DisplayName: 'forged' } },
      ])
      Expect(unauthorizedBatch.status).toBe(403)
      Expect((await snapshot(server, alice)).rows.some(row => row.id === 'rollback-two')).toBe(false)
    })
  })

  Test('persists rows/receipts, makes retries idempotent, and maps trusted issuer subjects independently', async () => {
    await fixture(async context => {
      const alice = await register(context.server, 'alice')
      const transaction: AccountProtocol.Operation[] = [{
        kind: 'create',
        entity: 'Note',
        id: 'durable',
        fields: { Owner: alice.accountId, Body: 'kept' },
      }]
      const first = await (await mutate(context.server, alice, 'stable-id', transaction)).json()
      await context.restart()
      Expect(await (await mutate(context.server, alice, 'stable-id', transaction)).json()).toEqual(first)
      Expect(
        await (await mutate(context.server, alice, 'stable-id', [{
          kind: 'create',
          entity: 'Note',
          id: 'durable',
          fields: { Body: 'kept', Owner: alice.accountId },
        }])).json(),
      ).toEqual(first)
      Expect((await snapshot(context.server, alice)).rows.find(row => row.id === 'durable')?.fields['Body']).toBe(
        'kept',
      )
      Expect(
        (await mutate(context.server, alice, 'stable-id', [{ kind: 'delete', entity: 'Note', id: 'durable' }])).status,
      ).toBe(409)
      const one = context.server.provision('verified-provider', 'subject')
      Expect(context.server.provision('verified-provider', 'subject')).toEqual(one)
      Expect(context.server.provision('another-provider', 'subject').accountId).not.toBe(one.accountId)
      context.server.revoke(alice.token)
      Expect((await mutate(context.server, alice, 'stable-id', transaction)).status).toBe(401)
    })
  })

  Test('serializes competing registrations and trusts post-write relationship state', async () => {
    await fixture(async context => {
      const registrations = await Promise.all([1, 2].map(() =>
        request(context.server, '/v1/auth/sign-up', {
          email: 'same@example.test',
          password: 'a-good-password',
          resource: 'notes',
        })
      ))
      Expect(registrations.map(response => response.status).sort()).toEqual([200, 409])
      const alice = await register(context.server, 'alice')
      const bob = await register(context.server, 'bob')
      // This deployment deliberately permits changes to a grant-bearing field. The caller must
      // satisfy the resulting row, not the row they previously owned. Normal Notes policy never
      // grants Owner updates, preventing this deployment choice from permitting ownership theft.
      await context.server.stop()
      const transferPolicy = structuredClone(policy)
      transferPolicy.entities['Note']!.grants = [{
        operations: ['create', 'read', 'update'],
        principal: ['Owner'],
        updateFields: ['Owner', 'Body'],
      }]
      context.server = await AccountServer.start({ ...context.options, policy: transferPolicy })
      Expect(
        (await mutate(context.server, alice, 'initial', [{
          kind: 'create',
          entity: 'Note',
          id: 'post-state',
          fields: { Owner: alice.accountId, Body: 'mine' },
        }])).status,
      ).toBe(200)
      Expect(
        (await mutate(context.server, alice, 'give-away', [{
          kind: 'update',
          entity: 'Note',
          id: 'post-state',
          fields: { Owner: bob.accountId },
        }])).status,
      ).toBe(403)
    })
  })

  Test('enforces one composite membership and one receipt across separate server processes', async () => {
    await fixture(async context => {
      const alice = await register(context.server, 'alice')
      const bob = await register(context.server, 'bob')
      context.server.seed([{
        entity: 'Workspace',
        id: 'workspace',
        fields: { Owner: alice.accountId, Title: 'Shared' },
      }])
      const children: Awaited<ReturnType<typeof childServer>>[] = []
      try {
        children.push(await childServer(context.options, 'first'))
        children.push(await childServer(context.options, 'second'))
        const first = children[0]!
        const second = children[1]!
        const memberships = await Promise.all(
          [first, second].map((server, index) =>
            mutate(server, alice, `race-${index}`, [
              {
                kind: 'create',
                entity: 'Membership',
                id: `member-${index}`,
                fields: { Workspace: 'workspace', Person: bob.accountId, Role: 'reader' },
              },
            ])
          ),
        )
        Expect(memberships.map(response => response.status).sort()).toEqual([200, 409])
        Expect((await snapshot(context.server, bob)).rows.filter(row => row.entity === 'Membership')).toHaveLength(1)
        const operations: AccountProtocol.Operation[] = [{
          kind: 'create',
          entity: 'Note',
          id: 'receipt-race',
          fields: { Owner: alice.accountId, Body: 'once' },
        }]
        const writes = await Promise.all(
          [first, second].map(server => mutate(server, alice, 'one-receipt', operations)),
        )
        Expect(writes.map(response => response.status)).toEqual([200, 200])
        Expect(await writes[0]!.json()).toEqual(await writes[1]!.json())
        context.server.revoke(alice.token)
        Expect((await mutate(second, alice, 'one-receipt', operations)).status).toBe(401)
      } finally {
        for (const child of children) {
          await child.stop()
        }
      }
    })
  })

  Test('keeps composite uniqueness null-distinct while rejecting duplicate complete tuples', async () => {
    await fixture(async context => {
      const optionalPolicy = structuredClone(policy)
      optionalPolicy.entities['Note']!.unique = [['Owner', 'Body']]
      await context.server.stop()
      context.server = await AccountServer.start({ ...context.options, policy: optionalPolicy })
      const alice = await register(context.server, 'alice')
      Expect(
        (await mutate(context.server, alice, 'incomplete-tuples', [
          { kind: 'create', entity: 'Note', id: 'missing-one', fields: { Owner: alice.accountId } },
          { kind: 'create', entity: 'Note', id: 'missing-two', fields: { Owner: alice.accountId } },
          { kind: 'create', entity: 'Note', id: 'null-one', fields: { Owner: alice.accountId, Body: null } },
          { kind: 'create', entity: 'Note', id: 'null-two', fields: { Owner: alice.accountId, Body: null } },
        ])).status,
      ).toBe(200)
      Expect(
        (await mutate(context.server, alice, 'duplicate-complete', [
          { kind: 'create', entity: 'Note', id: 'complete-one', fields: { Owner: alice.accountId, Body: 'same' } },
          { kind: 'create', entity: 'Note', id: 'complete-two', fields: { Owner: alice.accountId, Body: 'same' } },
        ])).status,
      ).toBe(409)
      Expect((await snapshot(context.server, alice)).rows.filter(row => row.entity === 'Note')).toHaveLength(4)
    })
  })
})

async function fixture(
  run: (context: {
    advance(ms: number): void
    options: Parameters<typeof AccountServer.start>[0]
    restart(): Promise<void>
    server: AccountServer
  }) => Promise<void>,
): Promise<void> {
  const root = await mkTestDir('tao-account-server-', { location: 'host' })
  let now = Date.now()
  const options = {
    databasePath: FS.resolvePath('accounts.sqlite', root),
    clock: () => now,
    issuer: 'local-test',
    resource: 'notes',
    policy,
  }
  const context = {
    advance(ms: number) {
      now += ms
    },
    options,
    async restart() {
      await context.server.stop()
      context.server = await AccountServer.start(options)
    },
    server: await AccountServer.start(options),
  }
  try {
    await run(context)
  } finally {
    await context.server.stop()
    await FS.remove(root)
  }
}

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

async function register(server: AccountServer, name: string): Promise<AccountProtocol.Session> {
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

async function childServer(
  options: Parameters<typeof AccountServer.start>[0],
  name: string,
): Promise<{ url: string; stop(): Promise<void> }> {
  const root = FS.dirname(options.databasePath)
  const configuration = FS.resolvePath(`${name}.json`, root)
  const ready = FS.resolvePath(`${name}.ready.json`, root)
  await FS.writeJson(configuration, options)
  let output = ''
  const child = CLI.start(Platform.runtimeProcess.execPath, {
    args: [
      'run',
      Repo.resolvePath('packages/services/account-server/account-server-tests/fixtures/server-process.ts'),
      configuration,
      ready,
    ],
    onOutput: (_stream, chunk) => {
      output += chunk.toString()
    },
    processPolicy: 'server',
    stdio: 'pipe',
  })
  const stop = async () => {
    child.kill('SIGTERM')
    await child.waitForClose()
    await child.closeOutput()
    child.dispose()
  }
  try {
    await until(async () => {
      if (child.exitCode !== null || child.error !== undefined) {
        Errors.throwHostEnvironment(`Reference server child failed: ${output}`)
      }
      return await FS.isFile(ready)
    }, { description: 'reference server child to publish its localhost URL' })
    return { ...await FS.readJson<{ url: string }>(ready), stop }
  } catch (error) {
    await stop()
    throw error
  }
}

async function snapshot(server: AccountServer, session: AccountProtocol.Session): Promise<AccountProtocol.Snapshot> {
  const response = await request(server, '/v1/data', undefined, session)
  Expect(response.status).toBe(200)
  return await response.json() as AccountProtocol.Snapshot
}
