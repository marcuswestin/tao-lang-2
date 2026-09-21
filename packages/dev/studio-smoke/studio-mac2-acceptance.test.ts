import { MachineResources } from '@host-control'
import {
  type AppiumPortReservation,
  type AppiumPortReservations,
  createStudioMac2AcceptanceFactory,
  type Mac2HostController,
  startAppiumServer,
} from '@host-control/appium'
import { CLI, Errors, FS, Platform, Repo } from '@shared'
import { Expect, Test } from '@shared/test'
import { StudioNative } from '../dev-src/studio/StudioNative'

const revision = { build: 'studio-mac2-acceptance-1', source: 'studio-mac2-smoke' }
const studioBundleIdentifier = 'dev.tao-lang.studio'

/**
 * This opt-in smoke opens the actual Studio native shell through a private Appium Mac2 home. It
 * deliberately retains the physical-input lease and server when remote deletion is ambiguous.
 */
Test('Studio Mac2 acceptance observes the launched native application and preserves its artifacts', async () => {
  const artifactRoot = Platform.runtimeProcess.env['TAO_STUDIO_SMOKE_ARTIFACT_ROOT']
    ?? FS.resolvePath('.artifacts/tests/studio-smoke/mac2-acceptance', Repo.getRoot())
  const appiumHome = FS.resolvePath('appium-mac2-home', artifactRoot)
  const studioPort = smokePort('TAO_STUDIO_SMOKE_SERVER_PORT', 42_020)
  const previewPort = smokePort('TAO_STUDIO_SMOKE_PREVIEW_PORT', 42_021)
  const studioServer = Bun.serve({
    fetch: () => new Response(studioFixture(), { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    hostname: '127.0.0.1',
    port: studioPort,
  })
  const previewServer = Bun.serve({
    fetch: () => new Response('<!doctype html><title>Studio Mac2 acceptance preview</title>'),
    hostname: '127.0.0.1',
    port: previewPort,
  })
  let native: Awaited<ReturnType<typeof StudioNative.start>> | undefined
  let controller: Mac2HostController | undefined
  let closeController: (() => Promise<void>) | undefined
  try {
    await provisionMac2DriverHome(appiumHome)
    const studioUrl = `http://127.0.0.1:${studioServer.port}`
    native = await StudioNative.start({
      artifactRoot: FS.resolvePath('electrobun', artifactRoot),
      nativeHostCommand: 'studio-mac2-acceptance-smoke',
      previewUrl: `http://127.0.0.1:${previewServer.port}`,
      projectUrl: `${studioUrl}/sessions/mac2-acceptance-fixture`,
      showWindow: true,
      studioUrl,
    })
    // Mac2 attaches only after the owned Electrobun renderer has published its ready transport.
    await native.hostControl()
    const serverLogPath = FS.resolvePath('appium-mac2/server.log', artifactRoot)
    const factory = createStudioMac2AcceptanceFactory({
      capabilities: {
        'appium:bundleId': studioBundleIdentifier,
        // Keep the WDA/Xcode diagnosis in the run log when macOS blocks a future attach.
        'appium:showServerLogs': true,
      },
      cleanupArtifacts: async () => {
        await FS.writeJson(FS.resolvePath('appium-mac2/cleanup.json', artifactRoot), {
          lifecycle: 'closed',
          version: 1,
        })
        await FS.remove(appiumHome)
      },
      driverHome: appiumHome,
      resolveTarget: target => {
        if (target.kind === 'scoped') {
          return Errors.throwUnexpected('Mac2 resolves scoped targets before requesting a leaf locator.')
        }
        return {
          using: target.kind === 'accessibility' ? 'accessibility id' : 'name',
          value: target.kind === 'accessibility' ? target.name : target.value,
        }
      },
      server: {
        command: appiumCommand(),
        environment: { ...Platform.runtimeProcess.env },
        reservations: appiumPortReservations('studio-mac2-acceptance'),
      },
      startServer: async options => {
        const server = await startAppiumServer(options)
        return {
          close: async () => {
            await FS.writeText(serverLogPath, server.logs())
            await server.close()
          },
          logs: server.logs,
          url: server.url,
        }
      },
    })
    controller = await native.mac2Acceptance(factory)
    closeController = async () => await controller!.close()
    const session = await controller.openSession({
      artifactRoot,
      mode: 'acceptance',
      revision,
      target: 'Tao Studio native shell',
    })
    const appState = await session.executeExternalUi({
      args: [{ bundleId: studioBundleIdentifier }],
      kind: 'executeScript',
      script: 'macos: queryAppState',
    })
    Expect(typeof appState).toBe('number')
    await FS.writeJson(FS.resolvePath('appium-mac2/app-state.json', artifactRoot), { appState, version: 1 })
    const screenshot = await session.captureScreenshot('studio-native-window')
    Expect(await FS.isFile(screenshot.artifactPath)).toBe(true)

    await session.close(session.descriptor().lease)
    await controller.close()
    closeController = undefined
    Expect(await FS.isFile(FS.resolvePath('appium-mac2/server.log', artifactRoot))).toBe(true)
    Expect(await FS.isFile(FS.resolvePath('appium-mac2/cleanup.json', artifactRoot))).toBe(true)
  } finally {
    await closeController?.()
    await native?.stop()
    studioServer.stop(true)
    previewServer.stop(true)
  }
}, 300_000)

async function provisionMac2DriverHome(home: string): Promise<void> {
  const source = await FS.realPath(Repo.resolvePath('packages/host-control-appium/node_modules/appium-mac2-driver'))
  const destination = FS.resolvePath('node_modules/appium-mac2-driver', home)
  await FS.mkdir(FS.dirname(destination))
  if (!await FS.exists(destination)) {
    await FS.symlink(source, destination)
  }
  await FS.writeJson(FS.resolvePath('package.json', home), {
    devDependencies: { 'appium-mac2-driver': `file:${source}` },
  })
  const listed = await CLI.mustRun(appiumCommand(), {
    args: ['driver', 'list', '--installed', '--json'],
    env: { ...Platform.runtimeProcess.env, APPIUM_HOME: home },
  })
  if (!listed.stdout.includes('mac2')) {
    Errors.throwHostEnvironment('The isolated Appium home did not discover its pinned Mac2 driver.', {
      details: { appiumHome: home, installed: listed.stdout },
    })
  }
}

function appiumCommand(): string {
  return Repo.resolvePath('packages/host-control-appium/node_modules/.bin/appium')
}

function appiumPortReservations(runId: string): AppiumPortReservations {
  return {
    async reserve(): Promise<AppiumPortReservation> {
      const first = 4723 + Number.parseInt(Platform.sha256Hex(runId).slice(0, 4), 16) % 1_000
      for (let offset = 0; offset < 1_000; offset += 1) {
        const port = 4723 + (first - 4723 + offset) % 1_000
        const lease = await MachineResources.tryAcquire({
          command: 'Studio Mac2 acceptance smoke',
          name: `appium-server-port-${port}`,
          repositoryRoot: Repo.getRoot(),
        })
        if (lease !== undefined) {
          return { port, release: async () => await lease.release() }
        }
      }
      return Errors.throwHostEnvironment('No Appium server port is available for the Studio Mac2 acceptance smoke.')
    },
  }
}

function smokePort(name: string, fallback: number): number {
  const value = Number(Platform.runtimeProcess.env[name] ?? fallback)
  if (Number.isInteger(value) && value > 0 && value <= 65_535) {
    return value
  }
  return Errors.throwUserInput(`${name} must be a valid TCP port.`)
}

function studioFixture(): string {
  return '<!doctype html><title>Studio Mac2 acceptance</title><main>Studio Mac2 acceptance fixture</main>'
}
