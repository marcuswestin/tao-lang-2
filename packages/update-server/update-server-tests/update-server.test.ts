import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { createHash } from 'node:crypto'
import { createUpdateService, type ExpoUpdateAsset, type UpdateService } from '../update-server-src/update-service'
import { FilesystemUpdateStore, InMemoryUpdateStore } from '../update-server-src/update-store'

const baseUrl = 'https://updates.tao-lang.dev'
const token = 'update-admin.jwt'

type RecordedRequest = {
  authenticated: boolean
  method: string
  path: string
}

Describe('Tao update protocol server', () => {
  Test('stores immutable hash-addressed assets and serves their public bytes', async () => {
    const recorded = recordedService(service())
    const bytes = new TextEncoder().encode('console.log("tao")')
    const hash = hashBytes(bytes)
    const request = assetUploadRequest(hash, bytes)

    const created = await recorded.handle(request)
    Expect(created.status).toBe(201)
    Expect(await created.json()).toEqual({
      contentType: 'application/javascript',
      fileExtension: '.js',
      hash,
      key: 'launch',
      url: `${baseUrl}/assets/${hash}.js`,
    })
    Expect((await recorded.handle(assetUploadRequest(hash, bytes))).status).toBe(200)
    const reused = await recorded.handle(assetUploadRequest(hash, bytes, { key: 'same-content-other-key' }))
    Expect(reused.status).toBe(200)
    Expect((await reused.json() as { key: string }).key).toBe('same-content-other-key')

    const conflicting = assetUploadRequest(hash, bytes, { contentType: 'text/javascript' })
    const conflict = await recorded.handle(conflicting)
    Expect(conflict.status).toBe(409)
    Expect(await conflict.text()).toContain('immutable')

    const downloaded = await recorded.handle(new Request(`${baseUrl}/assets/${hash}.js`))
    Expect(downloaded.status).toBe(200)
    Expect(downloaded.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    Expect([...new Uint8Array(await downloaded.arrayBuffer())]).toEqual([...bytes])
    Expect(recorded.requests).toEqual([
      { authenticated: true, method: 'PUT', path: `/v1/apps/wordflower/assets/${hash}` },
      { authenticated: true, method: 'PUT', path: `/v1/apps/wordflower/assets/${hash}` },
      { authenticated: true, method: 'PUT', path: `/v1/apps/wordflower/assets/${hash}` },
      { authenticated: true, method: 'PUT', path: `/v1/apps/wordflower/assets/${hash}` },
      { authenticated: false, method: 'GET', path: `/assets/${hash}.js` },
    ])
  })

  Test('publishes history and selects the newest manifest by channel, platform, and runtime', async () => {
    const ids = ['ios-1', 'android-1', 'ios-2']
    const updateService = service({ createUpdateId: () => ids.shift()! })
    const recorded = recordedService(updateService)
    const asset = await uploadLaunchAsset(recorded.handle)

    const iosFirst = await publish(recorded.handle, asset, {
      message: 'First iOS update',
      metadata: { platform: 'ios' },
    })
    const android = await publish(recorded.handle, asset, {
      metadata: { platform: 'android' },
    })
    const iosLatest = await publish(recorded.handle, asset, {
      message: 'Second iOS update',
      metadata: { platform: 'ios' },
      sourceUpdateId: iosFirst.manifest.id,
    })

    Expect(android.manifest.id).toBe('android-1')
    Expect(iosLatest.sourceUpdateId).toBe('ios-1')

    const byId = await recorded.handle(authorizedRequest(
      `${baseUrl}/v1/apps/wordflower/channels/stable/updates/ios-1`,
    ))
    Expect(byId.status).toBe(200)
    Expect((await byId.json() as { manifest: { id: string } }).manifest.id).toBe('ios-1')

    const history = await recorded.handle(authorizedRequest(
      `${baseUrl}/v1/apps/wordflower/channels/stable/updates`,
    ))
    Expect((await history.json() as { updates: Array<{ manifest: { id: string } }> }).updates
      .map(update => update.manifest.id)).toEqual(['ios-2', 'android-1', 'ios-1'])

    const iosManifest = await recorded.handle(manifestRequest('stable', 'ios', 'native-1'))
    Expect(iosManifest.status).toBe(200)
    Expect(iosManifest.headers.get('content-type')).toBe('application/expo+json')
    Expect((await iosManifest.json() as { id: string }).id).toBe('ios-2')

    const androidManifest = await recorded.handle(manifestRequest('stable', 'android', 'native-1'))
    Expect((await androidManifest.json() as { id: string }).id).toBe('android-1')

    const noCompatibleUpdate = await recorded.handle(manifestRequest('stable', 'ios', 'native-2'))
    Expect(noCompatibleUpdate.status).toBe(204)
    Expect(await noCompatibleUpdate.text()).toBe('')
  })

  Test('requires management authorization without reflecting or recording tokens', async () => {
    const recorded = recordedService(service())
    const secret = 'do-not-reflect-this-token'
    const response = await recorded.handle(
      new Request(
        `${baseUrl}/v1/apps/wordflower/channels/stable/updates`,
        { headers: { authorization: `Bearer ${secret}` } },
      ),
    )

    Expect(response.status).toBe(401)
    Expect(await response.text()).not.toContain(secret)
    Expect(recorded.requests).toEqual([{
      authenticated: true,
      method: 'GET',
      path: '/v1/apps/wordflower/channels/stable/updates',
    }])
  })

  Test('persists publications and assets without persisting the administration token', async () => {
    const root = await mkTestDir('tao-update-server-')
    try {
      const first = service({
        createUpdateId: () => 'persisted-1',
        store: new FilesystemUpdateStore(root),
      })
      const asset = await uploadLaunchAsset(first.handle)
      await publish(first.handle, asset, { metadata: { platform: 'ios' } })

      const second = service({ store: new FilesystemUpdateStore(root) })
      const response = await second.handle(authorizedRequest(
        `${baseUrl}/v1/apps/wordflower/channels/stable/updates/persisted-1`,
      ))
      Expect(response.status).toBe(200)
      Expect((await response.json() as { manifest: { id: string } }).manifest.id).toBe('persisted-1')

      const storedText: string[] = []
      for await (const path of FS.walk(root)) {
        if (FS.extname(path) === '.json') {
          storedText.push(await FS.readText(path))
        }
      }
      Expect(storedText.join('\n')).not.toContain(token)
    } finally {
      await FS.remove(root)
    }
  })

  Test('refuses bytes that do not match the hash-addressed upload path', async () => {
    const updateService = service()
    const response = await updateService.handle(assetUploadRequest(
      hashBytes(new TextEncoder().encode('expected')),
      new TextEncoder().encode('different'),
    ))

    Expect(response.status).toBe(400)
    Expect(await response.text()).toContain('does not match')
  })
})

function service(options: {
  createUpdateId?: () => string
  store?: FilesystemUpdateStore | InMemoryUpdateStore
} = {}): UpdateService {
  return createUpdateService({
    authorize: candidate => candidate === token,
    clock: () => new Date('2026-09-02T16:00:00.000Z'),
    createUpdateId: options.createUpdateId ?? (() => 'update-1'),
    publicBaseUrl: baseUrl,
    store: options.store ?? new InMemoryUpdateStore(),
  })
}

function recordedService(updateService: UpdateService): {
  handle(request: Request): Promise<Response>
  requests: RecordedRequest[]
} {
  const requests: RecordedRequest[] = []
  return {
    handle: async request => {
      requests.push({
        authenticated: request.headers.has('authorization'),
        method: request.method,
        path: new URL(request.url).pathname,
      })
      return await updateService.handle(request)
    },
    requests,
  }
}

function assetUploadRequest(
  hash: string,
  bytes: Uint8Array,
  options: { contentType?: string; key?: string } = {},
): Request {
  return authorizedRequest(`${baseUrl}/v1/apps/wordflower/assets/${hash}`, {
    body: bytes,
    headers: {
      'content-type': options.contentType ?? 'application/javascript',
      'tao-asset-key': options.key ?? 'launch',
      'tao-file-extension': '.js',
    },
    method: 'PUT',
  })
}

async function uploadLaunchAsset(handle: (request: Request) => Promise<Response>): Promise<ExpoUpdateAsset> {
  const bytes = new TextEncoder().encode('console.log("release")')
  const response = await handle(assetUploadRequest(hashBytes(bytes), bytes))
  Expect(response.ok).toBe(true)
  return await response.json() as ExpoUpdateAsset
}

async function publish(
  handle: (request: Request) => Promise<Response>,
  asset: ExpoUpdateAsset,
  overrides: {
    message?: string
    metadata?: Readonly<Record<string, string>>
    sourceUpdateId?: string
  } = {},
): Promise<{ manifest: { id: string }; sourceUpdateId?: string }> {
  const response = await handle(authorizedRequest(
    `${baseUrl}/v1/apps/wordflower/channels/stable/updates`,
    {
      body: JSON.stringify({
        data: {
          assets: [],
          dataSchemaFingerprint: 'schema-1',
          extra: { tao: { commit: 'abc123' } },
          launchAsset: asset,
          message: overrides.message,
          metadata: overrides.metadata ?? {},
          runtimeVersion: 'native-1',
          sourceUpdateId: overrides.sourceUpdateId,
        },
        protocolVersion: 1,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
  ))
  Expect(response.status).toBe(201)
  return await response.json() as { manifest: { id: string }; sourceUpdateId?: string }
}

function manifestRequest(channel: string, platform: 'android' | 'ios', runtimeVersion: string): Request {
  return new Request(`${baseUrl}/v1/apps/wordflower/manifest`, {
    headers: {
      accept: 'application/expo+json, application/json;q=0.9',
      'expo-channel-name': channel,
      'expo-platform': platform,
      'expo-protocol-version': '1',
      'expo-runtime-version': runtimeVersion,
    },
  })
}

function authorizedRequest(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  return new Request(url, { ...init, headers })
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64url')
}
