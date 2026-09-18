import { CLI, Errors, FS, Platform, Time } from '@shared'

/** LaneRecord is the live, machine-wide accounting record for one top-level lane. */
export type LaneRecord = {
  /** Unique per acquisition: one process may own more than one lane. */
  id?: string
  lane: string
  /** Per-lane ceiling. */
  maxSlots: number
  pid: number
  repositoryRoot: string
  /** Slots occupied now. */
  slots: number
  startedAt: string
  updatedAt?: string
}

/** ContentionReport is what a lane observed about the machine over its whole run. */
export type ContentionReport = {
  contended: boolean
  cpuCount: number
  peakLanes: number
  peakLoadAverage: number
}

/** MachineSlotReservation is capacity held atomically until its node finishes. */
export type MachineSlotReservation = {
  release: () => Promise<void>
  slots: number
}

/** MachineExclusiveLease blocks new admissions and waits for peer reservations to drain. */
export type MachineExclusiveLease = {
  release: () => Promise<void>
}

/** MachineResourceLease prevents another worktree from claiming the same named host resource. */
export type MachineResourceLease = {
  /** The identity written to the machine-wide registry for diagnostics and safe release. */
  readonly owner: MachineResourceOwner
  release: () => Promise<void>
}

/** MachineResourceOwner identifies the worktree operation holding one named host resource. */
export type MachineResourceOwner = {
  command: string
  id: string
  name: string
  pid: number
  /** OS process start identity, when the host can report it, protects against PID reuse. */
  processStartedAt?: string
  repositoryRoot: string
  /** Lease acquisition time. A lease past its resource's staleness bound is prunable. */
  startedAt: string
}

/** MachineLane is one top-level lane's registration and dynamic admission broker. */
export type MachineLane = {
  /** Current fair share, refreshed on admission and useful for initial child-runner sizing. */
  readonly capacity: number
  /** Per-lane ceiling. The broker, not the local graph, applies the changing fair share. */
  readonly ceiling: number
  /** Registration identity propagated to nested diagnostics so they can exclude their owner. */
  readonly id?: string
  acquireExclusive: (timeoutMs?: number) => Promise<MachineExclusiveLease | undefined>
  report: () => ContentionReport
  release: () => Promise<void>
  tryAcquire: (requestedSlots: number, allowPartial: boolean) => Promise<MachineSlotReservation | undefined>
  /**
   * Why the last admission attempt was declined, in words a waiting run can show. A lane that sits
   * at zero running nodes is otherwise indistinguishable from a lane that is merely slow.
   */
  readonly waitReason: string | undefined
  waitForAvailability: () => Promise<void>
}

/** AcquireOptions describes the lane asking for a share of the machine. */
export type AcquireOptions = {
  /** Explicit jobs is a per-lane ceiling; unlike a nested reservation it still participates. */
  requestedJobs?: number
  /** A width an outer scheduler already reserved. Nested runners do not register again. */
  reservedJobs?: number
  lane: string
  /** Injected by tests. */
  cpuCount?: number
  /** Injected by tests. */
  lockTimeoutMs?: number
  registryRoot?: string
  repositoryRoot: string
}

export type ResourceOptions = {
  /** Command or lane shown to a second worktree when this resource is busy. */
  command?: string
  /** Injected by tests. */
  lockTimeoutMs?: number
  /**
   * How old a lease may get before it is prunable regardless of its process identity. Defaults to
   * `MAX_LEASE_AGE_MS`; pass `Infinity` for a resource an interactive session may validly hold all
   * day, where only process identity may retire the lease.
   */
  maxAgeMs?: number
  name: string
  /** Injected by tests. */
  processIdentity?: (pid: number) => Promise<ProcessIdentity>
  registryRoot?: string
  repositoryRoot?: string
}

export type AcquireResourceOptions = ResourceOptions & {
  command: string
  repositoryRoot: string
  /** Maximum bounded wait before reporting the current owner. */
  waitTimeoutMs?: number
}

type ExclusiveRecord = {
  id: string
  laneId: string
  pid: number
  startedAt: string
}

export type ProcessIdentity = {
  evidence: 'alive' | 'gone' | 'unknown'
  startedAt?: string
}

type MutexRecord = {
  pid: number
  startedAt: string
}

type LaneEntry = {
  path: string
  record: LaneRecord & { id: string; maxSlots: number }
}

export type LaneInspection = {
  available: boolean
  lanes: readonly LaneRecord[]
}

class RegistryLockTimeoutError extends Errors.HostEnvironmentError {}

/** MachineResourceBusyError keeps native-host contention distinct from CPU-lane contention. */
export class MachineResourceBusyError extends Errors.HostEnvironmentError {
  readonly failureKind = 'native-host-busy'
  readonly owner: MachineResourceOwner

