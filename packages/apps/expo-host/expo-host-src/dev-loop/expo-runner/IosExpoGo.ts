import { CLI, Errors, FS } from '@shared'
import { RuntimeToolchainPaths } from '../../runtime-toolchain-paths'
import { DevLoopOutput } from '../DevLoopOutput'
import { EXPO_SDK_VERSION, expoSdkMajor, type ExpoSessionConfig } from './expo-config'
import { type FixedIosLaunchOperations, runFixedIosLaunchCommand } from './fixedIosLaunchCommand'

const bundleId = 'host.exp.Exponent'

type ExpoGoDownloader = {
  getExpoGoVersionEntryAsync: (sdk: string) => Promise<{ iosClientUrl: string; iosClientVersion: string }>
  downloadAppAsync: (options: { url: string; outputPath: string; extract: true }) => Promise<void>
}

export type SimulatorExpoGoDependencies = {
  loadDownloader?: () => Promise<ExpoGoDownloader>
  run?: typeof CLI.run
}

/** Prepare the SDK-matched simulator client before opening its Metro URL. */
export async function prepareSimulatorExpoGo(
  udid: string,
  simulatorName: string,
  config: ExpoSessionConfig,
  shouldStop: () => boolean,
  launchOperations?: FixedIosLaunchOperations,
  dependencies: SimulatorExpoGoDependencies = {},
): Promise<void> {
  const checkStop = () => {
    if (shouldStop()) {
      throw Errors.abortError('iOS runtime preparation cancelled.')
    }
  }
  const run = dependencies.run ?? CLI.run
  checkStop()
  const container = await run('xcrun', { args: ['simctl', 'get_app_container', udid, bundleId, 'app'] })
  checkStop()
  const installed = container.exitCode === 0 && container.error === undefined && container.stdout.trim()
    ? await appField(container.stdout.trim(), 'CFBundleShortVersionString', run)
    : undefined
  checkStop()
  DevLoopOutput.logDevLoop('dev', `Checking iOS runtime for Expo SDK ${expoSdkMajor()} on ${simulatorName}.`)
  const downloader = await (dependencies.loadDownloader ?? loadExpoGoDownloader)()
  checkStop()
  const metadata = await downloader.getExpoGoVersionEntryAsync(EXPO_SDK_VERSION)
  checkStop()
  const url = new URL(metadata.iosClientUrl)
  if (
    url.protocol !== 'https:' || url.username || url.password
    || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/u.test(metadata.iosClientVersion)
  ) {
    Errors.throwHostEnvironment(`Expo has no compatible iOS runtime for SDK ${expoSdkMajor()}.`)
  }
  // Expo Go's client version is publisher metadata, not the SDK generation number.
  if (installed === metadata.iosClientVersion) {
    return
  }
  const artifactRoot = FS.resolvePath('ios-simulator-app-cache', config.EXPO_START_ENV.__UNSAFE_EXPO_HOME_DIRECTORY)
  const appPath = FS.resolvePath(`Expo-Go-${metadata.iosClientVersion}.app`, artifactRoot)
  const matches = async () =>
    await appField(appPath, 'CFBundleIdentifier', run) === bundleId
    && await appField(appPath, 'CFBundleShortVersionString', run) === metadata.iosClientVersion
  if (!await matches()) {
    checkStop()
    DevLoopOutput.logDevLoop('dev', `Downloading iOS runtime for Expo SDK ${expoSdkMajor()}.`)
    // Expo owns archive extraction; the explicit project cache and our reporter avoid its global
    // installer prompts/spinners. No second Metro server or simulator selection is involved.
    await downloader.downloadAppAsync({ url: url.href, outputPath: appPath, extract: true })
    checkStop()
    if (!await matches()) {
      Errors.throwHostEnvironment('The downloaded iOS runtime does not match its Expo SDK metadata.')
    }
  }
  checkStop()
  DevLoopOutput.logDevLoop('dev', `Installing iOS runtime on ${simulatorName}.`)
  const result = await runFixedIosLaunchCommand(
    { stage: 'install', udid, appPath, artifactRoot },
    shouldStop,
    launchOperations,
  )
  checkStop()
  if (result.error !== undefined || result.exitCode !== 0 || result.signal !== null) {
    Errors.throwHostEnvironment(
      `Could not install the iOS runtime on ${simulatorName}: ${
        result.stderr.trim() || result.error?.message || result.signal || result.exitCode
      }`,
    )
  }
}

async function appField(appPath: string, field: string, run: typeof CLI.run): Promise<string | undefined> {
  const result = await run('plutil', { args: ['-extract', field, 'raw', FS.resolvePath('Info.plist', appPath)] })
  return result.exitCode === 0 && result.error === undefined ? result.stdout.trim() || undefined : undefined
}

async function loadExpoGoDownloader(): Promise<ExpoGoDownloader> {
  const root = RuntimeToolchainPaths.hostInstallRoot ?? RuntimeToolchainPaths.packageRoot
  const expo = await FS.resolvePackageDirectory('expo', root)
  const cli = expo === undefined ? undefined : await FS.resolvePackageDirectory('@expo/cli', expo)
  if (cli === undefined) {
    Errors.throwHostEnvironment('The installed Expo toolchain is required to prepare the iOS runtime.')
  }
  const utils = FS.resolvePath('build/src/utils', cli)
  const metadata = await import(FS.fileUrl(FS.resolvePath('downloadExpoGoAsync.js', utils))) as ExpoGoDownloader
  const download = await import(FS.fileUrl(FS.resolvePath('downloadAppAsync.js', utils))) as ExpoGoDownloader
  return {
    getExpoGoVersionEntryAsync: metadata.getExpoGoVersionEntryAsync,
    downloadAppAsync: download.downloadAppAsync,
  }
}
