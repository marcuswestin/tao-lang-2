import {
  hostKey,
  hostKitProblems,
  type HostManifest,
  nativeKitOf,
  readHostManifest,
  writeHostManifest,
} from '@expo-host/dev-loop/prebuilt-host/HostManifest'
import { downloadCompatibleHost, type HostDownloadOptions } from '@expo-host/dev-loop/prebuilt-host/HostReleases'
import { findCompatibleHost, obtainCompatibleHost } from '@expo-host/dev-loop/prebuilt-host/PrebuiltHosts'
import { Errors, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'

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

Describe('prebuilt host releases', () => {
  const RELEASES_URL = 'https://api.github.com/repos/tao/tao/releases?per_page=30'
  // One byte per character, so the string's length is the asset's size in bytes.
  const APK = 'a prebuilt Companion'

  function hostManifest(nativeKit: Record<string, string>): HostManifest {
    return { format: 1, hostVersion: '1.0.0', nativeKit, platform: 'android' }
  }

  function release(tag: string, base: string) {
    return {
      assets: [
        { browser_download_url: `${base}/tao-host-android.json`, name: 'tao-host-android.json', size: 100 },
        {
          browser_download_url: `${base}/tao-companion-android.apk`,
          name: 'tao-companion-android.apk',
          size: APK.length,
        },
      ],
      draft: false,
      tag_name: tag,
    }
  }

  /** A fake GitHub answering the release list and each asset by URL, recording every URL it served. */
  function fakeGitHub(routes: Record<string, unknown>, served: string[] = []): HostDownloadOptions['fetch'] {
    return async url => {
      served.push(url)
      const body = routes[url]
      if (body === undefined) {
        return new Response('Not Found', { status: 404, statusText: 'Not Found' })
      }
      return typeof body === 'string' ? new Response(body) : Response.json(body)
    }
  }

  Test('downloads the newest release whose kit covers this Tao, once, and names the ones it refused', async () => {
    await withHostDirectory(async hostsRoot => {
      const compatible = hostManifest({ 'react-native': '0.86.3' })
      const served: string[] = []
      const fetch = fakeGitHub({
        [RELEASES_URL]: [
          release('companion-host-9.0.0-newer', 'https://dl/newer'),
          { assets: [], draft: false, tag_name: 'v0.1.0' },
          release('companion-host-1.0.0-match', 'https://dl/match'),
        ],
        'https://dl/newer/tao-host-android.json': hostManifest({ 'react-native': '0.87.0' }),
        'https://dl/match/tao-host-android.json': compatible,
        'https://dl/match/tao-companion-android.apk': APK,
      }, served)
      const options = { fetch, hostsRoot, repository: 'tao/tao' }

      const first = await withCapturedOutput(() =>
        downloadCompatibleHost('android', { 'react-native': '0.86.3' }, options)
      )
      const second = await downloadCompatibleHost('android', { 'react-native': '0.86.3' }, options)

      const directory = FS.resolvePath(`${hostKey(compatible)}/android`, hostsRoot)
      Expect(first.result.host?.directory).toBe(directory)
      Expect(first.result.refused).toEqual([
        'tao/tao release companion-host-9.0.0-newer: it carries react-native 0.87.0 where this Tao needs 0.86.3',
      ])
      Expect(first.stdout).toContain('Downloading Tao Companion 1.0.0 for android')
      Expect(await FS.readText(FS.resolvePath('tao-companion.apk', directory))).toBe('a prebuilt Companion')
      Expect(await readHostManifest(directory)).toEqual(compatible)
      Expect(second.host?.directory).toBe(directory)
      Expect(served.filter(url => url.endsWith('.apk'))).toEqual(['https://dl/match/tao-companion-android.apk'])
      Expect((await FS.listDir(FS.resolvePath(hostKey(compatible), hostsRoot))).toSorted()).toEqual(['android'])
    })
  })

  Test('refuses a truncated download rather than installing it', async () => {
    await withHostDirectory(async hostsRoot => {
      const fetch = fakeGitHub({
        [RELEASES_URL]: [release('companion-host-1.0.0-match', 'https://dl/match')],
        'https://dl/match/tao-host-android.json': hostManifest({}),
        'https://dl/match/tao-companion-android.apk': APK.slice(0, 5),
      })

      await Expect(
        withCapturedOutput(() => downloadCompatibleHost('android', {}, { fetch, hostsRoot, repository: 'tao/tao' })),
      )
        .rejects.toThrow(`stopped at 5 of ${APK.length} bytes`)
      Expect(await FS.listDir(hostsRoot)).toEqual([])
    })
  })

  Test('falls back to the cached search, saying why, when no host can be downloaded', async () => {
    await withHostDirectory(async root => {
      const captured = await withCapturedOutput(() =>
        obtainCompatibleHost('android', {}, {
          download: async () => Errors.throwHostEnvironment('api.github.com answered 404 Not Found'),
          roots: [root],
        })
      )

      Expect(captured.result).toEqual({ refused: [] })
      Expect(captured.stdout).toContain('No prebuilt host could be downloaded: api.github.com answered 404 Not Found')
    })
  })

  Test('reports a repository whose releases cannot be read, as a private one answers', async () => {
    await withHostDirectory(async hostsRoot => {
      await Expect(downloadCompatibleHost('android', {}, { fetch: fakeGitHub({}), hostsRoot, repository: 'tao/tao' }))
        .rejects.toThrow(`api.github.com answered 404 Not Found for ${RELEASES_URL}.`)
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
