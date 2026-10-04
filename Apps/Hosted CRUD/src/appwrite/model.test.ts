import { describe, expect, test } from 'bun:test'
import {
  AppwriteNotesError,
  isOfflineError,
  parseCachedUser,
  restoreAccount,
  storageName,
  syncStatus,
  toNote,
} from './model'

describe('hosted CRUD Appwrite model', () => {
  test('accepts only the signed-in account’s rows', () => {
    const document = { $id: 'note-1', ownerId: 'user-1', text: 'hello', done: false, updatedAt: 42 }
    expect(toNote(document, 'user-1')).toEqual({ id: 'note-1', text: 'hello', done: false, updatedAt: 42 })
    expect(() => toNote(document, 'user-2')).toThrow('Appwrite returned a note owned by another account')
    expect(() => toNote({ ...document, done: 'false' }, 'user-1')).toThrow('Appwrite returned an invalid note')
  })

  test('separates persisted queues by project, table, and account', () => {
    expect(storageName('https://one/v1', 'project', 'db', 'notes', 'alice'))
      .toBe('hosted-crud-appwrite:https://one/v1:project:db:notes:alice')
    expect(storageName('https://one/v1', 'project', 'db', 'notes', 'alice'))
      .not.toBe(storageName('https://one/v1', 'project', 'db', 'notes', 'bob'))
    expect(storageName('https://one/v1', 'project', 'db', 'notes', 'alice'))
      .not.toBe(storageName('https://two/v1', 'project', 'db', 'notes', 'alice'))
  })

  test('uses cached identity only for transport failures', () => {
    expect(isOfflineError({ code: 0, message: 'Network request failed' })).toBe(true)
    expect(isOfflineError({ code: 0, message: 'Failed to fetch' })).toBe(true)
    expect(isOfflineError({ code: 401, message: 'Unauthorized' })).toBe(false)
    expect(isOfflineError({ code: 0, message: 'Missing project ID' })).toBe(false)
    expect(isOfflineError({ code: 0, message: 'Invalid connection settings' })).toBe(false)
    expect(parseCachedUser('{"id":"alice","email":"alice@example.com"}'))
      .toEqual({ id: 'alice', email: 'alice@example.com' })
    expect(parseCachedUser('{"id":"","email":"alice@example.com"}')).toBeUndefined()
    expect(parseCachedUser('{bad')).toBeUndefined()
  })

  test('restores cached identity offline and clears it after a server 401', async () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        values.set(key, value)
      },
      removeItem: async (key: string) => {
        values.delete(key)
      },
    }
    const user = { id: 'alice', email: 'alice@example.com' }
    expect(await restoreAccount(async () => user, storage, 'account')).toEqual(user)
    expect(values.get('account')).toBe(JSON.stringify(user))

    const offline = async (): Promise<typeof user> => {
      throw { code: 0, message: 'Network request failed' }
    }
    expect(await restoreAccount(offline, storage, 'account')).toEqual(user)
    expect(await restoreAccount(offline, storage, 'other-account')).toBeUndefined()

    const unauthorized = async (): Promise<typeof user> => {
      throw { code: 401, message: 'Unauthorized' }
    }
    expect(await restoreAccount(unauthorized, storage, 'account')).toBeUndefined()
    expect(values.has('account')).toBe(false)
  })

  test('does not treat configuration failures as offline authentication', async () => {
    const storage = {
      getItem: async () => '{"id":"alice","email":"alice@example.com"}',
      setItem: async () => {},
      removeItem: async () => {},
    }
    const failure = { code: 0, message: 'Missing project ID' }
    await expect(restoreAccount(
      async () => {
        throw failure
      },
      storage,
      'account',
    )).rejects.toBe(failure)
  })

  test('reports local, active, failed, and settled sync states', () => {
    expect(syncStatus({ isLoaded: false })).toBe('local')
    expect(syncStatus({ isLoaded: true, pendingChanges: 1 })).toBe('local')
    expect(syncStatus({ isLoaded: true, isSetting: true })).toBe('syncing')
    expect(syncStatus({ isLoaded: true, numPendingSets: 1 })).toBe('syncing')
    expect(syncStatus({ isLoaded: true, error: new AppwriteNotesError('offline') })).toBe('error')
    expect(syncStatus({ isLoaded: true })).toBe('synced')
  })
})
