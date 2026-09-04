import { type CLI, Errors, FS, type Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import type { StudioDeviceLaunchDiagnostic } from '@studio'
import type { ExpoFetch } from '../dev-src/expo-dev-loop/expo-runner/metro'
import {
  companionDeviceNameFromArgument,
  companionInstallArgs,
  companionInstallCommand,
  companionInstallEnv,
  companionLaunchArgs,
  createStudioCompanionDevice,
  describeDevicectlFailure,
  devicectlFailureLayer,
  installedFromDevicectlApps,
  matchCompanionHost,
  runStudioCompanionInstall,
  type StudioCompanionDevice,
  studioDeviceFailureLayer,
  throwStudioDeviceFailure,
} from '../dev-src/studio/StudioCompanionDevice'
import { StudioCompanionIdentity } from '../dev-src/studio/StudioCompanionIdentity'
import {
  companionSimulatorInstallCommand,
  companionSimulatorNameFromArgument,
  createStudioCompanionSimulator,
  matchCompanionSimulator,
  runStudioCompanionInstallOnSimulator,
  simulatorRuntimeName,
  simulatorsFromSimctl,
  type StudioCompanionSimulator,
} from '../dev-src/studio/StudioCompanionSimulator'
import {
  companionDevClientUrl,
  createStudioDeviceLauncher,
  isLoopbackHost,
  launchDiagnosticFromError,
  linkLocalCandidate,
  metroHostFromDevClientUrl,
  metroPortOf,
  orderMetroHostCandidates,
} from '../dev-src/studio/StudioDeviceLaunch'

const PHONE_UDID = '00008140-00163CD81481801C'
const PHONE_IDENTIFIER = 'E4795A5B-C1B6-55BB-A855-1E96A66F15CF'

/** The `devicectl list devices` report a network-paired iPhone produced on Xcode 26.6, trimmed to what matters. */
const DEVICE_LIST_FIXTURE = {
  info: { commandType: 'devicectl.list.devices', jsonVersion: 3, outcome: 'success', version: '518.33' },
  result: {
    devices: [
      {
        connectionProperties: { pairingState: 'paired', transportType: 'localNetwork', tunnelState: 'disconnected' },
        deviceProperties: { name: 'roPhone', osVersionNumber: '26.6.1' },
        hardwareProperties: { deviceType: 'iPhone', platform: 'iOS', udid: PHONE_UDID },
        identifier: PHONE_IDENTIFIER,
      },
      {
        deviceProperties: { name: 'Simulator' },
        hardwareProperties: { deviceType: 'iPhone', reality: 'virtual', udid: 'SIM-1' },
      },
    ].map(device =>
      device.hardwareProperties.reality === undefined
        ? { ...device, hardwareProperties: { ...device.hardwareProperties, reality: 'physical' } }
        : device
    ),
  },
}

/** What `devicectl` writes when the CoreDevice daemon is unreachable, as a sandboxed shell sees it. */
const COREDEVICE_TIMEOUT_FIXTURE = {
  error: {
    code: 1,
    domain: 'com.apple.coredevice.devicectl',
    userInfo: {
      NSLocalizedDescription: {
        string:
          'Timed out waiting for CoreDeviceService to fully initialize. This is likely a bug in CoreDevice. Please file a bug report against CoreDevice | X.',
      },
    },
  },
  info: { commandType: 'devicectl.list.devices', jsonVersion: 3, outcome: 'failed', version: '518.33' },
}

/** What `devicectl device info apps` writes for a paired phone whose network tunnel is down. */
const DEVICE_UNREACHABLE_FIXTURE = {
  error: {
    code: 4000,
    domain: 'com.apple.dt.CoreDeviceError',
    userInfo: {
      DeviceIdentifier: { string: PHONE_IDENTIFIER },
      NSLocalizedDescription: { string: 'A connection to this device could not be established.' },
    },
  },
  info: { commandType: 'devicectl.device.info.apps', jsonVersion: 3, outcome: 'failed', version: '518.33' },
}

function appsFixture(bundleIdentifiers: readonly string[]): unknown {
  return {
    info: { commandType: 'devicectl.device.info.apps', jsonVersion: 3, outcome: 'success', version: '518.33' },
    result: {
      apps: bundleIdentifiers.map(bundleIdentifier => ({
        appClip: false,
        builtByDeveloper: true,
        bundleIdentifier,
        name: 'Tao Companion',
        removable: true,
        url: `file:///private/var/containers/Bundle/Application/1/${bundleIdentifier}.app/`,
      })),
    },
  }
}

type RunCall = {
  args: string[]
  command: string
  cwd?: string
  env?: Platform.ProcessEnv
}

type ScriptedOutcome = {
  error?: Error
  exitCode?: number
  json?: unknown
  stderr?: string
}

/** scriptedRunner answers each command from `script` and writes any JSON where `--json-output` asked for it. */
function scriptedRunner(script: (call: RunCall) => ScriptedOutcome) {
  const calls: RunCall[] = []
  const run: typeof CLI.run = async (command, spec = {}) => {
    const call: RunCall = { args: [...(spec.args ?? [])], command, cwd: spec.cwd, env: spec.env }
    calls.push(call)
    const outcome = script(call)
    const outputIndex = call.args.indexOf('--json-output')
    const outputPath = outputIndex >= 0 ? call.args[outputIndex + 1] : undefined
    if (outcome.json !== undefined && outputPath !== undefined) {
      await FS.writeJson(outputPath, outcome.json)
    }
    return {
      args: call.args,
      command,
      cwd: spec.cwd,
      error: outcome.error,
      exitCode: outcome.exitCode ?? (outcome.error === undefined ? 0 : null),
      signal: null,
      stderr: outcome.stderr ?? '',
      stdout: '',
    }
  }
  return { calls, run }
}

function devicectlSubcommand(call: RunCall): string {
  return call.args.slice(1, 4).join(' ')
}

async function withDeviceRoots<T>(
  run: (roots: { packageRoot: string; repoRoot: string; tmpRoot: string }) => Promise<T>,
): Promise<T> {
  const root = await mkTestDir('tao-companion-device-')
  try {
    const repoRoot = FS.resolvePath('repo', root)
    const packageRoot = FS.resolvePath(StudioCompanionIdentity.packagePath, repoRoot)
    await FS.mkdir(FS.resolvePath('node_modules/expo', packageRoot))
    const tmpRoot = FS.resolvePath('tmp', root)
    await FS.mkdir(tmpRoot)
    return await run({ packageRoot, repoRoot, tmpRoot })
  } finally {
    await FS.remove(root)
  }
}

async function expectHostFailure(work: () => Promise<unknown>): Promise<Errors.HostEnvironmentError> {
  try {
    await work()
  } catch (error) {
    Expect(error).toBeInstanceOf(Errors.HostEnvironmentError)
    return error as Errors.HostEnvironmentError
  }
  Errors.throwUnexpected('Expected: the operation to throw a HostEnvironmentError.')
}

Describe('Studio companion device tooling', () => {
  Test('lists the physical iPhone devicectl reports, keyed by UDID, and skips simulators', async () => {
    await withDeviceRoots(async roots => {
      const runner = scriptedRunner(() => ({ json: DEVICE_LIST_FIXTURE }))
      const device = createStudioCompanionDevice({ ...roots, run: runner.run })

      Expect(await device.listHosts()).toEqual([{ id: PHONE_UDID, name: 'roPhone' }])
      Expect(runner.calls[0]?.command).toBe('xcrun')
      Expect(runner.calls[0]?.args.slice(0, 3)).toEqual(['devicectl', 'list', 'devices'])
      Expect(await FS.listDir(roots.tmpRoot)).toEqual([])
    })
  })

  Test('turns a CoreDevice daemon timeout into a devicectl-layer error that says what to do', async () => {
    await withDeviceRoots(async roots => {
      const runner = scriptedRunner(() => ({ exitCode: 1, json: COREDEVICE_TIMEOUT_FIXTURE }))
      const device = createStudioCompanionDevice({ ...roots, run: runner.run })

      const error = await expectHostFailure(() => device.listHosts())
      Expect(studioDeviceFailureLayer(error)).toBe('devicectl')
      Expect(error.messageForUser).toContain('devicectl could not list the connected devices')
      Expect(error.messageForUser).toContain('CoreDeviceService')
      Expect(error.messageForUser).toContain('sandboxed shell cannot')
    })
  })

  Test('names Xcode when xcrun has no devicectl at all', async () => {
    await withDeviceRoots(async roots => {
      const runner = scriptedRunner(() => ({
        exitCode: 72,
        stderr: 'xcrun: error: unable to find utility "devicectl", not a developer tool or in PATH\n',
      }))
      const device = createStudioCompanionDevice({ ...roots, run: runner.run })

      const error = await expectHostFailure(() => device.listHosts())
      Expect(studioDeviceFailureLayer(error)).toBe('devicectl')
      Expect(error.messageForUser).toContain('unable to find utility "devicectl"')
      Expect(error.messageForUser).toContain('xcode-select')
    })
  })

  Test('reports the companion as installed only when devicectl lists its bundle id', async () => {
    await withDeviceRoots(async roots => {
      const installedOn = new Map<string, readonly string[]>([
        ['with-app', [StudioCompanionIdentity.bundleIdentifier]],
        ['without-app', []],
      ])
      const runner = scriptedRunner(call => ({ json: appsFixture(installedOn.get(call.args[5] ?? '') ?? []) }))
      const device = createStudioCompanionDevice({ ...roots, run: runner.run })

      Expect(await device.installedOn('with-app')).toBe(true)
      Expect(await device.installedOn('without-app')).toBe(false)
      const call = runner.calls[0]
      Expect(call === undefined ? [] : devicectlSubcommand(call).split(' ')).toEqual(['device', 'info', 'apps'])
      Expect(call?.args).toContain('--bundle-id')
      Expect(call?.args).toContain(StudioCompanionIdentity.bundleIdentifier)
    })
  })

  Test('cannot tell whether the app is installed on a paired phone whose tunnel is down, and says why', async () => {
    await withDeviceRoots(async roots => {
      const runner = scriptedRunner(() => ({ exitCode: 1, json: DEVICE_UNREACHABLE_FIXTURE }))
      const device = createStudioCompanionDevice({ ...roots, run: runner.run })

      Expect(await device.installedOn(PHONE_UDID)).toBeUndefined()
      const probe = await device.installedAppProbe(PHONE_UDID)
      Expect(probe.installed).toBeUndefined()
      Expect(probe.layer).toBe('network')
      Expect(probe.problem).toContain('could not be established')
      Expect(probe.problem).toContain('connect it with a cable')
    })
  })

  Test('cannot tell when devicectl succeeds without an app list', async () => {
    await withDeviceRoots(async roots => {
      const runner = scriptedRunner(() => ({ json: { info: { outcome: 'success' }, result: {} } }))
      const device = createStudioCompanionDevice({ ...roots, run: runner.run })

      const probe = await device.installedAppProbe(PHONE_UDID)
      Expect(probe.installed).toBeUndefined()
      Expect(probe.layer).toBe('devicectl')
    })
  })

  Test('opens the installed bundle with the payload URL, terminating any running instance', async () => {
    await withDeviceRoots(async roots => {
      const runner = scriptedRunner(() => ({
        json: { info: { outcome: 'success' }, result: { process: { processIdentifier: 42 } } },
      }))
      const device = createStudioCompanionDevice({ ...roots, run: runner.run })
      const url = 'taostudiocompanion://expo-development-client/?url=http%3A%2F%2F192.168.50.107%3A8081'

      await device.open({ hostId: PHONE_UDID, terminateExisting: true, url })

      const args = runner.calls[0]?.args ?? []
      Expect(args.slice(0, 4)).toEqual(['devicectl', 'device', 'process', 'launch'])
      Expect(args.slice(args.indexOf('--device'), args.indexOf('--device') + 2)).toEqual(['--device', PHONE_UDID])
      Expect(args).toContain('--terminate-existing')
      Expect(args.slice(args.indexOf('--payload-url'), args.indexOf('--payload-url') + 3)).toEqual([
        '--payload-url',
        url,
        StudioCompanionIdentity.bundleIdentifier,
      ])
    })
  })

  Test('turns a failed launch into a layered error carrying the device URL', async () => {
    await withDeviceRoots(async roots => {
      const runner = scriptedRunner(() => ({ exitCode: 1, json: DEVICE_UNREACHABLE_FIXTURE }))
      const device = createStudioCompanionDevice({ ...roots, run: runner.run })

      const error = await expectHostFailure(() =>
        device.open({ hostId: PHONE_UDID, terminateExisting: false, url: 'taostudiocompanion://x' })
      )
      Expect(studioDeviceFailureLayer(error)).toBe('network')
      Expect(error.messageForUser).toContain('open Tao Companion at taostudiocompanion://x')
    })
  })

  Test('installs with expo run:ios from the companion package and never starts Metro', async () => {
    await withDeviceRoots(async roots => {
      const runner = scriptedRunner(() => ({}))
      const device = createStudioCompanionDevice({ ...roots, run: runner.run })

      await device.install({ deviceName: 'roPhone' })

      const call = runner.calls[0]
      Expect(call?.command).toBe('bunx')
      Expect(call?.args).toEqual(['expo', 'run:ios', '--device', 'roPhone', '--no-bundler'])
      Expect(call?.args).toContain('--no-bundler')
      Expect(call?.args).not.toContain('start')
      Expect(call?.cwd).toBe(roots.packageRoot)
      Expect(call?.env?.['CI']).toBe('1')
      Expect(call?.env?.['EXPO_NO_TELEMETRY']).toBe('1')
      Expect(call?.env?.['PATH']?.split(':')[0]).toBe(FS.resolvePath('.devenv/profile/bin', roots.repoRoot))
    })
  })

  Test('explains a failed expo run:ios in expo-layer terms', async () => {
    await withDeviceRoots(async roots => {
      const runner = scriptedRunner(() => ({ exitCode: 65 }))
      const device = createStudioCompanionDevice({ ...roots, run: runner.run })

      const error = await expectHostFailure(() => device.install({ deviceName: 'roPhone' }))
      Expect(studioDeviceFailureLayer(error)).toBe('expo')
      Expect(error.messageForUser).toContain('exited with code 65')
      Expect(error.messageForUser).toContain('"roPhone"')
      Expect(error.messageForUser).toContain('development team')
    })
  })

  Test('refuses to install before the companion dependencies exist', async () => {
    await withDeviceRoots(async roots => {
      await FS.remove(FS.resolvePath('node_modules', roots.packageRoot))
      const runner = scriptedRunner(() => ({}))
      const device = createStudioCompanionDevice({ ...roots, run: runner.run })

      const error = await expectHostFailure(() => device.install({ deviceName: 'roPhone' }))
      Expect(studioDeviceFailureLayer(error)).toBe('expo')
      Expect(error.messageForUser).toContain('bun install')
      Expect(runner.calls).toEqual([])
    })
  })

  Test('keeps the install environment non-interactive with the devenv profile first on PATH, once', () => {
    const env = companionInstallEnv({ HOME: '/Users/me', PATH: '/repo/.devenv/profile/bin:/usr/bin' }, '/repo')

    Expect(env['PATH']).toBe('/repo/.devenv/profile/bin:/usr/bin')
    Expect(env['CI']).toBe('1')
    Expect(env['EXPO_NO_TELEMETRY']).toBe('1')
    Expect(env['HOME']).toBe('/Users/me')
    Expect(env['LANG']).toBe('en_US.UTF-8')
    Expect(companionInstallEnv({ LC_ALL: 'C.UTF-8', PATH: '/usr/bin' }, '/repo')['LANG']).toBeUndefined()
    Expect(companionInstallArgs('My Phone')).toEqual(['expo', 'run:ios', '--device', 'My Phone', '--no-bundler'])
  })

  Test('builds launch arguments with and without terminating the running app', () => {
    const base = { bundleIdentifier: 'b.id', hostId: 'H', url: 'scheme://x' }
    Expect(companionLaunchArgs({ ...base, terminateExisting: true })).toEqual([
      'device',
      'process',
      'launch',
      '--device',
      'H',
      '--terminate-existing',
      '--payload-url',
      'scheme://x',
      'b.id',
    ])
    Expect(companionLaunchArgs({ ...base, terminateExisting: false })).not.toContain('--terminate-existing')
  })

  Test('reads installed state from a devicectl app list', () => {
    Expect(installedFromDevicectlApps(appsFixture(['dev.tao-lang.studio.companion']), 'dev.tao-lang.studio.companion'))
      .toBe(true)
    Expect(installedFromDevicectlApps(appsFixture(['other.app']), 'dev.tao-lang.studio.companion')).toBe(false)
    Expect(installedFromDevicectlApps({ result: {} }, 'dev.tao-lang.studio.companion')).toBeUndefined()
    Expect(installedFromDevicectlApps(undefined, 'dev.tao-lang.studio.companion')).toBeUndefined()
  })

  Test('matches a host by exact name, then case-insensitively, then by id', () => {
    const hosts = [{ id: 'UDID-A', name: 'roPhone' }, { id: 'UDID-B', name: 'Rophone' }]
    Expect(matchCompanionHost(hosts, 'Rophone')?.id).toBe('UDID-B')
    Expect(matchCompanionHost(hosts, 'ROPHONE')?.id).toBe('UDID-A')
    Expect(matchCompanionHost(hosts, ' UDID-B ')?.id).toBe('UDID-B')
    Expect(matchCompanionHost(hosts, 'iPad')).toBeUndefined()
  })

  Test('sorts devicectl failures into the layer a person must fix', () => {
    Expect(devicectlFailureLayer({ message: 'A connection to this device could not be established.' })).toBe('network')
    Expect(devicectlFailureLayer({ message: 'The device is not paired with this computer.' })).toBe('permission')
    Expect(devicectlFailureLayer({ message: 'Timed out waiting for CoreDeviceService to fully initialize.' })).toBe(
      'devicectl',
    )
    Expect(describeDevicectlFailure('do x', { message: 'The device is locked.' })).toContain('trust prompt')
  })

  Test('tags and reads the failure layer on host-environment errors only', () => {
    let tagged: unknown
    try {
      throwStudioDeviceFailure('permission', 'denied')
    } catch (error) {
      tagged = error
    }
    Expect(studioDeviceFailureLayer(tagged)).toBe('permission')
    Expect(studioDeviceFailureLayer(new Errors.UserInputError('typo', { layer: 'expo' }))).toBeUndefined()
    Expect(studioDeviceFailureLayer(new Errors.HostEnvironmentError('untagged'))).toBeUndefined()
  })
})

function fakeSimulator(options: {
  installed?: Record<string, boolean | undefined>
  listError?: Errors.HostEnvironmentError
  simulators?: readonly { booted: boolean; id: string; name: string; runtime: string }[]
}): StudioCompanionSimulator & { opened: { id: string; url: string }[] } {
  const opened: { id: string; url: string }[] = []
  return {
    boot: async () => {},
    bundleIdentifier: StudioCompanionIdentity.bundleIdentifier,
    install: async () => {},
    installedOn: async id => options.installed?.[id],
    listSimulators: async () => {
      if (options.listError !== undefined) {
        throw options.listError
      }
      return [...(options.simulators ?? [])]
    },
    open: async input => {
      opened.push(input)
    },
    opened,
    show: async () => {},
  }
}

function fakeDevice(options: {
  hosts?: readonly { id: string; name: string }[]
  installed?: Record<string, boolean | undefined>
  listError?: Errors.HostEnvironmentError
  openError?: Errors.HostEnvironmentError
  probeProblem?: { layer: StudioDeviceLaunchDiagnostic['layer']; problem: string }
}): StudioCompanionDevice & { opened: { hostId: string; terminateExisting: boolean; url: string }[] } {
  const opened: { hostId: string; terminateExisting: boolean; url: string }[] = []
  const probe = (hostId: string) => {
    const installed = options.installed?.[hostId]
    return installed === undefined && options.probeProblem !== undefined
      ? { installed, ...options.probeProblem }
      : { installed }
  }
  return {
    bundleIdentifier: StudioCompanionIdentity.bundleIdentifier,
    install: async () => {},
    installedAppProbe: async hostId => probe(hostId),
    installedOn: async hostId => probe(hostId).installed,
    listHosts: async () => {
      if (options.listError !== undefined) {
        throw options.listError
      }
      return [...(options.hosts ?? [])]
    },
    open: async input => {
      if (options.openError !== undefined) {
        throw options.openError
      }
      opened.push(input)
    },
    opened,
  }
}

type FetchScript = (url: string) => Response | Error

function scriptedFetch(script: FetchScript) {
  const urls: string[] = []
  const fetchImpl: ExpoFetch = async input => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    urls.push(url)
    const answer = script(url)
    if (answer instanceof Error) {
      throw answer
    }
    return answer
  }
  return { fetchImpl, urls }
}

