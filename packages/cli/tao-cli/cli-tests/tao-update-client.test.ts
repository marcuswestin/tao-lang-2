import { Errors, Http } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  assertUpdateCompatibility,
  expoUpdateResponseHeaders,
  type TaoPublishedUpdate,
  TaoUpdateClient,
  type TaoUpdateFetch,
} from '../cli-src/tao-update-client'

type RecordedRequest = {
  body?: unknown
  headers: Record<string, string>
  method: string
  url: string
}

Describe('Tao expo-updates service client', () => {
  Test('pins Tao response headers to the open Expo Updates v1 contract', () => {
    Expect(expoUpdateResponseHeaders()).toEqual({
      'cache-control': 'private, max-age=0',
      'content-type': 'application/expo+json',
      'expo-protocol-version': '1',
      'expo-sfv-version': '0',
    })
  })

  Test('publishes a release bundle through the Tao management endpoint', async () => {
    const published = publication('update-2', '2026-09-02T16:00:00.000Z')
    const recorded = recordedFetch([Http.jsonResponse(published)])
    const client = updateClient(recorded.fetch)

    Expect(
      await client.publish({
        applicationId: 'wordflower',
        assets: published.manifest.assets,
        channel: 'wordflower-instantdb',
        dataSchemaFingerprint: 'schema-1',
        extra: { tao: { commit: 'abc123' } },
        launchAsset: published.manifest.launchAsset,
        message: 'Clarify the empty state.',
        metadata: { channel: 'wordflower-instantdb' },
        runtimeVersion: 'native-1',
      }),
    ).toEqual(published)

    Expect(recorded.requests).toEqual([{
      body: {
        data: {
          assets: [{
            contentType: 'image/png',
            fileExtension: '.png',
            hash: 'asset-hash',
            key: 'icon',
            url: 'https://updates.devtao.com/assets/asset-hash.png',
          }],
          dataSchemaFingerprint: 'schema-1',
          extra: { tao: { commit: 'abc123' } },
          launchAsset: {
            contentType: 'application/javascript',
            hash: 'launch-hash',
            key: 'launch',
            url: 'https://updates.devtao.com/assets/launch-hash.js',
          },
          message: 'Clarify the empty state.',
          metadata: { channel: 'wordflower-instantdb' },
          runtimeVersion: 'native-1',
        },
        protocolVersion: 1,
      },
      headers: {
        accept: 'application/json',
        authorization: 'Bearer update-admin.jwt',
        'content-type': 'application/json',
      },
      method: 'POST',
      url: 'https://updates.devtao.com/v1/apps/wordflower/channels/wordflower-instantdb/updates',
    }])
  })

  Test('uploads hash-addressed immutable asset bytes before publication', async () => {
    const uploaded = {
      contentType: 'application/javascript',
      hash: 'launch-hash',
      key: 'launch',
      url: 'https://updates.devtao.com/assets/launch-hash.js',
    }
    const recorded = recordedFetch([Http.jsonResponse(uploaded)])

    Expect(
      await updateClient(recorded.fetch).uploadAsset({
        applicationId: 'wordflower',
        bytes: new Uint8Array([116, 97, 111]),
        contentType: 'application/javascript',
        hash: 'launch-hash',
        key: 'launch',
      }),
    ).toEqual(uploaded)
    Expect(recorded.requests).toEqual([{
      body: [116, 97, 111],
      headers: {
        accept: 'application/json',
        authorization: 'Bearer update-admin.jwt',
        'content-type': 'application/javascript',
        'tao-asset-key': 'launch',
      },
      method: 'PUT',
      url: 'https://updates.devtao.com/v1/apps/wordflower/assets/launch-hash',
    }])
  })

  Test('rolls back by reading and republishing the earlier immutable bundle', async () => {
    const earlier = publication('update-1', '2026-09-02T15:00:00.000Z')
    const rollback = {
      ...publication('update-3', '2026-09-02T17:00:00.000Z'),
      sourceUpdateId: 'update-1',
    }
    const recorded = recordedFetch([Http.jsonResponse(earlier), Http.jsonResponse(rollback)])
    const client = updateClient(recorded.fetch)

    Expect(
      await client.rollback({
        applicationId: 'wordflower',
        channel: 'wordflower-instantdb',
        toUpdateId: 'update-1',
      }),
    ).toEqual(rollback)

    Expect(recorded.requests.map(request => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'GET /v1/apps/wordflower/channels/wordflower-instantdb/updates/update-1',
      'POST /v1/apps/wordflower/channels/wordflower-instantdb/updates',
    ])
    Expect(recorded.requests[1]?.body).toEqual({
      data: {
        assets: earlier.manifest.assets,
        dataSchemaFingerprint: 'schema-1',
        extra: earlier.manifest.extra,
        launchAsset: earlier.manifest.launchAsset,
        message: 'Rollback to update-1',
        metadata: earlier.manifest.metadata,
        runtimeVersion: 'native-1',
        sourceUpdateId: 'update-1',
      },
      protocolVersion: 1,
    })
  })

  Test('selects rollback from compatible history instead of toggling between the last two publications', async () => {
    const oldestCompatible = publication('update-1', '2026-09-02T13:00:00.000Z')
    const previousSource = publication('update-2', '2026-09-02T14:00:00.000Z')
    const incompatible = publication('update-3', '2026-09-02T15:00:00.000Z', {
      runtimeVersion: 'native-2',
    })
    const current = publication('update-4', '2026-09-02T16:00:00.000Z', {
      sourceUpdateId: 'update-2',
    })
    const nextRollback = publication('update-5', '2026-09-02T17:00:00.000Z', {
      sourceUpdateId: 'update-1',
    })
    const recorded = recordedFetch([
      Http.jsonResponse({ updates: [current, incompatible, previousSource, oldestCompatible] }),
      Http.jsonResponse(nextRollback),
    ])
    const client = updateClient(recorded.fetch)

    Expect(
      await client.rollbackCompatible({
        applicationId: 'wordflower',
        channel: 'wordflower-instantdb',
        currentUpdateId: 'update-4',
        supportedBinaries: [{
          dataSchemaFingerprint: 'schema-1',
          platform: 'ios',
          runtimeVersion: 'native-1',
        }],
      }),
    ).toEqual(nextRollback)

    Expect(recorded.requests.map(request => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'GET /v1/apps/wordflower/channels/wordflower-instantdb/updates',
      'POST /v1/apps/wordflower/channels/wordflower-instantdb/updates',
    ])
    Expect((recorded.requests[1]?.body as { data: { sourceUpdateId: string } }).data.sourceUpdateId).toBe('update-1')
  })

  Test('checks the same public manifest request the installed expo-updates client makes', async () => {
    const published = publication('update-2', '2026-09-02T16:00:00.000Z')
    const recorded = recordedFetch([
      new Response(JSON.stringify(published.manifest), {
        headers: expoUpdateResponseHeaders(),
        status: 200,
      }),
    ])

    Expect(
      await updateClient(recorded.fetch).fetchManifest({
        applicationId: 'wordflower',
        channel: 'wordflower-instantdb',
        platform: 'ios',
        runtimeVersion: 'native-1',
      }),
    ).toEqual(published.manifest)
    Expect(recorded.requests[0]).toEqual({
      headers: {
        accept: 'application/expo+json, application/json;q=0.9, multipart/mixed;q=0.8',
        'expo-channel-name': 'wordflower-instantdb',
        'expo-platform': 'ios',
        'expo-protocol-version': '1',
        'expo-runtime-version': 'native-1',
      },
      method: 'GET',
      url: 'https://updates.devtao.com/v1/apps/wordflower/manifest',
    })
  })

  Test('refuses updates incompatible with the installed native runtime or Tao data envelope', () => {
    const installed = { dataSchemaFingerprint: 'schema-1', runtimeVersion: 'native-1' }

    Expect(() =>
      assertUpdateCompatibility({
        dataSchemaFingerprint: 'schema-1',
        runtimeVersion: 'native-2',
      }, installed)
    ).toThrow('Ship a new binary instead')
    Expect(() =>
      assertUpdateCompatibility({
        dataSchemaFingerprint: 'schema-2',
        runtimeVersion: 'native-1',
      }, installed)
    ).toThrow('installed build cannot migrate')
    Expect(() =>
      assertUpdateCompatibility({
        dataSchemaFingerprint: 'schema-1',
        runtimeVersion: 'native-1',
      }, installed)
    ).not.toThrow()

    Expect(() =>
      assertUpdateCompatibility({
        dataSchemaFingerprint: 'schema-1',
        runtimeVersion: 'native-1',
      }, [
        { dataSchemaFingerprint: 'schema-1', platform: 'ios', runtimeVersion: 'native-1' },
        { dataSchemaFingerprint: 'schema-old', platform: 'ios', runtimeVersion: 'native-old' },
      ])
    ).toThrow('every supported build')
  })

  Test('rejects mutable or insecure asset locations before sending authorization', async () => {
    const recorded = recordedFetch([])
    const client = updateClient(recorded.fetch)

    await Expect(client.publish({
      applicationId: 'wordflower',
      assets: [],
      channel: 'stable',
      dataSchemaFingerprint: 'schema-1',
      launchAsset: {
        contentType: 'application/javascript',
        key: 'launch',
        url: 'http://updates.devtao.com/launch.js',
      },
      runtimeVersion: 'native-1',
    })).rejects.toThrow('absolute HTTPS URL')
    Expect(recorded.requests).toEqual([])
  })
})

