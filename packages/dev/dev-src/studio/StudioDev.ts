/// <reference path="../expo-dev-loop/expo-runner/better-opn.d.ts" />

import { Errors, HCI, Platform, Repo } from '@shared'
import {
  openStudioPreviewSession,
  type StartedStudioFileWatcher,
  type StartedStudioServer,
  startStudioFileWatcher,
  startStudioServer,
  type StudioPreviewSession,
} from '@studio'
import betterOpen from 'better-opn'
import { ExpoConfig } from '../expo-dev-loop/expo-runner/expo-config'
import { ExpoRunner } from '../expo-dev-loop/expo-runner/ExpoRunner'
import { StudioNative } from './StudioNative'
import type { StartedStudioNative } from './StudioNative'

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

/** runStudioDev owns the local Studio server, file watcher, preview compiler, and Expo process. */
export async function runStudioDev(options: StudioDevOptions): Promise<number> {
  const previewRuntimeRoot = Repo.resolvePath(ExpoConfig.RUNTIME_TOOLCHAIN_PATH)
  const expoServer = ExpoRunner.createServer(previewRuntimeRoot)
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
  expoServer.onUnexpectedExit(() => stop(1))
  let preview: StudioPreviewSession | undefined
  let native: StartedStudioNative | undefined
  let watcher: StartedStudioFileWatcher | undefined
  let server: StartedStudioServer | undefined

  try {
    await ExpoRunner.ensureMetroPortFree()
    preview = await openStudioPreviewSession({
      appName: options.appName,
      entryPath: options.entryPath,
      previewRuntimeRoot,
      projectRoot: options.projectRoot,
    })
    watcher = await startStudioFileWatcher(preview.session)
    server = await startStudioServer(preview.session, {
      allowedOrigins: [ExpoConfig.EXPO_ORIGIN],
      hostname: options.hostname,
      port: options.port,
      previewUrl: ExpoConfig.EXPO_ORIGIN,
    })
    await expoServer.start()
    await ExpoRunner.waitForMetro(() => requestedStop)
    HCI.logProcessInfo('studio', `Studio: ${server.url}`)
    HCI.logProcessInfo('studio', `Preview: ${ExpoConfig.EXPO_ORIGIN}`)
    HCI.logProcessInfo('studio', `Project: ${preview.session.projectRoot}`)
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
    await native?.stop()
    await watcher?.close()
    server?.stop()
    await expoServer.stop()
    await preview?.close()
  }
}