  constructor(owner: MachineResourceOwner) {
    super(
      `Machine resource '${owner.name}' is busy: ${owner.command} in ${owner.repositoryRoot} `
        + `(PID ${owner.pid}), held since ${owner.startedAt}. Wait for that session to finish or stop it, then retry.`,
      { details: { failureKind: 'native-host-busy', owner } },
    )
    this.owner = owner
  }
}

const REGISTRY_DIRECTORY = 'tao/machine-lanes'
const SAMPLE_INTERVAL_MS = 3_000
const ADMISSION_POLL_MS = 25
const MAX_ADMISSION_POLL_MS = 500
const CONTENDED_LOAD_RATIO = 1.5
const MAX_LEASE_AGE_MS = 6 * 60 * 60 * 1_000
const MUTEX_ACQUIRE_TIMEOUT_MS = 30_000
const EXCLUSIVE_TIMEOUT_MS = 5 * 60 * 1_000
const RESOURCE_WAIT_TIMEOUT_MS = 10_000
const RESOURCE_POLL_MS = 100
const MUTEX_LINK = '.mutex'
const EXCLUSIVE_PATH = '.exclusive'
const LANE_ID_ENV_KEY = 'TAO_MACHINE_LANE_ID'

/** registryRoot resolves the machine-wide directory shared by every worktree. */
function registryRoot(): string {
  const cacheHome = Platform.runtimeProcess.env['XDG_CACHE_HOME']
  const base = cacheHome !== undefined && cacheHome.length > 0 ? cacheHome : FS.resolvePath('.cache', FS.homeDir())
  return FS.resolvePath(REGISTRY_DIRECTORY, base)
}

/** activeLanes returns all live registrations, pruning crashed processes unless asked not to. */
async function activeLanes(root = registryRoot(), options: { prune?: boolean } = {}): Promise<LaneRecord[]> {
  return [...(await inspectLanes(root, options)).lanes]
}

/** inspectLanes distinguishes an empty registry from one the host refused to reveal. */
async function inspectLanes(root = registryRoot(), options: { prune?: boolean } = {}): Promise<LaneInspection> {
  try {
    return {
      available: true,
      lanes: (await activeLaneEntries(root, options.prune ?? true)).map(entry => entry.record),
    }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return { available: true, lanes: [] }
    }
    return { available: false, lanes: [] }
  }
}

/**
 * acquire registers every top-level lane, including one with an explicit jobs ceiling. Only a
 * nested run is already accounted for and therefore stays unregistered.
 */
async function acquire(options: AcquireOptions): Promise<MachineLane> {
  const root = options.registryRoot ?? registryRoot()
  const cpuCount = Math.max(1, options.cpuCount ?? Platform.cpuCount())
  if (options.reservedJobs !== undefined) {
    return observingUnregisteredLane(options.reservedJobs, root, cpuCount)
  }

  const id = `${Platform.runtimeProcess.pid}-${Platform.randomUUID()}`
  const path = lanePath(root, id)
  const now = new Date().toISOString()
  const record: LaneRecord & { id: string; maxSlots: number } = {
    id,
    lane: options.lane,
    maxSlots: Math.max(1, options.requestedJobs ?? cpuCount),
    pid: Platform.runtimeProcess.pid,
    repositoryRoot: options.repositoryRoot,
    slots: 0,
    startedAt: now,
    updatedAt: now,
  }

  let initialCapacity = record.maxSlots
  let initialLaneCount = 1
  try {
    const registration = await withRegistryLock(root, async () => {
      const entries = await activeLaneEntries(root, true)
      await atomicWriteJson(path, record)
      const allocations = fairAllocations(cpuCount, [...entries.map(entry => entry.record), record])
      return { capacity: allocations.get(id) ?? 0, laneCount: entries.length + 1 }
    }, options.lockTimeoutMs)
    initialCapacity = registration.capacity
    initialLaneCount = registration.laneCount
  } catch (error) {
    if (error instanceof RegistryLockTimeoutError) {
      throw error
    }
    // An unavailable registry must not make a repository command unrunnable.
    return unregisteredLane(record.maxSlots)
  }

  return registeredLane({
    cpuCount,
    id,
    initialCapacity,
    initialLaneCount,
    lockTimeoutMs: options.lockTimeoutMs,
    path,
    record,
    root,
  })
}

