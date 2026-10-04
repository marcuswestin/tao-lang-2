import type TR from '@runtime/TR'
import { Assert, Errors } from '@shared/core'
import {
  type Auth,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { type FirebaseClient, firebaseClient } from './firebase-client'
import { firebaseConfig } from './firebase-config'

const authMessages: Readonly<Record<string, string>> = {
  'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/weak-password': 'Use a password of at least 6 characters.',
  'auth/invalid-credential': 'The email or password is incorrect.',
  'auth/wrong-password': 'The email or password is incorrect.',
  'auth/user-not-found': 'The email or password is incorrect.',
  'auth/too-many-requests': 'Too many attempts. Wait a moment, then try again.',
  'auth/network-request-failed': 'Unable to reach Firebase. Check your connection and try again.',
}

export type FirebaseAuthSDK = Readonly<{
  observe(auth: Auth, listener: (user: User | null) => void): () => void
  register(auth: Auth, email: string, password: string): Promise<{ user: User }>
  signIn(auth: Auth, email: string, password: string): Promise<{ user: User }>
  signOut(auth: Auth): Promise<void>
}>

const firebaseAuthSDK: FirebaseAuthSDK = {
  observe: (auth, listener) => onAuthStateChanged(auth, listener),
  register: createUserWithEmailAndPassword,
  signIn: signInWithEmailAndPassword,
  signOut,
}

const cancelledSessionMessage = 'Unable to finish cancelling sign-in. Check your connection, then sign in again.'

/** Firebase Auth is shared by every declaration at one project; its mutations must finish in order. */
class FirebaseAuthQueue {
  private tail: Promise<void> = Promise.resolve()
  private pending = 0
  private quarantinedUid: string | undefined
  private readonly idleListeners = new Set<() => void>()

  get busy(): boolean {
    return this.pending > 0
  }

  isQuarantined(user: User | null): boolean {
    return user !== null && user.uid === this.quarantinedUid
  }

  quarantine(uid: string): void {
    this.quarantinedUid = uid
  }

  accept(): void {
    this.quarantinedUid = undefined
  }

  idle(): Promise<void> {
    return this.tail
  }

  subscribeIdle(listener: () => void): () => void {
    this.idleListeners.add(listener)
    return () => {
      this.idleListeners.delete(listener)
    }
  }

  enqueue<ResultT>(operation: () => Promise<ResultT>): Promise<ResultT> {
    this.pending += 1
    const result = this.tail.then(async () => {
      try {
        return await operation()
      } finally {
        this.pending -= 1
        if (this.pending === 0) {
          for (const listener of [...this.idleListeners]) {
            listener()
          }
        }
      }
    })
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}

const authQueues = new WeakMap<Auth, FirebaseAuthQueue>()

function queueFor(auth: Auth): FirebaseAuthQueue {
  let queue = authQueues.get(auth)
  if (queue === undefined) {
    queue = new FirebaseAuthQueue()
    authQueues.set(auth, queue)
  }
  return queue
}

function failure(error: unknown): TR.AuthOutcome {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  const message = typeof code === 'string' ? authMessages[code] : undefined
  return message === undefined
    ? { status: 'error', message: 'Unable to sign in. Check your connection and try again.' }
    : { status: code === 'auth/network-request-failed' ? 'error' : 'rejected', message }
}

function principal(projectId: string, user: User): TR.AuthConnectionSession {
  return {
    state: 'SignedIn',
    principal: {
      issuer: `firebase:${projectId}`,
      subject: user.uid,
      ...(user.email === null ? {} : { email: user.email }),
      emailVerified: user.emailVerified,
    },
  }
}

/** Password sign-in and registration share the persisted Firebase session used by the datasource. */
export function FirebaseAuthProvider(
  loadClient: (config: ReturnType<typeof firebaseConfig>) => FirebaseClient = firebaseClient,
  sdk: FirebaseAuthSDK = firebaseAuthSDK,
): TR.AuthProvider {
  return {
    connect({ configuration }) {
      const config = firebaseConfig(configuration)
      const { auth } = loadClient(config)
      const queue = queueFor(auth)
      const listeners = new Set<(session: TR.AuthConnectionSession) => void>()
      let closed = false
      let reportedUid: string | undefined
      let reportedQuarantine = false
      let generation = 0
      const report = (user: User | null): TR.AuthConnectionSession => {
        reportedUid = user?.uid
        return user === null ? { state: 'SignedOut' } : principal(config.projectId, user)
      }
      const observeUser = (user: User | null): void => {
        if (closed) {
          return
        }
        if (queue.isQuarantined(user)) {
          if (reportedQuarantine) {
            return
          }
          reportedQuarantine = true
          reportedUid = undefined
          for (const listener of listeners) {
            listener({ state: 'ReauthenticationRequired', message: cancelledSessionMessage })
          }
          return
        }
        if (user?.uid === reportedUid && !reportedQuarantine) {
          return
        }
        reportedQuarantine = false
        const session = user === null && reportedUid !== undefined
          ? { state: 'ReauthenticationRequired' as const }
          : report(user)
        reportedUid = user?.uid
        for (const listener of listeners) {
          listener(session)
        }
      }
      const stopIdle = queue.subscribeIdle(() => observeUser(auth.currentUser))
      const stop = sdk.observe(auth, user => {
        if (queue.busy || user?.uid !== auth.currentUser?.uid) {
          return
        }
        observeUser(user)
      })
      return {
        capabilities: { methods: ['Password'] },
        async restore(signal) {
          if (closed || signal.aborted) {
            return { state: 'SignedOut' }
          }
          await auth.authStateReady()
          await queue.idle()
          if (closed || signal.aborted) {
            return { state: 'SignedOut' }
          }
          if (queue.isQuarantined(auth.currentUser)) {
            return { state: 'ReauthenticationRequired', message: cancelledSessionMessage }
          }
          return report(auth.currentUser)
        },
        async signIn(input, signal) {
          if (closed || signal.aborted) {
            return { outcome: { status: 'cancelled' } }
          }
          if (input.method !== 'Password') {
            return { outcome: { status: 'rejected', message: 'Firebase supports password sign-in.' } }
          }
          const email = input.fields?.['Email']?.trim() ?? ''
          const password = input.fields?.['Password'] ?? ''
          if (email === '' || password === '') {
            return { outcome: { status: 'rejected', message: 'Enter an email address and password.' } }
          }
          const currentGeneration = ++generation
          return queue.enqueue(async () => {
            if (closed || signal.aborted || generation !== currentGeneration) {
              return { outcome: { status: 'cancelled' } }
            }
            try {
              const previousUid = auth.currentUser?.uid
              const register = input.fields?.['Register'] === 'true'
              const credential = register
                ? await sdk.register(auth, email, password)
                : await sdk.signIn(auth, email, password)
              if (closed || signal.aborted || generation !== currentGeneration) {
                // No later SDK mutation can start until this cancelled mutation is cleaned up.
                if (auth.currentUser?.uid === credential.user.uid && previousUid !== credential.user.uid) {
                  reportedUid = undefined
                  try {
                    await sdk.signOut(auth)
                    queue.accept()
                  } catch {
                    queue.quarantine(credential.user.uid)
                    return { outcome: { status: 'error', message: cancelledSessionMessage } }
                  }
                }
                return { outcome: { status: 'cancelled' } }
              }
              queue.accept()
              return { outcome: { status: 'completed' }, session: report(credential.user) }
            } catch (error) {
              return closed || signal.aborted || generation !== currentGeneration
                ? { outcome: { status: 'cancelled' } }
                : { outcome: failure(error) }
            }
          })
        },
        cancel() {
          generation += 1
        },
        async signOut() {
          generation += 1
          const previousUid = reportedUid
          reportedUid = undefined
          return queue.enqueue(async () => {
            try {
              await sdk.signOut(auth)
              queue.accept()
              return { status: 'completed' }
            } catch {
              reportedUid = previousUid
              return { status: 'error', message: 'Unable to sign out. Please try again.' }
            }
          })
        },
        async proof({ kind, signal }) {
          if (closed || signal.aborted) {
            throw Errors.abortError('The authentication request was cancelled.')
          }
          Assert.input(kind === 'Session', `FirebaseAuth issues Session sign-in proofs, not ${kind}.`)
          await auth.authStateReady()
          await queue.idle()
          if (closed || signal.aborted) {
            throw Errors.abortError('The authentication request was cancelled.')
          }
          const user = auth.currentUser
          Assert.input(!queue.isQuarantined(user), cancelledSessionMessage)
          Assert.input(user !== null, 'Sign in again to access account data.')
          return {
            kind,
            issuer: `firebase:${config.projectId}`,
            subject: user.uid,
            value: { projectId: config.projectId, uid: user.uid },
          }
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        close() {
          closed = true
          generation += 1
          listeners.clear()
          stop()
          stopIdle()
        },
      }
    },
  }
}
