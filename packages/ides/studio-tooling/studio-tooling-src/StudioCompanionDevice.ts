import {
  companionAppProbeArgs,
  companionLaunchArgs,
  installedFromDevicectlApps,
} from '@expo-host/dev-loop/expo-runner/ios-companion'
import {
  type DevicectlFailure,
  type DevicectlList,
  type IosPhysicalDevice,
  iosPhysicalDevicesFromDevicectl,
  runDevicectlJson,
} from '@expo-host/dev-loop/expo-runner/physical-device'
import { CompanionIdentity } from '@expo-host/dev-loop/prebuilt-host/CompanionIdentity'
import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import type { StudioDeviceLaunchDiagnostic } from '@studio'

/**
 * Physical-device tooling for the Tao Companion development build: discovery, installed-app check,
 * launch with a payload URL, and the one-time `expo run:ios --no-bundler` install. Every failure is a
 * `HostEnvironmentError` whose `details.layer` names the failing layer so the launcher can present it.
 */

/** StudioDeviceFailureLayer is the layer vocabulary the Studio launcher seam shows a person. */
export type StudioDeviceFailureLayer = StudioDeviceLaunchDiagnostic['layer']

/** CompanionHost is one connected physical iPhone or iPad, as `devicectl` identifies it. */
export type CompanionHost = IosPhysicalDevice

/** CompanionInstallProbe says whether the companion bundle is on a device, or why devicectl could not tell. */
export type CompanionInstallProbe = {
  installed: boolean | undefined
  layer?: StudioDeviceFailureLayer
  problem?: string
}

/** StudioCompanionDeviceOptions injects paths and the process runner for tests. */
export type StudioCompanionDeviceOptions = {
  bundleIdentifier?: string
  packageRoot?: string
  repoRoot?: string
  run?: typeof CLI.run
  tmpRoot?: string
}

export type StudioCompanionDevice = ReturnType<typeof createStudioCompanionDevice>

const PROFILE_BIN_PATH = '.devenv/profile/bin'

/** createStudioCompanionDevice binds the companion identity and a process runner to the devicectl and Expo commands. */
export function createStudioCompanionDevice(options: StudioCompanionDeviceOptions = {}) {
  const run = options.run ?? CLI.run
  const bundleIdentifier = options.bundleIdentifier ?? CompanionIdentity.bundleIdentifier
  const repoRoot = () => options.repoRoot ?? Repo.getRoot()
  const packageRoot = () => options.packageRoot ?? FS.resolvePath(CompanionIdentity.packagePath, repoRoot())
  const devicectl = <T>(args: readonly string[]) => runDevicectlJson<T>(args, { run, tmpRoot: options.tmpRoot })

  async function listHosts(): Promise<CompanionHost[]> {
    const outcome = await devicectl<DevicectlList>(['list', 'devices'])
    if (outcome.failure !== undefined) {
      throwStudioDeviceFailure(
        devicectlFailureLayer(outcome.failure),
        describeDevicectlFailure('list the connected devices', outcome.failure),
        { details: outcome.failure },
      )
    }
    return iosPhysicalDevicesFromDevicectl(outcome.payload ?? {})
  }

  async function installedAppProbe(hostId: string): Promise<CompanionInstallProbe> {
    const outcome = await devicectl(companionAppProbeArgs(hostId, bundleIdentifier))
    if (outcome.failure !== undefined) {
      return {
        installed: undefined,
        layer: devicectlFailureLayer(outcome.failure),
        problem: describeDevicectlFailure('read the installed apps', outcome.failure),
      }
    }
    const installed = installedFromDevicectlApps(outcome.payload, bundleIdentifier)
    if (installed === undefined) {
      return { installed, layer: 'devicectl', problem: 'devicectl answered without an app list for this device.' }
    }
    return { installed }
  }

  async function open(input: { hostId: string; terminateExisting: boolean; url: string }): Promise<void> {
    const outcome = await devicectl(companionLaunchArgs({ ...input, bundleIdentifier }))
    if (outcome.failure !== undefined) {
      throwStudioDeviceFailure(
        devicectlFailureLayer(outcome.failure),
        describeDevicectlFailure(`open ${CompanionIdentity.name} at ${input.url}`, outcome.failure),
        { details: outcome.failure },
      )
    }
  }

  async function install(input: { deviceName: string }): Promise<void> {
    const root = packageRoot()
    if (!await FS.isDirectory(FS.resolvePath('node_modules/expo', root))) {
      throwStudioDeviceFailure(
        'expo',
        `${CompanionIdentity.name} dependencies are not installed under ${FS.displayPath(root)}. `
          + 'Run `./agent setup` at the repository root, then retry.',
      )
    }
    const args = companionInstallArgs(input.deviceName)
    const result = await run('bunx', {
      args,
      cwd: root,
      env: companionInstallEnv(Platform.runtimeProcess.env, repoRoot()),
      prefixedOutput: { processName: 'expo' },
    })
    if (result.error !== undefined) {
      throwStudioDeviceFailure(
        'expo',
        `Could not start \`bunx ${args.join(' ')}\`: ${result.error.message}. `
          + 'Bun and the repository devenv profile must be on PATH; run `./agent setup` and retry.',
        { cause: result.error },
      )
    }
    if (result.exitCode !== 0) {
      throwStudioDeviceFailure('expo', describeInstallFailure(input.deviceName, result), {
        details: { exitCode: result.exitCode, signal: result.signal },
      })
    }
  }

  return {
    bundleIdentifier,
    install,
    installedAppProbe,
    /** installedOn answers whether the companion bundle is on the device; undefined when devicectl cannot tell. */
    installedOn: async (hostId: string): Promise<boolean | undefined> => (await installedAppProbe(hostId)).installed,
    listHosts,
    open,
  }
}

