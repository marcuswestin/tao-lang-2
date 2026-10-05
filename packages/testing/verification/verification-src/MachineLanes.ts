import {
  type AcquireResourceOptions,
  MachineResourceBusyError,
  type MachineResourceLease as HostMachineResourceLease,
  type MachineResourceOwner,
  MachineResources,
  type ProcessIdentity,
  type ResourceOptions,
} from '@host-control'
import { CLI, Errors, FS, Platform, Time } from '@shared'
import { type LaneInterval, type OverlapReport, RunHistory } from './RunHistory'
import { VerificationLanes } from './VerificationLanes'

export { MachineResourceBusyError }
export type { MachineResourceOwner, ProcessIdentity }

/** Compatibility facade for existing lane callers; new host drivers use the fenced package lease. */
export type MachineResourceLease = Pick<HostMachineResourceLease, 'owner' | 'release'>

/** LaneRecord is the live, machine-wide accounting record for one top-level lane. */
export type LaneRecord = {
  /** Unique per acquisition: one process may own more than one lane. */
  id?: string
  lane: string
  /** Per-lane ceiling. */
  maxSlots: number
  /** The lane whose node registered this one, so overlap reports never count a run's own work. */
  parentLaneId?: string
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

/** A landing's verification window admits its child and lanes already running when it began. */
export type LandingPriorityLease = {
  token: string
  release: () => Promise<void>
}

/** LaneQueueEntry is one lane's place in the machine-wide arrival queue. */
export type LaneQueueEntry = {
  /** Admitted lanes run at their own full width; the rest hold nothing until one of them ends. */
  admitted: boolean
  /** 1-based place in arrival order, which is what a queued lane prints. */
  position: number
  record: LaneRecord & { id: string; maxSlots: number }
}

/** MachineLane is one top-level lane's registration and dynamic admission broker. */
export type MachineLane = {
  /**
   * Width this lane may hold right now: its whole ceiling while it is admitted, zero while it is
   * queued behind the lanes that arrived first. Refreshed at every admission.
   */
  readonly capacity: number
  /** Per-lane ceiling. The broker decides whether the lane may use it, not how wide it is. */
  readonly ceiling: number
  /** Registration identity propagated to nested diagnostics so they can exclude their owner. */
  readonly id?: string
  acquireExclusive: (timeoutMs?: number) => Promise<MachineExclusiveLease | undefined>
  /**
   * Which other lanes ran at any moment of this one, read after `release` so the lane's own end is
   * on record. `report` says how busy the machine looked; this says who else was on it.
   */
  overlap: () => Promise<OverlapReport>
  report: () => ContentionReport
  release: () => Promise<void>
  tryAcquire: (requestedSlots: number, allowPartial: boolean) => Promise<MachineSlotReservation | undefined>
  /**
   * Why the last admission attempt was declined, in words a waiting run can show. A lane that sits
   * at zero running nodes is otherwise indistinguishable from a lane that is merely slow.
   */
  readonly waitReason: string | undefined
  waitForAvailability: () => Promise<void>
  /** Wait before taking a GUI or prepare lease if a landing began before this lane registered. */
  waitForLandingPriority: () => Promise<void>
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
  /**
   * Injected by tests. A run's contention verdict turns on this reading, so a test that means an
   * idle or a busy machine has to be able to say so; sampling the real host makes the assertion
   * depend on what every other worktree happens to be doing.
   */
  loadAverage?: () => number
  /** Injected by tests. */
  lockTimeoutMs?: number
  registryRoot?: string
  repositoryRoot: string
  /** Injected by tests; production inherits the landing child's transaction token. */
  landingPriorityToken?: string
}

type ExclusiveRecord = {
  id: string
  laneId: string
  pid: number
  startedAt: string
}

type LandingPriorityRecord = {
  id: string
  pid: number
  startedAt: string
  existingLaneIds: string[]
  ownerLaneIds: string[]
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

const SAMPLE_INTERVAL_MS = 3_000
const ADMISSION_POLL_MS = 25
const MAX_ADMISSION_POLL_MS = 500
/**
 * How long a queued lane waits between admission attempts. Nothing a queued lane is waiting for can
 * change faster than a whole lane finishing, and every attempt takes the one registry mutex every
 * other lane admits through, so polling at the admitted lane's rate spends the machine's only
 * serialization point on answers that cannot have changed.
 */
const QUEUED_POLL_MS = 1_000
/**
 * How many whole lanes may run at once on one machine, chosen from the run record rather than from
 * a share of the CPUs: 260 recorded lane runs bucketed by overlap gave a median of 37.8s alone,
 * 54.7s against one peer (1.45x), 75.8s against two (2.0x) and 691.3s against three. Two is the
 * largest overlap that stays inside the 1.5x-of-uncontended bar this policy exists to meet, and
 * those medians were measured while each lane was *also* throttled to a fraction of the machine, so
 * a third lane at full width would be worse than the 2.0x that already misses the bar.
 *
 * It is deliberately not scaled by CPU count: a lane's own ceiling is already the CPU count, so the
 * machine's size is expressed in how wide each admitted lane runs, not in how many are admitted.
 */
const ADMITTED_LANES = 2
const CONTENDED_LOAD_RATIO = 1.5
const MAX_LEASE_AGE_MS = 6 * 60 * 60 * 1_000
const MUTEX_ACQUIRE_TIMEOUT_MS = 30_000
const EXCLUSIVE_TIMEOUT_MS = 5 * 60 * 1_000
const MUTEX_LINK = '.mutex'
const EXCLUSIVE_PATH = '.exclusive'
const LANDING_PRIORITY_PATH = '.landing-priority'
const LANE_ID_ENV_KEY = 'TAO_MACHINE_LANE_ID'
const LANDING_PRIORITY_ENV_KEY = 'TAO_LANDING_PRIORITY_TOKEN'

/** registryRoot resolves the machine-wide directory shared by every worktree. */
function registryRoot(): string {
  return MachineResources.registryRoot()
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
  const loadAverage = options.loadAverage ?? (() => Platform.loadAverage())
  if (options.reservedJobs !== undefined) {
    return observingUnregisteredLane(options.reservedJobs, root, cpuCount, loadAverage)
  }

  const id = `${Platform.runtimeProcess.pid}-${Platform.randomUUID()}`
  const path = lanePath(root, id)
  const now = new Date().toISOString()
  const parentLaneId = Platform.runtimeProcess.env[LANE_ID_ENV_KEY]
  const record: LaneRecord & { id: string; maxSlots: number } = {
    id,
    lane: options.lane,
    maxSlots: Math.max(1, options.requestedJobs ?? cpuCount),
    ...(parentLaneId === undefined || parentLaneId.length === 0 ? {} : { parentLaneId }),
    pid: Platform.runtimeProcess.pid,
    repositoryRoot: options.repositoryRoot,
    slots: 0,
    startedAt: now,
    updatedAt: now,
  }

  let initialCapacity = record.maxSlots
  let initialLaneCount = 1
  let initialPeers: LaneRecord[] = []
  const landingPriorityToken = options.landingPriorityToken ?? Platform.runtimeProcess.env[LANDING_PRIORITY_ENV_KEY]
  try {
    const registration = await withRegistryLock(root, async () => {
      const entries = await activeLaneEntries(root, true)
      const priority = await liveLandingPriority(root)
      if (priority !== undefined && priority.id === landingPriorityToken) {
        priority.ownerLaneIds.push(id)
        await atomicWriteJson(FS.resolvePath(LANDING_PRIORITY_PATH, root), priority)
      }
      await atomicWriteJson(path, record)
      const queue = laneQueue([...entries.map(entry => entry.record), record])
      const own = queue.find(entry => entry.record.id === id)
      return {
        capacity: own?.admitted === true ? record.maxSlots : 0,
        laneCount: entries.length + 1,
        peers: entries.map(entry => entry.record),
      }
    }, options.lockTimeoutMs)
    initialCapacity = registration.capacity
    initialLaneCount = registration.laneCount
    initialPeers = registration.peers
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
    initialPeers,
    loadAverage,
    lockTimeoutMs: options.lockTimeoutMs,
    path,
    record,
    root,
    landingPriorityToken,
  })
}

/**
 * laneQueue puts every live lane in arrival order and admits the first `ADMITTED_LANES` *broad*
 * lanes (`VerificationLanes.BROAD`) whole. An admitted broad lane may reserve up to its own ceiling; a
 * queued broad lane reserves nothing at all until a broad lane ahead of it ends.
 *
 * Only broad lanes compete for the `ADMITTED_LANES` positions, and only broad lanes can be queued at
 * all. A narrow lane — everything not in `VerificationLanes.BROAD`, including a lane name this module
 * has never seen — is always admitted, in any number, because it is not one of the runs this cap
 * exists to bound: `test-file`, a named test, `test-retry`, `check`, `fix`, `fmt`, and the diff-scoped
 * lanes all finish in seconds, and an agent runs the first of those roughly twenty times an hour. A
 * whole-lane queue that made no distinction here would starve the command an agent runs most behind a
 * `verify-full` that can run for minutes, which is worse than the fair-share bound this cap replaced,
 * not better. An unrecognized lane name is treated as narrow rather than broad on purpose: the failure
 * mode of wrongly queueing an interactive command is worse than the failure mode of admitting one lane
 * this cap did not mean to count. A narrow lane's own `maxSlots` ceiling, governed by `requestedJobs`,
 * still bounds it — this is a queue exemption, not a licence to take the machine.
 *
 * This replaces splitting the machine between every registered lane at once. That split was a
 * fairness bound dressed as a CPU bound, and it failed as both: 13 live lanes were measured holding
 * two admitted slots between them while 16 of 18 CPUs' worth of budget went unissued, and the load
 * average still reached 36 on those 18 CPUs. Both halves of that measurement say the same thing —
 * **a slot does not describe what a suite spawns**. One slot may run a whole test file's parallel
 * children, so the sum of admitted slots is not a quantity of CPU and dividing it finer only made
 * every lane narrow without making the machine any quieter. No correction factor is invented here,
 * because none can be derived from what is recorded: the bound that *can* be defended is the number
 * of whole broad lanes, since a broad lane at its ceiling is by construction one machine's worth of
 * work.
 *
 * Arrival order is a total order over live broad records, and a broad lane that registers later
 * always sorts later, so a queued lane can never be overtaken and the queue drains strictly in order.
 * Arrival is recorded to the millisecond and a tie falls back to the registration id, which is
 * arbitrary but fixed — two lanes that registered in the same millisecond did arrive together, and
 * what matters is that every worktree reading the registry orders them the same way on every poll.
 * The one way an admitted broad lane loses its place is a record appearing with an older timestamp
 * than its own — a lease written by an older worktree, or a clock stepping backwards; its
 * already-running nodes are unaffected and simply drain.
 */
function laneQueue(records: readonly (LaneRecord & { id: string; maxSlots: number })[]): LaneQueueEntry[] {
  const arrival = (left: { id: string; startedAt: string }, right: { id: string; startedAt: string }) =>
    left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id)
  const broadRank = new Map(
    records.filter(record => isBroadLane(record.lane)).toSorted(arrival).map((record, index) => [record.id, index]),
  )
  return [...records].sort(arrival).map(record => {
    const rank = broadRank.get(record.id)
    return rank === undefined
      ? { admitted: true, position: 0, record }
      : { admitted: rank < ADMITTED_LANES, position: rank + 1, record }
  })
}

