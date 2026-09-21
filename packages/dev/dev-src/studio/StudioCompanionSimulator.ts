import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import { presentIosSimulator } from '../ios/IosSimulatorPresentation'
import {
  companionInstallArgs,
  companionInstallEnv,
  throwStudioDeviceFailure,
} from './StudioCompanionDevice'
import { StudioCompanionIdentity } from './StudioCompanionIdentity'

/**
 * iOS Simulator tooling for the Tao Companion development build. A simulator runs on this Mac, so
 * it needs no pairing, no unlocked screen, and no LAN address: it reaches Studio's Metro and device
 * gateway over loopback. `xcrun simctl` owns discovery, boot, the installed check, and the deep
 * link; the build is the same `expo run:ios` install the physical device uses, aimed at a UDID.
 */

/** CompanionSimulator is one available iOS simulator as `simctl` reports it. */
export type CompanionSimulator = {
  booted: boolean
  id: string
  name: string
  /** The runtime's readable name, e.g. `iOS 26.5`. */
  runtime: string
}

/** StudioCompanionSimulatorOptions injects paths and the process runner for tests. */
export type StudioCompanionSimulatorOptions = {
  bundleIdentifier?: string
  packageRoot?: string
  repoRoot?: string
  run?: typeof CLI.run
}

export type StudioCompanionSimulator = ReturnType<typeof createStudioCompanionSimulator>

type SimctlDeviceList = {
  devices?: Record<string, readonly SimctlDevice[]>
}

type SimctlDevice = {
  isAvailable?: unknown
  name?: unknown
  state?: unknown
  udid?: unknown
}

/** createStudioCompanionSimulator binds the companion identity and a process runner to the simctl commands. */
export function createStudioCompanionSimulator(options: StudioCompanionSimulatorOptions = {}) {
  const run = options.run ?? CLI.run
  const bundleIdentifier = options.bundleIdentifier ?? StudioCompanionIdentity.bundleIdentifier
  const repoRoot = () => options.repoRoot ?? Repo.getRoot()
  const packageRoot = () => options.packageRoot ?? FS.resolvePath(StudioCompanionIdentity.packagePath, repoRoot())

  const simctl = async (args: readonly string[]): Promise<CLI.CommandResult> => {
    const result = await run('xcrun', { args: ['simctl', ...args], stdio: 'pipe' })
    if (result.error !== undefined) {
      throwStudioDeviceFailure(
        'simulator',
        `Could not run \`xcrun simctl ${args.join(' ')}\`: ${result.error.message}. `
          + 'Xcode command line tools must be installed and selected.',
        { cause: result.error },
      )
    }
    return result
  }

  async function listSimulators(): Promise<CompanionSimulator[]> {
    const result = await simctl(['list', 'devices', 'available', '--json'])
    if (result.exitCode !== 0) {
      throwStudioDeviceFailure(
        'simulator',
        `Could not list the iOS simulators: ${result.stderr.trim() || `simctl exited ${result.exitCode}`}`,
      )
    }
    return simulatorsFromSimctl(result.stdout)
  }

  async function installedOn(id: string): Promise<boolean | undefined> {
    const result = await simctl(['get_app_container', id, bundleIdentifier, 'app'])
    if (result.exitCode === 0) {
      return true
    }
    // simctl says "No such file or directory" for an app it does not have, and something else for
    // a simulator it cannot read at all; only the first answer is a real "not installed".
    return /no such file or directory|not (?:installed|found)/i.test(result.stderr) ? false : undefined
  }

  async function boot(id: string): Promise<void> {
    const result = await simctl(['boot', id])
    if (result.exitCode === 0 || /current state: Booted/i.test(result.stderr)) {
      return
    }
    throwStudioDeviceFailure(
      'simulator',
      `Could not boot simulator ${id}: ${result.stderr.trim() || `simctl exited ${result.exitCode}`}`,
    )
  }

  /** show brings Simulator or Device Hub forward so a person watching sees the launch. */
  async function show(id?: string): Promise<void> {
    const presented = await presentIosSimulator(id, run)
    if (presented.result.exitCode !== 0 || presented.result.error !== undefined) {
      throwStudioDeviceFailure(
        'simulator',
        `Could not open ${presented.host}: ${
          presented.result.stderr.trim() || presented.result.error?.message || 'unknown error'
        }`,
        { cause: presented.result.error },
      )
    }
  }

  async function open(input: { id: string; url: string }): Promise<void> {
    await boot(input.id)
    const result = await simctl(['openurl', input.id, input.url])
    if (result.exitCode !== 0) {
      throwStudioDeviceFailure(
        'simulator',
        `Could not open ${StudioCompanionIdentity.name} at ${input.url} on simulator ${input.id}: ${
          result.stderr.trim() || `simctl exited ${result.exitCode}`
        }`,
      )
    }
    await show(input.id)
  }

  async function install(input: { id: string }): Promise<void> {
    const root = packageRoot()
    if (!await FS.isDirectory(FS.resolvePath('node_modules/expo', root))) {
      throwStudioDeviceFailure(
        'expo',
        `${StudioCompanionIdentity.name} dependencies are not installed under ${FS.displayPath(root)}. `
          + 'Run `./agent setup` at the repository root, then retry.',
      )
    }
    await boot(input.id)
    const args = companionInstallArgs(input.id)
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
      // Expo may finish a simulator run by asking System Events to bring Simulator or Device Hub
      // forward. That can fail without macOS automation permission after the app is installed, so
      // ask the simulator whether the app arrived rather than trusting the process exit code.
      if (await installedOn(input.id) === true) {
        HCI.logProcessInfo(
          'companion',
          `Expo exited ${result.exitCode} after installing; the app is on the simulator. `
            + 'The last step it tried was bringing the simulator host forward.',
        )
        return
      }
      throwStudioDeviceFailure(
        'expo',
        `Expo could not build and install ${StudioCompanionIdentity.name} on simulator ${input.id} `
          + `(exit ${result.exitCode}). The Expo output above names the failing step.`,
        { details: { exitCode: result.exitCode, signal: result.signal } },
      )
    }
  }

  return {
    boot,
    bundleIdentifier,
    install,
    installedOn,
    listSimulators,
    open,
    show,
  }
}

