import type TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import type { Auth } from 'firebase/auth'
import { FirebaseProvider } from '../firebase-src/Firebase'
import type { FirebaseClient } from '../firebase-src/firebase-client'
import { accountDatabaseName, firebaseConfig, firestoreEntityPath } from '../firebase-src/firebase-config'
import type { FirebaseReplica } from '../firebase-src/firebase-replica'
import { type FirebaseRow, validateFirebaseSchema } from '../firebase-src/firebase-schema'

const schema: TR.DataSchemaDefinition = {
  name: 'PrivateNotes',
  entities: {
    Account: { collection: 'accounts', fields: { Name: { kind: 'text', optional: true } } },
    Note: { collection: 'notes', fields: { Body: { kind: 'text' }, Done: { kind: 'boolean' } } },
  },
}
const configuration = { ApiKey: 'public-key', ProjectId: 'project-one', StorageKey: 'private notes' }
const signal = () => new AbortController().signal

function fixture() {
  const auth = { currentUser: { uid: 'alice' } as Auth['currentUser'], authStateReady: async () => undefined }
  const client = { auth: auth as Auth, app: { options: { projectId: 'project-one' } } } as FirebaseClient
  const accounts = new Map<string, Record<string, FirebaseRow[]>>()
  const listeners = new Map<string, Set<() => void>>()
  const lateCallbacks = new Map<string, () => void>()
  const closed: string[] = []
  const reads: string[] = []
  const writes: string[] = []
  const open = async (
    _client: FirebaseClient,
    _schema: TR.DataSchemaDefinition,
    store: string,
    uid: string,
  ): Promise<FirebaseReplica> => {
    const key = `${store}/${uid}`
    const rows = accounts.get(key) ?? { Account: [{ Id: uid, Name: null }], Note: [] }
    accounts.set(key, rows)
    const callbacks = listeners.get(key) ?? new Set<() => void>()
    listeners.set(key, callbacks)
    return {
      rows: async () => {
        reads.push(key)
        return Object.fromEntries(Object.entries(rows).map(([entity, values]) => [entity, [...values]]))
      },
      async upsert(entity, row) {
        writes.push(`${key}/${entity}/${row.Id}`)
        rows[entity] = [...(rows[entity] ?? []).filter(previous => previous.Id !== row.Id), row]
        callbacks.forEach(callback => callback())
      },
      async remove(entity, id) {
        writes.push(`${key}/${entity}/${id}:delete`)
        rows[entity] = (rows[entity] ?? []).filter(row => row.Id !== id)
        callbacks.forEach(callback => callback())
      },
      subscribe(callback) {
        callbacks.add(callback)
        lateCallbacks.set(key, callback)
        return () => {
          callbacks.delete(callback)
        }
      },
      async close() {
        closed.push(key)
      },
    }
  }
  const provider = FirebaseProvider(open, () => client)
  const context = (uid: string, controller: AbortController): TR.DataProviderContext => ({
    configuration,
    schema,
    storageKey: JSON.stringify(['private notes', uid]),
    auth: { accountId: uid, generation: 1, signal: controller.signal, credential: async () => '' },
  })
  return { accounts, auth, client, closed, context, lateCallbacks, listeners, open, provider, reads, writes }
}

