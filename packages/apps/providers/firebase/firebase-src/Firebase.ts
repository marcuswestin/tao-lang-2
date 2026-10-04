import TR from '@runtime/TR'
import { Assert, Errors, Switch } from '@shared/core'
import { type FirebaseClient, firebaseClient } from './firebase-client'
import { authenticatedStoreKey, firebaseConfig } from './firebase-config'
import { type FirebaseReplica, openFirebaseReplica } from './firebase-replica'
import { type FirebaseRow, validateFirebaseSchema } from './firebase-schema'

type OpenReplica = (
  client: FirebaseClient,
  definition: TR.DataSchemaDefinition,
  storeKey: string,
  uid: string,
) => Promise<FirebaseReplica>

type Snapshot = Readonly<{
  formatVersion: number
  nextId: number
  rows: Record<string, FirebaseRow[]>
  schemaVersion: number
}>

function rowsOf(snapshot: string): Snapshot {
  const value = JSON.parse(snapshot) as Snapshot
  Assert.defined(value.rows, 'the runtime passes a complete Firebase data snapshot')
  return value
}

function project(definition: TR.DataSchemaDefinition, rows: Record<string, FirebaseRow[]>, nextId: number): string {
  return JSON.stringify({
    formatVersion: 1,
    schemaVersion: definition.schemaVersion ?? 1,
    nextId,
    rows: Object.fromEntries(
      Object.keys(definition.entities).map(name => [
        name,
        (rows[name] ?? []).sort((left, right) => left.Id.localeCompare(right.Id)),
      ]),
    ),
  })
}

function cancelled(auth: TR.DataAuthBinding | undefined, closed: boolean): boolean {
  return closed || auth?.signal.aborted === true
}

