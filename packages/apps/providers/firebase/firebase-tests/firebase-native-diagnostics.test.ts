import { formatLogArgument } from '@runtime/TR-studio-device-logs'
import { Errors } from '@shared/core'
import { Describe, Expect, Test } from '@shared/test'
import { createRxDatabase } from 'rxdb'
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { firebaseNativeStorage } from '../firebase-src/firebase-native-diagnostics'

function failureFrom(
  initialize: (report: (message: string, error: unknown) => void) => unknown,
): { failure: Errors.HostEnvironmentError; warnings: string[] } {
  let failure: unknown
  const warnings: string[] = []
  try {
    initialize((...args: unknown[]) => warnings.push(args.map(formatLogArgument).join(' ')))
  } catch (error) {
    failure = error
  }
  Expect.Is(failure, (value): value is Errors.HostEnvironmentError => value instanceof Errors.HostEnvironmentError)
  return { failure, warnings }
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
    Expect(warnings[0]?.split('\n')[0]).toBe(
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
    Expect(warnings[0]?.split('\n')[0]).toBe(
      'Firebase local storage initialization failed. module=expo-sqlite stage=create-storage',
    )
    Expect(warnings[0]).toContain('Adapter configuration failed')
  })

  Test('loads SQLite before creating usable storage for a real database', async () => {
    const calls: string[] = []
    const storage = firebaseNativeStorage(
      () => {
        calls.push('sqlite')
      },
      () => {
        calls.push('storage')
        return getRxStorageMemory()
      },
    )
    Expect(calls).toEqual(['sqlite', 'storage'])
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
    } finally {
      await database.remove()
    }
  })
})