Describe('Firebase datasource', () => {
  Test('resolves Account from a matching local Firebase session without an online request', async () => {
    const fake = fixture()
    const context: TR.DataAuthenticationContext = {
      configuration,
      schema,
      principal: { issuer: 'firebase:project-one', subject: 'alice' },
      provider: 'FirebaseAuth',
      signal: signal(),
      proof: async () =>
        ({
          kind: 'Session',
          issuer: 'firebase:project-one',
          subject: 'alice',
          value: { projectId: 'project-one', uid: 'alice' },
          provider: 'FirebaseAuth',
        }) as never,
    }
    Expect(await fake.provider.authenticate?.(context)).toEqual({ accountId: 'alice' })
  })

  Test('persists scalar row operations per account and projects incoming replica changes', async () => {
    const fake = fixture()
    const alice = new AbortController()
    const connection = fake.provider.connect(fake.context('alice', alice))
    const first = await connection.load()
    Expect(JSON.parse(first!).rows).toEqual({ Account: [{ Id: 'alice', Name: null }], Note: [] })
    const incoming: string[] = []
    connection.subscribe?.({
      snapshot: snapshot => incoming.push(snapshot!),
      error: error => {
        throw error
      },
    })
    const next = JSON.stringify({
      formatVersion: 1,
      schemaVersion: 1,
      nextId: 2,
      rows: { Account: [{ Id: 'alice', Name: null }], Note: [{ Id: 'note-a', Body: 'one', Done: false }] },
    })
    await connection.save(next, [], { previousSnapshot: first! })
    Expect(fake.writes).toEqual(['private notes/alice/Note/note-a'])
    Expect(fake.accounts.get('private notes/alice')!['Note']).toEqual([{ Id: 'note-a', Body: 'one', Done: false }])
    const second = fake.provider.connect(fake.context('alice', new AbortController()))
    Expect(JSON.parse((await second.load())!).rows.Note).toEqual([{ Id: 'note-a', Body: 'one', Done: false }])
    await second.save(
      JSON.stringify({
        formatVersion: 1,
        schemaVersion: 1,
        nextId: 2,
        rows: { Account: [{ Id: 'alice', Name: null }], Note: [{ Id: 'note-a', Body: 'two', Done: true }] },
      }),
      [],
      { previousSnapshot: next },
    )
    await Promise.resolve()
    Expect(incoming.some(snapshot => JSON.parse(snapshot).rows.Note[0]?.Body === 'two')).toBe(true)
    await second.save(
      JSON.stringify({
        formatVersion: 1,
        schemaVersion: 1,
        nextId: 2,
        rows: { Account: [{ Id: 'alice', Name: null }], Note: [] },
      }),
      [],
      {
        previousSnapshot: JSON.stringify({
          formatVersion: 1,
          schemaVersion: 1,
          nextId: 2,
          rows: { Account: [{ Id: 'alice', Name: null }], Note: [{ Id: 'note-a', Body: 'two', Done: true }] },
        }),
      },
    )
    Expect(fake.writes.at(-1)).toBe('private notes/alice/Note/note-a:delete')
    Expect(fake.accounts.get('private notes/alice')!['Note']).toEqual([])
    connection.close?.()
    second.close?.()
  })

  Test('account invalidation closes the replica and ignores late callbacks from the old account', async () => {
    const fake = fixture()
    const alice = new AbortController()
    const connection = fake.provider.connect(fake.context('alice', alice))
    await connection.load()
    const incoming: string[] = []
    connection.subscribe?.({
      snapshot: snapshot => incoming.push(snapshot!),
      error: error => {
        throw error
      },
    })
    alice.abort()
    await connection.invalidateAuth?.()
    const readsBeforeLateCallback = fake.reads.length
    fake.lateCallbacks.get('private notes/alice')?.()
    await Promise.resolve()
    Expect(fake.closed).toEqual(['private notes/alice'])
    Expect(incoming).toEqual([])
    Expect(fake.reads.length).toBe(readsBeforeLateCallback)
    fake.auth.currentUser = { uid: 'bob' } as Auth['currentUser']
    const bob = fake.provider.connect(fake.context('bob', new AbortController()))
    Expect(JSON.parse((await bob.load())!).rows.Note).toEqual([])
    Expect(fake.accounts.has('private notes/bob')).toBe(true)
    bob.close?.()
  })

  Test('invalidation during replica opening closes the late replica before it can publish', async () => {
    const fake = fixture()
    const held = Deferred<FirebaseReplica>()
    const provider = FirebaseProvider(async () => held.promise, () => fake.client)
    const controller = new AbortController()
    const connection = provider.connect(fake.context('alice', controller))
    const loading = connection.load()
    await Promise.resolve()
    controller.abort()
    const source = await fake.open(fake.client, schema, 'private notes', 'alice')
    held.resolve(source)
    await Expect(loading).rejects.toThrow()
    await connection.invalidateAuth?.()
    Expect(fake.closed).toEqual(['private notes/alice'])
  })

  Test('uses a single Firestore path segment and distinct durable database names', () => {
    Expect(firestoreEntityPath('alice', 'private notes', 'Note')).toBe('users/alice/stores/s_private%20notes/Note')
    Expect(accountDatabaseName('project-one', 'private notes', 'alice'))
      .not.toBe(accountDatabaseName('project-one', 'private notes', 'bob'))
  })

  Test('rejects a starter placeholder before initializing Firebase', () => {
    Expect(() =>
      firebaseConfig({
        ApiKey: 'REPLACE_WITH_FIREBASE_API_KEY',
        ProjectId: 'REPLACE_WITH_FIREBASE_PROJECT_ID',
      })
    ).toThrow('Run tao connect firebase <project>')
  })

  Test('rejects grants and remote relations outside the private account path contract', () => {
    const withGrant: TR.DataSchemaDefinition = {
      ...schema,
      entities: {
        ...schema.entities,
        Note: {
          ...schema.entities['Note']!,
          grants: [{ operations: ['read'], principal: ['Account'] }],
        },
      },
    }
    Expect(() => validateFirebaseSchema(withGrant)).toThrow('cannot enforce authored access grants')
    const withRelation: TR.DataSchemaDefinition = {
      ...schema,
      entities: {
        ...schema.entities,
        Note: {
          ...schema.entities['Note']!,
          fields: {
            ...schema.entities['Note']!.fields,
            Other: { kind: 'relation', relation: 'Note' },
          },
        },
      },
    }
    Expect(() => validateFirebaseSchema(withRelation)).toThrow('only supports a relation to Account')
  })
})
