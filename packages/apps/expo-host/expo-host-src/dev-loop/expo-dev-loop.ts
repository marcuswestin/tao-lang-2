import { Errors, FS, HCI, Platform, Repo } from '@shared'
import type { DevLoopActions, DevLoopControlHooks } from '@shared/DevLoopControl'
import { DesktopHost } from '../desktop-host'
import { RuntimeToolchainPaths } from '../runtime-toolchain-paths'
import { devDataAppKey, devDataEnvironment } from './dev-data/DevDataBootstrap'
import { DevDataServer } from './dev-data/DevDataServer'
import { DevFileWatcher } from './DevFileWatcher'
import { DevLoopOutput, type DevLoopReporter, lineDevLoopReporter, setDevLoopReporter } from './DevLoopOutput'
import { DevRuntime } from './DevRuntime'
import { PREFERRED_EXPO_PORT } from './expo-runner/expo-config'
import { ExpoRunner, type ExpoRunnerSession } from './expo-runner/ExpoRunner'
import type { DevStartupTarget } from './expo-runner/run-targets'
import { handleCommandKey } from './keyboard-input/CommandKeys'
import Commands from './keyboard-input/Commands'
import { CompanionIdentity } from './prebuilt-host/CompanionIdentity'
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
  stateRoot?: string,
): Promise<ExpoRunnerSession> {
  return await ExpoRunner.createSessionWithAvailablePort(preferredPort, { scheme: CompanionIdentity.scheme, stateRoot })
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
  startupTargets: readonly DevStartupTarget[] = [],
  device?: string,
  control?: DevLoopControlHooks,
): Promise<DevLoopOutcome> {
  const restoreDevLoopReporter = setDevLoopReporter(reporter)
  let activeActions: DevLoopActions | undefined
  let stopped = false
  let complete!: () => void
  const completion = new Promise<void>(resolve => {
    complete = resolve
  })
  const unbind = control?.bind({
    stop: async () => {
      stopped = true
      await activeActions?.stop()
      await completion
    },
    restart: async () => {
      if (activeActions === undefined) {
        Errors.throwUserInput('The dev loop is still starting.')
      }
      await activeActions.restart()
    },
    reload: async () => {
      if (activeActions === undefined) {
        Errors.throwUserInput('The dev loop is still starting.')
      }
      await activeActions.reload()
    },
  })
  const activeControl: DevLoopControlHooks | undefined = control === undefined ? undefined : {
    emit: control.emit,
    bind: actions => {
      activeActions = actions
      if (stopped) {
        void actions.stop()
      }
      return () => {
        activeActions = undefined
      }
    },
  }
  try {
    return await runDevLoopWithActiveReporter(selection, startupTargets, device, activeControl)
  } finally {
    unbind?.()
    complete()
    restoreDevLoopReporter()
  }
}

