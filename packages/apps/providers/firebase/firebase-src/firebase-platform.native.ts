import { getRxStorageSQLite } from '@basepurpose/rxdb-sqlite/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as authSdk from 'firebase/auth'
import type { Persistence } from 'firebase/auth'
import type { RxStorage } from 'rxdb'

export function firebaseAuthPersistence(): Persistence {
  // Firebase's generic declarations omit its React Native persistence export.
  const sdk = authSdk as typeof authSdk & {
    getReactNativePersistence(storage: typeof AsyncStorage): Persistence
  }
  return sdk.getReactNativePersistence(AsyncStorage)
}

export function firebaseRxStorage(): RxStorage<unknown, unknown> {
  return getRxStorageSQLite()
}
