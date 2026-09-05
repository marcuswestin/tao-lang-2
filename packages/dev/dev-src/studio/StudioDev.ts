/// <reference path="../expo-dev-loop/expo-runner/better-opn.d.ts" />

import { type AppleFoundationModelsService, startAppleFoundationModelsService } from '@generation/apple-server'
import { Errors, FS, HCI, Json, Platform, Repo, Time } from '@shared'
import {
  openStudioPreviewSession,
  resolveStudioProjectRoot,
  type StartedStudioFileWatcher,
  type StartedStudioServer,
  startStudioFileWatcher,
  startStudioSessionServer,
  StudioDeviceGateway,
  StudioDeviceTrustStore,
  type StudioPreviewSession,
  type StudioProjectOpenRequest,
  type StudioRecentProject,
  StudioSessionManager,
  type StudioSessionResource,
} from '@studio'
import betterOpen from 'better-opn'
import { DEV_DATA_ROOT_PATH, devDataAppKey, devDataManifest } from '../dev-data/DevDataBootstrap'
import { DevDataServer } from '../dev-data/DevDataServer'
import { ExpoRunner } from '../expo-dev-loop/expo-runner/ExpoRunner'
import { detectLanIPv4 } from '../expo-dev-loop/expo-runner/lan-host'
import { readDecryptedSecrets } from '../secrets/SecretsFile'
import { type StartedStudioClientDevReload, startStudioClientDevReload } from './StudioClientDevReload'
import { StudioCompanionIdentity } from './StudioCompanionIdentity'
import { createStudioDeviceLauncher } from './StudioDeviceLaunch'
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
  nativeHostCommand?: string
  nativeProbe?: boolean
  nativeShowWindow?: boolean
  port?: number
  projectRoot: string
  /** Where the dev data server persists app snapshots; defaults to the repository's user artifacts. */
  devDataRoot?: string
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
  const nativeAbort = new AbortController()
  const stop = (exitCode: number) => {
    if (!requestedStop) {
      requestedStop = true
      nativeAbort.abort()
      finish?.(exitCode)
    }
  }
  const removeStopSignalHandlers = addStopSignalHandlers(stop)
  let native: StartedStudioNative | undefined
  let server: StartedStudioServer | undefined
  let foundationModels: AppleFoundationModelsService | undefined
  let manager: StudioSessionManager | undefined
  let studioClientReload: StartedStudioClientDevReload | undefined
  let deviceGateway: StudioDeviceGateway | undefined
  let devDataServer: DevDataServer | undefined
  let trustStore: StudioDeviceTrustStore | undefined
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
    // The gateway starts before any project so its port can be written into every preview manifest,
    // and it finds sessions through the manager that is created right after it.
    trustStore = await StudioDeviceTrustStore.open(FS.resolvePath('device-trust', userStateRoot))
    deviceGateway = await StudioDeviceGateway.start({
      hosts: async () => [await detectLanIPv4()].filter(host => host !== 'localhost'),
      log: line => HCI.logProcessInfo('studio-device', line),
      sessions: {
        get: sessionId => {
          const resource = manager?.get(sessionId)
          return resource === undefined
            ? undefined
            : { previewUrl: resource.previewUrl, session: resource.session, sessionId }
        },
        list: () =>
          (manager?.list().current ?? []).flatMap(item => {
            const resource = manager?.get(item.sessionId)
            return resource === undefined
              ? []
              : [{ previewUrl: resource.previewUrl, session: resource.session, sessionId: item.sessionId }]
          }),
      },
      trustStore,
    })
    lifecycle.record({ component: 'device-gateway', event: 'port-allocated', port: deviceGateway.port })
    HCI.logProcessInfo('studio', `Device gateway: tao-studio-device-v1 on port ${deviceGateway.port}`)
    const gatewayPort = deviceGateway.port
    // One dev data server serves every project this Studio opens; each project's preview manifest
    // names its own app key, so the projects' `Dev` datasources never share a stream.
    devDataServer = await DevDataServer.start({
      log: line => HCI.logProcessInfo('studio-data', line),
      rootDir: options.devDataRoot ?? Repo.resolvePath(DEV_DATA_ROOT_PATH),
    })
    HCI.logProcessInfo('studio', `Dev data: tao-dev-data-v1 on port ${devDataServer.port}`)
    const devDataPort = devDataServer.port
    const projects = createProjectOpeners(
      options.entryPath,
      async (request, entryPath) =>
        await openStudioProjectResource(request, {
          devDataPort,
          deviceGatewayPort: gatewayPort,
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
    // Read here rather than exported into the environment: everything Studio starts inherits an environment,
    // and only the chat needs these. `--native` takes the same path, which is why it was missing them too.
    const agentSecrets = await readDecryptedSecrets()
    if (agentSecrets['ANTHROPIC_API_KEY'] === undefined && process.env['ANTHROPIC_API_KEY'] === undefined) {
      HCI.logProcessInfo('studio', 'Agent chat: no ANTHROPIC_API_KEY; run `just secrets` to decrypt one.')
    }
    server = await startStudioSessionServer(manager, {
      agentSecrets,
      clientAssets: studioClientReload?.clientAssets,
      clientReloadRevision: studioClientReload?.revision,
      compileOnStart: false,
      deviceGateway,
      deviceLauncher: createStudioDeviceLauncher(),
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
        nativeHostCommand: options.nativeHostCommand,
        previewUrl: initialResource.previewUrl ?? 'http://127.0.0.1:1',
        // `--no-browser` also means "no extra project window" for the native shell.
        projectUrl: options.browser === false ? undefined : sessionUrl,
        probe: options.nativeProbe,
        showWindow: options.nativeShowWindow,
        signal: nativeAbort.signal,
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
            devDataPort: devDataServer.port,
            deviceGatewayPort: deviceGateway.port,
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
    const cleanupStartedAt = Time.nowMs()
    if (options.native === true) {
      HCI.logProcessInfo('studio-native', 'final cleanup: started')
    }
    try {
      await cleanupStudioDev([
        () => native?.stop(),
        () => studioClientReload?.close(),
        () => server?.stop(),
        () => deviceGateway?.stop(),
        () => devDataServer?.stop(),
        () => manager?.closeAll(),
        () => foundationModels?.stop(),
        () => trustStore?.flush(),
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
    } finally {
      if (options.native === true) {
        HCI.logProcessInfo(
          'studio-native',
          `final cleanup: completed in ${Math.max(0, Math.round(Time.nowMs() - cleanupStartedAt))}ms`,
        )
      }
    }
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
    /** The dev data server port written into the preview manifest; absent in launches without one. */
    devDataPort?: number
    /** The device gateway port written into the preview manifest; absent in launches without a gateway. */
    deviceGatewayPort?: number
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
  const expo = await ExpoRunner.createSessionWithAvailablePort(options.preferredExpoPort, {
    scheme: StudioCompanionIdentity.scheme,
  })
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
    previewRuntime = await StudioPreviewRuntime.create(runtimeToolchainRoot, {
      artifactRoot: options.previewArtifactRoot,
      deviceGatewayPort: options.deviceGatewayPort,
    })
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
    if (options.devDataPort !== undefined) {
      // The app key needs the session's resolved app name, and Metro has not started yet, so the
      // manifest still takes the fact before any bundle is served.
      await previewRuntime.configure({
        devData: devDataManifest(options.devDataPort, devDataAppKey(project.projectRoot, session.appName)),
      })
    }
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
        if (!Json.isRecord(value) || value['version'] !== 1 || !Array.isArray(value['recent'])) {
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
  return Json.isRecord(value)
    && typeof value['appName'] === 'string'
    && value['appName'].trim() !== ''
    && typeof value['project'] === 'string'
    && value['project'].trim() !== ''
    && typeof value['lastOpenedAt'] === 'string'
    && !Number.isNaN(Date.parse(value['lastOpenedAt']))
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
