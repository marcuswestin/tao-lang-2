import TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test, until } from '@shared/test'
import type { Auth } from 'firebase/auth'
import { createRxDatabase, type RxCollection } from 'rxdb'
import { replicateRxCollection, type RxReplicationState } from 'rxdb/plugins/replication'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { FirebaseProvider } from '../firebase-src/Firebase'
import type { FirebaseClient } from '../firebase-src/firebase-client'
import { accountDatabaseName } from '../firebase-src/firebase-config'
import { createFirebaseReplicaOpener, type FirebaseReplicaDependencies } from '../firebase-src/firebase-replica'
import { validateFirebaseReplication } from '../firebase-src/firebase-replication-validation'
import {
  emptyAccount,
  type FirebaseRow,
  firebaseRowSchema,
  repairFirebaseAccount,
  validateFirebaseRow,
} from '../firebase-src/firebase-schema'

const definition: TR.DataSchemaDefinition = {
  name: 'AccountNotes',
  entities: {
    Account: {
      collection: 'accounts',
      fields: { DisplayName: { kind: 'text', defaultValue: '' }, Bio: { kind: 'text', optional: true } },
    },
    Note: { collection: 'notes', fields: { Body: { kind: 'text' }, Done: { kind: 'boolean' } } },
  },
}

let fixtureId = 0
function fixture() {
  const projectId = `firebase-account-test-${++fixtureId}`
  const storage = getRxStorageMemory()
  const auth = { currentUser: { uid: 'alice' } as Auth['currentUser'], authStateReady: async () => undefined }
  const client = { auth: auth as Auth, app: { options: { projectId } } } as FirebaseClient
  const collections = new Map<string, RxCollection<FirebaseRow>>()
  const states = new Map<string, RxReplicationState<FirebaseRow, number>>()
  const remote = new Map<string, Map<string, FirebaseRow>>()
  const versions = new Map<string, Map<string, number>>()
  const pushes: Array<{ path: string; row: FirebaseRow }> = []
  let version = 0
  const wire = (row: FirebaseRow): FirebaseRow & { _deleted: boolean } => ({
    ...Object.fromEntries(
      Object.entries(row).filter(([key]) => !['_attachments', '_meta', '_rev', '_deleted'].includes(key)),
    ),
    Id: row.Id,
    _deleted: row['_deleted'] === true,
  })
  const put = (path: string, row: FirebaseRow) => {
    const rows = remote.get(path) ?? new Map<string, FirebaseRow>()
    rows.set(row.Id, wire(row))
    remote.set(path, rows)
    const revisions = versions.get(path) ?? new Map<string, number>()
    revisions.set(row.Id, ++version)
    versions.set(path, revisions)
  }
  const dependencies: FirebaseReplicaDependencies = {
    storage: () => storage,
    replicate(_client, collection, path, identifier, modifiers) {
      collections.set(path, collection)
      const state = replicateRxCollection<FirebaseRow, number>({
        replicationIdentifier: identifier,
        collection,
        waitForLeadership: false,
        live: true,
        pull: {
          async handler(checkpoint = 0) {
            return {
              documents: [...(remote.get(path)?.values() ?? [])].filter(row =>
                (versions.get(path)?.get(row.Id) ?? 0) > checkpoint
              ).map(wire),
              checkpoint: version,
            }
          },
        },
        push: {
          async handler(writes) {
            const conflicts: FirebaseRow[] = []
            for (const write of writes) {
              const previous = remote.get(path)?.get(write.newDocumentState.Id)
              if (
                previous
                && (!write.assumedMasterState
                  || Object.keys(previous).some(key => previous[key] !== wire(write.assumedMasterState!)[key]))
              ) {
                conflicts.push(previous)
              } else {
                pushes.push({ path, row: write.newDocumentState })
                put(path, write.newDocumentState)
              }
            }
            return conflicts.map(wire)
          },
        },
      })
      validateFirebaseReplication(state, modifiers)
      states.set(path, state)
      return { cancel: () => state.cancel(), onError: listener => state.error$.subscribe(listener) }
    },
  }
  const open = createFirebaseReplicaOpener(dependencies)
  const provider = FirebaseProvider(open, () => client)
  const path = (uid: string, entity: string) => `users/${uid}/stores/s_notes/${entity}`
  return {
    auth,
    client,
    projectId,
    provider,
    collections,
    open,
    path,
    pushes,
    remote,
    states,
    incoming(uid: string, entity: string, row: FirebaseRow) {
      const target = path(uid, entity)
      put(target, row)
      // Firestore's live transport emits RESYNC, then fetches through the pull handler.
      states.get(target)!.reSync()
    },
    async seed(uid: string, account: FirebaseRow, note?: FirebaseRow) {
      const database = await createRxDatabase({
        name: accountDatabaseName(projectId, 'notes', uid),
        storage,
        multiInstance: false,
      })
      try {
        await database.addCollections(
          Object.fromEntries(
            Object.entries(definition.entities).map(([name, entity]) => [name, { schema: firebaseRowSchema(entity) }]),
          ),
        )
        await database.collections['Account']!.incrementalUpsert(account)
        if (note) {
          await database.collections['Note']!.incrementalUpsert(note)
        }
      } finally {
        await database.close()
      }
    },
    connect(uid = 'alice') {
      return provider.connect({
        configuration: { ApiKey: 'public-key', ProjectId: projectId },
        schema: definition,
        storageKey: JSON.stringify(['notes', uid]),
        auth: { accountId: uid, generation: 1, signal: new AbortController().signal, credential: async () => '' },
      })
    },
  }
}