const EXPO_LINK = 'taostudiocompanion://expo-development-client/?url=http%3A%2F%2F192.168.50.107%3A8081'

function linkRedirect(location: string): FetchScript {
  return url =>
    url.includes('/_expo/link')
      ? new Response(null, { headers: { location }, status: 307 })
      : new Response('', { status: 404 })
}

const LAN = {
  interfaces: [
    { active: true, address: '192.168.50.107', iface: 'en0' },
    { active: true, address: '169.254.37.4', iface: 'en7' },
    { active: false, address: '10.0.0.9', iface: 'en5' },
  ],
  preferred: '192.168.50.107',
}

Describe('Studio device launcher', () => {
  Test('describes Expo’s own dev-client link first, with LAN and link-local hosts as further candidates', async () => {
    const fetched = scriptedFetch(linkRedirect(EXPO_LINK))
    const device = fakeDevice({ hosts: [{ id: PHONE_UDID, name: 'roPhone' }], installed: { [PHONE_UDID]: true } })
    const launcher = createStudioDeviceLauncher({
      simulator: fakeSimulator({}),
      device,
      fetch: fetched.fetchImpl,
      lanAddresses: async () => LAN,
    })

    const info = await launcher.describe({ metroOrigin: 'http://127.0.0.1:8081' })

    Expect(info.url).toBe(EXPO_LINK)
    Expect(info.candidates).toEqual(['192.168.50.107', '169.254.37.4'])
    Expect(info.hosts).toEqual([{ id: PHONE_UDID, installed: true, kind: 'device', name: 'roPhone' }])
    Expect(info.installCommand).toBe('just studio-companion-install device="roPhone"')
    Expect(info.metroPort).toBe(8081)
    Expect(info.scheme).toBe('taostudiocompanion')
    Expect(info.bundleIdentifier).toBe('dev.tao-lang.studio.companion')
    Expect(info.diagnostics).toEqual([])
    Expect(fetched.urls).toEqual([
      'http://127.0.0.1:8081/_expo/open?platform=ios',
      'http://127.0.0.1:8081/_expo/link?platform=ios&choice=expo-dev-client',
    ])
  })

  Test(
    'constructs the dev-client link from the first LAN candidate when Expo offers none, probing /_expo/open once',
    async () => {
      const fetched = scriptedFetch(() => new Response('', { status: 404 }))
      const device = fakeDevice({ hosts: [] })
      const launcher = createStudioDeviceLauncher({
        simulator: fakeSimulator({}),
        device,
        fetch: fetched.fetchImpl,
        lanAddresses: async () => LAN,
      })

      const first = await launcher.describe({ metroOrigin: 'http://127.0.0.1:49152' })
      const second = await launcher.describe({ metroOrigin: 'http://127.0.0.1:49152' })

      Expect(first.url).toBe('taostudiocompanion://expo-development-client/?url=http%3A%2F%2F192.168.50.107%3A49152')
      Expect(first.metroPort).toBe(49_152)
      Expect(first.diagnostics.map(entry => entry.layer)).toEqual(['expo', 'devicectl'])
      Expect(first.diagnostics[1]?.message).toContain('No iPhone or iPad is connected')
      Expect(first.installCommand).toBe('just studio-companion-install device="<name>"')
      Expect(second.url).toBe(first.url)
      Expect(fetched.urls.filter(url => url.includes('/_expo/open'))).toHaveLength(1)
    },
  )

  Test('reports Metro as down without throwing, and still offers a LAN link', async () => {
    const fetched = scriptedFetch(() => Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))
    const launcher = createStudioDeviceLauncher({
      simulator: fakeSimulator({}),
      device: fakeDevice({ hosts: [] }),
      fetch: fetched.fetchImpl,
      lanAddresses: async () => LAN,
    })

    const info = await launcher.describe({ metroOrigin: 'http://127.0.0.1:8081' })

    Expect(info.diagnostics[0]?.layer).toBe('metro')
    Expect(info.diagnostics[0]?.message).toContain('did not answer /_expo/open: fetch failed (ECONNREFUSED)')
    Expect(info.url).toBe(companionDevClientUrl({ host: '192.168.50.107', port: 8081, scheme: 'taostudiocompanion' }))
    Expect(fetched.urls.some(url => url.includes('/_expo/link'))).toBe(false)
  })

  Test('falls back to /_expo/link when /_expo/open exists but answers with nothing usable', async () => {
    // Open is tried first now, so an endpoint that answers 200 with no url must not become a dead
    // end: under the old ordering link had already run, and this shape was harmless.
    const fetched = scriptedFetch(url =>
      url.includes('/_expo/open')
        ? new Response('{}', { headers: { 'content-type': 'application/json' }, status: 200 })
        : new Response(null, { headers: { location: EXPO_LINK }, status: 307 })
    )
    const launcher = createStudioDeviceLauncher({
      simulator: fakeSimulator({}),
      device: fakeDevice({ hosts: [] }),
      fetch: fetched.fetchImpl,
      lanAddresses: async () => LAN,
    })

    const info = await launcher.describe({ metroOrigin: 'http://127.0.0.1:8081' })

    Expect(info.url).toBe(EXPO_LINK)
    Expect(fetched.urls.some(url => url.includes('/_expo/link'))).toBe(true)
    Expect(
      info.diagnostics.some(entry => entry.message.includes('answered /_expo/open with status 200 and no usable url')),
    ).toBe(true)
  })

  Test('never sends a loopback host to a device, even when Expo offers one', async () => {
    const loopbackLink = 'taostudiocompanion://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081'
    const launcher = createStudioDeviceLauncher({
      simulator: fakeSimulator({}),
      device: fakeDevice({ hosts: [] }),
      fetch: scriptedFetch(linkRedirect(loopbackLink)).fetchImpl,
      lanAddresses: async () => LAN,
    })

    const info = await launcher.describe({ metroOrigin: 'http://127.0.0.1:8081' })

    Expect(info.candidates).toEqual(['192.168.50.107', '169.254.37.4'])
    Expect(info.url).toBe(companionDevClientUrl({ host: '192.168.50.107', port: 8081, scheme: 'taostudiocompanion' }))
    Expect(info.diagnostics.some(entry => entry.layer === 'metro' && entry.message.includes('127.0.0.1'))).toBe(true)
  })

  Test('turns devicectl and install-probe failures into diagnostics instead of throwing', async () => {
    let listError: Errors.HostEnvironmentError | undefined
    try {
      throwStudioDeviceFailure('devicectl', 'devicectl could not list the connected devices: daemon down.')
    } catch (error) {
      listError = error as Errors.HostEnvironmentError
    }
    const launcher = createStudioDeviceLauncher({
      simulator: fakeSimulator({}),
      device: fakeDevice({ listError }),
      fetch: scriptedFetch(linkRedirect(EXPO_LINK)).fetchImpl,
      lanAddresses: async () => LAN,
    })

    const info = await launcher.describe({ metroOrigin: 'http://127.0.0.1:8081' })
    Expect(info.hosts).toEqual([])
    Expect(info.diagnostics).toEqual([{
      layer: 'devicectl',
      message: 'devicectl could not list the connected devices: daemon down.',
    }])

    const unreachable = createStudioDeviceLauncher({
      simulator: fakeSimulator({}),
      device: fakeDevice({
        hosts: [{ id: PHONE_UDID, name: 'roPhone' }],
        probeProblem: { layer: 'network', problem: 'tunnel down' },
      }),
      fetch: scriptedFetch(linkRedirect(EXPO_LINK)).fetchImpl,
      lanAddresses: async () => LAN,
    })
    const unreachableInfo = await unreachable.describe({ metroOrigin: 'http://127.0.0.1:8081' })
    Expect(unreachableInfo.hosts).toEqual([{ id: PHONE_UDID, kind: 'device', name: 'roPhone' }])
    Expect(unreachableInfo.diagnostics).toEqual([{
      layer: 'network',
      message: 'Could not tell whether Tao Companion is installed on roPhone: tunnel down',
    }])
  })

  Test('leaves the URL out and names the network when no host is reachable at all', async () => {
    const launcher = createStudioDeviceLauncher({
      simulator: fakeSimulator({}),
      device: fakeDevice({ hosts: [] }),
      fetch: scriptedFetch(() => new Response('', { status: 404 })).fetchImpl,
      lanAddresses: async () => ({ interfaces: [{ active: true, address: '127.0.0.1', iface: 'lo0' }] }),
    })

    const info = await launcher.describe({ metroOrigin: 'http://127.0.0.1:8081' })

    Expect(info.url).toBeUndefined()
    Expect(info.candidates).toEqual([])
    Expect(info.diagnostics.map(entry => entry.layer)).toEqual(['expo', 'network', 'devicectl'])
  })

  Test('opens the installed shell on the resolved URL, terminating the running instance', async () => {
    const device = fakeDevice({ hosts: [{ id: PHONE_UDID, name: 'roPhone' }], installed: { [PHONE_UDID]: true } })
    const launcher = createStudioDeviceLauncher({
      simulator: fakeSimulator({}),
      device,
      fetch: scriptedFetch(linkRedirect(EXPO_LINK)).fetchImpl,
      lanAddresses: async () => LAN,
    })

    const result = await launcher.open({ hostId: PHONE_UDID, metroOrigin: 'http://127.0.0.1:8081' })

    Expect(result).toEqual({ hostName: 'roPhone', launched: true, url: EXPO_LINK })
    Expect(device.opened).toEqual([{ hostId: PHONE_UDID, terminateExisting: true, url: EXPO_LINK }])
  })

  Test('refuses to open a device without the shell and names the install command', async () => {
    const device = fakeDevice({ hosts: [{ id: PHONE_UDID, name: 'roPhone' }], installed: { [PHONE_UDID]: false } })
    const launcher = createStudioDeviceLauncher({
      simulator: fakeSimulator({}),
      device,
      fetch: scriptedFetch(linkRedirect(EXPO_LINK)).fetchImpl,
      lanAddresses: async () => LAN,
    })

    const error = await expectHostFailure(() =>
      launcher.open({ hostId: PHONE_UDID, metroOrigin: 'http://127.0.0.1:8081' })
    )
    Expect(error.messageForUser).toBe(
      'Tao Companion is not installed on roPhone. Install it once with: just studio-companion-install device="roPhone"',
    )
    Expect(studioDeviceFailureLayer(error)).toBe('devicectl')
    Expect(device.opened).toEqual([])
  })

  Test('refuses to open an unknown host and lists the connected ones', async () => {
    const launcher = createStudioDeviceLauncher({
      simulator: fakeSimulator({}),
      device: fakeDevice({ hosts: [{ id: PHONE_UDID, name: 'roPhone' }] }),
      fetch: scriptedFetch(linkRedirect(EXPO_LINK)).fetchImpl,
      lanAddresses: async () => LAN,
    })

    const error = await expectHostFailure(() => launcher.open({ hostId: 'nope', metroOrigin: 'http://127.0.0.1:8081' }))
    Expect(error.messageForUser).toContain('No connected device has id nope')
    Expect(error.messageForUser).toContain(`roPhone (${PHONE_UDID})`)
  })

  Test('fails open in network terms when no URL can be resolved', async () => {
    const launcher = createStudioDeviceLauncher({
      simulator: fakeSimulator({}),
      device: fakeDevice({ hosts: [{ id: PHONE_UDID, name: 'roPhone' }], installed: { [PHONE_UDID]: true } }),
      fetch: scriptedFetch(() => new Response('', { status: 404 })).fetchImpl,
      lanAddresses: async () => ({ interfaces: [] }),
    })

    const error = await expectHostFailure(() =>
      launcher.open({ hostId: PHONE_UDID, metroOrigin: 'http://127.0.0.1:8081' })
    )
    Expect(studioDeviceFailureLayer(error)).toBe('network')
    Expect(error.messageForUser).toContain('no LAN or link-local IPv4 address')
  })

  Test('adds the install hint to a failed launch only when the installed state was unknown', async () => {
    let openError: Errors.HostEnvironmentError | undefined
    try {
      throwStudioDeviceFailure('devicectl', 'devicectl could not open Tao Companion: app missing.')
    } catch (error) {
      openError = error as Errors.HostEnvironmentError
    }
    const launcher = createStudioDeviceLauncher({
      simulator: fakeSimulator({}),
      device: fakeDevice({ hosts: [{ id: PHONE_UDID, name: 'roPhone' }], openError }),
      fetch: scriptedFetch(linkRedirect(EXPO_LINK)).fetchImpl,
      lanAddresses: async () => LAN,
    })

    const error = await expectHostFailure(() =>
      launcher.open({ hostId: PHONE_UDID, metroOrigin: 'http://127.0.0.1:8081' })
    )
    Expect(error.messageForUser).toBe(
      'devicectl could not open Tao Companion: app missing. If Tao Companion is not installed yet, run: just studio-companion-install device="roPhone"',
    )
  })

  Test('builds and reads the SDK 54 development-client deep link', () => {
    const url = companionDevClientUrl({ host: '192.168.50.107', port: 8081, scheme: 'taostudiocompanion' })
    Expect(url).toBe('taostudiocompanion://expo-development-client/?url=http%3A%2F%2F192.168.50.107%3A8081')
    Expect(metroHostFromDevClientUrl(url)).toBe('192.168.50.107')
    Expect(metroHostFromDevClientUrl('taostudiocompanion://expo-development-client/')).toBeUndefined()
    Expect(metroHostFromDevClientUrl('not a url')).toBeUndefined()
  })

  Test('ranks Metro host candidates and drops loopback and duplicates', () => {
    Expect(orderMetroHostCandidates({
      expoHost: '169.254.37.4',
      interfaces: LAN.interfaces,
      preferred: '192.168.50.107',
    })).toEqual(['169.254.37.4', '192.168.50.107'])
    Expect(orderMetroHostCandidates({ expoHost: 'localhost', interfaces: [], preferred: '127.0.0.1' })).toEqual([])

    // Wi-Fi is the default route because a session bound to it survives the cable being plugged and
    // unplugged; the cable address is only picked when a person asks for it, and only exists while a
    // device is attached.
    Expect(linkLocalCandidate(['192.168.50.107', '169.254.61.95'])).toBe('169.254.61.95')
    Expect(linkLocalCandidate(['192.168.50.107'])).toBeUndefined()
    Expect(linkLocalCandidate([])).toBeUndefined()
    Expect(isLoopbackHost('LOCALHOST')).toBe(true)
    Expect(isLoopbackHost('192.168.1.2')).toBe(false)
  })

  Test('reads the Metro port from an origin and presents tagged errors as diagnostics', () => {
    Expect(metroPortOf('http://127.0.0.1:49152')).toBe(49_152)
    Expect(metroPortOf('http://example.test')).toBe(80)
    let tagged: unknown
    try {
      throwStudioDeviceFailure('expo', 'expo said no')
    } catch (error) {
      tagged = error
    }
    Expect(launchDiagnosticFromError(tagged, 'devicectl')).toEqual({ layer: 'expo', message: 'expo said no' })
    Expect(launchDiagnosticFromError(new Errors.HostEnvironmentError('plain'), 'devicectl')).toEqual({
      layer: 'devicectl',
      message: 'plain',
    })
  })
})

