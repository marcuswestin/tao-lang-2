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
 * Ownership therefore comes in two kinds, and conflating them lets one command unlock another's
 * protection. A **durable** claim is what `land-lock` takes: it belongs to the agent, outlives
 * every command run under it, and ends only at `land-unlock`. A **scoped** hold is what a broad
 * lane takes for its own duration, and it is handed back by the token it was given. The record
 * survives until no durable claim and no scoped token remain, which is what makes two concurrent
 * lanes in one checkout safe — the first to finish returns its own token and nothing else.
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
 *
 * Unlike `MachineLanes.acquire`, which degrades to running unbrokered when the registry cannot be
 * read, this fails closed: a registry it cannot reach is a lock it cannot check, and proceeding
 * would be guessing that nobody is landing. A broad lane is worth failing rather than guessing at;
 * every narrow command stays runnable regardless, so a registry outage never blocks iteration.
 */

/** LandingLockRecord is the whole state of the lock: who holds it, from when, and doing what. */
export type LandingLockRecord = {
  acquiredAt: string
  /**
   * True when an agent claimed the lock explicitly with `land-lock`. A durable claim outlives every
   * command and is ended only by `land-unlock`, which is what lets one agent hold the lock across
   * verifying and then landing.
   */
  durable: boolean
  /** The worktree that holds the lock. */
  holder: string
  /** What the holder said it was doing, printed to whoever waits and to the board. */
  label: string
  /** The process that took it. Informational only: the lock is designed to outlive it. */
  pid: number
  /**
   * One entry per command-scoped hold still running in the holding worktree. Re-entrancy is
   * counted rather than assumed, because two broad lanes routinely run in one checkout: if the
   * first to finish deleted the record, the second would still be verifying while another worktree
   * took the lock. The record survives until every hold is returned and no durable claim remains.
   *
   * Each carries the pid that took it, and that is sound where it would not be for the durable
   * claim: a scoped hold lasts exactly as long as one command, so its process being gone proves
   * the hold is over. Without this a Ctrl-C'd `verify` would strand its hold and wedge the machine
   * behind a lock nothing is using. The durable claim keeps no pid, because it is designed to
   * outlive the process that took it and liveness would prove nothing about it.
   */
  scopedHolds: readonly LandingLockScopedHold[]
}

/** LandingLockScopedHold is one running command's claim on the lock, and the process running it. */
export type LandingLockScopedHold = {
  pid: number
  token: string
}

/** LandingLockHold is what an acquisition returns: the record, and what this call must give back. */
export type LandingLockHold = {
  /** True when this call created the record rather than joining a hold its worktree already had. */
  acquired: boolean
  record: LandingLockRecord
  /** Present for a scoped hold: the token that `release` must be given to return exactly this one. */
  token?: string
}

/** LandingLockState is the three answers a lock file can give, which are not two. */
export type LandingLockState =
  | { kind: 'free' }
  | { kind: 'held'; record: LandingLockRecord }
  | { kind: 'unreadable'; reason: string }

export type AcquireLandingLockOptions = {
  /** Claim it durably, as `land-lock` does, rather than for the length of one command. */
  durable?: boolean
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
  /** Return one scoped hold. Omitted, this ends the durable claim instead. */
  token?: string
}

/** ReleaseOutcome says what the release did: freed the lock, returned one of several holds, or found none. */
export type ReleaseOutcome = 'not-held' | 'released' | 'still-held'

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
 *
 * It matches the landing's own wait deliberately. A shorter one would throw away an hour of waiting
 * over a holder that is legitimately slow — this repository has a recorded verification run of
 * 1798.2s under load — and leave the caller no better off than when it started.
 */
const DEFAULT_WAIT_TIMEOUT_MS = 6 * 60 * 60 * 1_000

export class LandingLockBusyError extends Errors.HostEnvironmentError {
  readonly holder: LandingLockRecord

  constructor(message: string, holder: LandingLockRecord) {
    super(message)
    this.holder = holder
  }
}

/**
 * A lock file that cannot be read is not a lock that is free. Treating it as free is the one bug
 * that hands two worktrees the same lock, so acquisition refuses and asks for a person.
 */
export class LandingLockUnreadableError extends Errors.HostEnvironmentError {
  constructor(reason: string) {
    super(
      `The landing lock record exists but cannot be read (${reason}), so this cannot tell whether a `
        + 'landing is in progress. Refusing to take the lock rather than risk two agents holding it. '
        + 'Confirm no landing is running, then clear it with `./dev land-unlock --force`.',
    )
  }
}

