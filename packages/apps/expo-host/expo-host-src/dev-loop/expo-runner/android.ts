import { CLI, Errors, FS, Platform, Repo, Text, Time } from '@shared'
import { DevLoopOutput } from '../DevLoopOutput'
import { companionDevClientUrl, CompanionIdentity } from '../prebuilt-host/CompanionIdentity'
import { nativeKitOf } from '../prebuilt-host/HostManifest'
import { type HostSearch, obtainCompatibleHost, type PrebuiltHost } from '../prebuilt-host/PrebuiltHosts'
import { type EmulatorLog, EmulatorLogs } from './EmulatorLogs'
import { EXPO_SDK_VERSION, ExpoConfig, expoSdkMajor, type ExpoSessionConfig } from './expo-config'
import { createExpoMetro, ExpoMetro, type ExpoMetroSession } from './metro'

const EXPO_GO_APP_ID = 'host.exp.exponent'
/**
 * An emulator opens Tao apps in the prebuilt Tao Companion when a compatible build of it is at
 * hand — one whose manifest carries this Tao's whole native kit — and in Expo Go otherwise. Expo Go
 * still serves Android: Expo publishes an APK for each SDK generation outside the Play Store, and
 * this loop sideloads the one matching `EXPO_SDK_VERSION`. The phone lane Expo closed is iOS, and
 * `physical-device.ts` says why; the Companion replaces Expo Go lane by lane as its builds exist.
 */
const EXPO_GO_SDK_VERSION = EXPO_SDK_VERSION
const EXPO_VERSIONS_URL = 'https://api.expo.dev/v2/versions/latest'
const EXPO_GO_APK_CACHE_DIR = FS.joinPath('.artifacts/android/expo-go')
const EXPO_ADB_USER = '0'
const ANDROID_AVD_NAME = 'Tao_Pixel_API_36'
const ANDROID_AVD_DEVICE = 'pixel'
const ANDROID_EMULATOR_MEMORY_MB = 2_048
const ANDROID_SYSTEM_IMAGE = 'system-images;android-36;google_apis;arm64-v8a'
const ANDROID_AVD_CONFIG = {
  'hw.keyboard': 'yes',
  'hw.ramSize': `${ANDROID_EMULATOR_MEMORY_MB}M`,
}
const EMULATOR_BOOT_TIMEOUT_MS = 180_000
const EMULATOR_BOOT_POLL_MS = 2_000
const androidAdbMissingMessage = 'Android adb CLI not found. Run direnv allow so devenv can expose the Android SDK.'

export type AndroidSession = ReturnType<typeof createAndroid>

export type AndroidCompatibilityDependencies = {
  /** Finds a prebuilt host able to run this Tao's app host; the default searches the caches, then releases. */
  findPrebuiltHost?: () => Promise<HostSearch>
  findRunningEmulator?: typeof findRunningEmulator
  installCompanion?: (serial: string, host: PrebuiltHost) => Promise<void>
  installExpoGo?: (serial: string) => Promise<void>
  installedCompanionMatches?: (serial: string, host: PrebuiltHost) => Promise<boolean>
  installedExpoGoVersion?: typeof installedExpoGoVersion
  isEmulatorBooted?: typeof isEmulatorBooted
  requireAdb?: () => Promise<void>
  reverseMetroPort?: typeof reverseMetroPort
}

/** AndroidRuntime is the app a prepared device opens Tao apps in. */
type AndroidRuntime = 'companion' | 'expo-go'

