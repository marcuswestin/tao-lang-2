import { CLI, FS, Platform, Repo } from '@shared'

type CapabilityStatus = 'available' | 'denied' | 'unavailable'

export type CapabilityCheck = {
  command: string
  detail: string
  name: string
  remediation?: string
  status: CapabilityStatus
}

export type CapabilityReport = {
  checks: readonly CapabilityCheck[]
  repositoryRoot: string
  sandboxDetected: boolean
  version: 1
}

export const WATCHMAN_SOCKET = 'Watchman socket'
const LANDING_REQUIRED_CAPABILITIES = new Set([WATCHMAN_SOCKET])
/** Only the native gates need these, and `verify-full` skips those gates off macOS. */
const MACOS_LANDING_REQUIRED_CAPABILITIES = new Set(['CoreSimulator service', 'Hutch native launcher'])

export type ProbeResult = {
  error?: unknown
  exitCode: number | null
  stderr: string
  stdout: string
}

export type CapabilityProbe = {
  args: readonly string[]
  command: string
  display: string
  name: string
  remediation?: string
  requiredVersion?: string
  successfulExitCodes?: readonly number[]
}

/** ReadCapabilitiesDependencies are the seams a test replaces to read a report without a real host. */
export type ReadCapabilitiesDependencies = {
  env?: Readonly<Record<string, string | undefined>>
  runProbe?: (probe: CapabilityProbe) => Promise<ProbeResult>
}

const FAILED_CORE_SIMULATOR_SERVICE =
  /CoreSimulatorService connection became invalid|simdiskimaged (?:crashed|is not responding)|failed to initialize simulator runtime/i

const PROBES: readonly CapabilityProbe[] = [
  {
    args: ['-axo', 'pid=,ppid=,lstart=,command='],
    command: 'ps',
    display: 'ps -axo pid=,ppid=,lstart=,command=',
    name: 'process table',
    remediation: 'Run ./agent unsandboxed processes list for the read-only whole-table view.',
  },
  {
    args: ['-0', String(Platform.runtimeProcess.pid)],
    command: '/bin/kill',
    display: `/bin/kill -0 ${Platform.runtimeProcess.pid}`,
    name: 'process liveness',
    remediation: 'Request review for /bin/kill -0 after confirming the target PID; signalling stays reviewed too.',
  },
  {
    args: ['-nP', '-iTCP:8081', '-sTCP:LISTEN', '-t'],
    command: 'lsof',
    display: 'lsof -nP -iTCP:8081 -sTCP:LISTEN -t',
    name: 'port ownership',
    successfulExitCodes: [0, 1],
  },
  {
    // Never spawns a server, and never lets the client answer for one that is absent or denied.
    args: ['--no-spawn', '--no-local', 'watch-list'],
    command: 'watchman',
    display: 'watchman --no-spawn --no-local watch-list',
    name: WATCHMAN_SOCKET,
    // Agent sandboxes leave Watchman's per-login socket out by design; a denial there is expected.
    remediation: 'Run ./agent unsandboxed watchman status; if stopped, run ./agent unsandboxed watchman start. '
      + 'Run file-watching dev loops with ./agent unsandboxed app-dev or ./agent unsandboxed studio.',
  },
  {
    args: ['store', 'info', '--store', 'daemon'],
    command: '/nix/var/nix/profiles/default/bin/nix',
    display: 'nix store info --store daemon',
    name: 'Nix daemon socket',
    remediation: 'Use tao-workspace or another Tao profile carrying the canonical Nix daemon socket.',
  },
  {
    args: ['simctl', 'list', 'devices', '--json', 'available'],
    command: 'xcrun',
    display: 'xcrun simctl list devices --json available',
    name: 'CoreSimulator service',
    remediation:
      'After a runtime install, restart macOS, open Device Hub once, then retry ./agent unsandboxed simulators list --json available.',
  },
  {
    args: ['ps', '--format', '{{.ID}}'],
    command: 'docker',
    display: "docker ps --format '{{.ID}}'",
    name: 'Docker daemon',
    remediation:
      'Start and stop the local InstantDB stack with ./agent unsandboxed local-instantdb start or stop, on the host.',
  },
]

