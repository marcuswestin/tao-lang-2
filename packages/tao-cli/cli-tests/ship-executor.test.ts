import { Describe, Expect, Test } from '@shared/test'
import { configureBetaDistribution } from '../cli-src/ship-executor'

Describe('tao ship TestFlight distribution', () => {
  Test('makes the build available before assigning an external tester', async () => {
    const calls: string[] = []
    const apple = {
      addBuildToBetaGroup: async (groupId: string) => {
        calls.push(`build:${groupId}`)
      },
      enableAutomaticBetaNotifications: async () => {
        calls.push('auto-notify')
        return {
          attributes: { autoNotifyEnabled: true },
          id: 'build-detail-1',
          type: 'buildBetaDetails' as const,
        }
      },
      ensureBetaAppLocalization: async (_appId: string, input: { description?: string; feedbackEmail?: string }) => {
        calls.push('app-localization')
        Expect(input).toEqual({
          description:
            'WordFlower - InstantDB is currently in beta. Please explore its features and share feedback through TestFlight.',
          feedbackEmail: 'friend@example.com',
        })
        return {
          attributes: { ...input, locale: 'en-US' },
          id: 'app-localization-1',
          type: 'betaAppLocalizations' as const,
        }
      },
      ensureBetaGroup: async (_appId: string, name: string, isInternalGroup: boolean) => {
        calls.push(`group:${name}`)
        return {
          attributes: { isInternalGroup, name },
          id: isInternalGroup ? 'internal-1' : 'external-1',
          type: 'betaGroups' as const,
        }
      },
      ensureBetaTester: async (email: string, groupId: string) => {
        calls.push(`tester:${email}:${groupId}`)
        return { attributes: { email }, id: 'tester-1', type: 'betaTesters' as const }
      },
      setWhatToTest: async () => {
        calls.push('what-to-test')
        return {
          attributes: { locale: 'en-US', whatsNew: 'Try the editor.' },
          id: 'build-localization-1',
          type: 'betaBuildLocalizations' as const,
        }
      },
      submitBuildForBetaReview: async () => {
        calls.push('beta-review')
        return {
          attributes: { betaReviewState: 'WAITING_FOR_REVIEW' },
          id: 'review-1',
          type: 'betaAppReviewSubmissions' as const,
        }
      },
      users: async (email: string) => {
        calls.push(`users:${email}`)
        return []
      },
    }

    await configureBetaDistribution(apple, {
      appId: 'app-1',
      appName: 'WordFlower - InstantDB',
      build: { attributes: { processingState: 'VALID', version: '7' }, id: 'build-7', type: 'builds' },
      emails: ['friend@example.com'],
      notes: 'Try the editor.',
    })

    Expect(calls).toEqual([
      'group:Tao Internal',
      'group:Tao External',
      'users:friend@example.com',
      'what-to-test',
      'build:internal-1',
      'build:external-1',
      'auto-notify',
      'app-localization',
      'tester:friend@example.com:external-1',
      'beta-review',
    ])
  })
})
