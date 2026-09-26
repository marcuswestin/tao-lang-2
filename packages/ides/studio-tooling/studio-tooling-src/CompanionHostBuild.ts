import { CompanionIdentity } from '@expo-host/dev-loop/prebuilt-host/CompanionIdentity'
import {
  HOST_BINARIES,
  hostKey,
  type HostManifest,
  type HostPlatform,
  nativeKitOf,
  readHostManifest,
  writeHostManifest,
} from '@expo-host/dev-loop/prebuilt-host/HostManifest'
import {
  hostReleaseAssets,
  hostReleasesRepository,
  hostReleaseTag,
} from '@expo-host/dev-loop/prebuilt-host/HostReleases'
import { CHECKOUT_HOSTS_PATH } from '@expo-host/dev-loop/prebuilt-host/PrebuiltHosts'
import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'

/*
 * Builds the Tao Companion as a prebuilt Android host, and publishes one. Expo prebuild writes the
 * native project, Gradle assembles a debug APK — a development client, which runs whatever bundle
 * Metro serves it — and the APK lands in this checkout's host cache beside a manifest naming the
 * native kit it was built with. `tao dev` installs it on an emulator whenever that kit covers the one
 * it computes for itself, and falls back to Expo Go when none does. Publishing puts the same two
 * files on a GitHub release, where any `tao dev` can download them.
 */

const APK_OUTPUT_PATH = 'app/build/outputs/apk/debug/app-debug.apk'
/** An Apple silicon emulator runs arm64-v8a, an Intel or Linux one x86_64; a host carries both. */
const DEFAULT_ARCHITECTURES = ['arm64-v8a', 'x86_64'] as const
const DEVENV_ANDROID_SDK_PATH = '.devenv/profile/libexec/android-sdk'
const GRADLE_DAEMON_JVM_ARGS = '-Xmx4g -XX:MaxMetaspaceSize=1g -Dfile.encoding=UTF-8'
const IOS_DERIVED_DATA_PATH = 'build'
const HOST_PLATFORMS: readonly HostPlatform[] = ['android', 'ios-simulator']
const UTF8_LOCALE = { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }

/** CompanionHostBuildOptions choose the platform, and narrow an Android build to fewer ABIs. */
export type CompanionHostBuildOptions = {
  architectures?: readonly string[]
  platform?: HostPlatform
  repositoryRoot?: string
}

/** runCompanionHostBuild builds one platform's host into the checkout's host cache and returns an exit code. */
export async function runCompanionHostBuild(options: CompanionHostBuildOptions = {}): Promise<number> {
  const root = options.repositoryRoot ?? Repo.getRoot()
  const packageRoot = FS.resolvePath(CompanionIdentity.packagePath, root)
  const platform = options.platform ?? 'android'

  HCI.writeLine(`Generating the ${CompanionIdentity.name} ${platform} project with expo prebuild.`)
  await CLI.mustRun('bunx', {
    args: ['expo', 'prebuild', '--platform', platform === 'android' ? 'android' : 'ios', '--no-install'],
    cwd: packageRoot,
    stdio: 'inherit',
  })
  const binary = platform === 'android'
    ? await assembleAndroid(root, packageRoot, options.architectures ?? DEFAULT_ARCHITECTURES)
    : await buildIosSimulator(packageRoot)

  const manifest = await companionHostManifest(packageRoot, platform)
  const hostDirectory = checkoutHostDirectory(root, manifest)
  await placeHost(hostDirectory, binary, manifest)
  HCI.writeSuccess(
    `Built ${CompanionIdentity.name} ${manifest.hostVersion} for ${platform} at ${FS.displayPath(hostDirectory)}.\n`,
  )
  return 0
}

async function assembleAndroid(root: string, packageRoot: string, architectures: readonly string[]): Promise<string> {
  const androidRoot = FS.resolvePath('android', packageRoot)
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
  const apk = FS.resolvePath(APK_OUTPUT_PATH, androidRoot)
  if (!await FS.isFile(apk)) {
    Errors.throwUnexpected(`Expected: Gradle's assembleDebug leaves its APK at ${FS.displayPath(apk)}.`)
  }
  return apk
}

/**
 * The simulator host is an unsigned debug build for every simulator architecture — Apple silicon
 * and Intel Macs both run it — with Xcode's derived data kept inside the package's own `ios/`, so the
 * built app is found at a known path. CocoaPods needs a UTF-8 locale to read the podspecs.
 */
