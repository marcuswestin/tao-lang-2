import { CLI, Errors, FS, HCI, Json } from '@shared'
import { DevLoopOutput } from '../DevLoopOutput'
import { companionDevClientUrl, CompanionIdentity } from '../prebuilt-host/CompanionIdentity'
import { Android, type AndroidSession } from './android'
import { ExpoConfig, expoSdkMajor, type ExpoSessionConfig } from './expo-config'
import { companionAppProbeArgs, companionLaunchArgs, installedFromDevicectlApps } from './ios-companion'
import { detectLanIPv4 } from './lan-host'
import { ExpoMetro, type ExpoMetroSession } from './metro'

const taoSdkMajor = expoSdkMajor() ?? ''

/** DevicectlList is the `devicectl list devices` JSON shape this module reads. */
export type DevicectlList = {
  result?: {
    devices?: readonly DevicectlDevice[]
  }
}

type DevicectlDevice = {
  deviceProperties?: {
    name?: string
  }
  hardwareProperties?: {
    deviceType?: string
    reality?: string
    udid?: string
  }
  identifier?: string
}

/** DevicectlFailure is the `error` block `devicectl --json-output` writes when a command fails. */
export type DevicectlFailure = {
  code?: number
  domain?: string
  message: string
}

/** DevicectlJsonOutcome pairs a `devicectl` invocation with the JSON it wrote, when it wrote any. */
export type DevicectlJsonOutcome<T> = {
  /** Set when devicectl could not run or reported a failure; `payload` may still carry the raw report. */
  failure?: DevicectlFailure
  payload?: T
  result: CLI.CommandResult
}

/** DevicectlJsonOptions injects the process runner and temp root for tests. */
export type DevicectlJsonOptions = {
  run?: typeof CLI.run
  tmpRoot?: string
}

/** IosPhysicalDevice is one connected physical iPhone or iPad. */
export type IosPhysicalDevice = {
  id: string
  name: string
}

type PhysicalDeviceOptions = DevicectlJsonOptions & {
  device?: string
  detectLanHost?: typeof detectLanIPv4
  listIosDevices?: () => Promise<IosPhysicalDevice[]>
  selectDevice?: (choices: readonly { label: string; value: string }[]) => Promise<string>
  shouldStop?: () => boolean
}

/** expoGoUrl builds the Expo Go deep link for a reachable Metro host. */
export function expoGoUrl(host: string, port: number = ExpoConfig.EXPO_PORT): string {
  return `exp://${host}:${port}`
}

/** iosPhysicalDevicesFromDevicectl keeps physical iPhones and iPads from `devicectl` JSON. */
export function iosPhysicalDevicesFromDevicectl(payload: DevicectlList): IosPhysicalDevice[] {
  return (payload.result?.devices ?? []).flatMap(device => {
    const hardware = device.hardwareProperties
    // Xcode 26 devicectl omits `reality`; CoreDevice lists physical devices, so only an explicit
    // non-physical report (a simulator on older Xcode) is excluded.
    if (hardware === undefined || (hardware.reality !== undefined && hardware.reality !== 'physical')) {
      return []
    }
    if (hardware.deviceType !== 'iPhone' && hardware.deviceType !== 'iPad') {
      return []
    }
    const id = hardware.udid ?? device.identifier
    if (id === undefined) {
      return []
    }
    return [{ id, name: device.deviceProperties?.name ?? id }]
  })
}

/**
 * Opens an ordinary app in the installed iOS Companion or the prepared Android runtime.
 * An explicit name/ID never prompts or silently launches a different device.
 */
