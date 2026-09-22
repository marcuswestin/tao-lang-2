import {
  hostKitProblems,
  type HostManifest,
  nativeKitOf,
  readHostManifest,
  writeHostManifest,
} from '@expo-host/dev-loop/prebuilt-host/HostManifest'
import { findCompatibleHost } from '@expo-host/dev-loop/prebuilt-host/PrebuiltHosts'
import { FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

/**
 * A fake app host: a package whose dependencies are installed under its own `node_modules`, the
 * way `FS.resolvePackageDirectory` finds them on a machine with no workspace around it.
 */
async function writeHost(root: string, dependencies: Record<string, string>): Promise<void> {
  await FS.writeJson(FS.resolvePath('package.json', root), { dependencies, name: 'host' })
}

async function installPackage(
  root: string,
  name: string,
  manifest: { private?: boolean; version: string },
  files: Record<string, string> = {},
): Promise<string> {
  const directory = FS.resolvePath(`node_modules/${name}`, root)
  await FS.writeJson(FS.resolvePath('package.json', directory), { name, ...manifest })
  for (const [path, content] of Object.entries(files)) {
    await FS.writeText(FS.resolvePath(path, directory), content)
  }
  return directory
}

async function withHostDirectory(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkTestDir('tao-prebuilt-host-')
  try {
    await run(root)
  } finally {
    await FS.remove(root)
  }
}

Describe('prebuilt host native kit', () => {
  Test('keys every native-shipping dependency by its installed version and skips the rest', async () => {
    await withHostDirectory(async root => {
      await writeHost(root, { 'js-only': '^1.0.0', 'native-module': '~2.0.0', 'preset-only': '1.0.0' })
      await installPackage(root, 'native-module', { version: '2.0.4' }, { 'expo-module.config.json': '{}' })
      await installPackage(root, 'js-only', { version: '1.3.0' }, { 'index.js': '' })
      // Shaped like jest-expo: platform directories that hold no native build file.
      await installPackage(root, 'preset-only', { version: '1.0.0' }, {
        'android/jest-preset.js': '',
        'ios/jest-preset.js': '',
      })

      Expect(await nativeKitOf(root)).toEqual({ 'native-module': '2.0.4' })
    })
  })

  Test('identifies a private native package by what reaches its native build, not by its version', async () => {
    // Tao's own native packages are private and never published, so `1.0.0` stays `1.0.0` while
    // their Swift changes. A host built before that change must not pass for one built after it.
    await withHostDirectory(async root => {
      await writeHost(root, { 'tao-native': 'workspace:*' })
      const directory = await installPackage(root, 'tao-native', { private: true, version: '1.0.0' }, {
        'app.plugin.js': 'module.exports = config => config',
        'expo-module.config.json': '{}',
        'ios/Module.swift': 'let version = 1',
        'src/index.ts': 'export const a = 1',
      })

      const before = (await nativeKitOf(root))['tao-native']
      await FS.writeText(FS.resolvePath('src/index.ts', directory), 'export const a = 2')
      const afterScriptChange = (await nativeKitOf(root))['tao-native']
      await FS.writeText(FS.resolvePath('ios/Module.swift', directory), 'let version = 2')
      const afterNativeChange = (await nativeKitOf(root))['tao-native']

      Expect(before).toMatch(/^1\.0\.0\+[0-9a-f]{16}$/u)
      Expect(afterScriptChange).toBe(before)
      Expect(afterNativeChange).not.toBe(before)
    })
  })

  Test('computes the installed app host kit, and the Companion carries it', async () => {
    const host = await nativeKitOf(Repo.resolvePath('packages/apps/expo-host'))
    const companion = await nativeKitOf(Repo.resolvePath('packages/ides/studio-companion-app'))

    Expect(Object.keys(host)).toEqual(Expect['arrayContaining'](['expo', 'react-native', 'tao-icloud']))
    Expect(hostKitProblems(companion, host)).toEqual([])
  })
})

Describe('prebuilt host compatibility', () => {
  Test('accepts a host that carries more than the app needs', () => {
    Expect(hostKitProblems({ 'expo-dev-client': '57.0.19', 'react-native': '0.86.3' }, { 'react-native': '0.86.3' }))
      .toEqual([])
  })

  Test('names each module a host lacks or carries from other code', () => {
    Expect(hostKitProblems(
      { 'react-native': '0.86.2', 'tao-icloud': '1.0.0+aaaa' },
      { 'expo-haptics': '57.0.3', 'react-native': '0.86.3', 'tao-icloud': '1.0.0+aaaa' },
    )).toEqual([
      'it lacks expo-haptics 57.0.3',
      'it carries react-native 0.86.2 where this Tao needs 0.86.3',
    ])
  })
})

Describe('prebuilt host search', () => {
  async function writeHostDirectory(
    root: string,
    version: string,
    manifest: Partial<HostManifest> | 'corrupt',
    options: { binary?: boolean } = {},
  ): Promise<string> {
    const directory = FS.resolvePath(`${version}/android`, root)
    if (manifest === 'corrupt') {
      await FS.writeJson(FS.resolvePath('tao-host.json', directory), { format: 99 })
    } else {
      await writeHostManifest(directory, {
        format: 1,
        hostVersion: version,
        nativeKit: { 'react-native': '0.86.3' },
        platform: 'android',
        ...manifest,
      })
    }
    if (options.binary !== false) {
      await FS.writeText(FS.resolvePath('tao-companion.apk', directory), 'apk')
    }
    return directory
  }

  Test('takes the newest host whose kit covers the required one, by manifest rather than path', async () => {
    await withHostDirectory(async root => {
      await writeHostDirectory(root, '1.2.0', {})
      const newest = await writeHostDirectory(root, '1.10.0', {})

      const search = await findCompatibleHost('android', { 'react-native': '0.86.3' }, [root])

      Expect(search.host?.directory).toBe(newest)
      Expect(search.host?.binaryPath).toBe(FS.resolvePath('tao-companion.apk', newest))
      Expect(search.refused).toEqual([])
    })
  })

  Test('passes over each host that cannot run this Tao, saying why, and ignores directories with no host', async () => {
    // Every refused host names its reason: a developer who built a host and still sees Expo Go
    // needs to know it was the kit, the binary, or the manifest.
    await withHostDirectory(async root => {
      await writeHostDirectory(root, '3.0.0', { nativeKit: { 'react-native': '0.85.0' } })
      await writeHostDirectory(root, '2.0.0', {}, { binary: false })
      await writeHostDirectory(root, '1.5.0', 'corrupt')
      await FS.mkdir(FS.resolvePath('1.0.0/android', root))

      const search = await findCompatibleHost('android', { 'react-native': '0.86.3' }, [root])

      Expect(search.host).toBeUndefined()
      Expect(search.refused).toHaveLength(3)
      Expect(search.refused[0]).toContain('it carries react-native 0.85.0 where this Tao needs 0.86.3')
      Expect(search.refused[1]).toContain('no tao-companion.apk beside its manifest')
      Expect(search.refused[2]).toContain('is not one this Tao can read')
    })
  })
})

Describe('prebuilt host manifest', () => {
  Test('round-trips beside the host binary, and is absent when never written', async () => {
    await withHostDirectory(async root => {
      const manifest: HostManifest = {
        format: 1,
        hostVersion: '1.0.0',
        nativeKit: { 'react-native': '0.86.3' },
        platform: 'android',
      }

      Expect(await readHostManifest(root)).toBeUndefined()
      await writeHostManifest(root, manifest)
      Expect(await readHostManifest(root)).toEqual(manifest)
    })
  })

  Test('reports a manifest it cannot read as the host environment’s failure', async () => {
    await withHostDirectory(async root => {
      await FS.writeJson(FS.resolvePath('tao-host.json', root), { format: 2, platform: 'android' })

      await Expect(readHostManifest(root)).rejects.toThrow('is not one this Tao can read')
    })
  })
})
