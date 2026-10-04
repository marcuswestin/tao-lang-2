import { CLI, Errors, FS, Platform } from '@shared'
import { DevLoopOutput } from '../DevLoopOutput'
import { type FixedIosLaunchOperations, runFixedIosLaunchCommand } from '../expo-runner/fixedIosLaunchCommand'
import { CompanionIdentity } from './CompanionIdentity'
import type { HostSearch, PrebuiltHost } from './PrebuiltHosts'

/*
 * The iOS Simulator counterpart of the Android emulator's Companion path: a simulator opens Tao apps
 * in a prebuilt Companion when a compatible one is at hand, and in Expo Go otherwise. A simulator's
 * installed apps live on the Mac's own disk, so whether the installed Companion is the host's build
 * is answered by hashing both main executables rather than by a version string that a rebuild from
 * changed native code would leave untouched.
 */

/** SimulatorCompanionDependencies are the seams a test replaces: host lookup and `simctl`. */
export type SimulatorCompanionDependencies = {
  findPrebuiltHost: () => Promise<HostSearch>
  install?: (udid: string, host: PrebuiltHost) => Promise<void>
  installedMatches?: (udid: string, host: PrebuiltHost) => Promise<boolean>
  shouldStop?: () => boolean
  launchOperations?: FixedIosLaunchOperations
}

/**
 * prepareSimulatorCompanion installs a compatible prebuilt Companion on the simulator unless the
 * same build is already there, and answers whether the app should open in it. Every host it passed
 * over is named, as on Android.
 */
export async function prepareSimulatorCompanion(
  udid: string,
  simulatorName: string,
  dependencies: SimulatorCompanionDependencies,
): Promise<boolean> {
  const shouldStop = dependencies.shouldStop ?? (() => false)
  const checkStop = () => {
    if (shouldStop()) {
      throw Errors.abortError('iOS Companion preparation cancelled.')
    }
  }
  checkStop()
  const search = await dependencies.findPrebuiltHost()
  checkStop()
  for (const reason of search.refused) {
    DevLoopOutput.logDevLoop('dev', `Passed over the prebuilt host at ${reason}.`, 'warn')
  }
  const host = search.host
  if (host === undefined) {
    return false
  }
  const described = `${CompanionIdentity.name} ${host.manifest.hostVersion}`
  const matches = await (dependencies.installedMatches ?? installedCompanionMatches)(udid, host)
  checkStop()
  if (matches) {
    DevLoopOutput.logDevLoop('dev', `${described} is already installed on ${simulatorName}.`)
    return true
  }
  DevLoopOutput.logDevLoop('dev', `Installing ${described} on ${simulatorName} from ${FS.displayPath(host.directory)}.`)
  if (dependencies.install !== undefined) {
    await dependencies.install(udid, host)
  } else {
    await installCompanion(udid, host, shouldStop, dependencies.launchOperations)
  }
  checkStop()
  return true
}

async function installedCompanionMatches(udid: string, host: PrebuiltHost): Promise<boolean> {
  const container = await CLI.run('xcrun', {
    args: ['simctl', 'get_app_container', udid, CompanionIdentity.bundleIdentifier, 'app'],
  })
  const installedApp = container.stdout.trim()
  if (container.error !== undefined || container.exitCode !== 0 || installedApp === '') {
    return false
  }
  const executable = await appExecutable(host.binaryPath)
  const installed = FS.resolvePath(executable, installedApp)
  if (!await FS.isFile(installed)) {
    return false
  }
  return Platform.sha256Hex(await FS.readFile(installed))
    === Platform.sha256Hex(await FS.readFile(FS.resolvePath(executable, host.binaryPath)))
}

/** appExecutable reads the executable's name out of an app bundle's Info.plist. */
async function appExecutable(appPath: string): Promise<string> {
  const result = await CLI.run('plutil', {
    args: ['-extract', 'CFBundleExecutable', 'raw', FS.resolvePath('Info.plist', appPath)],
  })
  const name = result.stdout.trim()
  if (result.error !== undefined || result.exitCode !== 0 || name === '') {
    Errors.throwHostEnvironment(`The prebuilt host at ${FS.displayPath(appPath)} has no readable CFBundleExecutable.`)
  }
  return name
}

async function installCompanion(
  udid: string,
  host: PrebuiltHost,
  shouldStop: () => boolean,
  operations?: FixedIosLaunchOperations,
): Promise<void> {
  const result = await runFixedIosLaunchCommand(
    {
      stage: 'install',
      udid,
      appPath: host.binaryPath,
      artifactRoot: host.directory,
    },
    shouldStop,
    operations,
  )
  if (result.error !== undefined || result.exitCode !== 0 || result.signal !== null) {
    Errors.throwHostEnvironment(
      `Could not install ${CompanionIdentity.name}: ${
        result.stderr.trim() || result.error?.message || result.signal || result.exitCode
      }`,
    )
  }
}