Describe('Studio companion install command', () => {
  Test('asks for a device name when none was given', async () => {
    const device = fakeDevice({ hosts: [{ id: PHONE_UDID, name: 'roPhone' }] })
    await Expect(runStudioCompanionInstall({ deviceName: '  ' }, device)).rejects.toBeInstanceOf(Errors.UserInputError)
  })

  Test('offers the connected names when the requested one is not connected', async () => {
    const installs: string[] = []
    const device = { ...fakeDevice({ hosts: [{ id: 'A', name: 'roPhone' }, { id: 'B', name: 'Studio iPad' }] }) }
    device.install = async input => {
      installs.push(input.deviceName)
    }

    let failure: unknown
    try {
      await runStudioCompanionInstall({ deviceName: 'myPhone' }, device)
    } catch (error) {
      failure = error
    }
    Expect(failure).toBeInstanceOf(Errors.UserInputError)
    Expect(Errors.formatForUser(failure)).toContain('"roPhone", "Studio iPad"')
    Expect(Errors.formatForUser(failure)).toContain(companionInstallCommand('roPhone'))
    Expect(installs).toEqual([])
  })

  Test('fails in devicectl terms when nothing is connected', async () => {
    const error = await expectHostFailure(() =>
      runStudioCompanionInstall({ deviceName: 'roPhone' }, fakeDevice({ hosts: [] }))
    )
    Expect(studioDeviceFailureLayer(error)).toBe('devicectl')
    Expect(error.messageForUser).toContain('No iPhone or iPad is connected')
  })

  Test('accepts the just spelling, whose named argument arrives as a literal device= prefix', async () => {
    const installs: string[] = []
    const device = { ...fakeDevice({ hosts: [{ id: PHONE_UDID, name: 'roPhone' }] }) }
    device.install = async input => {
      installs.push(input.deviceName)
    }

    const captured = await withCapturedOutput(() => runStudioCompanionInstall({ deviceName: 'device=roPhone' }, device))

    Expect(captured.result).toBe(0)
    Expect(installs).toEqual(['roPhone'])
    Expect(companionDeviceNameFromArgument(' device= ')).toBe('')
    Expect(companionDeviceNameFromArgument('My Phone')).toBe('My Phone')
  })

  Test('installs on the matched device with its canonical name and prints the next step', async () => {
    const installs: string[] = []
    const device = { ...fakeDevice({ hosts: [{ id: PHONE_UDID, name: 'roPhone' }] }) }
    device.install = async input => {
      installs.push(input.deviceName)
    }

    const captured = await withCapturedOutput(() => runStudioCompanionInstall({ deviceName: 'rophone' }, device))

    Expect(captured.result).toBe(0)
    Expect(installs).toEqual(['roPhone'])
    Expect(captured.stdout).toContain('Installed Tao Companion on roPhone.')
    Expect(captured.stdout).toContain('Now run `just studio <project>` and press Open on device.')
    Expect(captured.stdout).toContain('--no-bundler')
  })
})

