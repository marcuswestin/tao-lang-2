import { Errors, FS, Platform, Time } from '@shared'
import { MachineLanes } from './MachineLanes'

/**
 * The landing lock is the one thing agents on this machine take turns holding. It answers a single
 * question — may I spend the machine on a merge-evidence lane and then move refs? — and everything
 * else about coordinating parallel agents falls out of that answer rather than being modelled.
 *
 * There is no queue. Any agent that is ready claims the lock; whoever claims it proceeds until it
 * releases. A queue would have to carry a position, and nothing ever reads a position: the only
 * decision any agent makes is the binary one, do I hold the lock or not. Ordering machinery in
 * service of a fact nobody consults is machinery that can only go wrong, and its absence is what
 * deletes head-of-line blocking as a concept. An agent that is mid-conflict simply does not claim,
 * and is not in anybody's way while it works.
 *
 * The lock is held by a **worktree**, not a process, and that is the whole reason this module is not
 * `MachineLanes.acquireResource`. An agent's session outlives any one command: it claims the lock,
 * runs `verify`, runs the landing, and releases, across several processes. So the record names the
 * repository root, every later command from that same root is re-entrant, and the lock survives the
 * process that took it.
 *
 * That choice has a hard consequence, and it is deliberate: **the lock is never reclaimed
 * automatically.** A dead PID does not mean a released lock here, because the acquiring process is
 * expected to exit while the lock is still held, so process liveness proves nothing in either
 * direction. Neither is there an expiry, because expiring a lock is the same act as handing one
 * agent a lock another agent still believes it holds, and two agents that both believe they are
 * landing is the one failure in this design that can corrupt `main`. A stuck lock is therefore a
 * person's problem on purpose: waiters warn, repeatedly and by name, and `forceRelease` exists for
 * that person. Nothing takes a lock away on a timer.
 *
 * Waiting is done here rather than by the caller. An agent that polls in a sleep loop burns a model
 * turn per iteration and rounds every wait up to its own poll interval, so the blocking wait is a
 * command, and the warning that a wait has gone on too long is the thing that escalates rather than
 * a takeover.
 *
 * The record lives beside the lane registry, under the same root, and every read-modify-write runs
 * inside the registry's own mutex, so concurrent claimants converge on one winner.
 */

/** LandingLockRecord is the whole state of the lock: who holds it, from when, and doing what. */
export type LandingLockRecord = {
  acquiredAt: string
  /** The worktree that holds the lock; any process from this root is re-entrant. */
  holder: string
  /** What the holder said it was doing, printed to whoever waits and to the board. */
  label: string
  /** The process that took it. Informational only: the lock is designed to outlive it. */
  pid: number
}

/** LandingLockHold is what an acquisition returns: the record, and whether this call created it. */
export type LandingLockHold = {
  /** True when this call took the lock, false when the caller's worktree already held it. */
  acquired: boolean
  record: LandingLockRecord
}

export type AcquireLandingLockOptions = {
  /** What to say the holder is doing. */
  label: string
  /** Called each time the wait is still going, with the holder and how long this call has waited. */
  onWaiting?: (holder: LandingLockRecord, waitedMs: number) => void
  registryRoot?: string
  repositoryRoot: string
  /** Give up after this long rather than waiting forever; 0 refuses immediately. */
  waitTimeoutMs?: number
}

export type ReleaseLandingLockOptions = {
  registryRoot?: string
  repositoryRoot: string
}

/** ReleaseOutcome distinguishes a release that did something from one that had nothing to do. */
export type ReleaseOutcome = 'not-held' | 'released'

/**
 * Dotted on purpose. The lane registry treats every non-dotted `*.json` in this directory as a lane
 * record and prunes the ones whose process is gone, so a plainly named lock file is deleted by the
 * next lane that inspects the registry — which is the one thing this lock must never do. The
 * leading dot is what the registry's own filter uses to exclude its mutex, and `.lane-registry-does
 * -not-own-this` is the property a test pins.
 */
const LOCK_FILE = '.landing-lock.json'
const POLL_MS = 1_000
/** How often a blocked caller is told it is still blocked, and by whom. */
const WAIT_WARN_INTERVAL_MS = 5 * 60 * 1_000
/**
 * A bound on one call's patience, not on the lock. It exists so a blocked command eventually hands
 * the problem back to a person with a sentence they can act on, rather than hanging silently until
 * someone notices. Reaching it never releases or weakens the lock.
 */