/**
 * fairAllocations redistributes unused ceilings, and is the whole admission rule: a lane's share is
 * the only thing its own reservations are measured against. Every registered lane keeps a floor of
 * one slot, so the machine holds at most `max(cpuCount, laneCount)` slots at once.
 *
 * There used to be a second, machine-wide check — admit only while `cpuCount - Σslots` was positive
 * — and it cancelled that floor exactly when the floor mattered. Lanes that registered while the
 * machine was emptier keep their wider share until each of their running nodes ends, so on a busy
 * machine the sum reaches `cpuCount` and every newcomer is reduced to zero, waiting behind work
 * that will not shrink for minutes. Measured on an 18-CPU host: 18 of 18 slots reserved, CPU under
 * a third busy, nine lanes reporting `waiting` and none of them able to start. The pool that check
 * defended was also never the real resource, since a single slot may run a whole test file's worth
 * of parallel children; lanes that held 4-6 slots were measured driving the load average past 21.
 */
function fairAllocations(
  cpuCount: number,
  records: readonly (LaneRecord & { id: string; maxSlots: number })[],
): Map<string, number> {
  const ordered = [...records].sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id)
  )
  const allocations = new Map(ordered.map(record => [record.id, Math.min(1, record.maxSlots)]))
  let remaining = Math.max(0, cpuCount - ordered.length)
  while (remaining > 0) {
    const eligible = ordered.filter(record => (allocations.get(record.id) ?? 0) < record.maxSlots)
    if (eligible.length === 0) {
      break
    }
    for (const record of eligible) {
      if (remaining === 0) {
        break
      }
      allocations.set(record.id, (allocations.get(record.id) ?? 0) + 1)
      remaining -= 1
    }
  }
  return allocations
}

function contentionReport(options: { cpuCount: number; peakLanes: number; peakLoadAverage: number }): ContentionReport {
  return {
    contended: options.peakLanes > 1 || options.peakLoadAverage > options.cpuCount * CONTENDED_LOAD_RATIO,
    cpuCount: options.cpuCount,
    peakLanes: options.peakLanes,
    peakLoadAverage: Math.round(options.peakLoadAverage * 10) / 10,
  }
}

/**
 * describeExclusiveHolder names the worktree whose confirmation run owns the machine. A lane whose
 * every node reports a bare `waiting` looks broken; naming the holder makes the wait a fact about
 * another run rather than a mystery about this one.
 */
function describeExclusiveHolder(exclusive: ExclusiveRecord, entries: readonly LaneEntry[]): string {
  const holder = entries.find(entry => entry.record.id === exclusive.laneId)
  const where = holder === undefined
    ? `PID ${exclusive.pid}`
    : `${holder.record.lane} in ${FS.basename(holder.record.repositoryRoot)}`
  return `another lane is confirming exclusively (${where})`
}

/**
 * describeShare explains an admission this lane's own share declined, and says how the machine is
 * currently divided, because the share is a function of how many lanes are registered.
 */
function describeShare(
  options: { capacity: number; held: number; laneCount: number; requestedSlots: number },
): string {
  const division = `${options.laneCount} ${options.laneCount === 1 ? 'lane is' : 'lanes are'} registered`
  if (options.held > 0) {
    return `this lane holds ${options.held} of its ${options.capacity} slots; ${division}`
  }
  return `this node wants ${options.requestedSlots} slots, more than this lane's share of `
    + `${options.capacity}; ${division}`
}

function describeContention(report: ContentionReport): string {
  const lanes = report.peakLanes > 1 ? `${report.peakLanes} Tao lanes ran at once` : 'no other Tao lane registered'
  return `${lanes}; load peaked at ${report.peakLoadAverage.toFixed(1)} on ${report.cpuCount} CPUs`
}

