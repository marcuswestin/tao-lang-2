import { formatLogArgument } from '@runtime/TR-studio-device-logs'
import { Errors } from '@shared/core'
import { Describe, Expect, Test } from '@shared/test'
import { createRxDatabase, type RxStorage, type RxStorageInstanceCreationParams } from 'rxdb'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { firebaseNativeStorage } from '../firebase-src/firebase-native-diagnostics'

function failureFrom(
  initialize: (report: (message: string, error: unknown) => void) => unknown,
): { failure: Errors.HostEnvironmentError; warnings: string[] } {
  let failure: unknown
  const warnings: string[] = []
  try {
    initialize(message => warnings.push(formatLogArgument(message)))
  } catch (error) {
    failure = error
  }
  Expect.Is(failure, (value): value is Errors.HostEnvironmentError => value instanceof Errors.HostEnvironmentError)
  return { failure, warnings }
}

async function failureFromAsync(
  initialize: (report: (message: string, error: unknown) => void) => Promise<unknown>,
): Promise<{ failure: Errors.HostEnvironmentError; warnings: string[] }> {
  let failure: unknown
  const warnings: string[] = []
  try {
    await initialize(message => warnings.push(formatLogArgument(message)))
  } catch (error) {
    failure = error
  }
  Expect.Is(failure, (value): value is Errors.HostEnvironmentError => value instanceof Errors.HostEnvironmentError)
  return { failure, warnings }
}

const instanceParams: RxStorageInstanceCreationParams<unknown, unknown> = {
  databaseInstanceToken: 'diagnostic-token',
  databaseName: 'diagnostic-database',
  collectionName: 'diagnostic-collection',
  schema: { version: 0, primaryKey: 'id', type: 'object', properties: { id: { type: 'string' } } },
  options: {},
  multiInstance: false,
  devMode: false,
}