/**
 * A record with no durable claim and no surviving scoped hold is the residue of commands that were
 * interrupted. It holds nothing, so it must not hold up the machine.
 */
function isAbandoned(record: LandingLockRecord): boolean {
  return !record.durable && record.scopedHolds.length === 0
}

/**
 * Compare holders by their resolved path. `Repo.getRoot()` returns the spelling the caller's cwd
 * had, so a symlinked or differently-cased path to one worktree yields two strings, and the
 * worktree would then queue behind its own lock and be told to force-release itself. The lane
 * registry already canonicalizes for exactly this reason.
 */
async function canonicalHolder(path: string): Promise<string> {
  return await FS.realPath(path).catch(() => path)
}

function lockPath(registryRoot: string): string {
  return FS.resolvePath(LOCK_FILE, registryRoot)
}

/**
 * Read the lock as one of three answers rather than two. "No file" and "a file I cannot parse" are
 * opposite situations — the first means nobody holds it, the second means somebody may — and
 * collapsing them into `undefined` is what let a truncated record hand the lock to a second
 * worktree while the first was still landing.
 */
async function readLockState(registryRoot: string): Promise<LandingLockState> {
  const path = lockPath(registryRoot)
  if (!await FS.exists(path)) {
    return { kind: 'free' }
  }
  let parsed: unknown
  try {
    parsed = await FS.readJson<unknown>(path)
  } catch (error) {
    return { kind: 'unreadable', reason: error instanceof Error ? error.message : 'unparsable' }
  }
  const record = asLandingLockRecord(parsed)
  if (record === undefined) {
    return { kind: 'unreadable', reason: 'unrecognized shape' }
  }
  // Decided here and nowhere else, so that acquiring, releasing, and everything that merely reports
  // the lock agree on what "held" means. A record whose durable claim is gone and whose scoped
  // holds all died with their processes is residue, and `board` must not call it held while the
  // next `verify` would walk straight past it.
  return isAbandoned(record) ? { kind: 'free' } : { kind: 'held', record }
}

function asLandingLockRecord(value: unknown): LandingLockRecord | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const record = value as Partial<LandingLockRecord>
  if (
    typeof record.acquiredAt !== 'string' || typeof record.holder !== 'string'
    || typeof record.label !== 'string' || typeof record.pid !== 'number'
  ) {
    return undefined
  }
  return {
    acquiredAt: record.acquiredAt,
    durable: record.durable === true,
    holder: record.holder,
    label: record.label,
    pid: record.pid,
    scopedHolds: liveScopedHolds(record.scopedHolds),
  }
}

/**
 * Keep the scoped holds whose process is still running. This is the one reclamation this module
 * performs, and it is evidence rather than a guess: a scoped hold cannot outlive its command.
 */
