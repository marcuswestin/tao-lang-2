/// <reference path="./better-opn.d.ts" />

import { CLI, Errors, Platform, Time } from '@shared'
import betterOpen from 'better-opn'
import { TUI } from '../TUI'
import { Android } from './android'
import { ExpoConfig } from './expo-config'
import { ExpoMetro } from './metro'

type IosSimulator = {
  name: string
  runtime?: string
  state?: string
  udid: string
}

type SimctlDevicesJson = {
  devices?: Record<string, IosSimulator[]>
}

/** ExpoTargets opens Expo runtimes on supported local targets. */
export const ExpoTargets = {
  openAndroid,
  openIosSimulator,
  openPreparedAndroid,
  openStartupTargets,
  openWeb,
}

/** openAndroid asks Expo to open the current app on Android, launching an emulator when Expo can. */
async function openAndroid(): Promise<boolean> {
  try {
    await Android.ensureEmulator()
    await Android.ensureExpoGo()
    const endpoint = await ExpoMetro.expoOpenEndpoint('android')
    await openPreparedAndroid(ExpoMetro.endpointUrl(endpoint))
    TUI.logDevLoop('dev', `opened Android${ExpoMetro.formatOpenedRuntime(endpoint)}`)
    return true
  } catch (error) {
    TUI.logDevLoop('dev', `Could not open Android: ${Errors.formatForUser(error)}`, 'warn')
    return false
  }
}

/** openWeb opens the current Expo app in a browser. */
async function openWeb(): Promise<boolean> {
  return await openChromeWebUrl(
    ExpoMetro.endpointUrl(await ExpoMetro.expoOpenEndpoint('web')) ?? ExpoConfig.EXPO_ORIGIN,
  )
}

/** openIosSimulator asks Expo to open the current app on iOS, launching a simulator when Expo can. */
async function openIosSimulator(shouldStop: () => boolean = () => false): Promise<boolean> {
  const link = ExpoMetro.endpointUrl(await ExpoMetro.expoOpenEndpoint('ios'))
    ?? await ExpoMetro.expoLink('ios')
    ?? ExpoConfig.EXPO_GO_URL
  const simulator = await ensureIosSimulator(shouldStop)
  if (!simulator) {
    return false
  }
  if (shouldStop()) {
    return false
  }
  const result = await CLI.run('xcrun', { args: ['simctl', 'openurl', simulator.udid, link] })
  if (result.exitCode === 0 && result.error === undefined) {
    TUI.logDevLoop('dev', `opened iOS Simulator (${simulator.name})`)
    return true
  }
  TUI.logDevLoop(
    'dev',
    `Could not open iOS Simulator URL: ${result.stderr.trim() || result.error?.message || 'unknown error'}`,
    'warn',
  )
  return false
}

/** openStartupTargets opens startup targets while keeping Android limited to already-available devices. */
async function openStartupTargets(shouldStop: () => boolean = () => false): Promise<void> {
  await Promise.all(([
    ['web', openWeb],
    ['iOS', () => openIosSimulator(shouldStop)],
    ['Android', openAvailableAndroid],
  ] as const).map(async ([label, open]) => {
    if (shouldStop()) {
      return
    }
    try {
      await open()
    } catch (error) {
      TUI.logDevLoop('dev', `skipped ${label} launch: ${Errors.formatForUser(error)}`, 'warn')
    }
  }))
}

/** openPreparedAndroid opens the current Expo app on a prepared Android emulator. */
async function openPreparedAndroid(url?: string): Promise<void> {
  await Android.openExpoGo(url)
}

async function openAvailableAndroid(): Promise<boolean> {
  if (await Android.prepareAvailableExpoGo()) {
    const endpoint = await ExpoMetro.expoOpenEndpoint('android')
    await openPreparedAndroid(ExpoMetro.endpointUrl(endpoint))
    TUI.logDevLoop('dev', `opened Android${ExpoMetro.formatOpenedRuntime(endpoint)}`)
    return true
  }
  return false
}

async function commandExists(command: string): Promise<boolean> {
  const result = await CLI.run('sh', { args: ['-c', `command -v ${command}`] })
  return result.exitCode === 0 && result.error === undefined
}

async function ensureIosSimulator(shouldStop: () => boolean): Promise<IosSimulator | undefined> {
  if (!await commandExists('xcrun')) {
    TUI.logDevLoop('dev', 'xcrun not found; skipping iOS Simulator launch.')
    return undefined
  }
  if (shouldStop()) {
    return undefined
  }
  const simulator = await selectIosSimulator()
  if (!simulator) {
    TUI.logDevLoop('dev', 'No available iOS Simulator found.', 'warn')
    return undefined
  }
  await openSimulatorApp(simulator.udid)
  if (shouldStop()) {
    return undefined
  }
  if (simulator.state !== 'Booted' && !await bootIosSimulator(simulator.udid)) {
    return undefined
  }
  if (!await waitForIosSimulatorBoot(simulator.udid, shouldStop)) {
    if (!shouldStop()) {
      TUI.logDevLoop('dev', `iOS Simulator did not finish booting: ${simulator.name}`, 'warn')
    }
    return undefined
  }
  return simulator
}

