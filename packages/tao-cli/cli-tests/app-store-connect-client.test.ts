import { Errors, Http } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  AppStoreConnectClient,
  type AppStoreConnectClock,
  type AppStoreConnectFetch,
} from '../cli-src/app-store-connect-client'

type RecordedRequest = {
  authorization?: string
  body?: unknown
  method: string
  url: string
}

Describe('App Store Connect client', () => {
  Test('derives the Team ID from paginated bundle identifier seedIds', async () => {
    const recorded = recordedFetch([
      Http.jsonResponse({
        data: [],
        links: { next: 'https://api.appstoreconnect.apple.com/v1/bundleIds?cursor=next' },
      }),
      Http.jsonResponse({
        data: [resource('bundleIds', 'bundle-1', {
          identifier: 'com.example.wordflower',
          seedId: 'TEAM123456',
        })],
      }),
    ])
    const client = clientWith(recorded.fetch)

    Expect(await client.teamId()).toBe('TEAM123456')
    Expect(recorded.requests).toEqual([
      {
        authorization: 'Bearer recorded.jwt',
        method: 'GET',
        url: 'https://api.appstoreconnect.apple.com/v1/bundleIds',
      },
      {
        authorization: 'Bearer recorded.jwt',
        method: 'GET',
        url: 'https://api.appstoreconnect.apple.com/v1/bundleIds?cursor=next',
      },
    ])
  })

  Test('registers an iOS bundle identifier when Xcode has not already created it', async () => {
    const recorded = recordedFetch([Http.jsonResponse({
      data: resource('bundleIds', 'bundle-1', {
        identifier: 'com.example.wordflower',
        name: 'WordFlower',
        platform: 'IOS',
        seedId: 'TEAM123456',
      }),
    })])

    Expect(
      await clientWith(recorded.fetch).registerBundleId({
        identifier: 'com.example.wordflower',
        name: 'WordFlower',
      }),
    ).toEqual(resource('bundleIds', 'bundle-1', {
      identifier: 'com.example.wordflower',
      name: 'WordFlower',
      platform: 'IOS',
      seedId: 'TEAM123456',
    }))
    Expect(recorded.requests[0]).toEqual({
      authorization: 'Bearer recorded.jwt',
      body: {
        data: {
          attributes: {
            identifier: 'com.example.wordflower',
            name: 'WordFlower',
            platform: 'IOS',
          },
          type: 'bundleIds',
        },
      },
      method: 'POST',
      url: 'https://api.appstoreconnect.apple.com/v1/bundleIds',
    })
  })

  Test('finds the human-created app record through its textual bundle identifier', async () => {
    const app = resource('apps', 'app-42', {
      bundleId: 'com.example.wordflower',
      name: 'WordFlower',
      primaryLocale: 'en-US',
      sku: 'wordflower',
    })
    const recorded = recordedFetch([Http.jsonResponse({ data: [app] })])

    Expect(await clientWith(recorded.fetch).apps('com.example.wordflower')).toEqual([app])
    Expect(recorded.requests[0]?.url).toBe(
      'https://api.appstoreconnect.apple.com/v1/apps?filter%5BbundleId%5D=com.example.wordflower',
    )
  })

  Test('polls processing builds through an injected clock', async () => {
    let now = 1_000
    const sleeps: number[] = []
    const clock: AppStoreConnectClock = {
      now: () => now,
      sleep: async ms => {
        sleeps.push(ms)
        now += ms
      },
    }
    const recorded = recordedFetch([
      Http.jsonResponse({ data: [build('PROCESSING')] }),
      Http.jsonResponse({ data: [build('VALID')] }),
    ])

    const result = await clientWith(recorded.fetch, clock).waitForProcessedBuild({
      appId: 'app-42',
      buildNumber: '202609021122',
      pollIntervalMs: 100,
      timeoutMs: 1_000,
    })

    Expect(result.id).toBe('build-7')
    Expect(sleeps).toEqual([100])
    Expect(recorded.requests.map(request => request.url)).toEqual([
      'https://api.appstoreconnect.apple.com/v1/builds?filter%5Bapp%5D=app-42&filter%5Bversion%5D=202609021122&limit=200',
      'https://api.appstoreconnect.apple.com/v1/builds?filter%5Bapp%5D=app-42&filter%5Bversion%5D=202609021122&limit=200',
    ])
  })

  Test('creates and attaches an App Store version before submitting modern review resources', async () => {
    const recorded = recordedFetch([
      Http.jsonResponse({ data: [] }),
      Http.jsonResponse({
        data: resource('appStoreVersions', 'version-1', {
          platform: 'IOS',
          versionString: '1.2.3',
        }),
      }),
      new Response(undefined, { status: 204 }),
      Http.jsonResponse({
        data: resource('reviewSubmissions', 'review-1', {
          platform: 'IOS',
          submitted: false,
        }),
      }),
      Http.jsonResponse({ data: resource('reviewSubmissionItems', 'item-1', {}) }),
      Http.jsonResponse({
        data: resource('reviewSubmissions', 'review-1', {
          platform: 'IOS',
          state: 'READY_FOR_REVIEW',
          submitted: true,
        }),
      }),
    ])
    const client = clientWith(recorded.fetch)

    const version = await client.ensureAppStoreVersion('app-42', '1.2.3')
    await client.attachBuildToVersion(version.id, 'build-7')
    const review = await client.submitVersionForReview('app-42', version.id)

    Expect(review.attributes.submitted).toBe(true)
    Expect(recorded.requests.map(request => [request.method, new URL(request.url).pathname])).toEqual([
      ['GET', '/v1/apps/app-42/appStoreVersions'],
      ['POST', '/v1/appStoreVersions'],
      ['PATCH', '/v1/appStoreVersions/version-1/relationships/build'],
      ['POST', '/v1/reviewSubmissions'],
      ['POST', '/v1/reviewSubmissionItems'],
      ['PATCH', '/v1/reviewSubmissions/review-1'],
    ])
    Expect(recorded.requests[1]?.body).toEqual({
      data: {
        attributes: { platform: 'IOS', versionString: '1.2.3' },
        relationships: { app: { data: { id: 'app-42', type: 'apps' } } },
        type: 'appStoreVersions',
      },
    })
    Expect(recorded.requests[2]?.body).toEqual({ data: { id: 'build-7', type: 'builds' } })
    Expect(recorded.requests[3]?.body).toEqual({
      data: {
        attributes: { platform: 'IOS' },
        relationships: { app: { data: { id: 'app-42', type: 'apps' } } },
        type: 'reviewSubmissions',
      },
    })
    Expect(recorded.requests[4]?.body).toEqual({
      data: {
        relationships: {
          appStoreVersion: { data: { id: 'version-1', type: 'appStoreVersions' } },
          reviewSubmission: { data: { id: 'review-1', type: 'reviewSubmissions' } },
        },
        type: 'reviewSubmissionItems',
      },
    })
    Expect(recorded.requests[5]?.body).toEqual({
      data: {
        attributes: { submitted: true },
        id: 'review-1',
        type: 'reviewSubmissions',
      },
    })
  })

  Test('drives recorded TestFlight groups, testers, localizations, review, and team invitations', async () => {
    const recorded = recordedFetch([
      Http.jsonResponse({ data: [] }),
      Http.jsonResponse({
        data: resource('betaGroups', 'external-1', {
          isInternalGroup: false,
          name: 'Tao External',
        }),
      }),
      Http.jsonResponse({ data: [] }),
      Http.jsonResponse({ data: resource('betaTesters', 'tester-1', { email: 'friend@example.com' }) }),
      new Response(undefined, { status: 204 }),
      Http.jsonResponse({ data: [] }),
      Http.jsonResponse({
        data: resource('betaBuildLocalizations', 'build-loc-1', {
          locale: 'en-US',
          whatsNew: 'A quieter editor.',
        }),
      }),
      Http.jsonResponse({ data: [] }),
      Http.jsonResponse({
        data: resource('betaAppLocalizations', 'app-loc-1', {
          feedbackEmail: 'maker@example.com',
          locale: 'en-US',
        }),
      }),
      Http.jsonResponse({ data: [] }),
      Http.jsonResponse({
        data: resource('betaAppReviewSubmissions', 'beta-review-1', {
          betaReviewState: 'WAITING_FOR_REVIEW',
        }),
      }),
      Http.jsonResponse({ data: [] }),
      Http.jsonResponse({
        data: resource('userInvitations', 'invite-1', {
          allAppsVisible: false,
          email: 'teammate@example.com',
          firstName: 'Tao',
          lastName: 'Tester',
          roles: ['DEVELOPER'],
        }),
      }),
    ])
    const client = clientWith(recorded.fetch)

    const group = await client.ensureBetaGroup('app-42', 'Tao External', false)
    await client.ensureBetaTester('friend@example.com', group.id)
    await client.addBuildToBetaGroup(group.id, 'build-7')
    await client.setWhatToTest('build-7', 'A quieter editor.')
    await client.ensureBetaAppLocalization('app-42', { feedbackEmail: 'maker@example.com' })
    await client.submitBuildForBetaReview('build-7')
    Expect(await client.users('teammate@example.com')).toEqual([])
    await client.inviteUser({
      email: 'teammate@example.com',
      firstName: 'Tao',
      lastName: 'Tester',
      roles: ['DEVELOPER'],
      visibleAppIds: ['app-42'],
    })

    Expect(recorded.requests.map(request => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'GET /v1/betaGroups',
      'POST /v1/betaGroups',
      'GET /v1/betaTesters',
      'POST /v1/betaTesters',
      'POST /v1/betaGroups/external-1/relationships/builds',
      'GET /v1/builds/build-7/betaBuildLocalizations',
      'POST /v1/betaBuildLocalizations',
      'GET /v1/apps/app-42/betaAppLocalizations',
      'POST /v1/betaAppLocalizations',
      'GET /v1/betaAppReviewSubmissions',
      'POST /v1/betaAppReviewSubmissions',
      'GET /v1/users',
      'POST /v1/userInvitations',
    ])
    Expect(recorded.requests[3]?.body).toEqual({
      data: {
        attributes: { email: 'friend@example.com' },
        relationships: { betaGroups: { data: [{ id: 'external-1', type: 'betaGroups' }] } },
        type: 'betaTesters',
      },
    })
    Expect(recorded.requests[5]?.url).toBe(
      'https://api.appstoreconnect.apple.com/v1/builds/build-7/betaBuildLocalizations',
    )
    Expect(recorded.requests[7]?.url).toBe(
      'https://api.appstoreconnect.apple.com/v1/apps/app-42/betaAppLocalizations',
    )
    Expect(recorded.requests[12]?.body).toEqual({
      data: {
        attributes: {
          allAppsVisible: false,
          email: 'teammate@example.com',
          firstName: 'Tao',
          lastName: 'Tester',
          roles: ['DEVELOPER'],
        },
        relationships: { visibleApps: { data: [{ id: 'app-42', type: 'apps' }] } },
        type: 'userInvitations',
      },
    })
  })

  Test('leaves an existing beta tester in its requested group', async () => {
    const tester = resource('betaTesters', 'tester-1', { email: 'friend@example.com' })
    const group = resource('betaGroups', 'external-1', { isInternalGroup: false, name: 'Tao External' })
    const recorded = recordedFetch([
      Http.jsonResponse({ data: [tester] }),
      Http.jsonResponse({ data: [group] }),
    ])

    Expect(await clientWith(recorded.fetch).ensureBetaTester('friend@example.com', 'external-1')).toEqual(tester)
    Expect(recorded.requests.map(request => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'GET /v1/betaTesters',
      'GET /v1/betaTesters/tester-1/betaGroups',
    ])
  })

  Test('adds an existing beta tester when it is not yet in the requested group', async () => {
    const tester = resource('betaTesters', 'tester-1', { email: 'friend@example.com' })
    const recorded = recordedFetch([
      Http.jsonResponse({ data: [tester] }),
      Http.jsonResponse({ data: [] }),
      new Response(undefined, { status: 204 }),
    ])

    Expect(await clientWith(recorded.fetch).ensureBetaTester('friend@example.com', 'external-1')).toEqual(tester)
    Expect(recorded.requests.map(request => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'GET /v1/betaTesters',
      'GET /v1/betaTesters/tester-1/betaGroups',
      'POST /v1/betaGroups/external-1/relationships/betaTesters',
    ])
  })

  Test('enables automatic beta notifications only when they are disabled', async () => {
    const disabled = resource('buildBetaDetails', 'build-detail-1', { autoNotifyEnabled: false })
    const enabled = resource('buildBetaDetails', 'build-detail-1', { autoNotifyEnabled: true })
    const recorded = recordedFetch([
      Http.jsonResponse({ data: disabled }),
      Http.jsonResponse({ data: enabled }),
      Http.jsonResponse({ data: enabled }),
    ])
    const client = clientWith(recorded.fetch)

    Expect(await client.enableAutomaticBetaNotifications('build-7')).toEqual(enabled)
    Expect(await client.enableAutomaticBetaNotifications('build-7')).toEqual(enabled)
    Expect(recorded.requests.map(request => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'GET /v1/builds/build-7/buildBetaDetail',
      'PATCH /v1/buildBetaDetails/build-detail-1',
      'GET /v1/builds/build-7/buildBetaDetail',
    ])
    Expect(recorded.requests[1]?.body).toEqual({
      data: {
        attributes: { autoNotifyEnabled: true },
        id: 'build-detail-1',
        type: 'buildBetaDetails',
      },
    })
  })

  Test('updates existing beta app information required for external review', async () => {
    const existing = resource('betaAppLocalizations', 'app-loc-1', {
      feedbackEmail: 'friend@example.com',
      locale: 'en-US',
    })
    const updated = resource('betaAppLocalizations', 'app-loc-1', {
      description: 'A writing workspace.',
      feedbackEmail: 'friend@example.com',
      locale: 'en-US',
    })
    const recorded = recordedFetch([
      Http.jsonResponse({ data: [existing] }),
      Http.jsonResponse({ data: updated }),
    ])

    Expect(
      await clientWith(recorded.fetch).ensureBetaAppLocalization('app-42', {
        description: 'A writing workspace.',
        feedbackEmail: 'friend@example.com',
      }),
    ).toEqual(updated)
    Expect(recorded.requests.map(request => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'GET /v1/apps/app-42/betaAppLocalizations',
      'PATCH /v1/betaAppLocalizations/app-loc-1',
    ])
    Expect(recorded.requests[1]?.body).toEqual({
      data: {
        attributes: { description: 'A writing workspace.', feedbackEmail: 'friend@example.com' },
        id: 'app-loc-1',
        type: 'betaAppLocalizations',
      },
    })
  })

  Test('quotes Apple errors without exposing authorization material', async () => {
    const recorded = recordedFetch([Http.jsonResponse({
      errors: [{
        code: 'REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED',
        detail: 'A required agreement is missing or has expired.',
        status: '403',
      }],
    }, 403)])
    const promise = clientWith(recorded.fetch).bundleIds()

    await Expect(promise).rejects.toThrow('REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED')
    await Expect(promise).rejects.toThrow('"A required agreement is missing or has expired."')
    await Expect(promise).rejects.not.toThrow('recorded.jwt')
  })
})

function clientWith(fetch: AppStoreConnectFetch, clock?: AppStoreConnectClock): AppStoreConnectClient {
  return new AppStoreConnectClient({
    authorizationToken: () => 'recorded.jwt',
    clock,
    fetch,
  })
}

function recordedFetch(responses: readonly Response[]): {
  fetch: AppStoreConnectFetch
  requests: RecordedRequest[]
} {
  const remaining = [...responses]
  const requests: RecordedRequest[] = []
  return {
    fetch: async (url, init) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined
      requests.push({
        authorization: new Headers(init?.headers).get('authorization') ?? undefined,
        ...(body === undefined ? {} : { body }),
        method: init?.method ?? 'GET',
        url,
      })
      const response = remaining.shift()
      if (response === undefined) {
        Errors.throwUnexpected(`Expected: a recorded App Store Connect response for ${url}.`)
      }
      return response
    },
    requests,
  }
}

function resource(type: string, id: string, attributes: Record<string, unknown>): unknown {
  return { attributes, id, type }
}

function build(processingState: string): unknown {
  return resource('builds', 'build-7', {
    processingState,
    version: '202609021122',
  })
}
