import { Errors, FS } from '@shared'
import type { HostApplicationFault, HostSubject } from './app-build/HostBuild'

export type HostTestingOptions = {
  app: string
  browserChannel?: string
  device?: string
  developerDir?: string
  output?: string
  buildOnly?: boolean
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
  developerDir?: string
  output?: string
  buildOnly?: boolean
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
  developerDir?: string
}>

export type NativeHostTestingRequest = SimulatorNativeHostTestingRequest | PhysicalIosInstallRequest

export type CatalystHostTestingRequest = Readonly<{
  kind: 'catalyst'
  mode: 'catalyst'
  subject: 'native-navigation' | 'hnreader'
  seed: number
  browserChannel: string
  developerDir?: string
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
  if (options.buildOnly === true && mode !== 'ios') {
    Errors.throwUserInput('--build-only is supported only for ios.')
  }
  if (options.output !== undefined && mode !== 'ios') {
    Errors.throwUserInput('--output is supported only for ios.')
  }
  if (options.developerDir !== undefined) {
    if (mode !== 'ios' && mode !== 'device' && mode !== 'catalyst') {
      Errors.throwUserInput('--developer-dir is supported only for ios, device, or catalyst.')
    }
    if (
      !FS.isAbsolute(options.developerDir) || /[\x00-\x1f]/u.test(options.developerDir)
      || !FS.resolvePath(options.developerDir).endsWith('.app/Contents/Developer')
    ) {
      Errors.throwUserInput('--developer-dir must be an absolute Xcode .app/Contents/Developer directory.')
    }
  }
  const developer = options.developerDir === undefined ? {} : { developerDir: FS.resolvePath(options.developerDir) }
  const seed = Number(options.seed)
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    Errors.throwUserInput('--seed must be an unsigned 32-bit integer.')
  }
  if (options.app !== 'hnreader' && options.app !== 'clockwork' && options.app !== 'native-navigation') {
    Errors.throwUserInput('--app must be hnreader, clockwork, or native-navigation.')
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
    if (options.app === 'clockwork' || options.fault === true || options.device !== undefined) {
      Errors.throwUserInput('Catalyst builds require --app native-navigation or hnreader, without --device or --fault.')
    }
    return { ...common, ...developer, subject: options.app, kind: 'catalyst', mode }
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
      return { ...common, ...developer, subject: options.app, device: options.device, kind: 'native', mode }
    }
    return {
      ...common,
      ...developer,
      ...(options.output === undefined ? {} : { output: options.output }),
      ...(options.buildOnly ? { buildOnly: true } : {}),
      device: options.device,
      ...(fault === undefined ? {} : { fault }),
      kind: 'native',
      mode,
    }
  }
  return Errors.throwUserInput(`Unknown host-testing mode '${mode}'.`)
}

function applicationFaultFor(subject: HostSubject): HostApplicationFault {
  if (subject === 'native-navigation') {
    return Errors.throwUserInput('--fault is not supported for native-navigation.')
  }
  return subject === 'clockwork' ? 'clockwork-countdown-frozen' : 'hnreader-reading-history-no-write'
}
