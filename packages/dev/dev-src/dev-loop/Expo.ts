import { CLI, Errors, FS, HCI, Platform } from '@shared'
import betterOpen from 'better-opn'
import { Android } from '../android'
import { Ports } from './Ports'

type ExpoPlatform = 'android' | 'ios' | 'web'

const EXPO_PORT = 8081
const EXPO_ORIGIN = `http://127.0.0.1:${EXPO_PORT}`
const EXPO_STATUS_URL = `${EXPO_ORIGIN}/status`
const EXPO_OPEN_URL = `${EXPO_ORIGIN}/_expo/open`
const EXPO_GO_URL = `exp://127.0.0.1:${EXPO_PORT}`
const EXPO_START_ARGS = [
  'expo',
  'start',
  '--localhost',
  '--port',
  EXPO_PORT.toString(),
]
const EXPO_START_TIMEOUT_MS = 60_000
const EXPO_START_POLL_MS = 1_000
const EXPO_STOP_TIMEOUT_MS = 3_000
const IOS_BOOT_TIMEOUT_MS = 120_000
const IOS_BOOT_POLL_MS = 1_000
const WEB_BROWSER_APP_NAME = 'Google Chrome'

/** ExpoServer owns the Expo CLI process and its log output. */
export class ExpoServer {
  private child?: CLI.StartedCommand
  private closeOutputAndLogPromise?: Promise<void>
  private logFile?: FS.FileHandle
  private unexpectedExit?: () => void
  private stopping = false

  constructor(private readonly runtimeRoot: string) {}

  onUnexpectedExit(listener: () => void): void {
    this.unexpectedExit = listener
  }

  async start(): Promise<void> {
    const logPath = FS.repoPath('.artifacts/dev/expo.log')
    await FS.mkdir(FS.dirname(logPath))
    this.logFile = await FS.openAppend(logPath)
    this.child = CLI.start('bunx', {
      args: EXPO_START_ARGS,
      cwd: this.runtimeRoot,
      env: {
        BROWSER: WEB_BROWSER_APP_NAME,
        EXPO_NO_TELEMETRY: '1',
        OPEN_MATCH_HOST_ONLY: 'true',
      },
      prefixedOutput: { logFile: this.logFile, processName: 'expo' },
    })
    this.child.onceClose((exitCode, signal) => {
      void this.closeOutputAndLog()
      if (!this.stopping) {
        HCI.logProcessWarn('dev', `Expo exited with code=${exitCode} signal=${signal}. See ${logPath}.`)
        this.unexpectedExit?.()
      }
    })
    this.child.onceError(error => {
      HCI.logProcessError('dev', `Failed to start Expo: ${error.message}`)
    })
    HCI.logProcessInfo('dev', `Expo log: ${logPath}`)
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) {
      await this.closeLogFile()
      return
    }
    this.stopping = true
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      await Promise.race([child.waitForClose(), sleep(EXPO_STOP_TIMEOUT_MS)])
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
        await child.waitForClose()
      }
    }
    await this.closeOutputAndLog()
  }

  private async closeOutputAndLog(): Promise<void> {
    this.closeOutputAndLogPromise ??= this.closeOutputAndLogOnce()
    return this.closeOutputAndLogPromise
  }

  private async closeOutputAndLogOnce(): Promise<void> {
    await this.child?.closeOutput()
    await this.closeLogFile()
  }

  private async closeLogFile(): Promise<void> {
    const logFile = this.logFile
    this.logFile = undefined
    await logFile?.close()
  }
}

/** Expo groups runtime control helpers for the dev loop. */
export const Expo = {
  ensureMetroPortFree,
  openAndroid,
  openIosSimulator,
  openStartupTargets,
  openWeb,
  reloadExpoApps,
  waitForMetro,
}

/** openAndroid asks Expo to open the current app on Android, launching an emulator when Expo can. */
async function openAndroid(): Promise<boolean> {
  try {
    await Android.ensureEmulator()
    await Android.ensureExpoGo()
    const endpoint = await expoOpenEndpoint('android')
    await openPreparedAndroid(endpointUrl(endpoint))
    HCI.logProcessInfo('dev', `opened Android${formatOpenedRuntime(endpoint)}`)
    return true
  } catch (error) {
    HCI.logProcessWarn('dev', `Could not open Android: ${Errors.formatForUser(error)}`)
    return false
  }
}

