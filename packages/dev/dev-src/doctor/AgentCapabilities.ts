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

const DENIED = /\b(operation not permitted|permission denied|eperm|eacces|sandbox)\b/i

/**
 * Only a variable a harness sets *because* the command is sandboxed belongs here. Claude Code sets
 * `CLAUDE_CODE_TMPDIR` in every session, sandboxed or not, so keying on it reported every agent as
 * sandboxed and made the report's one host-policy signal say nothing.
 */
const SANDBOX_SIGNALS: readonly string[] = ['SANDBOX_RUNTIME', 'CODEX_SANDBOX']

const PROBES: readonly CapabilityProbe[] = [
  {
    args: ['-o', 'pid=,ppid=,lstart=,command=', '-p', String(Platform.runtimeProcess.pid)],
    command: '/bin/ps',
    display: `ps -o pid=,ppid=,lstart=,command= -p ${Platform.runtimeProcess.pid}`,
    name: 'process table',
    remediation: 'Run the displayed ps shape directly; Tao project rules authorize it outside the sandbox.',
  },
  {
    args: ['-0', String(Platform.runtimeProcess.pid)],
    command: '/bin/kill',
    display: `/bin/kill -0 ${Platform.runtimeProcess.pid}`,
    name: 'process liveness',
    remediation: 'Run /bin/kill -0 directly; TERM and KILL are also authorized after confirming the target PID.',
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
    remediation: 'Run the displayed read-only command directly or select tao-native for native filesystem access.',
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
  const status: CapabilityStatus = DENIED.test(output) ? 'denied' : 'unavailable'
  const fallback = result.error instanceof Error ? result.error.message : `exit ${result.exitCode ?? 'unknown'}`
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
  const checks = await Promise.all(PROBES.map(async probe => classifyCapability(probe, await runProbe(probe))))
  return {
    checks,
    repositoryRoot: Repo.getRoot(),
    sandboxDetected: detectSandbox(dependencies.env ?? Platform.runtimeProcess.env),
    version: 1,
  }
}
