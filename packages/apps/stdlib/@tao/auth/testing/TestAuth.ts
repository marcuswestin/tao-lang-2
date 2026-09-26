import type TR from '@runtime/TR'
import { Assert } from '@shared/core'

/** TestAuthProvider is deterministic and deliberately cannot mint backend credentials. */
export function TestAuthProvider(): TR.AuthProvider {
  return {
    testing: true,
    connect({ configuration }) {
      const accountId = String(configuration['AccountId'] ?? 'test-account')
      const identity = { issuer: 'tao:test', subject: accountId, accountId }
      let state: TR.AuthSession = configuration['State'] === 'SignedIn'
        ? { state: 'SignedIn', identity }
        : {
          state: configuration['State'] === 'Restoring'
            ? 'Restoring'
            : configuration['State'] === 'ReauthenticationRequired'
            ? 'ReauthenticationRequired'
            : 'SignedOut',
        }
      let challenge: string | undefined
      return {
        capabilities: { methods: ['EmailCode', 'Password'] },
        async restore() {
          return state
        },
        async signIn(input, signal) {
          if (signal.aborted) {
            return { outcome: { status: 'cancelled' } }
          }
          if (input.method === 'EmailCode' && !input.challengeId) {
            challenge = 'test-email-code'
            state = { state: 'ChallengeRequired', challenge: { id: challenge, kind: 'EmailCode' } }
            return { outcome: { status: 'completed' }, session: state }
          }
          if (
            input.method === 'EmailCode'
            && (input.challengeId !== challenge || input.fields?.['Code'] !== String(configuration['Code'] ?? '123456'))
          ) {
            return { outcome: { status: 'rejected', message: 'The code was not accepted. Try again.' } }
          }
          if (input.method !== 'EmailCode' && input.method !== 'Password') {
            return { outcome: { status: 'rejected', message: 'This sign-in method is unavailable.' } }
          }
          state = { state: 'SignedIn', identity }
          return { outcome: { status: 'completed' }, session: state }
        },
        cancel() {
          challenge = undefined
        },
        async signOut() {
          state = { state: 'SignedOut' }
          return { status: 'completed' }
        },
        async credential() {
          Assert.input(
            false,
            'TestAuth cannot authorize a remote datasource. Select LocalAuth or a trusted managed provider.',
          )
        },
      }
    },
  }
}
