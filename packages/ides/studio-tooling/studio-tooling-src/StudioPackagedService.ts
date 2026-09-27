import { DevDataServer } from '@expo-host/dev-loop/dev-data/DevDataServer'
import { detectLanIPv4 } from '@expo-host/dev-loop/expo-runner/lan-host'
import { Errors, FS, HCI } from '@shared'
import {
  startStudioSessionServer,
  StudioCanvasViewportStore,
  StudioClientAssets,
  StudioDeviceGateway,
  StudioDeviceTrustStore,
  type StudioRecentProject,
  StudioSessionManager,
} from '@studio'
import { StudioBrowser } from './StudioBrowser'
import { createRecentProjectStore, openStudioProjectResource } from './StudioDev'

export type StudioPackagedServiceOptions = {
  runtimeToolchainRoot: string
  studioClientBundlePath: string
  stdlibRoot: string
  testCommandPath: string
  testNodePath: string
  userStateRoot: string
}

export type StartedStudioPackagedService = {
  /** Exposed for packaged-service readiness and lifecycle verification. */
  devDataPort: number
  deviceGatewayPort: number
  stop(): Promise<void>
  url: string
}

export type StudioPackagedServiceDependencies = {
  loadRecentProjects?: () => Promise<readonly StudioRecentProject[]>
  openTrustStore?: typeof StudioDeviceTrustStore.open
  startDevDataServer?: typeof DevDataServer.start
  startDeviceGateway?: typeof StudioDeviceGateway.start
  startSessionServer?: typeof startStudioSessionServer
}

/** packagedExpoCommand resolves Expo through the Node runtime and dependencies shipped in the app. */
export function packagedExpoCommand(
  options: Pick<StudioPackagedServiceOptions, 'runtimeToolchainRoot' | 'testNodePath'>,
): {
  argsPrefix: readonly string[]
  executable: string
} {
  return {
    argsPrefix: [FS.resolvePath('../../../node_modules/expo/bin/cli', options.runtimeToolchainRoot)],
    executable: options.testNodePath,
  }
}

/** Starts the repository Studio service from paths copied into an installed Electrobun app. */
export async function startStudioPackagedService(
  options: StudioPackagedServiceOptions,
  dependencies: StudioPackagedServiceDependencies = {},
): Promise<StartedStudioPackagedService> {
  let stopping = false
  let stopPromise: Promise<void> | undefined
  StudioClientAssets.usePrebuiltBundle(await FS.readText(options.studioClientBundlePath))
  const recentProjects = createRecentProjectStore(
    FS.resolvePath('recent-projects.json', options.userStateRoot),
  )
  const canvasViewportStore = new StudioCanvasViewportStore(FS.resolvePath('project-viewports', options.userStateRoot))
  const devDataServer = await (dependencies.startDevDataServer ?? DevDataServer.start)({
    rootDir: FS.resolvePath('dev-data', options.userStateRoot),
  })
  let manager: StudioSessionManager | undefined
  let trustStore: StudioDeviceTrustStore | undefined
  let deviceGateway: StudioDeviceGateway | undefined
  try {
    trustStore = await (dependencies.openTrustStore ?? StudioDeviceTrustStore.open)(
      FS.resolvePath('device-trust', options.userStateRoot),
    )
    deviceGateway = await (dependencies.startDeviceGateway ?? StudioDeviceGateway.start)({
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
  } catch (error) {
    return await rollbackPackagedStart(error, [() => trustStore?.flush(), () => devDataServer.stop()])
  }
  try {
    manager = new StudioSessionManager({
      onRecentProjectsChanged(recent) {
        void recentProjects.save(recent).catch(error =>
          HCI.writeErrorLine(`Could not save recent Tao Studio projects. ${Errors.formatForLog(error)}`)
        )
      },
      async openProject(request) {
        return await openStudioProjectResource(request, {
          devDataAuthority: { capability: devDataServer.capability, port: devDataServer.port },
          deviceGatewayPort: deviceGateway.port,
          entryPath: request.entryPath,
          expoCommand: packagedExpoCommand(options),
          isStopping: () => stopping,
          logRoot: FS.resolvePath('logs', options.userStateRoot),
          previewArtifactRoot: FS.resolvePath('preview', options.userStateRoot),
          runtimeToolchainRoot: options.runtimeToolchainRoot,
          testCommandArgs: projectRoot => [options.testCommandPath, projectRoot],
          testCommandEnv: {
            TAO_STDLIB_ROOT: options.stdlibRoot,
            TAO_TEST_IN_PROCESS: 'true',
            TAO_TEST_JEST_PATH: FS.resolvePath('../../../node_modules/jest/bin/jest.js', options.runtimeToolchainRoot),
            TAO_TEST_NODE_PATH: options.testNodePath,
            TAO_TEST_NODE_MODULES_ROOT: FS.resolvePath('../../../node_modules', options.runtimeToolchainRoot),
            TAO_TEST_RUNTIME_ROOT: options.runtimeToolchainRoot,
          },
          testCommandPath: options.testNodePath,
          stop(exitCode) {
            HCI.writeErrorLine(`Tao Studio preview exited unexpectedly (${exitCode}).`)
          },
          validationMode: 'release',
        })
      },
      recentProjects: await (dependencies.loadRecentProjects ?? (() => recentProjects.load()))(),
    })
  } catch (error) {
    return await rollbackPackagedStart(error, [
      () => deviceGateway.stop(),
      () => trustStore.flush(),
      () => devDataServer.stop(),
    ])
  }
  let server: Awaited<ReturnType<typeof startStudioSessionServer>>
  try {
    server = await (dependencies.startSessionServer ?? startStudioSessionServer)(manager, {
      canvasViewportStore,
      compileOnStart: false,
      deviceGateway,
      openBrowser: StudioBrowser.open,
    })
  } catch (error) {
    return await rollbackPackagedStart(error, [
      () => deviceGateway.stop(),
      () => trustStore.flush(),
      () => devDataServer.stop(),
    ])
  }
  return {
    devDataPort: devDataServer.port,
    deviceGatewayPort: deviceGateway.port,
    stop() {
      stopPromise ??= (async () => {
        stopping = true
        await cleanupPackagedService([
          () => server.stop(),
          () => manager.closeAll(),
          () => deviceGateway.stop(),
          () => trustStore.flush(),
          () => devDataServer.stop(),
          () => recentProjects.flush(),
          () => canvasViewportStore.flush(),
        ])
      })()
      return stopPromise
    },
    url: server.url,
  }
}

async function rollbackPackagedStart(
  startupError: unknown,
  cleanups: ReadonlyArray<() => unknown | Promise<unknown>>,
): Promise<never> {
  try {
    await cleanupPackagedService(cleanups)
  } catch (cleanupError) {
    HCI.writeErrorLine(`Packaged Studio startup cleanup also failed. ${Errors.formatForLog(cleanupError)}`)
  }
  throw startupError
}

async function cleanupPackagedService(cleanups: ReadonlyArray<() => unknown | Promise<unknown>>): Promise<void> {
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
