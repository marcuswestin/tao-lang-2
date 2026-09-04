import { Errors, FS, Platform, Time } from '@shared'
import { randomUUID } from 'node:crypto'

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
  release: () => Promise<void>
}

/** MachineLane is one top-level lane's registration and dynamic admission broker. */
export type MachineLane = {
  /** Current fair share, refreshed on admission and useful for initial child-runner sizing. */
  readonly capacity: number
  /** Per-lane ceiling. The broker, not the local graph, applies the changing fair share. */
  readonly ceiling: number
  acquireExclusive: (timeoutMs?: number) => Promise<MachineExclusiveLease | undefined>
  report: () => ContentionReport
  release: () => Promise<void>
  tryAcquire: (requestedSlots: number, allowPartial: boolean) => Promise<MachineSlotReservation | undefined>
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
  registryRoot?: string
  repositoryRoot: string
}

export type ResourceOptions = {
  name: string
  registryRoot?: string
}

type ExclusiveRecord = {
  id: string
  laneId: string
  pid: number
  startedAt: string
}

type ResourceRecord = {
  id: string
  name: string
  pid: number
  startedAt: string
}

type MutexRecord = {
  pid: number
  startedAt: string
}

type LaneEntry = {
  path: string
  record: LaneRecord & { id: string; maxSlots: number }
}

const REGISTRY_DIRECTORY = 'tao/machine-lanes'
const SAMPLE_INTERVAL_MS = 3_000
const ADMISSION_POLL_MS = 25
const MAX_ADMISSION_POLL_MS = 500
const CONTENDED_LOAD_RATIO = 1.5
const MAX_LEASE_AGE_MS = 6 * 60 * 60 * 1_000
const MUTEX_ACQUIRE_TIMEOUT_MS = 30_000
const EXCLUSIVE_TIMEOUT_MS = 5 * 60 * 1_000
const MUTEX_LINK = '.mutex'
const EXCLUSIVE_PATH = '.exclusive'

/** registryRoot resolves the machine-wide directory shared by every worktree. */
function registryRoot(): string {
  const cacheHome = Platform.runtimeProcess.env['XDG_CACHE_HOME']
  const base = cacheHome !== undefined && cacheHome.length > 0 ? cacheHome : FS.resolvePath('.cache', FS.homeDir())
  return FS.resolvePath(REGISTRY_DIRECTORY, base)
}

/** activeLanes returns all live registrations, pruning crashed processes unless asked not to. */
async function activeLanes(root = registryRoot(), options: { prune?: boolean } = {}): Promise<LaneRecord[]> {
  return (await activeLaneEntries(root, options.prune ?? true)).map(entry => entry.record)
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

  const id = `${Platform.runtimeProcess.pid}-${randomUUID()}`
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
    })
    initialCapacity = registration.capacity
    initialLaneCount = registration.laneCount
  } catch {
    // An unavailable registry must not make a repository command unrunnable.
    return unregisteredLane(record.maxSlots)
  }

  return registeredLane({ cpuCount, id, initialCapacity, initialLaneCount, path, record, root })
}