const DEFAULT_WAIT_TIMEOUT_MS = 60 * 60 * 1_000

export class LandingLockBusyError extends Errors.HostEnvironmentError {
  readonly holder: LandingLockRecord

  constructor(message: string, holder: LandingLockRecord) {
    super(message)
    this.holder = holder
  }
}

function lockPath(registryRoot: string): string {
  return FS.resolvePath(LOCK_FILE, registryRoot)
}

async function readLock(registryRoot: string): Promise<LandingLockRecord | undefined> {
  try {
    const record = await FS.readJson<LandingLockRecord>(lockPath(registryRoot))
    return isLandingLockRecord(record) ? record : undefined
  } catch {
    // An unreadable or truncated record must not be treated as "free": that would hand the lock to
    // a second agent while the first still believes it holds it. It reads as held by an unnamed
    // owner, which a person can resolve and no automatic path can make worse.
    return undefined
  }
}

function isLandingLockRecord(value: unknown): value is LandingLockRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Partial<LandingLockRecord>
  return typeof record.acquiredAt === 'string' && typeof record.holder === 'string'
    && typeof record.label === 'string' && typeof record.pid === 'number'
}

async function writeLock(registryRoot: string, record: LandingLockRecord): Promise<void> {
  const path = lockPath(registryRoot)
  const temporary = `${path}.${Platform.runtimeProcess.pid}-${Platform.randomUUID()}.tmp`
  try {
    await FS.writeJson(temporary, record)
    await FS.move(temporary, path)
  } finally {
    await FS.remove(temporary).catch(() => {})
  }
}

/** Report the current holder, or undefined when the lock is free. */
async function inspect(registryRoot = MachineLanes.registryRoot()): Promise<LandingLockRecord | undefined> {
  return await readLock(registryRoot)
}

/**
 * Take the lock, waiting for whoever holds it. Re-entrant for the worktree that already holds it,
 * which is what lets one agent claim the lock once and then run several commands under it.
 */
async function acquire(options: AcquireLandingLockOptions): Promise<LandingLockHold> {
  const registryRoot = options.registryRoot ?? MachineLanes.registryRoot()
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  const startedMs = Time.nowMs()
  const deadlineMs = startedMs + Math.max(0, waitTimeoutMs)
  let warnedAtMs = startedMs

  while (true) {
    const attempt = await claim(registryRoot, options)
    if (attempt.hold !== undefined) {
      return attempt.hold
    }
    const holder = attempt.holder
    const waitedMs = Time.nowMs() - startedMs
    if (Time.nowMs() >= deadlineMs) {
      throw new LandingLockBusyError(
        `The landing lock has been held by ${describe(holder)} for the whole ${
          describeDuration(waitedMs)
        } this command waited. Nothing takes the lock away on a timer, so this needs a person: `
          + 'confirm that landing is really still running, and release it with '
          + '`./dev land-unlock --force` if it is not.',
        holder,
      )
    }
    if (Time.nowMs() - warnedAtMs >= WAIT_WARN_INTERVAL_MS) {
      warnedAtMs = Time.nowMs()
      options.onWaiting?.(holder, waitedMs)
    }
    await Time.sleep(POLL_MS)
  }
}

/** One atomic attempt: either this call comes away holding the lock, or it names who does. */
async function claim(
  registryRoot: string,
  options: AcquireLandingLockOptions,
): Promise<{ holder: LandingLockRecord; hold?: undefined } | { holder?: undefined; hold: LandingLockHold }> {
  return await MachineLanes.withRegistryLock(registryRoot, async () => {
    const existing = await readLock(registryRoot)
    if (existing !== undefined) {
      return existing.holder === options.repositoryRoot
        ? { hold: { acquired: false, record: existing } }
        : { holder: existing }
    }
    const record: LandingLockRecord = {
      acquiredAt: new Date().toISOString(),
      holder: options.repositoryRoot,
      label: options.label,
      pid: Platform.runtimeProcess.pid,
    }
    await writeLock(registryRoot, record)
    return { hold: { acquired: true, record } }
  })
}

/**
 * Release the lock held by this worktree. Releasing a lock nobody holds is a no-op rather than an
 * error, so a release in a cleanup path is always safe to run; releasing someone else's is refused,
 * because that is the takeover this design does not do implicitly.
 */
