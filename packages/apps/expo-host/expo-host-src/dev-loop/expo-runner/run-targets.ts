/// <reference path="./better-opn.d.ts" />

import { CLI, Errors, Platform, Repo, Time } from '@shared'
import betterOpen from 'better-opn'
import { DevLoopOutput } from '../DevLoopOutput'
import { presentIosSimulator } from '../IosSimulatorPresentation'
import { companionDevClientUrl, CompanionIdentity } from '../prebuilt-host/CompanionIdentity'
import { nativeKitOf } from '../prebuilt-host/HostManifest'
import { obtainCompatibleHost } from '../prebuilt-host/PrebuiltHosts'
import { prepareSimulatorCompanion } from '../prebuilt-host/SimulatorCompanion'
import { type AgentChromeSession, startAgentChrome } from './AgentChrome'
import type { AndroidSession } from './android'
import { expoSdkMajor, type ExpoSessionConfig } from './expo-config'
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
export type DevStartupTarget = 'android' | 'ios' | 'web' | 'desktop'

/** createExpoTargets binds Expo runtime launchers to one Expo session. */
export function createExpoTargets(
  config: ExpoSessionConfig,
  metro: ExpoMetroSession,
  android: AndroidSession,
) {
  const context = { android, config, metro }
  let chromeLaunch: Promise<AgentChromeSession> | undefined
  const openSessionWeb = async (): Promise<boolean> => {
    const url = context.metro.endpointUrl(await context.metro.expoOpenEndpoint('web')) ?? context.config.EXPO_ORIGIN
    if (Platform.runtimeProcess.env['TAO_AGENT_BROWSER_QUIET'] !== '1') {
      return await openChromeWebUrl(context, url)
    }
    try {
      const visible = Platform.runtimeProcess.env['TAO_AGENT_BROWSER_VISIBLE'] === '1'
      chromeLaunch ??= startAgentChrome(url, config.WEB_PROFILE_PARENT, visible)
      const chrome = await chromeLaunch
      DevLoopOutput.logDevLoop(
        'dev',
        `opened web in ${
          visible ? 'visible' : 'headless'
        } Chrome; DevTools http://127.0.0.1:${chrome.debugPort}; ${url}`,
      )
      return true
    } catch (error) {
      chromeLaunch = undefined
      DevLoopOutput.logDevLoop('dev', `Could not open agent Chrome: ${Errors.formatForUser(error)}`, 'warn')
      DevLoopOutput.logDevLoop('dev', `Open ${url} manually.`, 'warn')
      return false
    }
  }
  return {
    openAndroid: () => openAndroid(context),
    openIosSimulator: (shouldStop?: () => boolean) => openIosSimulator(context, shouldStop),
    openPhysicalDevice: (device?: string, shouldStop?: () => boolean) =>
      openPhysicalDevice(config, metro, android, { device, shouldStop }),
    openPreparedAndroid: (url?: string) => openPreparedAndroid(context, url),
    openStartupTargets: (requested?: readonly DevStartupTarget[], shouldStop?: () => boolean) =>
      openStartupTargets(context, openSessionWeb, requested, shouldStop),
    openWeb: openSessionWeb,
    stopWeb: async () => {
      const launched = await chromeLaunch?.catch(() => undefined)
      chromeLaunch = undefined
      await launched?.stop()
    },
  }
}

/** openAndroid opens the current app on Android, launching an emulator and installing its runtime. */
async function openAndroid(context: ExpoTargetContext): Promise<boolean> {
  try {
    await context.android.ensureEmulator()
    await context.android.ensureRuntime()
    await openPreparedAndroidAndSay(context)
    return true
  } catch (error) {
    DevLoopOutput.logDevLoop('dev', `Could not open Android: ${Errors.formatForUser(error)}`, 'warn')
    return false
  }
}

/**
 * openIosSimulator opens the current app on an iOS Simulator, booting one when needed: in a
 * compatible prebuilt Companion when one is at hand, installed first if the simulator lacks that
 * build, and otherwise through Expo's own link, which Expo Go answers.
 */
async function openIosSimulator(
  context: ExpoTargetContext,
  shouldStop: () => boolean = () => false,
): Promise<boolean> {
  const simulator = await ensureIosSimulator(context.config, shouldStop)
  if (!simulator) {
    return false
  }
  if (shouldStop()) {
    return false
  }
  const inCompanion = await prepareCompanionOnSimulator(context, simulator)
  const link = inCompanion
    ? companionDevClientUrl({ host: '127.0.0.1', port: context.config.EXPO_PORT })
    : context.metro.endpointUrl(await context.metro.expoOpenEndpoint('ios'))
      ?? await context.metro.expoLink('ios')
      ?? context.config.EXPO_GO_URL
  const result = await CLI.run('xcrun', { args: ['simctl', 'openurl', simulator.udid, link] })
  if (result.exitCode === 0 && result.error === undefined) {
    DevLoopOutput.logDevLoop(
      'dev',
      `opened iOS Simulator (${simulator.name}${inCompanion ? `, ${CompanionIdentity.name}` : ''})`,
    )
    return true
  }
  DevLoopOutput.logDevLoop('dev', simulatorOpenFailure(simulator.name, link, result), 'warn')
  return false
}

