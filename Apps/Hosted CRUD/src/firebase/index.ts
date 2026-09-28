import { getRxStorageSQLite } from '@basepurpose/rxdb-sqlite/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { type FirebaseOptions, getApps, initializeApp } from 'firebase/app'
import * as authSdk from 'firebase/auth'
import {
  createUserWithEmailAndPassword,
  getAuth,
  initializeAuth,
  type Persistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { collection, doc, getFirestore } from 'firebase/firestore'
import { createRxDatabase, type RxCollection, type RxDatabase, type RxJsonSchema } from 'rxdb'
import { replicateFirestore } from 'rxdb/plugins/replication-firestore'
import type { CrudAdapter, CrudConnection, CrudNote, CrudStatus, CrudUser } from '../contract'
import { accountDatabaseName, firestoreNotesPath } from './scope'

export type FirebaseAdapterConfig = FirebaseOptions & { projectId: string }

type NoteRow = { id: string; text: string; done: boolean; updatedAt: number }
type NotesDatabase = RxDatabase<{ notes: RxCollection<NoteRow> }>
type Subscription = { unsubscribe(): void }

class FirebaseNotesError extends Error {}

const noteSchema: RxJsonSchema<NoteRow> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 128 },
    text: { type: 'string' },
    done: { type: 'boolean' },
    updatedAt: { type: 'number' },
  },
  required: ['id', 'text', 'done', 'updatedAt'],
  additionalProperties: false,
}

function crudUser(user: User): CrudUser {
  return { id: user.uid, email: user.email ?? '' }
}

function rowsToNotes(rows: readonly { toJSON(): NoteRow }[]): readonly CrudNote[] {
  return rows.map(row => row.toJSON()).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Firebase Auth, an account-scoped SQLite replica, and direct Firestore sync. */
export function createFirebaseAdapter(config: FirebaseAdapterConfig): CrudAdapter {
  const appName = `hosted-crud-${config.projectId}`
  const existingApp = getApps().find(app => app.name === appName)
  const app = existingApp ?? initializeApp(config, appName)
  // firebase/auth's generic declarations omit the React Native-only export.
  const nativeAuth = authSdk as typeof authSdk & {
    getReactNativePersistence(storage: typeof AsyncStorage): Persistence
  }
  const auth = existingApp
    ? getAuth(app)
    : initializeAuth(app, { persistence: nativeAuth.getReactNativePersistence(AsyncStorage) })
  const firestore = getFirestore(app)
  let activeConnection: CrudConnection | undefined

  return {
    async restore() {
      await auth.authStateReady()
      return auth.currentUser ? crudUser(auth.currentUser) : undefined
    },
    async register(email, password) {
      await activeConnection?.close()
      const credential = await createUserWithEmailAndPassword(auth, email, password)
      return crudUser(credential.user)
    },
    async signIn(email, password) {
      await activeConnection?.close()
      const credential = await signInWithEmailAndPassword(auth, email, password)
      return crudUser(credential.user)
    },
    async signOut() {
      try {
        await activeConnection?.close()
      } finally {
        await signOut(auth)
      }
    },
    async open(user, onChange) {
      await auth.authStateReady()
      if (auth.currentUser?.uid !== user.id) {
        throw new FirebaseNotesError('The requested notes account is not signed in')
      }
      await activeConnection?.close()

      const database: NotesDatabase = await createRxDatabase({
        name: accountDatabaseName(config.projectId, user.id),
        storage: getRxStorageSQLite(),
        multiInstance: false,
      })
      try {
        await database.addCollections({ notes: { schema: noteSchema } })
      } catch (error) {
        await database.close()
        throw error
      }
      const notes = database.notes
      const remote = collection(firestore, firestoreNotesPath(user.id))
      const replication = await (async () => {
        try {
          return replicateFirestore({
            replicationIdentifier: `${config.projectId}/${user.id}/notes`,
            collection: notes,
            firestore: { projectId: config.projectId, database: firestore, collection: remote },
            pull: {},
            push: {},
            live: true,
          })
        } catch (error) {
          await database.close()
          throw error
        }
      })()
      let closed = false
      let currentNotes: readonly CrudNote[] = []
      let status: CrudStatus = 'local'
      let initialSynced = false
      const emit = () => {
        if (!closed) {
          onChange(currentNotes, status)
        }
      }
      const subscriptions: Subscription[] = [
        notes.find().$.subscribe({
          next: rows => {
            currentNotes = rowsToNotes(rows)
            emit()
          },
          error: () => {
            status = 'error'
            emit()
          },
        }),
        replication.active$.subscribe(active => {
          status = active ? 'syncing' : initialSynced ? 'synced' : status === 'syncing' ? 'local' : status
          emit()
        }),
        replication.error$.subscribe(() => {
          status = 'error'
          emit()
        }),
      ]
      void replication.awaitInitialReplication().then(
        () => {
          initialSynced = true
          status = 'synced'
          emit()
        },
        () => {
          status = 'error'
          emit()
        },
      )

      const connection: CrudConnection = {
        async list() {
          return rowsToNotes(await notes.find().exec())
        },
        async create(text) {
          await notes.insert({ id: doc(remote).id, text, done: false, updatedAt: Date.now() })
        },
        async update(id, values) {
          const note = await notes.findOne(id).exec()
          if (!note) {
            throw new FirebaseNotesError('Note no longer exists')
          }
          await note.incrementalPatch({ ...values, updatedAt: Date.now() })
        },
        async remove(id) {
          const note = await notes.findOne(id).exec()
          if (!note) {
            throw new FirebaseNotesError('Note no longer exists')
          }
          await note.remove()
        },
        async close() {
          if (closed) {
            return
          }
          closed = true
          if (activeConnection === connection) {
            activeConnection = undefined
          }
          subscriptions.forEach(subscription => subscription.unsubscribe())
          await replication.cancel()
          await database.close()
        },
      }
      activeConnection = connection
      return connection
    },
  }
}