export async function openPhysicalDevice(
  config: ExpoSessionConfig = ExpoConfig,
  metro: ExpoMetroSession = ExpoMetro,
  android: AndroidSession = Android,
  dependencies: PhysicalDeviceOptions = {},
): Promise<boolean> {
  const shouldStop = dependencies.shouldStop ?? (() => false)
  if (shouldStop() || await metro.waitForMetro(shouldStop) === false || shouldStop()) {
    return false
  }
  const iosDevices = await (dependencies.listIosDevices ?? (() => listIosPhysicalDevices(dependencies)))()
  const androidSerials = await listAndroidPhysicalDevices(android)
  if (shouldStop()) {
    return false
  }
  if (dependencies.device === undefined && iosDevices.length === 0 && androidSerials.length === 0) {
    DevLoopOutput.logDevLoop(
      'dev',
      `No connected physical device. Connect and unlock an iPhone with Tao Companion installed, or an Android phone with a compatible Companion or SDK ${taoSdkMajor} Expo Go.`,
      'warn',
    )
    return false
  }

  const choices = [
    ...iosDevices.map(device => ({ ...device, label: `${device.name} (iOS)`, value: `ios:${device.id}` })),
    ...androidSerials.map(serial => ({
      id: serial,
      name: serial,
      label: `${serial} (Android)`,
      value: `android:${serial}`,
    })),
  ]
  const selected = dependencies.device !== undefined
    ? namedDevice(choices, dependencies.device)
    : choices.length === 1
    ? choices[0]!.value
    : await (dependencies.selectDevice ?? (choices =>
      HCI.askChoice({
        message: 'Choose a connected physical device',
        choices: [...choices],
      })))(choices)
  if (shouldStop()) {
    return false
  }
  const iosDevice = iosDevices.find(device => selected === `ios:${device.id}`)
  if (iosDevice !== undefined) {
    return await openIosPhone(config, iosDevice, dependencies)
  }
  const serial = androidSerials.find(candidate => selected === `android:${candidate}`)
  if (serial === undefined) {
    Errors.throwUserInput('The selected physical device is no longer connected.')
  }

  const host = await (dependencies.detectLanHost ?? detectLanIPv4)()
  if (shouldStop()) {
    return false
  }
  return await openAndroidPhone(config, android, serial, host, shouldStop)
}

function namedDevice(choices: readonly { id: string; name: string; value: string }[], query: string): string {
  const wanted = query.trim()
  if (wanted.length === 0) {
    Errors.throwUserInput('--device needs a physical device name or ID.')
  }
  const ids = choices.filter(choice => choice.id === wanted || choice.value === wanted)
  const exact = choices.filter(choice => choice.name === wanted)
  const matches = ids.length > 0
    ? ids
    : exact.length > 0
    ? exact
    : choices.filter(choice => choice.name.toLowerCase() === wanted.toLowerCase())
  if (matches.length === 0) {
    Errors.throwUserInput(
      `No connected device matches "${wanted}". Connect and unlock it, trust this Mac, and retry. `
        + `Connected: ${choices.map(choice => `${choice.name} (${choice.id})`).join(', ') || 'none'}.`,
    )
  }
  if (matches.length > 1) {
    Errors.throwUserInput(
      `More than one connected device is named "${wanted}". Use its ID: ${
        matches.map(device => device.id).join(', ')
      }.`,
    )
  }
  return matches[0]!.value
}

async function openIosPhone(
  config: ExpoSessionConfig,
  device: IosPhysicalDevice,
  options: PhysicalDeviceOptions,
): Promise<boolean> {
  try {
    const probe = await runDevicectlJson(companionAppProbeArgs(device.id, CompanionIdentity.bundleIdentifier), options)
    if (options.shouldStop?.()) {
      return false
    }
    if (probe.failure !== undefined) {
      Errors.throwHostEnvironment(probe.failure.message)
    }
    const installed = installedFromDevicectlApps(probe.payload, CompanionIdentity.bundleIdentifier)
    if (installed === undefined) {
      Errors.throwHostEnvironment('devicectl answered without an app list for this device.')
    }
    if (!installed) {
      Errors.throwHostEnvironment(
        `${CompanionIdentity.name} is not installed. From a Tao checkout, run \`./dev studio-companion-install --device '${
          device.name.replaceAll("'", "'\\''")
        }'\` once, then retry.`,
      )
    }
    const host = await (options.detectLanHost ?? detectLanIPv4)()
    if (options.shouldStop?.()) {
      return false
    }
    const result = await runDevicectlJson(
      companionLaunchArgs({
        bundleIdentifier: CompanionIdentity.bundleIdentifier,
        hostId: device.id,
        terminateExisting: true,
        url: companionDevClientUrl({ host, port: config.EXPO_PORT }),
      }),
      options,
    )
    if (result.failure !== undefined) {
      Errors.throwHostEnvironment(result.failure.message)
    }
    DevLoopOutput.logDevLoop('dev', `opened ${device.name} (${CompanionIdentity.name})`)
    return true
  } catch (error) {
    if (options.shouldStop?.()) {
      return false
    }
    DevLoopOutput.logDevLoop(
      'dev',
      `Could not open ${device.name}: ${
        Errors.formatForUser(error)
      } Unlock the phone, trust this Mac, and keep it on the same network.`,
      'warn',
    )
    return false
  }
}

/**
 * runDevicectlJson runs one `xcrun devicectl` command with `--json-output` into a temporary file and
 * returns the report it wrote. A failed command still returns; `failure` names what devicectl said.
 */
