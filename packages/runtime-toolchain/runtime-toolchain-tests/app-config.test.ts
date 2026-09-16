import type { ShipManifest } from '@runtime-toolchain'
import { FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

type ExpoAppConfig = {
  extra?: Record<string, unknown>
  icon?: string
  ios?: {
    buildNumber?: string
    bundleIdentifier?: string
    config?: { usesNonExemptEncryption?: boolean }
  }
  name: string
  plugins?: Array<string | [string, unknown]>
  runtimeVersion?: { policy: 'fingerprint' }
  slug: string
  splash?: { backgroundColor: string; image: string; resizeMode: string }
  updates?: {
    enabled: boolean
    requestHeaders: Record<string, string>
    url: string
  }
  version: string
}

const { createExpoAppConfig } = require('../app-config.cjs') as {
  createExpoAppConfig(
    config: ExpoAppConfig,
    projectRoot: string,
    env?: Record<string, string | undefined>,
  ): ExpoAppConfig
}

const fallbackConfig: ExpoAppConfig = {
  name: 'Tao Runtime',
  slug: 'tao-runtime',
  version: '1.0.0',
}

const sceneLifecyclePlugin: [string, unknown] = [
  'expo-build-properties',
  { ios: { enableSceneSupport: true } },
]

const shipManifest: ShipManifest = {
  buildNumber: '202609021545',
  bundleIdentifier: 'lang.tao.wordflower.instantdb',
  git: { commit: 'abc1234', dirty: true },
  icon: 'badged',
  ios: { usesNonExemptEncryption: false },
  name: 'WordFlower InstantDB',
  schemaVersion: 1,
  slug: 'wordflower-instantdb',
  updates: {
    channel: 'wordflower-instantdb',
    runtimeFingerprint: 'native-fingerprint-1',
    runtimeVersion: { policy: 'fingerprint' },
    url: 'https://updates.tao-lang.org/v1/wordflower-instantdb',
  },
  version: '1.2.3',
}

Describe('Expo ship host configuration', () => {
  Test('preserves the checked-in development configuration when no ship manifest exists', async () => {
    const projectRoot = await mkTestDir('tao-app-config-fallback-')

    Expect(createExpoAppConfig(fallbackConfig, projectRoot, {})).toBe(fallbackConfig)
  })

  Test('writes the dev data bootstrap fact the dev loop places in the environment, and only then', async () => {
    const projectRoot = await mkTestDir('tao-app-config-dev-data-')

    const configured = createExpoAppConfig(fallbackConfig, projectRoot, {
      TAO_DEV_DATA_APP: 'Notes-0123abcd',
      TAO_DEV_DATA_PORT: '4321',
    })
    Expect(configured.extra).toEqual({
      taoDevData: { app: 'Notes-0123abcd', port: 4_321, protocol: 'tao-dev-data-v1' },
    })
    Expect(configured.name).toBe('Tao Runtime')

    Expect(createExpoAppConfig(fallbackConfig, projectRoot, { TAO_DEV_DATA_PORT: '4321' })).toBe(fallbackConfig)
    Expect(createExpoAppConfig(fallbackConfig, projectRoot, { TAO_DEV_DATA_APP: 'Notes', TAO_DEV_DATA_PORT: 'x' }))
      .toBe(fallbackConfig)
  })

  Test('derives the iOS release and update configuration from ship.json', async () => {
    const projectRoot = await mkTestDir('tao-app-config-release-')
    await FS.writeJson(FS.resolvePath('_gen_tao-app/ship.json', projectRoot), shipManifest)

    const config = createExpoAppConfig({
      ...fallbackConfig,
      extra: { retained: true },
      ios: { config: {} },
      plugins: [sceneLifecyclePlugin],
    }, projectRoot)

    Expect(config).toEqual({
      name: 'WordFlower InstantDB',
      slug: 'wordflower-instantdb',
      version: '1.2.3',
      icon: './assets/tao-app-icon-badged.png',
      plugins: [sceneLifecyclePlugin, './plugins/with-ios-fmt-compat.cjs'],
      splash: {
        backgroundColor: '#171b2d',
        image: './assets/tao-app-icon.png',
        resizeMode: 'contain',
      },
      ios: {
        buildNumber: '202609021545',
        bundleIdentifier: 'lang.tao.wordflower.instantdb',
        config: { usesNonExemptEncryption: false },
      },
      runtimeVersion: { policy: 'fingerprint' },
      updates: {
        enabled: true,
        requestHeaders: { 'expo-channel-name': 'wordflower-instantdb' },
        url: 'https://updates.tao-lang.org/v1/wordflower-instantdb',
      },
      extra: {
        retained: true,
        tao: {
          ship: {
            channel: 'wordflower-instantdb',
            git: { commit: 'abc1234', dirty: true },
            runtimeFingerprint: 'native-fingerprint-1',
            schemaVersion: 1,
          },
        },
      },
    })
  })

  Test('uses the unbadged default and leaves updates disabled for a binary-only manifest', async () => {
    const projectRoot = await mkTestDir('tao-app-config-binary-')
    await FS.writeJson(
      FS.resolvePath('_gen_tao-app/ship.json', projectRoot),
      {
        ...shipManifest,
        icon: 'default',
        updates: undefined,
      } satisfies ShipManifest,
    )

    const config = createExpoAppConfig(fallbackConfig, projectRoot)

    Expect(config.icon).toBe('./assets/tao-app-icon.png')
    Expect(config.runtimeVersion).toBeUndefined()
    Expect(config.updates).toBeUndefined()
  })

  Test('applies the iCloud entitlement plugin with the manifest containers', async () => {
    const projectRoot = await mkTestDir('tao-app-config-icloud-')
    await FS.writeJson(
      FS.resolvePath('_gen_tao-app/ship.json', projectRoot),
      {
        ...shipManifest,
        icloud: { containers: ['iCloud.lang.tao.wordflower'], services: ['CloudKit'] },
      } satisfies ShipManifest,
    )

    const config = createExpoAppConfig(fallbackConfig, projectRoot)

    Expect(config.plugins).toEqual([
      './plugins/with-ios-fmt-compat.cjs',
      ['tao-icloud-native', { containers: ['iCloud.lang.tao.wordflower'], services: ['CloudKit'] }],
    ])
  })

  Test('ships opaque square iOS assets for the default and badged variant', async () => {
    for (const name of ['tao-app-icon.png', 'tao-app-icon-badged.png']) {
      const bytes = await FS.readFile(Repo.resolvePath(`packages/runtime-toolchain/assets/${name}`))
      const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

      Expect(header.getUint32(16)).toBe(1024)
      Expect(header.getUint32(20)).toBe(1024)
      // PNG color type 2 is RGB without alpha, as required for App Store icon assets.
      Expect(header.getUint8(25)).toBe(2)
    }
  })
})
