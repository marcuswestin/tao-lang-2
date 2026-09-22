/// <reference path="./better-opn.d.ts" />

import { CLI, Errors, Platform, Time } from '@shared'
import betterOpen from 'better-opn'
import { DevLoopOutput } from '../DevLoopOutput'
import { presentIosSimulator } from '../IosSimulatorPresentation'
import type { AndroidSession } from './android'
import type { ExpoSessionConfig } from './expo-config'
import type { ExpoMetroSession } from './metro'
import { openPhysicalDevice } from './physical-device'

type IosSimulator = {
  name: string
  runtime?: string
  state?: string
  udid: string
}

type SimctlDevicesJson = {
  devices?: Record<string, IosSimulator[]>
}

type ExpoTargetContext = {
  android: AndroidSession
  config: ExpoSessionConfig
  metro: ExpoMetroSession
}
export type DevStartupTarget = 'android' | 'ios' | 'web'

/** createExpoTargets binds Expo runtime launchers to one Expo session. */
export function createExpoTargets(
  config: ExpoSessionConfig,
  metro: ExpoMetroSession,
  android: AndroidSession,
) {
  const context = { android, config, metro }
  return {
    openAndroid: () => openAndroid(context),
    openIosSimulator: (shouldStop?: () => boolean) => openIosSimulator(context, shouldStop),
    openPhysicalDevice: () => openPhysicalDevice(config, metro, android),
    openPreparedAndroid: (url?: string) => openPreparedAndroid(context, url),
    openStartupTargets: (requested?: readonly DevStartupTarget[], shouldStop?: () => boolean) =>
      openStartupTargets(context, requested, shouldStop),
    openWeb: () => openWeb(context),
  }
}

/** openAndroid asks Expo to open the current app on Android, launching an emulator when Expo can. */
async function openAndroid(context: ExpoTargetContext): Promise<boolean> {
  try {
    await context.android.ensureEmulator()
    await context.android.ensureExpoGo()
    const endpoint = await context.metro.expoOpenEndpoint('android')
    await openPreparedAndroid(context, context.metro.endpointUrl(endpoint))
    DevLoopOutput.logDevLoop('dev', `opened Android${context.metro.formatOpenedRuntime(endpoint)}`)
    return true
  } catch (error) {
    DevLoopOutput.logDevLoop('dev', `Could not open Android: ${Errors.formatForUser(error)}`, 'warn')
    return false
  }
}

/** openWeb opens the current Expo app in a browser. */
async function openWeb(context: ExpoTargetContext): Promise<boolean> {
  return await openChromeWebUrl(
    context,
    context.metro.endpointUrl(await context.metro.expoOpenEndpoint('web')) ?? context.config.EXPO_ORIGIN,
  )
}

/** openIosSimulator asks Expo to open the current app on iOS, launching a simulator when Expo can. */
async function openIosSimulator(
  context: ExpoTargetContext,
  shouldStop: () => boolean = () => false,
): Promise<boolean> {
  const link = context.metro.endpointUrl(await context.metro.expoOpenEndpoint('ios'))
    ?? await context.metro.expoLink('ios')
    ?? context.config.EXPO_GO_URL
  const simulator = await ensureIosSimulator(context.config, shouldStop)
  if (!simulator) {
    return false
  }
  if (shouldStop()) {
    return false
  }
  const result = await CLI.run('xcrun', { args: ['simctl', 'openurl', simulator.udid, link] })
  if (result.exitCode === 0 && result.error === undefined) {
    DevLoopOutput.logDevLoop('dev', `opened iOS Simulator (${simulator.name})`)
    return true
  }
  DevLoopOutput.logDevLoop('dev', simulatorOpenFailure(simulator.name, link, result), 'warn')
  return false
}

/**
 * One calm line for a simulator that would not open the app.
 *
 * `simctl openurl` reports its refusal as a four-line LaunchServices dump whose only readable
 * sentence is the one naming the URL, and the dev loop printed all four in the colour it uses for
 * real breakage. The common cause has a remedy worth naming instead: LaunchServices error 115 is
 * "no installed application handles this URL", which on a simulator means the development build or
 * Expo Go is not installed on it.
 */
export function simulatorOpenFailure(
  simulatorName: string,
  link: string,
  result: { error?: { message: string }; stderr: string },
): string {
  const detail = result.stderr.trim() || result.error?.message || 'unknown error'
  const reason = /LSApplicationWorkspaceErrorDomain, code=115/.test(detail)
    ? 'no app installed on it handles that URL — install the development build or Expo Go there first'
    : detail.split('\n').map(line => line.trim()).filter(line => line.length > 0).at(-1) ?? 'unknown error'
  return `${simulatorName} did not open ${link}: ${reason}`
}

