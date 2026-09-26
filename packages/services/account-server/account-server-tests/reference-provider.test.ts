import type TR from '@runtime/TR'
import { CLI, Errors, FS, Platform, Repo } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, Test, until } from '@shared/test'
import type { AccountProtocol } from 'tao-shared/auth'
import { type ReferenceHost, ReferenceProvider } from '../../../apps/stdlib/@tao/data/providers/reference/Reference'
import { AccountServer } from '../account-server-src/AccountServer'

const schema: TR.DataSchemaDefinition = {
  name: 'Notes',
  entities: {
    Account: { collection: 'Accounts', fields: { DisplayName: { kind: 'text' } } },
    Note: { collection: 'Notes', fields: { Owner: { kind: 'relation', relation: 'Account' }, Body: { kind: 'text' } } },
  },
}

Describe('Reference provider with the local account authority', () => {
  Test('retains both concurrent account connections writes across offline restart and upload', async () => {
    await fixture(async test => {
      test.nativeVault = true
      const alice = await test.signIn('shared-writer', true)
      const first = test.connect(alice)
      const second = test.connect(alice)
      const [one, two] = await Promise.all([first.load(), second.load()]) as [string, string]
      test.online = false
      await Promise.all([
        first.save(withNote(one, 'first-write', alice.accountId, 'first retained body'), [], { previousSnapshot: one }),
        second.save(withNote(two, 'second-write', alice.accountId, 'second retained body'), [], {
          previousSnapshot: two,
        }),
      ])
      await until(() => first.writes!.status('Note', 'first-write').failed === 1)
      Expect(second.writes!.status('Note', 'first-write').records).toHaveLength(1)
      Expect(first.writes!.status('Note', 'second-write').records).toHaveLength(1)
      first.close?.()
      second.close?.()
      const restored = test.connect(alice)
      const recovered = await restored.load() as string
      Expect(recovered).toContain('first retained body')
      Expect(recovered).toContain('second retained body')
      test.online = true
      await restored.load()
      await until(async () => (await test.serverRows(alice)).rows.filter(row => row.entity === 'Note').length === 2)
      Expect((await test.serverRows(alice)).rows.filter(row => row.entity === 'Note').map(row => row.id).sort())
        .toEqual(['first-write', 'second-write'])
      restored.close?.()
    })
  })

  Test('drains an unmounted writer before reopening and preserves the newer session key on old logout', async () => {
    await fixture(async test => {
      test.nativeVault = true
      let acquisitions = 0
      let releases = 0
      test.acquireCheckpoint = async () => {
        acquisitions += 1
        return () => {
          releases += 1
        }
      }
      const alice = await test.signIn('lease-race', true)
      const oldAuth = new AbortController()
      const first = test.connect(alice, oldAuth)
      const baseline = await first.load() as string
      const started = Deferred()
      const release = Deferred()
      test.online = false
      test.beforeStorage = async () => {
        started.resolve()
        await release.promise
      }
      const saving = first.save(withNote(baseline, 'drained-write', alice.accountId, 'drained body'), [], {
        previousSnapshot: baseline,
      })
      const rejected = Expect(saving).rejects.toThrow('closed')
      await started.promise
      first.close?.()
      Expect(releases).toBe(0)
      const newAuth = new AbortController()
      const second = test.connect(alice, newAuth)
      const loading = second.load()
      oldAuth.abort()
      const invalidated = first.invalidateAuth!()
      test.beforeStorage = undefined
      release.resolve()
      await rejected
      Expect(await loading).toContain('drained body')
      await invalidated
      Expect(test.vault.size).toBe(1)
      Expect(acquisitions).toBe(1)
      Expect(releases).toBe(0)
      newAuth.abort()
      await second.invalidateAuth!()
      Expect(test.vault.size).toBe(0)
      await until(() => releases === 1)
    })
  })

  Test('refuses unavailable external checkpoint ownership before reading keys or persisting', async () => {
    await fixture(async test => {
      test.nativeVault = true
      test.acquireCheckpoint = async () => Errors.throwHostEnvironment('Checkpoint is open in another browser tab.')
      const alice = await test.signIn('locked-tab', true)
      const blocked = test.connect(alice)
      await Expect(blocked.load()).rejects.toThrow('another browser tab')
      Expect(test.vault.size).toBe(0)
      Expect(await test.persisted()).toBe('')
      blocked.close?.()
      await blocked.invalidateAuth!()
    })
  })

  Test('old logout joins a replacement coordinator and incompatible simultaneous coverage is refused', async () => {
    await fixture(async test => {
      test.nativeVault = true
      let releases = 0
      test.acquireCheckpoint = async () => () => {
        releases += 1
      }
      const alice = await test.signIn('retired-lease', true)
      const oldAuth = new AbortController()
      const first = test.connect(alice, oldAuth)
      await first.load()
      test.storageLimit -= 1
      Expect(() => test.connect(alice)).toThrow('same schema and offline working set')
      first.close?.()
      await until(() => releases === 1)
      const currentAuth = new AbortController()
      const current = test.connect(alice, currentAuth)
      await current.load()
      oldAuth.abort()
      await first.invalidateAuth!()
      Expect(test.vault.size).toBe(1)
      currentAuth.abort()
      await current.invalidateAuth!()
      Expect(test.vault.size).toBe(0)
    })
  })

  Test('retains key custody for another signed-in scope after both data connections unmount', async () => {
    await fixture(async test => {
      test.nativeVault = true
      const alice = await test.signIn('closed-scopes', true)
      const firstAuth = new AbortController()
      const secondAuth = new AbortController()
      const first = test.connect(alice, firstAuth)
      const second = test.connect(alice, secondAuth)
      await first.load()
      await second.load()
      first.close?.()
      second.close?.()
      firstAuth.abort()
      await first.invalidateAuth!()
      Expect(test.vault.size).toBe(1)
      test.online = false
      const remounted = test.connect(alice, secondAuth)
      Expect(await remounted.load()).toBeDefined()
      Expect(remounted.offline!.status().state).toBe('ready')
      secondAuth.abort()
      await Promise.all([second.invalidateAuth!(), remounted.invalidateAuth!()])
      Expect(test.vault.size).toBe(0)
    })
  })

  Test('keeps peer snapshots current when a duplicate old receipt arrives after a newer edit', async () => {
    await fixture(async test => {
      const alice = await test.signIn('duplicate-receipt', true)
      const first = test.connect(alice)
      const second = test.connect(alice)
      const baseline = await first.load() as string
      await second.load()
      const snapshots: string[] = []
      first.subscribe!({
        error: () => {},
        snapshot: snapshot => {
          snapshots.push(snapshot!)
        },
      })
      const started = Deferred()
      const release = Deferred()
      let posts = 0
      test.beforePost = async () => {
        if (++posts === 1) {
          started.resolve()
          await release.promise
        }
      }
      await first.save(withNote(baseline, 'shared-note', alice.accountId, 'original body'), [], {
        previousSnapshot: baseline,
      })
      await started.promise
      await second.load()
      await until(() => second.writes!.status('Note', 'shared-note').records.length === 0)
      const previous = await second.load() as string
      const next = JSON.parse(previous) as { rows: { Note: Array<{ Body: string }> } }
      next.rows.Note[0]!.Body = 'newer body'
      await second.save(JSON.stringify(next), [{ entity: 'Note', id: 'shared-note', fields: ['Body'] }], {
        previousSnapshot: previous,
      })
      await until(() => second.writes!.status('Note', 'shared-note').records.length === 0)
      Expect(snapshots.at(-1)).toContain('newer body')
      const acknowledged = snapshots.length
      release.resolve()
      // Poll waits for this connection's old upload before publishing its refreshed snapshot.
      test.poll()
      await until(() => snapshots.length > acknowledged)
      Expect(snapshots.slice(acknowledged).every(snapshot => snapshot.includes('newer body'))).toBe(true)
      Expect((await test.serverRows(alice)).rows.find(row => row.id === 'shared-note')?.fields['Body']).toBe(
        'newer body',
      )
      first.close?.()
      second.close?.()
    })
  })

  Test('recovers encrypted durable writes after restart and verified account key exchange', async () => {
    await fixture(async test => {
      const alice = await test.signIn('alice', true)
      const first = test.connect(alice)
      const baseline = await first.load() as string
      test.online = false
      await first.save(withNote(baseline, 'offline-note', alice.accountId, 'private offline words'), [], {
        previousSnapshot: baseline,
      })
      await until(() => first.writes!.status('Note', 'offline-note').failed === 1)
      first.close?.()
      const bytes = await test.persisted()
      Expect(bytes).not.toContain('private offline words')
      Expect(bytes).not.toContain(alice.token)
      const coldBrowser = test.connect(alice)
      await Expect(coldBrowser.load()).rejects.toThrow('offline')
      coldBrowser.close?.()
      test.online = true
      const restoredSession = await test.signIn('alice')
      const restored = test.connect(restoredSession)
      const local = await restored.load() as string
      Expect(local).toContain('private offline words')
      await until(() => restored.writes!.status('Note', 'offline-note').records.length === 0)
      Expect((await test.serverRows(restoredSession)).rows.find(row => row.id === 'offline-note')?.fields['Body']).toBe(
        'private offline words',
      )
      restored.close?.()
    })
  })

  Test('does not delete a remote row the runtime has not consumed and honors same-value update intent', async () => {
    await fixture(async test => {
      const alice = await test.signIn('alice', true)
      const connection = test.connect(alice)
      const baseline = await connection.load() as string
      const snapshots: string[] = []
      connection.subscribe?.({
        error: () => {},
        snapshot: value => {
          snapshots.push(value!)
        },
      })
      await test.serverWrite(alice, [{
        kind: 'create',
        entity: 'Note',
        id: 'remote',
        fields: { Owner: alice.accountId, Body: 'remote original' },
      }])
      test.poll()
      await until(() => snapshots.some(snapshot => snapshot.includes('remote original')))
      // A runtime save queued before the subscription arrived still holds this old baseline.
      await connection.save(withNote(baseline, 'local', alice.accountId, 'local edit'), [], {
        previousSnapshot: baseline,
      })
      await until(() => connection.writes!.status('Note', 'local').records.length === 0)
      Expect((await test.serverRows(alice)).rows.filter(row => row.entity === 'Note').map(row => row.id).sort())
        .toEqual(['local', 'remote'])
      const loaded = await connection.load() as string
      await Expect(
        connection.submit!(loaded, [{ entity: 'Note', id: 'local', fields: ['Owner'] }], { previousSnapshot: loaded }),
      ).rejects.toThrow('authorize')
      Expect(connection.writes!.status('Note', 'local').failed).toBe(1)
      connection.close?.()
    })
  })

  Test('seals a pending old-account request and resumes only after the same account reauthenticates', async () => {
    await fixture(async test => {
      test.nativeVault = true
      const alice = await test.signIn('alice', true)
      const bob = await test.signIn('bob', true)
      const oldAbort = new AbortController()
      const aliceConnection = test.connect(alice, oldAbort)
      const baseline = await aliceConnection.load() as string
      const started = Deferred()
      const release = Deferred()
      test.beforePost = async () => {
        started.resolve()
        await release.promise
      }
      await aliceConnection.save(withNote(baseline, 'sealed-note', alice.accountId, 'sealed words'), [], {
        previousSnapshot: baseline,
      })
      await started.promise
      oldAbort.abort()
      const invalidated = aliceConnection.invalidateAuth!()
      release.resolve()
      await invalidated
      Expect(test.vault.size).toBe(0)
      test.beforePost = undefined
      const bobConnection = test.connect(bob)
      Expect(await bobConnection.load()).not.toContain('sealed words')
      Expect((await test.serverRows(alice)).rows.some(row => row.id === 'sealed-note')).toBe(false)
      bobConnection.close?.()
      const resumed = test.connect(await test.signIn('alice'))
      Expect(await resumed.load()).toContain('sealed words')
      await until(() => resumed.writes!.status('Note', 'sealed-note').records.length === 0)
      Expect((await test.serverRows(alice)).rows.find(row => row.id === 'sealed-note')?.fields['Body']).toBe(
        'sealed words',
      )
      resumed.close?.()
    })
  })

  Test(
    'exposes only the declared persisted working set and fails a write before queuing when storage is full',
    async () => {
      await fixture(async test => {
        test.nativeVault = true
        const alice = await test.signIn('alice', true)
        await test.serverWrite(alice, [{
          kind: 'create',
          entity: 'Note',
          id: 'retained',
          fields: { Owner: alice.accountId, Body: 'retained note' },
        }])
        const first = test.connect(alice)
        const baseline = await first.load() as string
        test.storageFailed = true
        await Expect(
          first.save(withNote(baseline, 'not-durable', alice.accountId, 'must not queue'), [], {
            previousSnapshot: baseline,
          }),
        ).rejects.toThrow('storage is full')
        Expect(first.writes!.status('Note', 'not-durable').records).toEqual([])
        Expect((await test.serverRows(alice)).rows.some(row => row.id === 'not-durable')).toBe(false)
        test.storageFailed = false
        first.close?.()
        test.online = false
        const second = test.connect(alice)
        const offline = JSON.parse(await second.load() as string) as { rows: Record<string, unknown[]> }
        Expect(offline.rows['Note']).toHaveLength(1)
        Expect(offline.rows['Account']).toEqual([])
        second.close?.()
      })
    },
  )

  Test('keeps a queued profile submission out of published account state until acknowledgement', async () => {
    await fixture(async test => {
      const alice = await test.signIn('alice', true)
      const connection = test.connect(alice)
      const baseline = await connection.load() as string
      const candidate = JSON.parse(baseline) as { rows: { Account: Array<{ Id: string; DisplayName: string }> } }
      candidate.rows.Account[0]!.DisplayName = 'Unconfirmed name'
      test.online = false
      Expect(
        await connection.submit!(JSON.stringify(candidate), [{
          entity: 'Account',
          id: alice.accountId,
          fields: ['DisplayName'],
        }], { previousSnapshot: baseline }),
      ).toEqual({ status: 'queued' })
      const snapshots: string[] = []
      connection.subscribe?.({
        error: () => {},
        snapshot: value => {
          snapshots.push(value!)
        },
      })
      Expect(snapshots).toEqual([])
      test.online = true
      test.poll()
      await until(() => connection.writes!.status('Account', alice.accountId).records.length === 0)
      await until(() => snapshots.some(snapshot => snapshot.includes('Unconfirmed name')))
      connection.close?.()
    })
  })

  Test('removes the native vault key when logout follows an earlier datasource unmount', async () => {
    await fixture(async test => {
      test.nativeVault = true
      const alice = await test.signIn('alice', true)
      const controller = new AbortController()
      const connection = test.connect(alice, controller)
      await connection.load()
      Expect(test.vault.size).toBe(1)
      connection.close?.()
      Expect(test.vault.size).toBe(1)
      controller.abort()
      await until(() => test.vault.size === 0)
    })
  })

  Test('distinguishes a durable empty working set from missing, incomplete, or evicted storage', async () => {
    await fixture(async test => {
      test.nativeVault = true
      const alice = await test.signIn('alice', true)
      test.failDataRead = true
      const incomplete = test.connect(alice)
      Expect(incomplete.offline!.status().state).toBe('loading')
      await Expect(incomplete.load()).rejects.toThrow('offline')
      Expect(incomplete.offline!.status().state).toBe('unavailable')
      incomplete.close?.()
      test.failDataRead = false
      const filled = test.connect(alice)
      await filled.load()
      Expect(filled.offline!.status().state).toBe('ready')
      filled.close?.()
      test.online = false
      const empty = test.connect(alice)
      const stored = JSON.parse(await empty.load() as string) as { rows: { Note: unknown[] } }
      Expect(stored.rows.Note).toEqual([])
      Expect(empty.offline!.status().state).toBe('ready')
      empty.close?.()
      await test.evict()
      const evicted = test.connect(alice)
      await Expect(evicted.load()).rejects.toThrow('offline')
      Expect(evicted.offline!.status().state).toBe('unavailable')
      evicted.close?.()
    })
  })

  Test('reports configured retention limits without claiming a complete offline fill', async () => {
    await fixture(async test => {
      const alice = await test.signIn('alice', true)
      test.storageLimit = 1
      const connection = test.connect(alice)
      await Expect(connection.load()).rejects.toThrow('StorageLimitBytes')
      Expect(connection.offline!.status().state).toBe('unavailable')
      Expect(await test.persisted()).toBe('')
      connection.close?.()
    })
  })

  Test(
    'retains authored content after reconnect rejects a queued edit and removes its readable server row',
    async () => {
      await fixture(async test => {
        const alice = await test.signIn('alice', true)
        const bob = await test.signIn('bob', true)
        await test.serverWrite(alice, [{
          kind: 'create',
          entity: 'Note',
          id: 'revoked',
          fields: { Owner: alice.accountId, Body: 'previous server content' },
        }])
        const connection = test.connect(alice)
        const baseline = await connection.load() as string
        const changed = JSON.parse(baseline) as { rows: { Note: Array<{ Body: string }> } }
        changed.rows.Note[0]!.Body = 'recover this authored edit'
        test.online = false
        await connection.save(JSON.stringify(changed), [{ entity: 'Note', id: 'revoked', fields: ['Body'] }], {
          previousSnapshot: baseline,
        })
        await until(() => connection.writes!.status('Note', 'revoked').failed === 1)
        test.transferNote('revoked', bob.accountId)
        const snapshots: string[] = []
        connection.subscribe?.({
          error: () => {},
          snapshot: value => {
            snapshots.push(value!)
          },
        })
        test.online = true
        test.poll()
        await until(() => snapshots.length > 0)
        Expect(snapshots[0]).not.toContain('previous server content')
        const rejected = connection.writes!.status('Note', 'revoked')
        Expect(rejected.failed).toBe(1)
        Expect(rejected.records[0]?.recovery?.[0]?.fields?.['Body']).toBe('recover this authored edit')
        connection.close?.()
        const restored = test.connect(await test.signIn('alice'))
        Expect(await restored.load()).not.toContain('previous server content')
        Expect(restored.writes!.status('Note', 'revoked').records[0]?.recovery?.[0]?.fields?.['Body']).toBe(
          'recover this authored edit',
        )
        restored.close?.()
      })
    },
  )

  Test(
    'opens the complete declared set in a fresh process with networking disabled and persistent-vault fixture',
    async () => {
      await fixture(async test => {
        test.nativeVault = true
        const alice = await test.signIn('alice', true)
        await test.serverWrite(alice, [{
          kind: 'create',
          entity: 'Note',
          id: 'cold-start',
          fields: { Owner: alice.accountId, Body: 'from durable bytes' },
        }])
        const connection = test.connect(alice)
        await connection.load()
        connection.close?.()
        const result = await test.coldProcess(alice)
        Expect(result.offline.state).toBe('ready')
        Expect(result.snapshot).toContain('from durable bytes')
        Expect(JSON.parse(result.snapshot).rows.Account).toEqual([])
      })
    },
  )
})