/** companionInstallArgs is the one-time device install: Expo builds and installs, and never starts Metro. */
export function companionInstallArgs(deviceName: string): string[] {
  return ['expo', 'run:ios', '--device', deviceName, '--no-bundler']
}

/** companionInstallEnv makes Expo non-interactive and puts the devenv profile (CocoaPods) first on PATH. */
export function companionInstallEnv(baseEnv: Platform.ProcessEnv, repoRoot: string): Platform.ProcessEnv {
  const profileBin = FS.resolvePath(PROFILE_BIN_PATH, repoRoot)
  const currentPath = (baseEnv['PATH'] ?? '').split(':').filter(entry => entry.length > 0 && entry !== profileBin)
  return {
    ...baseEnv,
    CI: '1',
    EXPO_NO_TELEMETRY: '1',
    // CocoaPods reads paths as ASCII-8BIT without a UTF-8 locale and fails Unicode normalization.
    ...(baseEnv['LANG'] === undefined && baseEnv['LC_ALL'] === undefined ? { LANG: 'en_US.UTF-8' } : {}),
    PATH: [profileBin, ...currentPath].join(':'),
  }
}

/** companionInstallCommand is the command a person runs to put the shell on a device. */
export function companionInstallCommand(deviceName = '<name>'): string {
  return `just studio-companion-install device="${deviceName}"`
}

/** matchCompanionHost finds the device a person named: exact name, then case-insensitive name, then id. */
export function matchCompanionHost(hosts: readonly CompanionHost[], query: string): CompanionHost | undefined {
  const wanted = query.trim()
  const lowered = wanted.toLowerCase()
  return hosts.find(host => host.name === wanted)
    ?? hosts.find(host => host.name.toLowerCase() === lowered)
    ?? hosts.find(host => host.id === wanted)
}

/** devicectlFailureLayer sorts a devicectl failure into the layer a person must fix. */
export function devicectlFailureLayer(failure: DevicectlFailure): StudioDeviceFailureLayer {
  const message = failure.message.toLowerCase()
  if (message.includes('could not be established') || message.includes('transport error')) {
    return 'network'
  }
  if (
    message.includes('not paired')
    || message.includes('pairing')
    || message.includes('trust')
    || message.includes('locked')
    || message.includes('denied')
  ) {
    return 'permission'
  }
  return 'devicectl'
}

