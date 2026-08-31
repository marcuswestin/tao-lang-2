import { CLI, Errors, FS, Repo, Time } from '@shared'
import {
  isSameProcess,
  type OwnershipProbes,
  readLaunches,
  removeLaunch,
  type StoredLaunch,
  type StudioCleanupResult,
  type StudioLaunchProcess,
  systemOwnershipProbes,
  type ValidatedLaunch,
  validateLaunch,
  writeManifestAtomically,
} from './StudioLaunchManifest'

/**
 * `studio ps` and `studio stop` act on launch manifests, never on process names. A manifest is
 * treated as a claim to be checked: `stop` signals only the process ids the live machine still
 * agrees belong to the launch, so a reused id, another worktree's Studio, or an unrelated
 * `node` never gets signalled by accident.
 */

/** How long a stopped process group is given to exit before SIGKILL. */
const TERM_POLL_MS = 50
const TERM_POLLS = 60
const KILL_POLLS = 20

/** LaunchRow is one line of `studio ps`, live and stale launches alike. */
export type LaunchRow = {
  appName?: string
  launchId: string
  mode: string
  ownedPids: readonly number[]
  disownedPids: readonly number[]
  /** Recorded processes this host refused to answer about. */
  undeterminedPids: readonly number[]
  ports: { owned: readonly number[]; foreign: readonly number[] }
  project?: string
  sessionUrl?: string
  state: string
  status: 'live' | 'stale' | 'undetermined' | 'unusable'
  studioUrl?: string
  unusableReason?: string
}

/** LaunchListing is the versioned `--json` shape of `studio ps`. */
export type LaunchListing = {
  launches: readonly LaunchRow[]
  repositoryRoot: string
  version: 1
}

/** StopOutcome records what stopping one launch actually did. */
export type StopOutcome = {
  cleanup: StudioCleanupResult
  launchId: string
  manifestRemoved: boolean
  outcome: 'already-stopped' | 'refused' | 'stopped'
  reason?: string
}

/** StopReport is the versioned `--json` shape of `studio stop`. */
export type StopReport = {
  outcomes: readonly StopOutcome[]
  version: 1
}

/** Signaller sends one signal to one process group, so tests can observe it without killing. */
export type Signaller = (signal: 'SIGKILL' | 'SIGTERM', pids: readonly number[]) => Promise<void>

export type LifecycleDependencies = {
  now?: () => string
  probes?: OwnershipProbes
  repositoryRoot?: string
  signal?: Signaller
  sleep?: (milliseconds: number) => Promise<void>
}

/** listLaunches reconciles every published manifest against the machine and reports the result. */
export async function listLaunches(dependencies: LifecycleDependencies = {}): Promise<LaunchListing> {
  const repositoryRoot = dependencies.repositoryRoot ?? Repo.getRoot()
  const probes = dependencies.probes ?? systemOwnershipProbes
  const rows: LaunchRow[] = []
  for (const stored of await readLaunches(repositoryRoot)) {
    rows.push(launchRow(await validateLaunch(stored, probes)))
  }
  return { launches: rows, repositoryRoot, version: 1 }
}

function launchRow(validated: ValidatedLaunch): LaunchRow {
  const manifest = validated.manifest
  return {
    appName: manifest.appName,
    disownedPids: validated.disowned.map(process => process.pid),
    launchId: manifest.launchId,
    mode: manifest.mode,
    ownedPids: validated.owned.map(process => process.pid),
    ports: { foreign: validated.foreignPorts, owned: validated.ownedPorts },
    project: manifest.projectRoot,
    sessionUrl: manifest.sessionUrl,
    state: manifest.state,
    status: validated.unusableReason !== undefined
      ? 'unusable'
      : validated.undetermined.length > 0
      ? 'undetermined'
      : validated.stale
      ? 'stale'
      : 'live',
    studioUrl: manifest.studioUrl,
    undeterminedPids: validated.undetermined.map(process => process.pid),
    unusableReason: validated.unusableReason,
  }
}

/** formatLaunchListing renders the listing as the table `studio ps` prints. */
export function formatLaunchListing(listing: LaunchListing): string {
  if (listing.launches.length === 0) {
    return 'No Tao Studio launches are recorded for this repository.'
  }
  return listing.launches.map(row => {
    const owned = row.ownedPids.length === 0 ? 'none' : row.ownedPids.join(' ')
    const ports = row.ports.owned.length === 0 ? 'none' : row.ports.owned.join(' ')
    const detail = [
      `  mode ${row.mode}  state ${row.state}  pids ${owned}  ports ${ports}`,
      row.project === undefined ? undefined : `  project ${row.project}${row.appName ? ` (${row.appName})` : ''}`,
      row.sessionUrl === undefined ? undefined : `  session ${row.sessionUrl}`,
      row.disownedPids.length === 0 ? undefined : `  no longer owned: ${row.disownedPids.join(' ')}`,
      row.ports.foreign.length === 0 ? undefined : `  held by another process: ${row.ports.foreign.join(' ')}`,
      row.undeterminedPids.length === 0
        ? undefined
        : `  this host would not say whether these are running: ${row.undeterminedPids.join(' ')}`,
      row.unusableReason === undefined ? undefined : `  unusable: ${row.unusableReason}`,
    ].filter((line): line is string => line !== undefined)
    return [`${row.status.toUpperCase().padEnd(8)}${row.launchId}`, ...detail].join('\n')
  }).join('\n\n')
}

