import { CLI, Errors, FS, Repo, Time } from '@shared'
import {
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

/** LaunchRow is one line of `studio ps`, live and stale launches alike. */
export type LaunchRow = {
  appName?: string
  launchId: string
  mode: string
  ownedPids: readonly number[]
  disownedPids: readonly number[]
  ports: { owned: readonly number[]; foreign: readonly number[] }
  project?: string
  sessionUrl?: string
  state: string
  status: 'live' | 'stale' | 'unusable'
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
    status: validated.unusableReason !== undefined ? 'unusable' : validated.stale ? 'stale' : 'live',
    studioUrl: manifest.studioUrl,
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
    outcomes.push(await stopLaunch(await validateLaunch(launch, probes), launch, options))
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
  }

  const cleanup: StudioCleanupResult = {
    killedPids,
    releasedPorts: validated.ownedPorts,
    signaledPids,
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

async function stillOwned(
  processes: readonly StudioLaunchProcess[],
  probes: OwnershipProbes,
): Promise<StudioLaunchProcess[]> {
  const running: StudioLaunchProcess[] = []
  for (const process of processes) {
    const fact = await probes.processFact(process.pid)
    // Only the still-recognisable process is escalated to: an id freed mid-stop is left alone.
    if (fact.running && (fact.command === undefined || fact.command === process.command)) {
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
