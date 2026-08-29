import { CLI, Errors, FS } from '@shared'
import { DevLoopTUI } from '../DevLoopTUI'
import { Android } from './android'
import { ExpoConfig } from './expo-config'
import { detectLanIPv4 } from './lan-host'
import { ExpoMetro } from './metro'

const EXPO_GO_IOS_BUNDLE_ID = 'host.exp.Exponent'

type DevicectlList = {
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

/** IosPhysicalDevice is one connected physical iPhone or iPad. */
export type IosPhysicalDevice = {
  id: string
  name: string
}

/** expoGoUrl builds the Expo Go deep link for a reachable Metro host. */
export function expoGoUrl(host: string): string {
  return `exp://${host}:${ExpoConfig.EXPO_PORT}`
}

/** iosPhysicalDevicesFromDevicectl keeps physical iPhones and iPads from `devicectl` JSON. */
export function iosPhysicalDevicesFromDevicectl(payload: DevicectlList): IosPhysicalDevice[] {
  return (payload.result?.devices ?? []).flatMap(device => {
    const hardware = device.hardwareProperties
    if (hardware?.reality !== 'physical') {
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

/** openPhysicalDevice installs or opens Expo Go on every connected phone. */
export async function openPhysicalDevice(): Promise<boolean> {
  await ExpoMetro.waitForMetro()
  const host = await detectLanIPv4()
  const lanUrl = expoGoUrl(host)
  const iosDevices = await listIosPhysicalDevices()
  const androidSerials = await listAndroidPhysicalDevices()
  if (iosDevices.length === 0 && androidSerials.length === 0) {
    DevLoopTUI.logDevLoop(
      'dev',
      `No connected physical device. Install Expo Go, then open ${lanUrl} on the phone.`,
      'warn',
    )
    return false
  }

  const opened = [
    ...await Promise.all(iosDevices.map(device => openIosExpoGo(device, lanUrl))),
    ...await Promise.all(androidSerials.map(serial => openAndroidExpoGo(serial, lanUrl))),
  ]
  return opened.some(Boolean)
}

async function listIosPhysicalDevices(): Promise<IosPhysicalDevice[]> {
  const outputPath = FS.resolvePath(`tao-devicectl-${Date.now()}.json`, FS.tmpdir())
  try {
    const result = await CLI.run('xcrun', {
      args: ['devicectl', 'list', 'devices', '--json-output', outputPath],
    })
    if (result.error !== undefined || result.exitCode !== 0 || !await FS.exists(outputPath)) {
      return []
    }
    return iosPhysicalDevicesFromDevicectl(parseDevicectlJson(await FS.readText(outputPath)))
  } finally {
    if (await FS.exists(outputPath)) {
      await FS.remove(outputPath)
    }
  }
}

async function listAndroidPhysicalDevices(): Promise<string[]> {
  try {
    return await Android.listPhysicalDevices()
  } catch (error) {
    if (error instanceof Errors.UserInputError) {
      DevLoopTUI.logDevLoop('dev', Errors.formatForUser(error), 'warn')
      return []
    }
    throw error
  }
}

async function openIosExpoGo(device: IosPhysicalDevice, url: string): Promise<boolean> {
  const result = await CLI.run('xcrun', {
    args: [
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      device.id,
      '--payload-url',
      url,
      EXPO_GO_IOS_BUNDLE_ID,
    ],
  })
  if (result.error !== undefined || result.exitCode !== 0) {
    DevLoopTUI.logDevLoop(
      'dev',
      `Could not open Expo Go on ${device.name}. Install Expo Go from the App Store, then open ${url}.`,
      'warn',
    )
    return false
  }
  DevLoopTUI.logDevLoop('dev', `opened Expo Go on ${device.name} at ${url}`)
  return true
}

async function openAndroidExpoGo(serial: string, lanUrl: string): Promise<boolean> {
  try {
    await Android.ensureExpoGoOnSerial(serial)
    const reversed = await Android.reverseMetroPort(serial)
    const url = reversed ? ExpoConfig.EXPO_GO_URL : lanUrl
    await Android.openExpoGoOnSerial(serial, url)
    return true
  } catch (error) {
    DevLoopTUI.logDevLoop(
      'dev',
      `Could not open Expo Go on ${serial}: ${Errors.formatForUser(error)}. Try ${lanUrl} in Expo Go.`,
      'warn',
    )
    return false
  }
}

function parseDevicectlJson(text: string): DevicectlList {
  try {
    return JSON.parse(text) as DevicectlList
  } catch {
    return {}
  }
}
