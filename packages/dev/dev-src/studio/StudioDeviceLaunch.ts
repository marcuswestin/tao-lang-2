import { CLI, Errors, Json } from '@shared'
import type {
  StudioDeviceLaunchDiagnostic,
  StudioDeviceLauncher,
  StudioDeviceLaunchHost,
  StudioDeviceLaunchInfo,
  StudioDeviceLaunchOpenResult,
} from '@studio'
import { detectLanIPv4, type InterfaceAddress, parseIfconfigIPv4 } from '../expo-dev-loop/expo-runner/lan-host'
import { type ExpoFetch, expoRuntimeLink, fetchExpoOpenEndpoint } from '../expo-dev-loop/expo-runner/metro'
import {
  companionInstallCommand,
  createStudioCompanionDevice,
  type StudioCompanionDevice,
  studioDeviceFailureLayer,
  throwStudioDeviceFailure,
} from './StudioCompanionDevice'
import { StudioCompanionIdentity } from './StudioCompanionIdentity'
import {
  companionSimulatorInstallCommand,
  createStudioCompanionSimulator,
  type StudioCompanionSimulator,
} from './StudioCompanionSimulator'

/**
 * The `StudioDeviceLauncher` implementation `packages/dev` injects into Studio: it resolves the
 * dev-client URL for one project's Metro, lists the physical devices and whether the shell is on
 * them, and opens the shell on a device. Studio never starts a Metro or a build through it.
 */

/** LanAddressReport is what this Mac's interfaces offer a device: every IPv4 plus the preferred one. */
type LanAddressReport = {
  interfaces: readonly InterfaceAddress[]
  preferred?: string
}

/** StudioDeviceLaunchDeps injects the device and simulator tooling, `fetch`, and LAN discovery for tests. */
export type StudioDeviceLaunchDeps = {
  device?: StudioCompanionDevice
  fetch?: ExpoFetch
  lanAddresses?: () => Promise<LanAddressReport>
  simulator?: StudioCompanionSimulator
}

/** MetroHostCandidateInput is what `orderMetroHostCandidates` ranks: Expo's own host first. */
export type MetroHostCandidateInput = LanAddressReport & {
  expoHost?: string
}

type ResolvedLaunchUrl = {
  candidates: string[]
  diagnostics: StudioDeviceLaunchDiagnostic[]
  metroPort: number
  url?: string
}