export type StopOptions = LifecycleDependencies & {
  all?: boolean
  launchId?: string
}

/**
 * stopLaunches terminates the launches the caller selected. Selecting more than one requires
 * `--all`, so an unqualified `stop` in a repository with several running Studios asks rather
 * than guessing which one was meant.
 */
export async function stopLaunches(options: StopOptions = {}): Promise<StopReport> {
  const repositoryRoot = options.repositoryRoot ?? Repo.getRoot()
  const probes = options.probes ?? systemOwnershipProbes
  const stored = await readLaunches(repositoryRoot)
  const selected = selectLaunches(stored, options)

  const outcomes: StopOutcome[] = []
  for (const launch of selected) {
    try {
      outcomes.push(await stopLaunch(await validateLaunch(launch, probes), launch, options))
    } catch (error) {
      // `--all` must still report what it already did, and which launch it could not finish.
      outcomes.push({
        cleanup: { killedPids: [], releasedPorts: [], signaledPids: [] },
        launchId: launch.manifest.launchId,
        manifestRemoved: false,
        outcome: 'refused',
        reason: (error as Error).message,
      })
    }
  }
  return { outcomes, version: 1 }
}

function selectLaunches(stored: readonly StoredLaunch[], options: StopOptions): StoredLaunch[] {
  if (options.launchId !== undefined) {
    const match = stored.find(launch => launch.manifest.launchId === options.launchId)
    if (match === undefined) {
      Errors.throwUserInput(`No Tao Studio launch is recorded with id '${options.launchId}'.`)
    }
    return [match]
  }
  if (stored.length > 1 && options.all !== true) {
    Errors.throwUserInput(
      `${stored.length} Tao Studio launches are recorded. Select one with --launch <id>, or stop them all with --all.`,
    )
  }
  return [...stored]
}

async function stopLaunch(
  validated: ValidatedLaunch,
  stored: StoredLaunch,
  options: StopOptions,
): Promise<StopOutcome> {
  const launchId = validated.manifest.launchId
  const empty: StudioCleanupResult = { killedPids: [], releasedPorts: [], signaledPids: [] }

  if (validated.unusableReason !== undefined) {
    return { cleanup: empty, launchId, manifestRemoved: false, outcome: 'refused', reason: validated.unusableReason }
  }
  // Evidence this host would not give is not evidence of absence. Discarding the manifest here
  // would throw away the only record of a launch that may well still be running.
  if (validated.undetermined.length > 0) {
    return {
      cleanup: empty,
      launchId,
      manifestRemoved: false,
      outcome: 'refused',
      reason: `this host would not say whether ${
        validated.undetermined.map(process => process.pid).join(' ')
      } is still running. Stop Tao Studio in its own terminal, or rerun outside the sandbox.`,
    }
  }
  // A port this launch recorded, still held by something: the machine is saying the launch is
  // alive even though its process ids no longer resolve. Keep the record and say so.
  if (validated.owned.length === 0 && validated.foreignPorts.length > 0) {
    return {
      cleanup: empty,
      launchId,
      manifestRemoved: false,
      outcome: 'refused',
      reason: `port ${validated.foreignPorts.join(' ')} is still held, but none of this launch's `
        + 'process ids could be confirmed. Identify the holder before stopping anything.',
    }
  }
  if (validated.owned.length === 0) {
    // An empty process list is a successful stop, not a reason to invoke kill with no operands.
    return {
      cleanup: empty,
      launchId,
      manifestRemoved: await removeLaunch(stored),
      outcome: 'already-stopped',
      reason: validated.disowned.length === 0
        ? undefined
        : `${validated.disowned.length} recorded process id(s) are no longer this launch`,
    }
  }

  const signal = options.signal ?? systemSignaller
  const sleep = options.sleep ?? Time.sleep
  const probes = options.probes ?? systemOwnershipProbes
  const signaledPids = validated.owned.map(process => process.pid)
  await signal('SIGTERM', signaledPids)

  // Bounded by polls rather than wall time, so an injected sleep controls how long this waits.
  let remaining = await stillOwned(validated.owned, probes)
  for (let poll = 0; poll < TERM_POLLS && remaining.length > 0; poll += 1) {
    await sleep(TERM_POLL_MS)
    remaining = await stillOwned(validated.owned, probes)
  }
  const killedPids = remaining.map(process => process.pid)
  if (killedPids.length > 0) {
    await signal('SIGKILL', killedPids)
    // A signal can be sent and still not land: the host may deny it, or the process may ignore
    // even SIGKILL while stuck in the kernel. Removing the manifest here would throw away the
    // only record of what is still running, so the outcome is proven before it is claimed.
    for (let poll = 0; poll < KILL_POLLS && remaining.length > 0; poll += 1) {
      await sleep(TERM_POLL_MS)
      remaining = await stillOwned(remaining, probes)
    }
  }

  const cleanup: StudioCleanupResult = {
    killedPids,
    // Observed after the fact, not copied from the pre-signal probe: a port is reported released
    // only once nothing is listening on it.
    releasedPorts: await releasedPorts(validated.ownedPorts, probes),
    signaledPids,
  }
  if (remaining.length > 0) {
    return {
      cleanup,
      launchId,
      manifestRemoved: false,
      outcome: 'refused',
      reason: `still running after SIGKILL: ${remaining.map(process => process.pid).join(' ')}`,
    }
  }
  await finalizeManifest(stored, cleanup)
  return { cleanup, launchId, manifestRemoved: await removeLaunch(stored), outcome: 'stopped' }
}

