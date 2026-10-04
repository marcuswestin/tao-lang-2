import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type TR from '@runtime/TR'
import { Errors } from '@shared/core'
import { collection } from 'firebase/firestore'
import { createRxDatabase, type RxCollection, type RxDatabase, type RxStorage } from 'rxdb'
import { replicateFirestore } from 'rxdb/plugins/replication-firestore'
import type { FirebaseClient } from './firebase-client'
import { accountDatabaseName, firestoreEntityPath } from './firebase-config'
import { firebaseRxStorage } from './firebase-platform'
import { FirebaseReplicaLeases } from './firebase-replica-leases'
import { emptyAccount, type FirebaseRow, firebaseRowSchema } from './firebase-schema'

export type FirebaseReplica = Readonly<{
  rows(): Promise<Record<string, FirebaseRow[]>>
  upsert(entity: string, row: FirebaseRow): Promise<void>
  remove(entity: string, id: string): Promise<void>
  subscribe(listener: () => void, error: (error: unknown) => void): () => void
  close(): Promise<void>
}>

type Subscription = { unsubscribe(): void }

type Replication = Readonly<{
  cancel(): Promise<unknown>
  onError(listener: (error: unknown) => void): Subscription
}>

export type FirebaseReplicaDependencies = Readonly<{
  storage(): RxStorage<unknown, unknown>
  replicate(client: FirebaseClient, rows: RxCollection<FirebaseRow>, path: string, identifier: string): Replication
}>

const defaultDependencies: FirebaseReplicaDependencies = {
  storage: firebaseRxStorage,
  replicate(client, rows, path, identifier) {
    const remote = collection(client.firestore, path)
    const state = replicateFirestore({
      replicationIdentifier: identifier,
      collection: rows,
      firestore: { projectId: client.app.options.projectId!, database: client.firestore, collection: remote },
      pull: {},
      push: {},
      live: true,
    })
    return { cancel: () => state.cancel(), onError: listener => state.error$.subscribe(listener) }
  },
}

/** The production opener shares a database; tests replace only storage and remote transport. */
export function createFirebaseReplicaOpener(dependencies: FirebaseReplicaDependencies = defaultDependencies) {
  const leases = new FirebaseReplicaLeases()
  return (client: FirebaseClient, definition: TR.DataSchemaDefinition, storeKey: string, uid: string) => {
    const projectId = client.app.options.projectId!
    const name = accountDatabaseName(projectId, storeKey, uid)
    const signature = JSON.stringify([
      definition.schemaVersion ?? 1,
      Object.entries(definition.entities).map(([entity, fields]) => [entity, firebaseRowSchema(fields)]),
    ])
    return leases.acquire(name, signature, () => createFirebaseReplica(dependencies, client, definition, storeKey, uid))
  }
}

export const openFirebaseReplica = createFirebaseReplicaOpener()

/** Persist each account's RxDB collections before starting their live Firestore replications. */
async function createFirebaseReplica(
  dependencies: FirebaseReplicaDependencies,
  client: FirebaseClient,
  definition: TR.DataSchemaDefinition,
  storeKey: string,
  uid: string,
): Promise<FirebaseReplica> {
  const database: RxDatabase<Record<string, RxCollection<FirebaseRow>>> = await createRxDatabase({
    name: accountDatabaseName(client.app.options.projectId!, storeKey, uid),
    storage: dependencies.storage(),
    multiInstance: false,
    // Hermes lacks Web Crypto; RxDB's default hash calls crypto.subtle.digest.
    hashFunction: async input =>
      bytesToHex(sha256(
        typeof input === 'string'
          ? utf8ToBytes(input)
          : new Uint8Array(input instanceof ArrayBuffer ? input : await input.arrayBuffer()),
      )),
  })
  const replications: Replication[] = []
  const subscriptions: Subscription[] = []
  let closed = false
  try {
    await database.addCollections(Object.fromEntries(
      Object.entries(definition.entities).map(([name, entity]) => [
        name,
        { schema: firebaseRowSchema(entity) },
      ]),
    ))
    const account = database.collections['Account']!
    if (await account.findOne(uid).exec() === null) {
      await account.incrementalUpsert(emptyAccount(uid, definition.entities['Account']!))
    }
    for (const name of Object.keys(definition.entities)) {
      const rows = database.collections[name]!
      const replication = dependencies.replicate(
        client,
        rows,
        firestoreEntityPath(uid, storeKey, name),
        `${client.app.options.projectId}/${storeKey}/${uid}/${name}`,
      )
      replications.push(replication)
    }
  } catch (error) {
    await Promise.allSettled(replications.map(replication => replication.cancel()))
    await database.close()
    Errors.throwHostEnvironment('Firebase local data initialization failed.', { cause: error })
  }

  const requireCollection = (name: string): RxCollection<FirebaseRow> => database.collections[name]!
  return {
    async rows() {
      return Object.fromEntries(
        await Promise.all(
          Object.keys(definition.entities).map(async name => [
            name,
            (await requireCollection(name).find().exec()).map(row => row.toJSON() as FirebaseRow),
          ]),
        ),
      )
    },
    async upsert(entity, row) {
      await requireCollection(entity).incrementalUpsert(row)
    },
    async remove(entity, id) {
      const row = await requireCollection(entity).findOne(id).exec()
      await row?.remove()
    },
    subscribe(listener, error) {
      if (closed) {
        return () => undefined
      }
      const own = Object.keys(definition.entities).map(name =>
        requireCollection(name).find().$.subscribe({ next: listener, error })
      )
      const remote = replications.map(replication => replication.onError(error))
      subscriptions.push(...own, ...remote)
      return () => {
        for (const subscription of [...own, ...remote]) {
          subscription.unsubscribe()
          const index = subscriptions.indexOf(subscription)
          if (index >= 0) {
            subscriptions.splice(index, 1)
          }
        }
      }
    },
    async close() {
      if (closed) {
        return
      }
      closed = true
      subscriptions.splice(0).forEach(subscription => subscription.unsubscribe())
      await Promise.allSettled(replications.map(replication => replication.cancel()))
      await database.close()
    },
  }
}
