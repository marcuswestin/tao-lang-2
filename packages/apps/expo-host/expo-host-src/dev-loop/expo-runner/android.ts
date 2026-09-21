import { CLI, Errors, FS, Platform, Repo, Text, Time } from '@shared'
import { DevLoopOutput } from '../DevLoopOutput'
import { ExpoConfig, type ExpoSessionConfig } from './expo-config'
import { createExpoMetro, ExpoMetro, type ExpoMetroSession } from './metro'

const EXPO_GO_APP_ID = 'host.exp.exponent'
export const EXPO_GO_SDK_VERSION = '57.0.0'
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
  findRunningEmulator?: typeof findRunningEmulator
  installExpoGo?: (serial: string) => Promise<void>
  installedExpoGoVersion?: typeof installedExpoGoVersion
  isEmulatorBooted?: typeof isEmulatorBooted
  requireAdb?: () => Promise<void>
  reverseMetroPort?: typeof reverseMetroPort
}

/** createAndroid binds Android Expo helpers to one Expo session. */
export function createAndroid(
  config: ExpoSessionConfig,
  metro: ExpoMetroSession = createExpoMetro(config),
  compatibility: AndroidCompatibilityDependencies = {},
) {
  return {
    ensureEmulator,
    ensureExpoGo: () => ensureExpoGo(compatibility),
    ensureExpoGoOnSerial: (serial: string) => ensureExpoGoOnSerial(serial, compatibility),
    listPhysicalDevices,
    openExpoGo: (url: string = config.EXPO_GO_URL) => openExpoGo(config, metro, url),
    openExpoGoOnSerial: (serial: string, url: string = config.EXPO_GO_URL) => openExpoGoOnSerial(serial, url),
    prepareAvailableExpoGo: () => prepareAvailableExpoGo(config, compatibility),
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
  const logPath = FS.resolvePath('tao-android-emulator.log', FS.tmpdir())
  const runningSerial = await findRunningEmulator()
  if (runningSerial) {
    if (await isEmulatorBooted(runningSerial)) {
      DevLoopOutput.logDevLoop('dev', `Android emulator ${runningSerial} is already booted.`)
      return
    }
    DevLoopOutput.logDevLoop('dev', `Android emulator ${runningSerial} is starting.`)
    await waitForBootedEmulator(logPath)
  } else {
    await startEmulator(avdName, logPath)
    await waitForBootedEmulator(logPath)
  }
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

async function prepareAvailableExpoGo(
  config: ExpoSessionConfig,
  compatibility: AndroidCompatibilityDependencies,
): Promise<boolean> {
  await (compatibility.requireAdb ?? requireAdb)()
  const serial = await (compatibility.findRunningEmulator ?? findRunningEmulator)()
  if (!serial || !await (compatibility.isEmulatorBooted ?? isEmulatorBooted)(serial)) {
    DevLoopOutput.logDevLoop('dev', 'No booted Android emulator found; skipping Android launch.')
    return false
  }
  const installedVersion = await (compatibility.installedExpoGoVersion ?? installedExpoGoVersion)(serial)
  if (!expoGoSupportsSdk(installedVersion)) {
    DevLoopOutput.logDevLoop(
      'dev',
      installedVersion === undefined
        ? `Expo Go is not installed on ${serial}; run ./dev android-expo-go before opening Android.`
        : `Expo Go ${installedVersion} on ${serial} does not support SDK ${EXPO_GO_SDK_VERSION}; run ./dev android-expo-go to replace it.`,
    )
    return false
  }
  await (compatibility.reverseMetroPort ?? reverseMetroPort)(config, serial)
  return true
}

/** openExpoGo opens Expo Go on the booted Android emulator once Metro is ready. */
async function openExpoGo(
  config: ExpoSessionConfig,
  metro: ExpoMetroSession,
  url: string,
): Promise<void> {
  await openExpoGoWhenMetroIsReady(config, metro, url)
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

async function startEmulator(avdName: string, logPath: string): Promise<void> {
  DevLoopOutput.logDevLoop('dev', `Starting Android emulator ${avdName}.`)
  const logFile = await FS.openAppend(logPath)
  try {
    const emulator = CLI.start('emulator', {
      args: ['-avd', avdName, '-memory', String(ANDROID_EMULATOR_MEMORY_MB), '-netdelay', 'none', '-netspeed', 'full'],
      detached: true,
      stdio: ['ignore', logFile.fd, logFile.fd],
      unref: true,
    })
    emulator.onceError(error =>
      DevLoopOutput.logDevLoop('dev', `Failed to start Android emulator: ${error.message}`, 'error')
    )
  } finally {
    await logFile.close()
  }
}

async function waitForBootedEmulator(logPath: string): Promise<void> {
  const serial = await Time.pollUntil(async () => {
    const candidate = await findRunningEmulator()
    return candidate && await isEmulatorBooted(candidate) ? candidate : undefined
  }, { intervalMs: EMULATOR_BOOT_POLL_MS, timeoutMs: EMULATOR_BOOT_TIMEOUT_MS })
  if (serial !== undefined) {
    DevLoopOutput.logDevLoop('dev', `Android emulator ${serial} is booted.`)
    return
  }
  Errors.throwUserInput(`Android emulator did not finish booting. Check ${logPath}.`)
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
  const installedMajor = version?.match(/^(\d+)\./u)?.[1]
  const sdkMajor = sdkVersion.match(/^(\d+)\./u)?.[1]
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

async function openExpoGoWhenMetroIsReady(
  config: ExpoSessionConfig,
  metro: ExpoMetroSession,
  url: string,
): Promise<void> {
  await metro.waitForMetro()
  const serial = await requireBootedEmulator()
  await reverseMetroPort(config, serial)
  await openExpoGoOnSerial(serial, url)
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