async function buildIosSimulator(packageRoot: string): Promise<string> {
  const iosRoot = FS.resolvePath('ios', packageRoot)
  HCI.writeLine(`Installing ${CompanionIdentity.name}'s pods.`)
  await CLI.mustRun('pod', { args: ['install'], cwd: iosRoot, env: UTF8_LOCALE, stdio: 'inherit' })

  const workspace = (await FS.listDir(iosRoot)).find(name => name.endsWith('.xcworkspace'))
  if (workspace === undefined) {
    Errors.throwUnexpected(`Expected: expo prebuild leaves an Xcode workspace in ${FS.displayPath(iosRoot)}.`)
  }
  HCI.writeLine(`Building ${CompanionIdentity.name} for the iOS Simulator with xcodebuild.`)
  const xcodebuild = await CLI.run('xcodebuild', {
    args: [
      '-workspace',
      workspace,
      '-scheme',
      workspace.replace(/\.xcworkspace$/u, ''),
      '-configuration',
      'Debug',
      '-sdk',
      'iphonesimulator',
      '-destination',
      'generic/platform=iOS Simulator',
      '-derivedDataPath',
      IOS_DERIVED_DATA_PATH,
      'ARCHS=arm64 x86_64',
      'ONLY_ACTIVE_ARCH=NO',
      // Signed ad hoc, not unsigned: Xcode embeds a simulator app's entitlements only while signing
      // it, and without them CloudKit aborts the app the first time a Tao app asks for a container.
      'CODE_SIGN_IDENTITY=-',
      'build',
    ],
    cwd: iosRoot,
    env: UTF8_LOCALE,
    stdio: 'inherit',
  })
  if (xcodebuild.error !== undefined || xcodebuild.exitCode !== 0) {
    Errors.throwHostEnvironment(`xcodebuild could not build ${CompanionIdentity.name}; its output above says why.`)
  }
  const products = FS.resolvePath(`${IOS_DERIVED_DATA_PATH}/Build/Products/Debug-iphonesimulator`, iosRoot)
  const app = (await FS.listDir(products)).find(name => name.endsWith('.app'))
  if (app === undefined) {
    Errors.throwUnexpected(`Expected: xcodebuild leaves the built app in ${FS.displayPath(products)}.`)
  }
  const appPath = FS.resolvePath(app, products)
  await requireSimulatorEntitlements(appPath)
  return appPath
}

/**
 * The simulator reads an app's entitlements from a `__TEXT,__entitlements` section of its main
 * executable, which Xcode writes only for a signed build. The Companion always claims entitlements
 * (`tao-icloud`'s iCloud and push), and its Info.plist tells the CloudKit module they are there, so a
 * build without the section would pass that module's guard and then abort inside CloudKit. It is
 * refused here instead, where the cause is still visible.
 */
async function requireSimulatorEntitlements(appPath: string): Promise<void> {
  const executable = await CLI.mustRun('plutil', {
    args: ['-extract', 'CFBundleExecutable', 'raw', FS.resolvePath('Info.plist', appPath)],
  })
  const loadCommands = await CLI.mustRun('otool', {
    args: ['-l', FS.resolvePath(executable.stdout.trim(), appPath)],
  })
  if (!/sectname __entitlements\b/u.test(loadCommands.stdout)) {
    Errors.throwHostEnvironment(
      `xcodebuild built ${CompanionIdentity.name} without embedded entitlements; a simulator host must be `
        + 'signed (ad hoc is enough) for Xcode to embed them, or CloudKit aborts the app at launch.',
    )
  }
}

/** CompanionHostPublishOptions are the seams a test replaces: the checkout and the process runner. */
export type CompanionHostPublishOptions = {
  repositoryRoot?: string
  run?: typeof CLI.run
}

/**
 * runCompanionHostPublish puts the Android host built for the Companion as it stands on its GitHub
 * release, creating the release when it is new. A host built from an older Companion is refused
 * rather than published under the current name, since the release tag is the kit it carries.
 */
