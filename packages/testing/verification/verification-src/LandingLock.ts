import { Errors, FS, Platform, Time } from '@shared'
import { MachineLanes } from './MachineLanes'
import { VerificationLanes } from './VerificationLanes'

/**
 * The landing lock is the one thing agents on this machine take turns holding. It answers a single
 * question — may I spend the machine on a merge-evidence lane and then move refs? — and everything
 * else about coordinating parallel agents falls out of that answer rather than being modelled.
 *
 * Ready landings register a process-scoped FIFO turn before waiting. A dead waiter is pruned, and
 * a waiter that encounters a conflict leaves the queue; only the durable lock is never reclaimed.
 * New broad lanes yield to ready landings, but a lane already holding the lock is never preempted.
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

/**
 * The phases a landing transaction passes through, in the order it passes through them. A hold that
 * names its phase and when that phase began is the difference between a lock doing useful work and a
 * lock waiting on an agent: `36m held, cheap gates 34m` is a wedged command, `36m held, host proof
 * 9m` is a landing earning its turn. Nothing else on the machine could reconstruct that — the record
 * used to carry `acquiredAt` and nothing more, so every hold looked identical from the outside and
 * hold duration had to be inferred from what an agent said it had been doing.
 */
export const LANDING_PHASES = [
  'integrating',
  'cheap gates',
  'repository tests',
  'host proof',
  'push',
  'cleanup',
] as const

/** LandingPhaseName is one of the phases a landing transaction reports while it holds the lock. */
export type LandingPhaseName = typeof LANDING_PHASES[number]

/**
 * LandingLockPhase is one phase's span. The end is written when the next phase begins, so an entry
 * with no `endedAt` is the phase running now and is what a waiter is actually waiting on.
 */
export type LandingLockPhase = {
  endedAt?: string
  name: string
  startedAt: string
}

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
  /**
   * True when this hold is a landing transaction rather than a broad lane. It is what tells the
   * admission check in `admitLane` that new diff-scoped lanes must wait: a `verify` holding the lock
   * is a peer to throttle against, while a landing is a turn already being spent and every lane
   * admitted beside it makes that turn longer.
   */
  landing: boolean
  /**
   * What the landing has done with its turn, oldest first. Empty for a hold that reports nothing,
   * which is every hold that is not a landing.
   */
  phases: readonly LandingLockPhase[]
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
  /** Mark this hold a landing transaction, which reports phases and defers diff-scoped lanes. */
  landing?: boolean
  /** Called each time the wait is still going, with the holder and how long this call has waited. */
  onWaiting?: (holder: LandingLockRecord, waitedMs: number) => void
  /** Work that can safely refresh a ready landing while another worktree owns the lock. */
  onQueueWait?: () => Promise<void>
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
const QUEUE_FILE = '.landing-queue.json'
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
        + 'Confirm no landing is running, then clear it with `./dev land-unlock --force` — a corrupt '
        + 'record names no PID, so no `--holder` is needed.',
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

type LandingQueueEntry = { holder: string; label: string; pid: number; token: string }
export type LandingQueueWaiter = Pick<LandingQueueEntry, 'holder' | 'pid'>

function queuePath(registryRoot: string): string {
  return FS.resolvePath(QUEUE_FILE, registryRoot)
}

/** A damaged queue cannot be treated as empty: that would let a later claimant jump ahead. */
async function readQueue(registryRoot: string): Promise<LandingQueueEntry[]> {
  const path = queuePath(registryRoot)
  if (!await FS.exists(path)) {
    return []
  }
  let value: unknown
  try {
    value = await FS.readJson<unknown>(path)
  } catch (error) {
    Errors.throwHostEnvironment(`The landing queue cannot be read: ${String(error)}`)
  }
  if (
    !Array.isArray(value) || !value.every(entry =>
      typeof entry === 'object' && entry !== null
      && typeof entry.holder === 'string' && typeof entry.label === 'string'
      && typeof entry.pid === 'number' && typeof entry.token === 'string'
    )
  ) {
    Errors.throwHostEnvironment('The landing queue has an unrecognized shape; refusing to bypass it.')
  }
  return (value as LandingQueueEntry[]).filter(entry => Platform.processIsAlive(entry.pid))
}

