import { HCI, Platform } from '@shared'
import {
  type CapabilityCheck,
  type CapabilityReport,
  readAgentCapabilities,
  unavailableLandingCapabilities,
  WATCHMAN_SOCKET,
} from './AgentCapabilities'

export type LandingHostDependencies = {
  hostPlatform?: string
  read?: () => Promise<CapabilityReport>
  startWatchman?: () => Promise<number>
}

export type LandingHostResult = {
  missing: readonly CapabilityCheck[]
  report: CapabilityReport
  startedWatchman: boolean
}

/**
 * Probes the capabilities landing needs. Watchman is the one a host shell can supply itself, so when
 * it is all that is missing this starts it, as `./agent unsandboxed watchman start` would, and probes
 * again rather than sending the agent away to do it by hand.
 */
export async function prepareLandingHost(dependencies: LandingHostDependencies = {}): Promise<LandingHostResult> {
  const hostPlatform = dependencies.hostPlatform ?? Platform.hostPlatform
  const read = dependencies.read ?? (async () => await readAgentCapabilities())
  const report = await read()
  const missing = unavailableLandingCapabilities(report, hostPlatform)
  if (missing.length !== 1 || missing[0]?.name !== WATCHMAN_SOCKET) {
    return { missing, report, startedWatchman: false }
  }
  HCI.writeLine('land: Watchman is the only missing landing capability; starting it.')
  const startWatchman = dependencies.startWatchman ?? (async () => {
    const { WatchmanCommand } = await import('./WatchmanCommand')
    return await WatchmanCommand.run('start')
  })
  const exitCode = await startWatchman()
  if (exitCode !== 0) {
    HCI.writeLine(`land: starting Watchman exited ${exitCode}.`)
    return { missing, report, startedWatchman: false }
  }
  const reprobed = await read()
  return {
    missing: unavailableLandingCapabilities(reprobed, hostPlatform),
    report: reprobed,
    startedWatchman: true,
  }
}

/** landingHostGateMessage names each blocking capability with its own remedy, so one read is enough to act. */
export function landingHostGateMessage(missing: readonly CapabilityCheck[], sandboxDetected: boolean): string {
  return [
    'Landing needs these host capabilities before entering the ready queue:',
    ...missing.map(check =>
      `- ${check.name}: ${check.detail}.${check.remediation === undefined ? '' : ` ${check.remediation}`}`
    ),
    sandboxDetected
      ? 'This shell is sandboxed: run `./agent unsandboxed land` from an approved unsandboxed session, '
        + 'and do not retry the host gate inside this sandbox.'
      : 'No sandbox was detected, so these are fixable from this shell: apply each remedy above, then rerun '
        + '`./agent unsandboxed land`.',
    'Run `./agent capabilities` to see every probe.',
  ].join('\n')
}