Describe('Tao Companion shell configuration', () => {
  Test('app.json agrees with StudioCompanionIdentity and declares the local-network facts', async () => {
    const packageRoot = Repo.resolvePath(StudioCompanionIdentity.packagePath)
    const config = await FS.readJson<{
      expo: {
        ios?: { bundleIdentifier?: string; infoPlist?: Record<string, unknown>; supportsTablet?: boolean }
        name?: string
        plugins?: readonly unknown[]
        scheme?: string
        slug?: string
      }
    }>(FS.resolvePath('app.json', packageRoot))

    Expect(config.expo.name).toBe(StudioCompanionIdentity.name)
    Expect(config.expo.slug).toBe(StudioCompanionIdentity.slug)
    Expect(config.expo.scheme).toBe(StudioCompanionIdentity.scheme)
    Expect(config.expo.ios?.bundleIdentifier).toBe(StudioCompanionIdentity.bundleIdentifier)
    Expect(config.expo.ios?.supportsTablet).toBe(true)
    Expect(typeof config.expo.ios?.infoPlist?.['NSLocalNetworkUsageDescription']).toBe('string')
    Expect(config.expo.ios?.infoPlist?.['NSAppTransportSecurity']).toEqual({ NSAllowsLocalNetworking: true })
    Expect(config.expo.ios?.infoPlist?.['NSBonjourServices']).toBeUndefined()
    Expect(config.expo.plugins?.[0]).toBe('expo-dev-client')
    const fmtPlugin = config.expo.plugins?.[1]
    Expect(typeof fmtPlugin).toBe('string')
    const pluginSource = await FS.readText(FS.resolvePath(String(fmtPlugin), packageRoot))
    Expect(pluginSource).toContain("require('../../runtime-toolchain/plugins/with-ios-fmt-compat.cjs')")
    Expect(await FS.isFile(Repo.resolvePath('packages/runtime-toolchain/plugins/with-ios-fmt-compat.cjs'))).toBe(true)
  })

  Test('the shell entry registers a root component and carries no Studio logic', async () => {
    const packageRoot = Repo.resolvePath(StudioCompanionIdentity.packagePath)
    const entry = await FS.readText(FS.resolvePath('index.ts', packageRoot))
    Expect(entry).toContain('registerRootComponent(CompanionPlaceholder)')
    Expect(entry).not.toContain('@studio')
    Expect(entry).not.toContain('@runtime')
    const placeholder = await FS.readText(FS.resolvePath('src/CompanionPlaceholder.tsx', packageRoot))
    Expect(placeholder).toContain('Open on device')
    Expect(placeholder).toContain('QR')
  })
})

