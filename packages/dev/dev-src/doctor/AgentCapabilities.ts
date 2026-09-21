import { CLI, Platform, Repo } from '@shared'

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
  successfulExitCodes?: readonly number[]
}

/** ReadCapabilitiesDependencies are the seams a test replaces to read a report without a real host. */
export type ReadCapabilitiesDependencies = {
  env?: Readonly<Record<string, string | undefined>>
  runProbe?: (probe: CapabilityProbe) => Promise<ProbeResult>
}

const FAILED_CORE_SIMULATOR_SERVICE =
  /CoreSimulatorService connection became invalid|simdiskimaged (?:crashed|is not responding)|failed to initialize simulator runtime/i

/**
 * Only a variable a harness sets *because* the command is sandboxed belongs here. Claude Code sets
 * `CLAUDE_CODE_TMPDIR` in every session, sandboxed or not, so keying on it reported every agent as
 * sandboxed and made the report's one host-policy signal say nothing.
 */
const SANDBOX_SIGNALS: readonly string[] = ['SANDBOX_RUNTIME', 'CODEX_SANDBOX']

const PROBES: readonly CapabilityProbe[] = [
  {
    args: ['-axo', 'pid=,ppid=,lstart=,command='],
    command: 'ps',
    display: 'ps -axo pid=,ppid=,lstart=,command=',
    name: 'process table',
    remediation: 'Run the displayed read-only whole-table shape directly when the active harness can broker it.',
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
    args: ['version'],
    command: 'watchman',
    display: 'watchman version',
    name: 'Watchman socket',
    remediation: 'Use tao-workspace or another Tao profile carrying the canonical Watchman socket.',
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
    remediation: 'After a runtime install, restart macOS, open Device Hub once, then retry the displayed command.',
  },
  {
    args: ['ps', '--format', '{{.ID}}'],
    command: 'docker',
    display: "docker ps --format '{{.ID}}'",
    name: 'Docker daemon',
    remediation: 'Select tao-local-services only while working with the local InstantDB stack.',
  },
]

/** classifyCapability keeps policy denials distinct from a tool or daemon that is absent. */
export function classifyCapability(probe: CapabilityProbe, result: ProbeResult): CapabilityCheck {
  const output = `${result.stderr}\n${result.stdout}`.trim()
  const successfulExitCodes = probe.successfulExitCodes ?? [0]
  if (result.error === undefined && result.exitCode !== null && successfulExitCodes.includes(result.exitCode)) {
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

/** detectSandbox reports whether this command runs under a harness sandbox policy. */
function detectSandbox(env: Readonly<Record<string, string | undefined>>): boolean {
  return SANDBOX_SIGNALS.some(name => (env[name] ?? '') !== '')
}

/** readAgentCapabilities probes host seams without editing files, opening apps, or signalling processes. */
export async function readAgentCapabilities(
  dependencies: ReadCapabilitiesDependencies = {},
): Promise<CapabilityReport> {
  const runProbe = dependencies.runProbe
    ?? (async (probe: CapabilityProbe) => await CLI.run(probe.command, { args: [...probe.args], stdio: 'pipe' }))
  const checks = await Promise.all(PROBES.map(async probe => {
    try {
      return classifyCapability(probe, await runProbe(probe))
    } catch (error) {
      return classifyCapability(probe, { error, exitCode: null, stderr: '', stdout: '' })
    }
  }))
  return {
    checks,
    repositoryRoot: Repo.getRoot(),
    sandboxDetected: detectSandbox(dependencies.env ?? Platform.runtimeProcess.env),
    version: 1,
  }
}
