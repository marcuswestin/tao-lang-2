import { hostKey, type HostManifest, writeHostManifest } from '@expo-host/dev-loop/prebuilt-host/HostManifest'
import { type CLI, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import {
  companionGradleArgs,
  companionGradleEnv,
  runCompanionHostPublish,
} from '@studio-tooling/CompanionHostBuild'

Describe('Companion host build', () => {
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