/** openAvailableAndroid opens the current Expo app on an already-booted Android emulator. */
async function openAvailableAndroid(): Promise<boolean> {
  if (await Android.prepareAvailableExpoGo()) {
    const endpoint = await expoOpenEndpoint('android')
    await openPreparedAndroid(endpointUrl(endpoint))
    HCI.logProcessInfo('dev', `opened Android${formatOpenedRuntime(endpoint)}`)
    return true
  }
  return false
}

/** openWeb opens the current Expo app in a browser. */
async function openWeb(): Promise<boolean> {
  return await openChromeWebUrl(endpointUrl(await expoOpenEndpoint('web')) ?? EXPO_ORIGIN)
}

/** openIosSimulator asks Expo to open the current app on iOS, launching a simulator when Expo can. */
async function openIosSimulator(shouldStop: () => boolean = () => false): Promise<boolean> {
  const link = endpointUrl(await expoOpenEndpoint('ios')) ?? await expoLink('ios') ?? EXPO_GO_URL
  const simulator = await ensureIosSimulator(shouldStop)
  if (!simulator) {
    return false
  }
  if (shouldStop()) {
    return false
  }
  const result = await CLI.run('xcrun', { args: ['simctl', 'openurl', simulator.udid, link] })
  if (result.exitCode === 0 && result.error === undefined) {
    HCI.logProcessInfo('dev', `opened iOS Simulator (${simulator.name})`)
    return true
  }
  HCI.logProcessWarn(
    'dev',
    `Could not open iOS Simulator URL: ${result.stderr.trim() || result.error?.message || 'unknown error'}`,
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
      HCI.logProcessWarn('dev', `skipped ${label} launch: ${Errors.formatForUser(error)}`)
    }
  }))
}

/** reloadExpoApps asks Metro to reload connected Expo runtimes. */
async function reloadExpoApps(): Promise<void> {
  await waitForMetro()
  const response = await fetch(`${EXPO_ORIGIN}/message?method=reload`)
  if (response.ok) {
    HCI.logProcessInfo('dev', 'sent Expo reload')
  } else {
    HCI.logProcessWarn('dev', `Expo reload failed: ${response.status} ${await response.text()}`)
  }
}

/** ensureMetroPortFree fails when another Metro server already owns the dev-loop port. */
async function ensureMetroPortFree(): Promise<void> {
  if (await Ports.ensureFree(EXPO_PORT)) {
    return
  }

  try {
    const response = await fetch(EXPO_STATUS_URL)
    Errors.throwUserInput(
      `Expo Metro already appears to be running at ${EXPO_STATUS_URL} with status ${response.status}. Stop it before starting ./dev.`,
    )
  } catch (error) {
    if (error instanceof Errors.UserInputError) {
      throw error
    }
  }
}

/** waitForMetro waits until the Expo Metro status endpoint is ready. */
async function waitForMetro(shouldStop: () => boolean = () => false): Promise<boolean> {
  const deadline = Date.now() + EXPO_START_TIMEOUT_MS
  while (!shouldStop() && Date.now() < deadline) {
    try {
      const response = await fetch(EXPO_STATUS_URL)
      if (response.ok && (await response.text()).includes('running')) {
        return true
      }
    } catch {
      // Metro is still starting.
    }
    await sleep(EXPO_START_POLL_MS)
  }
  if (shouldStop()) {
    return false
  }
  Errors.throwUserInput(`Expo Metro did not start at ${EXPO_STATUS_URL}.`)
}

async function openPreparedAndroid(url?: string): Promise<void> {
  await Android.openExpo(url)
}

async function commandExists(command: string): Promise<boolean> {
  const result = await CLI.run('sh', { args: ['-c', `command -v ${command}`] })
  return result.exitCode === 0 && result.error === undefined
}

async function expoOpenEndpoint(platform: ExpoPlatform): Promise<OpenEndpointResponse | undefined> {
  const url = `${EXPO_OPEN_URL}?platform=${platform}`
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Origin: EXPO_ORIGIN },
    })
    const responseText = await response.text()
    const body = parseResponseJson(response.headers.get('content-type'), responseText)
    if (response.ok && isOpenEndpointResponse(body)) {
      return body
    }

    if (!response.ok && response.status !== 404) {
      HCI.logProcessWarn('dev', `could not resolve Expo URL for ${platform}: ${response.status} ${responseText}`)
    }
  } catch (error) {
    HCI.logProcessWarn('dev', `could not resolve Expo URL for ${platform}: ${Errors.formatForUser(error)}`)
  }
  return undefined
}