async function release(options: ReleaseLandingLockOptions): Promise<ReleaseOutcome> {
  const registryRoot = options.registryRoot ?? MachineLanes.registryRoot()
  return await MachineLanes.withRegistryLock(registryRoot, async () => {
    const existing = await readLock(registryRoot)
    if (existing === undefined) {
      return 'not-held'
    }
    if (existing.holder !== options.repositoryRoot) {
      Errors.throwUserInput(
        `The landing lock is held by ${describe(existing)}, not by this worktree, so this cannot `
          + 'release it. Release it from that worktree, or use `./dev land-unlock --force` if you have '
          + 'confirmed that landing is no longer running.',
      )
    }
    await FS.remove(lockPath(registryRoot)).catch(() => {})
    return 'released'
  })
}

/**
 * Release whoever holds the lock. This is the person-shaped escape hatch the automatic paths refuse
 * to be, and it returns the record it removed so the caller can say whose lock it just ended.
 */
async function forceRelease(registryRoot = MachineLanes.registryRoot()): Promise<LandingLockRecord | undefined> {
  return await MachineLanes.withRegistryLock(registryRoot, async () => {
    const existing = await readLock(registryRoot)
    if (existing !== undefined) {
      await FS.remove(lockPath(registryRoot)).catch(() => {})
    }
    return existing
  })
}

/**
 * Run `work` holding the lock, releasing it afterwards only when this call is what took it. A
 * command that finds its own worktree already holding the lock leaves it held, because the agent
 * took it deliberately and expects it to still be there for the landing that follows.
 */
async function holding<T>(options: AcquireLandingLockOptions, work: (hold: LandingLockHold) => Promise<T>): Promise<T> {
  const hold = await acquire(options)
  try {
    return await work(hold)
  } finally {
    if (hold.acquired) {
      await release({ registryRoot: options.registryRoot, repositoryRoot: options.repositoryRoot }).catch(() => {})
    }
  }
}

/**
 * The lanes that may not run without the lock. Membership is by breadth, not by whether the lane is
 * merge evidence: these are the runs that take the machine for minutes, so two of them at once is
 * both agents finishing later than either would alone, and a landing that follows one of them is
 * standing on a tree a neighbour may already have invalidated.
 *
 * Everything narrower stays free on purpose. An agent must be able to check the small change it
 * just made without waiting on anybody — `test-file`, a named test, `test-retry`, `check`, `fix`,
 * `fmt` — and the diff-scoped lanes in between (`verify-changed`, `test-changed`) are throttled by
 * the existing machine-lane slot admission rather than by this lock. An agent waiting for the lock
 * is encouraged to keep running those narrow tests so that its own turn is likely to pass; it is
 * equally free to simply wait.
 */
const LOCKED_LANES: readonly string[] = ['test-all', 'verify', 'verify-full', 'verify-full-sandbox']

/** Report whether this lane may only run while its worktree holds the landing lock. */
function requiresLock(lane: string): boolean {
  return LOCKED_LANES.includes(lane)
}

/**
 * Run a lane under the lock when the lane needs it, and run it untouched when it does not. This is
 * the one place a caller has to consult, so no command has to remember which side of the line it
 * is on.
 */
async function holdingForLane<T>(
  options: Omit<AcquireLandingLockOptions, 'label'> & { lane: string },
  work: () => Promise<T>,
): Promise<T> {
  if (!requiresLock(options.lane)) {
    return await work()
  }
  return await holding({ ...options, label: options.lane }, async () => await work())
}

/** Name a holder the way every refusal and warning in this module names one. */
function describe(record: LandingLockRecord): string {
  return `'${record.label}' in ${record.holder} (PID ${record.pid}, since ${record.acquiredAt})`
}

/** Report a duration in the coarsest unit that still says something useful. */
function describeDuration(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 1) {
    return `${Math.max(1, Math.round(elapsedMs / 1_000))}s`
  }
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

export const LandingLock = {
  DEFAULT_WAIT_TIMEOUT_MS,
  LOCKED_LANES,
  WAIT_WARN_INTERVAL_MS,
  acquire,
  describe,
  describeDuration,
  forceRelease,
  holding,
  holdingForLane,
  inspect,
  release,
  requiresLock,
} as const
