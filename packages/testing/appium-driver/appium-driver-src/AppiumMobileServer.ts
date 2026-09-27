import { type MachineResourceLease, MachineResources } from '@host-control'
import { CLI, Errors, FS, Json, Platform, Repo } from '@shared'
import {
  type AppiumPortReservation,
  type AppiumPortReservations,
  type AppiumServer,
  startAppiumServer,
} from './AppiumServer'

/** Starts a pinned mobile driver in an owned Appium home with an isolated server port. */
export async function startMobileAppiumServer(options: {
  artifactRoot: string
  driver: 'uiautomator2' | 'xcuitest'
  quiet?: boolean
  runId: string
}): Promise<AppiumServer> {
  await ensureAppiumDriver(options.driver, options.artifactRoot)
  return await startAppiumServer({
    command: appiumCommand(),
    environment: mobileAppiumEnvironment(options.artifactRoot),
    reservations: appiumPortReservations(options.runId),
    quiet: options.quiet,
  })
}

async function ensureAppiumDriver(driver: 'uiautomator2' | 'xcuitest', artifactRoot: string): Promise<void> {
  const command = appiumCommand()
  const environment = mobileAppiumEnvironment(artifactRoot)
  const home = environment['APPIUM_HOME']!
  const packageName = `appium-${driver}-driver`
  const source = await FS.realPath(Repo.resolvePath(`packages/testing/appium-driver/node_modules/${packageName}`))
  const destination = FS.resolvePath(`node_modules/${packageName}`, home)
  await FS.mkdir(FS.dirname(destination))
  if (!await FS.exists(destination)) {
    await FS.symlink(source, destination)
  }
  await FS.writeJson(FS.resolvePath('package.json', home), {
    devDependencies: { [packageName]: `file:${source}` },
  })
  const listed = await CLI.mustRun(command, { args: ['driver', 'list', '--installed', '--json'], env: environment })
  const installed = Json.tryParse(listed.stdout)
  if (typeof installed === 'object' && installed !== null && driver in installed) {
    return
  }
  Errors.throwHostEnvironment(`The isolated Appium home did not discover its pinned ${driver} driver.`, {
    details: { appiumHome: home, installed },
  })
}

function appiumCommand(): string {
  return Repo.resolvePath('packages/testing/appium-driver/node_modules/.bin/appium')
}

/** Explicit undefined overrides prevent Platform's inherited environment merge from restoring Clerk credentials. */
export function mobileAppiumEnvironment(
  artifactRoot: string,
  environment: Readonly<Record<string, string | undefined>> = Platform.runtimeProcess.env,
): Record<string, string | undefined> {
  return {
    // Platform merges child overrides with the parent environment, so omitted keys would leak.
    ...Object.fromEntries(
      Object.entries(environment).map(([key, value]) => [key, key.startsWith('CLERK_') ? undefined : value]),
    ),
    APPIUM_HOME: FS.resolvePath('appium-home', artifactRoot),
  }
}

function appiumPortReservations(runId: string): AppiumPortReservations {
  return {
    async reserve(): Promise<AppiumPortReservation> {
      const first = 4723 + Number.parseInt(Platform.sha256Hex(runId).slice(0, 4), 16) % 1_000
      for (let offset = 0; offset < 1_000; offset += 1) {
        const port = 4723 + (first - 4723 + offset) % 1_000
        const lease = await MachineResources.tryAcquire({
          command: `Appium server for host test ${runId}`,
          name: `appium-server-port-${port}`,
          repositoryRoot: Repo.getRoot(),
        })
        if (lease !== undefined) {
          return portReservation(port, lease)
        }
      }
      return Errors.throwHostEnvironment('No Appium server port could be reserved.')
    },
  }
}

function portReservation(port: number, lease: MachineResourceLease): AppiumPortReservation {
  return { port, release: async () => await lease.release() }
}
