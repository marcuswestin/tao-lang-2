import { FS, Platform, Time } from '@shared'

/**
 * One machine, many worktrees. Every scheduling decision in this repository is a reservation
 * against `cpuCount`, and every one of them was written as if the lane owned the machine. That
 * holds for one checkout and stops holding the moment a second agent runs `verify` in a linked
 * worktree: two lanes each reserve the whole machine, everything runs at half speed under twice
 * the load, and the first thing to break is whatever asserts on a clock.
 *
 * This is the missing shared fact. A lane registers itself in a machine-wide directory before it
 * schedules anything, divides the machine by the number of lanes it finds there, and keeps
 * sampling while it runs so a failure afterwards can be attributed instead of guessed at. The
 * registry is advisory: a lane never waits for another, never signals one, and never fails
 * because of one.
 *
 * Nothing here may turn a runnable lane into an unrunnable one. Every filesystem operation is
 * best-effort, and a registry that cannot be read or written leaves the lane running at the width
 * it would have taken anyway.
 */

/** LaneRecord is what one running lane publishes about itself. */
export type LaneRecord = {
  lane: string
  pid: number
  repositoryRoot: string
  /** Worker slots the lane reserved for itself when it started. */
  slots: number
  startedAt: string
}

/** ContentionReport is what a lane observed about the machine over its whole run. */
export type ContentionReport = {
  /**
   * True when this run shared the machine with enough other work that timing-sensitive nodes
   * cannot be trusted to have failed on their own merits.
   */
  contended: boolean
  cpuCount: number
  /** Highest number of Tao lanes seen at once, including this one. */
  peakLanes: number
  /** Highest one-minute load average sampled during the run. */
  peakLoadAverage: number
}

/** MachineLane is one lane's registration: the width it may take, and what it saw while it ran. */
export type MachineLane = {
  /** Worker slots this lane may occupy, after sharing the machine with every other live lane. */
  capacity: number
  /** What this lane observed about the machine, from acquisition until it was read. */
  report: () => ContentionReport
  release: () => Promise<void>
}

/** AcquireOptions describes the lane asking for a share of the machine. */
export type AcquireOptions = {
  /** An explicit `--jobs`, which always wins and never registers: the caller has already decided. */
  requestedJobs?: number
  /** A width an outer scheduler already reserved for this process, from `WorkGraph.BUDGET_ENV_KEYS`. */
  reservedJobs?: number
  lane: string
  /** Injected by tests; defaults to the machine-wide registry directory. */
  registryRoot?: string
  repositoryRoot: string
}

/** Registry directory under the user's cache root, which every agent sandbox in this repo can write. */
const REGISTRY_DIRECTORY = 'tao/machine-lanes'
/**
 * The narrowest share a lane is ever cut to. Below two slots a lane stops overlapping anything and
 * its wall time grows faster than the contention it is avoiding.
 */
const MIN_LANE_CAPACITY = 2
/** How often the machine is re-read while a lane runs. Frequent enough to catch a lane that starts later. */
const SAMPLE_INTERVAL_MS = 3_000
/**
 * Load, as a multiple of `cpuCount`, above which this run's timings stop being about this run. One
 * lane at full width drives load to roughly `cpuCount`; half again as much is work nobody here
 * started.
 */
const CONTENDED_LOAD_RATIO = 1.5
/** A lease older than this is stale whatever its pid says, which covers a recycled process id. */
const MAX_LEASE_AGE_MS = 6 * 60 * 60 * 1_000

/** registryRoot resolves the machine-wide directory lanes register themselves in. */
function registryRoot(): string {
  const cacheHome = Platform.runtimeProcess.env['XDG_CACHE_HOME']
  const base = cacheHome !== undefined && cacheHome.length > 0 ? cacheHome : FS.resolvePath('.cache', FS.homeDir())
  return FS.resolvePath(REGISTRY_DIRECTORY, base)
}

/** activeLanes returns every lane whose process is still alive, pruning the leases of those that are not. */
async function activeLanes(root = registryRoot()): Promise<LaneRecord[]> {
  const records: LaneRecord[] = []
  let entries: string[]
  try {
    entries = await FS.listDir(root)
  } catch {
    return records
  }

  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue
    }
    const path = FS.resolvePath(entry, root)
    const record = await readLease(path)
    if (record === undefined || !isLive(record)) {
      // A lane that crashed, or was killed with its worktree, must not hold a share forever.
      await FS.remove(path).catch(() => {})
      continue
    }
    records.push(record)
  }
  return records
}

/**
 * acquire registers this lane and returns the share of the machine it may take. A caller that
 * already knows its width — an explicit `--jobs`, or a budget an outer graph reserved — is inside
 * somebody else's share already, so it neither registers nor divides.
 */