function registeredLane(options: {
  cpuCount: number
  id: string
  initialCapacity: number
  initialLaneCount: number
  lockTimeoutMs?: number
  path: string
  record: LaneRecord & { id: string; maxSlots: number }
  root: string
}): MachineLane {
  let peakLanes = options.initialLaneCount
  let peakLoadAverage = Platform.loadAverage()
  let released = false
  let capacity = Math.max(1, options.initialCapacity)
  let admissionPollMs = ADMISSION_POLL_MS
  let waitReason: string | undefined

  const timer = setInterval(() => {
    peakLoadAverage = Math.max(peakLoadAverage, Platform.loadAverage())
    void activeLanes(options.root).then(lanes => {
      peakLanes = Math.max(peakLanes, lanes.length)
      return lanes
    }).catch(() => [])
  }, SAMPLE_INTERVAL_MS)
  timer.unref?.()

  const lane: MachineLane = {
    get capacity() {
      return capacity
    },
    ceiling: options.record.maxSlots,
    id: options.id,
    acquireExclusive: async (timeoutMs = EXCLUSIVE_TIMEOUT_MS) =>
      acquireExclusive(options.root, options.id, timeoutMs, options.lockTimeoutMs),
    report: () => contentionReport({ cpuCount: options.cpuCount, peakLanes, peakLoadAverage }),
    get waitReason() {
      return waitReason
    },
    release: async () => {
      if (released) {
        return
      }
      // Remove both pieces of lane ownership under one registry transaction. Do not mark the local
      // handle released until that transaction succeeds: a transient lock failure must be visible
      // to the caller and a second release must be able to finish the cleanup.
      await withRegistryLock(options.root, async () => {
        const exclusivePath = FS.resolvePath(EXCLUSIVE_PATH, options.root)
        const exclusive = await readRecord<ExclusiveRecord>(exclusivePath)
        if (exclusive?.laneId === options.id) {
          await FS.remove(exclusivePath)
        }
        await FS.remove(options.path)
      }, options.lockTimeoutMs)
      released = true
      clearInterval(timer)
    },
    tryAcquire: async (requestedSlots, allowPartial) => {
      if (released) {
        return undefined
      }
      try {
        const reservation = await withRegistryLock(options.root, async () => {
          const entries = await activeLaneEntries(options.root, true)
          peakLanes = Math.max(peakLanes, entries.length)
          const own = entries.find(entry => entry.record.id === options.id)
          if (own === undefined) {
            waitReason = 'this lane is no longer registered on the machine'
            return undefined
          }
          const exclusive = await liveExclusive(options.root)
          if (exclusive !== undefined && exclusive.laneId !== options.id) {
            waitReason = describeExclusiveHolder(exclusive, entries)
            return undefined
          }
          const allocations = fairAllocations(options.cpuCount, entries.map(entry => entry.record))
          capacity = allocations.get(options.id) ?? 0
          const available = Math.max(0, capacity - own.record.slots)
          const slots = available >= requestedSlots ? requestedSlots : allowPartial ? available : 0
          if (slots <= 0) {
            waitReason = describeShare({
              capacity,
              held: own.record.slots,
              laneCount: entries.length,
              requestedSlots,
            })
            return undefined
          }
          waitReason = undefined
          own.record.slots += slots
          own.record.updatedAt = new Date().toISOString()
          await atomicWriteJson(own.path, own.record)
          return slots
        }, options.lockTimeoutMs)
        if (reservation === undefined) {
          admissionPollMs = Math.min(MAX_ADMISSION_POLL_MS, admissionPollMs * 2)
          return undefined
        }
        admissionPollMs = ADMISSION_POLL_MS
        return slotReservation(options.root, options.id, reservation, options.lockTimeoutMs)
      } catch (error) {
        if (error instanceof RegistryLockTimeoutError) {
          throw error
        }
        // Coordination is advisory only when its storage is actually unavailable.
        return uncoordinatedReservation(requestedSlots)
      }
    },
    waitForAvailability: () => Time.sleep(admissionPollMs),
  }
  return lane
}

function slotReservation(
  root: string,
  laneId: string,
  slots: number,
  lockTimeoutMs?: number,
): MachineSlotReservation {
  let released = false
  return {
    slots,
    release: async () => {
      if (released) {
        return
      }
      await withRegistryLock(root, async () => {
        const own = (await activeLaneEntries(root, false)).find(entry => entry.record.id === laneId)
        if (own === undefined) {
          return
        }
        own.record.slots = Math.max(0, own.record.slots - slots)
        own.record.updatedAt = new Date().toISOString()
        await atomicWriteJson(own.path, own.record)
      }, lockTimeoutMs)
      released = true
    },
  }
}

async function acquireExclusive(
  root: string,
  laneId: string,
  timeoutMs: number,
  lockTimeoutMs?: number,
): Promise<MachineExclusiveLease | undefined> {
  const id = `${Platform.runtimeProcess.pid}-${Platform.randomUUID()}`
  const deadline = Time.nowMs() + Math.max(0, timeoutMs)
  let ownsIntent = false
  while (Time.nowMs() <= deadline) {
    try {
      const drained = await withRegistryLock(root, async () => {
        const existing = await liveExclusive(root)
        if (existing === undefined) {
          const record: ExclusiveRecord = {
            id,
            laneId,
            pid: Platform.runtimeProcess.pid,
            startedAt: new Date().toISOString(),
          }
          await atomicWriteJson(FS.resolvePath(EXCLUSIVE_PATH, root), record)
          ownsIntent = true
        } else if (existing.id === id) {
          ownsIntent = true
        } else {
          return false
        }
        const peers = (await activeLaneEntries(root, true)).filter(entry => entry.record.id !== laneId)
        return peers.every(entry => entry.record.slots === 0)
      }, lockTimeoutMs)
      if (drained && ownsIntent) {
        return exclusiveLease(root, id, lockTimeoutMs)
      }
    } catch {
      // Without a shared registry this run cannot truthfully claim it was isolated.
      return undefined
    }
    await Time.sleep(ADMISSION_POLL_MS)
  }
  if (ownsIntent) {
    await releaseExclusive(root, id, lockTimeoutMs)
  }
  return undefined
}

