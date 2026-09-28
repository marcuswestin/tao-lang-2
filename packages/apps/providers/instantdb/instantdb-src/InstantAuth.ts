import type TR from '@runtime/TR'
import { Assert, Errors } from '@shared/core'
import { acquireInstantClient, type InstantClientLease, type InstantSDK } from './instant-clients'

const providerName = 'InstantAuth'

type InstantUser = Readonly<{ email?: string | null | undefined; id: string; refresh_token: string }>
type InstantAuthEvent = Readonly<{ error?: unknown; user?: InstantUser | null | undefined }>
type PendingChallenge = Readonly<{ email: string; id: string }>

const emailPattern = /^[^\s@]+@[^\s@]+$/

/**
 * InstantAuthProvider signs in through InstantDB's own email magic codes, on the same shared client
 * (`acquireInstantClient`) an InstantDB datasource at the same address uses, so the sign-in is what
 * authenticates that datasource's subscriptions. The SDK persists the signed-in user itself.
 *
 * The principal's issuer is `instantdb:<AppId>` and its subject is the InstantDB user id. The first
 * `EmailCode` sign-in (no `challengeId`) sends the code and reports a `ChallengeRequired` session;
 * the second carries the challenge id, `Email`, and `Code`. The challenge id is a fresh InstantDB id
 * per sent code; the code step reads the email from its fields and falls back to the one the
 * challenge was sent to, so it does not depend on connection state surviving between the steps.
 *
 * Its `Session` proof carries the InstantDB address and the user's refresh token, so a datasource on
 * another client can sign that client in with `signInWithToken`.
 */