function parseResponseJson(contentType: string | null, text: string): unknown {
  if (!contentType?.includes('application/json')) {
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

type OpenEndpointResponse = {
  appId?: unknown
  platform?: unknown
  runtime?: unknown
  url?: unknown
}

function isOpenEndpointResponse(body: unknown): body is OpenEndpointResponse {
  return typeof body === 'object' && body !== null && 'url' in body
}

function endpointUrl(body: OpenEndpointResponse | undefined): string | undefined {
  return typeof body?.url === 'string' ? body.url : undefined
}

function formatOpenedRuntime(body: unknown): string {
  if (typeof body !== 'object' || body === null || !('runtime' in body)) {
    return ''
  }
  return ` (${String((body as { runtime?: unknown }).runtime)})`
}

async function expoLink(platform: Exclude<ExpoPlatform, 'web'>): Promise<string | undefined> {
  const response = await fetch(`${EXPO_ORIGIN}/_expo/link?platform=${platform}`, { redirect: 'manual' })
  if (response.status >= 300 && response.status < 400) {
    return response.headers.get('location') ?? undefined
  }
  return undefined
}

type IosSimulator = {
  name: string
  runtime?: string
  state?: string
  udid: string
}

type SimctlDevicesJson = {
  devices?: Record<string, IosSimulator[]>
}

async function ensureIosSimulator(shouldStop: () => boolean): Promise<IosSimulator | undefined> {
  if (!await commandExists('xcrun')) {
    HCI.logProcessInfo('dev', 'xcrun not found; skipping iOS Simulator launch.')
    return undefined
  }
  if (shouldStop()) {
    return undefined
  }
  const simulator = await selectIosSimulator()
  if (!simulator) {
    HCI.logProcessWarn('dev', 'No available iOS Simulator found.')
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
      HCI.logProcessWarn('dev', `iOS Simulator did not finish booting: ${simulator.name}`)
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
    HCI.logProcessWarn(
      'dev',
      `Could not list iOS Simulators: ${result.stderr.trim() || result.error?.message || 'unknown error'}`,
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
    HCI.logProcessWarn(
      'dev',
      `Could not open Simulator app: ${result.stderr.trim() || result.error?.message || 'unknown error'}`,
    )
  }
}

async function bootIosSimulator(udid: string): Promise<boolean> {
  HCI.logProcessInfo('dev', 'booting iOS Simulator')
  const result = await CLI.run('xcrun', { args: ['simctl', 'boot', udid] })
  if (
    result.exitCode === 0
    || result.stderr.includes('Unable to boot device in current state: Booted')
  ) {
    return true
  }
  HCI.logProcessWarn(
    'dev',
    `Could not boot iOS Simulator: ${result.stderr.trim() || result.error?.message || 'unknown error'}`,
  )
  return false
}

async function waitForIosSimulatorBoot(udid: string, shouldStop: () => boolean): Promise<boolean> {
  const deadline = Date.now() + IOS_BOOT_TIMEOUT_MS
  while (!shouldStop() && Date.now() < deadline) {
    const booted = (await listIosSimulators()).find(simulator =>
      simulator.udid === udid && simulator.state === 'Booted'
    )
    if (booted) {
      return true
    }
    await sleep(IOS_BOOT_POLL_MS)
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
    HCI.logProcessInfo('dev', `opened web in ${WEB_BROWSER_APP_NAME}`)
    return true
  } catch (error) {
    HCI.logProcessWarn('dev', `Could not open web in ${WEB_BROWSER_APP_NAME}: ${Errors.formatForUser(error)}`)
    HCI.logProcessWarn('dev', `Open ${url} manually.`)
    return false
  }
}

async function withChromeOpenEnv(fn: () => Promise<unknown> | unknown): Promise<void> {
  const env = Platform.runtimeProcess.env
  const previousBrowser = env['BROWSER']
  const previousOpenMatchHostOnly = env['OPEN_MATCH_HOST_ONLY']
  try {
    env['BROWSER'] = WEB_BROWSER_APP_NAME
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