/** describeDevicectlFailure turns devicectl's report into one sentence with the next step. */
export function describeDevicectlFailure(action: string, failure: DevicectlFailure): string {
  const layer = devicectlFailureLayer(failure)
  const remedy = layer === 'network'
    ? 'The device is paired but unreachable: connect it with a cable or put it on the same Wi-Fi as this Mac, unlock it, and retry.'
    : layer === 'permission'
    ? 'Unlock the device, accept the trust prompt for this Mac, and pair it in Xcode > Window > Devices and Simulators.'
    : failure.message.includes('unable to find utility') || failure.message.includes('xcrun could not start')
    ? 'Install Xcode 26 and select it with `sudo xcode-select -s /Applications/Xcode.app`.'
    : failure.message.includes('CoreDeviceService')
    ? "Xcode's CoreDevice service did not answer: open Xcode once, or run this from a shell that can reach system services (a sandboxed shell cannot)."
    : 'Check the device in Xcode > Window > Devices and Simulators, then retry.'
  return `devicectl could not ${action}: ${failure.message} ${remedy}`
}

/** throwStudioDeviceFailure throws a host-environment error tagged with the layer the launcher reports. */
export function throwStudioDeviceFailure(
  layer: StudioDeviceFailureLayer,
  message: string,
  opts: { cause?: unknown; details?: Errors.ErrorDetails } = {},
): never {
  Errors.throwHostEnvironment(message, { cause: opts.cause, details: { ...opts.details, layer } })
}

/** studioDeviceFailureLayer reads the layer a `throwStudioDeviceFailure` error was tagged with. */
export function studioDeviceFailureLayer(error: unknown): StudioDeviceFailureLayer | undefined {
  if (!(error instanceof Errors.HostEnvironmentError)) {
    return undefined
  }
  const layer = error.details?.['layer']
  return layer === 'devicectl' || layer === 'expo' || layer === 'metro' || layer === 'network' || layer === 'permission'
    ? layer
    : undefined
}

/**
 * companionDeviceNameFromArgument reads the device name a person typed. `just` has no named
 * arguments, so `just studio-companion-install device="<name>"` hands the recipe the literal
 * `device=<name>`; the documented spelling and the bare `<name>` both name the same device.
 */
export function companionDeviceNameFromArgument(argument: string): string {
  return argument.trim().replace(/^device=/, '').trim()
}

/**
 * runStudioCompanionInstall is `./dev studio-companion-install`: confirm the named device is
 * connected, install the shell on it once, and say what to do next.
 */
export async function runStudioCompanionInstall(
  input: { deviceName: string },
  device: StudioCompanionDevice = createStudioCompanionDevice(),
): Promise<number> {
  const wanted = companionDeviceNameFromArgument(input.deviceName)
  if (wanted.length === 0) {
    Errors.throwUserInput(
      `Name the device to install on, as Finder and Xcode show it: ${companionInstallCommand()}`,
    )
  }
  const hosts = await device.listHosts()
  const host = matchCompanionHost(hosts, wanted)
  if (host === undefined) {
    if (hosts.length === 0) {
      throwStudioDeviceFailure(
        'devicectl',
        'No iPhone or iPad is connected to or paired with this Mac. Connect the device with a cable, unlock it, trust this Mac, then retry.',
      )
    }
    Errors.throwUserInput(
      `No connected iPhone or iPad is named "${wanted}". Connected: ${
        hosts.map(entry => `"${entry.name}"`).join(', ')
      }. `
        + `Retry with one of those: ${companionInstallCommand(hosts[0]?.name)}`,
    )
  }
  HCI.logProcessInfo(
    'companion',
    `Installing ${CompanionIdentity.name} on ${host.name} (${host.id}) with expo run:ios --no-bundler; Studio stays the only Metro.`,
  )
  await device.install({ deviceName: host.name })
  HCI.writeSuccess(`Installed ${CompanionIdentity.name} on ${host.name}.\n`)
  HCI.writeLine('Now run `just studio <project>` and press Open on device.')
  return 0
}

function describeInstallFailure(deviceName: string, result: CLI.CommandResult): string {
  const exit = result.signal !== null
    ? `was stopped by ${result.signal}`
    : `exited with code ${String(result.exitCode)}`
  return `expo run:ios ${exit} while installing ${CompanionIdentity.name} on "${deviceName}". `
    + 'Read the [expo] lines above for the Xcode or CocoaPods error. Common causes: the device is locked or has not trusted this Mac; '
    + `no development team is selected for the Xcode project under ${CompanionIdentity.packagePath}/ios (open it in Xcode once and pick one); `
    + `CocoaPods could not resolve pods (\`pod\` comes from ${PROFILE_BIN_PATH}, so run \`./agent setup\` if it is missing).`
}