function liveScopedHolds(value: unknown): readonly LandingLockScopedHold[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((entry): entry is LandingLockScopedHold =>
      typeof entry === 'object' && entry !== null
      && typeof (entry as LandingLockScopedHold).token === 'string'
      && typeof (entry as LandingLockScopedHold).pid === 'number'
    )
    .filter(entry => Platform.processIsAlive(entry.pid))
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

/** Report the current holder, or undefined when the lock is free or unreadable. */
async function inspect(registryRoot = MachineLanes.registryRoot()): Promise<LandingLockRecord | undefined> {
  const state = await readLockState(registryRoot)
  return state.kind === 'held' ? state.record : undefined
}

/** Report the lock's full state, including the unreadable case a caller may need to act on. */
async function inspectState(registryRoot = MachineLanes.registryRoot()): Promise<LandingLockState> {
  return await readLockState(registryRoot)
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
  const repositoryRoot = await canonicalHolder(options.repositoryRoot)
  return await MachineLanes.withRegistryLock(registryRoot, async () => {
    const state = await readLockState(registryRoot)
    if (state.kind === 'unreadable') {
      throw new LandingLockUnreadableError(state.reason)
    }
    const durable = options.durable === true
    const scoped: LandingLockScopedHold | undefined = durable
      ? undefined
      : { pid: Platform.runtimeProcess.pid, token: Platform.randomUUID() }
    const token = scoped?.token
    if (state.kind === 'held') {
      const existing = state.record
      if (existing.holder !== repositoryRoot) {
        return { holder: existing }
      }
      // Same worktree: join the hold rather than queue behind ourselves, and record the join so
      // whichever command finishes first cannot release protection the others still need.
      const record: LandingLockRecord = {
        ...existing,
        durable: existing.durable || durable,
        scopedHolds: scoped === undefined ? existing.scopedHolds : [...existing.scopedHolds, scoped],
      }
      await writeLock(registryRoot, record)
      return { hold: { acquired: false, record, ...(token === undefined ? {} : { token }) } }
    }
    const record: LandingLockRecord = {
      acquiredAt: new Date().toISOString(),
      durable,
      holder: repositoryRoot,
      label: options.label,
      pid: Platform.runtimeProcess.pid,
      scopedHolds: scoped === undefined ? [] : [scoped],
    }
    await writeLock(registryRoot, record)
    return { hold: { acquired: true, record, ...(token === undefined ? {} : { token }) } }
  })
}

/**
 * Give back one hold. A scoped hold returns its token; a durable claim returns none. The record is
 * deleted only when nothing is left holding it, which is what keeps one command from releasing the
 * protection another command in the same worktree is still relying on.
 *
 * Releasing a lock nobody holds is a no-op, so a cleanup path is always safe to run; releasing
 * another worktree's is refused, because that is the takeover this design never does implicitly.
 * A removal that fails is reported rather than swallowed: a lock that is still on disk after a
 * `PASS` blocks the whole machine, and that is the last thing to find out about by guessing.
 */
async function release(options: ReleaseLandingLockOptions): Promise<ReleaseOutcome> {
  const registryRoot = options.registryRoot ?? MachineLanes.registryRoot()
  const repositoryRoot = await canonicalHolder(options.repositoryRoot)
  return await MachineLanes.withRegistryLock(registryRoot, async () => {
    const state = await readLockState(registryRoot)
    if (state.kind === 'free') {
      return 'not-held'
    }
    if (state.kind === 'unreadable') {
      throw new LandingLockUnreadableError(state.reason)
    }
    const existing = state.record
    if (existing.holder !== repositoryRoot) {
      Errors.throwUserInput(
        `The landing lock is held by ${describe(existing)}, not by this worktree, so this cannot `
          + 'release it. Release it from that worktree, or use `./dev land-unlock --force` if you have '
          + 'confirmed that landing is no longer running.',
      )
    }
    const remaining: LandingLockRecord = {
      ...existing,
      durable: options.token === undefined ? false : existing.durable,
      scopedHolds: options.token === undefined
        ? existing.scopedHolds
        : existing.scopedHolds.filter(held => held.token !== options.token),
    }
    if (remaining.durable || remaining.scopedHolds.length > 0) {
      await writeLock(registryRoot, remaining)
      return 'still-held'
    }
    await FS.remove(lockPath(registryRoot))
    return 'released'
  })
}

/**
 * Release whoever holds the lock, including a record too corrupt to name one. This is the
 * person-shaped escape hatch the automatic paths refuse to be, and it returns the record it removed
 * so the caller can say whose lock it just ended.
 */
async function forceRelease(registryRoot = MachineLanes.registryRoot()): Promise<LandingLockRecord | undefined> {
  return await MachineLanes.withRegistryLock(registryRoot, async () => {
    const state = await readLockState(registryRoot)
    if (state.kind === 'free') {
      return undefined
    }
    // An unreadable record is exactly the case a person reaches for this command to clear, so it
    // must delete the file rather than read past it.
    await FS.remove(lockPath(registryRoot))
    return state.kind === 'held' ? state.record : undefined
  })
}

/**
 * Run `work` holding the lock, releasing it afterwards only when this call is what took it. A
 * command that finds its own worktree already holding the lock leaves it held, because the agent
 * took it deliberately and expects it to still be there for the landing that follows.
 */
async function holding<T>(options: AcquireLandingLockOptions, work: (hold: LandingLockHold) => Promise<T>): Promise<T> {
  const hold = await acquire({ ...options, durable: false })
  let failed = false
  try {
    return await work(hold)
  } catch (error) {
    failed = true
    throw error
  } finally {
    const giveBack = release({
      repositoryRoot: options.repositoryRoot,
      ...(options.registryRoot === undefined ? {} : { registryRoot: options.registryRoot }),
      ...(hold.token === undefined ? {} : { token: hold.token }),
    })
    // A failed release matters — it leaves the machine blocked — so it is only swallowed when the
    // work itself already threw, where rethrowing it would hide the error the caller came for.
    if (failed) {
      await giveBack.catch(() => {})
    } else {
      await giveBack
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
  inspectState,
  holdingForLane,
  inspect,
  release,
  requiresLock,
} as const