/** openStartupTargets opens startup targets while keeping Android limited to already-available devices. */
async function openStartupTargets(
  context: ExpoTargetContext,
  requested: readonly DevStartupTarget[] = [],
  shouldStop: () => boolean = () => false,
): Promise<void> {
  const openers = {
    web: () => openWeb(context),
    ios: () => openIosSimulator(context, shouldStop),
    android: () => openAvailableAndroid(context),
  }
  await Promise.all(requested.map(async target => {
    if (shouldStop()) {
      return
    }
    try {
      await openers[target]()
    } catch (error) {
      DevLoopOutput.logDevLoop('dev', `skipped ${target} launch: ${Errors.formatForUser(error)}`, 'warn')
    }
  }))
}

/** openPreparedAndroid opens the current Expo app on a prepared Android emulator. */
async function openPreparedAndroid(context: ExpoTargetContext, url?: string): Promise<void> {
  await context.android.openExpoGo(url)
}

async function openAvailableAndroid(context: ExpoTargetContext): Promise<boolean> {
  if (await context.android.prepareAvailableExpoGo()) {
    const endpoint = await context.metro.expoOpenEndpoint('android')
    await openPreparedAndroid(context, context.metro.endpointUrl(endpoint))
    DevLoopOutput.logDevLoop('dev', `opened Android${context.metro.formatOpenedRuntime(endpoint)}`)
    return true
  }
  return false
}

async function ensureIosSimulator(
  config: ExpoSessionConfig,
  shouldStop: () => boolean,
): Promise<IosSimulator | undefined> {
  if (!await CLI.commandExists('xcrun')) {
    DevLoopOutput.logDevLoop('dev', 'xcrun not found; skipping iOS Simulator launch.')
    return undefined
  }
  if (shouldStop()) {
    return undefined
  }
  const simulator = await selectIosSimulator()
  if (!simulator) {
    DevLoopOutput.logDevLoop('dev', 'No available iOS Simulator found.', 'warn')
    return undefined
  }
  await openSimulatorApp(simulator.udid)
  if (shouldStop()) {
    return undefined
  }
  if (simulator.state !== 'Booted' && !await bootIosSimulator(simulator.udid)) {
    return undefined
  }
  if (!await waitForIosSimulatorBoot(config, simulator.udid, shouldStop)) {
    if (!shouldStop()) {
      DevLoopOutput.logDevLoop('dev', `iOS Simulator did not finish booting: ${simulator.name}`, 'warn')
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
    DevLoopOutput.logDevLoop(
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
  if (!await CLI.commandExists('open')) {
    return
  }
  const { host, result } = await presentIosSimulator(udid)
  if (result.exitCode !== 0 || result.error !== undefined) {
    DevLoopOutput.logDevLoop(
      'dev',
      `Could not open ${host}: ${result.stderr.trim() || result.error?.message || 'unknown error'}`,
      'warn',
    )
  }
}

async function bootIosSimulator(udid: string): Promise<boolean> {
  DevLoopOutput.logDevLoop('dev', 'booting iOS Simulator')
  const result = await CLI.run('xcrun', { args: ['simctl', 'boot', udid] })
  if (
    result.exitCode === 0
    || result.stderr.includes('Unable to boot device in current state: Booted')
  ) {
    return true
  }
  DevLoopOutput.logDevLoop(
    'dev',
    `Could not boot iOS Simulator: ${result.stderr.trim() || result.error?.message || 'unknown error'}`,
    'warn',
  )
  return false
}

async function waitForIosSimulatorBoot(
  config: ExpoSessionConfig,
  udid: string,
  shouldStop: () => boolean,
): Promise<boolean> {
  const booted = await Time.pollUntil(
    async () => (await listIosSimulators()).some(simulator => simulator.udid === udid && simulator.state === 'Booted'),
    { intervalMs: config.IOS_BOOT_POLL_MS, stop: shouldStop, timeoutMs: config.IOS_BOOT_TIMEOUT_MS },
  )
  return booted === true
}

function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

async function openChromeWebUrl(context: ExpoTargetContext, url: string): Promise<boolean> {
  try {
    await withChromeOpenEnv(context.config, () => betterOpen(url))
    DevLoopOutput.logDevLoop('dev', `opened web in ${context.config.WEB_BROWSER_APP_NAME}`)
    return true
  } catch (error) {
    DevLoopOutput.logDevLoop(
      'dev',
      `Could not open web in ${context.config.WEB_BROWSER_APP_NAME}: ${Errors.formatForUser(error)}`,
      'warn',
    )
    DevLoopOutput.logDevLoop('dev', `Open ${url} manually.`, 'warn')
    return false
  }
}

async function withChromeOpenEnv(
  config: ExpoSessionConfig,
  fn: () => Promise<unknown> | unknown,
): Promise<void> {
  const env = Platform.runtimeProcess.env
  const previousBrowser = env['BROWSER']
  const previousOpenMatchHostOnly = env['OPEN_MATCH_HOST_ONLY']
  try {
    env['BROWSER'] = config.WEB_BROWSER_APP_NAME
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
