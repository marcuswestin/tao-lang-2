/// <reference path="../expo-dev-loop/expo-runner/better-opn.d.ts" />

import { type AppleFoundationModelsService, startAppleFoundationModelsService } from '@generation/apple-server'
import { Errors, FS, HCI, Platform, Repo } from '@shared'
import {
  openStudioPreviewSession,
  resolveStudioProjectRoot,
  type StartedStudioFileWatcher,
  type StartedStudioServer,
  startStudioFileWatcher,
  startStudioSessionServer,
  type StudioPreviewSession,
  type StudioProjectOpenRequest,
  type StudioRecentProject,
  StudioSessionManager,
  type StudioSessionResource,
} from '@studio'
import betterOpen from 'better-opn'
import { ExpoRunner } from '../expo-dev-loop/expo-runner/ExpoRunner'
import { StudioNative } from './StudioNative'
import type { StartedStudioNative } from './StudioNative'
import { type CreatedStudioPreviewRuntime, StudioPreviewRuntime } from './StudioPreviewRuntime'
import { StudioTestProcessRunner } from './StudioTestProcessRunner'

export type StudioDevOptions = {
  appName?: string
  browser?: boolean
  entryPath?: string
  hostname?: string
  native?: boolean
  nativeArtifactRoot?: string
  nativeHutchPath?: string
  nativeProbe?: boolean
  port?: number
  projectRoot: string
  userStateRoot?: string
}

