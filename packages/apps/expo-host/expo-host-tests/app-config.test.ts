import type { ShipManifest } from '@expo-host'
import { FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

type ExpoAppConfig = {
  extra?: Record<string, unknown>
  icon?: string
  ios?: {
    buildNumber?: string
    bundleIdentifier?: string
    config?: { usesNonExemptEncryption?: boolean }
    infoPlist?: Record<string, unknown>
    userInterfaceStyle?: 'automatic' | 'dark' | 'light'
  }
  name: string
  plugins?: Array<string | [string, unknown]>
  runtimeVersion?: string
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

const { getConfig } = require('expo/config') as {
  getConfig(projectRoot: string): { exp: ExpoAppConfig }
}
const { compileModsAsync, withPlugins } = require('expo/config-plugins') as {
  compileModsAsync(
    config: ExpoAppConfig,
    options: { projectRoot: string; platforms: string[]; introspect: boolean; ignoreExistingNativeFiles: boolean },
  ): Promise<ExpoAppConfig>
  withPlugins(
    config: ExpoAppConfig & { _internal: { projectRoot: string } },
    plugins: NonNullable<ExpoAppConfig['plugins']>,
  ): ExpoAppConfig
}

const fallbackConfig: ExpoAppConfig = {
  name: 'Tao Runtime',
  slug: 'tao-runtime',
  version: '1.0.0',
  plugins: ['expo-media-library', 'expo-file-system'],
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
    runtimeVersion: 'native-fingerprint-1',
    url: 'https://updates.devtao.com/v1/wordflower-instantdb',
  },
  version: '1.2.3',
}

Describe('Expo ship host configuration', () => {
  Test('includes Photos and Files plugins in development and shipped native hosts', async () => {
    const projectRoot = await mkTestDir('tao-app-config-native-')
    const config: ExpoAppConfig = { name: 'Native App', slug: 'native-app', version: '1.0.0' }
    try {
      Expect(createExpoAppConfig(config, projectRoot, {}).plugins).toEqual(['expo-media-library', 'expo-file-system'])
      await FS.writeJson(FS.resolvePath('_gen_tao-app/ship.json', projectRoot), shipManifest)
      Expect(createExpoAppConfig(config, projectRoot, {}).plugins).toEqual([
        'expo-media-library',
        'expo-file-system',
        './plugins/with-ios-fmt-compat.cjs',
      ])
      Expect(config.plugins).toBeUndefined()
    } finally {
      await FS.remove(projectRoot)
    }
  })

  Test('preserves custom native plugin options without duplicating their registration', async () => {
    const projectRoot = await mkTestDir('tao-app-config-native-options-')
    const config: ExpoAppConfig = {
      ...fallbackConfig,
      ios: { infoPlist: { NSPhotoLibraryUsageDescription: 'Read selected project photos.' } },
      plugins: [
        sceneLifecyclePlugin,
        ['expo-media-library', {
          granularPermissions: ['photo'],
          photosPermission: false,
          savePhotosPermission: 'Save project photos.',
        }],
        ['expo-file-system', { enableFileSharing: true, supportsOpeningDocumentsInPlace: false }],
      ],
    }
    try {
      Expect(createExpoAppConfig(config, projectRoot, {})).toBe(config)
      await FS.writeJson(FS.resolvePath('_gen_tao-app/ship.json', projectRoot), shipManifest)
      const shipped = createExpoAppConfig(config, projectRoot, {})
      Expect(shipped.plugins).toEqual([...config.plugins!, './plugins/with-ios-fmt-compat.cjs'])
      Expect(shipped.ios?.infoPlist).toEqual({ NSPhotoLibraryUsageDescription: 'Read selected project photos.' })
    } finally {
      await FS.remove(projectRoot)
    }
  })

  Test('resolves the copied host build configuration and native permission settings through Expo', async () => {
    const projectRoot = await mkTestDir('tao-app-config-expo-native-')
    try {
      for (const file of ['app.config.js', 'app-config.cjs', 'package.json']) {
        await FS.copyFile(Repo.resolvePath(`packages/apps/expo-host/${file}`), FS.resolvePath(file, projectRoot))
      }
      await FS.replaceSymlink(
        Repo.resolvePath('packages/apps/expo-host/node_modules'),
        FS.resolvePath('node_modules', projectRoot),
      )
      await FS.writeJson(FS.resolvePath('app.json', projectRoot), {
        expo: {
          name: 'Native App',
          slug: 'native-app',
          version: '1.0.0',
          ios: { infoPlist: { NSPhotoLibraryUsageDescription: 'Read project photos.', UIFileSharingEnabled: false } },
          plugins: [['expo-file-system', { supportsOpeningDocumentsInPlace: true }]],
        },
      })
      const config = getConfig(projectRoot).exp
      Expect(config.plugins).toEqual([
        ['expo-file-system', { supportsOpeningDocumentsInPlace: true }],
        'expo-media-library',
      ])
      // getConfig returns serializable build JSON with its mods removed. Prebuild evaluates plugins
      // again before compiling native mods; introspection follows that path without writing a project.
      const prebuild = withPlugins({ ...config, _internal: { projectRoot } }, config.plugins ?? [])
      const native = await compileModsAsync(prebuild, {
        projectRoot,
        platforms: ['ios'],
        introspect: true,
        ignoreExistingNativeFiles: true,
      })
      Expect(native.ios?.infoPlist).toMatchObject({
        NSPhotoLibraryUsageDescription: 'Read project photos.',
        NSPhotoLibraryAddUsageDescription: 'Allow $(PRODUCT_NAME) to save photos',
        LSSupportsOpeningDocumentsInPlace: true,
        UIFileSharingEnabled: false,
      })
      Expect(native.ios?.infoPlist?.['PHPhotoLibraryPreventAutomaticLimitedAccessAlert']).toBeUndefined()
      Expect(await FS.isDirectory(FS.resolvePath('ios', projectRoot))).toBe(false)
    } finally {
      await FS.remove(projectRoot)
    }
  })

  Test('includes Photos and Files in the Companion native build without enabling document sharing', async () => {
    const projectRoot = Repo.resolvePath('packages/ides/studio-companion-app')
    const config = getConfig(projectRoot).exp
    Expect(config.plugins).toContain('expo-media-library')
    Expect(config.plugins).toContain('expo-file-system')
    const prebuild = withPlugins({ ...config, _internal: { projectRoot } }, config.plugins ?? [])
    const native = await compileModsAsync(prebuild, {
      projectRoot,
      platforms: ['ios'],
      introspect: true,
      ignoreExistingNativeFiles: true,
    })
    Expect(native.ios?.infoPlist).toMatchObject({
      NSPhotoLibraryUsageDescription: 'Allow $(PRODUCT_NAME) to access your photos',
      NSPhotoLibraryAddUsageDescription: 'Allow $(PRODUCT_NAME) to save photos',
    })
    Expect(native.ios?.infoPlist?.['NSLocalNetworkUsageDescription']).toContain('Tao Studio')
    Expect(native.ios?.infoPlist?.['PHPhotoLibraryPreventAutomaticLimitedAccessAlert']).toBeUndefined()
    Expect(native.ios?.infoPlist?.['LSSupportsOpeningDocumentsInPlace']).toBeUndefined()
    Expect(native.ios?.infoPlist?.['UIFileSharingEnabled']).toBeUndefined()
  })

  Test('keeps automatic iOS appearance for development and shipped apps', async () => {
    const checkedIn = await FS.readJson(Repo.resolvePath('packages/apps/expo-host/app.json')) as { expo: ExpoAppConfig }
    const projectRoot = await mkTestDir('tao-app-config-appearance-')
    Expect(createExpoAppConfig(checkedIn.expo, projectRoot, {}).ios?.userInterfaceStyle).toBe('automatic')
    await FS.writeJson(FS.resolvePath('_gen_tao-app/ship.json', projectRoot), shipManifest)
    Expect(createExpoAppConfig(checkedIn.expo, projectRoot, {}).ios?.userInterfaceStyle).toBe('automatic')
  })

  Test('preserves the checked-in development configuration when no ship manifest exists', async () => {
    const projectRoot = await mkTestDir('tao-app-config-fallback-')

    Expect(createExpoAppConfig(fallbackConfig, projectRoot, {})).toBe(fallbackConfig)
  })

  Test('writes the dev data bootstrap fact the dev loop places in the environment, and only then', async () => {
    const projectRoot = await mkTestDir('tao-app-config-dev-data-')

    const configured = createExpoAppConfig(fallbackConfig, projectRoot, {
      TAO_DEV_DATA_APP: 'Notes-0123abcd',
      TAO_DEV_DATA_CAPABILITY: 'test_capability_0123456789abcdef0123456789abcdef',
      TAO_DEV_DATA_PORT: '4321',
    })
    Expect(configured.extra).toEqual({
      taoDevData: {
        app: 'Notes-0123abcd',
        capability: 'test_capability_0123456789abcdef0123456789abcdef',
        port: 4_321,
        protocol: 'tao-dev-data-v1',
      },
    })
    Expect(configured.name).toBe('Tao Runtime')

    Expect(createExpoAppConfig(fallbackConfig, projectRoot, { TAO_DEV_DATA_PORT: '4321' })).toBe(fallbackConfig)
    Expect(createExpoAppConfig(fallbackConfig, projectRoot, {
      TAO_DEV_DATA_APP: 'Notes',
      TAO_DEV_DATA_CAPABILITY: 'test_capability_0123456789abcdef0123456789abcdef',
      TAO_DEV_DATA_PORT: 'x',
    })).toBe(fallbackConfig)
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
      plugins: [sceneLifecyclePlugin, 'expo-media-library', 'expo-file-system', './plugins/with-ios-fmt-compat.cjs'],
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
      runtimeVersion: 'native-fingerprint-1',
      updates: {
        enabled: true,
        requestHeaders: { 'expo-channel-name': 'wordflower-instantdb' },
        url: 'https://updates.devtao.com/v1/wordflower-instantdb',
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

  Test('omits an unproven export-compliance declaration', async () => {
    const projectRoot = await mkTestDir('tao-app-config-encryption-unknown-')
    await FS.writeJson(
      FS.resolvePath('_gen_tao-app/ship.json', projectRoot),
      {
        ...shipManifest,
        ios: {},
      } satisfies ShipManifest,
    )

    const config = createExpoAppConfig(fallbackConfig, projectRoot)

    Expect(config.ios?.config).toEqual({})
    Expect(Object.hasOwn(config.ios?.config ?? {}, 'usesNonExemptEncryption')).toBe(false)
  })

  Test('applies the iCloud entitlement plugin with the manifest containers', async () => {
    const projectRoot = await mkTestDir('tao-app-config-icloud-')
    await FS.writeJson(
      FS.resolvePath('_gen_tao-app/ship.json', projectRoot),
      {
        ...shipManifest,
        icloud: {
          containers: ['iCloud.lang.tao.wordflower'],
          documentContainers: [],
          services: ['CloudKit'],
        },
      } satisfies ShipManifest,
    )

    const config = createExpoAppConfig(fallbackConfig, projectRoot)

    Expect(config.plugins).toEqual([
      'expo-media-library',
      'expo-file-system',
      './plugins/with-ios-fmt-compat.cjs',
      [
        'tao-icloud',
        {
          containers: ['iCloud.lang.tao.wordflower'],
          documentContainers: [],
          services: ['CloudKit'],
        },
      ],
    ])
  })

  Test('ships opaque square iOS assets for the default and badged variant', async () => {
    for (const name of ['tao-app-icon.png', 'tao-app-icon-badged.png']) {
      const bytes = await FS.readFile(Repo.resolvePath(`packages/apps/expo-host/assets/${name}`))
      const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

      Expect(header.getUint32(16)).toBe(1024)
      Expect(header.getUint32(20)).toBe(1024)
      // PNG color type 2 is RGB without alpha, as required for App Store icon assets.
      Expect(header.getUint8(25)).toBe(2)
    }
  })
})