/** createStudioDeviceLauncher builds the launcher Studio serves behind `/api/device/launch`. */
export function createStudioDeviceLauncher(deps: StudioDeviceLaunchDeps = {}): StudioDeviceLauncher {
  const device = deps.device ?? createStudioCompanionDevice()
  const simulator = deps.simulator ?? createStudioCompanionSimulator()
  const fetchImpl = deps.fetch ?? fetch
  const lanAddresses = deps.lanAddresses ?? detectLanAddresses
  /** Once an Expo CLI answers 404 for `/_expo/open`, the launcher stops asking and uses `/_expo/link` directly. */
  let openEndpointAbsent = false

  async function resolveExpoUrl(
    metroOrigin: string,
    diagnostics: StudioDeviceLaunchDiagnostic[],
  ): Promise<string | undefined> {
    if (!openEndpointAbsent) {
      try {
        const probe = await fetchExpoOpenEndpoint(metroOrigin, 'ios', fetchImpl)
        const openUrl = typeof probe.body?.url === 'string' ? probe.body.url : undefined
        if (openUrl !== undefined) {
          return openUrl
        }
        if (probe.status !== 404) {
          // The endpoint exists but answered with nothing usable. Say so and still try /_expo/link
          // rather than returning empty-handed — under the old ordering link had already been tried,
          // so this shape used to be harmless and would otherwise become a silent dead end.
          diagnostics.push({
            layer: 'expo',
            message: `Expo at ${metroOrigin} answered /_expo/open with status ${probe.status} and no usable url; `
              + 'falling back to /_expo/link.',
          })
        }
        openEndpointAbsent = probe.status === 404
      } catch (error) {
        diagnostics.push({
          layer: 'metro',
          message: `Metro at ${metroOrigin} did not answer /_expo/open: ${
            networkErrorMessage(error)
          }. Studio's Metro for this project may still be starting or may have stopped.`,
        })
        return undefined
      }
    }
    try {
      const link = await expoRuntimeLink(metroOrigin, { devClient: true, fetch: fetchImpl, platform: 'ios' })
      if (link !== undefined) {
        return link
      }
      diagnostics.push({
        layer: 'expo',
        message:
          `Expo at ${metroOrigin} offered no development-client link from /_expo/link (the preview project may not declare the ${StudioCompanionIdentity.scheme} scheme); using a constructed link instead.`,
      })
      return undefined
    } catch (error) {
      diagnostics.push({
        layer: 'metro',
        message: `Metro at ${metroOrigin} did not answer /_expo/link: ${
          networkErrorMessage(error)
        }. Studio's Metro for this project may still be starting or may have stopped.`,
      })
      return undefined
    }
  }

  async function resolveLaunchUrl(
    metroOrigin: string,
    route: StudioDeviceLaunchRoute = 'auto',
  ): Promise<ResolvedLaunchUrl> {
    const diagnostics: StudioDeviceLaunchDiagnostic[] = []
    const metroPort = metroPortOf(metroOrigin)
    const expoUrl = await resolveExpoUrl(metroOrigin, diagnostics)
    const expoHost = expoUrl === undefined ? undefined : metroHostFromDevClientUrl(expoUrl)
    let lan: LanAddressReport = { interfaces: [] }
    try {
      lan = await lanAddresses()
    } catch (error) {
      diagnostics.push({
        layer: 'network',
        message: `Could not read this Mac's network interfaces: ${networkErrorMessage(error)}`,
      })
    }
    const candidates = orderMetroHostCandidates({ ...lan, expoHost })
    const expoHostUsable = expoHost !== undefined && !isLoopbackHost(expoHost)
    if (expoUrl !== undefined && !expoHostUsable) {
      diagnostics.push({
        layer: 'metro',
        message: `Expo's development-client link points at ${
          expoHost ?? 'no host'
        }, which a device cannot reach; Metro is not serving on this Mac's LAN address. Using ${
          candidates[0] ?? 'no host'
        } instead.`,
      })
    }
    if (candidates.length === 0) {
      diagnostics.push({
        layer: 'network',
        message:
          'This Mac has no LAN or link-local IPv4 address a device could reach. Join the same Wi-Fi as the device or connect it with a cable, then retry.',
      })
    }
    const cableHost = route === 'cable' ? linkLocalCandidate(candidates) : undefined
    if (route === 'cable' && cableHost === undefined) {
      diagnostics.push({
        layer: 'network',
        message: 'This Mac has no cable link-local address. Connect the device with a cable, unlock it, '
          + 'and trust this Mac, then retry.',
      })
    }
    const firstCandidate = candidates[0]
    const url = cableHost !== undefined
      ? companionDevClientUrl({ host: cableHost, port: metroPort, scheme: StudioCompanionIdentity.scheme })
      : route === 'cable'
      ? undefined
      : expoUrl !== undefined && expoHostUsable
      ? expoUrl
      : firstCandidate === undefined
      ? undefined
      : companionDevClientUrl({ host: firstCandidate, port: metroPort, scheme: StudioCompanionIdentity.scheme })
    return { candidates, diagnostics, metroPort, url }
  }

  async function describeHosts(diagnostics: StudioDeviceLaunchDiagnostic[]): Promise<StudioDeviceLaunchHost[]> {
    let connected: readonly { id: string; name: string }[]
    try {
      connected = await device.listHosts()
    } catch (error) {
      if (!(error instanceof Errors.HostEnvironmentError)) {
        throw error
      }
      diagnostics.push(launchDiagnosticFromError(error, 'devicectl'))
      return []
    }
    if (connected.length === 0) {
      diagnostics.push({
        layer: 'devicectl',
        message:
          'No iPhone or iPad is connected to or paired with this Mac. Connect one with a cable, unlock it, and trust this Mac.',
      })
    }
    const hosts: StudioDeviceLaunchHost[] = []
    for (const entry of connected) {
      const probe = await device.installedAppProbe(entry.id)
      if (probe.problem !== undefined) {
        diagnostics.push({
          layer: probe.layer ?? 'devicectl',
          message:
            `Could not tell whether ${StudioCompanionIdentity.name} is installed on ${entry.name}: ${probe.problem}`,
        })
      }
      hosts.push(
        probe.installed === undefined
          ? { id: entry.id, kind: 'device', name: entry.name }
          : { id: entry.id, installed: probe.installed, kind: 'device', name: entry.name },
      )
    }
    return hosts
  }

  /**
   * describeSimulators lists the iOS simulators this Mac can run the shell on. A simulator is never
   * a required host, so every failure is a diagnostic: a Mac without Xcode simply offers none.
   */
  async function describeSimulators(
    diagnostics: StudioDeviceLaunchDiagnostic[],
  ): Promise<{ hosts: StudioDeviceLaunchHost[]; installName?: string }> {
    let available: readonly { booted: boolean; id: string; name: string; runtime: string }[]
    try {
      available = await simulator.listSimulators()
    } catch (error) {
      if (!(error instanceof Errors.HostEnvironmentError)) {
        throw error
      }
      diagnostics.push(launchDiagnosticFromError(error, 'simulator'))
      return { hosts: [] }
    }
    const booted = available.filter(candidate => candidate.booted)
    const hosts: StudioDeviceLaunchHost[] = []
    for (const entry of booted) {
      const installed = await simulator.installedOn(entry.id)
      hosts.push(
        installed === undefined
          ? { id: entry.id, kind: 'simulator', name: simulatorHostName(entry) }
          : { id: entry.id, installed, kind: 'simulator', name: simulatorHostName(entry) },
      )
    }
    // The install command names the simulator the way `simctl` and Xcode do, which is what the
    // tooling matches on; the host label carries the runtime for a person reading the list.
    return { hosts, ...(booted[0] === undefined ? {} : { installName: booted[0].name }) }
  }

  /**
   * openSimulator answers only for a host id that is an available simulator, and otherwise nothing
   * so the physical-device path runs. A simulator shares this Mac's network stack, so it reaches
   * Metro and the device gateway on loopback and never needs the LAN address a phone does.
   */
  async function openSimulator(
    input: { hostId: string; metroOrigin: string },
  ): Promise<StudioDeviceLaunchOpenResult | undefined> {
    let available: readonly { booted: boolean; id: string; name: string; runtime: string }[]
    try {
      available = await simulator.listSimulators()
    } catch {
      return undefined
    }
    const target = available.find(entry => entry.id === input.hostId)
    if (target === undefined) {
      return undefined
    }
    const name = simulatorHostName(target)
    if (await simulator.installedOn(target.id) === false) {
      throwStudioDeviceFailure(
        'simulator',
        `${StudioCompanionIdentity.name} is not installed on ${name}. Install it once with: ${
          companionSimulatorInstallCommand(target.name)
        }`,
      )
    }
    const url = companionDevClientUrl({
      host: loopbackHost,
      port: metroPortOf(input.metroOrigin),
      scheme: StudioCompanionIdentity.scheme,
    })
    await simulator.open({ id: target.id, url })
    return { hostName: name, launched: true, url }
  }

  return {
    async describe(input: { metroOrigin: string }): Promise<StudioDeviceLaunchInfo> {
      const resolved = await resolveLaunchUrl(input.metroOrigin)
      const devices = await describeHosts(resolved.diagnostics)
      const simulators = await describeSimulators(resolved.diagnostics)
      const hosts = [...devices, ...simulators.hosts]
      const firstDevice = devices[0]
      return {
        bundleIdentifier: device.bundleIdentifier,
        candidates: resolved.candidates,
        diagnostics: resolved.diagnostics,
        hosts,
        installCommand: firstDevice === undefined && simulators.installName !== undefined
          ? companionSimulatorInstallCommand(simulators.installName)
          : companionInstallCommand(firstDevice?.name),
        metroPort: resolved.metroPort,
        scheme: StudioCompanionIdentity.scheme,
        ...(resolved.url === undefined ? {} : { url: resolved.url }),
      }
    },

    async open(
      input: { hostId: string; metroOrigin: string; route?: StudioDeviceLaunchRoute },
    ): Promise<StudioDeviceLaunchOpenResult> {
      const simulated = await openSimulator(input)
      if (simulated !== undefined) {
        return simulated
      }
      const connected = await device.listHosts()
      const host = connected.find(entry => entry.id === input.hostId)
      if (host === undefined) {
        throwStudioDeviceFailure(
          'devicectl',
          connected.length === 0
            ? 'No iPhone or iPad is connected to or paired with this Mac. Connect one with a cable, unlock it, trust this Mac, then retry.'
            : `No connected device has id ${input.hostId}. Connected: ${
              connected.map(entry => `${entry.name} (${entry.id})`).join(', ')
            }.`,
        )
      }
      const probe = await device.installedAppProbe(host.id)
      if (probe.installed === false) {
        throwStudioDeviceFailure(
          'devicectl',
          `${StudioCompanionIdentity.name} is not installed on ${host.name}. Install it once with: ${
            companionInstallCommand(host.name)
          }`,
        )
      }
      const resolved = await resolveLaunchUrl(input.metroOrigin, input.route)
      if (resolved.url === undefined) {
        throwStudioDeviceFailure(
          'network',
          resolved.diagnostics.map(entry => entry.message).join(' ')
            || `No reachable Metro host was found for ${input.metroOrigin}.`,
        )
      }
      try {
        await device.open({ hostId: host.id, terminateExisting: true, url: resolved.url })
      } catch (error) {
        if (error instanceof Errors.HostEnvironmentError && probe.installed === undefined) {
          throwStudioDeviceFailure(
            studioDeviceFailureLayer(error) ?? 'devicectl',
            `${error.messageForUser} If ${StudioCompanionIdentity.name} is not installed yet, run: ${
              companionInstallCommand(host.name)
            }`,
            { cause: error },
          )
        }
        throw error
      }
      return { hostName: host.name, launched: true, url: resolved.url }
    },
  }
}