async function acquire(options: AcquireOptions): Promise<MachineLane> {
  if (options.requestedJobs !== undefined || options.reservedJobs !== undefined) {
    const capacity = options.requestedJobs ?? options.reservedJobs ?? Platform.cpuCount()
    return unregisteredLane(capacity)
  }

  const root = options.registryRoot ?? registryRoot()
  const cpuCount = Platform.cpuCount()
  const others = await activeLanes(root)
  const capacity = shareOf(cpuCount, others.length + 1)
  const leasePath = await writeLease(root, {
    lane: options.lane,
    pid: Platform.runtimeProcess.pid,
    repositoryRoot: options.repositoryRoot,
    slots: capacity,
    startedAt: new Date().toISOString(),
  })

  return sampledLane({ capacity, cpuCount, leasePath, others: others.length, root })
}

/** shareOf divides a machine between the lanes running on it, never below the workable minimum. */
function shareOf(cpuCount: number, laneCount: number): number {
  return Math.max(MIN_LANE_CAPACITY, Math.min(cpuCount, Math.floor(cpuCount / Math.max(1, laneCount))))
}

/** contentionReport judges one run's samples: shared with another lane, or simply overloaded. */
function contentionReport(options: { cpuCount: number; peakLanes: number; peakLoadAverage: number }): ContentionReport {
  return {
    contended: options.peakLanes > 1 || options.peakLoadAverage > options.cpuCount * CONTENDED_LOAD_RATIO,
    cpuCount: options.cpuCount,
    peakLanes: options.peakLanes,
    peakLoadAverage: Math.round(options.peakLoadAverage * 10) / 10,
  }
}

/** describeContention states what was sharing the machine, in the one line a reader needs. */
function describeContention(report: ContentionReport): string {
  const lanes = report.peakLanes > 1
    ? `${report.peakLanes} Tao lanes ran at once`
    : 'no other Tao lane registered'
  return `${lanes}; load peaked at ${report.peakLoadAverage.toFixed(1)} on ${report.cpuCount} CPUs`
}

/** sampledLane keeps re-reading the machine until it is released, so a failure can be attributed. */
function sampledLane(options: {
  capacity: number
  cpuCount: number
  leasePath?: string
  others: number
  root: string
}): MachineLane {
  let peakLanes = options.others + 1
  let peakLoadAverage = Platform.loadAverage()
  let released = false

  const timer = setInterval(() => {
    peakLoadAverage = Math.max(peakLoadAverage, Platform.loadAverage())
    void activeLanes(options.root).then(lanes => {
      peakLanes = Math.max(peakLanes, lanes.length)
      return lanes
    }).catch(() => [])
  }, SAMPLE_INTERVAL_MS)
  // A sampler must never be the reason a finished command keeps the process alive.
  timer.unref?.()

  return {
    capacity: options.capacity,
    report: () => contentionReport({ cpuCount: options.cpuCount, peakLanes, peakLoadAverage }),
    release: async () => {
      if (released) {
        return
      }
      released = true
      clearInterval(timer)
      if (options.leasePath !== undefined) {
        await FS.remove(options.leasePath).catch(() => {})
      }
    },
  }
}

/** unregisteredLane is what a nested or explicitly sized run gets: a width, and nothing observed. */
function unregisteredLane(capacity: number): MachineLane {
  return {
    capacity,
    report: () => contentionReport({ cpuCount: Platform.cpuCount(), peakLanes: 1, peakLoadAverage: 0 }),
    release: async () => {},
  }
}

async function writeLease(root: string, record: LaneRecord): Promise<string | undefined> {
  const path = FS.resolvePath(`${record.pid}.json`, root)
  try {
    await FS.mkdir(root)
    await FS.writeJson(path, record)
    return path
  } catch {
    // A machine that will not let this lane publish itself still runs it; it just runs it blind.
    return undefined
  }
}

async function readLease(path: string): Promise<LaneRecord | undefined> {
  try {
    const record = await FS.readJson<LaneRecord>(path)
    return typeof record?.pid === 'number' && typeof record.lane === 'string' ? record : undefined
  } catch {
    return undefined
  }
}

function isLive(record: LaneRecord): boolean {
  if (record.pid === Platform.runtimeProcess.pid) {
    return true
  }
  const startedAtMs = Date.parse(record.startedAt ?? '')
  if (Number.isFinite(startedAtMs) && Time.nowMs() - startedAtMs > MAX_LEASE_AGE_MS) {
    return false
  }
  return Platform.processIsAlive(record.pid)
}

/** MachineLanes owns the machine-wide view every parallel worktree's lanes share. */
export const MachineLanes = {
  CONTENDED_LOAD_RATIO,
  MIN_LANE_CAPACITY,
  acquire,
  activeLanes,
  contentionReport,
  describeContention,
  registryRoot,
  shareOf,
} as const