async function runDevLoopWithActiveReporter(
  selection: DevAppSelection,
  startupTargets: readonly DevStartupTarget[],
  device?: string,
  control?: DevLoopControlHooks,
): Promise<DevLoopOutcome> {
  await control?.emit({ type: 'starting' })
  const toolchainRepo = Repo.tryGetRoot(RuntimeToolchainPaths.packageRoot)
  const repoRoot = toolchainRepo ?? selection.projectRoot
  const repositoryControlsAvailable = toolchainRepo !== undefined
    && FS.pathIsWithin(selection.projectRoot, toolchainRepo)
  DevLoopOutput.showCheckoutControls(repositoryControlsAvailable)
  const { appName, appPath } = selection
  const stateRoot = FS.resolvePath('.tao/dev', selection.projectRoot)
  const runtime = await DevRuntime.prepare(selection.projectRoot)
  // The dev data server starts first: its port and the app's key go into Expo's environment, where
  // the checked-in `app.config.js` writes them into the manifest every development build reads.
  const devDataApp = devDataAppKey(selection.projectRoot, appName)
  const devData = await DevDataServer.start({
    log: line => DevLoopOutput.logDevLoop('data', line),
    rootDir: FS.resolvePath('data', stateRoot),
  })
  let expo: ExpoRunnerSession
  try {
    expo = await createDevLoopExpoSession(PREFERRED_EXPO_PORT, stateRoot)
  } catch (error) {
    await devData.stop().catch(() => {})
    throw error
  }
  // An installed Tao has no `bunx` and no Node, so it runs Expo under itself; a checkout keeps `bunx`.
  const installedLauncher = RuntimeToolchainPaths.installedExpoLauncher(runtime.root)
  const expoServer = expo.createServer(runtime.root, {
    command: installedLauncher,
    env: { ...installedLauncher?.env, ...devDataEnvironment(devData.port, devDataApp, devData.capability) },
    logRoot: FS.resolvePath('logs', stateRoot),
    runtimeToolchainSourceRoot: runtime.sourceRoot,
  })
  const output = DevLoopOutput.start()
  let keyInput: HCI.RawKeySession | undefined
  let watcher: DevFileWatcher | undefined
  let desktop: ReturnType<typeof DesktopHost.runDev> | undefined
  let finished = false
  let cleanupPromise: Promise<void> | undefined
  let finishPromise: Promise<void> | undefined
  let requestedOutcome: DevLoopOutcome | undefined
  let startupDispatch: Promise<readonly { target: DevStartupTarget; dispatched: boolean }[]> | undefined
  let exitLoop!: (outcome: DevLoopOutcome) => void

  const done = new Promise<DevLoopOutcome>(resolve => {
    exitLoop = resolve
  })
  const shouldStop = () => finished

  const finish = async (outcome: DevLoopOutcome) => {
    if (outcome.kind === 'exit') {
      requestedOutcome = outcome
    } else {
      requestedOutcome ??= outcome
    }
    finishPromise ??= (async () => {
      finished = true
      try {
        await cleanup()
        exitLoop(requestedOutcome!)
      } catch (error) {
        await control?.emit({ type: 'cleanup-failed', message: Errors.formatForUser(error) })
        exitLoop({ kind: 'exit', exitCode: 1 })
        throw error
      }
    })()
    return await finishPromise
  }

  const cleanup = async () => {
    cleanupPromise ??= (async () => {
      keyInput?.stop()
      keyInput = undefined
      await startupDispatch
      await stopServices()
    })()
    return await cleanupPromise
  }

  const stopServices = async () => {
    const closingWatcher = watcher
    watcher = undefined
    const desktopProcess = desktop
    desktop = undefined
    const results = await Promise.allSettled([
      closingWatcher?.close(),
      expo.stopWeb(),
      (async () => {
        if (desktopProcess !== undefined) {
          desktopProcess.kill('SIGTERM')
          await desktopProcess.waitForClose()
          await desktopProcess.closeOutput()
        }
      })(),
      expoServer.stop(),
      devData.stop(),
    ])
    const failures = results.flatMap(result =>
      result.status === 'rejected' ? [Errors.formatForUser(result.reason)] : []
    )
    if (failures.length > 0) {
      Errors.throwHostEnvironment(`Dev-loop cleanup failed: ${failures.join('; ')}`)
    }
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
  const unbindControl = control?.bind({
    stop: () => finish({ kind: 'exit', exitCode: 0 }),
    restart: () => finish({ kind: 'restart' }),
    reload: async () => {
      await expo.reloadExpoApps(shouldStop)
    },
  })

  try {
    if (shouldStop()) {
      return await done
    }
    DevLoopOutput.logDevLoop('dev', `Tao dev app: ${appPath}`)
    DevLoopOutput.logDevLoop('dev', `Expo Metro port: ${expo.config.EXPO_PORT}`)
    DevLoopOutput.logDevLoop('dev', `Dev data: tao-dev-data-v1 on port ${devData.port}, app ${devDataApp}`)
    // Key input starts before the first compile so q and Ctrl-C work during startup, not only
    // once Metro is ready.
    Commands.printControls()
    const openDesktop = async (): Promise<boolean> => {
      if (desktop !== undefined) {
        DevLoopOutput.logDevLoop('desktop', 'Desktop app is already open.')
        return true
      }
      try {
        const project = await DesktopHost.prepare({ appName, root: FS.resolvePath('desktop', stateRoot) })
        if (shouldStop()) {
          return false
        }
        const desktopProcess = DesktopHost.runDev(
          project,
          expo.config.EXPO_ORIGIN,
          DevLoopOutput.devLoopOutputHandler('desktop'),
        )
        desktop = desktopProcess
        desktopProcess.onceClose((exitCode, signal) => {
          if (!shouldStop() && exitCode !== 0) {
            DevLoopOutput.recordFailure('desktop', `Desktop host exited (${exitCode ?? signal ?? 'unknown'}).`)
          }
          if (desktop === desktopProcess) {
            desktop = undefined
          }
          void desktopProcess.closeOutput()
        })
        DevLoopOutput.logDevLoop('desktop', 'Opening Tao desktop app with live Metro updates.')
        return true
      } catch (error) {
        DevLoopOutput.recordFailure('desktop', Errors.formatForUser(error))
        return false
      }
    }
    keyInput = HCI.startRawKeys(key => {
      void handleCommandKey(key, {
        appPath,
        appName,
        expo,
        openDesktop,
        finish: exitCode => finish({ kind: 'exit', exitCode }),
        repoRoot,
        repositoryControlsAvailable,
        runtimeRoot: runtime.root,
        restart: () => finish({ kind: 'restart' }),
        selectApp: () => finish({ kind: 'select-app' }),
        shouldStop,
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
      shouldRunParserGen: false,
      runtimeRoot: runtime.root,
    })
    if (shouldStop()) {
      return await done
    }
    if (!initialCompileSucceeded) {
      return { kind: 'exit', exitCode: 1 }
    }
    watcher = new DevFileWatcher(selection.projectRoot, shouldRunParserGen => {
      void Run.compileApp({
        repoRoot,
        appPath,
        appName,
        reason: 'file change',
        shouldRunParserGen,
        runtimeRoot: runtime.root,
      })
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
    startupDispatch = expo.openStartupTargets(startupTargets.filter(target => target !== 'desktop'), shouldStop)
    const dispatch = await startupDispatch
    if (device !== undefined) {
      void expo.openPhysicalDevice(device, shouldStop).catch(error => {
        if (!shouldStop()) {
          DevLoopOutput.logDevLoop('dev', `Could not open device: ${Errors.formatForUser(error)}`, 'warn')
        }
      })
    }
    if (startupTargets.includes('desktop')) {
      void openDesktop()
    }
    if (!shouldStop() && control !== undefined) {
      const failed = dispatch.filter(result => !result.dispatched)
      if (failed.length > 0) {
        await control.emit({
          type: 'failed',
          message: `Could not dispatch targets: ${failed.map(result => result.target).join(', ')}.`,
        })
      } else {
        await control.emit({ type: 'ready', url: expo.config.EXPO_ORIGIN, targets: dispatch })
      }
    }
    return await done
  } catch (error) {
    DevLoopOutput.recordFailure('dev', Run.formatFailure(error))
    await control?.emit({ type: 'failed', message: Errors.formatForUser(error) })
    throw error
  } finally {
    removeSigint()
    removeSigterm()
    unbindControl?.()
    await cleanup()
    await output?.stop()
  }
}