/**
 * Which way a launch should reach the device.
 *
 * `auto` is Wi-Fi whenever the Mac has a LAN address, and that is the default on purpose: a session
 * bound to Wi-Fi survives the cable being plugged in and pulled out, while one bound to a
 * `169.254.x.x` address dies the moment the cable goes — that address is transient and comes back
 * different on the next connection.
 *
 * `cable` answers the case the Mac cannot detect: the Mac has Wi-Fi, but the phone is not on it, so
 * there is no network to join together. Nothing here can observe that, so it is a choice, not a guess.
 */
type StudioDeviceLaunchRoute = 'auto' | 'cable'

/** The cable address among the launch candidates: macOS assigns one only while a device is attached. */
export function linkLocalCandidate(candidates: readonly string[]): string | undefined {
  return candidates.find(candidate => candidate.startsWith('169.254.'))
}

/** companionDevClientUrl is the development-client deep link the shell opens Metro from. */
export function companionDevClientUrl(input: { host: string; port: number; scheme: string }): string {
  return `${input.scheme}://expo-development-client/?url=${encodeURIComponent(`http://${input.host}:${input.port}`)}`
}

/** metroHostFromDevClientUrl reads the Metro host out of a development-client deep link, if it carries one. */
export function metroHostFromDevClientUrl(devClientUrl: string): string | undefined {
  try {
    const inner = new URL(devClientUrl).searchParams.get('url')
    if (inner === null) {
      return undefined
    }
    const host = new URL(inner).hostname
    return host.length > 0 ? host : undefined
  } catch {
    return undefined
  }
}

