import { devDataAppKey, devDataManifest } from '@expo-host/dev-loop/dev-data/DevDataBootstrap'
import { DevDataServer } from '@expo-host/dev-loop/dev-data/DevDataServer'
import { ExpoRunner } from '@expo-host/dev-loop/expo-runner/ExpoRunner'
import { detectLanIPv4 } from '@expo-host/dev-loop/expo-runner/lan-host'
import { CompanionIdentity } from '@expo-host/dev-loop/prebuilt-host/CompanionIdentity'
import { type AppleFoundationModelsService, startAppleFoundationModelsService } from '@generation/apple-server'
import {
  CLI,
  Errors,
  FS,
  HCI,
  Json,
  Platform,
  ProjectDevSession,
  ProjectLocal,
  Repo,
  SecretsFile,
  TaoHome,
  Time,
} from '@shared'
import {
  openStudioPreviewSession,
  resolveStudioProjectRoot,
  type StartedStudioFileWatcher,
  type StartedStudioServer,
  startStudioFileWatcher,
  startStudioSessionServer,
  StudioCanvasViewportStore,
  StudioClientAssets,
  StudioDeviceGateway,
  StudioDeviceTrustStore,
  type StudioPreviewSession,
  type StudioProjectOpenRequest,
  type StudioRecentProject,
  StudioSessionManager,
  StudioSessionPath,
  type StudioSessionResource,
} from '@studio'
import { enclosingWatchRoot } from '@verification/WatchmanHealth'
import { StudioBrowser } from './StudioBrowser'
import { type StartedStudioClientDevReload, startStudioClientDevReload } from './StudioClientDevReload'
import { startStudioDeviceCli } from './StudioDeviceCli'
import { createStudioDeviceLauncher } from './StudioDeviceLaunch'
import {
  mergeStudioRecentProjects,
  prepareStudioHome,
  readStudioRecentProjects,
  withStudioRecentsLock,
  writeStudioRecentProjects,
} from './StudioHome'
import { describeOwnProcess, openLaunchRecord, type StudioLaunchRecord } from './StudioLaunchManifest'
import { createStudioLifecycleLog, type StudioLifecycleLog } from './StudioLifecycleLog'
import { StudioNative } from './StudioNative'
import type { StartedStudioNative } from './StudioNative'
import { type CreatedStudioPreviewRuntime, StudioPreviewRuntime } from './StudioPreviewRuntime'
import { openTarget, waitForReadyUrl, writeReadiness } from './StudioReadiness'
import { StudioTestProcessRunner } from './StudioTestProcessRunner'

const PROFILE_BIN_PATH = '.devenv/profile/bin'
// Metro 0.84 rejects Watchman unless all four capabilities are present, then uses --no-spawn for
// its own probe. Keep this list beside the Studio preflight so Metro cannot silently downgrade to
// Node watching after Studio already said Watchman was usable.
const METRO_WATCHMAN_CAPABILITIES = ['field-content.sha1hex', 'relative_root', 'suffix-set', 'wildmatch']

