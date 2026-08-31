import { FS } from '@shared'
import { startStudioSessionServer, StudioClientAssets, StudioSessionManager } from '@studio'
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
  stop(): Promise<void>
  url: string
}

/** packagedExpoCommand resolves Expo through the Node runtime and dependencies shipped in the app. */
export function packagedExpoCommand(
  options: Pick<StudioPackagedServiceOptions, 'runtimeToolchainRoot' | 'testNodePath'>,
): {
  argsPrefix: readonly string[]
  executable: string
} {
  return {
    argsPrefix: [FS.resolvePath('../../node_modules/expo/bin/cli', options.runtimeToolchainRoot)],
    executable: options.testNodePath,
  }
}

/** Starts the repository Studio service from paths copied into an installed Electrobun app. */
export async function startStudioPackagedService(
  options: StudioPackagedServiceOptions,
): Promise<StartedStudioPackagedService> {
  let stopping = false
  let stopPromise: Promise<void> | undefined
  StudioClientAssets.usePrebuiltBundle(await FS.readText(options.studioClientBundlePath))
  const recentProjects = createRecentProjectStore(
    FS.resolvePath('recent-projects.json', options.userStateRoot),
  )
  const manager = new StudioSessionManager({
    onRecentProjectsChanged(recent) {
      void recentProjects.save(recent).catch(error =>
        console.error('Could not save recent Tao Studio projects.', error)
      )
    },
    async openProject(request) {
      return await openStudioProjectResource(request, {
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
          TAO_TEST_JEST_PATH: FS.resolvePath('../../node_modules/jest/bin/jest.js', options.runtimeToolchainRoot),
          TAO_TEST_NODE_PATH: options.testNodePath,
          TAO_TEST_NODE_MODULES_ROOT: FS.resolvePath('../../node_modules', options.runtimeToolchainRoot),
          TAO_TEST_RUNTIME_ROOT: options.runtimeToolchainRoot,
        },
        testCommandPath: options.testNodePath,
        stop(exitCode) {
          console.error(`Tao Studio preview exited unexpectedly (${exitCode}).`)
        },
        validationMode: 'release',
      })
    },
    recentProjects: await recentProjects.load(),
  })
  const server = await startStudioSessionServer(manager, { compileOnStart: false })
  return {
    stop() {
      stopPromise ??= (async () => {
        stopping = true
        server.stop()
        await manager.closeAll()
        await recentProjects.flush()
      })()
      return stopPromise
    },
    url: server.url,
  }
}