export function InstantAuthProvider(loadSDK: () => InstantSDK = instantSDK): TR.AuthProvider {
  return {
    connect({ configuration }) {
      const appId = requiredConfigurationText(configuration, 'AppId')
      const apiURI = optionalConfigurationText(configuration, 'ApiURI')
      const websocketURI = optionalConfigurationText(configuration, 'WebsocketURI')
      const issuer = `instantdb:${appId}`
      let sdk: InstantSDK
      let lease: InstantClientLease
      try {
        sdk = loadSDK()
        lease = acquireInstantClient(sdk, { apiURI, appId, websocketURI })
      } catch (error) {
        Errors.throwHostEnvironment('InstantDB auth initialization failed.', { cause: error })
      }
      const db = lease.db
      const listeners = new Set<(session: TR.AuthConnectionSession) => void>()
      let stopAuthEvents: (() => void) | undefined
      let pending: PendingChallenge | undefined
      /** reportedUser is the InstantDB user id this connection last reported, so events report only changes. */
      let reportedUser: string | undefined
      let closed = false

      const signedIn = (user: InstantUser): TR.AuthConnectionSession => ({
        state: 'SignedIn',
        principal: { issuer, subject: user.id, ...(user.email ? { email: user.email } : {}) },
      })
      const report = (user: InstantUser | undefined): TR.AuthConnectionSession => {
        reportedUser = user?.id
        return user ? signedIn(user) : { state: 'SignedOut' }
      }
      const onAuthEvent = (event: InstantAuthEvent): void => {
        // An `error` comes only from an OAuth redirect this provider never starts.
        if (closed || event.error) {
          return
        }
        const user = event.user ?? undefined
        if (user?.id === reportedUser) {
          return
        }
        // A user who disappears without this connection signing out was signed out by the server.
        const session: TR.AuthConnectionSession = user ? signedIn(user) : { state: 'ReauthenticationRequired' }
        reportedUser = user?.id
        for (const listener of [...listeners]) {
          listener(session)
        }
      }
      const signOutQuietly = async (): Promise<void> => {
        try {
          await db.auth.signOut()
        } catch { /* A sign-in abandoned after cancellation leaves at worst a session the user can sign out of. */ }
      }

      return {
        capabilities: { methods: ['EmailCode'] },
        async restore(signal) {
          if (closed || signal.aborted) {
            return { state: 'SignedOut' }
          }
          const user = await db.getAuth()
          if (closed || signal.aborted) {
            return { state: 'SignedOut' }
          }
          return report(user ?? undefined)
        },
        async signIn(input, signal) {
          if (closed || signal.aborted) {
            return { outcome: { status: 'cancelled' } }
          }
          if (input.method !== 'EmailCode') {
            return { outcome: { status: 'rejected', message: 'This provider supports email code sign-in.' } }
          }
          const typed = input.fields?.['Email']?.trim() ?? ''
          if (input.challengeId === undefined) {
            if (!emailPattern.test(typed)) {
              return { outcome: { status: 'rejected', message: 'Enter a valid email address.' } }
            }
            try {
              await db.auth.sendMagicCode({ email: typed })
            } catch (error) {
              return {
                outcome: failureOutcome(
                  error,
                  'Unable to send a code to that email. Check the address and try again.',
                  'Unable to send a sign-in code. Check your connection and try again.',
                ),
              }
            }
            if (closed || signal.aborted) {
              return { outcome: { status: 'cancelled' } }
            }
            pending = { email: typed, id: sdk.id() }
            return {
              outcome: { status: 'completed' },
              session: { state: 'ChallengeRequired', challenge: { id: pending.id, kind: 'EmailCode' } },
            }
          }
          const email = typed || (pending?.id === input.challengeId ? pending.email : '')
          const code = input.fields?.['Code']?.trim() ?? ''
          if (!email) {
            return { outcome: { status: 'rejected', message: 'Request a new code to sign in.' } }
          }
          if (!code) {
            return { outcome: { status: 'rejected', message: 'Enter the code from your email.' } }
          }
          let user: InstantUser
          try {
            user = (await db.auth.signInWithMagicCode({ code, email })).user
          } catch (error) {
            return {
              outcome: failureOutcome(
                error,
                'The code was not accepted. Try again.',
                'Unable to check the code. Check your connection and try again.',
              ),
            }
          }
          if (closed || signal.aborted) {
            // The SDK already persisted the user; a cancelled sign-in must not restore on next launch.
            await signOutQuietly()
            return { outcome: { status: 'cancelled' } }
          }
          pending = undefined
          return { outcome: { status: 'completed' }, session: report(user) }
        },
        cancel() {
          pending = undefined
        },
        async signOut() {
          pending = undefined
          reportedUser = undefined
          try {
            // The SDK clears the persisted user, then revokes the refresh token in the background.
            await db.auth.signOut()
          } catch {
            return { status: 'error', message: 'Unable to sign out. Please try again.' }
          }
          return { status: 'completed' }
        },
        async proof({ kind, signal }) {
          if (signal.aborted) {
            throw Errors.abortError('The authentication request was cancelled.')
          }
          Assert.input(kind === 'Session', `InstantAuth issues Session sign-in proofs, not ${kind}.`)
          const user = closed ? null : await db.getAuth()
          if (signal.aborted) {
            throw Errors.abortError('The authentication request was cancelled.')
          }
          Assert.input(user !== null && user !== undefined, 'Sign in again to access account data.')
          return {
            kind,
            issuer,
            subject: user.id,
            value: {
              appId,
              ...(apiURI === undefined ? {} : { apiURI }),
              ...(websocketURI === undefined ? {} : { websocketURI }),
              refreshToken: user.refresh_token,
            },
          }
        },
        subscribe(listener) {
          listeners.add(listener)
          if (!closed && stopAuthEvents === undefined) {
            // The SDK replays its cached user at once; `reportedUser` keeps that from reporting a change.
            stopAuthEvents = db.core.subscribeAuth(onAuthEvent)
          }
          return () => {
            listeners.delete(listener)
            if (listeners.size === 0) {
              stopAuthEvents?.()
              stopAuthEvents = undefined
            }
          }
        },
        close() {
          if (closed) {
            return
          }
          closed = true
          pending = undefined
          listeners.clear()
          stopAuthEvents?.()
          stopAuthEvents = undefined
          lease.release()
        },
      }
    },
  }
}

/** requiredConfigurationText reads a text property the auth declaration requires. */
function requiredConfigurationText(configuration: Readonly<Record<string, unknown>>, name: string): string {
  const value = configuration[name]
  Assert.input(
    typeof value === 'string' && value.trim().length > 0,
    `${providerName} configuration '${name}' expects non-empty text.`,
  )
  return value.trim()
}

/** optionalConfigurationText reads a text property the auth declaration marks optional. */
function optionalConfigurationText(configuration: Readonly<Record<string, unknown>>, name: string): string | undefined {
  return configuration[name] === undefined ? undefined : requiredConfigurationText(configuration, name)
}

/**
 * failureOutcome tells the user's mistake from the connection's: InstantDB answers a refused email
 * or code with a 4xx status; anything else (no response, a server error) is a transport failure.
 */
function failureOutcome(error: unknown, rejected: string, failed: string): TR.AuthOutcome {
  const status = typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : undefined
  if (status === 429) {
    return { status: 'rejected', message: 'Too many attempts. Wait a moment and try again.' }
  }
  return typeof status === 'number' && status >= 400 && status < 500
    ? { status: 'rejected', message: rejected }
    : { status: 'error', message: failed }
}

function instantSDK(): InstantSDK {
  return require('@instantdb/react-native') as InstantSDK
}