/** createAndroid binds Android Expo helpers to one Expo session. */
export function createAndroid(
  config: ExpoSessionConfig,
  metro: ExpoMetroSession = createExpoMetro(config),
  compatibility: AndroidCompatibilityDependencies = {},
) {
  // A device keeps the runtime it was prepared with for the session, so the open that follows
  // preparation cannot land in Expo Go after a Companion was installed for it, or the reverse.
  const runtimes = new Map<string, AndroidRuntime>()
  const prepare = async (serial: string): Promise<void> => {
    runtimes.set(serial, await prepareRuntimeOnSerial(config, serial, compatibility))
  }
  return {
    ensureEmulator,
    ensureExpoGo: () => ensureExpoGo(compatibility),
    ensureExpoGoOnSerial: (serial: string) => ensureExpoGoOnSerial(serial, compatibility),
    ensureRuntime: async () => {
      await (compatibility.requireAdb ?? requireAdb)()
      await prepare(await requireBootedEmulator())
    },
    listPhysicalDevices,
    openExpoGoOnSerial: (serial: string, url: string = config.EXPO_GO_URL) => openExpoGoOnSerial(serial, url),
    openRuntime: (expoGoUrl: string = config.EXPO_GO_URL) => openRuntime(config, metro, runtimes, expoGoUrl),
    openRuntimeOnSerial: (serial: string, expoGoUrl: string, metroHost: string) =>
      openRuntimeOnSerial(config, runtimes, serial, expoGoUrl, metroHost),
    prepareAvailableRuntime: () => prepareAvailableRuntime(config, compatibility, prepare),
    prepareRuntimeOnSerial: prepare,
    reverseMetroPort: (serial: string) => reverseMetroPort(config, serial),
  }
}

/** Android is the fixed default Android session used by explicit single-session commands. */
export const Android = createAndroid(ExpoConfig, ExpoMetro)

async function ensureEmulator(): Promise<void> {
  await requireCommand(
    'emulator',
    'Android emulator CLI not found. Run direnv allow so devenv can expose the Android SDK.',
  )
  await requireCommand(
    'avdmanager',
    'Android avdmanager CLI not found. Run direnv allow so devenv can expose the Android SDK.',
  )
  await requireCommand('adb', androidAdbMissingMessage)

  let avds = await listAvds()
  if (avds.length === 0) {
    await requireCommand(
      'sdkmanager',
      'Android sdkmanager CLI not found. Run direnv allow so devenv can expose the Android SDK.',
    )
    await requireAndroidSdkPackage(ANDROID_SYSTEM_IMAGE)
    DevLoopOutput.logDevLoop('dev', `No Android emulator found; creating ${ANDROID_AVD_NAME}.`)
    await CLI.mustRun('avdmanager', {
      args: [
        'create',
        'avd',
        '--force',
        '--name',
        ANDROID_AVD_NAME,
        '--package',
        ANDROID_SYSTEM_IMAGE,
        '--device',
        ANDROID_AVD_DEVICE,
      ],
      stdin: 'no\n',
      stdio: 'inherit',
    })
    await ensureAvdConfig(ANDROID_AVD_NAME)
    avds = await listAvds()
  }

  const avdName = preferredAvdName(avds)
  if (avdName === ANDROID_AVD_NAME) {
    await ensureAvdConfig(avdName)
  }
  const runningSerial = await findRunningEmulator()
  await pruneEmulatorLogs(runningSerial !== undefined)
  if (runningSerial) {
    if (await isEmulatorBooted(runningSerial)) {
      DevLoopOutput.logDevLoop('dev', `Android emulator ${runningSerial} is already booted.`)
      return
    }
    DevLoopOutput.logDevLoop('dev', `Android emulator ${runningSerial} is starting.`)
    await waitForBootedEmulator()
  } else {
    const log = await EmulatorLogs.begin()
    let exited = () => false
    let outcome: 'booted' | 'failed' | 'timed-out' = 'timed-out'
    try {
      exited = await startEmulator(avdName, log)
      await waitForBootedEmulator(log.path, exited)
      outcome = 'booted'
    } catch (error) {
      outcome = exited() ? 'failed' : 'timed-out'
      throw error
    } finally {
      await EmulatorLogs.finish(log, outcome).catch(warnEmulatorLogFailure)
      await pruneEmulatorLogs(!exited())
    }
  }
}