function updateClient(fetch: TaoUpdateFetch): TaoUpdateClient {
  return new TaoUpdateClient({
    authorizationToken: () => 'update-admin.jwt',
    baseUrl: 'https://updates.devtao.com',
    fetch,
  })
}

function publication(
  id: string,
  createdAt: string,
  overrides: {
    dataSchemaFingerprint?: string
    runtimeVersion?: string
    sourceUpdateId?: string
  } = {},
): TaoPublishedUpdate {
  return {
    applicationId: 'wordflower',
    channel: 'wordflower-instantdb',
    dataSchemaFingerprint: overrides.dataSchemaFingerprint ?? 'schema-1',
    manifest: {
      assets: [{
        contentType: 'image/png',
        fileExtension: '.png',
        hash: 'asset-hash',
        key: 'icon',
        url: 'https://updates.devtao.com/assets/asset-hash.png',
      }],
      createdAt,
      extra: { tao: { commit: 'abc123' } },
      id,
      launchAsset: {
        contentType: 'application/javascript',
        hash: 'launch-hash',
        key: 'launch',
        url: 'https://updates.devtao.com/assets/launch-hash.js',
      },
      metadata: { channel: 'wordflower-instantdb' },
      runtimeVersion: overrides.runtimeVersion ?? 'native-1',
    },
    ...(overrides.sourceUpdateId === undefined ? {} : { sourceUpdateId: overrides.sourceUpdateId }),
  }
}

function recordedFetch(responses: readonly Response[]): {
  fetch: TaoUpdateFetch
  requests: RecordedRequest[]
} {
  const remaining = [...responses]
  const requests: RecordedRequest[] = []
  return {
    fetch: async (url, init) => {
      const headers = Object.fromEntries(new Headers(init?.headers).entries())
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as unknown
        : init?.body instanceof Uint8Array
        ? [...init.body]
        : undefined
      requests.push({
        ...(body === undefined ? {} : { body }),
        headers,
        method: init?.method ?? 'GET',
        url,
      })
      const response = remaining.shift()
      if (response === undefined) {
        Errors.throwUnexpected(`Expected: a recorded Tao update service response for ${url}.`)
      }
      return response
    },
    requests,
  }
}
