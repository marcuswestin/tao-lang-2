import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { companionGradleArgs, companionGradleEnv } from '@studio-tooling/CompanionHostBuild'

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
    await Expect(companionGradleEnv('/nonexistent-checkout', {})).rejects.toThrow('Run `direnv allow`')
  })
})
