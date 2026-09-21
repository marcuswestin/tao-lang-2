import { expect, test } from '@playwright/test'
import { FS, Repo } from '@shared'
import withTaoICloud, {
  cloudKitContainersInfoKey,
  type TaoICloudPluginProps,
} from '../../../providers/icloud/plugins/with-tao-icloud.cjs'

const { default: expoConfigPlugins } = await import(
  Repo.resolvePath('packages/apps/expo-host/node_modules/expo/config-plugins.js')
)
const { evalModsAsync, withBaseMod } = expoConfigPlugins as ExpoConfigPlugins

type ICloudConfig = Record<string, unknown> & {
  ios?: {
    bundleIdentifier?: string
    entitlements?: Record<string, unknown>
    infoPlist?: Record<string, unknown>
  }
  mods?: unknown
}

type ModInput =
  & ICloudConfig
  & Readonly<{
    modRequest: Readonly<{ nextMod: (input: ModInput) => Promise<ICloudConfig> }>
    modResults: Record<string, unknown>
  }>

type ExpoConfigPlugins = Readonly<{
  evalModsAsync: (
    config: ICloudConfig,
    options: Readonly<{ platforms: readonly ['ios']; projectRoot: string }>,
  ) => Promise<ICloudConfig>
  withBaseMod: (
    config: ICloudConfig,
    options: Readonly<{
      action: (input: ModInput) => Promise<ICloudConfig>
      isProvider: true
      mod: 'entitlements' | 'infoPlist'
      platform: 'ios'
    }>,
  ) => ICloudConfig
}>

test('CloudKit config-plugin mods publish the entitled containers to the native launch declaration', async () => {
  const compiled = await compileICloudMods(
    {
      containers: ['iCloud.lang.tao.records', 'iCloud.lang.tao.records'],
      documentContainers: [],
      services: ['CloudKit'],
    },
    {},
    { UIBackgroundModes: ['fetch'] },
  )

  expect(compiled.ios?.entitlements).toEqual({
    'aps-environment': 'production',
    'com.apple.developer.icloud-container-identifiers': ['iCloud.lang.tao.records'],
    'com.apple.developer.icloud-services': ['CloudKit'],
  })
  expect(compiled.ios?.infoPlist).toEqual({
    [cloudKitContainersInfoKey]: ['iCloud.lang.tao.records'],
    UIBackgroundModes: ['fetch', 'remote-notification'],
  })
})

test('Documents-only config-plugin mods do not advertise CloudKit to the native launch guard', async () => {
  const compiled = await compileICloudMods(
    {
      containers: ['iCloud.lang.tao.documents'],
      services: ['CloudDocuments'],
    },
    {},
    { UIBackgroundModes: ['fetch'] },
  )

  expect(compiled.ios?.entitlements).toEqual({
    'com.apple.developer.icloud-container-identifiers': ['iCloud.lang.tao.documents'],
    'com.apple.developer.icloud-services': ['CloudDocuments'],
    'com.apple.developer.ubiquity-container-identifiers': ['iCloud.lang.tao.documents'],
  })
  expect(compiled.ios?.infoPlist).toBeUndefined()
})

test('CloudKit plugin and native guard agree on the handoff key and protect the default container', async () => {
  const compiled = await compileICloudMods({ services: ['CloudKit'] }, {}, {})
  expect(compiled.ios?.infoPlist).toMatchObject({
    [cloudKitContainersInfoKey]: ['iCloud.lang.tao.notes'],
  })

  const nativeSource = await FS.readText(Repo.resolvePath('packages/providers/icloud/ios/TaoCloudKitModule.swift'))
  const nativeKey = nativeSource.match(/cloudKitContainersInfoKey = "([^"]+)"/u)?.[1]
  expect(nativeKey).toBe(cloudKitContainersInfoKey)
  expect(nativeSource).toContain('let defaultContainer = "iCloud.\\(bundleIdentifier)"')
  expect(nativeSource.indexOf('guard declared.contains(defaultContainer)')).toBeGreaterThan(-1)
  expect(nativeSource.indexOf('guard declared.contains(defaultContainer)')).toBeLessThan(
    nativeSource.indexOf('return CKContainer.default()'),
  )
})

async function compileICloudMods(
  props: TaoICloudPluginProps,
  entitlements: Record<string, unknown>,
  infoPlist: Record<string, unknown>,
) {
  let config = withTaoICloud({
    name: 'Tao host control',
    slug: 'tao-host-control',
    ios: { bundleIdentifier: 'lang.tao.notes' },
  }, props) as unknown as ICloudConfig
  config = withBaseMod(config, {
    action: baseProvider(entitlements),
    isProvider: true,
    mod: 'entitlements',
    platform: 'ios',
  })
  config = withBaseMod(config, {
    action: baseProvider(infoPlist),
    isProvider: true,
    mod: 'infoPlist',
    platform: 'ios',
  })
  return await evalModsAsync(config, {
    platforms: ['ios'],
    projectRoot: '.',
  })
}

function baseProvider(modResults: Record<string, unknown>): (input: ModInput) => Promise<ICloudConfig> {
  return async input => await input.modRequest.nextMod({ ...input, modResults })
}
