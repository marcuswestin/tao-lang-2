import { CompanionIdentity } from '@expo-host/dev-loop/prebuilt-host/CompanionIdentity'
import { type HostManifest, nativeKitOf, writeHostManifest } from '@expo-host/dev-loop/prebuilt-host/HostManifest'
import { CHECKOUT_HOSTS_PATH, HOST_BINARIES } from '@expo-host/dev-loop/prebuilt-host/PrebuiltHosts'
import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'

/*
 * Builds the Tao Companion as a prebuilt Android host. Expo prebuild writes the native project,
 * Gradle assembles a debug APK — a development client, which runs whatever bundle Metro serves it —
 * and the APK lands in this checkout's host cache beside a manifest naming the native kit it was
 * built with. `tao dev` installs it on an emulator whenever that kit covers the one it computes for
 * itself, and falls back to Expo Go when none does.
 */

const APK_OUTPUT_PATH = 'app/build/outputs/apk/debug/app-debug.apk'
/** An Apple silicon emulator runs arm64-v8a, an Intel or Linux one x86_64; a host carries both. */
const DEFAULT_ARCHITECTURES = ['arm64-v8a', 'x86_64'] as const
const DEVENV_ANDROID_SDK_PATH = '.devenv/profile/libexec/android-sdk'
const GRADLE_DAEMON_JVM_ARGS = '-Xmx4g -XX:MaxMetaspaceSize=1g -Dfile.encoding=UTF-8'

/** CompanionHostBuildOptions narrows a build, principally so a developer can build one ABI faster. */
export type CompanionHostBuildOptions = {
  architectures?: readonly string[]
  repositoryRoot?: string
}

/** runCompanionHostBuild builds the Android host into the checkout's host cache and returns an exit code. */
export async function runCompanionHostBuild(options: CompanionHostBuildOptions = {}): Promise<number> {
  const root = options.repositoryRoot ?? Repo.getRoot()
  const packageRoot = FS.resolvePath(CompanionIdentity.packagePath, root)
  const androidRoot = FS.resolvePath('android', packageRoot)
  const architectures = options.architectures ?? DEFAULT_ARCHITECTURES

  HCI.writeLine(`Generating the ${CompanionIdentity.name} Android project with expo prebuild.`)
  await CLI.mustRun('bunx', {
    args: ['expo', 'prebuild', '--platform', 'android', '--no-install'],
    cwd: packageRoot,
    stdio: 'inherit',
  })

  HCI.writeLine(`Assembling ${CompanionIdentity.name} for ${architectures.join(', ')} with Gradle.`)
  const gradle = await CLI.run(FS.resolvePath('gradlew', androidRoot), {
    args: [':app:assembleDebug', ...companionGradleArgs(architectures, Platform.runtimeProcess.env)],
    cwd: androidRoot,
    env: await companionGradleEnv(root, Platform.runtimeProcess.env),
    stdio: 'inherit',
  })
  // The arguments can carry proxy credentials, so the failure is reported without them; Gradle has
  // already printed its own reason above.
  if (gradle.error !== undefined || gradle.exitCode !== 0) {
    Errors.throwHostEnvironment(`Gradle could not assemble ${CompanionIdentity.name}; its output above says why.`)
  }

  const manifest: HostManifest = {
    format: 1,
    hostVersion: await companionVersion(packageRoot),
    nativeKit: await nativeKitOf(packageRoot),
    platform: 'android',
  }
  const hostDirectory = FS.resolvePath(`${CHECKOUT_HOSTS_PATH}/${manifest.hostVersion}/android`, root)
  await publishHost(hostDirectory, FS.resolvePath(APK_OUTPUT_PATH, androidRoot), manifest)
  HCI.writeSuccess(
    `Built ${CompanionIdentity.name} ${manifest.hostVersion} for Android at ${FS.displayPath(hostDirectory)}.\n`,
  )
  return 0
}

/**
 * Gradle ignores the `HTTPS_PROXY` family that every other tool here honours, so a build behind a
 * proxy fails at its first download. Those variables are handed to Gradle as the JVM's own proxy
 * properties, credentials included; the arguments are never echoed.
 */
