import { warnContainedFailure } from '@runtime/TR-errors'
import { Errors } from '@shared/core'
import type { RxStorage } from 'rxdb'

/** Preserve native module failures before the SQLite adapter replaces their diagnostics. */
export function firebaseNativeStorage(
  loadSQLite: () => unknown,
  createStorage: () => RxStorage<unknown, unknown>,
  reportFailure: typeof warnContainedFailure = warnContainedFailure,
  loadSQLiteAsync?: () => Promise<unknown>,
): RxStorage<unknown, unknown> {
  let stage = 'load-sqlite'
  try {
    loadSQLite()
    stage = 'create-storage'
    const storage = createStorage()
    if (loadSQLiteAsync !== undefined) {
      // Keep the adapter object, prototype and original method receiver intact.
      const createStorageInstance = storage.createStorageInstance.bind(storage)
      storage.createStorageInstance = async params => {
        let instanceStage = 'load-sqlite-async'
        try {
          await loadSQLiteAsync()
          instanceStage = 'create-storage-instance'
          return await createStorageInstance(params)
        } catch (cause) {
          return failNativeStorage(instanceStage, cause, reportFailure)
        }
      }
    }
    return storage
  } catch (cause) {
    return failNativeStorage(stage, cause, reportFailure)
  }
}

function failNativeStorage(stage: string, cause: unknown, reportFailure: typeof warnContainedFailure): never {
  // Provider load recovery displays only the outer sentence; emit the retained cause as text
  // so both Metro and mirrored device logs keep it rather than flattening an Error object.
  const diagnostic = Errors.formatForLog(cause)
  const summary = diagnostic.split('\n').find(line => line.startsWith('cause=')) ?? diagnostic.split('\n')[0]
  reportFailure(
    `Firebase local storage initialization failed. module=expo-sqlite stage=${stage}: ${summary}`,
    diagnostic,
  )
  Errors.throwHostEnvironment(
    "Firebase local storage could not initialize. Check Metro logs for SQLite diagnostics and verify this app's native build, then relaunch.",
    { cause, details: { provider: 'firebase', module: 'expo-sqlite', stage } },
  )
}
