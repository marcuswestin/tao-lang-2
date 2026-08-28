import { CLI, Errors, Repo } from '@shared'
import { DevLoopTUI } from '../DevLoopTUI'
import { Android } from './android'
import { ExpoConfig } from './expo-config'
import { ExpoServer } from './expo-server'
import { ExpoMetro } from './metro'
import { Ports } from './Ports'
import { ExpoTargets } from './run-targets'

type ExpoServerProcess = {
  onUnexpectedExit: (listener: (message: string) => void) => void
  start: () => Promise<void>
  stop: () => Promise<void>
}

/** ExpoRunner is the public Expo runner facade for dev-loop callers. */
export const ExpoRunner = {
  createServer,
  ensureMetroPortFree: ExpoMetro.ensureMetroPortFree,
  ensureAndroidEmulator: Android.ensureEmulator,
  ensureAndroidExpoGo: Android.ensureExpoGo,
  openAndroid: ExpoTargets.openAndroid,
  openIosSimulator: ExpoTargets.openIosSimulator,
  openStartupTargets: ExpoTargets.openStartupTargets,
  openWeb: ExpoTargets.openWeb,
  portDiagnostics: {
    formatKillCommand: Ports.formatKillCommand,
    formatListeners: Ports.formatListeners,
    formatLsofListeners: Ports.formatLsofListeners,
  },
  reloadExpoApps: ExpoMetro.reloadExpoApps,
  startExpo,
  waitForMetro: ExpoMetro.waitForMetro,
}

/** createServer creates an owned Expo CLI server process wrapper. */
function createServer(runtimeRoot: string): ExpoServerProcess {
  return new ExpoServer(runtimeRoot)
}

/** startExpo starts the Expo runtime and opens it on Android once Metro is ready. */
async function startExpo(): Promise<void> {
  const runtimeToolchainRoot = Repo.resolvePath(ExpoConfig.RUNTIME_TOOLCHAIN_PATH)
  void ExpoTargets.openPreparedAndroid().catch(error =>
    DevLoopTUI.logDevLoop('dev', Errors.formatForUser(error), 'error')
  )
  const result = await CLI.run('bunx', {
    args: ExpoConfig.EXPO_START_ARGS,
    cwd: runtimeToolchainRoot,
    env: ExpoConfig.EXPO_START_ENV,
    onOutput: DevLoopTUI.devLoopOutputHandler('expo'),
  })
  if (result.error || result.exitCode !== 0) {
    throw new Errors.CommandExecutionError(result)
  }
}