export function companionGradleArgs(
  architectures: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const args = [
    `-PreactNativeArchitectures=${architectures.join(',')}`,
    // The Kotlin compile daemon writes a lock under the system temporary directory whatever
    // `java.io.tmpdir` says, which a sandboxed build cannot; compiling in Gradle's own process
    // needs no second JVM, but it needs the heap that JVM would have had: the template's 2 GB runs
    // out once a clean build compiles the Expo modules in parallel.
    '-Pkotlin.compiler.execution.strategy=in-process',
    `-Dorg.gradle.jvmargs=${GRADLE_DAEMON_JVM_ARGS}`,
    '--console=plain',
  ]
  const proxy = parseProxy(env['HTTPS_PROXY'] ?? env['https_proxy'])
  if (proxy === undefined) {
    return args
  }
  for (const scheme of ['http', 'https']) {
    args.push(`-D${scheme}.proxyHost=${proxy.host}`, `-D${scheme}.proxyPort=${proxy.port}`)
    if (proxy.user !== undefined) {
      args.push(`-D${scheme}.proxyUser=${proxy.user}`, `-D${scheme}.proxyPassword=${proxy.password ?? ''}`)
    }
  }
  const noProxy = env['NO_PROXY'] ?? env['no_proxy']
  if (noProxy !== undefined && noProxy !== '') {
    args.push(`-Dhttp.nonProxyHosts=${noProxy.split(',').map(host => host.trim()).filter(Boolean).join('|')}`)
  }
  return args
}

type Proxy = { host: string; password?: string; port: string; user?: string }

function parseProxy(value: string | undefined): Proxy | undefined {
  if (value === undefined || value === '') {
    return undefined
  }
  const url = new URL(value.includes('://') ? value : `http://${value}`)
  return {
    host: url.hostname,
    port: url.port === '' ? '80' : url.port,
    ...(url.username === ''
      ? {}
      : { password: decodeURIComponent(url.password), user: decodeURIComponent(url.username) }),
  }
}

/**
 * The Android SDK comes from the environment, or else from this checkout's devenv profile. The JVM
 * on macOS ignores `TMPDIR` for its temporary directory, so it is told explicitly; and Java refuses
 * Basic authentication to a proxy tunnel unless re-enabled, which an authenticated proxy needs.
 */
export async function companionGradleEnv(
  root: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<Record<string, string>> {
  const sdk = env['ANDROID_HOME'] ?? env['ANDROID_SDK_ROOT'] ?? FS.resolvePath(DEVENV_ANDROID_SDK_PATH, root)
  if (!await FS.isDirectory(sdk)) {
    Errors.throwUserInput(
      `No Android SDK at ${FS.displayPath(sdk)}. Run \`direnv allow\` so devenv provides one, or set ANDROID_HOME.`,
    )
  }
  const javaOptions = [
    env['JAVA_TOOL_OPTIONS'],
    env['TMPDIR'] === undefined ? undefined : `-Djava.io.tmpdir=${env['TMPDIR']}`,
    '-Djdk.http.auth.tunneling.disabledSchemes=',
    '-Djdk.http.auth.proxying.disabledSchemes=',
  ].filter(option => option !== undefined && option !== '')
  return { ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, JAVA_TOOL_OPTIONS: javaOptions.join(' ') }
}

async function companionVersion(packageRoot: string): Promise<string> {
  const config = await FS.readJson<{ expo?: { version?: unknown } }>(FS.resolvePath('app.json', packageRoot))
  const version = config.expo?.version
  if (typeof version !== 'string' || version === '') {
    Errors.throwUnexpected(`Expected: ${CompanionIdentity.packagePath}/app.json declares expo.version.`)
  }
  return version
}

/**
 * The host is staged beside its final directory and moved into place, so a `tao dev` searching the
 * cache meanwhile finds the old host, then none, then the new one — never an APK without its
 * manifest or a manifest describing a different APK.
 */
async function publishHost(hostDirectory: string, apkPath: string, manifest: HostManifest): Promise<void> {
  if (!await FS.isFile(apkPath)) {
    Errors.throwUnexpected(`Expected: Gradle's assembleDebug leaves its APK at ${FS.displayPath(apkPath)}.`)
  }
  const staging = `${hostDirectory}.staging-${Platform.randomUUID()}`
  await FS.mkdir(staging)
  await FS.copyFile(apkPath, FS.resolvePath(HOST_BINARIES.android, staging))
  await writeHostManifest(staging, manifest)
  await FS.remove(hostDirectory)
  await FS.move(staging, hostDirectory)
}