/** The `simctl list devices available --json` shape, trimmed to the fields the tooling reads. */
const SIMCTL_LIST_FIXTURE = JSON.stringify({
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
      { isAvailable: true, name: 'iPhone 17 Pro', state: 'Shutdown', udid: 'SIM-PRO' },
      { isAvailable: true, name: 'iPad (A16)', state: 'Booted', udid: 'SIM-PAD' },
      { isAvailable: false, name: 'iPhone Air', state: 'Shutdown', udid: 'SIM-GONE' },
    ],
    'com.apple.CoreSimulator.SimRuntime.watchOS-26-0': [
      { isAvailable: true, name: 'Apple Watch Series 11', state: 'Shutdown', udid: 'SIM-WATCH' },
    ],
  },
})

Describe('Tao Companion simulator tooling', () => {
  Test('reads the available iOS simulators, booted first, and skips other platforms', () => {
    const simulators = simulatorsFromSimctl(SIMCTL_LIST_FIXTURE)

    Expect(simulators).toEqual([
      { booted: true, id: 'SIM-PAD', name: 'iPad (A16)', runtime: 'iOS 26.5' },
      { booted: false, id: 'SIM-PRO', name: 'iPhone 17 Pro', runtime: 'iOS 26.5' },
    ])
  })

  Test('names a runtime from its identifier and ignores one it cannot read', () => {
    Expect(simulatorRuntimeName('com.apple.CoreSimulator.SimRuntime.iOS-26-5')).toBe('iOS 26.5')
    Expect(simulatorRuntimeName('com.apple.CoreSimulator.SimRuntime.iOS-18')).toBe('iOS 18')
    Expect(simulatorRuntimeName('com.apple.CoreSimulator.SimRuntime.watchOS-26-0')).toBeUndefined()
  })

  Test('matches a simulator by exact name, case-insensitive name, then UDID', () => {
    const simulators = simulatorsFromSimctl(SIMCTL_LIST_FIXTURE)

    Expect(matchCompanionSimulator(simulators, 'iPhone 17 Pro')?.id).toBe('SIM-PRO')
    Expect(matchCompanionSimulator(simulators, 'iphone 17 pro')?.id).toBe('SIM-PRO')
    Expect(matchCompanionSimulator(simulators, 'SIM-PAD')?.id).toBe('SIM-PAD')
    Expect(matchCompanionSimulator(simulators, 'iPhone 99')).toBeUndefined()
  })

  Test('accepts the `simulator=` word `just` passes through, and the bare name', () => {
    Expect(companionSimulatorNameFromArgument('simulator=iPhone 17 Pro')).toBe('iPhone 17 Pro')
    Expect(companionSimulatorNameFromArgument('  iPhone 17 Pro ')).toBe('iPhone 17 Pro')
    Expect(companionSimulatorNameFromArgument('simulator=')).toBe('')
  })

  Test('installs on the booted simulator when no name is given', async () => {
    const installed: string[] = []
    const simulator = {
      ...fakeSimulator({ simulators: simulatorsFromSimctl(SIMCTL_LIST_FIXTURE) }),
      install: async (input: { id: string }) => {
        installed.push(input.id)
      },
    }

    const output = await withCapturedOutput(() => runStudioCompanionInstallOnSimulator({ name: '' }, simulator))

    Expect(installed).toEqual(['SIM-PAD'])
    Expect(output.stdout).toContain('Installed Tao Companion on the iPad (A16) simulator.')
  })

  Test('names the available simulators when the requested one is not among them', async () => {
    const simulator = fakeSimulator({ simulators: simulatorsFromSimctl(SIMCTL_LIST_FIXTURE) })

    await Expect(runStudioCompanionInstallOnSimulator({ name: 'iPhone 99' }, simulator)).rejects.toThrow(
      'No available iOS simulator matches "iPhone 99".',
    )
    await Expect(runStudioCompanionInstallOnSimulator({ name: 'anything' }, fakeSimulator({}))).rejects.toThrow(
      'This Mac has no available iOS simulator.',
    )
  })

  Test('offers every booted simulator as a launch host, with the loopback link', async () => {
    const simulator = fakeSimulator({
      installed: { 'SIM-PAD': true },
      simulators: simulatorsFromSimctl(SIMCTL_LIST_FIXTURE),
    })
    const launcher = createStudioDeviceLauncher({
      device: fakeDevice({ hosts: [{ id: PHONE_UDID, name: 'roPhone' }], installed: { [PHONE_UDID]: true } }),
      fetch: scriptedFetch(linkRedirect(EXPO_LINK)).fetchImpl,
      lanAddresses: async () => LAN,
      simulator,
    })

    const info = await launcher.describe({ metroOrigin: 'http://127.0.0.1:8081' })

    Expect(info.hosts).toEqual([
      { id: PHONE_UDID, installed: true, kind: 'device', name: 'roPhone' },
      { id: 'SIM-PAD', installed: true, kind: 'simulator', name: 'iPad (A16) (iOS 26.5 Simulator)' },
    ])

    const opened = await launcher.open({ hostId: 'SIM-PAD', metroOrigin: 'http://127.0.0.1:8081' })

    Expect(opened).toEqual({
      hostName: 'iPad (A16) (iOS 26.5 Simulator)',
      launched: true,
      url: companionDevClientUrl({ host: '127.0.0.1', port: 8081, scheme: 'taostudiocompanion' }),
    })
    Expect(simulator.opened).toEqual([{ id: 'SIM-PAD', url: opened.url }])
  })

  Test('offers the simulator install command when no device is connected', async () => {
    const launcher = createStudioDeviceLauncher({
      device: fakeDevice({ hosts: [] }),
      fetch: scriptedFetch(linkRedirect(EXPO_LINK)).fetchImpl,
      lanAddresses: async () => LAN,
      simulator: fakeSimulator({
        installed: { 'SIM-PAD': false },
        simulators: simulatorsFromSimctl(SIMCTL_LIST_FIXTURE),
      }),
    })

    const info = await launcher.describe({ metroOrigin: 'http://127.0.0.1:8081' })

    Expect(info.installCommand).toBe(companionSimulatorInstallCommand('iPad (A16)'))
    await Expect(launcher.open({ hostId: 'SIM-PAD', metroOrigin: 'http://127.0.0.1:8081' })).rejects.toThrow(
      'Tao Companion is not installed on iPad (A16) (iOS 26.5 Simulator).',
    )
  })
})

