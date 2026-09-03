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
import { type StartedStudioClientDevReload, startStudioClientDevReload } from './StudioClientDevReload'
import { describeOwnProcess, openLaunchRecord, type StudioLaunchRecord } from './StudioLaunchManifest'
import { createStudioLifecycleLog, type StudioLifecycleLog } from './StudioLifecycleLog'
import { StudioNative } from './StudioNative'
import type { StartedStudioNative } from './StudioNative'
import { type CreatedStudioPreviewRuntime, StudioPreviewRuntime } from './StudioPreviewRuntime'
import { openTarget, waitForReadyUrl, writeReadiness } from './StudioReadiness'
import { StudioTestProcessRunner } from './StudioTestProcessRunner'

export type StudioDevOptions = {
  appName?: string
  browser?: boolean
  entryPath?: string
  hostname?: string
  /** Emit a machine-readable readiness payload once the advertised page answers. */
  json?: boolean
  native?: boolean
  nativeArtifactRoot?: string
  nativeHutchPath?: string
  nativeProbe?: boolean
  nativeShowWindow?: boolean
  port?: number
  projectRoot: string
  userStateRoot?: string
}

/** StudioDev exposes narrow lifecycle seams for focused developer-tool tests. */
export const StudioDev = {
  testing: {
    addStopSignalHandlers,
    cleanup: cleanupStudioDev,
    completeNativeProbe,
    createProjectOpeners,
    preferredExpoPort,
    publishPreviewBeforeBundling,
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
  const removeStopSignalHandlers = addStopSignalHandlers(stop)
  let native: StartedStudioNative | undefined
  let server: StartedStudioServer | undefined
  let foundationModels: AppleFoundationModelsService | undefined
  let manager: StudioSessionManager | undefined
  let studioClientReload: StartedStudioClientDevReload | undefined
  const userStateRoot = options.userStateRoot ?? Repo.resolvePath('.artifacts/user/studio')
  const recentProjects = createRecentProjectStore(FS.resolvePath('recent-projects.json', userStateRoot))
  const mode = options.native === true ? 'native' : 'browser'
  const artifactRoot = FS.resolvePath(`launches/${mode}`, userStateRoot)
  let launch: StudioLaunchRecord | undefined
  let lifecycle: StudioLifecycleLog | undefined

  try {
    launch = await openLaunchRecord({
      appName: options.appName,
      artifactRoot,
      mode,
      projectRoot: options.projectRoot,
    })
    lifecycle = createStudioLifecycleLog({ artifactRoot, launchId: launch.launchId })
    lifecycle.record({ component: 'studio-server', event: 'launch-requested', pid: Platform.runtimeProcess.pid })
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
          // Studio scrapes the whole stream for failures and PASS/FAIL lines; a piped `tao test`
          // would otherwise select its quiet mode and truncate that stream to a failure tail.
          testCommandArgs: projectRoot => ['test', projectRoot, '--output', 'lines'],
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
    studioClientReload = options.native ? undefined : await startStudioClientDevReload()
    server = await startStudioSessionServer(manager, {
      clientAssets: studioClientReload?.clientAssets,
      clientReloadRevision: studioClientReload?.revision,
      compileOnStart: false,
      generationProvider: foundationModels.provider,
      hostname: options.hostname,
      port: options.port,
    })
    const sessionUrl = `${server.url}/sessions/${encodeURIComponent(initial.sessionId)}`
    lifecycle.record({ component: 'studio-server', event: 'port-allocated', port: server.port })
    lifecycle.record({ component: 'studio-server', event: 'server-ready', port: server.port })
    lifecycle.record({ component: 'studio-server', event: 'session-created', sessionId: initial.sessionId })
    lifecycle.record({ component: 'preview', event: 'preview-published', message: initialResource.previewUrl })
    // Only the session page is advertised: the server root is not the page a person can use.
    HCI.logProcessInfo('studio', `Studio: ${sessionUrl}`)
    HCI.logProcessInfo('studio', `Preview: ${initialResource.previewUrl}`)
    await launch.update({
      previewUrl: initialResource.previewUrl,
      processes: [await describeOwnProcess('studio-server')],
      sessionId: initial.sessionId,
      sessionUrl,
      studioPort: server.port,
      studioUrl: server.url,
    })
    if (options.native && !requestedStop) {
      native = await StudioNative.start({
        artifactRoot: options.nativeArtifactRoot,
        hutchPath: nativeHutchPath,
        previewUrl: initialResource.previewUrl ?? 'http://127.0.0.1:1',
        // `--no-browser` also means "no extra project window" for the native shell.
        projectUrl: options.browser === false ? undefined : sessionUrl,
        probe: options.nativeProbe,
        showWindow: options.nativeShowWindow,
        studioUrl: server.url,
      })
      lifecycle.record({ component: 'native-shell', event: 'process-started' })
      const nativeCompletion = options.nativeProbe === true
        ? completeNativeProbe(native)
        : native.waitForClose()
      void nativeCompletion.then(
        exitCode => {
          lifecycle?.record({ component: 'native-shell', event: 'process-exited' })
          stop(exitCode)
        },
        error => {
          lifecycle?.record({ component: 'native-shell', event: 'process-exited' })
          HCI.logProcessError('studio-native', Errors.formatForLog(error))
          stop(1)
        },
      )
    }
    if (!requestedStop) {
      // `ready` is a claim about the page, so it is only made once the page has answered. A
      // launch whose page never answers is `failed`, and stops rather than idling in a state
      // that reads as usable to `studio-ps` and to anything scripting it.
      if (await waitForReadyUrl(sessionUrl)) {
        await launch.update({ state: 'ready' })
        if (options.json === true) {
          writeReadiness({
            appName: options.appName,
            artifactRoot,
            launchId: launch.launchId,
            lifecycleLogPath: lifecycle.path,
            manifestPath: launch.path,
            mode,
            previewUrl: initialResource.previewUrl,
            projectRoot: initial.project,
            sessionId: initial.sessionId,
            sessionUrl,
            studioUrl: server.url,
            version: 1,
          })
        }
      } else {
        await launch.update({ shutdownReason: 'the session page never answered', state: 'failed' })
        HCI.logProcessError('studio', `Studio did not answer at ${sessionUrl}.`)
        stop(1)
      }
    }
    const target = options.native === true
      ? undefined
      : openTarget({ browser: options.browser, opened: requestedStop, sessionUrl })
    if (target !== undefined) {
      await betterOpen(target)
    }
    if (!requestedStop) {
      HCI.logProcessInfo(
        'studio',
        options.nativeProbe === true
          ? 'Native probe running; Tao Studio will stop automatically.'
          : 'Press Ctrl+C to stop Tao Studio.',
      )
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
    removeStopSignalHandlers()
    lifecycle?.record({ component: 'studio-server', event: 'shutdown-requested' })
    await cleanupStudioDev([
      () => native?.stop(),
      () => studioClientReload?.close(),
      () => server?.stop(),
      () => manager?.closeAll(),
      () => foundationModels?.stop(),
      () =>
        recentProjects.flush().catch(error => {
          HCI.logProcessError('studio', `Could not save recent projects: ${Errors.formatForLog(error)}`)
        }),
      async () => {
        // The process record is kept, not cleared: a caller checking for survivors after shutdown
        // needs to know what this launch owned. Liveness is decided by validation, not by absence.
        await launch?.finalize({ shutdownReason: 'studio exited' })
        lifecycle?.record({ component: 'studio-server', event: 'manifest-finalized' })
        await lifecycle?.close()
      },
    ])
  }
}

/** A probe result is terminal even though Hutch's development watcher intentionally stays alive. */
async function completeNativeProbe(
  native: Pick<StartedStudioNative, 'stop' | 'waitForProbe'>,
  logStopError: (error: unknown) => void = error =>
    HCI.logProcessError('studio-native', `Could not stop Hutch after the probe failed: ${Errors.formatForLog(error)}`),
): Promise<number> {
  let probeError: unknown
  try {
    return (await native.waitForProbe()).passed ? 0 : 1
  } catch (error) {
    probeError = error
    throw error
  } finally {
    try {
      await native.stop()
    } catch (error) {
      if (probeError === undefined) {
        throw error
      }
      logStopError(error)
    }
  }
}

function addStopSignalHandlers(
  stop: (exitCode: number) => void,
  onSignal = Platform.onProcessSignal,
): () => void {
  const removeHandlers = [
    onSignal('SIGHUP', () => stop(129)),
    onSignal('SIGINT', () => stop(130)),
    onSignal('SIGTERM', () => stop(143)),
  ]
  return () => {
    for (const removeHandler of removeHandlers) {
      removeHandler()
    }
  }
}

function preferredExpoPort(): number {
  return 0
}

/**
 * publishPreviewBeforeBundling compiles the first preview revision into the runtime directory and
 * only then starts the bundler over it.
 *
 * The bundler's file map is one crawl taken while it boots plus a file-watcher subscription opened
 * once that crawl has been processed. A file created between the two belongs to neither: the crawl
 * predates it, and the subscription starts from a later clock, so the bundler denies the module
 * exists for the rest of the process. That is exactly what the generated app was when it was
 * compiled after the bundler started, which is how a preview could stay blank for a whole session
 * while the project itself compiled cleanly and reported no problems.
 *
 * Publishing first removes the window instead of racing it: the crawl sees a populated tree, and
 * every later revision is an ordinary edit arriving through a subscription opened long before.
 * Nothing here needs the bundler, so the order costs no startup time; both steps were already
 * serial.
 */
async function publishPreviewBeforeBundling(steps: {
  compilePreview: () => Promise<unknown>
  isStopping: () => boolean
  startBundler: () => Promise<void>
  waitForBundler: () => Promise<boolean>
}): Promise<void> {
  await steps.compilePreview()
  if (steps.isStopping()) {
    throw new Errors.UserInputError('Studio project opening was cancelled.')
  }
  await steps.startBundler()
  if (!await steps.waitForBundler()) {
    throw new Errors.UserInputError('Studio project opening was cancelled.')
  }
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
    const session = preview.session
    const bundler = expoServer
    await publishPreviewBeforeBundling({
      compilePreview: () => session.compileInitial(),
      isStopping: options.isStopping,
      startBundler: () => bundler.start(),
      waitForBundler: () => expo.waitForMetro(options.isStopping),
    })
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