function exclusiveLease(root: string, id: string, lockTimeoutMs?: number): MachineExclusiveLease {
  let released = false
  return {
    release: async () => {
      if (released) {
        return
      }
      await releaseExclusive(root, id, lockTimeoutMs)
      released = true
    },
  }
}

async function releaseExclusive(root: string, id: string, lockTimeoutMs?: number): Promise<void> {
  await withRegistryLock(root, async () => {
    const existing = await readRecord<ExclusiveRecord>(FS.resolvePath(EXCLUSIVE_PATH, root))
    if (existing?.id === id) {
      await FS.remove(FS.resolvePath(EXCLUSIVE_PATH, root))
    }
  }, lockTimeoutMs)
}

async function liveExclusive(root: string): Promise<ExclusiveRecord | undefined> {
  const path = FS.resolvePath(EXCLUSIVE_PATH, root)
  const record = await readRecord<ExclusiveRecord>(path)
  if (record === undefined || !isLive(record)) {
    await FS.remove(path).catch(() => {})
    return undefined
  }
  return record
}

/**
 * acquireResource waits briefly for a named host resource, then reports the exact owning worktree
 * and command. Native callers use this rather than folding host contention into lane contention.
 */
async function acquireResource(options: AcquireResourceOptions): Promise<MachineResourceLease> {
  const waitTimeoutMs = Math.max(0, options.waitTimeoutMs ?? RESOURCE_WAIT_TIMEOUT_MS)
  const deadline = Time.nowMs() + waitTimeoutMs
  while (true) {
    const outcome = await claimResource(options)
    if (outcome.lease !== undefined) {
      return outcome.lease
    }
    if (Time.nowMs() >= deadline) {
      throw new MachineResourceBusyError(outcome.owner)
    }
    await Time.sleep(Math.min(RESOURCE_POLL_MS, Math.max(1, deadline - Time.nowMs())))
  }
}

/** tryAcquireResource atomically claims a named host resource across all worktrees. */
async function tryAcquireResource(options: ResourceOptions): Promise<MachineResourceLease | undefined> {
  return (await claimResource(options)).lease
}

async function claimResource(
  options: ResourceOptions,
): Promise<{ lease?: MachineResourceLease; owner: MachineResourceOwner }> {
  const root = options.registryRoot ?? registryRoot()
  const id = `${Platform.runtimeProcess.pid}-${Platform.randomUUID()}`
  const path = resourcePath(root, options.name)
  const processIdentity = options.processIdentity ?? inspectProcessIdentity
  const maxAgeMs = options.maxAgeMs ?? MAX_LEASE_AGE_MS
  const owner: MachineResourceOwner = {
    command: options.command ?? options.name,
    id,
    name: options.name,
    pid: Platform.runtimeProcess.pid,
    processStartedAt: (await ownProcessIdentity(processIdentity)).startedAt,
    repositoryRoot: options.repositoryRoot ?? Platform.runtimeProcess.cwd(),
    startedAt: new Date().toISOString(),
  }
  let existingOwner: MachineResourceOwner | undefined
  try {
    const acquired = await withRegistryLock(root, async () => {
      const existing = normalizeResourceRecord(await readRecord<unknown>(path))
      if (
        existing !== undefined
        && !leaseExpired(existing, maxAgeMs)
        && await resourceOwnerIsLive(existing, processIdentity)
      ) {
        existingOwner = existing
        return false
      }
      await FS.remove(path).catch(() => {})
      await atomicWriteJson(path, owner)
      return true
    }, options.lockTimeoutMs)
    if (!acquired) {
      return { owner: existingOwner ?? owner }
    }
  } catch (error) {
    Errors.throwHostEnvironment(`Cannot coordinate machine resource '${options.name}'.`, { cause: error })
  }

  let released = false
  const lease: MachineResourceLease = {
    owner,
    release: async () => {
      if (released) {
        return
      }
      await withRegistryLock(root, async () => {
        const existing = normalizeResourceRecord(await readRecord<unknown>(path))
        if (existing?.id === id) {
          await FS.remove(path)
        }
      }, options.lockTimeoutMs)
      released = true
    },
  }
  return { lease, owner }
}