async function pruneEmulatorLogs(mayHaveUnrecordedEmulator: boolean): Promise<void> {
  await EmulatorLogs.prune(mayHaveUnrecordedEmulator).catch(warnEmulatorLogFailure)
}

function warnEmulatorLogFailure(error: unknown): void {
  DevLoopOutput.logDevLoop('dev', `Could not maintain Android emulator logs: ${Errors.messageOf(error)}`, 'warn')
}

async function ensureExpoGo(compatibility: AndroidCompatibilityDependencies): Promise<void> {
  await (compatibility.requireAdb ?? requireAdb)()
  await ensureExpoGoOnSerial(await requireBootedEmulator(), compatibility)
}

async function ensureExpoGoOnSerial(
  serial: string,
  compatibility: AndroidCompatibilityDependencies,
): Promise<void> {
  await (compatibility.requireAdb ?? requireAdb)()
  const installedVersion = await (compatibility.installedExpoGoVersion ?? installedExpoGoVersion)(serial)
  if (expoGoSupportsSdk(installedVersion)) {
    DevLoopOutput.logDevLoop('dev', `Compatible Expo Go ${installedVersion} is already installed on ${serial}.`)
    return
  }

  DevLoopOutput.logDevLoop(
    'dev',
    installedVersion === undefined
      ? `Installing Expo Go for SDK ${EXPO_GO_SDK_VERSION} on ${serial}.`
      : `Replacing incompatible Expo Go ${installedVersion} on ${serial} for SDK ${EXPO_GO_SDK_VERSION}.`,
  )
  await (compatibility.installExpoGo ?? installExpoGo)(serial)
}

async function installExpoGo(serial: string): Promise<void> {
  const apkPath = await downloadExpoGoApk()
  await CLI.mustRun('adb', {
    args: ['-s', serial, 'install', '-r', '-d', '--user', EXPO_ADB_USER, apkPath],
    stdio: 'inherit',
  })
}

/** listPhysicalDevices returns adb serials that are not emulators. */
async function listPhysicalDevices(): Promise<string[]> {
  await requireCommand('adb', androidAdbMissingMessage)
  return (await listAdbDevices()).filter(serial => !serial.startsWith('emulator-'))
}

async function prepareAvailableRuntime(
  config: ExpoSessionConfig,
  compatibility: AndroidCompatibilityDependencies,
  prepare: (serial: string) => Promise<void>,
): Promise<boolean> {
  await (compatibility.requireAdb ?? requireAdb)()
  const serial = await (compatibility.findRunningEmulator ?? findRunningEmulator)()
  if (!serial || !await (compatibility.isEmulatorBooted ?? isEmulatorBooted)(serial)) {
    DevLoopOutput.logDevLoop('dev', 'No booted Android emulator found; skipping Android launch.')
    return false
  }
  // A newcomer opening Android from `tao dev` has no `./dev` to run first, so this path installs the
  // runtime itself and announces what it installs. A failure leaves Android skipped with its reason
  // rather than ending the dev loop.
  try {
    await prepare(serial)
  } catch (error) {
    DevLoopOutput.logDevLoop(
      'dev',
      `Could not prepare ${serial} to run this app: ${Errors.formatForUser(error)}`,
      'warn',
    )
    return false
  }
  await (compatibility.reverseMetroPort ?? reverseMetroPort)(config, serial)
  return true
}

/**
 * prepareRuntimeOnSerial installs the runtime this device will open Tao apps in: the newest
 * prebuilt Companion whose manifest carries this Tao's native kit, or else a matching Expo Go.
 * Every host it passed over is named with its reason, since a host that exists but does not fit is
 * the one fact a developer expecting the Companion needs.
 */
