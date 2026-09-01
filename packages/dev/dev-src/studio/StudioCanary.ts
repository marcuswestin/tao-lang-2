import { FS, HCI, Repo } from '@shared'
import { readLaunches, type StoredLaunch, systemOwnershipProbes, validateLaunch } from './StudioLaunchManifest'
import type { StudioNativeProbeResult } from './StudioNative'

/**
 * The native canary answers one automatic question: did a real native Studio come up, prove its
 * machine-observable capabilities, and leave nothing behind? Checks requiring a person belong to
 * the separate Studio manual-check workflow.
 */

/** Capabilities the runtime probe reports, and the canary requires. */
export const REQUIRED_CAPABILITIES = [
  'browser-runtime',
  'iframe',
  'multi-window',
  'native-menu',
  'shortcut',
  'websocket',
] as const

const DEFAULT_CANARY_PROJECT = { appName: 'HNReader', projectRoot: 'Apps/HNReader' }

export type CanaryTargetOptions = {
  appName?: string
  projectRoot?: string
}

/**
 * Resolves the project and app the canary opens. The default HNReader project always selects
 * `HNReader`, including when `--project Apps/HNReader` is passed without `--app` — that project
 * also ships `HNReaderStub`, so leaving the app unset is not deterministic.
 */
export function resolveCanaryTarget(
  options: CanaryTargetOptions,
  repositoryRoot: string,
): { appName?: string; projectRoot: string } {
  const defaultProjectRoot = FS.resolvePath(DEFAULT_CANARY_PROJECT.projectRoot, repositoryRoot)
  const projectRoot = options.projectRoot === undefined
    ? defaultProjectRoot
    : FS.resolvePath(options.projectRoot, repositoryRoot)
  const onDefaultProject = FS.slashPath(projectRoot) === FS.slashPath(defaultProjectRoot)
  return {
    appName: options.appName ?? (onDefaultProject ? DEFAULT_CANARY_PROJECT.appName : undefined),
    projectRoot,
  }
}

export type CanaryStatus = 'blocked' | 'failed' | 'passed'

/** CanaryReport is the versioned result one canary run produces. */
export type CanaryReport = {
  /** Capabilities the probe reported, with the reason for each failure. */
  capabilities: Readonly<Record<string, { message?: string; passed: boolean }>>
  /** The exit status of the launch itself. A nonzero one fails the run whatever the probe said. */
  exitCode?: number
  /** Why the canary could not run, when it could not. */
  blockedReason?: string
  /** Capabilities the canary required that the probe never reported. */
  missingCapabilities: readonly string[]
  status: CanaryStatus
  /** Processes still running after shutdown that the launch claimed to own. */
  survivingPids: readonly number[]
  version: 2
}

/** evaluateCanary decides a run's outcome from the probe result and what survived shutdown. */
export function evaluateCanary(input: {
  blockedReason?: string
  exitCode?: number
  probe?: StudioNativeProbeResult
  survivingPids?: readonly number[]
}): CanaryReport {
  const survivingPids = input.survivingPids ?? []
  if (input.blockedReason !== undefined || input.probe === undefined) {
    return {
      blockedReason: input.blockedReason ?? 'the native runtime probe produced no result',
      capabilities: {},
      exitCode: input.exitCode,
      missingCapabilities: [...REQUIRED_CAPABILITIES],
      status: 'blocked',
      survivingPids,
      version: 2,
    }
  }
  const capabilities = input.probe.capabilities
  const missingCapabilities = REQUIRED_CAPABILITIES.filter(name => capabilities[name] === undefined)
  const failed = Object.values(capabilities).some(capability => !capability.passed)
  // Three independent ways to fail, and a probe that passed does not excuse any of them: a
  // capability missing from the report, an owned process still running, or a launch that exited
  // nonzero after reporting.
  const exitedBadly = input.exitCode !== undefined && input.exitCode !== 0
  return {
    capabilities,
    exitCode: input.exitCode,
    missingCapabilities,
    status: failed || missingCapabilities.length > 0 || survivingPids.length > 0 || exitedBadly
      ? 'failed'
      : 'passed',
    survivingPids,
    version: 2,
  }
}

/** canaryExitCode fails on a failed run and on a blocked one, which is not a pass either. */
export function canaryExitCode(report: CanaryReport): number {
  return report.status === 'passed' ? 0 : 1
}

/** formatCanaryReport renders a canary run for the terminal. */
export function formatCanaryReport(report: CanaryReport): string {
  const lines: string[] = []
  if (report.blockedReason !== undefined) {
    lines.push(`BLOCKED   ${report.blockedReason}`)
  }
  for (const [name, capability] of Object.entries(report.capabilities)) {
    const detail = capability.message === undefined ? '' : `: ${capability.message}`
    lines.push(`${capability.passed ? 'PASS' : 'FAIL'}      ${name}${detail}`)
  }
  for (const name of report.missingCapabilities) {
    lines.push(`MISSING   ${name}: the probe never reported it`)
  }
  lines.push(
    report.survivingPids.length === 0
      ? 'PASS      shutdown: no owned process survived'
      : `FAIL      shutdown: ${report.survivingPids.join(' ')} still running`,
  )
  if (report.exitCode !== undefined) {
    lines.push(
      report.exitCode === 0
        ? 'PASS      exit: the launch exited cleanly'
        : `FAIL      exit: the launch exited ${report.exitCode}`,
    )
  }
  return lines.join('\n')
}

/**
 * survivingOwnedPids re-validates a finished launch's manifest. Only processes the machine still
 * agrees belong to it are reported, so an id reused after shutdown is never blamed on Studio.
 */
export async function survivingOwnedPids(
  launchId: string,
  repositoryRoot = Repo.getRoot(),
): Promise<number[]> {
  const stored: StoredLaunch | undefined = (await readLaunches(repositoryRoot))
    .find(launch => launch.manifest.launchId === launchId)
  if (stored === undefined) {
    return []
  }
  return (await validateLaunch(stored, systemOwnershipProbes)).owned.map(process => process.pid)
}

/** writeCanaryReport saves the report beside the run's other artifacts and prints it. */
export async function writeCanaryReport(report: CanaryReport, artifactRoot: string): Promise<string> {
  const path = FS.resolvePath('canary.json', artifactRoot)
  await FS.writeJson(path, report)
  HCI.writeLine(formatCanaryReport(report))
  HCI.writeLine(`\nReport: ${FS.displayPath(path)}`)
  return path
}