/**
 * fairAllocations redistributes unused ceilings. Every registered lane retains a logical admission
 * floor, even when there are more lanes than CPUs; the separate global-availability check still
 * guarantees that actual reservations never oversubscribe the machine.
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

function describeContention(report: ContentionReport): string {
  const lanes = report.peakLanes > 1 ? `${report.peakLanes} Tao lanes ran at once` : 'no other Tao lane registered'
  return `${lanes}; load peaked at ${report.peakLoadAverage.toFixed(1)} on ${report.cpuCount} CPUs`
}

function registeredLane(options: {
  cpuCount: number
  id: string
  initialCapacity: number
  initialLaneCount: number
  path: string
  record: LaneRecord & { id: string; maxSlots: number }
  root: string
}): MachineLane {
  let peakLanes = options.initialLaneCount
  let peakLoadAverage = Platform.loadAverage()
  let released = false
  let capacity = Math.max(1, options.initialCapacity)
  let admissionPollMs = ADMISSION_POLL_MS

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
    acquireExclusive: async (timeoutMs = EXCLUSIVE_TIMEOUT_MS) => acquireExclusive(options.root, options.id, timeoutMs),
    report: () => contentionReport({ cpuCount: options.cpuCount, peakLanes, peakLoadAverage }),
    release: async () => {
      if (released) {
        return
      }
      released = true
      clearInterval(timer)
      await releaseExclusiveOwnedBy(options.root, options.id)
      try {
        await withRegistryLock(options.root, async () => {
          await FS.remove(options.path)
        })
      } catch {
        await FS.remove(options.path).catch(() => {})
      }
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
            return undefined
          }
          const exclusive = await liveExclusive(options.root)
          if (exclusive !== undefined && exclusive.laneId !== options.id) {
            return undefined
          }
          const allocations = fairAllocations(options.cpuCount, entries.map(entry => entry.record))
          capacity = allocations.get(options.id) ?? 0
          const globallyAvailable = Math.max(
            0,
            options.cpuCount - entries.reduce((sum, entry) => sum + entry.record.slots, 0),
          )
          const laneAvailable = Math.max(0, capacity - own.record.slots)
          const available = Math.min(globallyAvailable, laneAvailable)
          const slots = available >= requestedSlots ? requestedSlots : allowPartial ? available : 0
          if (slots <= 0) {
            return undefined
          }
          own.record.slots += slots
          own.record.updatedAt = new Date().toISOString()
          await atomicWriteJson(own.path, own.record)
          return slots
        })
        if (reservation === undefined) {
          admissionPollMs = Math.min(MAX_ADMISSION_POLL_MS, admissionPollMs * 2)
          return undefined
        }
        admissionPollMs = ADMISSION_POLL_MS
        return slotReservation(options.root, options.id, reservation)
      } catch {
        // Coordination is advisory only when its storage is actually unavailable.
        return uncoordinatedReservation(requestedSlots)
      }
    },
    waitForAvailability: () => Time.sleep(admissionPollMs),
  }
  return lane
}

function slotReservation(root: string, laneId: string, slots: number): MachineSlotReservation {
  let released = false
  return {
    slots,
    release: async () => {
      if (released) {
        return
      }
      released = true
      try {
        await withRegistryLock(root, async () => {
          const own = (await activeLaneEntries(root, false)).find(entry => entry.record.id === laneId)
          if (own === undefined) {
            return
          }
          own.record.slots = Math.max(0, own.record.slots - slots)
          own.record.updatedAt = new Date().toISOString()
          await atomicWriteJson(own.path, own.record)
        })
      } catch {
        // The lane release removes the whole record; a transient accounting failure is not fatal.
      }
    },
  }
}

async function acquireExclusive(
  root: string,
  laneId: string,
  timeoutMs: number,
): Promise<MachineExclusiveLease | undefined> {
  const id = `${Platform.runtimeProcess.pid}-${randomUUID()}`
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
      })
      if (drained && ownsIntent) {
        return exclusiveLease(root, id)
      }
    } catch {
      // Without a shared registry this run cannot truthfully claim it was isolated.
      return undefined
    }
    await Time.sleep(ADMISSION_POLL_MS)
  }
  if (ownsIntent) {
    await releaseExclusive(root, id)
  }
  return undefined
}

function exclusiveLease(root: string, id: string): MachineExclusiveLease {
  let released = false
  return {
    release: async () => {
      if (released) {
        return
      }
      released = true
      await releaseExclusive(root, id)
    },
  }
}

async function releaseExclusive(root: string, id: string): Promise<void> {
  try {
    await withRegistryLock(root, async () => {
      const existing = await readRecord<ExclusiveRecord>(FS.resolvePath(EXCLUSIVE_PATH, root))
      if (existing?.id === id) {
        await FS.remove(FS.resolvePath(EXCLUSIVE_PATH, root))
      }
    })
  } catch {
    // A stale exclusive record is pruned by the next live lane.
  }
}

async function releaseExclusiveOwnedBy(root: string, laneId: string): Promise<void> {
  try {
    await withRegistryLock(root, async () => {
      const path = FS.resolvePath(EXCLUSIVE_PATH, root)
      const existing = await readRecord<ExclusiveRecord>(path)
      if (existing?.laneId === laneId) {
        await FS.remove(path)
      }
    })
  } catch {
    // Best effort during lane teardown.
  }
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

/** tryAcquireResource atomically claims a named host resource across all worktrees. */
async function tryAcquireResource(options: ResourceOptions): Promise<MachineResourceLease | undefined> {
  const root = options.registryRoot ?? registryRoot()
  const id = `${Platform.runtimeProcess.pid}-${randomUUID()}`
  const path = resourcePath(root, options.name)
  try {
    const acquired = await withRegistryLock(root, async () => {
      const existing = await readRecord<ResourceRecord>(path)
      if (existing !== undefined && isLive(existing)) {
        return false
      }
      await FS.remove(path).catch(() => {})
      await atomicWriteJson(
        path,
        {
          id,
          name: options.name,
          pid: Platform.runtimeProcess.pid,
          startedAt: new Date().toISOString(),
        } satisfies ResourceRecord,
      )
      return true
    })
    if (!acquired) {
      return undefined
    }
  } catch (error) {
    throw new Errors.HostEnvironmentError(`Cannot coordinate machine resource '${options.name}'.`, { cause: error })
  }

  let released = false
  return {
    release: async () => {
      if (released) {
        return
      }
      released = true
      try {
        await withRegistryLock(root, async () => {
          const existing = await readRecord<ResourceRecord>(path)
          if (existing?.id === id) {
            await FS.remove(path)
          }
        })
      } catch {
        // A crashed owner is pruned by the next claimant.
      }
    },
  }
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
    waitForAvailability: () => Time.sleep(ADMISSION_POLL_MS),
  }
}