/** A Companion that cannot be installed leaves the simulator on Expo Go, saying why, not the dev loop stopped. */
async function prepareCompanionOnSimulator(context: ExpoTargetContext, simulator: IosSimulator): Promise<boolean> {
  try {
    return await prepareSimulatorCompanion(simulator.udid, simulator.name, {
      findPrebuiltHost: async () =>
        await obtainCompatibleHost(
          'ios-simulator',
          await nativeKitOf(Repo.resolvePath(context.config.RUNTIME_TOOLCHAIN_PATH)),
        ),
    })
  } catch (error) {
    DevLoopOutput.logDevLoop(
      'dev',
      `Could not install ${CompanionIdentity.name} on ${simulator.name}; opening in Expo Go: ${
        Errors.formatForUser(error)
      }`,
      'warn',
    )
    return false
  }
}

/**
 * One calm line for a simulator that would not open the app.
 *
 * `simctl openurl` reports its refusal as a four-line LaunchServices dump whose only readable
 * sentence is the one naming the URL, and the dev loop printed all four in the colour it uses for
 * real breakage. The common cause has a remedy worth naming instead: LaunchServices error 115 is
 * "no installed application handles this URL", which on a simulator means no runtime for this SDK is
 * installed on it. Expo Go still serves a simulator — Expo publishes a build per SDK generation and
 * the account requirement its iPhone build carries does not apply there — but Tao never installs
 * one, so the remedy names the command that does.
 */
export function simulatorOpenFailure(
  simulatorName: string,
  link: string,
  result: { error?: { message: string }; stderr: string },
): string {
  const detail = result.stderr.trim() || result.error?.message || 'unknown error'
  const reason = /LSApplicationWorkspaceErrorDomain, code=115/.test(detail)
    ? `no app installed on it handles that URL — that simulator has no runtime for Expo SDK ${
      expoSdkMajor() ?? ''
    }; \`bunx expo start --ios\` in packages/apps/expo-host installs one`
    : detail.split('\n').map(line => line.trim()).filter(line => line.length > 0).at(-1) ?? 'unknown error'
  return `${simulatorName} did not open ${link}: ${reason}`
}

/** openStartupTargets opens startup targets while keeping Android limited to already-available devices. */
async function openStartupTargets(
  context: ExpoTargetContext,
  openWeb: () => Promise<boolean>,
  requested: readonly DevStartupTarget[] = [],
  shouldStop: () => boolean = () => false,
): Promise<void> {
  const openers = {
    web: openWeb,
    ios: () => openIosSimulator(context, shouldStop),
    android: () => openAvailableAndroid(context),
    desktop: async () => false,
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

/** openPreparedAndroid opens the current app in the runtime prepared on the Android emulator. */
async function openPreparedAndroid(context: ExpoTargetContext, url?: string): Promise<void> {
  await context.android.openRuntime(url)
}

async function openAvailableAndroid(context: ExpoTargetContext): Promise<boolean> {
  if (await context.android.prepareAvailableRuntime()) {
    await openPreparedAndroidAndSay(context)
    return true
  }
  return false
}

async function openPreparedAndroidAndSay(context: ExpoTargetContext): Promise<void> {
  const endpoint = await context.metro.expoOpenEndpoint('android')
  const runtime = await context.android.openRuntime(context.metro.endpointUrl(endpoint))
  DevLoopOutput.logDevLoop(
    'dev',
    `opened Android${
      runtime === 'companion' ? ` (${CompanionIdentity.name})` : context.metro.formatOpenedRuntime(endpoint)
    }`,
  )
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
  if (
    Platform.runtimeProcess.env['TAO_AGENT_SIMULATOR_QUIET'] !== '1'
    || Platform.runtimeProcess.env['TAO_AGENT_SIMULATOR_VISIBLE'] === '1'
  ) {
    await openSimulatorApp(simulator.udid)
  }
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
  if (Platform.runtimeProcess.env['TAO_AGENT_SIMULATOR_QUIET'] === '1') {
    const assigned = Platform.runtimeProcess.env['TAO_AGENT_SIMULATOR_UDID']
    if (!assigned) {
      DevLoopOutput.logDevLoop('dev', 'Restart app-dev with --ios to reserve an isolated simulator.', 'warn')
      return undefined
    }
    return simulators.find(simulator => simulator.udid === assigned)
  }
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
