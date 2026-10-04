import { Assert, Errors } from '@shared/core'
import { type FirebaseApp, getApps, initializeApp } from 'firebase/app'
import { type Auth, getAuth, initializeAuth } from 'firebase/auth'
import { type Firestore, getFirestore } from 'firebase/firestore'
import type { FirebaseConfig } from './firebase-config'
import { firebaseAuthPersistence } from './firebase-platform'

export type FirebaseClient = Readonly<{ app: FirebaseApp; auth: Auth; firestore: Firestore }>

/** Auth and data at one project share exactly the same named Firebase app and persisted session. */
export function firebaseClient(config: FirebaseConfig): FirebaseClient {
  const name = `tao-firebase-${config.projectId}`
  const existing = getApps().find(app => app.name === name)
  Assert.input(
    existing === undefined || existing.options.apiKey === config.apiKey,
    `Firebase project '${config.projectId}' has conflicting client configuration.`,
  )
  let app: FirebaseApp
  let auth: Auth
  let firestore: Firestore
  try {
    app = existing ?? initializeApp(config, name)
    auth = existing ? getAuth(app) : initializeAuth(app, { persistence: firebaseAuthPersistence() })
    firestore = getFirestore(app)
  } catch (error) {
    Errors.throwHostEnvironment('Firebase client initialization failed.', { cause: error })
  }
  return { app, auth, firestore }
}
