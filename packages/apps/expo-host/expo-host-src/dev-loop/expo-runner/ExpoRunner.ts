import { CLI, Errors, Repo } from '@shared'
import { DevLoopOutput } from '../DevLoopOutput'
import { createAndroid } from './android'
import {
  createExpoConfig,
  ExpoConfig,
  type ExpoConfigOptions,
  type ExpoSessionConfig,
  PREFERRED_EXPO_PORT,
} from './expo-config'
import { ExpoServer } from './expo-server'
import { createExpoMetro } from './metro'
import { Ports } from './Ports'
import { createExpoTargets } from './run-targets'

type ExpoServerProcess = {
  onUnexpectedExit: (listener: (message: string) => void) => void
  start: () => Promise<void>
  stop: () => Promise<void>
}

export type ExpoServerOptions = {
  command?: {
    argsPrefix?: readonly string[]
    executable: string
  }
  /** Extra environment for the Expo CLI process, such as the dev data facts `app.config.js` reads. */
  env?: Readonly<Record<string, string>>
  logRoot?: string
  runtimeToolchainSourceRoot?: string
  stopTimeoutMs?: number
}

export type ExpoRunnerSession = ReturnType<typeof createSessionFromConfig>

/** createSession binds every Expo runner operation to one explicitly selected port. */
function createSession(port: number = PREFERRED_EXPO_PORT): ExpoRunnerSession {
  return createSessionFromConfig(createExpoConfig(port))
}

/** createSessionWithAvailablePort prefers 8081 and otherwise allocates an OS-selected free port. */
async function createSessionWithAvailablePort(
  preferredPort: number = PREFERRED_EXPO_PORT,
  options: ExpoConfigOptions = {},
): Promise<ExpoRunnerSession> {
  const reservation = await Ports.reserveAvailable(preferredPort)
  return createSessionFromConfig(createExpoConfig(reservation.port, options), reservation.release)
}

function createSessionFromConfig(
  config: ExpoSessionConfig,
  releasePortReservation: () => Promise<void> = async () => {},
) {
  const metro = createExpoMetro(config)
  const android = createAndroid(config, metro)
  const targets = createExpoTargets(config, metro, android)
  return {
    config,
    createServer: (runtimeRoot: string, options?: ExpoServerOptions) =>
      createServer(runtimeRoot, config, releasePortReservation, options),
    ensureMetroPortFree: metro.ensureMetroPortFree,
    ensureAndroidEmulator: android.ensureEmulator,
    ensureAndroidExpoGo: android.ensureExpoGo,
    openAndroid: targets.openAndroid,
    openIosSimulator: targets.openIosSimulator,
    openPhysicalDevice: targets.openPhysicalDevice,
    openStartupTargets: targets.openStartupTargets,
    openWeb: targets.openWeb,
    reloadExpoApps: metro.reloadExpoApps,
    releasePortReservation,
    startExpo: () => startExpo(config, targets.openPreparedAndroid),
    waitForMetro: metro.waitForMetro,
  }
}

const defaultSession = createSessionFromConfig(ExpoConfig)

/** ExpoRunner is the public Expo runner facade; direct methods retain the fixed default session. */
export const ExpoRunner = {
  ...defaultSession,
  createSession,
  createSessionWithAvailablePort,
  portDiagnostics: {
    findAvailable: Ports.findAvailable,
    formatKillCommand: Ports.formatKillCommand,
    formatListeners: Ports.formatListeners,
    formatLsofListeners: Ports.formatLsofListeners,
    normalizeReservationError: Ports.normalizeReservationError,
    selectAvailable: Ports.selectAvailable,
  },
}

/** createServer creates an owned Expo CLI server process wrapper. */
function createServer(
  runtimeRoot: string,
  config: ExpoSessionConfig,
  releasePortReservation: () => Promise<void>,
  options: ExpoServerOptions = {},
): ExpoServerProcess {
  return new ExpoServer(runtimeRoot, config, releasePortReservation, options)
}

/** startExpo starts the Expo runtime and opens it on Android once Metro is ready. */
async function startExpo(
  config: ExpoSessionConfig,
  openPreparedAndroid: (url?: string) => Promise<void>,
): Promise<void> {
  const runtimeToolchainRoot = Repo.resolvePath(config.RUNTIME_TOOLCHAIN_PATH)
  void openPreparedAndroid().catch(error => DevLoopOutput.logDevLoop('dev', Errors.formatForUser(error), 'error'))
  const result = await CLI.run('bunx', {
    args: config.EXPO_START_ARGS,
    cwd: runtimeToolchainRoot,
    env: config.EXPO_START_ENV,
    onOutput: DevLoopOutput.devLoopOutputHandler('expo'),
  })
  if (result.error || result.exitCode !== 0) {
    throw new Errors.CommandExecutionError(result)
  }
}