function withNote(serialized: string, id: string, owner: string, body: string): string {
  const envelope = JSON.parse(serialized) as { rows: { Note: unknown[] } }
  envelope.rows.Note.push({ Id: id, Owner: owner, Body: body })
  return JSON.stringify(envelope)
}

async function fixture(run: (test: Awaited<ReturnType<typeof referenceTest>>) => Promise<void>): Promise<void> {
  const test = await referenceTest()
  try {
    await run(test)
  } finally {
    await test.stop()
  }
}

async function referenceTest() {
  const root = await mkTestDir('tao-reference-provider-', { location: 'host' })
  const server = await AccountServer.start({
    databasePath: FS.resolvePath('accounts.sqlite', root),
    issuer: 'local-reference',
    resource: 'notes',
    policy: {
      accountEntity: 'Account',
      entities: {
        Account: {
          fields: ['DisplayName'],
          grants: [{ principal: [], operations: ['read'] }, {
            principal: [],
            operations: ['update'],
            updateFields: ['DisplayName'],
          }],
        },
        Note: {
          fields: ['Owner', 'Body'],
          relations: { Owner: { entity: 'Account' } },
          grants: [{ principal: ['Owner'], operations: ['read', 'create', 'delete'] }, {
            principal: ['Owner'],
            operations: ['update'],
            updateFields: ['Body'],
          }],
        },
      },
    },
  })
  const checkpointPaths = new Set<string>()
  const connections: TR.DataConnection[] = []
  let nextPoll: (() => void) | undefined
  const test = {
    online: true,
    nativeVault: false,
    storageFailed: false,
    storageLimit: 16 * 1024 * 1024,
    failDataRead: false,
    beforePost: undefined as (() => Promise<void>) | undefined,
    beforeStorage: undefined as (() => Promise<void>) | undefined,
    acquireCheckpoint: undefined as ReferenceHost['acquireCheckpoint'],
    vault: new Map<string, string>(),
    poll() {
      const run = nextPoll
      nextPoll = undefined
      run?.()
    },
    async persisted() {
      return (await Promise.all([...checkpointPaths].map(path => FS.readText(path)))).join('\n')
    },
    async coldProcess(session: AccountProtocol.Session): Promise<{ offline: { state: string }; snapshot: string }> {
      const input = FS.resolvePath('offline-process.json', root)
      const output = FS.resolvePath('offline-process-result.json', root)
      await FS.writeJson(input, {
        accountId: session.accountId,
        configuration: {
          ServerURL: server.url,
          Resource: 'notes',
          Offline: [{ entity: 'Note', field: 'Owner', actor: 'account' }],
        },
        root,
        schema,
        storageKey: JSON.stringify(['notes', session.accountId]),
        vault: Object.fromEntries(test.vault),
      })
      const result = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [
          'run',
          Repo.resolvePath(
            'packages/services/account-server/account-server-tests/fixtures/reference-offline-process.ts',
          ),
          input,
          output,
        ],
        stdio: 'pipe',
      })
      if (result.exitCode !== 0) {
        Errors.throwHostEnvironment(`Offline recovery process failed: ${result.stderr}`)
      }
      return await FS.readJson(output)
    },
    async evict() {
      for (const path of checkpointPaths) {
        await FS.remove(path)
      }
      checkpointPaths.clear()
    },
    transferNote(id: string, owner: string) {
      server.seed([{ entity: 'Note', id, fields: { Owner: owner, Body: 'previous server content' } }])
    },
    async signIn(name: string, register = false): Promise<AccountProtocol.Session> {
      const response = await fetch(`${server.url}/v1/auth/${register ? 'sign-up' : 'sign-in'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `${name}@example.test`, password: 'a-good-password', resource: 'notes' }),
      })
      Expect(response.status).toBe(200)
      return await response.json() as AccountProtocol.Session
    },
    async serverRows(session: AccountProtocol.Session): Promise<AccountProtocol.Snapshot> {
      const response = await fetch(`${server.url}/v1/data`, { headers: { authorization: `Bearer ${session.token}` } })
      Expect(response.status).toBe(200)
      return await response.json() as AccountProtocol.Snapshot
    },
    async serverWrite(session: AccountProtocol.Session, operations: AccountProtocol.Operation[]) {
      const response = await fetch(`${server.url}/v1/data/transactions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ operationId: Platform.randomUUID(), operations }),
      })
      Expect(response.status).toBe(200)
    },
    connect(session: AccountProtocol.Session, controller = new AbortController()) {
      const host: ReferenceHost = {
        ...(test.acquireCheckpoint === undefined ? {} : { acquireCheckpoint: test.acquireCheckpoint }),
        operationId: () => Platform.randomUUID(),
        request: async (input, options) => {
          if (!test.online) {
            Errors.throwHostEnvironment('Test network is offline.')
          }
          if (test.failDataRead && String(input).endsWith('/v1/data')) {
            Errors.throwHostEnvironment('Test initial fill is offline.')
          }
          if (options?.method === 'POST') {
            await test.beforePost?.()
          }
          return await fetch(input, options)
        },
        schedule: callback => {
          nextPoll = callback
          return () => {
            if (nextPoll === callback) {
              nextPoll = undefined
            }
          }
        },
        secureStorage: () =>
          test.nativeVault
            ? {
              getItem: key => Promise.resolve(test.vault.get(key) ?? null),
              setItem: (key, value) => {
                test.vault.set(key, value)
                return Promise.resolve()
              },
              removeItem: key => {
                test.vault.delete(key)
                return Promise.resolve()
              },
            }
            : undefined,
        storage: () => ({
          getItem: async key => {
            const path = FS.resolvePath(Platform.sha256Hex(key), root)
            return await FS.isFile(path) ? await FS.readText(path) : null
          },
          setItem: async (key, value) => {
            await test.beforeStorage?.()
            if (test.storageFailed) {
              Errors.throwHostEnvironment('Reference test storage is full.')
            }
            const path = FS.resolvePath(Platform.sha256Hex(key), root)
            await FS.writeText(path, value)
            checkpointPaths.add(path)
          },
        }),
      }
      const connection = ReferenceProvider(host).connect({
        auth: {
          accountId: session.accountId,
          generation: 1,
          signal: controller.signal,
          credential: () => Promise.resolve({ audience: 'notes', value: session.token }),
        },
        configuration: {
          ServerURL: server.url,
          Resource: 'notes',
          StorageLimitBytes: test.storageLimit,
          Offline: [{ entity: 'Note', field: 'Owner', actor: 'account' }],
        },
        schema,
        storageKey: JSON.stringify(['notes', session.accountId]),
      })
      connections.push(connection)
      return connection
    },
    async stop() {
      for (const connection of connections) {
        connection.close?.()
        await connection.invalidateAuth?.()
      }
      await server.stop()
      await FS.remove(root)
    },
  }
  return test
}