async function prepareRuntimeOnSerial(
  config: ExpoSessionConfig,
  serial: string,
  compatibility: AndroidCompatibilityDependencies,
): Promise<AndroidRuntime> {
  const search = await (compatibility.findPrebuiltHost ?? (() => findPrebuiltHostFor(config)))()
  for (const reason of search.refused) {
    DevLoopOutput.logDevLoop('dev', `Passed over the prebuilt host at ${reason}.`, 'warn')
  }
  if (search.host !== undefined) {
    await ensureCompanionOnSerial(serial, search.host, compatibility)
    return 'companion'
  }
  try {
    await ensureExpoGoOnSerial(serial, compatibility)
  } catch (error) {
    Errors.throwUserInput(
      `Could not install an Expo Go for SDK ${EXPO_GO_SDK_VERSION} on ${serial}: ${Errors.formatForUser(error)}`,
    )
  }
  return 'expo-go'
}

async function findPrebuiltHostFor(config: ExpoSessionConfig): Promise<HostSearch> {
  return await obtainCompatibleHost('android', await nativeKitOf(Repo.resolvePath(config.RUNTIME_TOOLCHAIN_PATH)))
}

async function ensureCompanionOnSerial(
  serial: string,
  host: PrebuiltHost,
  compatibility: AndroidCompatibilityDependencies,
): Promise<void> {
  const described = `${CompanionIdentity.name} ${host.manifest.hostVersion}`
  if (await (compatibility.installedCompanionMatches ?? installedCompanionMatches)(serial, host)) {
    DevLoopOutput.logDevLoop('dev', `${described} is already installed on ${serial}.`)
    return
  }
  DevLoopOutput.logDevLoop('dev', `Installing ${described} on ${serial} from ${FS.displayPath(host.directory)}.`)
  await (compatibility.installCompanion ?? installCompanion)(serial, host)
}

/**
 * The installed Companion matches a host exactly when its APK is byte-for-byte the host's binary:
 * Android keeps the installed APK, so hashing both ends answers without trusting a version string
 * that a rebuild from changed native code would leave untouched.
 */
async function installedCompanionMatches(serial: string, host: PrebuiltHost): Promise<boolean> {
  const path = await CLI.run('adb', {
    args: ['-s', serial, 'shell', 'pm', 'path', '--user', EXPO_ADB_USER, CompanionIdentity.androidPackage],
  })
  const installedApk = /^package:(\S+)$/mu.exec(path.stdout)?.[1]
  if (path.error !== undefined || path.exitCode !== 0 || installedApk === undefined) {
    return false
  }
  const digest = await CLI.run('adb', { args: ['-s', serial, 'shell', 'sha256sum', installedApk] })
  const installedDigest = digest.stdout.trim().split(/\s+/u)[0]
  return digest.error === undefined && digest.exitCode === 0
    && installedDigest === Platform.sha256Hex(await FS.readFile(host.binaryPath))
}

async function installCompanion(serial: string, host: PrebuiltHost): Promise<void> {
  await CLI.mustRun('adb', {
    args: ['-s', serial, 'install', '-r', '-d', '--user', EXPO_ADB_USER, host.binaryPath],
    stdio: 'inherit',
  })
}

/**
 * openRuntime opens the app in the runtime prepared for the booted emulator once Metro is ready,
 * and answers which one that was. The Companion reaches Metro through the `adb reverse` of its
 * port, so its link names the emulator's own loopback address.
 */
async function openRuntime(
  config: ExpoSessionConfig,
  metro: ExpoMetroSession,
  runtimes: ReadonlyMap<string, AndroidRuntime>,
  expoGoUrl: string,
): Promise<AndroidRuntime> {
  await metro.waitForMetro()
  const serial = await requireBootedEmulator()
  await reverseMetroPort(config, serial)
  return await openRuntimeOnSerial(config, runtimes, serial, expoGoUrl, '127.0.0.1')
}

/**
 * openRuntimeOnSerial opens the app on one device in the runtime it was prepared with: the Companion
 * through its development-client link to Metro at `metroHost`, or Expo Go at `expoGoUrl`. A device
 * whose Metro port is reversed reaches Metro on its own loopback; any other needs the Mac's address.
 */