Describe('Firebase native storage diagnostic content', () => {
  Test('preserves a missing native module failure before the adapter can replace it', () => {
    const cause = { name: 'Error', message: "Cannot find native module 'ExpoSQLite'" }
    let storageCreated = false
    const { failure, warnings } = failureFrom(report =>
      firebaseNativeStorage(
        () => {
          throw cause
        },
        () => {
          storageCreated = true
          return getRxStorageMemory()
        },
        report,
      )
    )
    Expect(storageCreated).toBe(false)
    Expect(failure.cause).toBe(cause)
    Expect(failure.details).toEqual({ provider: 'firebase', module: 'expo-sqlite', stage: 'load-sqlite' })
    Expect(Errors.formatForLog(failure)).toContain("Cannot find native module 'ExpoSQLite'")
    Expect(warnings).toHaveLength(1)
    Expect(warnings[0]?.split('\n')[0]).toContain(
      'Firebase local storage initialization failed. module=expo-sqlite stage=load-sqlite',
    )
    Expect(warnings[0]).toContain("Cannot find native module 'ExpoSQLite'")
    Expect(failure.messageForUser).toBe(
      "Firebase local storage could not initialize. Check Metro logs for SQLite diagnostics and verify this app's native build, then relaunch.",
    )
  })

  Test('retains a module evaluation failure without claiming that SQLite is uninstalled', () => {
    const cause = new TypeError('SQLite binding evaluation failed')
    const { failure, warnings } = failureFrom(report =>
      firebaseNativeStorage(
        () => {
          throw cause
        },
        getRxStorageMemory,
        report,
      )
    )
    Expect(failure.cause).toBe(cause)
    Expect(Errors.formatForLog(failure)).toContain('TypeError: SQLite binding evaluation failed')
    Expect(warnings[0]).toContain('TypeError: SQLite binding evaluation failed')
    Expect(failure.messageForUser).toBe(
      "Firebase local storage could not initialize. Check Metro logs for SQLite diagnostics and verify this app's native build, then relaunch.",
    )
  })

  Test('preserves storage factory failures after SQLite loaded', () => {
    const cause = { message: 'Adapter configuration failed' }
    const { failure, warnings } = failureFrom(report =>
      firebaseNativeStorage(
        () => undefined,
        () => {
          throw cause
        },
        report,
      )
    )
    Expect(failure.cause).toBe(cause)
    Expect(failure.details?.['stage']).toBe('create-storage')
    Expect(warnings[0]?.split('\n')[0]).toContain(
      'Firebase local storage initialization failed. module=expo-sqlite stage=create-storage',
    )
    Expect(warnings[0]).toContain('Adapter configuration failed')
  })

  Test('logs an asynchronous SQLite loader rejection before the adapter can open storage', async () => {
    const cause = new TypeError('Deferred SQLite module evaluation failed')
    const calls: string[] = []
    const adapter: RxStorage<unknown, unknown> = {
      name: 'diagnostic-adapter',
      rxdbVersion: 'diagnostic-version',
      createStorageInstance: async () => {
        calls.push('adapter-open')
        Errors.throwUnexpected('The adapter must not open after the asynchronous SQLite loader failed.')
      },
    }
    const { failure, warnings } = await failureFromAsync(async report => {
      const storage = firebaseNativeStorage(
        () => calls.push('sync-sqlite'),
        () => {
          calls.push('storage-factory')
          return adapter
        },
        report,
        async () => {
          calls.push('async-sqlite')
          throw cause
        },
      )
      await storage.createStorageInstance(instanceParams)
    })
    Expect(calls).toEqual(['sync-sqlite', 'storage-factory', 'async-sqlite'])
    Expect(failure.cause).toBe(cause)
    Expect(failure.details).toEqual({ provider: 'firebase', module: 'expo-sqlite', stage: 'load-sqlite-async' })
    Expect(warnings).toHaveLength(1)
    Expect(warnings[0]?.split('\n')[0]).toContain(
      'Firebase local storage initialization failed. module=expo-sqlite stage=load-sqlite-async',
    )
    Expect(warnings[0]).toContain('TypeError: Deferred SQLite module evaluation failed')
    Expect(Errors.formatForLog(failure)).toContain('Deferred SQLite module evaluation failed')
  })

  Test('retains and logs a deferred storage-instance failure after asynchronous SQLite loaded', async () => {
    const cause = { name: 'Error', message: 'SQLite adapter deferred instance opening failed' }
    const calls: string[] = []
    const { failure, warnings } = await failureFromAsync(async report => {
      const storage = firebaseNativeStorage(
        () => undefined,
        () => ({
          name: 'diagnostic-adapter',
          rxdbVersion: 'diagnostic-version',
          createStorageInstance: async () => {
            calls.push('adapter-open')
            throw cause
          },
        }),
        report,
        async () => {
          calls.push('async-sqlite')
        },
      )
      await storage.createStorageInstance(instanceParams)
    })
    Expect(calls).toEqual(['async-sqlite', 'adapter-open'])
    Expect(failure.cause).toBe(cause)
    Expect(failure.details?.['stage']).toBe('create-storage-instance')
    Expect(warnings).toHaveLength(1)
    Expect(warnings[0]?.split('\n')[0]).toContain(
      'Firebase local storage initialization failed. module=expo-sqlite stage=create-storage-instance',
    )
    Expect(warnings[0]).toContain('SQLite adapter deferred instance opening failed')
  })

  Test('loads SQLite before creating usable storage for a real database', async () => {
    const calls: string[] = []
    const originalStorage = getRxStorageMemory()
    const prototype = { diagnosticPrototype: true }
    Object.setPrototypeOf(originalStorage, prototype)
    const metadata = Symbol('diagnostic-metadata')
    Object.defineProperty(originalStorage, metadata, { value: 'retained metadata' })
    const originalCreate = originalStorage.createStorageInstance.bind(originalStorage)
    originalStorage.createStorageInstance = function(params) {
      Expect(this).toBe(originalStorage)
      calls.push('adapter-open')
      return originalCreate(params)
    }
    const storage = firebaseNativeStorage(
      () => {
        calls.push('sqlite')
      },
      () => {
        calls.push('storage')
        return originalStorage
      },
      undefined,
      async () => {
        calls.push('async-sqlite')
      },
    )
    Expect(calls).toEqual(['sqlite', 'storage'])
    Expect(storage).toBe(originalStorage)
    Expect(Object.getPrototypeOf(storage)).toBe(prototype)
    Expect(Reflect.get(storage, metadata)).toBe('retained metadata')
    Expect(storage.name).toBe('memory')
    Expect(storage.rxdbVersion).toBe(originalStorage.rxdbVersion)
    const database = await createRxDatabase({
      name: 'firebase-native-diagnostics',
      storage,
      multiInstance: false,
    })
    try {
      const collections = await database.addCollections({
        notes: {
          schema: {
            version: 0,
            primaryKey: 'id',
            type: 'object',
            properties: { id: { type: 'string', maxLength: 100 }, body: { type: 'string' } },
            required: ['id', 'body'],
          },
        },
      })
      await collections.notes.insert({ id: 'n-1', body: 'stored through the native initialization boundary' })
      Expect((await collections.notes.findOne('n-1').exec())?.toJSON()).toMatchObject({
        id: 'n-1',
        body: 'stored through the native initialization boundary',
      })
      Expect(calls).toEqual(['sqlite', 'storage', 'async-sqlite', 'adapter-open', 'async-sqlite', 'adapter-open'])
    } finally {
      await database.remove()
    }
  })
})
