import { CLI, Errors, FS, HCI, Json } from '@shared'
import { DevLoopOutput } from '../DevLoopOutput'
import { Android, type AndroidSession } from './android'
import { ExpoConfig, expoSdkMajor, type ExpoSessionConfig } from './expo-config'
import { detectLanIPv4 } from './lan-host'
import { ExpoMetro, type ExpoMetroSession } from './metro'

const taoSdkMajor = expoSdkMajor() ?? ''
/**
 * The command that puts a Tao runtime on a physical iPhone or iPad today. `StudioCompanionDevice.ts`
 * owns this spelling for Studio's own surfaces, so the sentences below repeat the words rather than
 * importing them back through a cycle.
 */
const COMPANION_INSTALL_COMMAND = 'just studio-companion-install'

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

export type PhysicalDeviceDependencies = {
  detectLanHost?: typeof detectLanIPv4
  listIosDevices?: () => Promise<IosPhysicalDevice[]>
  selectDevice?: (choices: readonly { label: string; value: string }[]) => Promise<string>
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
 * physicalIosUnsupportedMessage explains why `tao dev` refuses a physical iPhone or iPad and names
 * the loop that does reach one. Expo Go is not a lane Tao can restore here: since 2026-09-03 its
 * iPhone build requires an Expo account signed in on the device *and* in the terminal serving the
 * bundle, and `expo-config.ts` deliberately gives Metro a repository-local Expo home, so a
 * developer's own `expo login` is invisible to it.
 */
export function physicalIosUnsupportedMessage(device: IosPhysicalDevice): string {
  return `Cannot open this Tao app on ${device.name}: Expo Go on iPhone now requires an Expo account signed in both on the phone and in the terminal running Metro, and Tao runs Metro under its own Expo home, so that sign-in never reaches it. Run this app on ${device.name} through the Tao Companion development build instead: \`${COMPANION_INSTALL_COMMAND} device="${device.name}"\` once from a Tao checkout with Xcode, then open the app from Tao Studio's Device popover.`
}

/** openPhysicalDevice opens compatible Android phones and truthfully rejects generic physical iOS. */
export async function openPhysicalDevice(
  config: ExpoSessionConfig = ExpoConfig,
  metro: ExpoMetroSession = ExpoMetro,
  android: AndroidSession = Android,
  dependencies: PhysicalDeviceDependencies = {},
): Promise<boolean> {
  await metro.waitForMetro()
  const iosDevices = await (dependencies.listIosDevices ?? listIosPhysicalDevices)()
  const androidSerials = await listAndroidPhysicalDevices(android)
  if (iosDevices.length === 0 && androidSerials.length === 0) {
    DevLoopOutput.logDevLoop(
      'dev',
      `No connected physical device. Connect an Android phone — this loop sideloads the SDK ${taoSdkMajor} Expo Go onto it — or use an iOS Simulator. A physical iPhone or iPad runs a Tao app through the Tao Companion development build (\`${COMPANION_INSTALL_COMMAND}\`), not through Expo Go.`,
      'warn',
    )
    return false
  }

  const choices = [
    ...iosDevices.map(device => ({ label: `${device.name} (iOS)`, value: `ios:${device.id}` })),
    ...androidSerials.map(serial => ({ label: `${serial} (Android)`, value: `android:${serial}` })),
  ]
  const selected = choices.length === 1
    ? choices[0]!.value
    : await (dependencies.selectDevice ?? (choices =>
      HCI.askChoice({
        message: 'Choose a connected physical device',
        choices: [...choices],
      })))(choices)
  const iosDevice = iosDevices.find(device => selected === `ios:${device.id}`)
  if (iosDevice !== undefined) {
    DevLoopOutput.logDevLoop('dev', physicalIosUnsupportedMessage(iosDevice), 'warn')
    return false
  }
  const serial = androidSerials.find(candidate => selected === `android:${candidate}`)
  if (serial === undefined) {
    Errors.throwUserInput('The selected physical device is no longer connected.')
  }

  const host = await (dependencies.detectLanHost ?? detectLanIPv4)()
  const lanUrl = expoGoUrl(host, config.EXPO_PORT)
  return await openAndroidExpoGo(config, android, serial, lanUrl)
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

async function listIosPhysicalDevices(): Promise<IosPhysicalDevice[]> {
  const outcome = await runDevicectlJson<DevicectlList>(['list', 'devices'])
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

async function openAndroidExpoGo(
  config: ExpoSessionConfig,
  android: AndroidSession,
  serial: string,
  lanUrl: string,
): Promise<boolean> {
  try {
    await android.ensureExpoGoOnSerial(serial)
    const reversed = await android.reverseMetroPort(serial)
    const url = reversed ? config.EXPO_GO_URL : lanUrl
    await android.openExpoGoOnSerial(serial, url)
    return true
  } catch (error) {
    DevLoopOutput.logDevLoop(
      'dev',
      `Could not open Expo Go on ${serial}: ${Errors.formatForUser(error)}. Try ${lanUrl} in Expo Go.`,
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
