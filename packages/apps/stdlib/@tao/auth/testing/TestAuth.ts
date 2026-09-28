import type TR from '@runtime/TR'
import { Assert } from '@shared/core'

/** TestAuthProvider is deterministic and issues only TestIdentity proofs, which only test datasources accept. */
export function TestAuthProvider(): TR.AuthProvider {
  return {
    testing: true,
    connect({ configuration }) {
      const accountId = String(configuration['AccountId'] ?? 'test-account')
      const principal = { issuer: 'tao:test', subject: accountId }
      let state: TR.AuthConnectionSession = configuration['State'] === 'SignedIn'
        ? { state: 'SignedIn', principal }
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
          state = { state: 'SignedIn', principal }
          return { outcome: { status: 'completed' }, session: state }
        },
        cancel() {
          challenge = undefined
        },
        async signOut() {
          state = { state: 'SignedOut' }
          return { status: 'completed' }
        },
        async proof({ kind }) {
          Assert.input(
            kind === 'TestIdentity',
            'TestAuth cannot authorize a remote datasource. Select LocalAuth or a trusted managed provider.',
          )
          Assert.input(state.state === 'SignedIn', 'Sign in to access this resource.')
          return { kind, ...principal, accountId }
        },
      }
    },
  }
}
