import { browserLocalPersistence, type Persistence } from 'firebase/auth'
import type { RxStorage } from 'rxdb'
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie'

export function firebaseAuthPersistence(): Persistence {
  return browserLocalPersistence
}

export function firebaseRxStorage(): RxStorage<unknown, unknown> {
  return getRxStorageDexie()
}
