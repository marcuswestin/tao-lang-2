import {
  createAppiumMac2HostController,
  type CreateAppiumMac2HostControllerOptions,
  type Mac2DesktopLeases,
  type Mac2HostController,
} from './AppiumMac2HostController'
import { type AppiumServer, startAppiumServer, type StartAppiumServerOptions } from './AppiumServer'
import { type AppiumCapabilities, createAppiumHttpTransport, createAppiumWebDriverClient } from './AppiumWebDriver'

export type StudioMac2AcceptanceTarget = Readonly<{ appId: string }>

/** StudioMac2AcceptanceFactory starts isolated Appium ownership for one Studio acceptance target. */
export type StudioMac2AcceptanceFactory = (target: StudioMac2AcceptanceTarget) => Promise<Mac2HostController>

export type CreateStudioMac2AcceptanceFactoryOptions = Readonly<{
  /** Runs only after the remote driver and owned Appium server have both closed. */
  cleanupArtifacts?: () => Promise<void>
  capabilities?: AppiumCapabilities
  desktopLeases?: Mac2DesktopLeases
  /** A pre-provisioned Mac2 driver home. This factory never installs or mutates driver homes. */
  driverHome?: string
  resolveTarget: CreateAppiumMac2HostControllerOptions['resolveTarget']
  server: StartAppiumServerOptions
  startServer?: typeof startAppiumServer
}>

export type CreateStudioMac2AcceptanceControllerOptions =
  & CreateStudioMac2AcceptanceFactoryOptions
  & Readonly<{
    target: StudioMac2AcceptanceTarget
  }>

/**
 * createStudioMac2AcceptanceFactory composes a local Appium server, W3C transport, and Mac2
 * controller. The caller provides an already-provisioned driver home through driverHome or the
 * server environment; no test-run installation or shared driver state is hidden here.
 */
export function createStudioMac2AcceptanceFactory(
  options: CreateStudioMac2AcceptanceFactoryOptions,
): StudioMac2AcceptanceFactory {
  return async target => await createStudioMac2AcceptanceController({ ...options, target })
}

/** createStudioMac2AcceptanceController creates one owned Studio Mac2 acceptance lifecycle. */
export async function createStudioMac2AcceptanceController(
  options: CreateStudioMac2AcceptanceControllerOptions,
): Promise<Mac2HostController> {
  const server = await (options.startServer ?? startAppiumServer)(serverOptions(options))
  const controller = createAppiumMac2HostController({
    capabilities: options.capabilities ?? {},
    client: createAppiumWebDriverClient(createAppiumHttpTransport({
      ...(options.server.fetch === undefined ? {} : { fetch: options.server.fetch }),
      serverUrl: server.url,
    })),
    ...(options.desktopLeases === undefined ? {} : { desktopLeases: options.desktopLeases }),
    resolveTarget: options.resolveTarget,
    target: options.target,
  })
  return new OwnedStudioMac2AcceptanceController(controller, server, options.cleanupArtifacts)
}

class OwnedStudioMac2AcceptanceController implements Mac2HostController {
  readonly #artifacts?: () => Promise<void>
  #closed = false
  #closePromise: Promise<void> | undefined
  readonly #controller: Mac2HostController
  readonly #server: AppiumServer

  constructor(controller: Mac2HostController, server: AppiumServer, artifacts?: () => Promise<void>) {
    this.#artifacts = artifacts
    this.#controller = controller
    this.#server = server
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return
    }
    if (this.#closePromise === undefined) {
      this.#closePromise = this.#closeOwnedResources().finally(() => {
        if (!this.#closed) {
          this.#closePromise = undefined
        }
      })
    }
    await this.#closePromise
  }

  async openSession(options: Parameters<Mac2HostController['openSession']>[0]) {
    return await this.#controller.openSession(options)
  }

  async #closeOwnedResources(): Promise<void> {
    await this.#controller.close()
    await this.#server.close()
    await this.#artifacts?.()
    this.#closed = true
  }
}

function serverOptions(options: CreateStudioMac2AcceptanceFactoryOptions): StartAppiumServerOptions {
  if (options.driverHome === undefined) {
    return options.server
  }
  return {
    ...options.server,
    environment: { ...options.server.environment, APPIUM_HOME: options.driverHome },
  }
}