export async function runCompanionHostPublish(options: CompanionHostPublishOptions = {}): Promise<number> {
  const root = options.repositoryRoot ?? Repo.getRoot()
  const run = options.run ?? CLI.run
  const packageRoot = FS.resolvePath(CompanionIdentity.packagePath, root)
  const built: { binary: string; manifest: HostManifest }[] = []
  let expectedKey = ''
  for (const platform of HOST_PLATFORMS) {
    const expected = await companionHostManifest(packageRoot, platform)
    expectedKey = hostKey(expected)
    const directory = checkoutHostDirectory(root, expected)
    const manifest = await readHostManifest(directory)
    const binary = FS.resolvePath(HOST_BINARIES[platform], directory)
    if (manifest !== undefined && await FS.exists(binary)) {
      built.push({ binary, manifest })
    }
  }
  const first = built[0]
  if (first === undefined) {
    Errors.throwUserInput(
      `No host is built for ${CompanionIdentity.name} as it stands (${expectedKey}). `
        + 'Run `just companion-host-build` first.',
    )
  }

  const repository = hostReleasesRepository()
  const tag = hostReleaseTag(first.manifest)
  const platforms = built.map(host => host.manifest.platform).join(' and ')
  const staging = await Repo.mkScratchDir('tao-host-publish-', root)
  try {
    const assets: string[] = []
    for (const host of built) {
      const names = hostReleaseAssets(host.manifest.platform)
      await FS.writeJson(FS.resolvePath(names.manifest, staging), host.manifest)
      await stageReleaseBinary(host.binary, FS.resolvePath(names.binary, staging))
      assets.push(FS.resolvePath(names.manifest, staging), FS.resolvePath(names.binary, staging))
    }
    const existing = await run('gh', { args: ['release', 'view', tag, '--repo', repository, '--json', 'tagName'] })
    if (existing.error !== undefined) {
      Errors.throwUserInput('gh is not installed. Install the GitHub CLI, then run `gh auth login`.')
    }
    if (existing.exitCode !== 0) {
      await mustRunGh(run, [
        'release',
        'create',
        tag,
        '--repo',
        repository,
        '--prerelease',
        '--latest=false',
        '--title',
        `${CompanionIdentity.name} ${first.manifest.hostVersion} host (${hostKey(first.manifest)})`,
        '--notes',
        `Prebuilt ${CompanionIdentity.name} hosts that \`tao dev\` downloads when their native kit covers its own. `
        + `Each platform carries a \`tao-host-<platform>.json\` manifest beside its binary.`,
      ])
    }
    await mustRunGh(run, [
      'release',
      'upload',
      tag,
      '--repo',
      repository,
      '--clobber',
      ...assets,
    ])
  } finally {
    await FS.remove(staging)
  }
  HCI.writeSuccess(
    `Published ${CompanionIdentity.name} ${first.manifest.hostVersion} for ${platforms} to ${repository} as ${tag}.\n`,
  )
  return 0
}

/** A release carries an app bundle zipped with its folder, which `ditto` unpacks whole again. */
async function stageReleaseBinary(binary: string, asset: string): Promise<void> {
  if (await FS.isDirectory(binary)) {
    await CLI.mustRun('ditto', { args: ['-c', '-k', '--keepParent', binary, asset] })
  } else {
    await FS.copyFile(binary, asset)
  }
}

async function mustRunGh(run: typeof CLI.run, args: string[]): Promise<void> {
  const result = await run('gh', { args, stdio: 'inherit' })
  if (result.error !== undefined || result.exitCode !== 0) {
    Errors.throwHostEnvironment(`gh ${args.slice(0, 2).join(' ')} failed; its output above says why.`)
  }
}

async function companionHostManifest(packageRoot: string, platform: HostPlatform): Promise<HostManifest> {
  return {
    format: 1,
    hostVersion: await companionVersion(packageRoot),
    nativeKit: await nativeKitOf(packageRoot),
    platform,
  }
}

function checkoutHostDirectory(root: string, manifest: HostManifest): string {
  return FS.resolvePath(`${CHECKOUT_HOSTS_PATH}/${hostKey(manifest)}/${manifest.platform}`, root)
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
async function placeHost(hostDirectory: string, binaryPath: string, manifest: HostManifest): Promise<void> {
  const staging = `${hostDirectory}.staging-${Platform.randomUUID()}`
  await FS.mkdir(staging)
  await copyHostBinary(binaryPath, FS.resolvePath(HOST_BINARIES[manifest.platform], staging))
  await writeHostManifest(staging, manifest)
  await FS.remove(hostDirectory)
  await FS.move(staging, hostDirectory)
}

/** An app bundle is copied with `ditto`, which keeps its symbolic links, modes, and signature intact. */
async function copyHostBinary(from: string, to: string): Promise<void> {
  if (await FS.isDirectory(from)) {
    await CLI.mustRun('ditto', { args: [from, to] })
  } else {
    await FS.copyFile(from, to)
  }
}
