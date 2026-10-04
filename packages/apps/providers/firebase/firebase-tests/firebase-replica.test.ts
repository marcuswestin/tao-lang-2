import type TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import type { FirebaseClient } from '../firebase-src/firebase-client'
import { createFirebaseReplicaOpener, type FirebaseReplicaDependencies } from '../firebase-src/firebase-replica'

const schema: TR.DataSchemaDefinition = {
  name: 'PrivateNotes',
  entities: {
    Account: { collection: 'accounts', fields: { Name: { kind: 'text', optional: true } } },
    Note: { collection: 'notes', fields: { Body: { kind: 'text' } } },
  },
}

let projectNumber = 0
function fixture(cancelled?: Promise<void>) {
  const projectId = `replica-lease-test-${++projectNumber}`
  const client = { app: { options: { projectId } } } as FirebaseClient
  const started: string[] = []
  const stopped: string[] = []
  const dependencies: FirebaseReplicaDependencies = {
    storage: getRxStorageMemory,
    replicate(_client, _rows, path) {
      started.push(path)
      return {
        async cancel() {
          await cancelled
          stopped.push(path)
        },
        onError() {
          return { unsubscribe() {} }
        },
      }
    },
  }
  return { client, open: createFirebaseReplicaOpener(dependencies), started, stopped }
}

Describe('Firebase RxDB replica leases', () => {
  Test('two same-account mounts share one real database and release it only after both close', async () => {
    const fake = fixture()
    const [first, second] = await Promise.all([
      fake.open(fake.client, schema, 'private-notes', 'alice'),
      fake.open(fake.client, schema, 'private-notes', 'alice'),
    ])
    Expect(fake.started).toEqual([
      'users/alice/stores/s_private-notes/Account',
      'users/alice/stores/s_private-notes/Note',
    ])
    Expect((await first.rows())['Account']).toEqual([{ Id: 'alice', Name: null }])
    await first.upsert('Note', { Id: 'n-1', Body: 'shared' })
    Expect((await second.rows())['Note']).toEqual([{ Id: 'n-1', Body: 'shared' }])
    await first.close()
    Expect(fake.stopped).toEqual([])
    Expect((await second.rows())['Note']).toEqual([{ Id: 'n-1', Body: 'shared' }])
    await second.close()
    Expect(fake.stopped).toHaveLength(2)
    const reopened = await fake.open(fake.client, schema, 'private-notes', 'alice')
    Expect(fake.started).toHaveLength(4)
    await reopened.close()
  })

  Test('a quick same-account rebind waits for the old database to close', async () => {
    const releaseCancel = Deferred()
    const fake = fixture(releaseCancel.promise)
    const first = await fake.open(fake.client, schema, 'private-notes', 'alice')
    const closing = first.close()
    const reopening = fake.open(fake.client, schema, 'private-notes', 'alice')
    await Promise.resolve()
    Expect(fake.started).toHaveLength(2)
    releaseCancel.resolve()
    await closing
    const second = await reopening
    Expect(fake.started).toHaveLength(4)
    await second.close()
  })

  Test('different accounts open independent databases and incompatible schemas cannot share one', async () => {
    const fake = fixture()
    const alice = await fake.open(fake.client, schema, 'private-notes', 'alice')
    const bob = await fake.open(fake.client, schema, 'private-notes', 'bob')
    Expect((await bob.rows())['Account']).toEqual([{ Id: 'bob', Name: null }])
    Expect(fake.started).toHaveLength(4)
    const incompatible: TR.DataSchemaDefinition = {
      ...schema,
      entities: {
        ...schema.entities,
        Note: { collection: 'notes', fields: { Body: { kind: 'number' } } },
      },
    }
    await Expect(fake.open(fake.client, incompatible, 'private-notes', 'alice')).rejects.toThrow('same schema')
    Expect((await alice.rows())['Account']).toEqual([{ Id: 'alice', Name: null }])
    await alice.close()
    await bob.close()
  })
})