/** StudioDev exposes narrow lifecycle seams for focused developer-tool tests. */
export const StudioDev = {
  testing: {
    cleanup: cleanupStudioDev,
    createProjectOpeners,
    preferredExpoPort,
    withCleanup,
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
  let native: StartedStudioNative | undefined
  let server: StartedStudioServer | undefined
  let foundationModels: AppleFoundationModelsService | undefined
  let manager: StudioSessionManager | undefined
  const recentProjects = createRecentProjectStore(
    FS.resolvePath('recent-projects.json', options.userStateRoot ?? Repo.resolvePath('.artifacts/user/studio')),
  )

  try {
    const nativeHutchPath = options.native
      ? await StudioNative.resolveHutchExecutablePath(options.nativeHutchPath)
      : undefined
    const projects = createProjectOpeners(
      options.entryPath,
      async (request, entryPath) =>
        await openStudioProjectResource(request, {
          entryPath,
          isStopping: () => requestedStop,
          preferredExpoPort: preferredExpoPort(),
          stop,
          testCommandPath: Repo.resolvePath('tao'),
        }),
    )
    manager = new StudioSessionManager({
      onRecentProjectsChanged(recent) {
        void recentProjects.save(recent).catch(error => {
          HCI.logProcessError('studio', `Could not save recent projects: ${Errors.formatForLog(error)}`)
        })
      },
      openProject: projects.additional,
      recentProjects: await recentProjects.load(),
    })
    foundationModels = await startAppleFoundationModelsService()
    const intelligence = await foundationModels.provider.availability()
    HCI.logProcessInfo(
      'studio',
      intelligence.status === 'available'
        ? 'Apple Foundation Models: available'
        : `Apple Foundation Models: unavailable (${intelligence.reason})`,
    )
    const initialResource = await projects.initial({
      appName: options.appName,
      projectPath: options.projectRoot,
    })
    const initial = manager.add(initialResource)
    HCI.logProcessInfo('studio', `Project: ${initial.project}`)
    server = await startStudioSessionServer(manager, {
      compileOnStart: false,
      generationProvider: foundationModels.provider,
      hostname: options.hostname,
      port: options.port,
    })
    const projectUrl = `${server.url}/sessions/${encodeURIComponent(initial.sessionId)}`
    HCI.logProcessInfo('studio', `Studio: ${server.url}`)
    HCI.logProcessInfo('studio', `Preview: ${initialResource.previewUrl}`)
    if (options.native && !requestedStop) {
      native = await StudioNative.start({
        artifactRoot: options.nativeArtifactRoot,
        hutchPath: nativeHutchPath,
        previewUrl: initialResource.previewUrl ?? 'http://127.0.0.1:1',
        projectUrl,
        probe: options.nativeProbe,
        studioUrl: server.url,
      })
      void native.waitForClose().then(exitCode => stop(exitCode))
    } else if (options.browser !== false && !requestedStop) {
      await betterOpen(projectUrl)
    }
    if (!requestedStop) {
      HCI.logProcessInfo('studio', 'Press Ctrl+C to stop Tao Studio.')
    }
    return await finished
  } catch (error) {
    if (requestedStop) {
      return await finished
    }
    HCI.writeErrorLine(Errors.formatForUser(error))
    HCI.logProcessError('studio', Errors.formatForLog(error))
    return 1
  } finally {
    removeSigint()
    removeSigterm()
    await cleanupStudioDev([
      () => native?.stop(),
      () => server?.stop(),
      () => manager?.closeAll(),
      () => foundationModels?.stop(),
      () =>
        recentProjects.flush().catch(error => {
          HCI.logProcessError('studio', `Could not save recent projects: ${Errors.formatForLog(error)}`)
        }),
    ])
  }
}

function preferredExpoPort(): number {
  return 0
}

export async function openStudioProjectResource(
  request: StudioProjectOpenRequest,
  options: {
    entryPath: string | undefined
    isStopping: () => boolean
    logRoot?: string
    previewArtifactRoot?: string
    preferredExpoPort?: number
    runtimeToolchainRoot?: string
    stop: (exitCode: number) => void
    testCommandArgs?: (projectRoot: string) => readonly string[]
    expoCommand?: {
      argsPrefix?: readonly string[]
      executable: string
    }
    testCommandEnv?: Readonly<Record<string, string>>
    testCommandPath?: string
    validationMode?: 'development' | 'release'
  },
): Promise<StudioSessionResource> {
  const project = await resolveStudioProjectRoot(request.projectPath)
  const expo = await ExpoRunner.createSessionWithAvailablePort(options.preferredExpoPort)
  let expoServer: ReturnType<typeof ExpoRunner.createServer> | undefined
  let previewRuntime: CreatedStudioPreviewRuntime | undefined
  let preview: StudioPreviewSession | undefined
  let watcher: StartedStudioFileWatcher | undefined
  const tests = options.testCommandPath === undefined
    ? undefined
    : new StudioTestProcessRunner({
      args: options.testCommandArgs?.(project.projectRoot) ?? ['test', project.projectRoot],
      command: options.testCommandPath,
      cwd: project.projectRoot,
      env: options.testCommandEnv,
    })
  try {
    const runtimeToolchainRoot = options.runtimeToolchainRoot ?? Repo.resolvePath(expo.config.RUNTIME_TOOLCHAIN_PATH)
    previewRuntime = await StudioPreviewRuntime.create(runtimeToolchainRoot, options.previewArtifactRoot)
    expoServer = expo.createServer(previewRuntime.root, {
      command: options.expoCommand,
      logRoot: options.logRoot,
      runtimeToolchainSourceRoot: runtimeToolchainRoot,
    })
    expoServer.onUnexpectedExit(() => options.stop(1))
    preview = await openStudioPreviewSession({
      appName: request.appName,
      entryPath: request.entryPath ?? options.entryPath,
      previewRuntimeRoot: previewRuntime.root,
      projectRoot: project.projectRoot,
      validationMode: options.validationMode,
    })
    watcher = await startStudioFileWatcher(preview.session)
    await expoServer.start()
    if (!await expo.waitForMetro(options.isStopping)) {
      throw new Errors.UserInputError('Studio project opening was cancelled.')
    }
    await preview.session.compileInitial()
    if (options.isStopping()) {
      throw new Errors.UserInputError('Studio project opening was cancelled.')
    }
    const session = preview.session
    return withCleanup({
      session,
      tests,
      previewUrl: expo.config.EXPO_ORIGIN,
    }, [
      () => tests?.close(),
      () => watcher?.close(),
      () => expoServer?.stop(),
      () => preview?.close(),
      () => expo.releasePortReservation(),
      () => previewRuntime?.close(),
    ])
  } catch (error) {
    await cleanupStudioDev([
      () => tests?.close(),
      () => watcher?.close(),
      () => expoServer?.stop(),
      () => preview?.close(),
      () => expo.releasePortReservation(),
      () => previewRuntime?.close(),
    ])
    throw error
  }
}

function createProjectOpeners<Result>(
  initialEntryPath: string | undefined,
  openProject: (request: StudioProjectOpenRequest, entryPath: string | undefined) => Promise<Result>,
): {
  additional: (request: StudioProjectOpenRequest) => Promise<Result>
  initial: (request: StudioProjectOpenRequest) => Promise<Result>
} {
  return {
    additional: async request => await openProject(request, undefined),
    initial: async request => await openProject(request, initialEntryPath),
  }
}

function withCleanup<Value extends object>(
  value: Value,
  cleanups: ReadonlyArray<() => unknown | Promise<unknown>>,
): Value & { close: () => Promise<void> } {
  let closing: Promise<void> | undefined
  return {
    ...value,
    close() {
      closing ??= cleanupStudioDev(cleanups)
      return closing
    },
  }
}

export type RecentProjectStore = {
  flush(): Promise<void>
  load(): Promise<readonly StudioRecentProject[]>
  save(recent: readonly StudioRecentProject[]): Promise<void>
}

export function createRecentProjectStore(path: string): RecentProjectStore {
  let pending = Promise.resolve()
  return {
    flush() {
      return pending
    },
    async load() {
      try {
        if (!await FS.isFile(path)) {
          return []
        }
        const value = await FS.readJson(path)
        if (!isRecord(value) || value['version'] !== 1 || !Array.isArray(value['recent'])) {
          return []
        }
        return value['recent'].filter(isRecentProject).slice(0, 12)
      } catch {
        return []
      }
    },
    save(recent) {
      const snapshot = recent.filter(isRecentProject).slice(0, 12)
      const write = async () => {
        const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`
        try {
          await FS.writeJson(temporaryPath, { recent: snapshot, version: 1 })
          await FS.move(temporaryPath, path)
        } finally {
          await FS.remove(temporaryPath)
        }
      }
      const saving = pending.then(write, write)
      pending = saving
      return saving
    },
  }
}

function isRecentProject(value: unknown): value is StudioRecentProject {
  return isRecord(value)
    && typeof value['appName'] === 'string'
    && value['appName'].trim() !== ''
    && typeof value['project'] === 'string'
    && value['project'].trim() !== ''
    && typeof value['lastOpenedAt'] === 'string'
    && !Number.isNaN(Date.parse(value['lastOpenedAt']))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
