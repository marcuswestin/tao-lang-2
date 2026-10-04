/// <reference path="./better-opn.d.ts" />

import { CLI, Errors, Platform, ReleaseCapabilities, Repo, Time } from '@shared'
import type { DevLoopTargetReceipt } from '@shared/DevLoopControl'
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
import { type FixedIosLaunchOperations, runFixedIosLaunchCommand } from './fixedIosLaunchCommand'
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
  mobileDispatch: Map<string, NonNullable<DevLoopTargetReceipt['mobileDispatch']>>
  iosLaunch?: FixedIosLaunchOperations
}
export type DevStartupTarget = 'android' | 'ios' | 'web' | 'desktop'

/** createExpoTargets binds Expo runtime launchers to one Expo session. */
export function createExpoTargets(
  config: ExpoSessionConfig,
  metro: ExpoMetroSession,
  android: AndroidSession,
  operations: { startChrome?: typeof startAgentChrome; iosLaunch?: FixedIosLaunchOperations } = {},
) {
  const context: ExpoTargetContext = {
    android,
    config,
    metro,
    mobileDispatch: new Map(),
    iosLaunch: operations.iosLaunch,
  }
  let chromeLaunch: Promise<AgentChromeSession> | undefined
  const openSessionWeb = async (shouldStop: () => boolean = () => false): Promise<boolean> => {
    const url = context.metro.endpointUrl(await context.metro.expoOpenEndpoint('web')) ?? context.config.EXPO_ORIGIN
    if (shouldStop()) {
      return false
    }
    if (Platform.runtimeProcess.env['TAO_AGENT_BROWSER_QUIET'] !== '1') {
      return await openChromeWebUrl(context, url)
    }
    try {
      // This browser runs on the Metro host; use the same loopback origin the managed receipt records.
      const localUrl = context.config.EXPO_ORIGIN
      const visible = Platform.runtimeProcess.env['TAO_AGENT_BROWSER_VISIBLE'] === '1'
      chromeLaunch ??= (operations.startChrome ?? startAgentChrome)(localUrl, config.WEB_PROFILE_PARENT, visible)
      const chrome = await chromeLaunch
      DevLoopOutput.logDevLoop(
        'dev',
        `opened web in ${
          visible ? 'visible' : 'headless'
        } Chrome; DevTools http://127.0.0.1:${chrome.debugPort}; ${localUrl}`,
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
    openStartupTargets: async (requested?: readonly DevStartupTarget[], shouldStop?: () => boolean) => {
      const dispatch = await openStartupTargets(context, openSessionWeb, requested, shouldStop)
      const chrome = await chromeLaunch?.catch(() => undefined)
      return dispatch.map((result): DevLoopTargetReceipt => ({
        ...result,
        ...(result.dispatched && context.mobileDispatch.has(result.target)
          ? { mobileDispatch: context.mobileDispatch.get(result.target) }
          : {}),
        ...(result.target === 'web' && result.dispatched && chrome !== undefined
          ? {
            browser: {
              devToolsUrl: `http://127.0.0.1:${chrome.debugPort}`,
              profile: chrome.profile,
              process: chrome.process,
            },
          }
          : {}),
      }))
    },
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
  ReleaseCapabilities.require('android')
  try {
    await context.android.ensureEmulator()
    await context.android.ensureRuntime()
    return await openPreparedAndroidAndSay(context)
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
  ReleaseCapabilities.require('ios-simulator')
  const simulator = await ensureIosSimulator(context.config, shouldStop, context.iosLaunch)
  if (!simulator) {
    return false
  }
  if (shouldStop()) {
    return false
  }
  const inCompanion = ReleaseCapabilities.allows('companion')
    && await prepareCompanionOnSimulator(context, simulator, shouldStop)
  if (shouldStop()) {
    return false
  }
  let link = companionDevClientUrl({ host: '127.0.0.1', port: context.config.EXPO_PORT })
  if (!inCompanion) {
    const endpoint = await context.metro.expoOpenEndpoint('ios')
    if (shouldStop()) {
      return false
    }
    const endpointUrl = context.metro.endpointUrl(endpoint)
    if (endpointUrl !== undefined) {
      link = endpointUrl
    } else {
      const expoLink = await context.metro.expoLink('ios')
      if (shouldStop()) {
        return false
      }
      link = expoLink ?? context.config.EXPO_GO_URL
    }
  }
  if (shouldStop()) {
    return false
  }
  const result = await runFixedIosLaunchCommand(
    {
      stage: 'openurl',
      udid: simulator.udid,
      url: link,
      metroPort: context.config.EXPO_PORT,
    },
    shouldStop,
    context.iosLaunch,
  )
  if (shouldStop()) {
    return false
  }
  if (result.exitCode === 0 && result.error === undefined && result.signal === null) {
    context.mobileDispatch.set('ios', {
      kind: inCompanion ? 'companion' : 'expo-go',
      appId: inCompanion ? CompanionIdentity.bundleIdentifier : 'host.exp.Exponent',
      devUrl: link,
    })
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
async function prepareCompanionOnSimulator(
  context: ExpoTargetContext,
  simulator: IosSimulator,
  shouldStop: () => boolean,
): Promise<boolean> {
  try {
    return await prepareSimulatorCompanion(simulator.udid, simulator.name, {
      shouldStop,
      launchOperations: context.iosLaunch,
      findPrebuiltHost: async () => {
        const nativeKit = await nativeKitOf(Repo.resolvePath(context.config.RUNTIME_TOOLCHAIN_PATH))
        if (shouldStop()) {
          throw Errors.abortError('iOS Companion host lookup cancelled.')
        }
        return await obtainCompatibleHost('ios-simulator', nativeKit)
      },
    })
  } catch (error) {
    if (retainsIosTargetLease(error) || shouldStop() || Errors.asError(error).name === 'AbortError') {
      throw error
    }
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
  openWeb: (shouldStop?: () => boolean) => Promise<boolean>,
  requested: readonly DevStartupTarget[] = [],
  shouldStop: () => boolean = () => false,
): Promise<readonly { target: DevStartupTarget; dispatched: boolean }[]> {
  const openers = {
    web: () => openWeb(shouldStop),
    ios: () => openIosSimulator(context, shouldStop),
    android: () => openAvailableAndroid(context, shouldStop),
    desktop: async () => false,
  }
  return await Promise.all(requested.map(async target => {
    if (shouldStop()) {
      return { target, dispatched: false }
    }
    try {
      return { target, dispatched: await openers[target]() }
    } catch (error) {
      if (retainsIosTargetLease(error)) {
        throw error
      }
      if (shouldStop() || Errors.asError(error).name === 'AbortError') {
        return { target, dispatched: false }
      }
      DevLoopOutput.logDevLoop('dev', `skipped ${target} launch: ${Errors.formatForUser(error)}`, 'warn')
      return { target, dispatched: false }
    }
  }))
}

function retainsIosTargetLease(error: unknown): boolean {
  return error instanceof Errors.HostEnvironmentError && error.details?.['retainsTargetLease'] === true
}

/** openPreparedAndroid opens the current app in the runtime prepared on the Android emulator. */
async function openPreparedAndroid(context: ExpoTargetContext, url?: string): Promise<void> {
  ReleaseCapabilities.require('android')
  await context.android.openRuntime(url)
}

async function openAvailableAndroid(context: ExpoTargetContext, shouldStop: () => boolean): Promise<boolean> {
  if (await context.android.prepareAvailableRuntime()) {
    if (shouldStop()) {
      return false
    }
    return await openPreparedAndroidAndSay(context, shouldStop)
  }
  return false
}

async function openPreparedAndroidAndSay(
  context: ExpoTargetContext,
  shouldStop: () => boolean = () => false,
): Promise<boolean> {
  const endpoint = await context.metro.expoOpenEndpoint('android')
  if (shouldStop()) {
    return false
  }
  const runtime = await context.android.openRuntime(context.metro.endpointUrl(endpoint), shouldStop)
  if (runtime === undefined || shouldStop()) {
    return false
  }
  context.mobileDispatch.set('android', {
    kind: runtime,
    appId: runtime === 'companion' ? CompanionIdentity.androidPackage : 'host.exp.exponent',
    devUrl: runtime === 'companion'
      ? companionDevClientUrl({ host: '127.0.0.1', port: context.config.EXPO_PORT })
      : context.metro.endpointUrl(endpoint) ?? context.config.EXPO_GO_URL,
  })
  DevLoopOutput.logDevLoop(
    'dev',
    `opened Android${
      runtime === 'companion' ? ` (${CompanionIdentity.name})` : context.metro.formatOpenedRuntime(endpoint)
    }`,
  )
  return true
}

async function ensureIosSimulator(
  config: ExpoSessionConfig,
  shouldStop: () => boolean,
  operations?: FixedIosLaunchOperations,
): Promise<IosSimulator | undefined> {
  if (!await CLI.commandExists('xcrun')) {
    DevLoopOutput.logDevLoop('dev', 'xcrun not found; skipping iOS Simulator launch.')
    return undefined
  }
  if (shouldStop()) {
    return undefined
  }
  const simulator = await selectIosSimulator()
  if (shouldStop()) {
    return undefined
  }
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
  if (simulator.state !== 'Booted' && !await bootIosSimulator(simulator.udid, shouldStop, operations)) {
    return undefined
  }
  if (shouldStop()) {
    return undefined
  }
  if (!await waitForIosSimulatorBoot(config, simulator.udid, shouldStop)) {
    if (!shouldStop()) {
      DevLoopOutput.logDevLoop('dev', `iOS Simulator did not finish booting: ${simulator.name}`, 'warn')
    }
    return undefined
  }
  if (shouldStop()) {
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

async function bootIosSimulator(
  udid: string,
  shouldStop: () => boolean,
  operations?: FixedIosLaunchOperations,
): Promise<boolean> {
  DevLoopOutput.logDevLoop('dev', 'booting iOS Simulator')
  const result = await runFixedIosLaunchCommand({ stage: 'boot', udid }, shouldStop, operations)
  if (shouldStop()) {
    return false
  }
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
