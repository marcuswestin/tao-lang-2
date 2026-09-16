import Runtime from '@runtime-toolchain'
import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { createUpdateService } from 'tao-update-server'
import { TaoUpdateClient } from '../cli-src/tao-update-client'

const baseUrl = 'https://updates.tao-lang.dev'
const fixtureHashes = {
  bundle: 'lNbXzvK7mvafG8gVkYeQwcc7qC-YPWbLY59pUcspXyo',
  'image-content-hash': 'D0Y2x49l02OezloGS1rnU-NAhhShT7GKtNdUDSwkhUM',
} as const

Describe('OTA export artifacts', () => {
  Test('publishes Expo metadata artifacts and resolves every URL in the installed manifest', async () => {
    const exportRoot = await mkTestDir('tao-ota-export-')
    const launchBytes = new TextEncoder().encode('compiled Hermes bundle')
    const imageBytes = new Uint8Array([137, 80, 78, 71])
    await FS.writeFile(FS.resolvePath('_expo/static/js/ios/App.hbc', exportRoot), launchBytes)
    await FS.writeFile(FS.resolvePath('assets/image-content-hash', exportRoot), imageBytes)
    await FS.writeJson(FS.resolvePath('metadata.json', exportRoot), {
      bundler: 'metro',
      fileMetadata: {
        ios: {
          assets: [{ ext: 'png', path: 'assets/image-content-hash' }],
          bundle: '_expo/static/js/ios/App.hbc',
        },
      },
      version: 0,
    })
    const updateService = createUpdateService({
      authorize: candidate => candidate === 'update-admin.jwt',
      clock: () => new Date('2026-09-16T12:00:00.000Z'),
      createUpdateId: () => 'update-1',
      publicBaseUrl: baseUrl,
    })
    const client = new TaoUpdateClient({
      authorizationToken: () => 'update-admin.jwt',
      baseUrl,
      fetch: (input, init) => updateService.handle(new Request(input, init)),
    })
    const artifacts = await Runtime.expoUpdateArtifacts(exportRoot, 'ios')
    const launchAsset = await uploadArtifact(client, 'wordflower', artifacts.launchAsset)
    const assets = await Promise.all(
      artifacts.assets.map(async artifact => await uploadArtifact(client, 'wordflower', artifact)),
    )

    await client.publish({
      applicationId: 'wordflower',
      assets,
      channel: 'stable',
      dataSchemaFingerprint: 'schema-1',
      launchAsset,
      metadata: { platform: 'ios' },
      runtimeVersion: 'native-fingerprint-1',
    })
    const manifest = await client.fetchManifest({
      applicationId: 'wordflower',
      channel: 'stable',
      platform: 'ios',
      runtimeVersion: 'native-fingerprint-1',
    })

    Expect(manifest?.runtimeVersion).toBe('native-fingerprint-1')
    const resolved = await Promise.all([manifest!.launchAsset, ...manifest!.assets].map(async asset => {
      const response = await updateService.handle(new Request(asset.url))
      return {
        bytes: [...new Uint8Array(await response.arrayBuffer())],
        contentType: response.headers.get('content-type'),
        status: response.status,
        url: asset.url,
      }
    }))
    Expect(resolved).toEqual([
      {
        bytes: [...launchBytes],
        contentType: 'application/javascript',
        status: 200,
        url: `${baseUrl}/assets/${fixtureHashes.bundle}.hbc`,
      },
      {
        bytes: [...imageBytes],
        contentType: 'image/png',
        status: 200,
        url: `${baseUrl}/assets/${fixtureHashes['image-content-hash']}.png`,
      },
    ])
  })
})

async function uploadArtifact(
  client: TaoUpdateClient,
  applicationId: string,
  artifact: Awaited<ReturnType<typeof Runtime.expoUpdateArtifacts>>['launchAsset'],
) {
  const bytes = await FS.readFile(artifact.path)
  return await client.uploadAsset({
    applicationId,
    bytes,
    contentType: artifact.contentType,
    fileExtension: artifact.fileExtension,
    hash: fixtureHashes[artifact.key as keyof typeof fixtureHashes],
    key: artifact.key,
  })
}
