import { Platform, Repo } from '@shared'
import { DevFileWatcher } from './DevFileWatcher'
import { DevLoopTUI } from './DevLoopTUI'
import { ExpoConfig } from './expo-runner/expo-config'
import { ExpoRunner } from './expo-runner/ExpoRunner'
import { handleCommandKey } from './keyboard-input/CommandKeys'
import Commands from './keyboard-input/Commands'
import { RawKeyInput } from './keyboard-input/RawKeyInput'
import Run from './Run'

/** DevAppSelection identifies the exact app declaration selected by the Tao CLI. */
export type DevAppSelection = {
  appName: string
  appPath: string
}

/** DevLoopOutcome tells the Tao CLI whether to exit, restart, or run app selection again. */
export type DevLoopOutcome =
  | { kind: 'exit'; exitCode: number }
  | { kind: 'restart' }
  | { kind: 'select-app' }

/** runDevLoop runs one selected app until the Tao CLI should exit, restart, or select again. */
export async function runDevLoop(selection: DevAppSelection): Promise<DevLoopOutcome> {
  const repoRoot = Repo.getRoot()
  const { appName, appPath } = selection
  const runtimeToolchainRoot = Repo.resolvePath(ExpoConfig.RUNTIME_TOOLCHAIN_PATH)
  const expoServer = ExpoRunner.createServer(runtimeToolchainRoot)
  const output = DevLoopTUI.startDevLoopOutput()
  let keyInput: RawKeyInput | undefined
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
    await stopServices()
  }

  const stopServices = async () => {
    await watcher?.close()
    watcher = undefined
    await expoServer.stop()
  }

  keyInput = new RawKeyInput(key => {
    void handleCommandKey(key, {
      appPath,
      appName,
      finish: exitCode => finish({ kind: 'exit', exitCode }),
      repoRoot,
      restart: () => finish({ kind: 'restart' }),
      selectApp: () => finish({ kind: 'select-app' }),
      stopServices,
    })
  })

  const requestFinish = (exitCode: number) => {
    if (finished) {
      Platform.runtimeProcess.exit(exitCode)
    }
    void finish({ kind: 'exit', exitCode })
  }

  expoServer.onUnexpectedExit(message => {
    DevLoopTUI.recordFailure('expo', message)
    void finish({ kind: 'exit', exitCode: 1 })
  })

  const removeSigint = Platform.onProcessSignal('SIGINT', () => {
    requestFinish(130)
  })
  const removeSigterm = Platform.onProcessSignal('SIGTERM', () => {
    requestFinish(143)
  })

  try {
    DevLoopTUI.logDevLoop('dev', `Tao dev app: ${appPath}`)
    // Key input starts before the first compile so q and Ctrl-C work during startup, not only
    // once Metro is ready.
    Commands.printControls()
    if (!keyInput.start()) {
      DevLoopTUI.logDevLoop('dev', 'No interactive TTY found; dev loop is running until the process is stopped.')
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
    watcher = new DevFileWatcher(appPath, shouldRunParserGen => {
      void Run.compileApp({ repoRoot, appPath, appName, reason: 'file change', shouldRunParserGen })
    })
    await ExpoRunner.ensureMetroPortFree()
    if (shouldStop()) {
      return await done
    }
    await expoServer.start()
    if (shouldStop()) {
      return await done
    }
    if (!await ExpoRunner.waitForMetro(shouldStop)) {
      return await done
    }
    if (shouldStop()) {
      return await done
    }
    void ExpoRunner.openStartupTargets(shouldStop)
    return await done
  } catch (error) {
    DevLoopTUI.recordFailure('dev', Run.formatFailure(error))
    throw error
  } finally {
    removeSigint()
    removeSigterm()
    await cleanup()
    await output?.stop()
  }
}