Describe('Firebase signed-in Account lifecycle', () => {
  Test('bootstraps authored empty, zero, false, and now defaults without guessing required values', () => {
    TR.Clock.beginTest(123456)
    try {
      Expect(emptyAccount('alice', {
        collection: 'accounts',
        fields: {
          Name: { kind: 'text', defaultValue: '' },
          Count: { kind: 'number', defaultValue: 0 },
          Enabled: { kind: 'boolean', defaultValue: false },
          Started: { kind: 'time', defaultNow: true },
          Bio: { kind: 'text', optional: true },
        },
      })).toEqual({ Id: 'alice', Name: '', Count: 0, Enabled: false, Started: 123456, Bio: null })
      Expect(() => emptyAccount('alice', { collection: 'accounts', fields: { Name: { kind: 'text' } } })).toThrow(
        'Account.Name needs a declared default',
      )
      const bounded = {
        collection: 'accounts',
        fields: {
          Count: { kind: 'number' as const, defaultValue: 0 },
          Enabled: { kind: 'boolean' as const, defaultValue: false },
          Started: { kind: 'time' as const, defaultNow: true as const },
          Bio: { kind: 'text' as const, optional: true, defaultValue: 'optional default' },
        },
      }
      const repaired = repairFirebaseAccount(
        { Id: 'alice', Count: null, Enabled: null, Started: null, Bio: null },
        bounded,
      )
      Expect(repaired).toEqual({ Id: 'alice', Count: 0, Enabled: false, Started: null, Bio: null })
      Expect(() => validateFirebaseRow('Account', bounded, repaired, 'alice')).toThrow('Account.Started expects time')
    } finally {
      TR.Clock.endTest()
    }
  })

  Test(
    'authenticated runtime binding reads Account and writes private Note CRUD through the real replica',
    async () => {
      const fake = fixture()
      const catalog = TR.Data.Schema(definition)
      const source = TR.Data.Configure(TR.Data.Declaration('Firebase', fake.provider), {
        ApiKey: 'public-key',
        ProjectId: fake.projectId,
        StorageKey: 'notes',
      })
      let controller = new AbortController()
      try {
        catalog.bindConfigured(source, undefined, {
          accountId: 'alice',
          generation: 1,
          signal: controller.signal,
          credential: async () => '',
        })
        await TR.Data.Settle(catalog)
        const account = catalog.query({ entity: 'Account', filters: [] })[0]!
        Expect(TR.Data.Read(account, 'DisplayName')).toBe('')
        TR.Data.Update(TR.Value(account), { DisplayName: TR.Value('Alice') })
        await TR.Data.Settle(catalog)
        Expect(TR.Data.Read(account, 'DisplayName')).toBe('Alice')
        await until(
          () =>
            fake.pushes.some(push =>
              push.path === fake.path('alice', 'Account') && push.row['DisplayName'] === 'Alice'
            ),
          { description: 'account update reaches the real replica' },
        )
        TR.Data.Create(catalog, 'Note', { Body: TR.Value('kept'), Done: TR.Value(false) })
        Expect(catalog.captureSnapshot()).toContain('kept')
        await TR.Data.Settle(catalog)
        Expect(catalog.captureSnapshot()).toContain('kept')
        await until(() => catalog.query({ entity: 'Note', filters: [] }).length === 1, {
          description: 'authenticated runtime note becomes readable',
        })
        const note = catalog.query({ entity: 'Note', filters: [] })[0]!
        Expect(TR.Data.Read(note, 'Body')).toBe('kept')
        TR.Data.Update(TR.Value(note), { Body: TR.Value('updated') })
        await TR.Data.Settle(catalog)
        Expect(TR.Data.Read(note, 'Body')).toBe('updated')
        await until(
          () => fake.pushes.some(push => push.path === fake.path('alice', 'Note') && push.row['Body'] === 'updated'),
          { description: 'updated Alice note reaches the real replica' },
        )
        TR.Data.Create(catalog, 'Note', { Body: TR.Value('delete me'), Done: TR.Value(false) })
        await TR.Data.Settle(catalog)
        const deleted = catalog.query({ entity: 'Note', filters: [] }).find(row =>
          TR.Data.Read(row, 'Body') === 'delete me'
        )!
        await until(
          () => fake.pushes.some(push => push.path === fake.path('alice', 'Note') && push.row['Body'] === 'delete me'),
          { description: 'second Alice note reaches the real replica' },
        )
        TR.Data.Delete(TR.Value(deleted))
        await TR.Data.Settle(catalog)
        Expect(catalog.query({ entity: 'Note', filters: [] })).toHaveLength(1)
        await until(
          () => fake.pushes.some(push => push.path === fake.path('alice', 'Note') && push.row['_deleted'] === true),
          {
            description: 'runtime note deletion reaches the real replica',
          },
        )

        controller.abort()
        Expect(catalog.query({ entity: 'Account', filters: [] })).toHaveLength(0)
        Expect(() => TR.Data.Create(catalog, 'Note', { Body: TR.Value('late'), Done: TR.Value(false) })).toThrow(
          'permission',
        )
        await catalog.invalidateAuth()
        fake.auth.currentUser = { uid: 'bob' } as Auth['currentUser']
        controller = new AbortController()
        catalog.bindConfigured(source, undefined, {
          accountId: 'bob',
          generation: 2,
          signal: controller.signal,
          credential: async () => '',
        })
        await TR.Data.Settle(catalog)
        Expect(catalog.query({ entity: 'Note', filters: [] })).toHaveLength(0)
        const bob = catalog.query({ entity: 'Account', filters: [] })[0]!
        Expect(TR.Data.Read(bob, 'DisplayName')).toBe('')
        TR.Data.Create(catalog, 'Note', { Body: TR.Value('Bob only'), Done: TR.Value(false) })
        await TR.Data.Settle(catalog)
        await until(() =>
          fake.pushes.some(push => push.path === fake.path('bob', 'Note') && push.row['Body'] === 'Bob only')
        )
        Expect(catalog.query({ entity: 'Note', filters: [] })).toHaveLength(1)
        controller.abort()
        await catalog.invalidateAuth()
        fake.auth.currentUser = { uid: 'alice' } as Auth['currentUser']
        controller = new AbortController()
        catalog.bindConfigured(source, undefined, {
          accountId: 'alice',
          generation: 3,
          signal: controller.signal,
          credential: async () => '',
        })
        await TR.Data.Settle(catalog)
        const returned = catalog.query({ entity: 'Note', filters: [] })
        Expect(returned).toHaveLength(1)
        Expect(TR.Data.Read(returned[0]!, 'Body')).toBe('updated')
        Expect(TR.Data.Read(catalog.query({ entity: 'Account', filters: [] })[0]!, 'DisplayName')).toBe('Alice')
      } finally {
        controller.abort()
        await catalog.invalidateAuth()
      }
    },
  )

  Test(
    'repairs persisted legacy nulls and missing literals before publication, retaining note IDs across reopen',
    async () => {
      const fake = fixture()
      await fake.seed('alice', { Id: 'alice', DisplayName: null, Bio: 'original bio' }, {
        Id: 'historic-note',
        Body: 'original note',
        Done: false,
      })
      const connection = fake.connect()
      try {
        Expect(JSON.parse((await connection.load())!).rows).toEqual({
          Account: [{ Id: 'alice', DisplayName: '', Bio: 'original bio' }],
          Note: [{ Id: 'historic-note', Body: 'original note', Done: false }],
        })
      } finally {
        await connection.invalidateAuth?.()
      }
      const reopened = fake.connect()
      try {
        const snapshot = JSON.parse((await reopened.load())!)
        Expect(snapshot.rows.Account[0]).toEqual({ Id: 'alice', DisplayName: '', Bio: 'original bio' })
        Expect(snapshot.rows.Note).toEqual([{ Id: 'historic-note', Body: 'original note', Done: false }])
      } finally {
        await reopened.invalidateAuth?.()
      }
      await fake.seed('bob', { Id: 'bob', Bio: null })
      fake.auth.currentUser = { uid: 'bob' } as Auth['currentUser']
      const bob = fake.connect('bob')
      try {
        Expect(JSON.parse((await bob.load())!).rows.Account).toEqual([{ Id: 'bob', DisplayName: '', Bio: null }])
        Expect(JSON.parse((await bob.load())!).rows.Note).toEqual([])
      } finally {
        await bob.invalidateAuth?.()
      }
    },
  )

  Test('incoming legacy nulls produce durable local revisions and a repair push, never a null snapshot', async () => {
    const fake = fixture()
    const connection = fake.connect()
    const snapshots: string[] = []
    const errors: unknown[] = []
    try {
      await connection.load()
      connection.subscribe?.({ snapshot: value => snapshots.push(value!), error: error => errors.push(error) })
      await fake.states.get(fake.path('alice', 'Account'))!.awaitInSync()
      const before = fake.pushes.length
      fake.incoming('alice', 'Account', { Id: 'alice', DisplayName: null, Bio: 'remote bio' })
      await until(
        () =>
          fake.pushes.slice(before).some(push => push.row['DisplayName'] === '' && push.row['Bio'] === 'remote bio'),
        { description: 'incoming Account repaired and pushed' },
      )
      Expect(fake.remote.get(fake.path('alice', 'Account'))!.get('alice')!['DisplayName']).toBe('')
      Expect(
        (await fake.collections.get(fake.path('alice', 'Account'))!.findOne('alice').exec())!.toJSON()['DisplayName'],
      ).toBe('')
      await until(() => snapshots.some(value => JSON.parse(value).rows.Account[0].Bio === 'remote bio'))
      Expect(snapshots.every(value => JSON.parse(value).rows.Account[0].DisplayName === '')).toBe(true)
      Expect(errors).toEqual([])
    } finally {
      await connection.invalidateAuth?.()
    }
    const reopened = fake.connect()
    try {
      Expect(JSON.parse((await reopened.load())!).rows.Account).toEqual([{
        Id: 'alice',
        DisplayName: '',
        Bio: 'remote bio',
      }])
    } finally {
      await reopened.invalidateAuth?.()
    }
  })

  Test('an incremental repair preserves a concurrently populated Account name', async () => {
    const fake = fixture()
    const replica = await fake.open(fake.client, definition, 'notes', 'alice')
    const release = Deferred()
    const rows = fake.collections.get(fake.path('alice', 'Account'))!
    const queue = rows.incrementalWriteQueue
    const original = queue.addWrite
    let reached = false
    let pending = 0
    try {
      await fake.states.get(fake.path('alice', 'Account'))!.awaitInSync()
      queue.addWrite = async function(previous, modifier) {
        reached = true
        pending += 1
        try {
          await release.promise
          return await original.call(this, previous, modifier)
        } finally {
          pending -= 1
        }
      }
      fake.incoming('alice', 'Account', { Id: 'alice', DisplayName: null, Bio: 'incoming' })
      await until(() => reached, { description: 'legacy repair waiting before its incremental write' })
      const document = (await rows.findOne('alice').exec())!
      await original.call(queue, document._data, latest => ({ ...latest, DisplayName: 'concurrent name' }))
      release.resolve()
      await until(() => pending === 0, { description: 'all held Account repair writes finished' })
      Expect((await replica.rows())['Account']).toEqual([{
        Id: 'alice',
        DisplayName: 'concurrent name',
        Bio: 'incoming',
      }])
      await until(
        () => fake.remote.get(fake.path('alice', 'Account'))?.get('alice')?.['DisplayName'] === 'concurrent name',
        { description: 'concurrent Account value pushed intact' },
      )
    } finally {
      release.resolve()
      queue.addWrite = original
      await replica.close()
    }
  })

  Test('invalid required incoming values fail before replacing usable local rows', async () => {
    const fake = fixture()
    const connection = fake.connect()
    const errors: unknown[] = []
    try {
      const first = await connection.load()
      connection.subscribe?.({ snapshot() {}, error: error => errors.push(error) })
      await fake.states.get(fake.path('alice', 'Account'))!.awaitInSync()
      fake.incoming('alice', 'Note', { Id: 'bad-note', Body: null, Done: false })
      await until(() => errors.length > 0, { description: 'invalid required Note diagnostic' })
      Expect(JSON.stringify(errors)).toContain('Firebase Note.Body expects text')
      Expect(await connection.load()).toBe(first)
      await Expect(
        connection.save(
          JSON.stringify({
            formatVersion: 1,
            schemaVersion: 1,
            nextId: 2,
            rows: {
              Account: [{ Id: 'alice', DisplayName: '', Bio: null }],
              Note: [{ Id: 'invalid-write', Body: null, Done: false }],
            },
          }),
        ),
      ).rejects.toThrow('Firebase Note.Body expects text')
      Expect(JSON.parse((await connection.load())!).rows.Note).toEqual([])
      fake.incoming('alice', 'Note', { Id: 'bad-note', Body: 'corrected remote', Done: false })
      await until(async () => JSON.parse((await connection.load())!).rows.Note[0]?.Body === 'corrected remote', {
        description: 'valid remote correction resumes replication',
      })
      Expect(JSON.parse((await connection.load())!).rows.Note).toEqual([{
        Id: 'bad-note',
        Body: 'corrected remote',
        Done: false,
      }])
    } finally {
      await connection.invalidateAuth?.()
    }
  })

  Test('leases reject logical default or optional changes despite the identical physical schema', async () => {
    const fake = fixture()
    const first = await fake.open(fake.client, definition, 'notes', 'alice')
    try {
      const changed = structuredClone(definition)
      changed.entities['Account']!.fields['DisplayName']!.defaultValue = 'other'
      await Expect(fake.open(fake.client, changed, 'notes', 'alice')).rejects.toThrow('same schema')
      const optional = structuredClone(definition)
      optional.entities['Account']!.fields['DisplayName']!.optional = true
      await Expect(fake.open(fake.client, optional, 'notes', 'alice')).rejects.toThrow('same schema')
    } finally {
      await first.close()
    }
  })

  Test('omitted optional Account fields load, reopen, and remain editable through the runtime', async () => {
    const fake = fixture()
    await fake.seed('alice', { Id: 'alice', DisplayName: 'existing' })
    const connection = fake.connect()
    try {
      const catalog = TR.Data.Schema(definition, connection)
      await TR.Data.Settle(catalog)
      const account = catalog.query({ entity: 'Account', filters: [] })[0]!
      Expect(TR.Data.Read(account, 'Bio')).toBe(null)
      Expect(JSON.parse((await connection.load())!).rows.Account).toEqual([{
        Id: 'alice',
        DisplayName: 'existing',
        Bio: null,
      }])
      await fake.states.get(fake.path('alice', 'Account'))!.awaitInSync()
      fake.incoming('alice', 'Account', { Id: 'alice', DisplayName: 'remote omission' })
      await until(() => TR.Data.Read(account, 'DisplayName') === 'remote omission', {
        description: 'runtime accepted remote optional omission',
      })
      Expect(TR.Data.Read(account, 'Bio')).toBe(null)
      TR.Data.Update(TR.Value(account), { DisplayName: TR.Value('edited') })
      await TR.Data.Settle(catalog)
      await until(() => fake.remote.get(fake.path('alice', 'Account'))?.get('alice')?.['DisplayName'] === 'edited')
    } finally {
      await connection.invalidateAuth?.()
    }
    const reopened = fake.connect()
    try {
      const catalog = TR.Data.Schema(definition, reopened)
      await TR.Data.Settle(catalog)
      const account = catalog.query({ entity: 'Account', filters: [] })[0]!
      Expect(TR.Data.Read(account, 'DisplayName')).toBe('edited')
      Expect(TR.Data.Read(account, 'Bio')).toBe(null)
      TR.Data.Update(TR.Value(account), { Bio: TR.Value('after reopen') })
      await TR.Data.Settle(catalog)
      Expect(JSON.parse((await reopened.load())!).rows.Account[0].Bio).toBe('after reopen')
    } finally {
      await reopened.invalidateAuth?.()
    }
  })

  Test('extra incoming application keys are rejected without replacing usable state', async () => {
    const fake = fixture()
    const connection = fake.connect()
    const errors: unknown[] = []
    try {
      const first = await connection.load()
      connection.subscribe?.({ snapshot() {}, error: error => errors.push(error) })
      await fake.states.get(fake.path('alice', 'Account'))!.awaitInSync()
      fake.incoming('alice', 'Account', { Id: 'alice', DisplayName: 'untrusted', Bio: null, Extra: 'unknown' })
      await until(() => errors.length > 0)
      Expect(JSON.stringify(errors)).toContain("Firebase Account has unknown field 'Extra'")
      Expect(await connection.load()).toBe(first)
      fake.incoming('alice', 'Account', { Id: 'alice', DisplayName: 'corrected', Bio: null })
      await until(async () => JSON.parse((await connection.load())!).rows.Account[0].DisplayName === 'corrected')
      const before = errors.length
      fake.incoming('alice', 'Note', { Id: 'bad-metadata', Body: 'valid', Done: false, _unexpected: true })
      await until(() => errors.length > before)
      Expect(JSON.stringify(errors)).toContain("Firebase Note has unknown field '_unexpected'")
      Expect(JSON.parse((await connection.load())!).rows.Note).toEqual([])
    } finally {
      await connection.invalidateAuth?.()
    }
  })

  Test('required rows and tombstones round-trip without publishing replication metadata', async () => {
    const fake = fixture()
    const connection = fake.connect()
    try {
      const catalog = TR.Data.Schema(definition, connection)
      await TR.Data.Settle(catalog)
      TR.Data.Create(catalog, 'Note', { Body: TR.Value('round trip'), Done: TR.Value(false) })
      await TR.Data.Settle(catalog)
      const note = catalog.query({ entity: 'Note', filters: [] })[0]!
      await until(() => fake.pushes.some(push => push.row['Body'] === 'round trip' && push.row['_deleted'] === false))
      Expect(JSON.parse((await connection.load())!).rows.Note).toEqual([{
        Id: 'Note-1',
        Body: 'round trip',
        Done: false,
      }])
      TR.Data.Delete(TR.Value(note))
      await TR.Data.Settle(catalog)
      await until(() => fake.pushes.some(push => push.row.Id === 'Note-1' && push.row['_deleted'] === true))
      Expect(JSON.parse((await connection.load())!).rows.Note).toEqual([])
    } finally {
      await connection.invalidateAuth?.()
    }
    const reopened = fake.connect()
    try {
      Expect(JSON.parse((await reopened.load())!).rows.Note).toEqual([])
    } finally {
      await reopened.invalidateAuth?.()
    }
  })
})