function unregisteredLane(capacity: number): MachineLane {
  const width = Math.max(1, capacity)
  return {
    capacity: width,
    ceiling: width,
    // Work may fail open when the registry is unavailable; isolation may not, because there is no
    // truthful way to know whether another worktree is still running.
    acquireExclusive: async () => undefined,
    report: () => contentionReport({ cpuCount: Platform.cpuCount(), peakLanes: 1, peakLoadAverage: 0 }),
    release: async () => {},
    tryAcquire: async requestedSlots => uncoordinatedReservation(requestedSlots),
    // Nothing declines an admission here, so there is never a wait to explain.
    waitReason: undefined,
    waitForAvailability: () => Time.sleep(ADMISSION_POLL_MS),
  }
}

async function observingUnregisteredLane(capacity: number, root: string, cpuCount: number): Promise<MachineLane> {
  const width = Math.max(1, capacity)
  let peakLanes = 1
  let peakLoadAverage = Platform.loadAverage()
  let released = false
  const sample = async () => {
    peakLoadAverage = Math.max(peakLoadAverage, Platform.loadAverage())
    const lanes = await activeLanes(root)
    peakLanes = Math.max(peakLanes, lanes.length)
  }
  await sample().catch(() => {})
  const timer = setInterval(() => void sample().catch(() => {}), SAMPLE_INTERVAL_MS)
  timer.unref?.()
  return {
    capacity: width,
    ceiling: width,
    acquireExclusive: async () => undefined,
    report: () => contentionReport({ cpuCount, peakLanes, peakLoadAverage }),
    release: async () => {
      if (!released) {
        released = true
        clearInterval(timer)
        await sample().catch(() => {})
      }
    },
    tryAcquire: async requestedSlots => uncoordinatedReservation(requestedSlots),
    waitReason: undefined,
    waitForAvailability: () => Time.sleep(ADMISSION_POLL_MS),
  }
}

function uncoordinatedReservation(slots: number): MachineSlotReservation {
  return { release: async () => {}, slots: Math.max(1, slots) }
}

async function activeLaneEntries(root: string, prune: boolean): Promise<LaneEntry[]> {
  const entries = await FS.listDir(root)
  const lanes: LaneEntry[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.lane.json') && (!entry.endsWith('.json') || entry.startsWith('.'))) {
      continue
    }
    const path = FS.resolvePath(entry, root)
    const raw = normalizeLaneRecord(await readRecord<unknown>(path), entry)
    if (raw === undefined || !isLive(raw)) {
      if (prune) {
        await FS.remove(path).catch(() => {})
      }
      continue
    }
    lanes.push({
      path,
      record: {
        ...raw,
        id: raw.id,
        maxSlots: raw.maxSlots,
        slots: raw.slots,
      },
    })
  }
  return lanes
}

async function withRegistryLock<T>(
  root: string,
  work: () => Promise<T>,
  timeoutMs = MUTEX_ACQUIRE_TIMEOUT_MS,
): Promise<T> {
  await FS.mkdir(root)
  const ownerRoot = FS.resolvePath('.mutex-contenders', root)
  const ownerPath = FS.resolvePath(`${Platform.runtimeProcess.pid}-${Platform.randomUUID()}.json`, ownerRoot)
  const linkPath = FS.resolvePath(MUTEX_LINK, root)
  await atomicWriteJson(
    ownerPath,
    {
      pid: Platform.runtimeProcess.pid,
      startedAt: new Date().toISOString(),
    } satisfies MutexRecord,
  )
  const deadline = Time.nowMs() + Math.max(0, timeoutMs)

  while (true) {
    try {
      await FS.symlink(FS.relativePath(root, ownerPath), linkPath)
      break
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') {
        await FS.remove(ownerPath).catch(() => {})
        throw error
      }
      const existing = await readRecord<MutexRecord>(linkPath)
      if (existing === undefined || mutexIsStale(existing)) {
        const staleTarget = await mutexTarget(linkPath)
        if (staleTarget !== undefined) {
          await reclaimStaleMutex(root, linkPath, staleTarget)
        }
        continue
      }
      if (Time.nowMs() >= deadline) {
        await FS.remove(ownerPath).catch(() => {})
        throw new RegistryLockTimeoutError('Timed out waiting for the machine-lane registry lock.')
      }
      await Time.sleep(ADMISSION_POLL_MS)
    }
  }

  try {
    return await work()
  } finally {
    const resolved = await FS.realPath(linkPath).catch(() => undefined)
    if (resolved === await FS.realPath(ownerPath).catch(() => ownerPath)) {
      await FS.remove(linkPath).catch(() => {})
    }
    await FS.remove(ownerPath).catch(() => {})
  }
}

/**
 * Reclaims a stale lock without discarding a fresh one. Each contender publishes an immutable,
 * uniquely named claim for the observed owner, waits one poll so simultaneous claimants converge,
 * and only the oldest live claim may unlink that exact owner. A later claimant can never outrank
 * it, and a claimant that arrives after replacement sees a different target at the final check.
 * Crashed claims are safe to prune by their unique path before the next election.
 */
