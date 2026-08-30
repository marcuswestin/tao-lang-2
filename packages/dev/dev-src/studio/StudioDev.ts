/// <reference path="../expo-dev-loop/expo-runner/better-opn.d.ts" />

import { Errors, HCI, Platform, Repo } from '@shared'
import {
  openStudioPreviewSession,
  resolveStudioProjectRoot,
  type StartedStudioFileWatcher,
  type StartedStudioServer,
  startStudioFileWatcher,
  startStudioServer,
  type StudioPreviewSession,
} from '@studio'
import betterOpen from 'better-opn'
import { ExpoRunner, type ExpoRunnerSession } from '../expo-dev-loop/expo-runner/ExpoRunner'
import { StudioNative } from './StudioNative'
import type { StartedStudioNative } from './StudioNative'
import { type CreatedStudioPreviewRuntime, StudioPreviewRuntime } from './StudioPreviewRuntime'

export type StudioDevOptions = {
  appName?: string
  browser?: boolean
  entryPath?: string
  hostname?: string
  native?: boolean
  nativeArtifactRoot?: string
  nativeElectronPath?: string
  nativeRemoteDebuggingPort?: number
  port?: number
  projectRoot: string
}

/** StudioDev exposes narrow lifecycle seams for focused developer-tool tests. */
export const StudioDev = {
  testing: {
    cleanup: cleanupStudioDev,
  },
}

/** runStudioDev owns the local Studio server, file watcher, preview compiler, and Expo process. */
export async function runStudioDev(options: StudioDevOptions): Promise<number> {
  let finish: ((exitCode: number) => void) | undefined
  const finished = new Promise<number>(resolve => {
    finish = resolve
  })
  let requestedStop = false
  const stop = (exitCode: number) => {
    if (!requestedStop) {
      requestedStop = true
      finish?.(exitCode)
    }
  }
  const removeSigint = Platform.onProcessSignal('SIGINT', () => stop(130))
  const removeSigterm = Platform.onProcessSignal('SIGTERM', () => stop(143))
  let expo: ExpoRunnerSession | undefined
  let expoServer: ReturnType<typeof ExpoRunner.createServer> | undefined
  let previewRuntime: CreatedStudioPreviewRuntime | undefined
  let preview: StudioPreviewSession | undefined
  let native: StartedStudioNative | undefined
  let watcher: StartedStudioFileWatcher | undefined
  let server: StartedStudioServer | undefined

  try {
    const project = await resolveStudioProjectRoot(options.projectRoot)
    HCI.logProcessInfo('studio', `Project: ${project.projectRoot}`)
    expo = await ExpoRunner.createSessionWithAvailablePort()
    const previewRuntimeSourceRoot = Repo.resolvePath(expo.config.RUNTIME_TOOLCHAIN_PATH)
    previewRuntime = await StudioPreviewRuntime.create(previewRuntimeSourceRoot)
    expoServer = expo.createServer(previewRuntime.root)
    expoServer.onUnexpectedExit(() => stop(1))
    preview = await openStudioPreviewSession({
      appName: options.appName,
      entryPath: options.entryPath,
      previewRuntimeRoot: previewRuntime.root,
      projectRoot: project.projectRoot,
    })
    watcher = await startStudioFileWatcher(preview.session)
    server = await startStudioServer(preview.session, {
      allowedOrigins: [expo.config.EXPO_ORIGIN],
      hostname: options.hostname,
      port: options.port,
      previewUrl: expo.config.EXPO_ORIGIN,
    })
    await expoServer.start()
    await expo.waitForMetro(() => requestedStop)
    HCI.logProcessInfo('studio', `Studio: ${server.url}`)
    HCI.logProcessInfo('studio', `Preview: ${expo.config.EXPO_ORIGIN}`)
    if (options.native && !requestedStop) {
      native = await StudioNative.start({
        artifactRoot: options.nativeArtifactRoot,
        electronPath: options.nativeElectronPath,
        remoteDebuggingPort: options.nativeRemoteDebuggingPort,
        studioUrl: server.url,
      })
      void native.waitForClose().then(exitCode => stop(exitCode))
    } else if (options.browser !== false && !requestedStop) {
      await betterOpen(server.url)
    }
    if (!requestedStop) {
      HCI.logProcessInfo('studio', 'Press Ctrl+C to stop Tao Studio.')
    }
    return await finished
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    HCI.logProcessError('studio', Errors.formatForLog(error))
    return 1
  } finally {
    removeSigint()
    removeSigterm()
    await cleanupStudioDev([
      () => native?.stop(),
      () => watcher?.close(),
      () => server?.stop(),
      () => expoServer?.stop(),
      () => preview?.close(),
      () => expo?.releasePortReservation(),
      () => previewRuntime?.close(),
    ])
  }
}

async function cleanupStudioDev(cleanups: ReadonlyArray<() => unknown | Promise<unknown>>): Promise<void> {
  let firstError: unknown
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== undefined) {
    throw firstError
  }
}