async function openRuntimeOnSerial(
  config: ExpoSessionConfig,
  runtimes: ReadonlyMap<string, AndroidRuntime>,
  serial: string,
  expoGoUrl: string,
  metroHost: string,
): Promise<AndroidRuntime> {
  if (runtimes.get(serial) === 'companion') {
    await openCompanionOnSerial(serial, companionDevClientUrl({ host: metroHost, port: config.EXPO_PORT }))
    return 'companion'
  }
  await openExpoGoOnSerial(serial, expoGoUrl)
  return 'expo-go'
}

async function openCompanionOnSerial(serial: string, url: string): Promise<void> {
  DevLoopOutput.logDevLoop('dev', `Opening ${url} in ${CompanionIdentity.name} on ${serial}.`)
  await CLI.mustRun('adb', {
    args: [
      '-s',
      serial,
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      // `adb shell` hands its words to the device's shell, where an unquoted `&` or `?` in the
      // link would split or glob the command.
      `'${url}'`,
      '-p',
      CompanionIdentity.androidPackage,
    ],
    stdio: 'inherit',
  })
}

async function requireCommand(command: string, missingMessage: string): Promise<void> {
  if (!await CLI.commandExists(command)) {
    Errors.throwUserInput(missingMessage)
  }
}

async function requireAdb(): Promise<void> {
  await requireCommand('adb', androidAdbMissingMessage)
}

async function requireAndroidSdkPackage(sdkPackage: string): Promise<void> {
  const installed = await CLI.mustRun('sdkmanager', { args: ['--list_installed'] })
  if (installed.stdout.includes(sdkPackage)) {
    return
  }

  Errors.throwUserInput(Text.stripIndent(`
    Android SDK package ${sdkPackage} is not available in this devenv shell.
    Run \`direnv allow\` so Nix rebuilds the Android SDK from devenv.nix, then retry \`just android\`.
  `))
}

async function ensureAvdConfig(avdName: string): Promise<void> {
  const configPath = FS.resolvePath(`${avdName}.avd/config.ini`, avdHome())
  if (!await FS.exists(configPath)) {
    return
  }

  const config = await FS.readText(configPath)
  let nextConfig = config
  for (const [key, value] of Object.entries(ANDROID_AVD_CONFIG)) {
    nextConfig = upsertAvdConfigValue(nextConfig, key, value)
  }
  if (nextConfig !== config) {
    await FS.writeText(configPath, nextConfig)
  }
}

function avdHome(): string {
  const androidUserHome = Platform.runtimeProcess.env['ANDROID_USER_HOME']
    ?? FS.resolvePath('.android', FS.homeDir())
  return Platform.runtimeProcess.env['ANDROID_AVD_HOME'] ?? FS.resolvePath('avd', androidUserHome)
}

function upsertAvdConfigValue(config: string, key: string, value: string): string {
  const line = `${key} = ${value}`
  const keyPattern = Text.escapeRegExp(key)
  return config.match(new RegExp(`^${keyPattern}\\s*=`, 'm'))
    ? config.replace(new RegExp(`^${keyPattern}\\s*=.*$`, 'm'), line)
    : `${config.trimEnd()}\n${line}\n`
}