async function writeQueue(registryRoot: string, entries: readonly LandingQueueEntry[]): Promise<void> {
  const path = queuePath(registryRoot)
  const temporary = `${path}.${Platform.runtimeProcess.pid}-${Platform.randomUUID()}.tmp`
  try {
    await FS.writeJson(temporary, entries)
    await FS.move(temporary, path)
  } finally {
    await FS.remove(temporary).catch(() => {})
  }
}

async function enqueue(registryRoot: string, repositoryRoot: string, token: string): Promise<void> {
  const holder = await canonicalHolder(repositoryRoot)
  await MachineLanes.withRegistryLock(registryRoot, async () => {
    const queue = await readQueue(registryRoot)
    await writeQueue(registryRoot, [...queue, {
      holder,
      label: 'ready landing',
      pid: Platform.runtimeProcess.pid,
      token,
    }])
  })
}

async function dequeue(registryRoot: string, token: string): Promise<void> {
  await MachineLanes.withRegistryLock(registryRoot, async () => {
    const queue = await readQueue(registryRoot)
    await writeQueue(registryRoot, queue.filter(entry => entry.token !== token))
  })
}

async function inspectQueue(registryRoot = MachineLanes.registryRoot()): Promise<LandingQueueWaiter[]> {
  return (await readQueue(registryRoot)).map(({ holder, pid }) => ({ holder, pid }))
}

function queueHolder(entry: LandingQueueEntry): LandingLockRecord {
  return {
    acquiredAt: new Date().toISOString(),
    durable: false,
    holder: entry.holder,
    label: entry.label,
    landing: true,
    phases: [],
    pid: entry.pid,
    scopedHolds: [],
  }
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
    landing: record.landing === true,
    phases: readPhases(record.phases),
    pid: record.pid,
    scopedHolds: liveScopedHolds(record.scopedHolds),
  }
}

/**
 * Phases are telemetry, so a record written before this field existed, or one whose entries are
 * malformed, degrades to "this hold reports nothing" rather than to an unreadable lock. An
 * unreadable lock refuses every acquisition on the machine, and that is far too much to pay for a
 * progress line.
 */
function readPhases(value: unknown): readonly LandingLockPhase[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((entry): LandingLockPhase[] => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const phase = entry as Partial<LandingLockPhase>
    if (typeof phase.name !== 'string' || typeof phase.startedAt !== 'string') {
      return []
    }
    return [{
      name: phase.name,
      startedAt: phase.startedAt,
      ...(typeof phase.endedAt === 'string' ? { endedAt: phase.endedAt } : {}),
    }]
  })
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
  const queueToken = options.landing === true ? Platform.randomUUID() : undefined
  if (queueToken !== undefined) {
    await enqueue(registryRoot, options.repositoryRoot, queueToken)
  }
  const waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  const startedMs = Time.nowMs()
  const deadlineMs = startedMs + Math.max(0, waitTimeoutMs)
  let reportedAtMs = startedMs
  let reportedWaiting = false

  try {
    while (true) {
      const attempt = await claim(registryRoot, options, queueToken)
      if (attempt.hold !== undefined) {
        return attempt.hold
      }
      const holder = attempt.holder
      const waitedMs = Time.nowMs() - startedMs
      if (Time.nowMs() >= deadlineMs) {
        throw new LandingLockBusyError(
          `The landing lock has been held by ${describe(holder)} for the whole ${
            describeDuration(waitedMs)
          } this command waited. A dead PID would not mean it was released, and waiting this long is `
            + "not unusual on its own. Forcing it is Ro's call — bring the output of `./agent board` to "
            + 'Ro rather than clearing it yourself.',
          holder,
        )
      }
      if (!reportedWaiting || Time.nowMs() - reportedAtMs >= WAIT_WARN_INTERVAL_MS) {
        reportedWaiting = true
        reportedAtMs = Time.nowMs()
        options.onWaiting?.(holder, waitedMs)
      }
      await options.onQueueWait?.()
      await Time.sleep(POLL_MS)
    }
  } finally {
    if (queueToken !== undefined) {
      await dequeue(registryRoot, queueToken)
    }
  }
}