/** Account-scoped, durable RxDB replicas with live Firestore row synchronization. */
export function FirebaseProvider(
  openReplica: OpenReplica = openFirebaseReplica,
  loadClient: (config: ReturnType<typeof firebaseConfig>) => FirebaseClient = firebaseClient,
): TR.DataProvider {
  return {
    testNetwork: 'remote',
    async authenticate(context) {
      Assert.input(context.provider === 'FirebaseAuth', 'Firebase accepts Session proofs from FirebaseAuth.')
      const config = firebaseConfig(context.configuration)
      validateFirebaseSchema(context.schema)
      const proof = await context.proof('Session', context.signal)
      Assert.input(
        proof.value['projectId'] === config.projectId && proof.value['uid'] === proof.subject
          && proof.issuer === `firebase:${config.projectId}`
          && proof.subject === context.principal.subject,
        'FirebaseAuth and Firebase must use the same project and signed-in account.',
      )
      const client = loadClient(config)
      await client.auth.authStateReady()
      if (context.signal.aborted) {
        throw Errors.abortError('Account data access ended.')
      }
      Assert.input(
        client.auth.currentUser?.uid === proof.subject,
        'Firebase session changed. Sign in again to access account data.',
      )
      return { accountId: proof.subject }
    },
    connect(context) {
      const config = firebaseConfig(context.configuration)
      validateFirebaseSchema(context.schema)
      Assert.input(context.auth !== undefined, 'Firebase requires an authenticated account.')
      const auth = context.auth
      const storeKey = authenticatedStoreKey(context.storageKey, auth.accountId)
      const client = loadClient(config)
      let closed = false
      let replica: FirebaseReplica | undefined
      let opening: Promise<FirebaseReplica> | undefined
      let closing: Promise<void> | undefined
      let stopRows: (() => void) | undefined
      let observer: TR.DataConnectionObserver | undefined
      let replay: string | undefined
      let view: string | undefined
      let nextId = 1
      let saving = false
      let dirty = false
      let publication = 0

      const ensureSession = async (): Promise<void> => {
        if (cancelled(auth, closed)) {
          throw Errors.abortError('Account data access ended.')
        }
        await client.auth.authStateReady()
        if (cancelled(auth, closed)) {
          throw Errors.abortError('Account data access ended.')
        }
        Assert.input(
          client.auth.currentUser?.uid === auth.accountId,
          'Firebase session changed. Sign in again to access account data.',
        )
      }
      const publish = async (source: FirebaseReplica, revision: number): Promise<void> => {
        try {
          const snapshot = project(context.schema, await source.rows(), nextId)
          if (cancelled(auth, closed) || revision !== publication) {
            return
          }
          if (snapshot !== view) {
            view = snapshot
            if (observer) {
              observer.snapshot(snapshot)
            } else {
              replay = snapshot
            }
          }
        } catch (error) {
          if (!cancelled(auth, closed)) {
            observer?.error(new Errors.HostEnvironmentError('Firebase data subscription failed.', { cause: error }))
          }
        }
      }
      const changed = (source: FirebaseReplica): void => {
        if (cancelled(auth, closed)) {
          return
        }
        if (saving) {
          dirty = true
          return
        }
        void publish(source, ++publication)
      }
      const open = async (): Promise<FirebaseReplica> => {
        if (opening) {
          return opening
        }
        opening = (async () => {
          await ensureSession()
          const source = await openReplica(client, context.schema, storeKey, auth.accountId)
          if (cancelled(auth, closed)) {
            await source.close()
            throw Errors.abortError('Account data access ended.')
          }
          replica = source
          stopRows = source.subscribe(() => changed(source), error => {
            if (!cancelled(auth, closed)) {
              observer?.error(new Errors.HostEnvironmentError('Firebase replication failed.', { cause: error }))
            }
          })
          return source
        })()
        return opening
      }
      const invalidate = (): Promise<void> => {
        if (closing) {
          return closing
        }
        closed = true
        observer = undefined
        replay = undefined
        stopRows?.()
        stopRows = undefined
        stopInvalidation?.()
        closing = Promise.resolve(opening).then(async () => {
          await replica?.close()
        }, () => undefined)
        return closing
      }
      const stopInvalidation = auth.onInvalidate?.(invalidate)

      return {
        close() {
          void invalidate().catch(() => undefined)
        },
        invalidateAuth: invalidate,
        async load() {
          const source = await open()
          await ensureSession()
          const snapshot = project(context.schema, await source.rows(), nextId)
          view = snapshot
          replay = undefined
          return snapshot
        },
        async save(snapshot, intents = [], writeContext) {
          await ensureSession()
          const source = await open()
          const previous = writeContext?.previousSnapshot ?? view
          const next = rowsOf(snapshot)
          const operations = TR.DataRows.rowOperations(context.schema, previous, snapshot, intents)
          nextId = Math.max(nextId, next.nextId)
          saving = true
          try {
            for (const operation of operations) {
              await ensureSession()
              await Switch.on(operation, 'kind', {
                delete: deleted => source.remove(deleted.entity, deleted.id),
                link: linked => {
                  const row = next.rows[linked.entity]?.find(row => row.Id === linked.id)
                  Assert.defined(row, 'a linked Firebase row exists in the next snapshot')
                  return source.upsert(linked.entity, row)
                },
                unlink: unlinked => {
                  const row = next.rows[unlinked.entity]?.find(row => row.Id === unlinked.id)
                  Assert.defined(row, 'an unlinked Firebase row exists in the next snapshot')
                  return source.upsert(unlinked.entity, row)
                },
                update: updated => {
                  const row = next.rows[updated.entity]?.find(row => row.Id === updated.id)
                  Assert.defined(row, 'an updated Firebase row exists in the next snapshot')
                  return source.upsert(updated.entity, row)
                },
              })
            }
            view = snapshot
          } catch (error) {
            Errors.throwHostEnvironment('Firebase local save failed.', { cause: error })
          } finally {
            saving = false
            if (dirty) {
              dirty = false
              changed(source)
            }
          }
        },
        subscribe(next) {
          observer = next
          if (replay !== undefined) {
            next.snapshot(replay)
            replay = undefined
          }
          return () => {
            if (observer === next) {
              observer = undefined
            }
          }
        },
      }
    },
  }
}