export async function runDevicectlJson<T = unknown>(
  args: readonly string[],
  options: DevicectlJsonOptions = {},
): Promise<DevicectlJsonOutcome<T>> {
  const run = options.run ?? CLI.run
  const outputPath = FS.resolvePath(
    `tao-devicectl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
    options.tmpRoot ?? FS.tmpdir(),
  )
  try {
    const result = await run('xcrun', { args: ['devicectl', ...args, '--json-output', outputPath] })
    const payload = await FS.exists(outputPath) ? parseDevicectlJson(await FS.readText(outputPath)) : undefined
    const failure = devicectlFailure(payload) ?? commandFailure(result)
    return { failure, payload: payload as T | undefined, result }
  } finally {
    if (await FS.exists(outputPath)) {
      await FS.remove(outputPath)
    }
  }
}

/** devicectlFailure reads the `error` block of a devicectl JSON report, when the report carries one. */
export function devicectlFailure(payload: unknown): DevicectlFailure | undefined {
  if (!Json.isRecord(payload) || !('error' in payload)) {
    return undefined
  }
  const error = payload['error']
  if (!Json.isRecord(error)) {
    return undefined
  }
  const record = error as { code?: unknown; domain?: unknown; userInfo?: unknown }
  const userInfo = Json.isRecord(record.userInfo)
    ? record.userInfo as { NSLocalizedDescription?: { string?: unknown } }
    : undefined
  const description = userInfo?.NSLocalizedDescription?.string
  return {
    code: typeof record.code === 'number' ? record.code : undefined,
    domain: typeof record.domain === 'string' ? record.domain : undefined,
    message: typeof description === 'string' && description.length > 0
      ? description
      : 'devicectl reported a failure without a description.',
  }
}

function commandFailure(result: CLI.CommandResult): DevicectlFailure | undefined {
  if (result.error === undefined && result.exitCode === 0) {
    return undefined
  }
  const stderr = result.stderr.trim()
  if (result.error !== undefined) {
    return { message: `xcrun could not start: ${result.error.message}` }
  }
  return {
    message: stderr.length > 0
      ? stderr.split('\n').at(-1) ?? stderr
      : `xcrun devicectl exited with code ${String(result.exitCode)}.`,
  }
}

async function listIosPhysicalDevices(options: DevicectlJsonOptions): Promise<IosPhysicalDevice[]> {
  const outcome = await runDevicectlJson<DevicectlList>(['list', 'devices'], options)
  if (outcome.failure !== undefined || outcome.payload === undefined) {
    return []
  }
  return iosPhysicalDevicesFromDevicectl(outcome.payload)
}

async function listAndroidPhysicalDevices(android: AndroidSession): Promise<string[]> {
  try {
    return await android.listPhysicalDevices()
  } catch (error) {
    if (error instanceof Errors.UserInputError) {
      DevLoopOutput.logDevLoop('dev', Errors.formatForUser(error), 'warn')
      return []
    }
    throw error
  }
}

/**
 * An Android phone opens the app in the runtime prepared for it, as an emulator does: a compatible
 * prebuilt Companion, or else Expo Go. Over USB, `adb reverse` gives the phone Metro on its own
 * loopback; when that fails, the phone has to reach Metro at the Mac's LAN address instead.
 */
async function openAndroidPhone(
  config: ExpoSessionConfig,
  android: AndroidSession,
  serial: string,
  lanHost: string,
  shouldStop: () => boolean,
): Promise<boolean> {
  const lanUrl = expoGoUrl(lanHost, config.EXPO_PORT)
  try {
    await android.prepareRuntimeOnSerial(serial)
    if (shouldStop()) {
      return false
    }
    const reversed = await android.reverseMetroPort(serial)
    if (shouldStop()) {
      return false
    }
    const runtime = await android.openRuntimeOnSerial(
      serial,
      reversed ? config.EXPO_GO_URL : lanUrl,
      reversed ? '127.0.0.1' : lanHost,
    )
    DevLoopOutput.logDevLoop('dev', `opened ${serial}${runtime === 'companion' ? ` (${CompanionIdentity.name})` : ''}`)
    return true
  } catch (error) {
    if (shouldStop()) {
      return false
    }
    DevLoopOutput.logDevLoop(
      'dev',
      `Could not open this app on ${serial}: ${Errors.formatForUser(error)}. Try ${lanUrl} in Expo Go.`,
      'warn',
    )
    return false
  }
}

function parseDevicectlJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