/** simulatorsFromSimctl reads `simctl list devices available --json`, keeping the iOS runtimes. */
export function simulatorsFromSimctl(stdout: string): CompanionSimulator[] {
  let payload: SimctlDeviceList
  try {
    payload = JSON.parse(stdout) as SimctlDeviceList
  } catch (error) {
    throwStudioDeviceFailure('simulator', 'simctl answered with something other than JSON.', { cause: error })
  }
  const simulators: CompanionSimulator[] = []
  for (const [runtime, devices] of Object.entries(payload.devices ?? {})) {
    const runtimeName = simulatorRuntimeName(runtime)
    if (runtimeName === undefined || !Array.isArray(devices)) {
      continue
    }
    for (const device of devices) {
      if (typeof device.udid !== 'string' || typeof device.name !== 'string' || device.isAvailable === false) {
        continue
      }
      simulators.push({
        booted: device.state === 'Booted',
        id: device.udid,
        name: device.name,
        runtime: runtimeName,
      })
    }
  }
  // A booted simulator is the one a person is already looking at, so it leads the list.
  return simulators.sort((left, right) =>
    left.booted === right.booted ? left.name.localeCompare(right.name) : left.booted ? -1 : 1
  )
}

/** simulatorRuntimeName turns `com.apple.CoreSimulator.SimRuntime.iOS-26-5` into `iOS 26.5`; other platforms are skipped. */
export function simulatorRuntimeName(identifier: string): string | undefined {
  const match = /SimRuntime\.iOS-(\d+)(?:-(\d+))?(?:-(\d+))?$/.exec(identifier)
  if (match === null) {
    return undefined
  }
  return `iOS ${[match[1], match[2], match[3]].filter(part => part !== undefined).join('.')}`
}

/** matchCompanionSimulator finds the simulator a person named: exact name, then case-insensitive, then UDID. */
export function matchCompanionSimulator(
  simulators: readonly CompanionSimulator[],
  query: string,
): CompanionSimulator | undefined {
  const wanted = query.trim()
  const lowered = wanted.toLowerCase()
  return simulators.find(simulator => simulator.name === wanted)
    ?? simulators.find(simulator => simulator.name.toLowerCase() === lowered)
    ?? simulators.find(simulator => simulator.id === wanted)
}

/** companionSimulatorInstallCommand is the command a person runs to put the shell on a simulator. */
export function companionSimulatorInstallCommand(name = '<name>'): string {
  return `just studio-companion-simulator simulator="${name}"`
}

/**
 * runStudioCompanionInstallOnSimulator is `./dev studio-companion-install --simulator`: pick the
 * named simulator, boot it, build the shell for it once, and say what to do next. A simulator needs
 * no pairing and no unlocked screen, so this is the install that works unattended.
 */
export async function runStudioCompanionInstallOnSimulator(
  input: { name: string },
  simulator: StudioCompanionSimulator = createStudioCompanionSimulator(),
): Promise<number> {
  const wanted = companionSimulatorNameFromArgument(input.name)
  const simulators = await simulator.listSimulators()
  const target = wanted.length === 0
    ? simulators.find(candidate => candidate.booted) ?? simulators[0]
    : matchCompanionSimulator(simulators, wanted)
  if (target === undefined) {
    throw noSimulatorError(wanted.length === 0 ? 'this Mac' : `"${wanted}"`, simulators)
  }
  HCI.logProcessInfo(
    'companion',
    `Installing ${StudioCompanionIdentity.name} on the ${target.name} simulator (${target.runtime}) `
      + 'with expo run:ios --no-bundler; Studio stays the only Metro.',
  )
  await simulator.install({ id: target.id })
  HCI.writeSuccess(`Installed ${StudioCompanionIdentity.name} on the ${target.name} simulator.\n`)
  HCI.writeLine('Now run `just studio <project>` and press Open on device.')
  return 0
}

/**
 * `just studio-companion-simulator simulator="iPhone 17 Pro"` passes the whole `simulator=…` word
 * through, so the tooling accepts that spelling as well as the bare name.
 */
export function companionSimulatorNameFromArgument(argument: string): string {
  const trimmed = argument.trim()
  return (trimmed.startsWith('simulator=') ? trimmed.slice('simulator='.length) : trimmed).trim()
}

/** noSimulatorError names the fix when nothing in the simulator list matches. */
function noSimulatorError(query: string, simulators: readonly CompanionSimulator[]): Errors.UserInputError {
  return new Errors.UserInputError([
    simulators.length === 0
      ? 'This Mac has no available iOS simulator. Install an iOS runtime in Xcode > Settings > Components, then retry.'
      : `No available iOS simulator matches ${query}.`,
    ...(simulators.length === 0 ? [] : [
      `Available: ${simulators.map(simulator => `${simulator.name} (${simulator.runtime})`).join(', ')}.`,
    ]),
  ].join('\n'))
}
