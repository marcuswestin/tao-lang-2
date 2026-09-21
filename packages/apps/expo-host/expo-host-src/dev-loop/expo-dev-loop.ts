import { Errors, HCI, Platform, Repo } from '@shared'
import { DEV_DATA_ROOT_PATH, devDataAppKey, devDataEnvironment } from './dev-data/DevDataBootstrap'
import { DevDataServer } from './dev-data/DevDataServer'
import { DevFileWatcher } from './DevFileWatcher'
import { DevLoopOutput, type DevLoopReporter, lineDevLoopReporter, setDevLoopReporter } from './DevLoopOutput'
import { PREFERRED_EXPO_PORT } from './expo-runner/expo-config'
import { ExpoRunner, type ExpoRunnerSession } from './expo-runner/ExpoRunner'
import { handleCommandKey } from './keyboard-input/CommandKeys'
import Commands from './keyboard-input/Commands'
import Run from './Run'

/** DevAppSelection identifies the exact app declaration selected by the Tao CLI. */
export type DevAppSelection = {
  appName: string
  appPath: string
  /** The project the app belongs to; with the app name it keys the app's dev data. */
  projectRoot: string
}

/** DevLoopOutcome tells the Tao CLI whether to exit, restart, or run app selection again. */
export type DevLoopOutcome =
  | { kind: 'exit'; exitCode: number }
  | { kind: 'restart' }
  | { kind: 'select-app' }

/** createDevLoopExpoSession reserves the preferred port or an OS-selected free alternative. */
export async function createDevLoopExpoSession(
  preferredPort: number = PREFERRED_EXPO_PORT,
): Promise<ExpoRunnerSession> {
  return await ExpoRunner.createSessionWithAvailablePort(preferredPort)
}

/**
 * runDevLoop runs one selected app until the Tao CLI should exit, restart, or select again.
 *
 * `reporter` is the output sink every dev-loop command reports lines, failures, and prompts
 * through; the caller that renders owns it. `tao dev` passes the Ink dashboard, so it is mounted
 * only while a loop is running. A caller that injects none gets the plain line-writer default.
 */
export async function runDevLoop(
  selection: DevAppSelection,
  reporter: DevLoopReporter = lineDevLoopReporter(),
): Promise<DevLoopOutcome> {
  const restoreDevLoopReporter = setDevLoopReporter(reporter)
  try {
    return await runDevLoopWithActiveReporter(selection)
  } finally {
    restoreDevLoopReporter()
  }
}

async function runDevLoopWithActiveReporter(selection: DevAppSelection): Promise<DevLoopOutcome> {
  const repoRoot = Repo.getRoot()
  const { appName, appPath } = selection
  // The dev data server starts first: its port and the app's key go into Expo's environment, where
  // the checked-in `app.config.js` writes them into the manifest every development build reads.
  const devDataApp = devDataAppKey(selection.projectRoot, appName)
  const devData = await DevDataServer.start({
    log: line => DevLoopOutput.logDevLoop('data', line),
    rootDir: Repo.resolvePath(DEV_DATA_ROOT_PATH),
  })
  let expo: ExpoRunnerSession
  try {
    expo = await createDevLoopExpoSession()
  } catch (error) {
    await devData.stop().catch(() => {})
    throw error
  }
  const runtimeToolchainRoot = Repo.resolvePath(expo.config.RUNTIME_TOOLCHAIN_PATH)
  const expoServer = expo.createServer(runtimeToolchainRoot, {
    env: devDataEnvironment(devData.port, devDataApp, devData.capability),
  })
  const output = DevLoopOutput.start()
  let keyInput: HCI.RawKeySession | undefined
  let watcher: DevFileWatcher | undefined
  let finished = false
  let cleanupStarted = false
  let exitLoop!: (outcome: DevLoopOutcome) => void

  const done = new Promise<DevLoopOutcome>(resolve => {
    exitLoop = resolve
  })
  const shouldStop = () => finished

  const finish = async (outcome: DevLoopOutcome) => {
    if (finished) {
      return
    }
    finished = true
    await cleanup()
    exitLoop(outcome)
  }

  const cleanup = async () => {
    if (cleanupStarted) {
      return
    }
    cleanupStarted = true
    keyInput?.stop()
    keyInput = undefined
    await stopServices()
  }

  const stopServices = async () => {
    await watcher?.close()
    watcher = undefined
    await expoServer.stop()
    await devData.stop().catch(error => {
      DevLoopOutput.logDevLoop('data', `Could not stop the dev data server: ${Errors.formatForLog(error)}`, 'warn')
    })
  }

  const requestFinish = (exitCode: number) => {
    if (finished) {
      Platform.runtimeProcess.exit(exitCode)
    }
    void finish({ kind: 'exit', exitCode })
  }

  expoServer.onUnexpectedExit(message => {
    DevLoopOutput.recordFailure('expo', message)
    void finish({ kind: 'exit', exitCode: 1 })
  })

  const removeSigint = Platform.onProcessSignal('SIGINT', () => {
    requestFinish(130)
  })
  const removeSigterm = Platform.onProcessSignal('SIGTERM', () => {
    requestFinish(143)
  })

  try {
    DevLoopOutput.logDevLoop('dev', `Tao dev app: ${appPath}`)
    DevLoopOutput.logDevLoop('dev', `Expo Metro port: ${expo.config.EXPO_PORT}`)
    DevLoopOutput.logDevLoop('dev', `Dev data: tao-dev-data-v1 on port ${devData.port}, app ${devDataApp}`)
    // Key input starts before the first compile so q and Ctrl-C work during startup, not only
    // once Metro is ready.
    Commands.printControls()
    keyInput = HCI.startRawKeys(key => {
      void handleCommandKey(key, {
        appPath,
        appName,
        expo,
        finish: exitCode => finish({ kind: 'exit', exitCode }),
        repoRoot,
        restart: () => finish({ kind: 'restart' }),
        selectApp: () => finish({ kind: 'select-app' }),
        stopServices,
      })
    })
    if (!keyInput.rawMode) {
      keyInput.stop()
      keyInput = undefined
      DevLoopOutput.logDevLoop('dev', 'No interactive TTY found; dev loop is running until the process is stopped.')
    }
    const initialCompileSucceeded = await Run.compileApp({
      repoRoot,
      appPath,
      appName,
      reason: 'initial compile',
      shouldRunParserGen: true,
    })
    if (shouldStop()) {
      return await done
    }
    if (!initialCompileSucceeded) {
      return { kind: 'exit', exitCode: 1 }
    }
    watcher = new DevFileWatcher(selection.projectRoot, shouldRunParserGen => {
      void Run.compileApp({ repoRoot, appPath, appName, reason: 'file change', shouldRunParserGen })
    })
    await expoServer.start()
    if (shouldStop()) {
      return await done
    }
    if (!await expo.waitForMetro(shouldStop)) {
      return await done
    }
    if (shouldStop()) {
      return await done
    }
    void expo.openStartupTargets(shouldStop)
    return await done
  } catch (error) {
    DevLoopOutput.recordFailure('dev', Run.formatFailure(error))
    throw error
  } finally {
    removeSigint()
    removeSigterm()
    await cleanup()
    await output?.stop()
  }
}
