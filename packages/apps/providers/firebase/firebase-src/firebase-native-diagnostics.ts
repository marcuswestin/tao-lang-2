import { warnContainedFailure } from '@runtime/TR-errors'
import { Errors } from '@shared/core'
import type { RxStorage } from 'rxdb'

/** Preserve native module failures before the SQLite adapter replaces their diagnostics. */
export function firebaseNativeStorage(
  loadSQLite: () => unknown,
  createStorage: () => RxStorage<unknown, unknown>,
  reportFailure: typeof warnContainedFailure = warnContainedFailure,
): RxStorage<unknown, unknown> {
  let stage = 'load-sqlite'
  try {
    loadSQLite()
    stage = 'create-storage'
    return createStorage()
  } catch (cause) {
    // Provider load recovery displays only the outer sentence; emit the retained cause as text
    // so both Metro and mirrored device logs keep it rather than flattening an Error object.
    reportFailure(
      'Firebase local storage initialization failed.',
      `module=expo-sqlite stage=${stage}\n${Errors.formatForLog(cause)}`,
    )
    Errors.throwHostEnvironment(
      "Firebase local storage could not initialize. Check Metro logs for SQLite diagnostics and verify this app's native build, then relaunch.",
      { cause, details: { provider: 'firebase', module: 'expo-sqlite', stage } },
    )
  }
}
