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
import { prepareSimulatorCompanion } from '@expo-host/dev-loop/prebuilt-host/SimulatorCompanion'
import { CLI, Errors, FS, Platform, Repo } from '@shared'
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
  manifest: {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    peerDependenciesMeta?: Record<string, { optional?: boolean }>
    private?: boolean
    version: string
  },
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

  Test('discovers native modules through wrappers, root development dependencies, and required peers', async () => {
    await withHostDirectory(async root => {
      await FS.writeJson(FS.resolvePath('package.json', root), {
        dependencies: { wrapper: '1.0.0' },
        devDependencies: { 'root-native': '1.0.0' },
      })
      const wrapper = await installPackage(root, 'wrapper', {
        dependencies: { bridge: '1.0.0' },
        devDependencies: { 'dependency-dev-native': '1.0.0' },
        optionalDependencies: { 'installed-optional-native': '1.0.0', absent: '1.0.0' },
        peerDependencies: { 'required-peer-native': '1.0.0', 'optional-peer-native': '1.0.0' },
        peerDependenciesMeta: { 'optional-peer-native': { optional: true } },
        version: '1.0.0',
      })
      const bridge = await installPackage(wrapper, 'bridge', {
        dependencies: { 'indirect-native': '1.0.0' },
        version: '1.0.0',
      })
      await installPackage(bridge, 'indirect-native', { version: '1.0.3' }, { 'expo-module.config.json': '{}' })
      for (
        const name of [
          'root-native',
          'installed-optional-native',
          'required-peer-native',
          'optional-peer-native',
          'dependency-dev-native',
        ]
      ) {
        await installPackage(root, name, { version: '1.0.0' }, { 'expo-module.config.json': '{}' })
      }
      Expect(await nativeKitOf(root)).toEqual({
        'indirect-native': '1.0.3',
        'required-peer-native': '1.0.0',
        'root-native': '1.0.0',
      })
    })
  })

  Test('traverses symlink aliases and dependency cycles once by their real directories', async () => {
    await withHostDirectory(async root => {
      await writeHost(root, { wrapper: '1.0.0', alias: '1.0.0' })
      const wrapper = await installPackage(root, 'wrapper', { dependencies: { bridge: '1.0.0' }, version: '1.0.0' })
      const bridge = await installPackage(wrapper, 'bridge', {
        dependencies: { wrapper: '1.0.0', 'native-module': '1.0.0' },
        version: '1.0.0',
      })
      await FS.symlink(wrapper, FS.resolvePath('node_modules/alias', root))
      await FS.symlink(wrapper, FS.resolvePath('node_modules/wrapper', bridge))
      await installPackage(bridge, 'native-module', { version: '1.0.0' }, { 'expo-module.config.json': '{}' })
      Expect(await nativeKitOf(root)).toEqual({ 'native-module': '1.0.0' })
    })
  })

  Test('selects root AsyncStorage 2.2.0 over a deeper 1.24.0 peer resolution', async () => {
    await withHostDirectory(async root => {
      const name = '@react-native-async-storage/async-storage'
      await writeHost(root, { wrapper: '1.0.0', [name]: '2.2.0' })
      await installPackage(root, name, { version: '2.2.0' }, { 'expo-module.config.json': '{}' })
      const wrapper = await installPackage(root, 'wrapper', {
        peerDependencies: { [name]: '>=1.19' },
        version: '1.0.0',
      })
      await installPackage(wrapper, name, { version: '1.24.0' }, { 'expo-module.config.json': '{}' })
      Expect(await nativeKitOf(root)).toEqual({ [name]: '2.2.0' })
    })
  })

  Test('a direct JavaScript-only version suppresses a deeper native version of the same package', async () => {
    await withHostDirectory(async root => {
      await writeHost(root, { wrapper: '1.0.0', 'module-that-changed': '2.0.0' })
      await installPackage(root, 'module-that-changed', { version: '2.0.0' }, { 'index.js': '' })
      const wrapper = await installPackage(root, 'wrapper', {
        dependencies: { 'module-that-changed': '1.0.0' },
        version: '1.0.0',
      })
      await installPackage(wrapper, 'module-that-changed', { version: '1.0.0' }, { 'expo-module.config.json': '{}' })
      Expect(await nativeKitOf(root)).toEqual({})
    })
  })

  Test('rejects conflicting native identities with equal selected resolution priority', async () => {
    await withHostDirectory(async root => {
      await writeHost(root, { 'wrapper-a': '1.0.0', 'wrapper-b': '1.0.0' })
      for (const [wrapperName, version] of [['wrapper-a', '1.0.0'], ['wrapper-b', '2.0.0']] as const) {
        const wrapper = await installPackage(root, wrapperName, {
          dependencies: { 'native-module': version },
          version: '1.0.0',
        })
        await installPackage(wrapper, 'native-module', { version }, { 'expo-module.config.json': '{}' })
      }
      await Expect(nativeKitOf(root)).rejects.toThrow(
        "Installed native package 'native-module' has conflicting build identities at the same resolution priority: 1.0.0 and 2.0.0.",
      )
    })
  })

  Test('selects the shallower node_modules origin when graph depths match', async () => {
    await withHostDirectory(async root => {
      await writeHost(root, { 'wrapper-a': '1.0.0', 'wrapper-b': '1.0.0' })
      await installPackage(root, 'native-module', { version: '2.2.0' }, { 'expo-module.config.json': '{}' })
      await installPackage(root, 'wrapper-a', { dependencies: { 'native-module': '2.2.0' }, version: '1.0.0' })
      const wrapper = await installPackage(root, 'wrapper-b', {
        dependencies: { 'native-module': '1.24.0' },
        version: '1.0.0',
      })
      await installPackage(wrapper, 'native-module', { version: '1.24.0' }, { 'expo-module.config.json': '{}' })
      Expect(await nativeKitOf(root)).toEqual({ 'native-module': '2.2.0' })
    })
  })

  Test(
    'ignores documented Expo tooling and test subgraphs even when their fixtures contain native markers',
    async () => {
      await withHostDirectory(async root => {
        await writeHost(root, { 'jest-expo': '1.0.0', '@testing-library/react-native': '1.0.0', wrapper: '1.0.0' })
        for (const name of ['jest-expo', '@testing-library/react-native']) {
          const tooling = await installPackage(root, name, {
            dependencies: { 'tooling-native': '1.0.0' },
            version: '1.0.0',
          })
          await installPackage(tooling, 'tooling-native', { version: '1.0.0' }, { 'expo-module.config.json': '{}' })
        }
        const wrapper = await installPackage(root, 'wrapper', {
          dependencies: { 'app-native': '1.0.0' },
          version: '1.0.0',
        })
        await installPackage(wrapper, 'app-native', { version: '1.0.0' }, { 'expo-module.config.json': '{}' })
        Expect(await nativeKitOf(root)).toEqual({ 'app-native': '1.0.0' })
      })
    },
  )

  Test('lets a shallower alias improve selection without traversing its real directory twice', async () => {
    await withHostDirectory(async root => {
      await writeHost(root, { 'wrapper-a': '1.0.0', 'wrapper-b': '1.0.0', 'wrapper-c': '1.0.0' })
      const native = await installPackage(root, 'native-module', { version: '2.2.0' }, {
        'expo-module.config.json': '{}',
      })
      const first = await installPackage(root, 'wrapper-a', {
        dependencies: { 'native-module': '*' },
        version: '1.0.0',
      })
      await FS.symlink(native, FS.resolvePath('node_modules/native-module', first))
      await installPackage(root, 'wrapper-b', { dependencies: { 'native-module': '*' }, version: '1.0.0' })
      const third = await installPackage(root, 'wrapper-c', {
        dependencies: { 'native-module': '*' },
        version: '1.0.0',
      })
      await installPackage(third, 'native-module', { version: '1.24.0' }, { 'expo-module.config.json': '{}' })
      Expect(await nativeKitOf(root)).toEqual({ 'native-module': '2.2.0' })
    })
  })

  Test(
    'refuses the installed Companion because it lacks indirect SQLite while selecting root AsyncStorage',
    async () => {
      const host = await nativeKitOf(Repo.resolvePath('packages/apps/expo-host'))
      const companion = await nativeKitOf(Repo.resolvePath('packages/ides/studio-companion-app'))

      Expect(Object.keys(host)).toEqual(
        Expect['arrayContaining'](['expo', 'expo-sqlite', 'react-native', 'tao-icloud']),
      )
      Expect(host['@react-native-async-storage/async-storage']).toBe('2.2.0')
      Expect(hostKitProblems(companion, host)).toEqual([])
    },
  )
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
  const RELEASES_URL = 'https://api.github.com/repos/tao/tao/releases?per_page=30&page=1'
  const RELEASES_PAGE_2_URL = 'https://api.github.com/repos/tao/tao/releases?per_page=30&page=2'
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
      return typeof body === 'string' || body instanceof ArrayBuffer ? new Response(body) : Response.json(body)
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

  async function downloadArchiveFixture(
    root: string,
    bundleName: string,
  ) {
    const env = { ...Platform.runtimeProcess.env }
    const useZipFixture = Platform.hostPlatform === 'linux'
    if (useZipFixture) {
      const bin = FS.resolvePath('bin', root)
      const shim = FS.resolvePath('ditto', bin)
      await FS.writeText(
        shim,
        await FS.readText(Repo.resolvePath(
          'packages/apps/expo-host/expo-host-tests/fixtures/ditto-zip-fixture.py',
        )),
      )
      await FS.chmod(shim, 0o755)
      env['PATH'] = `${bin}:${env['PATH'] ?? ''}`
      env['TAO_ZIP_FIXTURE_LOG'] = FS.resolvePath('ditto.jsonl', root)
    }
    // Only this child sees the Linux command fixture; sibling tests retain their PATH.
    await CLI.mustRun(Platform.runtimeProcess.execPath, {
      args: [
        Repo.resolvePath('packages/apps/expo-host/expo-host-tests/fixtures/prebuilt-host-archive.ts'),
        root,
        bundleName,
      ],
      cwd: Repo.getRoot(),
      env,
      processPolicy: 'test',
      timeoutMs: 20_000, // budget-ok: parent-owned bound for this small archive command fixture.
    })
    const manifest: HostManifest = { format: 1, hostVersion: '1.0.0', nativeKit: {}, platform: 'ios-simulator' }
    const directory = FS.resolvePath(`hosts/${hostKey(manifest)}/ios-simulator`, root)
    const zip = FS.resolvePath('tao-companion-ios-simulator.app.zip', root)
    if (useZipFixture) {
      const calls = (await FS.readText(FS.resolvePath('ditto.jsonl', root))).trim().split('\n')
        .map(line => JSON.parse(line) as string[])
      Expect(calls).toHaveLength(2)
      Expect(calls[0]).toEqual(['-c', '-k', '--keepParent', FS.resolvePath(`bundle/${bundleName}`, root), zip])
      Expect(calls[1]?.slice(0, 2)).toEqual(['-x', '-k'])
      const staging = calls[1]![3]!
      Expect(staging.startsWith(`${directory}.staging-`)).toBe(true)
      Expect(calls[1]).toEqual(['-x', '-k', FS.resolvePath('host.zip', staging), staging])
    }
    const result = await FS.readJson<{ binaryPath?: string; error?: string }>(FS.resolvePath('result.json', root))
    return { directory, manifest, result }
  }

  Test('unpacks a simulator host published as a zipped app bundle', async () => {
    await withHostDirectory(async root => {
      const { directory, manifest, result } = await downloadArchiveFixture(root, 'Tao Companion.app')

      Expect(result.error).toBeUndefined()
      Expect(result.binaryPath).toBe(FS.resolvePath('Tao Companion.app', directory))
      Expect(await FS.readText(FS.resolvePath('Tao Companion.app/Info.plist', directory))).toBe('<plist/>')
      Expect(await readHostManifest(directory)).toEqual(manifest)
      Expect((await FS.listDir(directory)).toSorted()).toEqual(['Tao Companion.app', 'tao-host.json'])
    })
  })

  Test('rejects a real archive whose extracted bundle has the wrong name', async () => {
    await withHostDirectory(async root => {
      const { directory, result } = await downloadArchiveFixture(root, 'Wrong Companion.app')

      Expect(result.error).toBe('The downloaded host archive did not hold Tao Companion.app.')
      Expect(result.binaryPath).toBeUndefined()
      Expect(await FS.exists(directory)).toBe(false)
    })
  })

  Test('reads past a full page of other releases to reach a host, and stops at a short page', async () => {
    // CLI and Studio releases share the list, so thirty of them can push every host off page one.
    await withHostDirectory(async hostsRoot => {
      const served: string[] = []
      const cliReleases = Array.from(
        { length: 30 },
        (_, index) => ({ assets: [], draft: false, tag_name: `v0.1.${index}` }),
      )
      const fetch = fakeGitHub({
        [RELEASES_URL]: cliReleases,
        [RELEASES_PAGE_2_URL]: [release('companion-host-1.0.0-match', 'https://dl/match')],
        'https://dl/match/tao-host-android.json': hostManifest({}),
        'https://dl/match/tao-companion-android.apk': APK,
      }, served)

      const search = await withCapturedOutput(() =>
        downloadCompatibleHost('android', {}, { fetch, hostsRoot, repository: 'tao/tao' })
      )
      const none = await downloadCompatibleHost('ios-simulator', {}, { fetch, hostsRoot, repository: 'tao/tao' })

      Expect(search.result.host).toBeDefined()
      Expect(none.host).toBeUndefined()
      Expect(served.filter(url => url.includes('/releases?'))).toEqual([
        RELEASES_URL,
        RELEASES_PAGE_2_URL,
        RELEASES_URL,
        RELEASES_PAGE_2_URL,
      ])
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

Describe('prebuilt host on the iOS Simulator', () => {
  const host = {
    binaryPath: '/hosts/1.0.0-abc/ios-simulator/Tao Companion.app',
    directory: '/hosts/1.0.0-abc/ios-simulator',
    manifest: { format: 1 as const, hostVersion: '1.0.0', nativeKit: {}, platform: 'ios-simulator' as const },
  }

  Test('installs a compatible Companion only when the simulator lacks that build', async () => {
    const installs: string[] = []
    let installedMatches = false
    const dependencies = {
      findPrebuiltHost: async () => ({ host, refused: [] }),
      install: async (udid: string) => {
        installs.push(udid)
      },
      installedMatches: async () => installedMatches,
    }

    const first = await withCapturedOutput(() => prepareSimulatorCompanion('SIM-1', 'iPhone 17', dependencies))
    installedMatches = true
    const second = await withCapturedOutput(() => prepareSimulatorCompanion('SIM-1', 'iPhone 17', dependencies))

    Expect(first.result).toBe(true)
    Expect(first.stdout).toContain('Installing Tao Companion 1.0.0 on iPhone 17')
    Expect(second.result).toBe(true)
    Expect(second.stdout).toContain('Tao Companion 1.0.0 is already installed on iPhone 17')
    Expect(installs).toEqual(['SIM-1'])
  })

  Test('leaves the simulator on Expo Go, naming each host passed over, when none fits', async () => {
    const captured = await withCapturedOutput(() =>
      prepareSimulatorCompanion('SIM-1', 'iPhone 17', {
        findPrebuiltHost: async () => ({ refused: ['/hosts/0.9.0/ios-simulator: it lacks expo-haptics 57.0.3'] }),
        install: async () => Errors.throwUnexpected('Expected: nothing is installed without a host.'),
      })
    )

    Expect(captured.result).toBe(false)
    Expect(`${captured.stdout}${captured.stderr}`).toContain(
      'Passed over the prebuilt host at /hosts/0.9.0/ios-simulator: it lacks expo-haptics 57.0.3.',
    )
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