/** isBroadLane says whether a lane name competes for `ADMITTED_LANES`; an unknown name is narrow. */
function isBroadLane(lane: string): boolean {
  return VerificationLanes.BROAD.includes(lane)
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
  const where = holder === undefined ? `PID ${exclusive.pid}` : describeLane(holder.record)
  return `another lane is confirming exclusively (${where})`
}

/** describeLane names one lane the way every wait in this module names one: lane, then worktree. */
function describeLane(record: LaneRecord): string {
  return `${record.lane} in ${FS.basename(record.repositoryRoot)}`
}

function joinNames(names: readonly string[]): string {
  return names.length < 2 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * describeQueuePosition is the one thing the landing lock deliberately does not print, and the
 * difference is that this wait has an order. A lane held back here is behind a known list of lanes
 * that will end, so its position is a fact it can show and watch shrink; the landing lock's only
 * question is whether someone else holds it, and a position there would be invented.
 *
 * `queue` is whatever `laneQueue` returned — every live lane, broad and narrow together — so this
 * filters to the broad ones itself rather than trusting a caller to have done it. A narrow lane is
 * never queued, so counting one into "of N lanes" or "N more queued ahead" would describe a wait that
 * lane is not causing; only a broad lane ever reaches this function in the first place (see
 * `tryAcquire`), and its position and total are counted among broad lanes only.
 */
function describeQueuePosition(queue: readonly LaneQueueEntry[], laneId: string): string {
  const broadQueue = queue.filter(entry => isBroadLane(entry.record.lane))
  const place = broadQueue.findIndex(entry => entry.record.id === laneId)
  const ahead = broadQueue.slice(0, Math.max(place, 0))
  const running = ahead.filter(entry => entry.admitted).map(entry => describeLane(entry.record))
  const queuedAhead = ahead.length - running.length
  const holders = running.length === 0
    ? 'no lane is running'
    : `${joinNames(running)} ${running.length === 1 ? 'is' : 'are'} running`
  const queued = queuedAhead === 0
    ? ''
    : `, ${queuedAhead} more ${queuedAhead === 1 ? 'lane is' : 'lanes are'} queued ahead`
  return `queued at position ${place + 1} of ${broadQueue.length} lanes; ${holders}${queued}`
}

/**
 * describeShare separates the two ways an admitted lane still declines a node: the lane is already
 * running its whole width, or this node is wider than what is left of it. Both name the width,
 * because a lane admitted whole is bounded by its own ceiling and by nothing else.
 */
function describeShare(options: {
  available: number
  capacity: number
  held: number
  laneCount: number
  requestedSlots: number
}): string {
  const division = `${options.laneCount} ${options.laneCount === 1 ? 'lane is' : 'lanes are'} registered`
  if (options.held >= options.capacity) {
    return `this lane holds ${options.held} of its ${options.capacity} slots; ${division}`
  }
  return `this node wants ${options.requestedSlots} slots, more than the ${options.available} free `
    + `to this lane; ${division}`
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
  initialPeers: readonly LaneRecord[]
  loadAverage: () => number
  lockTimeoutMs?: number
  path: string
  record: LaneRecord & { id: string; maxSlots: number }
  root: string
  landingPriorityToken?: string
}): MachineLane {
  let peakLanes = options.initialLaneCount
  const loadAverageAtStart = options.loadAverage()
  let peakLoadAverage = loadAverageAtStart
  let released = false
  let endedAt: string | undefined
  // Every other lane this one saw while sampling. The lane log covers lanes that ended normally;
  // this covers one that crashed without logging its end.
  const seen = new Map<string, LaneInterval>()
  const sight = (records: readonly LaneRecord[]) => {
    for (const record of records) {
      if (record.id !== undefined && record.id !== options.id) {
        seen.set(record.id, laneInterval(record))
      }
    }
  }
  sight(options.initialPeers)
  // Zero is a real answer here: a queued lane holds nothing until a lane ahead of it ends.
  let capacity = Math.max(0, options.initialCapacity)
  let admissionPollMs = ADMISSION_POLL_MS
  let queuedPoll = false
  let waitReason: string | undefined

  const landingPriorityAllows = async (): Promise<boolean> =>
    await withRegistryLock(options.root, async () => {
      const priority = await liveLandingPriority(options.root)
      if (
        priority === undefined || priority.id === options.landingPriorityToken
        || priority.existingLaneIds.includes(options.id) || priority.ownerLaneIds.includes(options.id)
        || !isBroadLane(options.record.lane)
      ) {
        return true
      }
      waitReason = `landing verification has priority (PID ${priority.pid})`
      return false
    }, options.lockTimeoutMs)

  const timer = setInterval(() => {
    peakLoadAverage = Math.max(peakLoadAverage, options.loadAverage())
    void activeLanes(options.root).then(lanes => {
      peakLanes = Math.max(peakLanes, lanes.length)
      sight(lanes)
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
    overlap: async () => {
      try {
        return await RunHistory.overlap({
          live: released ? (await activeLanes(options.root, { prune: false })).map(laneInterval) : [],
          loadAverageAtStart,
          own: { endedAt: endedAt ?? new Date().toISOString(), id: options.id, startedAt: options.record.startedAt },
          registryRoot: options.root,
          seen: [...seen.values()],
        })
      } catch {
        return RunHistory.unknownOverlap(loadAverageAtStart)
      }
    },
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
      endedAt = new Date().toISOString()
      await RunHistory.recordLaneInterval(options.root, { ...laneInterval(options.record), endedAt })
    },
    tryAcquire: async (requestedSlots, allowPartial) => {
      if (released) {
        return undefined
      }
      try {
        const reservation = await withRegistryLock(options.root, async () => {
          const entries = await activeLaneEntries(options.root, true)
          peakLanes = Math.max(peakLanes, entries.length)
          sight(entries.map(entry => entry.record))
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
          const priority = await liveLandingPriority(options.root)
          if (
            priority !== undefined && priority.id !== options.landingPriorityToken
            && !priority.existingLaneIds.includes(options.id) && !priority.ownerLaneIds.includes(options.id)
            && isBroadLane(own.record.lane)
          ) {
            waitReason = `landing verification has priority (PID ${priority.pid})`
            return undefined
          }
          // A lane paused by this window must not occupy one of the two broad positions ahead of
          // the landing child. Its registration remains visible for diagnostics and cleanup.
          const queue = laneQueue(
            entries
              .filter(entry =>
                priority === undefined
                || !isBroadLane(entry.record.lane)
                || priority.existingLaneIds.includes(entry.record.id)
                || priority.ownerLaneIds.includes(entry.record.id)
              )
              .map(entry => entry.record),
          )
          const admitted = queue.find(entry => entry.record.id === options.id)?.admitted === true
          // An admitted lane owns its whole ceiling. There is no machine-wide slot total to check
          // against any more: the machine is divided by whole broad lanes, and a narrow lane is
          // always admitted, so this lane is either one of the former or is never queued at all.
          capacity = admitted ? own.record.maxSlots : 0
          if (!admitted) {
            queuedPoll = true
            waitReason = describeQueuePosition(queue, options.id)
            return undefined
          }
          queuedPoll = false
          const available = Math.max(0, capacity - own.record.slots)
          const slots = available >= requestedSlots ? requestedSlots : allowPartial ? available : 0
          if (slots <= 0) {
            waitReason = describeShare({
              available,
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
          admissionPollMs = queuedPoll
            ? QUEUED_POLL_MS
            : Math.min(MAX_ADMISSION_POLL_MS, admissionPollMs * 2)
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
    waitForLandingPriority: async () => {
      while (!released) {
        try {
          if (await landingPriorityAllows()) {
            return
          }
        } catch (error) {
          if (error instanceof RegistryLockTimeoutError) {
            throw error
          }
          // A missing registry cannot enforce an advisory priority window.
          return
        }
        await Time.sleep(QUEUED_POLL_MS)
      }
    },
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
 * Capture lanes that arrived before the landing window. They keep progressing, including through
 * resource leases, so an existing lane cannot be stranded while holding GUI or prepare. New lanes
 * pause before acquiring either resource and before starting any graph node.
 */
async function beginLandingPriority(root = registryRoot()): Promise<LandingPriorityLease | undefined> {
  const id = `${Platform.runtimeProcess.pid}-${Platform.randomUUID()}`
  try {
    const created = await withRegistryLock(root, async () => {
      if (await liveLandingPriority(root) !== undefined) {
        return false
      }
      const existingLaneIds = (await activeLaneEntries(root, true)).map(entry => entry.record.id)
      await atomicWriteJson(
        FS.resolvePath(LANDING_PRIORITY_PATH, root),
        {
          id,
          pid: Platform.runtimeProcess.pid,
          startedAt: new Date().toISOString(),
          existingLaneIds,
          ownerLaneIds: [],
        } satisfies LandingPriorityRecord,
      )
      return true
    })
    if (!created) {
      return undefined
    }
  } catch {
    // Priority is an optimization. The landing lock and verification still provide correctness.
    return undefined
  }
  let released = false
  return {
    token: id,
    release: async () => {
      if (released) {
        return
      }
      await withRegistryLock(root, async () => {
        const current = await readRecord<LandingPriorityRecord>(FS.resolvePath(LANDING_PRIORITY_PATH, root))
        if (current?.id === id) {
          await FS.remove(FS.resolvePath(LANDING_PRIORITY_PATH, root))
        }
      })
      released = true
    },
  }
}

async function liveLandingPriority(root: string): Promise<LandingPriorityRecord | undefined> {
  const path = FS.resolvePath(LANDING_PRIORITY_PATH, root)
  const record = await readRecord<LandingPriorityRecord>(path)
  if (
    record !== undefined && typeof record.id === 'string'
    && Array.isArray(record.existingLaneIds) && record.existingLaneIds.every(id => typeof id === 'string')
    && Array.isArray(record.ownerLaneIds) && record.ownerLaneIds.every(id => typeof id === 'string')
    && Number.isInteger(record.pid) && typeof record.startedAt === 'string' && isLive(record)
  ) {
    return record
  }
  if (record !== undefined) {
    await FS.remove(path).catch(() => {})
  }
  return undefined
}

async function acquireResource(options: AcquireResourceOptions): Promise<MachineResourceLease> {
  return await MachineResources.acquire(options)
}

async function tryAcquireResource(options: ResourceOptions): Promise<MachineResourceLease | undefined> {
  return await MachineResources.tryAcquire(options)
}

function unregisteredLane(capacity: number): MachineLane {
  const width = Math.max(1, capacity)
  return {
    capacity: width,
    ceiling: width,
    // Work may fail open when the registry is unavailable; isolation may not, because there is no
    // truthful way to know whether another worktree is still running.
    acquireExclusive: async () => undefined,
    overlap: async () => RunHistory.unknownOverlap(0),
    report: () => contentionReport({ cpuCount: Platform.cpuCount(), peakLanes: 1, peakLoadAverage: 0 }),
    release: async () => {},
    tryAcquire: async requestedSlots => uncoordinatedReservation(requestedSlots),
    // Nothing declines an admission here, so there is never a wait to explain.
    waitReason: undefined,
    waitForAvailability: () => Time.sleep(ADMISSION_POLL_MS),
    waitForLandingPriority: async () => {},
  }
}

async function observingUnregisteredLane(
  capacity: number,
  root: string,
  cpuCount: number,
  loadAverage: () => number,
): Promise<MachineLane> {
  const width = Math.max(1, capacity)
  let peakLanes = 1
  let peakLoadAverage = loadAverage()
  let released = false
  const sample = async () => {
    peakLoadAverage = Math.max(peakLoadAverage, loadAverage())
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
    // A nested run is its outer lane's work; that lane owns the overlap question.
    overlap: async () => RunHistory.unknownOverlap(peakLoadAverage),
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
    waitForLandingPriority: async () => {},
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

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined
}

/** laneInterval is the part of a lane's registration the lane log keeps. */
function laneInterval(record: LaneRecord): LaneInterval {
  return {
    id: record.id ?? `${record.pid}-${record.startedAt}`,
    lane: record.lane,
    ...(record.parentLaneId === undefined ? {} : { parentLaneId: record.parentLaneId }),
    pid: record.pid,
    repositoryRoot: record.repositoryRoot,
    startedAt: record.startedAt,
  }
}

function lanePath(root: string, id: string): string {
  return FS.resolvePath(`${id}.lane.json`, root)
}

/** MachineLanes owns atomic CPU and named-resource coordination across repository worktrees. */
export const MachineLanes = {
  ADMITTED_LANES,
  CONTENDED_LOAD_RATIO,
  EXCLUSIVE_TIMEOUT_MS,
  LANE_ID_ENV_KEY,
  LANDING_PRIORITY_ENV_KEY,
  acquire,
  beginLandingPriority,
  acquireResource,
  activeLanes,
  contentionReport,
  describeContention,
  inspectLanes,
  laneQueue,
  ownerIsLive: MachineResources.ownerIsLive,
  registryRoot,
  tryAcquireResource,
  withRegistryLock,
} as const