/** metroPortOf reads the port a Metro origin serves on. */
export function metroPortOf(metroOrigin: string): number {
  let url: URL
  try {
    url = new URL(metroOrigin)
  } catch {
    Errors.throwUnexpected(`Expected: a Metro origin URL, received ${metroOrigin}.`)
  }
  if (url.port.length > 0) {
    return Number(url.port)
  }
  return url.protocol === 'https:' ? 443 : 80
}

/** loopbackHost is the address a simulator uses: it shares this Mac's network stack. */
const loopbackHost = '127.0.0.1'

/** simulatorHostName names a simulator by model and runtime, which is what a person picks from. */
function simulatorHostName(simulator: { name: string; runtime: string }): string {
  return `${simulator.name} (${simulator.runtime} Simulator)`
}

/** isLoopbackHost says whether a host names this Mac only, which a device can never reach. */
export function isLoopbackHost(host: string): boolean {
  const lowered = host.toLowerCase()
  return lowered === 'localhost' || lowered.startsWith('127.') || lowered === '::1' || lowered === '[::1]'
    || lowered === '0.0.0.0'
}

/**
 * orderMetroHostCandidates ranks the hosts a device might reach Metro on: Expo's own choice, then the
 * preferred LAN address, then every active link-local (`169.254.*`) and other active address, with
 * loopback dropped and duplicates removed.
 */
export function orderMetroHostCandidates(input: MetroHostCandidateInput): string[] {
  const active = input.interfaces.filter(entry => entry.active)
  const linkLocal = active.filter(entry => entry.address.startsWith('169.254.')).map(entry => entry.address)
  const others = active.filter(entry => !entry.address.startsWith('169.254.')).map(entry => entry.address)
  const ordered = [input.expoHost, input.preferred, ...linkLocal, ...others]
  const seen = new Set<string>()
  const candidates: string[] = []
  for (const host of ordered) {
    if (host === undefined || host.length === 0 || isLoopbackHost(host) || seen.has(host)) {
      continue
    }
    seen.add(host)
    candidates.push(host)
  }
  return candidates
}

/** launchDiagnosticFromError presents a tagged host-environment error as one launch diagnostic. */
export function launchDiagnosticFromError(
  error: unknown,
  fallbackLayer: StudioDeviceLaunchDiagnostic['layer'],
): StudioDeviceLaunchDiagnostic {
  return { layer: studioDeviceFailureLayer(error) ?? fallbackLayer, message: Errors.formatForUser(error) }
}

async function detectLanAddresses(): Promise<LanAddressReport> {
  const ifconfig = await CLI.run('ifconfig', {})
  const preferred = await detectLanIPv4()
  return {
    interfaces: parseIfconfigIPv4(ifconfig.stdout),
    ...(isLoopbackHost(preferred) ? {} : { preferred }),
  }
}

function networkErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }
  const cause = error.cause
  const code = Json.isRecord(cause) && 'code' in cause ? String(cause['code']) : undefined
  return code === undefined ? error.message : `${error.message} (${code})`
}