/** One atomic attempt: either this call comes away holding the lock, or it names who does. */
async function claim(
  registryRoot: string,
  options: AcquireLandingLockOptions,
  queueToken?: string,
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
        // A landing joining a hold its own worktree already had is still a landing, and the
        // admission check reads this rather than the label, so it has to survive the join.
        landing: existing.landing || options.landing === true,
        scopedHolds: scoped === undefined ? existing.scopedHolds : [...existing.scopedHolds, scoped],
      }
      await writeLock(registryRoot, record)
      return { hold: { acquired: false, record, ...(token === undefined ? {} : { token }) } }
    }
    const queue = await readQueue(registryRoot)
    const first = queue[0]
    if (first !== undefined && first.token !== queueToken) {
      return { holder: queueHolder(first) }
    }
    const record: LandingLockRecord = {
      acquiredAt: new Date().toISOString(),
      durable,
      holder: repositoryRoot,
      label: options.label,
      landing: options.landing === true,
      phases: [],
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
          + "release it. Release it from that worktree instead; forcing it is Ro's call, so bring the "
          + 'output of `./agent board` to Ro rather than clearing it yourself.',
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

export type PhaseOptions = {
  registryRoot?: string
  repositoryRoot: string
}

/**
 * Begin a phase, closing whichever one was open. Telemetry must never be able to fail a landing, so
 * this reports rather than throws: a lock that is free, unreadable, or held by somebody else simply
 * records nothing, because writing a phase into another worktree's record is the one thing worse
 * than having no phase at all.
 *
 * It writes through the registry mutex like every other mutation here, so a phase written while a
 * second command in the same worktree joins the hold cannot lose that join.
 */
async function beginPhase(options: PhaseOptions & { name: LandingPhaseName }): Promise<LandingLockRecord | undefined> {
  return await mutatePhases(options, phases => [
    ...closeOpenPhases(phases),
    { name: options.name, startedAt: new Date().toISOString() },
  ])
}

/** Close the phase still running, which is what the end of a transaction leaves behind. */
async function endPhases(options: PhaseOptions): Promise<LandingLockRecord | undefined> {
  return await mutatePhases(options, closeOpenPhases)
}

function closeOpenPhases(phases: readonly LandingLockPhase[]): LandingLockPhase[] {
  const endedAt = new Date().toISOString()
  return phases.map(phase => phase.endedAt === undefined ? { ...phase, endedAt } : phase)
}

async function mutatePhases(
  options: PhaseOptions,
  change: (phases: readonly LandingLockPhase[]) => readonly LandingLockPhase[],
): Promise<LandingLockRecord | undefined> {
  const registryRoot = options.registryRoot ?? MachineLanes.registryRoot()
  const repositoryRoot = await canonicalHolder(options.repositoryRoot)
  return await MachineLanes.withRegistryLock(registryRoot, async () => {
    const state = await readLockState(registryRoot)
    if (state.kind !== 'held' || state.record.holder !== repositoryRoot) {
      return undefined
    }
    const record: LandingLockRecord = { ...state.record, phases: change(state.record.phases) }
    await writeLock(registryRoot, record)
    return record
  }).catch(() => undefined)
}

/** Report whether a landing transaction is spending the machine's turn right now. */
async function landingInProgress(registryRoot = MachineLanes.registryRoot()): Promise<boolean> {
  const state = await readLockState(registryRoot).catch((): LandingLockState => ({ kind: 'free' }))
  return state.kind === 'held' && state.record.landing
}

/**
 * The lanes a landing stops admitting. Once a landing has taken the turn, every diff-scoped lane
 * started beside it is machine the landing is not getting, and the landing is the only run on the
 * machine whose length a person is waiting on. Already-running lanes are left alone — killing work
 * that is nearly done buys nothing — and everything narrower stays free, so an agent can still run
 * `test-file`, a named test, `check`, or `fix` while somebody lands.
 */
const DEFERRED_WHILE_LANDING: readonly string[] = [VerificationLanes.VERIFY_CHANGED, VerificationLanes.TEST_CHANGED]

/** Report whether this lane is one a landing in progress defers. */
function deferredWhileLanding(lane: string): boolean {
  return DEFERRED_WHILE_LANDING.includes(lane)
}

export type AdmitLaneOptions = {
  lane: string
  onWaiting?: (holder: LandingLockRecord, waitedMs: number) => void
  registryRoot?: string
  waitTimeoutMs?: number
}

/**
 * Wait for a landing to finish before starting a diff-scoped lane. This is deliberately not the lock
 * — the lane never takes it, so it cannot deadlock against a landing and cannot delay one by holding
 * anything — it is only a refusal to start while somebody else's turn is being spent.
 *
 * Every worktree waits, not only the other ones. Several agents share one checkout in this
 * repository, so "the landing's own worktree" is also where the neighbours are, and admitting them
 * on that basis would defeat the whole check. The landing itself never reaches here: its own lanes
 * are `check` and `verify-full`, neither of which is deferred.
 */
async function admitLane(options: AdmitLaneOptions): Promise<void> {
  if (!deferredWhileLanding(options.lane)) {
    return
  }
  const registryRoot = options.registryRoot ?? MachineLanes.registryRoot()
  const startedMs = Time.nowMs()
  const deadlineMs = startedMs + Math.max(0, options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS)
  let reportedAtMs = startedMs
  let reportedWaiting = false
  while (true) {
    const state = await readLockState(registryRoot).catch((): LandingLockState => ({ kind: 'free' }))
    if (state.kind !== 'held' || !state.record.landing) {
      return
    }
    const waitedMs = Time.nowMs() - startedMs
    if (Time.nowMs() >= deadlineMs) {
      throw new LandingLockBusyError(
        `A landing has been running for the whole ${describeDuration(waitedMs)} this '${options.lane}' lane `
          + `waited to start: ${describe(state.record)}. Run a narrower command — \`test-file\`, a named test, `
          + '`check`, or `fix` — none of which a landing defers.',
        state.record,
      )
    }
    if (!reportedWaiting || Time.nowMs() - reportedAtMs >= WAIT_WARN_INTERVAL_MS) {
      reportedWaiting = true
      reportedAtMs = Time.nowMs()
      options.onWaiting?.(state.record, waitedMs)
    }
    await Time.sleep(POLL_MS)
  }
}

export type ForceReleaseOptions = {
  /**
   * The PID the caller believes holds the lock, printed by every waiter message. This is an
   * identity check against the record, never a liveness check — a dead PID never proved the lock
   * was free, so it cannot prove this force is aimed at the lock the caller actually watched. A
   * held, readable record refuses without a match; an unreadable one has no PID to match against,
   * so `--force` alone still clears it, as it always could.
   */
  holder?: number
}

/**
 * Release whoever holds the lock, including a record too corrupt to name one. This is the
 * person-shaped escape hatch the automatic paths refuse to be, and it returns the record it removed
 * so the caller can say whose lock it just ended.
 *
 * The identity check runs inside the same registry lock as the read, so there is no gap between
 * confirming the holder and deleting the record for a different one to land in. That gap is exactly
 * how one waiter broke a second lane's lock: it read the holder, the first lane released on its own,
 * a second lane claimed the lock, and the waiter's force then deleted that unrelated claim.
 */
async function forceRelease(
  registryRoot = MachineLanes.registryRoot(),
  options: ForceReleaseOptions = {},
): Promise<LandingLockRecord | undefined> {
  return await MachineLanes.withRegistryLock(registryRoot, async () => {
    const state = await readLockState(registryRoot)
    if (state.kind === 'free') {
      return undefined
    }
    if (state.kind === 'unreadable') {
      // An unreadable record is exactly the case a person reaches for this command to clear, and it
      // names no PID to check `options.holder` against, so `--force` alone is still enough.
      await FS.remove(lockPath(registryRoot))
      return undefined
    }
    const existing = state.record
    if (options.holder === undefined || options.holder !== existing.pid) {
      Errors.throwUserInput(
        `The landing lock is held by ${describe(existing)}, which is not the holder this call named. `
          + '`--force` breaks only the lock whose holder was checked, named with `--holder <pid>`; a '
          + 'different holder is a different decision, so look at it afresh rather than retrying.',
      )
    }
    await FS.remove(lockPath(registryRoot))
    return existing
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

/** The lanes that may not run without the lock; the list itself lives with the other lane names. */
const LOCKED_LANES: readonly string[] = VerificationLanes.LOCKED

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
    // A diff-scoped lane takes nothing, but it does wait: see `admitLane`. Everything narrower
    // returns from here immediately, which is what keeps iteration free during a landing.
    await admitLane({
      lane: options.lane,
      onWaiting: (holder, waitedMs) => options.onWaiting?.(holder, waitedMs),
      ...(options.registryRoot === undefined ? {} : { registryRoot: options.registryRoot }),
      ...(options.waitTimeoutMs === undefined ? {} : { waitTimeoutMs: options.waitTimeoutMs }),
    })
    return await work()
  }
  return await holding({ ...options, label: options.lane }, async () => await work())
}

/**
 * Name a holder the way every refusal and warning in this module names one, and say what it is doing
 * now. The phase is the part a waiter can act on: a hold whose current phase is minutes old is
 * verifying, and a hold with no phase at all after a landing started is a command that stopped.
 */
function describe(record: LandingLockRecord, now = new Date()): string {
  const phase = currentPhase(record)
  const doing = phase === undefined
    ? ''
    : `, ${phase.name} for ${describeDuration(Math.max(0, now.getTime() - Date.parse(phase.startedAt)))}`
  return `'${record.label}' in ${record.holder} (PID ${record.pid}, since ${record.acquiredAt}${doing})`
}

/** The phase running now, which is the one entry that was never closed. */
function currentPhase(record: LandingLockRecord): LandingLockPhase | undefined {
  return record.phases.find(phase => phase.endedAt === undefined)
}

/** How long this hold has lasted, measured rather than reconstructed from what an agent reported. */
function heldForMs(record: LandingLockRecord, now = new Date()): number {
  return Math.max(0, now.getTime() - Date.parse(record.acquiredAt))
}

/**
 * Every phase with what it cost, newest last, for the board. A closed phase reports the span it
 * took; the open one reports how long it has been running, which is the number a person deciding
 * whether to wait is actually after.
 */
function describePhases(record: LandingLockRecord, now = new Date()): string[] {
  return record.phases.map(phase => {
    const endMs = phase.endedAt === undefined ? now.getTime() : Date.parse(phase.endedAt)
    const elapsed = describeDuration(Math.max(0, endMs - Date.parse(phase.startedAt)))
    return phase.endedAt === undefined ? `${phase.name}: ${elapsed} so far` : `${phase.name}: ${elapsed}`
  })
}

/** Report a duration in the coarsest unit that still says something useful. */
function describeDuration(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 1) {
    return `${Math.max(1, Math.round(elapsedMs / 1_000))}s`
  }
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

/** Explain a blocked acquisition immediately, then escalate the same holder on periodic reminders. */
function describeWaiting(record: LandingLockRecord, waitedMs: number): string {
  if (waitedMs < WAIT_WARN_INTERVAL_MS) {
    return `WAIT  Landing lock held by ${describe(record)}. This command will start when the lock is released.`
  }
  return `WARN  Still waiting ${describeDuration(waitedMs)} for the landing lock, held by ${describe(record)}. `
    + "A dead PID would not mean it was released, and waiting this long is normal. Forcing it is Ro's call — "
    + 'bring the output of `./agent board` to Ro rather than clearing it yourself.'
}

export const LandingLock = {
  DEFAULT_WAIT_TIMEOUT_MS,
  DEFERRED_WHILE_LANDING,
  LANDING_PHASES,
  LOCKED_LANES,
  WAIT_WARN_INTERVAL_MS,
  acquire,
  admitLane,
  beginPhase,
  currentPhase,
  deferredWhileLanding,
  describe,
  describeDuration,
  describePhases,
  describeWaiting,
  endPhases,
  forceRelease,
  heldForMs,
  holding,
  inspectState,
  inspectQueue,
  holdingForLane,
  inspect,
  landingInProgress,
  release,
  requiresLock,
} as const