async function reclaimStaleMutex(
  root: string,
  linkPath: string,
  staleTarget: string,
): Promise<void> {
  const targetKey = FS.basename(staleTarget).replaceAll(/[^a-zA-Z0-9._-]/g, '_')
  const claimPrefix = `.mutex-reclaim-${targetKey}-`
  const claimPath = FS.resolvePath(
    `${claimPrefix}${
      String(Date.now()).padStart(16, '0')
    }-${Platform.runtimeProcess.pid}-${Platform.randomUUID()}.json`,
    root,
  )
  await atomicWriteJson(
    claimPath,
    {
      pid: Platform.runtimeProcess.pid,
      startedAt: new Date().toISOString(),
    } satisfies MutexRecord,
  )
  try {
    await Time.sleep(ADMISSION_POLL_MS)
    const claims: string[] = []
    for (const entry of await FS.listDir(root)) {
      if (!entry.startsWith(claimPrefix)) {
        continue
      }
      const path = FS.resolvePath(entry, root)
      const claim = await readRecord<MutexRecord>(path)
      if (claim === undefined || mutexIsStale(claim)) {
        await FS.remove(path).catch(() => {})
        continue
      }
      claims.push(path)
    }
    if (claims.toSorted()[0] !== claimPath) {
      return
    }
    const currentTarget = await mutexTarget(linkPath)
    if (currentTarget === staleTarget) {
      await FS.remove(linkPath)
    }
  } finally {
    await FS.remove(claimPath).catch(() => {})
  }
}

/** mutexTarget identifies even a broken symlink, so absence never compares equal to an old owner. */
async function mutexTarget(linkPath: string): Promise<string | undefined> {
  const result = await CLI.run('/usr/bin/readlink', { args: [linkPath], stdio: 'pipe' })
  const target = result.stdout.trim()
  return result.error === undefined && result.exitCode === 0 && target.length > 0
    ? FS.resolvePath(target, FS.dirname(linkPath))
    : undefined
}

