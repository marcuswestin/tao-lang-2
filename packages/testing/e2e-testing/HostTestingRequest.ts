import { Errors } from '@shared'
import type { HostApplicationFault, HostSubject } from './app-build/HostBuild'

export type HostTestingOptions = {
  app: string
  browserChannel?: string
  device?: string
  fault?: boolean
  seed: string
}

export type MaintenanceHostTestingRequest = Readonly<{
  kind: 'maintenance'
  mode: 'check' | 'format' | 'lint' | 'setup' | 'typecheck'
  subject: HostSubject
  seed: number
  browserChannel: string
}>

export type BrowserHostTestingRequest = Readonly<{
  kind: 'browser'
  mode: 'browser' | 'export' | 'prepare'
  subject: HostSubject
  seed: number
  browserChannel: string
  fault?: HostApplicationFault
}>

export type DriverHostTestingRequest = Readonly<{
  kind: 'driver'
  mode: 'driver'
  subject: HostSubject
  seed: number
  browserChannel: string
}>

export type SimulatorNativeHostTestingRequest = Readonly<{
  kind: 'native'
  mode: 'android' | 'ios'
  subject: HostSubject
  seed: number
  browserChannel: string
  device: string
  fault?: HostApplicationFault
}>

/** Physical-device installation is intentionally a separate non-UI acceptance boundary. */
type PhysicalIosInstallRequest = Readonly<{
  kind: 'native'
  mode: 'device'
  subject: HostSubject
  seed: number
  browserChannel: string
  device: string
}>

export type NativeHostTestingRequest = SimulatorNativeHostTestingRequest | PhysicalIosInstallRequest

export type CatalystHostTestingRequest = Readonly<{
  kind: 'catalyst'
  mode: 'catalyst'
  subject: 'native-navigation' | 'hnreader'
  seed: number
  browserChannel: string
}>

export type HostTestingRequest =
  | MaintenanceHostTestingRequest
  | BrowserHostTestingRequest
  | DriverHostTestingRequest
  | NativeHostTestingRequest
  | CatalystHostTestingRequest

export type HostTestingContext = Readonly<{
  artifactRoot: string
  environment: Record<string, string | undefined>
  playwright: string
  runId: string
}>

/** parseHostTestingRequest validates the user surface and assigns one exhaustive dispatch kind. */
export function parseHostTestingRequest(mode: string, options: HostTestingOptions): HostTestingRequest {
  const seed = Number(options.seed)
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    Errors.throwUserInput('--seed must be an unsigned 32-bit integer.')
  }
  if (
    options.app !== 'hnreader' && options.app !== 'clockwork' && options.app !== 'native-navigation'
    && options.app !== 'native-bridge'
  ) {
    Errors.throwUserInput('--app must be hnreader, clockwork, native-navigation, or native-bridge.')
  }
  if (options.app === 'native-bridge') {
    if (options.fault === true) {
      Errors.throwUserInput('--fault is not supported for native-bridge.')
    }
    if (
      mode !== 'ios' && mode !== 'prepare' && mode !== 'check' && mode !== 'lint' && mode !== 'format'
      && mode !== 'typecheck'
    ) {
      Errors.throwUserInput(
        'native-bridge Clipboard acceptance requires ios with an explicit simulator; prepare is also available.',
      )
    }
  }
  if (options.app === 'native-navigation') {
    if (options.fault === true) {
      Errors.throwUserInput('--fault is not supported for native-navigation.')
    }
    if (mode === 'browser' || mode === 'export' || mode === 'driver') {
      Errors.throwUserInput(
        'native-navigation acceptance requires ios or android with an explicit simulator or emulator; prepare is also available.',
      )
    }
  }
  const common = {
    browserChannel: options.browserChannel ?? 'chrome',
    seed,
    subject: options.app,
  } as const
  if (mode === 'catalyst') {
    if (
      (options.app === 'clockwork' || options.app === 'native-bridge') || options.fault === true
      || options.device !== undefined
    ) {
      Errors.throwUserInput('Catalyst builds require --app native-navigation or hnreader, without --device or --fault.')
    }
    return { ...common, subject: options.app, kind: 'catalyst', mode }
  }
  if (mode === 'driver') {
    if (options.fault === true) {
      Errors.throwUserInput(
        '--fault changes an isolated compiled app; use prepare, export, browser, android, or ios.',
      )
    }
    return { ...common, kind: 'driver', mode }
  }
  if (mode === 'check' || mode === 'format' || mode === 'lint' || mode === 'setup' || mode === 'typecheck') {
    if (mode === 'check' && options.fault === true) {
      Errors.throwUserInput(
        '--fault changes an isolated compiled app; use prepare, export, browser, android, or ios.',
      )
    }
    return { ...common, kind: 'maintenance', mode }
  }
  const fault = options.fault === true ? applicationFaultFor(options.app) : undefined
  if (mode === 'prepare' || mode === 'export' || mode === 'browser') {
    return { ...common, ...(fault === undefined ? {} : { fault }), kind: 'browser', mode }
  }
  if (mode === 'android' || mode === 'ios' || mode === 'device') {
    if (options.device === undefined) {
      Errors.throwUserInput('Native proofs require --device with an explicit target identifier.')
    }
    if (mode === 'device' && fault !== undefined) {
      Errors.throwUserInput(
        'Physical-device installation cannot classify an application fault; use ios or android with --fault.',
      )
    }
    if (mode === 'device') {
      return { ...common, subject: options.app, device: options.device, kind: 'native', mode }
    }
    return { ...common, device: options.device, ...(fault === undefined ? {} : { fault }), kind: 'native', mode }
  }
  return Errors.throwUserInput(`Unknown host-testing mode '${mode}'.`)
}

function applicationFaultFor(subject: HostSubject): HostApplicationFault {
  if (subject === 'native-navigation' || subject === 'native-bridge') {
    return Errors.throwUserInput(`--fault is not supported for ${subject}.`)
  }
  return subject === 'clockwork' ? 'clockwork-countdown-frozen' : 'hnreader-reading-history-no-write'
}
