import Runtime from '@runtime'
import { Errors, FS, HCI, Platform, Repo } from '@shared'
import type { Readable, Writable } from 'node:stream'
import { DevFileWatcher } from './DevFileWatcher'
import { ExpoRunner } from './expo-runner/ExpoRunner'
import { handleCommandKey } from './keyboard-input/CommandKeys'
import Commands from './keyboard-input/Commands'
import { RawKeyInput } from './keyboard-input/RawKeyInput'
import Run from './Run'
import { TUI } from './TUI'

const DEFAULT_APP_PATH = 'Apps/WordFlower/1 - Current/WordFlower.tao'
const RUNTIME_PACKAGE_PATH = 'packages/runtime'

/** runDevLoop runs the interactive Tao dev loop and returns its process exit code. */
export async function runDevLoop(appPathInput?: string, appNameInput?: string): Promise<number> {
  const repoRoot = Repo.getRoot()
  const appPath = await resolveDevAppPath(appPathInput)
  const appName = await resolveDevAppName(appPath, appNameInput)
  const runtimeRoot = Repo.resolvePath(RUNTIME_PACKAGE_PATH)
  const expoServer = ExpoRunner.createServer(runtimeRoot)
  const output = TUI.startDevLoopOutput()
  let keyInput: RawKeyInput | undefined
  let watcher: DevFileWatcher | undefined
  let finished = false
  let cleanupStarted = false
  let exitLoop!: (exitCode: number) => void

  const done = new Promise<number>(resolve => {
    exitLoop = resolve
  })
  const shouldStop = () => finished

  const finish = async (exitCode: number) => {
    if (finished) {
      return
    }
    finished = true
    await cleanup()
    exitLoop(exitCode)
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
      finish,
      keyInput: keyInput!,
      repoRoot,
      stopServices,
    })
  })

  const requestFinish = (exitCode: number) => {
    if (finished) {
      Platform.runtimeProcess.exit(exitCode)
    }
    void finish(exitCode)
  }

  expoServer.onUnexpectedExit(() => {
    void finish(1)
  })

  const removeSigint = Platform.onProcessSignal('SIGINT', () => {
    requestFinish(130)
  })
  const removeSigterm = Platform.onProcessSignal('SIGTERM', () => {
    requestFinish(143)
  })

  try {
    TUI.logDevLoop('dev', `Tao dev app: ${appPath}`)
    const initialCompileSucceeded = await Run.compileApp(repoRoot, appPath, appName, 'initial compile', true)
    if (shouldStop()) {
      return await done
    }
    if (!initialCompileSucceeded) {
      return 1
    }
    watcher = new DevFileWatcher(appPath, shouldRunParserGen => {
      void Run.compileApp(repoRoot, appPath, appName, 'file change', shouldRunParserGen)
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
    Commands.printControls()
    if (!keyInput.start()) {
      TUI.logDevLoop('dev', 'No interactive TTY found; dev loop is running until the process is stopped.')
    }
    void ExpoRunner.openStartupTargets(shouldStop)
    return await done
  } finally {
    removeSigint()
    removeSigterm()
    await cleanup()
    await output?.stop()
  }
}

/** DevAppSelectionOptions supplies terminal state for app selection and its focused tests. */
export type DevAppSelectionOptions = {
  input?: Readable
  interactive?: boolean
  output?: Writable
}

/** resolveDevAppName selects one app explicitly or asks without ever guessing among several apps. */
export async function resolveDevAppName(
  appPath: string,
  requested: string | undefined,
  options: DevAppSelectionOptions = {},
): Promise<string | undefined> {
  const appNames = await Runtime.appNames(appPath)
  if (requested || appNames.length <= 1) {
    return requested ?? appNames[0]
  }
  if (!HCI.isInteractive(options)) {
    throw new Errors.UserInputError(
      `Multiple apps are declared in ${appPath}: ${appNames.join(', ')}. Select one with --app ${appNames[0]}.`,
    )
  }
  return await HCI.askChoice({
    ...options,
    message: 'Choose the Tao app to run',
    choices: appNames.map(value => ({ value })),
  })
}

async function resolveDevAppPath(appPath: string | undefined): Promise<string> {
  const resolvedPath = appPath === undefined || appPath.trim() === ''
    ? Repo.resolvePath(DEFAULT_APP_PATH)
    : FS.resolvePath(appPath)

  if (!await FS.isFile(resolvedPath)) {
    throw new Errors.UserInputError(`Dev app does not exist: ${resolvedPath}`)
  }

  return resolvedPath
}