/** ownerIsLive reports whether a recorded resource owner still runs as the process that took the lease. */
async function ownerIsLive(owner: MachineResourceOwner): Promise<boolean> {
  return await resourceOwnerIsLive(owner, inspectProcessIdentity)
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${Platform.runtimeProcess.pid}-${Platform.randomUUID()}.tmp`
  try {
    await FS.writeJson(temporary, value)
    await FS.move(temporary, path)
  } finally {
    await FS.remove(temporary).catch(() => {})
  }
}

async function readRecord<T>(path: string): Promise<T | undefined> {
  try {
    return await FS.readJson<T>(path)
  } catch {
    return undefined
  }
}

function isLive(record: { pid: number; startedAt: string; updatedAt?: string }): boolean {
  if (record.pid === Platform.runtimeProcess.pid) {
    return true
  }
  const timestamp = Date.parse(record.updatedAt ?? record.startedAt ?? '')
  if (Number.isFinite(timestamp) && Time.nowMs() - timestamp > MAX_LEASE_AGE_MS) {
    return false
  }
  return Platform.processIsAlive(record.pid)
}

function mutexIsStale(record: MutexRecord): boolean {
  // Age cannot prove staleness: a delayed but live owner still owns the critical section. Prefer a
  // bounded wait over allowing concurrent writers when a host cannot disambiguate PID reuse.
  return !Platform.processIsAlive(record.pid)
    || !Number.isFinite(Date.parse(record.startedAt))
}

function normalizeLaneRecord(
  value: unknown,
  filename: string,
): (LaneRecord & { id: string }) | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const record = value as Partial<LaneRecord>
  const valid = Number.isInteger(record.pid)
    && (record.pid ?? 0) > 0
    && (record.id === undefined || typeof record.id === 'string')
    && typeof record.lane === 'string'
    && record.lane.length > 0
    && typeof record.repositoryRoot === 'string'
    && typeof record.startedAt === 'string'
    && Number.isFinite(Date.parse(record.startedAt))
    && Number.isInteger(record.slots)
    && (record.slots ?? -1) >= 0
    && (record.maxSlots === undefined || Number.isInteger(record.maxSlots) && record.maxSlots > 0)
  if (!valid) {
    return undefined
  }
  return {
    ...(record as LaneRecord),
    id: record.id ?? filename.replace(/\.json$/, ''),
    // The preceding static allocator stored its entire share in `slots`. Counting that width as
    // occupied is conservative while old and new worktrees overlap during rollout.
    maxSlots: record.maxSlots ?? Math.max(1, record.slots!),
    slots: record.slots!,
  }
}

function normalizeResourceRecord(value: unknown): MachineResourceOwner | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const record = value as Partial<MachineResourceOwner>
  const valid = typeof record.id === 'string'
    && typeof record.name === 'string'
    && Number.isInteger(record.pid)
    && (record.pid ?? 0) > 0
    && typeof record.startedAt === 'string'
    && Number.isFinite(Date.parse(record.startedAt))
    && (record.processStartedAt === undefined || typeof record.processStartedAt === 'string')
    && (record.command === undefined || typeof record.command === 'string')
    && (record.repositoryRoot === undefined || typeof record.repositoryRoot === 'string')
  if (!valid) {
    return undefined
  }
  return {
    command: record.command ?? record.name!,
    id: record.id!,
    name: record.name!,
    pid: record.pid!,
    processStartedAt: record.processStartedAt,
    repositoryRoot: record.repositoryRoot ?? '<unknown worktree>',
    startedAt: record.startedAt!,
  }
}

/**
 * leaseExpired applies a resource's staleness bound. Most leases are short-lived lane leases whose
 * holder may have died without a reachable process identity, so age alone retires them; a resource
 * that opts out with an infinite bound (interactive native Studio) is retired only by identity.
 */
function leaseExpired(owner: MachineResourceOwner, maxAgeMs: number): boolean {
  if (!Number.isFinite(maxAgeMs)) {
    return false
  }
  const timestamp = Date.parse(owner.startedAt)
  return Number.isFinite(timestamp) && Time.nowMs() - timestamp > maxAgeMs
}

let ownIdentity: { pid: number; identity: Promise<ProcessIdentity> } | undefined

/**
 * ownProcessIdentity reads this process's start identity once: it cannot change, and a contended
 * lease is claimed in a tight poll loop that must not spawn `ps` on every attempt.
 */
function ownProcessIdentity(inspect: (pid: number) => Promise<ProcessIdentity>): Promise<ProcessIdentity> {
  const pid = Platform.runtimeProcess.pid
  if (inspect !== inspectProcessIdentity) {
    return inspect(pid)
  }
  if (ownIdentity === undefined || ownIdentity.pid !== pid) {
    ownIdentity = { identity: inspect(pid), pid }
  }
  return ownIdentity.identity
}

/**
 * resourceOwnerIsLive requires evidence that the recorded process identity disappeared or changed
 * before pruning a lease inside its staleness bound: an unreadable process table is uncertainty
 * rather than staleness.
 */
async function resourceOwnerIsLive(
  owner: MachineResourceOwner,
  inspect: (pid: number) => Promise<ProcessIdentity>,
): Promise<boolean> {
  const identity = await inspect(owner.pid)
  if (identity.evidence === 'gone') {
    return false
  }
  if (
    identity.evidence === 'alive'
    && owner.processStartedAt !== undefined
    && identity.startedAt !== undefined
    && owner.processStartedAt !== identity.startedAt
  ) {
    return false
  }
  return true
}

/** inspectProcessIdentity reads the OS start time that distinguishes a live PID from its reuse. */
async function inspectProcessIdentity(pid: number): Promise<ProcessIdentity> {
  try {
    // `lstart` follows locale and time zone; pin both so every process compares the same spelling.
    const result = await CLI.run('ps', {
      args: ['-o', 'lstart=', '-p', String(pid)],
      env: { LC_ALL: 'C', TZ: 'UTC' },
      stdio: 'pipe',
    })
    const startedAt = result.stdout.trim()
    if (result.error === undefined && result.exitCode === 0 && startedAt.length > 0) {
      return { evidence: 'alive', startedAt }
    }
    if (result.error === undefined && !Platform.processIsAlive(pid)) {
      return { evidence: 'gone' }
    }
  } catch {
    // Fall through to the weaker kernel liveness probe. Unknown identity must remain owned.
  }
  return Platform.processIsAlive(pid) ? { evidence: 'unknown' } : { evidence: 'gone' }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined
}

function lanePath(root: string, id: string): string {
  return FS.resolvePath(`${id}.lane.json`, root)
}

function resourcePath(root: string, name: string): string {
  return FS.resolvePath(`resource-${name.replaceAll(/[^a-zA-Z0-9._-]/g, '_')}.lease`, root)
}

/** MachineLanes owns atomic CPU and named-resource coordination across repository worktrees. */
export const MachineLanes = {
  CONTENDED_LOAD_RATIO,
  EXCLUSIVE_TIMEOUT_MS,
  LANE_ID_ENV_KEY,
  acquire,
  acquireResource,
  activeLanes,
  contentionReport,
  describeContention,
  fairAllocations,
  inspectLanes,
  ownerIsLive,
  registryRoot,
  tryAcquireResource,
} as const