export type StudioDevOptions = {
  appName?: string
  browser?: boolean
  /** Launch the installed Companion on this exact physical device name or UDID. */
  device?: string
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
  /** Receives the original classified startup failure for an in-process diagnostic caller. */
  onFailure?: (error: unknown) => void
  /** Receives this invocation's exact launch id once its durable record exists. */
  onLaunch?: (launchId: string) => void
  port?: number
  previewPublication?: 'on' | 'off'
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
    cleanupAfterFailure,
    completeNativeProbe,
    completeNativeLifecycle,
    createProjectOpeners,
    preferredExpoPort,
    publishPreviewBeforeBundling,
    studioWatchmanEnvironment,
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
  let deviceCli: Awaited<ReturnType<typeof startStudioDeviceCli>> | undefined
  let devDataServer: DevDataServer | undefined
  let trustStore: StudioDeviceTrustStore | undefined
  const legacyUserStateRoot = options.userStateRoot ?? Repo.resolvePath('.artifacts/user/studio')
  const userStateRoot = options.userStateRoot ?? await prepareStudioHome(legacyUserStateRoot)
  const recentProjects = createRecentProjectStore(FS.resolvePath('recent-projects.json', userStateRoot))
  const canvasViewportStore = new StudioCanvasViewportStore(FS.resolvePath('project-viewports', legacyUserStateRoot))
  const mode = options.native === true ? 'native' : 'browser'
  const artifactRoot = FS.resolvePath(`launches/${mode}`, userStateRoot)
  let launch: StudioLaunchRecord | undefined
  let lifecycle: StudioLifecycleLog | undefined
  let primaryFailure: unknown

  try {
    if (options.previewPublication === 'off' && (options.native === true || options.device !== undefined)) {
      Errors.throwUserInput('Preview publication checks can be disabled only for browser Studio previews.')
    }
    if (options.previewPublication === 'off') {
      HCI.logProcessInfo(
        'studio',
        'Preview publication checks: OFF (speed experiment; applied revisions are unverified).',
      )
    }
    launch = await openLaunchRecord({
      appName: options.appName,
      artifactRoot,
      mode,
      projectRoot: options.projectRoot,
    })
    notifyObserver('launch observer', () => options.onLaunch?.(launch!.launchId))
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
      rootDir: options.devDataRoot ?? TaoHome.cacheResolve('studio/dev-data-routing'),
      legacyRootDirs: [Repo.resolvePath('.artifacts/user/dev-data'), FS.resolvePath('dev-data', legacyUserStateRoot)],
    })
    HCI.logProcessInfo('studio', `Dev data: tao-dev-data-v1 on port ${devDataServer.port}`)
    const devDataAuthority = devDataServer
    const projects = createProjectOpeners(
      options.entryPath,
      async (request, entryPath) =>
        await openStudioProjectResource(request, {
          devDataAuthority,
          deviceGatewayPort: gatewayPort,
          entryPath,
          isStopping: () => requestedStop,
          preferredExpoPort: preferredExpoPort(),
          previewPublication: options.previewPublication,
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
    const agentSecrets = await SecretsFile.readDecryptedSecrets()
    const agentKeys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']
    if (agentKeys.every(key => agentSecrets[key] === undefined && Platform.runtimeProcess.env[key] === undefined)) {
      HCI.logProcessInfo(
        'studio',
        `Agent chat: no ${
          agentKeys.join(' or ')
        }; run \`just secrets\` to decrypt one, or \`just secrets add <NAME>\`.`,
      )
    }
    const deviceLauncher = createStudioDeviceLauncher()
    const clientAssets = studioClientReload?.clientAssets ?? StudioClientAssets
    await clientAssets.bundle()
    server = await startStudioSessionServer(manager, {
      canvasViewportStore,
      agentSecrets,
      clientAssets,
      clientReloadRevision: studioClientReload?.revision,
      compileOnStart: false,
      deviceGateway,
      deviceLauncher,
      generationProvider: foundationModels.provider,
      hostname: options.hostname,
      openBrowser: StudioBrowser.open,
      port: options.port,
      preferencesRoot: userStateRoot,
    })
    const sessionUrl = `${server.url}${StudioSessionPath.window(initial.sessionId)}`
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
      void completeNativeLifecycle(
        nativeCompletion,
        exitCode => {
          lifecycle?.record({ component: 'native-shell', event: 'process-exited' })
          stop(exitCode)
        },
        // completeNativeLifecycle follows a failure with exit code 1, which records the exit once.
        error => {
          primaryFailure ??= error
          notifyObserver('failure observer', () => options.onFailure?.(error))
          HCI.logProcessError('studio-native', Errors.formatForLog(error))
        },
      )
    }
    if (!requestedStop) {
      // `ready` is a claim about the page, so it is only made once the page has answered. A
      // launch whose page never answers is `failed`, and stops rather than idling in a state
      // that reads as usable to `studio-ps` and to anything scripting it.
      if (await waitForReadyUrl(sessionUrl)) {
        await launch.update({ state: 'ready' })
        if (options.device !== undefined && !requestedStop) {
          if (initialResource.previewUrl === undefined) {
            Errors.throwHostEnvironment('Studio has no Metro preview to launch on the requested device.')
          }
          deviceCli = await startStudioDeviceCli({
            device: options.device,
            gateway: deviceGateway,
            launcher: deviceLauncher,
            metroOrigin: initialResource.previewUrl,
            sessionId: initial.sessionId,
            sessionUrl,
            signal: nativeAbort.signal,
            stop: () => stop(130),
          })
        }
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
      await StudioBrowser.open(target)
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
    primaryFailure = error
    notifyObserver('failure observer', () => options.onFailure?.(error))
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
      try {
        await cleanupStudioDev([
          () => deviceCli?.stop(),
          () => native?.stop(),
          () => studioClientReload?.close(),
          () => server?.stop(),
          () => deviceGateway?.stop(),
          () => devDataServer?.stop(),
          () => manager?.closeAll(),
          () => foundationModels?.stop(),
          () => trustStore?.flush(),
          () => canvasViewportStore.flush(),
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
      } catch (cleanupError) {
        if (primaryFailure === undefined) {
          throw cleanupError
        }
        HCI.logProcessError('studio', `Startup cleanup also failed: ${Errors.formatForLog(cleanupError)}`)
      }
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

async function completeNativeLifecycle(
  completion: Promise<number>,
  onExit: (exitCode: number) => void,
  onFailure: (error: unknown) => void,
): Promise<void> {
  try {
    onExit(await completion)
  } catch (error) {
    onFailure(error)
    onExit(1)
  }
}

function notifyObserver(label: string, notify: () => void): void {
  try {
    notify()
  } catch (error) {
    HCI.logProcessError('studio', `${label} also failed: ${Errors.formatForLog(error)}`)
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
    Errors.throwUserInput('Studio project opening was cancelled.')
  }
  await steps.startBundler()
  if (!await steps.waitForBundler()) {
    Errors.throwUserInput('Studio project opening was cancelled.')
  }
}

export async function openStudioProjectResource(
  request: StudioProjectOpenRequest,
  options: {
    /** The dev data authority written into the preview manifest; absent in launches without one. */
    devDataAuthority?: {
      capability: string
      port: number
      registerProject?: (projectRoot: string, appName: string) => Promise<string>
    }
    /** The device gateway port written into the preview manifest; absent in launches without a gateway. */
    deviceGatewayPort?: number
    entryPath: string | undefined
    isStopping: () => boolean
    logRoot?: string
    previewArtifactRoot?: string
    preferredExpoPort?: number
    previewPublication?: 'on' | 'off'
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
  const ownership = await ProjectDevSession.acquire(project.projectRoot, 'studio')
  const expo = await ExpoRunner.createSessionWithAvailablePort(options.preferredExpoPort, {
    scheme: CompanionIdentity.scheme,
  }).catch(async error => {
    await ownership.release()
    throw error
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
      projectRoot: project.projectRoot,
      artifactRoot: options.previewArtifactRoot,
      deviceGatewayPort: options.deviceGatewayPort,
    })
    // Metro falls back to its Node watcher when Watchman cannot establish a real watch. Prove the
    // generated runtime is watchable, then put the pinned binary first in the child environment.
    const metroEnvironment = await studioWatchmanEnvironment({ watchRoot: previewRuntime.root })
    expoServer = expo.createServer(previewRuntime.root, {
      command: options.expoCommand,
      env: metroEnvironment,
      logRoot: options.logRoot ?? ProjectLocal.cacheResolve('logs', project.projectRoot),
      runtimeToolchainSourceRoot: runtimeToolchainRoot,
    })
    expoServer.onUnexpectedExit(() => options.stop(1))
    preview = await openStudioPreviewSession({
      appName: request.appName,
      entryPath: request.entryPath ?? options.entryPath,
      previewRuntimeRoot: previewRuntime.root,
      previewPublication: options.previewPublication,
      projectRoot: project.projectRoot,
      validationMode: options.validationMode,
    })
    watcher = await startStudioFileWatcher(preview.session)
    const session = preview.session
    if (options.devDataAuthority !== undefined) {
      // The app key needs the session's resolved app name, and Metro has not started yet, so the
      // manifest still takes the fact before any bundle is served.
      const appKey = options.devDataAuthority.registerProject === undefined
        ? devDataAppKey(project.projectRoot, session.appName)
        : await options.devDataAuthority.registerProject(project.projectRoot, session.appName)
      await previewRuntime.configure({
        devData: devDataManifest(
          options.devDataAuthority.port,
          appKey,
          options.devDataAuthority.capability,
        ),
      })
    }
    const bundler = expoServer
    await publishPreviewBeforeBundling({
      compilePreview: () => session.compileInitial(),
      isStopping: options.isStopping,
      startBundler: () => bundler.start(),
      waitForBundler: () => expo.waitForMetro(options.isStopping),
    })
    const previewUrl = new URL(expo.config.EXPO_ORIGIN)
    if (options.previewPublication === 'off') {
      previewUrl.searchParams.set('taoStudioPublication', 'off')
    }
    return withCleanup({
      session,
      tests,
      previewUrl: options.previewPublication === 'off'
        ? previewUrl.href
        : expo.config.EXPO_ORIGIN,
    }, [
      () => tests?.close(),
      () => watcher?.close(),
      () => expoServer?.stop(),
      () => preview?.close(),
      () => expo.releasePortReservation(),
      () => previewRuntime?.close(),
      () => ownership.release(),
    ])
  } catch (error) {
    return await cleanupAfterFailure(error, [
      () => tests?.close(),
      () => watcher?.close(),
      () => expoServer?.stop(),
      () => preview?.close(),
      () => expo.releasePortReservation(),
      () => previewRuntime?.close(),
      () => ownership.release(),
    ])
  }
}

/** studioWatchmanEnvironment makes Metro use the repository-pinned Watchman regardless of PATH. */
async function studioWatchmanEnvironment(
  options: {
    environment?: Platform.ProcessEnv
    isFile?: (path: string) => Promise<boolean>
    repositoryRoot?: string
    run?: (command: string, spec: CLI.CommandSpec) => Promise<CLI.CommandResult>
    watchRoot?: string
  } = {},
): Promise<Readonly<Record<string, string>>> {
  const repositoryRoot = options.repositoryRoot ?? Repo.getRoot()
  const profileBin = FS.resolvePath(PROFILE_BIN_PATH, repositoryRoot)
  const executable = FS.resolvePath('watchman', profileBin)
  const isFile = options.isFile ?? FS.isFile
  if (!await isFile(executable)) {
    throwWatchmanPreflightError(
      `missing from ${PROFILE_BIN_PATH}`,
      `Run \`./agent setup\` to materialize it, then retry Studio.`,
    )
  }
  // Metro performs this exact non-spawning probe before it decides whether to use Watchman. Run it
  // first: `watch-project` could otherwise start a daemon and hide the condition that makes Metro
  // choose its Node fallback.
  const capabilities = await (options.run ?? CLI.run)(executable, {
    args: ['list-capabilities', '--output-encoding=json', '--no-pretty', '--no-spawn'],
    stdio: 'pipe',
  })
  if (capabilities.error !== undefined || capabilities.exitCode !== 0) {
    throwWatchmanPreflightError(
      `not usable by Metro at ${executable}`,
      `Run \`${executable} list-capabilities --no-spawn\` to diagnose Watchman, then retry Studio.`,
    )
  }
  const capabilityNames = watchmanCapabilityNames(capabilities.stdout)
  const missingCapabilities = METRO_WATCHMAN_CAPABILITIES.filter(capability => !capabilityNames.has(capability))
  if (missingCapabilities.length > 0) {
    throwWatchmanPreflightError(
      `missing Metro capability ${missingCapabilities.join(', ')}`,
      `Run \`${executable} list-capabilities --no-spawn\` to diagnose Watchman, then retry Studio.`,
    )
  }
  // Metro's fb-watchman client otherwise resolves its socket in a separate process. Pass the
  // exact no-spawn socket we just proved usable so its crawler cannot silently take another
  // discovery path and fall back to Node watching.
  const socket = await (options.run ?? CLI.run)(executable, {
    args: ['--no-pretty', 'get-sockname', '--no-spawn'],
    stdio: 'pipe',
  })
  const socketName = socket.error === undefined && socket.exitCode === 0
    ? watchmanSocketName(socket.stdout)
    : undefined
  if (socketName === undefined) {
    throwWatchmanPreflightError(
      `not usable by Metro at ${executable}`,
      `Run \`${executable} --no-pretty get-sockname --no-spawn\` to diagnose Watchman, then retry Studio.`,
    )
  }
  const watchRoot = options.watchRoot ?? repositoryRoot
  const run = options.run ?? CLI.run
  const result = await run(executable, {
    args: ['watch-project', watchRoot],
    stdio: 'pipe',
  })
  if (result.error !== undefined || result.exitCode !== 0) {
    const output = `${result.stderr}\n${result.stdout}`
    if (output.includes('/Library/LaunchAgents/') && output.includes('Operation not permitted')) {
      throwWatchmanPreflightError(
        'blocked from its macOS LaunchAgent by the current task',
        'Check Watchman access to ~/Library/LaunchAgents, then retry Studio.',
      )
    }
    throwWatchmanPreflightError(
      `not usable at ${executable}`,
      `Run \`${executable} version\` to diagnose Watchman, then retry Studio.`,
    )
  }
  // Watchman answers with an existing watch that encloses the checkout before it honors the
  // checkout's own root marker, so a watched primary checkout folds every worktree nested in it into
  // one watch. One that no dev server subscribes to is released and the watch asked for again; one
  // still in use is left alone, and Studio refuses rather than have Metro crawl every worktree.
  const checkout = await FS.realPath(repositoryRoot).catch(() => repositoryRoot)
  const enclosingIn = (output: string) => {
    const watched = watchmanWatchRoot(output)
    return watched === undefined ? undefined : enclosingWatchRoot([watched], checkout)
  }
  let enclosing = enclosingIn(result.stdout)
  if (enclosing !== undefined && await watchIsIdle(run, executable, enclosing)) {
    await run(executable, { args: ['watch-del', enclosing], stdio: 'pipe' })
    const again = await run(executable, { args: ['watch-project', watchRoot], stdio: 'pipe' })
    enclosing = again.error === undefined && again.exitCode === 0 ? enclosingIn(again.stdout) : enclosing
  }
  if (enclosing !== undefined) {
    Errors.throwHostEnvironment(
      `Tao Studio cannot start Metro on its own watch: Watchman is watching ${enclosing}, which encloses this checkout, and a dev server is still subscribed to it, so Metro would crawl every worktree beneath it. Once that server stops, retry Studio: it releases an enclosing watch nothing uses.`,
    )
  }
  const environment = options.environment ?? Platform.runtimeProcess.env
  const inheritedPath = (environment['PATH'] ?? '')
    .split(':')
    .filter(directory => directory.length > 0 && directory !== profileBin)
  const childEnvironment: Record<string, string> = {}
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) {
      childEnvironment[key] = value
    }
  }
  return { ...childEnvironment, PATH: [profileBin, ...inheritedPath].join(':'), WATCHMAN_SOCK: socketName }
}

function watchmanCapabilityNames(output: string): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(output)
    if (
      !Json.isRecord(parsed)
      || typeof parsed['version'] !== 'string'
      || !Array.isArray(parsed['capabilities'])
    ) {
      return new Set()
    }
    return new Set(parsed['capabilities'].filter((capability): capability is string => typeof capability === 'string'))
  } catch {
    return new Set()
  }
}

/** watchIsIdle is true only when Watchman positively reports no subscription on `root`. */
async function watchIsIdle(
  run: (command: string, spec: CLI.CommandSpec) => Promise<CLI.CommandResult>,
  executable: string,
  root: string,
): Promise<boolean> {
  const listed = await run(executable, { args: ['--no-pretty', 'debug-get-subscriptions', root], stdio: 'pipe' })
  try {
    const parsed: unknown = JSON.parse(listed.stdout)
    return listed.exitCode === 0 && Json.isRecord(parsed)
      && Array.isArray(parsed['subscribers']) && parsed['subscribers'].length === 0
      && Array.isArray(parsed['subscriptions']) && parsed['subscriptions'].length === 0
  } catch {
    return false
  }
}

function watchmanWatchRoot(output: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(output)
    return Json.isRecord(parsed) && typeof parsed['watch'] === 'string' ? parsed['watch'] : undefined
  } catch {
    return undefined
  }
}

function watchmanSocketName(output: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(output)
    return Json.isRecord(parsed) && typeof parsed['sockname'] === 'string' && parsed['sockname'] !== ''
      ? parsed['sockname']
      : undefined
  } catch {
    return undefined
  }
}

function throwWatchmanPreflightError(problem: string, remediation: string): never {
  Errors.throwHostEnvironment(
    `Tao Studio cannot start Metro safely: pinned Watchman is ${problem}. Metro would fall back to OS file watching. ${remediation}`,
  )
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
      return await readStudioRecentProjects(path) ?? []
    },
    save(recent) {
      const snapshot = recent.filter(isRecentProject)
      const write = async () => {
        await withStudioRecentsLock(path, async () => {
          const current = await readStudioRecentProjects(path) ?? []
          await writeStudioRecentProjects(path, mergeStudioRecentProjects(current, snapshot))
        })
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

async function cleanupAfterFailure(
  primaryError: unknown,
  cleanups: ReadonlyArray<() => unknown | Promise<unknown>>,
  reportCleanupError: (error: unknown) => void = error =>
    HCI.logProcessError('studio', `Startup cleanup also failed: ${Errors.formatForLog(error)}`),
): Promise<never> {
  try {
    await cleanupStudioDev(cleanups)
  } catch (cleanupError) {
    reportCleanupError(cleanupError)
  }
  throw primaryError
}