/** Records the stop in the manifest before removing it, so a crash mid-stop leaves the reason. */
async function finalizeManifest(stored: StoredLaunch, cleanup: StudioCleanupResult): Promise<void> {
  await writeManifestAtomically(stored.path, {
    ...stored.manifest,
    cleanup,
    generation: stored.manifest.generation + 1,
    shutdownReason: 'stopped by ./dev studio-stop',
    state: 'stopped',
  })
}

/**
 * Re-runs the same ownership test the launch was validated with, start time included. Anything
 * weaker would let an id freed during the termination window, and reused by another copy of the
 * same executable, inherit the SIGKILL meant for the process that has already exited.
 */
/** releasedPorts re-probes each port this launch held and returns only the ones now free. */
async function releasedPorts(ports: readonly number[], probes: OwnershipProbes): Promise<number[]> {
  const released: number[] = []
  for (const port of ports) {
    const listeners = await probes.listenerPidsOnPort(port)
    if (listeners !== undefined && listeners.length === 0) {
      released.push(port)
    }
  }
  return released
}

async function stillOwned(
  processes: readonly StudioLaunchProcess[],
  probes: OwnershipProbes,
): Promise<StudioLaunchProcess[]> {
  const running: StudioLaunchProcess[] = []
  for (const process of processes) {
    if (isSameProcess(process, await probes.processFact(process.pid))) {
      running.push(process)
    }
  }
  return running
}

/** formatStopReport renders what each stop did, naming every process and port affected. */
export function formatStopReport(report: StopReport): string {
  if (report.outcomes.length === 0) {
    return 'No Tao Studio launches are recorded for this repository.'
  }
  return report.outcomes.map(outcome => {
    const lines = [`${outcome.outcome.padEnd(16)}${outcome.launchId}`]
    if (outcome.reason !== undefined) {
      lines.push(`  ${outcome.reason}`)
    }
    if (outcome.cleanup.signaledPids.length > 0) {
      lines.push(`  sent SIGTERM to ${outcome.cleanup.signaledPids.join(' ')}`)
    }
    if (outcome.cleanup.killedPids.length > 0) {
      lines.push(`  escalated to SIGKILL for ${outcome.cleanup.killedPids.join(' ')}`)
    }
    if (outcome.cleanup.releasedPorts.length > 0) {
      lines.push(`  released ports ${outcome.cleanup.releasedPorts.join(' ')}`)
    }
    lines.push(outcome.manifestRemoved ? '  removed its launch manifest' : '  left its launch manifest in place')
    return lines.join('\n')
  }).join('\n\n')
}

/** stopExitCode fails only when a launch was refused, so stopping nothing still succeeds. */
export function stopExitCode(report: StopReport): number {
  return report.outcomes.some(outcome => outcome.outcome === 'refused') ? 1 : 0
}

const systemSignaller: Signaller = async (signal, pids) => {
  if (pids.length === 0) {
    return
  }
  // Signal each process group, which is how Studio starts its children (see StudioProcessTree).
  await CLI.run('/bin/kill', {
    args: [`-${signal.replace(/^SIG/, '')}`, '--', ...pids.map(pid => `-${pid}`)],
  })
  // A process that is not a group leader is signalled directly as a fallback.
  await CLI.run('/bin/kill', { args: [`-${signal.replace(/^SIG/, '')}`, '--', ...pids.map(String)] })
}

/** launchManifestPath resolves one launch's manifest path for reporting. */
export function launchManifestPath(stored: StoredLaunch): string {
  return FS.displayPath(stored.path)
}
