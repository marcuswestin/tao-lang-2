import type * as nativeSQLiteStorage from '@basepurpose/rxdb-sqlite/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as authSdk from 'firebase/auth'
import type { Persistence } from 'firebase/auth'
import type { RxStorage } from 'rxdb'
import { firebaseNativeStorage } from './firebase-native-diagnostics'

// The supported require export avoids an ESM import chunk resolved against the disposable Metro host.
const { getRxStorageSQLite } = require('@basepurpose/rxdb-sqlite/react-native') as typeof nativeSQLiteStorage

export function firebaseAuthPersistence(): Persistence {
  // Firebase's generic declarations omit its React Native persistence export.
  const sdk = authSdk as typeof authSdk & {
    getReactNativePersistence(storage: typeof AsyncStorage): Persistence
  }
  return sdk.getReactNativePersistence(AsyncStorage)
}

export function firebaseRxStorage(): RxStorage<unknown, unknown> {
  return firebaseNativeStorage(
    () => require('expo-sqlite'),
    getRxStorageSQLite,
    undefined,
    async () => require('expo-sqlite'),
  )
}
