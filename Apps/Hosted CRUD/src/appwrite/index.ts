import 'react-native-url-polyfill/auto'

import { observable, observe, syncState, when } from '@legendapp/state'
import { observablePersistAsyncStorage } from '@legendapp/state/persist-plugins/async-storage'
import { syncedCrud } from '@legendapp/state/sync-plugins/crud'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Account, Client, ID, Query, TablesDB } from 'react-native-appwrite'
import type { CrudAdapter, CrudConnection, CrudNote, CrudUser } from '../contract'
import { AppwriteNotesError, restoreAccount, storageName, syncStatus, toNote } from './model'

export type AppwriteConfig = Readonly<{
  endpoint: string
  projectId: string
  platform: string
  databaseId: string
  tableId: string
}>

const pageSize = 100
const refreshIntervalMs = 30_000

export function createAppwriteAdapter(config: AppwriteConfig): CrudAdapter {
  const client = new Client()
    .setEndpoint(config.endpoint)
    .setProject(config.projectId)
    .setPlatform(config.platform)
  const account = new Account(client)
  const database = new TablesDB(client)
  const connections = new Set<CrudConnection>()
  const userCacheKey = `hosted-crud-appwrite-user:${config.endpoint}:${config.projectId}:${config.platform}`

  function closeConnections(): Promise<void> {
    return Promise.all([...connections].map(connection => connection.close())).then(() => undefined)
  }

  async function currentUser(): Promise<CrudUser> {
    const user = await account.get()
    return { id: user.$id, email: user.email }
  }

  async function restoreUser(): Promise<CrudUser | undefined> {
    return restoreAccount(currentUser, AsyncStorage, userCacheKey)
  }

  async function listNotes(userId: string): Promise<CrudNote[]> {
    const notes: CrudNote[] = []
    let cursor: string | undefined
    do {
      const rows = await database.listRows({
        databaseId: config.databaseId,
        tableId: config.tableId,
        queries: [
          Query.equal('ownerId', userId),
          Query.limit(pageSize),
          ...(cursor ? [Query.cursorAfter(cursor)] : []),
        ],
      })
      notes.push(...rows.rows.map(row => toNote(row, userId)))
      if (rows.rows.length < pageSize) {
        break
      }
      cursor = rows.rows[rows.rows.length - 1]?.$id
    } while (cursor)
    return notes
  }

  return {
    async restore() {
      return restoreUser()
    },
    async register(email, password) {
      await closeConnections()
      await AsyncStorage.removeItem(userCacheKey)
      await account.create({ userId: ID.unique(), email, password })
      await account.createEmailPasswordSession({ email, password })
      const user = await currentUser()
      await AsyncStorage.setItem(userCacheKey, JSON.stringify(user))
      return user
    },
    async signIn(email, password) {
      await closeConnections()
      await AsyncStorage.removeItem(userCacheKey)
      await account.createEmailPasswordSession({ email, password })
      const user = await currentUser()
      await AsyncStorage.setItem(userCacheKey, JSON.stringify(user))
      return user
    },
    async signOut() {
      await closeConnections()
      await account.deleteSession({ sessionId: 'current' })
      await AsyncStorage.removeItem(userCacheKey)
    },
    async open(user, onChange) {
      const authenticated = await restoreUser()
      if (authenticated?.id !== user.id) {
        throw new AppwriteNotesError('Appwrite account changed before notes opened')
      }
      await closeConnections()

      let closed = false
      const notes$ = observable(syncedCrud<CrudNote>({
        list: () => listNotes(user.id),
        create: async note => {
          const row = await database.createRow({
            databaseId: config.databaseId,
            tableId: config.tableId,
            rowId: note.id,
            data: { ownerId: user.id, text: note.text, done: note.done, updatedAt: note.updatedAt },
          })
          return toNote(row, user.id)
        },
        update: async note => {
          if (!note.id) {
            throw new AppwriteNotesError('Cannot update a note without an ID')
          }
          const row = await database.updateRow({
            databaseId: config.databaseId,
            tableId: config.tableId,
            rowId: note.id,
            data: { text: note.text, done: note.done, updatedAt: note.updatedAt },
          })
          return toNote(row, user.id)
        },
        delete: async note => {
          await database.deleteRow({
            databaseId: config.databaseId,
            tableId: config.tableId,
            rowId: note.id,
          })
        },
        generateId: () => ID.unique(),
        subscribe: ({ refresh }) => {
          const timer = setInterval(() => {
            if (!closed) {
              void refresh()
            }
          }, refreshIntervalMs)
          return () => clearInterval(timer)
        },
        persist: {
          name: storageName(config.endpoint, config.projectId, config.databaseId, config.tableId, user.id),
          plugin: observablePersistAsyncStorage({ AsyncStorage }),
          retrySync: true,
        },
        retry: { infinite: true, backoff: 'exponential', maxDelay: 30 },
      }))
      const state$ = syncState(notes$)
      const dispose = observe(() => {
        const value = notes$.get() ?? {}
        const state = state$.get()
        if (closed) {
          return
        }
        onChange(
          Object.values(value),
          syncStatus({
            error: state.error,
            isLoaded: state.isLoaded,
            isGetting: state.isGetting,
            isSetting: state.isSetting,
            numPendingSets: state.numPendingSets,
            pendingChanges: Object.keys(state.getPendingChanges?.() ?? {}).length,
          }),
        )
      })
      await when(state$.isPersistLoaded)

      const connection: CrudConnection = {
        async list() {
          if (closed) {
            throw new AppwriteNotesError('Appwrite notes connection is closed')
          }
          return Object.values(notes$.get() ?? {})
        },
        async create(text) {
          if (closed) {
            throw new AppwriteNotesError('Appwrite notes connection is closed')
          }
          const id = ID.unique()
          notes$[id].set({ id, text, done: false, updatedAt: Date.now() })
        },
        async update(id, values) {
          if (closed) {
            throw new AppwriteNotesError('Appwrite notes connection is closed')
          }
          if (!notes$[id].peek()) {
            throw new AppwriteNotesError(`Unknown note: ${id}`)
          }
          notes$[id].assign({ ...values, updatedAt: Date.now() })
        },
        async remove(id) {
          if (closed) {
            throw new AppwriteNotesError('Appwrite notes connection is closed')
          }
          if (!notes$[id].peek()) {
            throw new AppwriteNotesError(`Unknown note: ${id}`)
          }
          notes$[id].delete()
        },
        async close() {
          if (closed) {
            return
          }
          closed = true
          state$.isSyncEnabled.set(false)
          dispose()
          connections.delete(connection)
        },
      }
      connections.add(connection)
      return connection
    },
  }
}
