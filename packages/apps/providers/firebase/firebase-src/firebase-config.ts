import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { Assert } from '@shared/core'
import type { FirebaseOptions } from 'firebase/app'

export type FirebaseConfig = FirebaseOptions & { projectId: string; apiKey: string }

function required(configuration: Readonly<Record<string, unknown>>, name: string): string {
  const value = configuration[name]
  Assert.input(
    typeof value === 'string' && value.trim().length > 0,
    `Firebase configuration '${name}' expects non-empty text.`,
  )
  Assert.input(
    !value.trim().startsWith('REPLACE_WITH_FIREBASE_'),
    'Firebase is not configured. Run tao connect firebase <project> to configure this app.',
  )
  return value.trim()
}

function optional(configuration: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = configuration[name]
  if (value === undefined) {
    return undefined
  }
  return required(configuration, name)
}

export function firebaseConfig(configuration: Readonly<Record<string, unknown>>): FirebaseConfig {
  return {
    apiKey: required(configuration, 'ApiKey'),
    projectId: required(configuration, 'ProjectId'),
    ...(optional(configuration, 'AuthDomain') === undefined
      ? {}
      : { authDomain: optional(configuration, 'AuthDomain') }),
    ...(optional(configuration, 'AppId') === undefined ? {} : { appId: optional(configuration, 'AppId') }),
    ...(optional(configuration, 'StorageBucket') === undefined
      ? {}
      : { storageBucket: optional(configuration, 'StorageBucket') }),
    ...(optional(configuration, 'MessagingSenderId') === undefined
      ? {}
      : { messagingSenderId: optional(configuration, 'MessagingSenderId') }),
  }
}

/** The prefix and URI encoding keep a StorageKey inside one Firestore path segment. */
function firestoreStoreKey(value: string): string {
  Assert.input(value.trim().length > 0, 'Firebase StorageKey expects non-empty text.')
  const segment = `s_${encodeURIComponent(value)}`
  Assert.input(segment.length <= 1_500, 'Firebase StorageKey is too long for a Firestore path.')
  return segment
}

/** The runtime appends the authenticated UID to its selected Data slot storage key. */
export function authenticatedStoreKey(runtimeKey: string, uid: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(runtimeKey)
  } catch {
    Assert.input(false, 'Firebase requires an authenticated datasource storage key.')
  }
  Assert.input(
    Array.isArray(parsed) && parsed.length === 2
      && typeof parsed[0] === 'string' && parsed[1] === uid,
    'Firebase datasource storage key does not match the signed-in account.',
  )
  return parsed[0]
}

export function firestoreEntityPath(uid: string, storeKey: string, entity: string): string {
  Assert.input(uid !== '' && !uid.includes('/'), 'Firebase account ID must be one path segment.')
  Assert.input(entity !== '' && !entity.includes('/'), 'Firebase entity name must be one path segment.')
  return `users/${uid}/stores/${firestoreStoreKey(storeKey)}/${entity}`
}

/** Stable, bounded database names for project, store and account. */
export function accountDatabaseName(projectId: string, storeKey: string, uid: string): string {
  return `taofirebase_${bytesToHex(sha256(utf8ToBytes(JSON.stringify([projectId, storeKey, uid]))))}`
}