async function listAvds(): Promise<string[]> {
  const result = await CLI.mustRun('emulator', { args: ['-list-avds'] })
  return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

function preferredAvdName(avds: readonly string[]): string {
  const avdName = avds.includes(ANDROID_AVD_NAME) ? ANDROID_AVD_NAME : avds[0]
  if (!avdName) {
    Errors.throwUserInput('Android emulator creation did not produce an available AVD.')
  }
  return avdName
}

async function listAdbDevices(): Promise<string[]> {
  const result = await CLI.mustRun('adb', { args: ['devices'] })
  return result.stdout
    .split(/\r?\n/)
    .map(line => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial !== undefined && serial !== 'List' && state === 'device')
    .map(([serial]) => serial!)
}

async function findRunningEmulator(): Promise<string | undefined> {
  return (await listAdbDevices()).find(serial => serial.startsWith('emulator-'))
}

async function isEmulatorBooted(serial: string): Promise<boolean> {
  const result = await CLI.run('adb', { args: ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'] })
  return !result.error && result.exitCode === 0 && result.stdout.trim() === '1'
}

/** startEmulator starts the emulator detached and answers whether that process has since exited. */
async function startEmulator(avdName: string, log: EmulatorLog): Promise<() => boolean> {
  DevLoopOutput.logDevLoop('dev', `Starting Android emulator ${avdName}.`)
  const logFile = await FS.openAppend(log.path)
  let exited = false
  try {
    const emulator = CLI.start('emulator', {
      args: ['-avd', avdName, '-memory', String(ANDROID_EMULATOR_MEMORY_MB), '-netdelay', 'none', '-netspeed', 'full'],
      detached: true,
      stdio: ['ignore', logFile.fd, logFile.fd],
      unref: true,
    })
    await EmulatorLogs.recordChild(log, emulator.pid)
    emulator.onceClose(() => {
      exited = true
    })
    emulator.onceError(error =>
      DevLoopOutput.logDevLoop('dev', `Failed to start Android emulator: ${error.message}`, 'error')
    )
  } finally {
    await logFile.close()
  }
  return () => exited
}

/**
 * waitForBootedEmulator waits for an emulator to finish booting. An emulator this loop started that
 * exits first ends the wait at once with the reason its log gives, rather than after the whole boot
 * timeout with none.
 */
async function waitForBootedEmulator(logPath?: string, exited: () => boolean = () => false): Promise<void> {
  const serial = await Time.pollUntil(async () => {
    const candidate = await findRunningEmulator()
    return candidate && await isEmulatorBooted(candidate) ? candidate : undefined
  }, { intervalMs: EMULATOR_BOOT_POLL_MS, stop: exited, timeoutMs: EMULATOR_BOOT_TIMEOUT_MS })
  if (serial !== undefined) {
    DevLoopOutput.logDevLoop('dev', `Android emulator ${serial} is booted.`)
    return
  }
  if (exited() && logPath !== undefined) {
    Errors.throwUserInput(emulatorExitMessage(await FS.readText(logPath).catch(() => ''), logPath))
  }
  Errors.throwUserInput(
    logPath === undefined
      ? 'Android emulator did not finish booting.'
      : `Android emulator did not finish booting. Check ${logPath}.`,
  )
}

/**
 * emulatorExitMessage names why an emulator exited before booting, from the last line its log holds.
 * Qt's processor check is the one worth explaining: a sandboxed shell hides the CPU's features, so
 * an Apple silicon Mac reads as lacking NEON, and the emulator only starts from an ordinary shell.
 */
export function emulatorExitMessage(logText: string, logPath: string): string {
  const lines = logText.split(/\r?\n/u).map(line => line.trim()).filter(line => line.length > 0)
  const processorCheck = lines.findIndex(line => line.startsWith('Incompatible processor'))
  if (processorCheck !== -1) {
    return `Android emulator exited before it booted: ${lines.slice(processorCheck).join(' ')} That check fails `
      + `when a sandboxed shell hides the CPU's features; start the emulator from an ordinary shell. Its log is ${logPath}.`
  }
  const reason = lines.at(-1)
  if (reason === undefined) {
    return `Android emulator exited before it booted, leaving nothing in ${logPath}.`
  }
  return `Android emulator exited before it booted: ${reason}. Its log is ${logPath}.`
}

async function requireBootedEmulator(): Promise<string> {
  const serial = await findRunningEmulator()
  if (!serial || !await isEmulatorBooted(serial)) {
    Errors.throwUserInput(
      'No booted Android emulator found. Start one with `just android` or `./dev android-emulator`.',
    )
  }
  return serial
}

async function isPackageInstalled(serial: string, appId: string): Promise<boolean> {
  const result = await CLI.run('adb', {
    args: ['-s', serial, 'shell', 'pm', 'list', 'packages', '--user', EXPO_ADB_USER, appId],
  })
  return !result.error && result.exitCode === 0
    && result.stdout.split(/\r?\n/).some(line => line.trim() === `package:${appId}`)
}

/** expoGoVersionFromPackageInfo reads Android's stable package-manager versionName field. */
export function expoGoVersionFromPackageInfo(output: string): string | undefined {
  return /^\s*versionName=([^\s]+)\s*$/mu.exec(output)?.[1]
}

/** expoGoSupportsSdk accepts only an Expo Go client built for this repository's SDK major. */
export function expoGoSupportsSdk(
  version: string | undefined,
  sdkVersion = EXPO_GO_SDK_VERSION,
): boolean {
  const installedMajor = version === undefined ? undefined : expoSdkMajor(version)
  const sdkMajor = expoSdkMajor(sdkVersion)
  return installedMajor !== undefined && sdkMajor !== undefined && installedMajor === sdkMajor
}

async function installedExpoGoVersion(serial: string): Promise<string | undefined> {
  if (!await isPackageInstalled(serial, EXPO_GO_APP_ID)) {
    return undefined
  }
  const result = await CLI.run('adb', {
    args: ['-s', serial, 'shell', 'dumpsys', 'package', EXPO_GO_APP_ID],
  })
  return result.error === undefined && result.exitCode === 0
    ? expoGoVersionFromPackageInfo(result.stdout)
    : undefined
}

async function downloadExpoGoApk(): Promise<string> {
  const url = await getExpoGoApkUrl()
  const filename = FS.basename(new URL(url).pathname)
  const outputDir = Repo.resolvePath(EXPO_GO_APK_CACHE_DIR)
  const outputPath = FS.resolvePath(filename, outputDir)
  if (await FS.exists(outputPath)) {
    return outputPath
  }

  await FS.mkdir(FS.dirname(outputPath))
  DevLoopOutput.logDevLoop('dev', `Downloading Expo Go for SDK ${EXPO_GO_SDK_VERSION}.`)
  const response = await fetch(url)
  if (!response.ok) {
    Errors.throwUserInput(`Failed to download Expo Go APK: ${response.status} ${response.statusText}`)
  }
  await FS.writeFile(outputPath, Buffer.from(await response.arrayBuffer()))
  return outputPath
}

type ExpoVersionsResponse = {
  data?: {
    sdkVersions?: Record<string, { androidClientUrl?: string }>
  }
}

async function getExpoGoApkUrl(): Promise<string> {
  const response = await fetch(EXPO_VERSIONS_URL)
  if (!response.ok) {
    Errors.throwUserInput(`Failed to resolve Expo Go APK: ${response.status} ${response.statusText}`)
  }
  const versions = await response.json() as ExpoVersionsResponse
  const url = versions.data?.sdkVersions?.[EXPO_GO_SDK_VERSION]?.androidClientUrl
  if (!url) {
    Errors.throwUserInput(`Expo Go APK URL not found for SDK ${EXPO_GO_SDK_VERSION}.`)
  }
  return url
}

async function openExpoGoOnSerial(serial: string, url: string): Promise<void> {
  DevLoopOutput.logDevLoop('dev', `Opening ${url} on ${serial}.`)
  await CLI.mustRun('adb', {
    args: [
      '-s',
      serial,
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      url,
      '-p',
      EXPO_GO_APP_ID,
    ],
    stdio: 'inherit',
  })
}

async function reverseMetroPort(config: ExpoSessionConfig, serial: string): Promise<boolean> {
  const result = await CLI.run('adb', {
    args: ['-s', serial, 'reverse', `tcp:${config.EXPO_PORT}`, `tcp:${config.EXPO_PORT}`],
  })
  return result.error === undefined && result.exitCode === 0
}
