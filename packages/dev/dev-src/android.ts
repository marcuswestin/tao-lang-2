import { CLI, Errors, FS, HCI, Platform, Text } from '@shared'

const RUNTIME_PACKAGE_PATH = FS.joinPath('packages/runtime')
const EXPO_ANDROID_ENV = {
  EXPO_NO_TELEMETRY: '1',
  OPEN_MATCH_HOST_ONLY: 'true',
}
const EXPO_START_ARGS = ['expo', 'start', '--localhost']
const EXPO_GO_APP_ID = 'host.exp.exponent'
const EXPO_GO_METRO_PORT = 8081
const EXPO_GO_SDK_VERSION = '54.0.0'
const EXPO_GO_URL = `exp://127.0.0.1:${EXPO_GO_METRO_PORT}`
const EXPO_METRO_STATUS_URL = `http://127.0.0.1:${EXPO_GO_METRO_PORT}/status`
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
const METRO_START_TIMEOUT_MS = 60_000
const METRO_START_POLL_MS = 1_000

/** ensureAndroidEmulator ensures an Android emulator exists and is booted. */
export async function ensureAndroidEmulator(): Promise<void> {
  await requireCommand(
    'emulator',
    'Android emulator CLI not found. Run direnv allow so devenv can expose the Android SDK.',
  )
  await requireCommand(
    'avdmanager',
    'Android avdmanager CLI not found. Run direnv allow so devenv can expose the Android SDK.',
  )
  await requireCommand('adb', 'Android adb CLI not found. Run direnv allow so devenv can expose the Android SDK.')

  let avds = await listAvds()
  if (avds.length === 0) {
    await requireCommand(
      'sdkmanager',
      'Android sdkmanager CLI not found. Run direnv allow so devenv can expose the Android SDK.',
    )
    await requireAndroidSdkPackage(ANDROID_SYSTEM_IMAGE)
    HCI.writeLine(`No Android emulator found; creating ${ANDROID_AVD_NAME}.`)
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
  const logPath = FS.resolvePath('tao-android-emulator.log', { cwd: FS.tmpdir() })
  const runningSerial = await findRunningEmulator()
  if (runningSerial) {
    if (await isEmulatorBooted(runningSerial)) {
      HCI.writeLine(`Android emulator ${runningSerial} is already booted.`)
      return
    }
    HCI.writeLine(`Android emulator ${runningSerial} is starting.`)
    await waitForBootedEmulator(logPath)
  } else {
    await startEmulator(avdName, logPath)
    await waitForBootedEmulator(logPath)
  }
}

/** ensureAndroidExpoGo ensures Expo Go is installed on the booted Android emulator. */
export async function ensureAndroidExpoGo(): Promise<void> {
  await requireCommand('adb', 'Android adb CLI not found. Run direnv allow so devenv can expose the Android SDK.')
  const serial = await requireBootedEmulator()
  if (await isPackageInstalled(serial, EXPO_GO_APP_ID)) {
    HCI.writeLine(`Expo Go is already installed on ${serial}.`)
    return
  }

  const apkPath = await downloadExpoGoApk()
  HCI.writeLine(`Installing Expo Go on ${serial}.`)
  await CLI.mustRun('adb', {
    args: ['-s', serial, 'install', '-r', '-d', '--user', EXPO_ADB_USER, apkPath],
    stdio: 'inherit',
  })
}

/** prepareAvailableAndroidExpoGo prepares an already-booted emulator with Expo Go for Metro. */
export async function prepareAvailableAndroidExpoGo(): Promise<boolean> {
  await requireCommand('adb', 'Android adb CLI not found. Run direnv allow so devenv can expose the Android SDK.')
  const serial = await findRunningEmulator()
  if (!serial || !await isEmulatorBooted(serial)) {
    HCI.logProcessInfo('dev', 'No booted Android emulator found; skipping Android launch.')
    return false
  }
  if (!await isPackageInstalled(serial, EXPO_GO_APP_ID)) {
    HCI.logProcessInfo(
      'dev',
      `Expo Go is not installed on ${serial}; run ./dev android-expo-go before opening Android.`,
    )
    return false
  }
  await reverseMetroPort(serial)
  return true
}

/** openExpoAndroid opens an Expo URL directly on the booted Android emulator. */
export async function openExpoAndroid(url = EXPO_GO_URL): Promise<void> {
  await openExpoGoWhenMetroIsReady(url)
}

/** startExpoAndroid starts Expo and opens it on the booted Android emulator. */
export async function startExpoAndroid(): Promise<void> {
  const runtimePackageRoot = FS.repoPath(RUNTIME_PACKAGE_PATH)
  void openExpoAndroid().catch(error => HCI.writeErrorLine(Errors.formatForUser(error)))
  const result = await CLI.run('bunx', {
    args: EXPO_START_ARGS,
    cwd: runtimePackageRoot,
    env: EXPO_ANDROID_ENV,
    stdio: 'stream',
  })
  if (result.error || result.exitCode !== 0) {
    throw new Errors.CommandExecutionError(result)
  }
}

async function requireCommand(command: string, missingMessage: string): Promise<void> {
  try {
    await CLI.mustRun('sh', { args: ['-c', `command -v ${command}`] })
  } catch (error) {
    if (!(error instanceof Errors.CommandExecutionError)) {
      throw error
    }
    Errors.throwUserInput(missingMessage)
  }
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
  const configPath = FS.resolvePath(`${avdName}.avd/config.ini`, { cwd: androidAvdHome() })
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

function androidAvdHome(): string {
  const androidUserHome = Platform.runtimeProcess.env['ANDROID_USER_HOME']
    ?? FS.resolvePath('.android', { cwd: FS.homeDir() })
  return Platform.runtimeProcess.env['ANDROID_AVD_HOME'] ?? FS.resolvePath('avd', { cwd: androidUserHome })
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

async function findRunningEmulator(): Promise<string | undefined> {
  const result = await CLI.mustRun('adb', { args: ['devices'] })
  return result.stdout
    .split(/\r?\n/)
    .map(line => line.trim().split(/\s+/))
    .find(([serial, state]) => serial?.startsWith('emulator-') && state === 'device')
    ?.[0]
}

async function isEmulatorBooted(serial: string): Promise<boolean> {
  const result = await CLI.run('adb', { args: ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'] })
  return !result.error && result.exitCode === 0 && result.stdout.trim() === '1'
}

async function startEmulator(avdName: string, logPath: string): Promise<void> {
  HCI.writeLine(`Starting Android emulator ${avdName}.`)
  const logFile = await FS.openAppend(logPath)
  try {
    const emulator = CLI.start('emulator', {
      args: ['-avd', avdName, '-memory', String(ANDROID_EMULATOR_MEMORY_MB), '-netdelay', 'none', '-netspeed', 'full'],
      detached: true,
      stdio: ['ignore', logFile.fd, logFile.fd],
      unref: true,
    })
    emulator.onceError(error => HCI.writeErrorLine(`Failed to start Android emulator: ${error.message}`))
  } finally {
    await logFile.close()
  }
}

async function waitForBootedEmulator(logPath: string): Promise<void> {
  const deadline = Date.now() + EMULATOR_BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const serial = await findRunningEmulator()
    if (serial && await isEmulatorBooted(serial)) {
      HCI.writeLine(`Android emulator ${serial} is booted.`)
      return
    }
    await sleep(EMULATOR_BOOT_POLL_MS)
  }

  Errors.throwUserInput(`Android emulator did not finish booting. Check ${logPath}.`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
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

async function downloadExpoGoApk(): Promise<string> {
  const url = await getExpoGoApkUrl()
  const filename = FS.basename(new URL(url).pathname)
  const outputDir = FS.repoPath(EXPO_GO_APK_CACHE_DIR)
  const outputPath = FS.resolvePath(filename, { cwd: outputDir })
  if (await FS.exists(outputPath)) {
    return outputPath
  }

  await FS.mkdir(FS.dirname(outputPath))
  HCI.writeLine(`Downloading Expo Go for SDK ${EXPO_GO_SDK_VERSION}.`)
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

async function openExpoGoWhenMetroIsReady(url = EXPO_GO_URL): Promise<void> {
  await waitForMetro()
  const serial = await requireBootedEmulator()
  await reverseMetroPort(serial)
  HCI.writeLine(`Opening ${url} on ${serial}.`)
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

async function reverseMetroPort(serial: string): Promise<void> {
  await CLI.mustRun('adb', {
    args: ['-s', serial, 'reverse', `tcp:${EXPO_GO_METRO_PORT}`, `tcp:${EXPO_GO_METRO_PORT}`],
  })
}

async function waitForMetro(): Promise<void> {
  const deadline = Date.now() + METRO_START_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const response = await fetch(EXPO_METRO_STATUS_URL)
      if (response.ok && (await response.text()).includes('running')) {
        return
      }
    } catch {
      // Metro is still starting.
    }
    await sleep(METRO_START_POLL_MS)
  }

  Errors.throwUserInput(`Expo Metro did not start at ${EXPO_METRO_STATUS_URL}.`)
}