function uncoordinatedReservation(slots: number): MachineSlotReservation {
  return { release: async () => {}, slots: Math.max(1, slots) }
}

async function activeLaneEntries(root: string, prune: boolean): Promise<LaneEntry[]> {
  let entries: string[]
  try {
    entries = await FS.listDir(root)
  } catch {
    return []
  }
  const lanes: LaneEntry[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.lane.json') && (!entry.endsWith('.json') || entry.startsWith('.'))) {
      continue
    }
    const path = FS.resolvePath(entry, root)
    const raw = await readRecord<unknown>(path)
    if (!isLaneRecord(raw) || !isLive(raw)) {
      if (prune) {
        await FS.remove(path).catch(() => {})
      }
      continue
    }
    lanes.push({
      path,
      record: {
        ...raw,
        id: raw.id ?? entry.replace(/\.json$/, ''),
        maxSlots: raw.maxSlots,
        slots: raw.slots,
      },
    })
  }
  return lanes
}

async function withRegistryLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  await FS.mkdir(root)
  const ownerRoot = FS.resolvePath('.mutex-contenders', root)
  const ownerPath = FS.resolvePath(`${Platform.runtimeProcess.pid}-${randomUUID()}.json`, ownerRoot)
  const linkPath = FS.resolvePath(MUTEX_LINK, root)
  await atomicWriteJson(
    ownerPath,
    {
      pid: Platform.runtimeProcess.pid,
      startedAt: new Date().toISOString(),
    } satisfies MutexRecord,
  )
  const deadline = Time.nowMs() + MUTEX_ACQUIRE_TIMEOUT_MS

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
        await FS.remove(linkPath).catch(() => {})
        continue
      }
      if (Time.nowMs() >= deadline) {
        await FS.remove(ownerPath).catch(() => {})
        throw new Errors.HostEnvironmentError('Timed out waiting for the machine-lane registry lock.')
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

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${Platform.runtimeProcess.pid}-${randomUUID()}.tmp`
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
  const startedAt = Date.parse(record.startedAt)
  return !Platform.processIsAlive(record.pid)
    || !Number.isFinite(startedAt)
}

function isLaneRecord(value: unknown): value is LaneRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Partial<LaneRecord>
  return Number.isInteger(record.pid)
    && (record.pid ?? 0) > 0
    && typeof record.lane === 'string'
    && record.lane.length > 0
    && typeof record.repositoryRoot === 'string'
    && typeof record.startedAt === 'string'
    && Number.isFinite(Date.parse(record.startedAt))
    && Number.isFinite(record.slots)
    && (record.slots ?? -1) >= 0
    && Number.isFinite(record.maxSlots)
    && (record.maxSlots ?? 0) > 0
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
  acquire,
  activeLanes,
  contentionReport,
  describeContention,
  fairAllocations,
  registryRoot,
  tryAcquireResource,
} as const