async function selectIosSimulator(): Promise<IosSimulator | undefined> {
  const simulators = await listIosSimulators()
  const bootedSimulator = simulators.find(simulator => simulator.state === 'Booted')
  if (bootedSimulator) {
    return bootedSimulator
  }

  const defaultUdid = await defaultIosSimulatorUdid()
  return simulators.find(simulator => simulator.udid === defaultUdid) ?? simulators[0]
}

async function listIosSimulators(): Promise<IosSimulator[]> {
  const result = await CLI.run('xcrun', { args: ['simctl', 'list', 'devices', '--json', 'available'] })
  if (result.exitCode !== 0 || result.error !== undefined) {
    TUI.logDevLoop(
      'dev',
      `Could not list iOS Simulators: ${result.stderr.trim() || result.error?.message || 'unknown error'}`,
      'warn',
    )
    return []
  }
  const parsed = parseJson<SimctlDevicesJson>(result.stdout)
  return Object.entries(parsed?.devices ?? {})
    .filter(([runtime]) => runtime.includes('.iOS-'))
    .flatMap(([runtime, devices]) => devices.map(device => ({ ...device, runtime })))
    .filter(device => device.udid && device.name)
}

async function defaultIosSimulatorUdid(): Promise<string | undefined> {
  const result = await CLI.run('defaults', { args: ['read', 'com.apple.iphonesimulator', 'CurrentDeviceUDID'] })
  return result.exitCode === 0 && result.error === undefined ? result.stdout.trim() || undefined : undefined
}

async function openSimulatorApp(udid: string): Promise<void> {
  if (!await commandExists('open')) {
    return
  }
  const result = await CLI.run('open', { args: ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', udid] })
  if (result.exitCode !== 0 || result.error !== undefined) {
    TUI.logDevLoop(
      'dev',
      `Could not open Simulator app: ${result.stderr.trim() || result.error?.message || 'unknown error'}`,
      'warn',
    )
  }
}

async function bootIosSimulator(udid: string): Promise<boolean> {
  TUI.logDevLoop('dev', 'booting iOS Simulator')
  const result = await CLI.run('xcrun', { args: ['simctl', 'boot', udid] })
  if (
    result.exitCode === 0
    || result.stderr.includes('Unable to boot device in current state: Booted')
  ) {
    return true
  }
  TUI.logDevLoop(
    'dev',
    `Could not boot iOS Simulator: ${result.stderr.trim() || result.error?.message || 'unknown error'}`,
    'warn',
  )
  return false
}

async function waitForIosSimulatorBoot(udid: string, shouldStop: () => boolean): Promise<boolean> {
  const deadline = Date.now() + ExpoConfig.IOS_BOOT_TIMEOUT_MS
  while (!shouldStop() && Date.now() < deadline) {
    const booted = (await listIosSimulators()).find(simulator =>
      simulator.udid === udid && simulator.state === 'Booted'
    )
    if (booted) {
      return true
    }
    await Time.sleep(ExpoConfig.IOS_BOOT_POLL_MS)
  }
  return false
}

function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

async function openChromeWebUrl(url: string): Promise<boolean> {
  try {
    await withChromeOpenEnv(() => betterOpen(url))
    TUI.logDevLoop('dev', `opened web in ${ExpoConfig.WEB_BROWSER_APP_NAME}`)
    return true
  } catch (error) {
    TUI.logDevLoop(
      'dev',
      `Could not open web in ${ExpoConfig.WEB_BROWSER_APP_NAME}: ${Errors.formatForUser(error)}`,
      'warn',
    )
    TUI.logDevLoop('dev', `Open ${url} manually.`, 'warn')
    return false
  }
}

async function withChromeOpenEnv(fn: () => Promise<unknown> | unknown): Promise<void> {
  const env = Platform.runtimeProcess.env
  const previousBrowser = env['BROWSER']
  const previousOpenMatchHostOnly = env['OPEN_MATCH_HOST_ONLY']
  try {
    env['BROWSER'] = ExpoConfig.WEB_BROWSER_APP_NAME
    env['OPEN_MATCH_HOST_ONLY'] = 'true'
    await fn()
  } finally {
    restoreEnv('BROWSER', previousBrowser)
    restoreEnv('OPEN_MATCH_HOST_ONLY', previousOpenMatchHostOnly)
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete Platform.runtimeProcess.env[key]
  } else {
    Platform.runtimeProcess.env[key] = value
  }
}