/** classifyCapability keeps policy denials distinct from a tool or daemon that is absent. */
export function classifyCapability(probe: CapabilityProbe, result: ProbeResult): CapabilityCheck {
  const output = `${result.stderr}\n${result.stdout}`.trim()
  const successfulExitCodes = probe.successfulExitCodes ?? [0]
  if (result.error === undefined && result.exitCode !== null && successfulExitCodes.includes(result.exitCode)) {
    if (probe.requiredVersion !== undefined) {
      const version = output.match(/(?:^|\s)v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)(?=\s|$)/)?.[1]
      if (version !== probe.requiredVersion) {
        return {
          command: probe.display,
          detail: `Expected version ${probe.requiredVersion}; `
            + (version === undefined ? 'no version reported' : `found ${version}`),
          name: probe.name,
          remediation: probe.remediation,
          status: 'unavailable',
        }
      }
    }
    return { command: probe.display, detail: 'available', name: probe.name, status: 'available' }
  }
  const fallback = result.error instanceof Error ? result.error.message : `exit ${result.exitCode ?? 'unknown'}`
  const failedCoreSimulatorService = probe.name === 'CoreSimulator service'
    && FAILED_CORE_SIMULATOR_SERVICE.test(output)
  const status: CapabilityStatus = !failedCoreSimulatorService && CLI.isSandboxDenial(result)
    ? 'denied'
    : 'unavailable'
  return {
    command: probe.display,
    detail: (output.split('\n').find(Boolean) ?? fallback).trim(),
    name: probe.name,
    remediation: probe.remediation,
    status,
  }
}

/** Whether landing on this host platform blocks on the named capability. */
export function requiredToLand(name: string, hostPlatform: string = Platform.hostPlatform): boolean {
  return LANDING_REQUIRED_CAPABILITIES.has(name)
    || (hostPlatform === 'darwin' && MACOS_LANDING_REQUIRED_CAPABILITIES.has(name))
}

/** Required probes, rather than an inherited harness marker, decide whether landing can run host gates. */
export function unavailableLandingCapabilities(
  report: CapabilityReport,
  hostPlatform: string = Platform.hostPlatform,
): readonly CapabilityCheck[] {
  return report.checks.filter(check => requiredToLand(check.name, hostPlatform) && check.status !== 'available')
}

/** readAgentCapabilities probes host seams without installing tools, opening apps, or signalling processes. */
export async function readAgentCapabilities(
  dependencies: ReadCapabilitiesDependencies = {},
): Promise<CapabilityReport> {
  const runProbe = dependencies.runProbe
    ?? (async (probe: CapabilityProbe) => await CLI.run(probe.command, { args: [...probe.args], stdio: 'pipe' }))
  const hutchRelease = await FS.readJson<{ version: string }>(Repo.resolvePath('.config/nix/hutch-release.json'))
  const probes: readonly CapabilityProbe[] = [...PROBES, {
    // The development environment supplies the pinned launcher on PATH; never install during a probe.
    args: ['--version'],
    command: 'hutch',
    display: 'hutch --version',
    name: 'Hutch native launcher',
    remediation: 'Run ./agent setup --environment to provision the pinned Hutch launcher, then retry landing.',
    requiredVersion: hutchRelease.version,
  }]
  const checks = await Promise.all(probes.map(async probe => {
    try {
      return classifyCapability(probe, await runProbe(probe))
    } catch (error) {
      return classifyCapability(probe, { error, exitCode: null, stderr: '', stdout: '' })
    }
  }))
  return {
    checks,
    repositoryRoot: Repo.getRoot(),
    sandboxDetected: CLI.inAgentSandbox(dependencies.env),
    version: 1,
  }
}
