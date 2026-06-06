import { Errors, FS, HCI, Platform, Repo } from '@shared'
import { handleCommandKey } from './CommandKeys'
import Commands from './Commands'
import { DevFileWatcher } from './DevFileWatcher'
import { Expo, ExpoServer } from './Expo'
import { RawKeyInput } from './RawKeyInput'
import Run from './Run'

const DEFAULT_APP_PATH = 'Apps/Kitchen Sink/Kitchen Sink.tao'
const RUNTIME_PACKAGE_PATH = 'packages/runtime'

/** runDevLoop runs the interactive Tao dev loop and returns its process exit code. */
export async function runDevLoop(appPathInput?: string): Promise<number> {
  const repoRoot = Repo.getRoot()
  const appPath = await resolveDevAppPath(appPathInput)
  const runtimeRoot = FS.repoPath(RUNTIME_PACKAGE_PATH)
  const expoServer = new ExpoServer(runtimeRoot)
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
      finish,
      keyInput: keyInput!,
      stopServices,
    })
  })

  const requestFinish = (exitCode: number) => {
    if (finished) {
      Platform.runtimeProcess.exit(exitCode)
      return
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
    HCI.logProcessInfo('dev', `Tao dev app: ${appPath}`)
    const initialCompileOk = await Run.compileApp(repoRoot, appPath, 'initial compile', true)
    if (shouldStop()) {
      return await done
    }
    if (!initialCompileOk) {
      return 1
    }
    watcher = new DevFileWatcher(appPath, shouldRunParserGen => {
      void Run.compileApp(repoRoot, appPath, 'file change', shouldRunParserGen)
    })
    await Expo.ensureMetroPortFree()
    if (shouldStop()) {
      return await done
    }
    await expoServer.start()
    if (shouldStop()) {
      return await done
    }
    if (!await Expo.waitForMetro(shouldStop)) {
      return await done
    }
    if (shouldStop()) {
      return await done
    }
    Commands.printControls()
    if (!keyInput.start()) {
      HCI.logProcessInfo('dev', 'No interactive TTY found; dev loop is running until the process is stopped.')
    }
    void Expo.openStartupTargets(shouldStop)
    return await done
  } finally {
    removeSigint()
    removeSigterm()
    await cleanup()
  }
}

async function resolveDevAppPath(appPath: string | undefined): Promise<string> {
  const resolvedPath = appPath === undefined || appPath.trim() === ''
    ? FS.repoPath(DEFAULT_APP_PATH)
    : FS.resolvePath(appPath)

  if (!await FS.isFile(resolvedPath)) {
    throw new Errors.UserInputError(`Dev app does not exist: ${resolvedPath}`)
  }

  return resolvedPath
}
