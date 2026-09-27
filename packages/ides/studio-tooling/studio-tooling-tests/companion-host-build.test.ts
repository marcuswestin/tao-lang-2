import { hostKey, type HostManifest, writeHostManifest } from '@expo-host/dev-loop/prebuilt-host/HostManifest'
import { type CLI, FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import {
  companionGradleArgs,
  companionGradleEnv,
  runCompanionHostBuild,
  runCompanionHostPublish,
} from '@studio-tooling/CompanionHostBuild'

Describe('Companion host build', () => {
  Test(
    'scopes Xcode to prebuild, pods, build, inspection, and copying without changing process selection',
    async () => {
      const fixture = await simulatorBuildFixture()
      const original = Platform.runtimeProcess.env['DEVELOPER_DIR']
      try {
        const result = await withCapturedOutput(() =>
          runCompanionHostBuild({
            repositoryRoot: fixture.root,
            platform: 'ios-simulator',
            developerDir: fixture.developerDir,
            hostPlatform: 'darwin',
            run: fixture.run,
          })
        )
        Expect(result.result).toBe(0)
        Expect(fixture.calls.map(call => call.command)).toEqual([
          '/usr/bin/xcodebuild',
          '/usr/bin/xcodebuild',
          '/usr/bin/xcrun',
          'bunx',
          'pod',
          'xcodebuild',
          'plutil',
          'otool',
          'ditto',
        ])
        for (const call of fixture.calls) {
          Expect(call.spec.env?.['DEVELOPER_DIR']).toBe(await FS.realPath(fixture.developerDir))
        }
        Expect(fixture.calls.find(call => call.command === 'pod')?.spec.env?.['LANG']).toBe('en_US.UTF-8')
        Expect(fixture.calls.find(call => call.command === 'xcodebuild')?.spec.env?.['LC_ALL']).toBe('en_US.UTF-8')
        Expect(Platform.runtimeProcess.env['DEVELOPER_DIR']).toBe(original)
        Expect(fixture.calls.some(call => call.command.includes('xcode-select'))).toBe(false)
      } finally {
        await FS.remove(fixture.root)
      }
    },
  )

  Test('rejects an Android override and unsafe or missing Xcode paths before prebuild or cache writes', async () => {
    const fixture = await simulatorBuildFixture()
    try {
      await Expect(
        runCompanionHostBuild({
          repositoryRoot: fixture.root,
          platform: 'android',
          developerDir: fixture.developerDir,
          run: fixture.run,
        }),
      ).rejects.toThrow('--platform ios-simulator')
      for (
        const developerDir of [
          'relative/Xcode.app/Contents/Developer',
          '/Library/Developer/CommandLineTools',
          `${fixture.developerDir}\n`,
        ]
      ) {
        await Expect(
          runCompanionHostBuild({
            repositoryRoot: fixture.root,
            platform: 'ios-simulator',
            developerDir,
            hostPlatform: 'darwin',
            run: fixture.run,
          }),
        ).rejects.toThrow('absolute Xcode')
      }
      await Expect(
        runCompanionHostBuild({
          repositoryRoot: fixture.root,
          platform: 'ios-simulator',
          developerDir: `${fixture.root}/Missing.app/Contents/Developer`,
          hostPlatform: 'darwin',
          run: fixture.run,
        }),
      ).rejects.toThrow('missing or incomplete')
      Expect(fixture.calls).toEqual([])
      Expect(await FS.exists(`${fixture.packageRoot}/ios`)).toBe(false)
      Expect(await FS.exists(`${fixture.root}/.artifacts/hosts`)).toBe(false)
    } finally {
      await FS.remove(fixture.root)
    }
  })

  Test(
    'stops before native project creation when first-launch status fails or xcrun selects another Xcode',
    async () => {
      for (const failure of ['first-launch', 'selection']) {
        const fixture = await simulatorBuildFixture(failure)
        try {
          await Expect(
            runCompanionHostBuild({
              repositoryRoot: fixture.root,
              platform: 'ios-simulator',
              developerDir: fixture.developerDir,
              hostPlatform: 'darwin',
              run: fixture.run,
            }),
          ).rejects.toThrow(failure === 'first-launch' ? 'license requires attention' : 'did not select xcodebuild')
          Expect(fixture.calls.some(call => call.command === 'bunx')).toBe(false)
          Expect(await FS.exists(`${fixture.packageRoot}/ios`)).toBe(false)
          Expect(await FS.exists(`${fixture.root}/.artifacts/hosts`)).toBe(false)
        } finally {
          await FS.remove(fixture.root)
        }
      }
    },
  )
  Test('asks Gradle for the named ABIs and an in-process Kotlin compile, with no proxy when none is set', () => {
    Expect(companionGradleArgs(['arm64-v8a', 'x86_64'], {})).toEqual([
      '-PreactNativeArchitectures=arm64-v8a,x86_64',
      '-Pkotlin.compiler.execution.strategy=in-process',
      '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g -Dfile.encoding=UTF-8',
      '--console=plain',
    ])
  })

  Test('hands the HTTPS_PROXY family to Gradle as JVM proxy properties, credentials decoded', () => {
    // Gradle ignores these variables, so without this a build behind a proxy dies at its first
    // download with a DNS failure that never mentions the proxy.
    const args = companionGradleArgs(['arm64-v8a'], {
      HTTPS_PROXY: 'http://build%40ci:p%3Ass@proxy.internal:3128',
      NO_PROXY: 'localhost, 127.0.0.1',
    })

    Expect(args).toEqual(Expect['arrayContaining']([
      '-Dhttps.proxyHost=proxy.internal',
      '-Dhttps.proxyPort=3128',
      '-Dhttps.proxyUser=build@ci',
      '-Dhttps.proxyPassword=p:ss',
      '-Dhttp.proxyHost=proxy.internal',
      '-Dhttp.nonProxyHosts=localhost|127.0.0.1',
    ]))
  })

  Test('points the JVM at TMPDIR and the Android SDK the environment names', async () => {
    const sdk = await mkTestDir('tao-android-sdk-')
    try {
      const env = await companionGradleEnv('/repo', {
        ANDROID_HOME: sdk,
        JAVA_TOOL_OPTIONS: '-Djava.net.preferIPv4Stack=true',
        TMPDIR: '/tmp/sandbox',
      })

      Expect(env['ANDROID_HOME']).toBe(sdk)
      Expect(env['JAVA_TOOL_OPTIONS']).toBe(
        '-Djava.net.preferIPv4Stack=true -Djava.io.tmpdir=/tmp/sandbox'
          + ' -Djdk.http.auth.tunneling.disabledSchemes= -Djdk.http.auth.proxying.disabledSchemes=',
      )
    } finally {
      await FS.remove(sdk)
    }
  })

  Test('names the remedy when no Android SDK is at hand', async () => {
    await Expect(companionGradleEnv('/nonexistent-checkout', {})).rejects.toThrow('Enter `./enter-tao-dev-env`')
  })
})

async function simulatorBuildFixture(failure?: string) {
  const root = await mkTestDir('tao-companion-xcode-')
  const packageRoot = FS.resolvePath('packages/ides/studio-companion-app', root)
  const developerDir = FS.resolvePath('Xcode-beta.app/Contents/Developer', root)
  await FS.writeText(`${developerDir}/usr/bin/xcodebuild`, 'fixture')
  await FS.writeJson(`${packageRoot}/app.json`, { expo: { version: '1.0.0' } })
  await FS.writeJson(`${packageRoot}/package.json`, { dependencies: {} })
  const calls: { command: string; spec: CLI.CommandSpec }[] = []
  const run: typeof CLI.run = async (command, spec = {}) => {
    calls.push({ command, spec })
    const args = [...spec.args ?? []]
    let stdout = ''
    if (args.includes('-version')) {
      stdout = 'Xcode 27.1\nBuild version 18B'
    }
    if (args.includes('--find')) {
      stdout = failure === 'selection'
        ? '/other/Xcode.app/Contents/Developer/usr/bin/xcodebuild'
        : `${await FS.realPath(developerDir)}/usr/bin/xcodebuild`
    }
    if (command === 'bunx') {
      await FS.mkdir(`${packageRoot}/ios/Tao.xcworkspace`)
    }
    if (command === 'xcodebuild') {
      await FS.mkdir(`${packageRoot}/ios/build/Build/Products/Debug-iphonesimulator/Tao.app`)
    }
    if (command === 'plutil') {
      stdout = 'Tao'
    }
    if (command === 'otool') {
      stdout = 'sectname __entitlements'
    }
    if (command === 'ditto') {
      await FS.copyDirectory(args[0]!, args[1]!)
    }
    const failed = failure === 'first-launch' && args.includes('-checkFirstLaunchStatus')
    return {
      command,
      args,
      stdout,
      stderr: failed ? 'license requires attention' : '',
      exitCode: failed ? 1 : 0,
      signal: null,
    }
  }
  return { root, packageRoot, developerDir, calls, run }
}

Describe('Companion host publish', () => {
  /** A checkout whose Companion declares no dependencies, so its native kit is empty. */
  async function withCheckout(run: (root: string, manifest: HostManifest) => Promise<void>): Promise<void> {
    const root = await mkTestDir('tao-host-publish-')
    try {
      const packageRoot = FS.resolvePath('packages/ides/studio-companion-app', root)
      await FS.writeJson(FS.resolvePath('app.json', packageRoot), { expo: { version: '1.0.0' } })
      await FS.writeJson(FS.resolvePath('package.json', packageRoot), { dependencies: {} })
      await run(root, { format: 1, hostVersion: '1.0.0', nativeKit: {}, platform: 'android' })
    } finally {
      await FS.remove(root)
    }
  }

  function fakeGh(calls: string[][], viewExitCode: number): typeof CLI.run {
    return async (command, spec = {}) => {
      const args = [...(spec.args ?? [])]
      calls.push([command, ...args])
      return { args, command, exitCode: args[1] === 'view' ? viewExitCode : 0, signal: null, stderr: '', stdout: '' }
    }
  }

  Test('creates a prerelease that is never latest, then uploads both assets under their release names', async () => {
    await withCheckout(async (root, manifest) => {
      const hostDirectory = FS.resolvePath(`.artifacts/hosts/${hostKey(manifest)}/android`, root)
      await writeHostManifest(hostDirectory, manifest)
      await FS.writeText(FS.resolvePath('tao-companion.apk', hostDirectory), 'apk')
      const calls: string[][] = []

      await withCapturedOutput(() => runCompanionHostPublish({ repositoryRoot: root, run: fakeGh(calls, 1) }))

      const tag = `companion-host-${hostKey(manifest)}`
      Expect(calls.map(call => call.slice(0, 4))).toEqual([
        ['gh', 'release', 'view', tag],
        ['gh', 'release', 'create', tag],
        ['gh', 'release', 'upload', tag],
      ])
      Expect(calls[1]).toEqual(Expect['arrayContaining'](['--prerelease', '--latest=false']))
      Expect(calls[2]).toContain('--clobber')
      Expect(calls[2]!.slice(-2).map(path => FS.basename(path))).toEqual([
        'tao-host-android.json',
        'tao-companion-android.apk',
      ])
    })
  })

  Test('uploads into an existing release without creating it again', async () => {
    await withCheckout(async (root, manifest) => {
      const hostDirectory = FS.resolvePath(`.artifacts/hosts/${hostKey(manifest)}/android`, root)
      await writeHostManifest(hostDirectory, manifest)
      await FS.writeText(FS.resolvePath('tao-companion.apk', hostDirectory), 'apk')
      const calls: string[][] = []

      await withCapturedOutput(() => runCompanionHostPublish({ repositoryRoot: root, run: fakeGh(calls, 0) }))

      Expect(calls.map(call => call[2])).toEqual(['view', 'upload'])
    })
  })

  Test('refuses to publish when no host is built for the Companion as it stands', async () => {
    // A host built before a native change carries another kit, so it would be published under a
    // tag that names a kit it does not have.
    await withCheckout(async root => {
      const calls: string[][] = []
      await Expect(runCompanionHostPublish({ repositoryRoot: root, run: fakeGh(calls, 1) }))
        .rejects.toThrow('Run `just companion-host-build` first.')
      Expect(calls).toEqual([])
    })
  })
})