Describe('Tao Companion simulator install outcome', () => {
  Test('accepts an Expo exit code when the app did reach the simulator, and reports one when it did not', async () => {
    const commands: string[][] = []
    const simulator = (installedAfterwards: boolean) =>
      createStudioCompanionSimulator({
        packageRoot: Repo.resolvePath(StudioCompanionIdentity.packagePath),
        run: (async (command: string, spec: CLI.CommandSpec) => {
          commands.push([command, ...(spec.args ?? [])])
          if (command === 'bunx') {
            return { exitCode: 1, signal: null, stderr: '', stdout: '' }
          }
          if (spec.args?.includes('get_app_container') === true) {
            return installedAfterwards
              ? { exitCode: 0, signal: null, stderr: '', stdout: '/path/to/TaoCompanion.app' }
              : { exitCode: 2, signal: null, stderr: 'No such file or directory', stdout: '' }
          }
          return { exitCode: 0, signal: null, stderr: '', stdout: '' }
        }) as unknown as typeof CLI.run,
      })

    await withCapturedOutput(() => simulator(true).install({ id: 'SIM-PAD' }))
    Expect(commands.some(command => command[0] === 'bunx' && command.includes('run:ios'))).toBe(true)

    await Expect(simulator(false).install({ id: 'SIM-PAD' })).rejects.toThrow(
      'Expo could not build and install Tao Companion on simulator SIM-PAD',
    )
  })
})
